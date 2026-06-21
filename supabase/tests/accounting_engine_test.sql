-- =============================================================================
-- TEAL Enterprise — Accounting engine correctness checks
-- -----------------------------------------------------------------------------
-- Runs entirely inside a transaction and ROLLS BACK at the end: it creates no
-- persistent data. Apply migrations + seed first, then run this file (e.g.
-- `supabase db reset` then pipe this through psql, or via `supabase db execute`).
-- Any failed assertion raises and aborts. Successful checks emit NOTICE lines.
-- =============================================================================
begin;

do $$
declare
  v_user      uuid := gen_random_uuid();
  v_company   uuid;
  v_at_bank   uuid;
  v_at_income uuid;
  v_cash      uuid;
  v_sales     uuid;
  v_period    uuid;
  v_entry     uuid;
  v_e2        uuid;
  v_je        accounting.journal_entries;
  v_rev       accounting.journal_entries;
  v_net       numeric;
  v_lines     int;
  v_usd       uuid;
  v_bd        numeric;
begin
  -- Test context: a super-admin user so the engine's permission checks pass.
  insert into core.users (id, email, full_name, is_super_admin)
    values (v_user, 'engine-test@teal.local', 'Engine Test', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  insert into core.companies (name, base_currency_code)
    values ('Engine Test Co', 'TTD') returning id into v_company;

  select id into v_at_bank   from accounting.account_types where key = 'bank';
  select id into v_at_income from accounting.account_types where key = 'income';

  insert into accounting.accounts (company_id, code, name, account_type_id, is_bank_account)
    values (v_company, '1000', 'Cash at Bank', v_at_bank, true) returning id into v_cash;
  insert into accounting.accounts (company_id, code, name, account_type_id)
    values (v_company, '4000', 'Sales', v_at_income) returning id into v_sales;

  insert into accounting.accounting_periods
    (company_id, fiscal_year, period_no, name, start_date, end_date, status)
  values
    (v_company, extract(year from current_date)::int, 1, 'FY Period',
     date_trunc('year', current_date)::date,
     (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 'open')
  returning id into v_period;

  -- A balanced entry: Dr Cash 100 / Cr Sales 100 (base = txn currency = TTD).
  insert into accounting.journal_entries (company_id, entry_date, currency_code, description, created_by)
    values (v_company, current_date, 'TTD', 'Test sale', v_user) returning id into v_entry;
  insert into accounting.journal_lines
    (company_id, journal_entry_id, line_no, account_id, debit, credit, currency_code, base_debit, base_credit)
  values
    (v_company, v_entry, 1, v_cash,  100, 0,   'TTD', 100, 0),
    (v_company, v_entry, 2, v_sales, 0,   100, 'TTD', 0,   100);

  -- TEST 1 — a balanced entry posts and receives a number.
  v_je := accounting.post_journal_entry(v_entry);
  assert v_je.status = 'posted',    'TEST1 FAILED: entry should be posted';
  assert v_je.entry_no is not null, 'TEST1 FAILED: entry_no should be assigned on posting';
  raise notice 'TEST1 PASSED: balanced entry posted as %', v_je.entry_no;

  -- TEST 2 — a posted entry is immutable.
  begin
    update accounting.journal_entries set description = 'tamper' where id = v_entry;
    raise exception 'TEST2 FAILED: posted entry was mutable';
  exception when others then
    if sqlerrm like 'TEST2 FAILED%' then raise; end if;
    raise notice 'TEST2 PASSED: posted entry immutable (%)', sqlerrm;
  end;

  -- TEST 3 — an unbalanced entry is rejected at posting.
  insert into accounting.journal_entries (company_id, entry_date, currency_code, created_by)
    values (v_company, current_date, 'TTD', v_user) returning id into v_e2;
  insert into accounting.journal_lines
    (company_id, journal_entry_id, line_no, account_id, debit, credit, currency_code, base_debit, base_credit)
  values
    (v_company, v_e2, 1, v_cash,  100, 0,  'TTD', 100, 0),
    (v_company, v_e2, 2, v_sales, 0,   90, 'TTD', 0,   90);
  begin
    perform accounting.post_journal_entry(v_e2);
    raise exception 'TEST3 FAILED: unbalanced entry was posted';
  exception when others then
    if sqlerrm like 'TEST3 FAILED%' then raise; end if;
    raise notice 'TEST3 PASSED: unbalanced entry rejected (%)', sqlerrm;
  end;

  -- TEST 4 — posting into a closed period is rejected.
  update accounting.accounting_periods set status = 'closed' where id = v_period;
  begin
    perform accounting.post_journal_entry(v_e2);
    raise exception 'TEST4 FAILED: posted into a closed period';
  exception when others then
    if sqlerrm like 'TEST4 FAILED%' then raise; end if;
    raise notice 'TEST4 PASSED: closed-period posting rejected (%)', sqlerrm;
  end;
  update accounting.accounting_periods set status = 'open' where id = v_period;

  -- TEST 5 — the trial balance for the company nets to zero (posted lines only).
  select coalesce(sum(base_debit - base_credit), 0) into v_net
  from accounting.general_ledger where company_id = v_company;
  assert v_net = 0, format('TEST5 FAILED: trial balance net = %s (expected 0)', v_net);
  raise notice 'TEST5 PASSED: trial balance nets to zero';

  -- TEST 6 — reversal produces a balanced mirror; GL still nets to zero.
  v_rev := accounting.reverse_journal_entry(v_entry, current_date);
  assert v_rev.status = 'posted', 'TEST6 FAILED: reversal should be posted';
  select count(*) into v_lines from accounting.general_ledger where company_id = v_company;
  assert v_lines = 4, format('TEST6 FAILED: expected 4 posted GL lines, found %s', v_lines);
  select coalesce(sum(base_debit - base_credit), 0) into v_net
  from accounting.general_ledger where company_id = v_company;
  assert v_net = 0, format('TEST6 FAILED: post-reversal trial balance net = %s', v_net);
  raise notice 'TEST6 PASSED: reversal balanced; GL nets to zero';

  -- TEST 7 — base-currency amounts are recomputed from the exchange rate on posting,
  -- overwriting whatever the client supplied (here, deliberately wrong zeros).
  insert into accounting.exchange_rates (company_id, from_currency, to_currency, rate, rate_date)
    values (v_company, 'USD', 'TTD', 6.8, current_date);
  insert into accounting.journal_entries (company_id, entry_date, currency_code, description, created_by)
    values (v_company, current_date, 'USD', 'USD sale', v_user) returning id into v_usd;
  insert into accounting.journal_lines
    (company_id, journal_entry_id, line_no, account_id, debit, credit, currency_code, base_debit, base_credit)
  values
    (v_company, v_usd, 1, v_cash,  100, 0,   'USD', 0, 0),   -- base left at 0 on purpose
    (v_company, v_usd, 2, v_sales, 0,   100, 'USD', 0, 0);
  perform accounting.post_journal_entry(v_usd);
  select base_debit into v_bd from accounting.journal_lines where journal_entry_id = v_usd and line_no = 1;
  assert v_bd = 680, format('TEST7 FAILED: base_debit = %s (expected 680 = 100 x 6.8)', v_bd);
  select coalesce(sum(base_debit - base_credit), 0) into v_net
  from accounting.general_ledger where company_id = v_company;
  assert v_net = 0, format('TEST7 FAILED: post-FX trial balance net = %s', v_net);
  raise notice 'TEST7 PASSED: base amounts recomputed from fx (100 USD -> 680 TTD)';

  raise notice 'ALL ACCOUNTING ENGINE CHECKS PASSED';
end $$;

rollback;
