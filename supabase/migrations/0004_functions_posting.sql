-- =============================================================================
-- TEAL Enterprise — Migration 0004: Posting engine, immutability, numbering, audit
-- -----------------------------------------------------------------------------
-- The enforcement layer for double-entry integrity. Conforms to docs/accounting-engine.md:
--  * post_journal_entry / reverse_journal_entry with the dual-currency balance gate
--  * posted entries are immutable (corrections via reversing entries)
--  * posting into closed/locked periods is rejected
--  * per-company document numbering
--  * audit trail population via SECURITY DEFINER triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Per-company number sequences (gap-tolerant; serialized via row lock)
-- -----------------------------------------------------------------------------
create table accounting.number_sequences (
  company_id uuid not null references core.companies(id) on delete cascade,
  key        text not null,
  prefix     text not null default '',
  next_value bigint not null default 1,
  padding    smallint not null default 5,
  primary key (company_id, key)
);

alter table accounting.number_sequences enable row level security;
create policy number_sequences_sel on accounting.number_sequences for select
  using (core.is_super_admin() or company_id in (select core.user_companies()));
create policy number_sequences_write on accounting.number_sequences for all
  using (core.has_permission(company_id, 'company.manage'))
  with check (core.has_permission(company_id, 'company.manage'));
grant select, insert, update, delete on accounting.number_sequences to authenticated;

create or replace function accounting.next_number(p_company uuid, p_key text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
  v_val    bigint;
  v_pad    smallint;
begin
  insert into accounting.number_sequences (company_id, key)
    values (p_company, p_key)
    on conflict (company_id, key) do nothing;

  -- The UPDATE ... RETURNING takes a row lock, serialising concurrent callers.
  update accounting.number_sequences
    set next_value = next_value + 1
    where company_id = p_company and key = p_key
    returning prefix, next_value - 1, padding into v_prefix, v_val, v_pad;

  return v_prefix || lpad(v_val::text, v_pad, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Exchange-rate lookup → rate to convert p_from into p_to for a company on a date.
-- Prefers a company-specific rate over a platform rate, most recent on/before the
-- date. Returns NULL when no rate exists (callers must treat that as an error).
-- -----------------------------------------------------------------------------
create or replace function accounting.fx_rate(p_company uuid, p_from char(3), p_to char(3), p_date date)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case
    when p_from = p_to then 1::numeric
    else (
      select er.rate
      from accounting.exchange_rates er
      where er.from_currency = p_from
        and er.to_currency   = p_to
        and (er.company_id = p_company or er.company_id is null)
        and er.rate_date <= p_date
      order by (er.company_id is not null) desc, er.rate_date desc
      limit 1
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- Posting: recompute base amounts authoritatively, validate balance (txn + base
-- currency), resolve the single covering open period, then post.
-- -----------------------------------------------------------------------------
create or replace function accounting.post_journal_entry(p_entry_id uuid)
returns accounting.journal_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry        accounting.journal_entries;
  v_period       accounting.accounting_periods;
  v_base_ccy     char(3);
  v_period_count int;
  v_lines        int;
  v_sum_debit    numeric(20,4);
  v_sum_credit   numeric(20,4);
  v_sum_bdebit   numeric(20,4);
  v_sum_bcredit  numeric(20,4);
begin
  select * into v_entry from accounting.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Journal entry % not found', p_entry_id;
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'Only draft entries can be posted (entry % is %)', p_entry_id, v_entry.status;
  end if;
  if not core.has_permission(v_entry.company_id, 'journals.post') then
    raise exception 'Not authorized to post journal entries for this company';
  end if;

  select base_currency_code into v_base_ccy from core.companies where id = v_entry.company_id;

  -- Reversals carry the original's base amounts verbatim so they fully offset it;
  -- they are NOT re-translated. Every other entry has its base amounts recomputed
  -- from exchange rates so the base-currency GL can never be silently understated.
  if v_entry.reversal_of is null then
    if exists (
      select 1 from accounting.journal_lines jl
      where jl.journal_entry_id = p_entry_id
        and jl.currency_code <> v_base_ccy
        and accounting.fx_rate(v_entry.company_id, jl.currency_code, v_base_ccy, v_entry.entry_date) is null
    ) then
      raise exception 'Missing exchange rate to base currency % for one or more lines on %',
        v_base_ccy, v_entry.entry_date;
    end if;

    update accounting.journal_lines jl
      set fx_rate     = accounting.fx_rate(v_entry.company_id, jl.currency_code, v_base_ccy, v_entry.entry_date),
          base_debit  = round(jl.debit  * accounting.fx_rate(v_entry.company_id, jl.currency_code, v_base_ccy, v_entry.entry_date), 4),
          base_credit = round(jl.credit * accounting.fx_rate(v_entry.company_id, jl.currency_code, v_base_ccy, v_entry.entry_date), 4)
      where jl.journal_entry_id = p_entry_id;
  end if;

  select count(*),
         coalesce(sum(debit), 0),  coalesce(sum(credit), 0),
         coalesce(sum(base_debit), 0), coalesce(sum(base_credit), 0)
    into v_lines, v_sum_debit, v_sum_credit, v_sum_bdebit, v_sum_bcredit
  from accounting.journal_lines
  where journal_entry_id = p_entry_id;

  if v_lines < 2 then
    raise exception 'A journal entry must have at least two lines';
  end if;
  if v_sum_debit = 0 and v_sum_credit = 0 then
    raise exception 'Journal entry has zero value';
  end if;
  if v_sum_debit <> v_sum_credit then
    raise exception 'Entry not balanced in transaction currency: debits % <> credits %', v_sum_debit, v_sum_credit;
  end if;
  if v_sum_bdebit <> v_sum_bcredit then
    raise exception 'Entry not balanced in base currency: debits % <> credits %', v_sum_bdebit, v_sum_bcredit;
  end if;

  -- Resolve the SINGLE period covering the entry date; an overlap is rejected so a
  -- locked period can never be bypassed by another period covering the same date.
  select count(*) into v_period_count
  from accounting.accounting_periods
  where company_id = v_entry.company_id
    and v_entry.entry_date between start_date and end_date;
  if v_period_count = 0 then
    raise exception 'No accounting period covers date % for this company', v_entry.entry_date;
  end if;
  if v_period_count > 1 then
    raise exception 'Multiple accounting periods cover date % — resolve the overlap before posting', v_entry.entry_date;
  end if;

  select * into v_period
  from accounting.accounting_periods
  where company_id = v_entry.company_id
    and v_entry.entry_date between start_date and end_date;

  if v_period.status <> 'open' then
    raise exception 'Accounting period % is % — posting is not permitted', v_period.name, v_period.status;
  end if;

  update accounting.journal_entries
    set status    = 'posted',
        period_id = v_period.id,
        entry_no  = coalesce(entry_no, accounting.next_number(v_entry.company_id, 'journal_entry')),
        posted_at = now(),
        posted_by = auth.uid(),
        updated_at = now()
    where id = p_entry_id
    returning * into v_entry;

  return v_entry;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reversal: create and post a mirror entry. The original stays posted (immutable).
-- -----------------------------------------------------------------------------
create or replace function accounting.reverse_journal_entry(p_entry_id uuid, p_date date default null)
returns accounting.journal_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig  accounting.journal_entries;
  v_new   uuid;
  v_date  date;
begin
  select * into v_orig from accounting.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Journal entry % not found', p_entry_id;
  end if;
  if v_orig.status <> 'posted' then
    raise exception 'Only posted entries can be reversed (entry % is %)', p_entry_id, v_orig.status;
  end if;
  if not core.has_permission(v_orig.company_id, 'journals.post') then
    raise exception 'Not authorized to reverse journal entries for this company';
  end if;
  -- Idempotency: an entry can be reversed at most once (also enforced by the unique
  -- index journal_entries_one_reversal).
  if exists (select 1 from accounting.journal_entries where reversal_of = p_entry_id) then
    raise exception 'Journal entry % has already been reversed', coalesce(v_orig.entry_no, v_orig.id::text);
  end if;

  v_date := coalesce(p_date, current_date);

  insert into accounting.journal_entries
    (company_id, entry_date, currency_code, description, source, source_id, status, reversal_of, created_by)
  values
    (v_orig.company_id, v_date, v_orig.currency_code,
     'Reversal of ' || coalesce(v_orig.entry_no, v_orig.id::text),
     v_orig.source, v_orig.id, 'draft', v_orig.id, auth.uid())
  returning id into v_new;

  insert into accounting.journal_lines
    (company_id, journal_entry_id, line_no, account_id, description,
     debit, credit, currency_code, fx_rate, base_debit, base_credit, tax_code_id)
  select
     company_id, v_new, line_no, account_id, description,
     credit, debit,                 -- swap sides
     currency_code, fx_rate,
     base_credit, base_debit,        -- swap base sides
     tax_code_id
  from accounting.journal_lines
  where journal_entry_id = p_entry_id;

  return accounting.post_journal_entry(v_new);
end;
$$;

grant execute on function accounting.next_number(uuid, text),
  accounting.fx_rate(uuid, char, char, date),
  accounting.post_journal_entry(uuid),
  accounting.reverse_journal_entry(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Immutability guards: posted entries and their lines cannot be modified.
-- -----------------------------------------------------------------------------
create or replace function accounting.guard_posted_entry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Posted journal entries are immutable and cannot be deleted (use a reversal)';
    end if;
    return old;
  else  -- UPDATE
    if old.status = 'posted' then
      raise exception 'Posted journal entry % is immutable. Record a reversing entry instead.',
        coalesce(old.entry_no, old.id::text);
    end if;
    return new;
  end if;
end;
$$;

create trigger trg_guard_journal_entry
  before update or delete on accounting.journal_entries
  for each row execute function accounting.guard_posted_entry();

create or replace function accounting.guard_posted_lines()
returns trigger
language plpgsql
as $$
declare
  v_status accounting.entry_status;
begin
  select status into v_status
  from accounting.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status = 'posted' then
    raise exception 'Cannot modify lines of a posted journal entry';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger trg_guard_journal_lines
  before insert or update or delete on accounting.journal_lines
  for each row execute function accounting.guard_posted_lines();

-- -----------------------------------------------------------------------------
-- Audit trail: capture before/after on financially significant tables.
-- SECURITY DEFINER so it can write core.audit_logs (which has no write policy).
-- -----------------------------------------------------------------------------
create or replace function core.audit_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before    jsonb;
  v_after     jsonb;
  v_company   uuid;
  v_entity_id uuid;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old); v_after := null;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old); v_after := to_jsonb(new);
  else
    v_before := null; v_after := to_jsonb(new);
  end if;

  v_company   := coalesce((v_after->>'company_id')::uuid, (v_before->>'company_id')::uuid);
  v_entity_id := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);

  insert into core.audit_logs
    (company_id, user_id, action, entity_schema, entity_type, entity_id, before, after)
  values
    (v_company, auth.uid(), lower(tg_op), tg_table_schema, tg_table_name, v_entity_id, v_before, v_after);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('accounting','journal_entries'),
      ('accounting','journal_lines'),
      ('accounting','accounts'),
      ('accounting','accounting_periods'),
      ('accounting','tax_codes'),
      ('accounting','invoices'),
      ('accounting','invoice_lines'),
      ('accounting','bills'),
      ('accounting','bill_lines'),
      ('accounting','customers'),
      ('accounting','suppliers'),
      ('accounting','bank_accounts'),
      ('core','companies'),
      ('core','company_memberships')
    ) as t(sch, tbl)
  loop
    execute format(
      'create trigger trg_audit after insert or update or delete on %I.%I for each row execute function core.audit_trigger()',
      r.sch, r.tbl);
  end loop;
end $$;
