-- =============================================================================
-- TEAL Enterprise — Migration 0015: AR receipts (customer payments)
-- -----------------------------------------------------------------------------
-- Completes Accounts Receivable: a customer payment applied to an invoice. Each
-- payment posts a balanced Dr bank / Cr receivable journal (entry_source 'receipt')
-- and increments the invoice's amount_paid, driving open → partial → paid. Tenant
-- isolation follows the standard pattern; writes require invoices.manage.
-- =============================================================================

create table accounting.payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  customer_id      uuid not null references accounting.customers(id),
  invoice_id       uuid references accounting.invoices(id) on delete set null,
  payment_no       text,
  payment_date     date not null,
  amount           numeric(20,4) not null check (amount > 0),
  currency_code    char(3) not null references accounting.currencies(code),
  bank_account_id  uuid not null references accounting.accounts(id),  -- GL bank account (debited)
  journal_entry_id uuid references accounting.journal_entries(id),
  reference        text,
  created_by       uuid references core.users(id),
  created_at       timestamptz not null default now()
);
create index on accounting.payments (company_id);
create index on accounting.payments (invoice_id);
create index on accounting.payments (customer_id);
comment on table accounting.payments is
  'Customer receipts (AR). Each posts a Dr bank / Cr receivable journal and increments the invoice amount_paid (open → partial → paid).';

alter table accounting.payments enable row level security;
grant select, insert, update, delete on accounting.payments to authenticated;

create policy payments_sel on accounting.payments for select
  using ((select core.is_super_admin()) or company_id in (select core.user_companies()));
create policy payments_ins on accounting.payments for insert
  with check ((select core.has_permission(company_id, 'invoices.manage')));
create policy payments_upd on accounting.payments for update
  using ((select core.has_permission(company_id, 'invoices.manage')))
  with check ((select core.has_permission(company_id, 'invoices.manage')));
create policy payments_del on accounting.payments for delete
  using ((select core.has_permission(company_id, 'invoices.manage')));
