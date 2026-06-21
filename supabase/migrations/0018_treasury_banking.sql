-- =============================================================================
-- TEAL Enterprise — Migration 0018: Private bank register (treasury)
-- -----------------------------------------------------------------------------
-- A PRIVATE cash/treasury register of REAL bank accounts (distinct from the GL
-- bank accounts): multiple banks, multiple accounts each with its own currency and
-- real balance; uploaded statements (files) and their transactions; and each
-- transaction can be MATCHED to a bill (expense) or invoice (receivable) for
-- in-app cross-referencing. Everything is gated by the new banking.private
-- permission — invisible to ordinary accounting staff.
-- =============================================================================

create table accounting.treasury_banks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  name        text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index on accounting.treasury_banks (company_id);

create table accounting.treasury_accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  bank_id         uuid not null references accounting.treasury_banks(id) on delete cascade,
  name            text not null,                                  -- e.g. "Operating USD"
  account_number  text,
  currency_code   char(3) not null references accounting.currencies(code),
  current_balance numeric(20,4) not null default 0,
  balance_as_of   date,
  gl_account_id   uuid references accounting.accounts(id),        -- optional link for book-vs-actual
  note            text,
  created_at      timestamptz not null default now()
);
create index on accounting.treasury_accounts (company_id);
create index on accounting.treasury_accounts (bank_id);

create table accounting.treasury_statements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  account_id    uuid not null references accounting.treasury_accounts(id) on delete cascade,
  filename      text,
  storage_path  text,                                             -- in the 'documents' bucket
  period_start  date,
  period_end    date,
  uploaded_by   uuid references core.users(id),
  created_at    timestamptz not null default now()
);
create index on accounting.treasury_statements (account_id);

create table accounting.treasury_transactions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  account_id         uuid not null references accounting.treasury_accounts(id) on delete cascade,
  statement_id       uuid references accounting.treasury_statements(id) on delete set null,
  txn_date           date not null,
  description        text,
  amount             numeric(20,4) not null,                      -- signed: + money in, - money out
  running_balance    numeric(20,4),
  -- Cross-reference: a transaction can be matched to a bill (expense) or invoice (receivable).
  matched_bill_id    uuid references accounting.bills(id) on delete set null,
  matched_invoice_id uuid references accounting.invoices(id) on delete set null,
  note               text,
  created_at         timestamptz not null default now()
);
create index on accounting.treasury_transactions (account_id, txn_date);
create index on accounting.treasury_transactions (matched_bill_id);
create index on accounting.treasury_transactions (matched_invoice_id);

comment on table accounting.treasury_banks is 'Private bank register (banks). Gated by banking.private.';

-- RLS: banking.private gates read AND write for all four tables (truly private).
do $$
declare t text;
begin
  foreach t in array array['treasury_banks','treasury_accounts','treasury_statements','treasury_transactions']
  loop
    execute format('alter table accounting.%I enable row level security', t);
    execute format('grant select, insert, update, delete on accounting.%I to authenticated', t);
    execute format($p$create policy %I on accounting.%I for select using ((select core.has_permission(company_id, 'banking.private')))$p$, t||'_sel', t);
    execute format($p$create policy %I on accounting.%I for insert with check ((select core.has_permission(company_id, 'banking.private')))$p$, t||'_ins', t);
    execute format($p$create policy %I on accounting.%I for update using ((select core.has_permission(company_id, 'banking.private'))) with check ((select core.has_permission(company_id, 'banking.private')))$p$, t||'_upd', t);
    execute format($p$create policy %I on accounting.%I for delete using ((select core.has_permission(company_id, 'banking.private')))$p$, t||'_del', t);
  end loop;
end $$;

-- Private 'statements' Storage bucket: company-scoped by first path segment, gated by
-- banking.private for BOTH read and write (statements are private, unlike documents).
insert into storage.buckets (id, name, public, file_size_limit)
values ('statements', 'statements', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "statements read banking.private" on storage.objects;
create policy "statements read banking.private" on storage.objects for select to authenticated
  using (bucket_id = 'statements' and exists (
    select 1 from core.user_companies() uc
    where uc::text = (storage.foldername(name))[1] and core.has_permission(uc, 'banking.private')));

drop policy if exists "statements insert banking.private" on storage.objects;
create policy "statements insert banking.private" on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and exists (
    select 1 from core.user_companies() uc
    where uc::text = (storage.foldername(name))[1] and core.has_permission(uc, 'banking.private')));

drop policy if exists "statements delete banking.private" on storage.objects;
create policy "statements delete banking.private" on storage.objects for delete to authenticated
  using (bucket_id = 'statements' and exists (
    select 1 from core.user_companies() uc
    where uc::text = (storage.foldername(name))[1] and core.has_permission(uc, 'banking.private')));
