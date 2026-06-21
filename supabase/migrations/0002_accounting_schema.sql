-- =============================================================================
-- TEAL Enterprise — Migration 0002: Accounting module schema
-- -----------------------------------------------------------------------------
-- Creates the `accounting` schema: currencies, exchange rates, account types,
-- chart of accounts, periods, journals, tax codes, customers/suppliers, banking,
-- invoices/bills, import staging, dashboards, report exports, and the derived
-- general_ledger view. Conforms to docs/_ARCHITECTURE-SPEC.md and docs/accounting-engine.md.
-- Posting functions and triggers are in 0004; RLS in 0003.
-- =============================================================================

create schema if not exists accounting;

-- btree_gist powers the period-overlap EXCLUDE constraint below (equality on
-- company_id combined with range overlap on the period dates).
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type accounting.account_category as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type accounting.normal_balance   as enum ('debit', 'credit');
create type accounting.period_status    as enum ('open', 'closed', 'locked');
create type accounting.entry_status      as enum ('draft', 'posted', 'void');
create type accounting.entry_source      as enum (
  'manual', 'invoice', 'bill', 'payment', 'receipt',
  'opening_balance', 'fx_revaluation', 'import'
);
create type accounting.doc_status        as enum ('draft', 'open', 'partial', 'paid', 'void');
create type accounting.tax_type          as enum ('vat', 'withholding', 'other');
create type accounting.import_status      as enum ('uploaded', 'validating', 'validated', 'failed', 'committed');

-- -----------------------------------------------------------------------------
-- Currencies (reference data; seeded in supabase/seed)
-- -----------------------------------------------------------------------------
create table accounting.currencies (
  code           char(3) primary key,
  name           text not null,
  symbol         text,
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  is_active      boolean not null default true
);

comment on table accounting.currencies is 'ISO currency reference. Shared across all companies.';

-- Now that currencies exists, wire the deferred FK from core.companies.
alter table core.companies
  add constraint companies_base_currency_fkey
  foreign key (base_currency_code) references accounting.currencies(code);

-- -----------------------------------------------------------------------------
-- Exchange rates (company-specific when company_id set; platform-wide when null)
-- -----------------------------------------------------------------------------
create table accounting.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references core.companies(id) on delete cascade,
  from_currency char(3) not null references accounting.currencies(code),
  to_currency   char(3) not null references accounting.currencies(code),
  rate          numeric(20,10) not null check (rate > 0),
  rate_date     date not null,
  source        text,
  created_at    timestamptz not null default now(),
  check (from_currency <> to_currency)
);

create index on accounting.exchange_rates (company_id, from_currency, to_currency, rate_date desc);

-- -----------------------------------------------------------------------------
-- Account types (reference; seeded). normal_balance drives debit/credit effect.
-- -----------------------------------------------------------------------------
create table accounting.account_types (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  name           text not null,
  category       accounting.account_category not null,
  normal_balance accounting.normal_balance not null,
  is_system      boolean not null default true
);

-- -----------------------------------------------------------------------------
-- Chart of accounts (per company)
-- -----------------------------------------------------------------------------
create table accounting.accounts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  code              text not null,
  name              text not null,
  account_type_id   uuid not null references accounting.account_types(id),
  parent_account_id uuid references accounting.accounts(id) on delete restrict,
  currency_code     char(3) references accounting.currencies(code),  -- null = base currency
  is_bank_account   boolean not null default false,
  is_active         boolean not null default true,
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code),
  -- Lets journal_lines reference (company_id, id) so a line can only use accounts of its own company.
  unique (company_id, id)
);

create index on accounting.accounts (company_id);
create index on accounting.accounts (company_id, account_type_id);

-- -----------------------------------------------------------------------------
-- Accounting periods (per company)
-- -----------------------------------------------------------------------------
create table accounting.accounting_periods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  fiscal_year integer not null,
  period_no   smallint not null check (period_no between 1 and 13),
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      accounting.period_status not null default 'open',
  created_at  timestamptz not null default now(),
  unique (company_id, fiscal_year, period_no),
  check (end_date >= start_date),
  -- No two periods for the same company may cover overlapping dates, so the date of
  -- any entry resolves to exactly one period (a closed period can't be bypassed by a
  -- second open period covering the same day).
  constraint accounting_periods_no_overlap
    exclude using gist (company_id with =, daterange(start_date, end_date, '[]') with &&)
);

create index on accounting.accounting_periods (company_id, start_date, end_date);

-- -----------------------------------------------------------------------------
-- Tax codes (configurable; no hard-coded rates anywhere)
-- -----------------------------------------------------------------------------
create table accounting.tax_codes (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  code                text not null,
  name                text not null,
  rate                numeric(9,6) not null default 0,   -- e.g. 0.125000 — set by admin, never hard-coded
  tax_type            accounting.tax_type not null default 'vat',
  collected_account_id uuid references accounting.accounts(id),  -- output/collected (liability)
  paid_account_id      uuid references accounting.accounts(id),  -- input/paid (asset)
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (company_id, code)
);

-- -----------------------------------------------------------------------------
-- Journal entries (header) + lines. The double-entry core.
-- -----------------------------------------------------------------------------
create table accounting.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  entry_no      text,                          -- assigned on posting (per-company sequence)
  entry_date    date not null,
  period_id     uuid references accounting.accounting_periods(id),
  currency_code char(3) not null references accounting.currencies(code),
  description   text,
  source        accounting.entry_source not null default 'manual',
  source_id     uuid,                          -- originating document id (invoice/bill/etc.)
  status        accounting.entry_status not null default 'draft',
  posted_at     timestamptz,
  posted_by     uuid references core.users(id),
  reversal_of   uuid references accounting.journal_entries(id),  -- set on a reversing entry
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, entry_no),
  -- Lets journal_lines reference (company_id, id) so a line's company must equal its entry's.
  unique (company_id, id)
);

-- At most one reversal per original entry (idempotent reverse_journal_entry).
create unique index journal_entries_one_reversal on accounting.journal_entries (reversal_of)
  where reversal_of is not null;

create index on accounting.journal_entries (company_id, entry_date);
create index on accounting.journal_entries (company_id, status);
create index on accounting.journal_entries (source, source_id);

create table accounting.journal_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  journal_entry_id uuid not null,
  line_no          integer not null,
  account_id       uuid not null,
  description      text,
  debit            numeric(20,4) not null default 0,
  credit           numeric(20,4) not null default 0,
  currency_code    char(3) not null references accounting.currencies(code),
  fx_rate          numeric(20,10) not null default 1 check (fx_rate > 0),
  base_debit       numeric(20,4) not null default 0,
  base_credit      numeric(20,4) not null default 0,
  tax_code_id      uuid references accounting.tax_codes(id),
  created_at       timestamptz not null default now(),
  unique (journal_entry_id, line_no),
  -- Composite FKs guarantee a line's company_id matches BOTH its parent entry and its
  -- account — a line can never reference another tenant's entry or account.
  constraint journal_lines_entry_fk foreign key (company_id, journal_entry_id)
    references accounting.journal_entries (company_id, id) on delete cascade,
  constraint journal_lines_account_fk foreign key (company_id, account_id)
    references accounting.accounts (company_id, id),
  -- A line is either a debit or a credit, never both, never negative — in BOTH currencies.
  constraint journal_lines_nonneg check (debit >= 0 and credit >= 0 and base_debit >= 0 and base_credit >= 0),
  constraint journal_lines_one_side check (not (debit > 0 and credit > 0)),
  constraint journal_lines_base_one_side check (not (base_debit > 0 and base_credit > 0)),
  -- Base amounts may only sit on the side where the transaction amount is positive
  -- (the posting engine recomputes the magnitudes from exchange rates in 0004).
  constraint journal_lines_base_side check ((debit > 0 or base_debit = 0) and (credit > 0 or base_credit = 0))
);

create index on accounting.journal_lines (journal_entry_id);
create index on accounting.journal_lines (company_id, account_id);
create index on accounting.journal_lines (account_id);
create index on accounting.journal_lines (tax_code_id);

-- -----------------------------------------------------------------------------
-- Customers & suppliers (subledger masters)
-- -----------------------------------------------------------------------------
create table accounting.customers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  code                 text not null,
  name                 text not null,
  receivable_account_id uuid references accounting.accounts(id),  -- AR control
  currency_code        char(3) references accounting.currencies(code),
  tax_reg_no           text,
  email                text,
  phone                text,
  address              jsonb,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, code)
);

create index on accounting.customers (company_id);

create table accounting.suppliers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  code              text not null,
  name              text not null,
  payable_account_id uuid references accounting.accounts(id),     -- AP control
  currency_code     char(3) references accounting.currencies(code),
  tax_reg_no        text,
  email             text,
  phone             text,
  address           jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code)
);

create index on accounting.suppliers (company_id);

-- -----------------------------------------------------------------------------
-- Bank accounts (linked to a GL account)
-- -----------------------------------------------------------------------------
create table accounting.bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  account_id     uuid not null references accounting.accounts(id),  -- GL link
  name           text not null,
  bank_name      text,
  account_number text,
  currency_code  char(3) references accounting.currencies(code),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (company_id, account_id)
);

create index on accounting.bank_accounts (company_id);

-- -----------------------------------------------------------------------------
-- Invoices (AR) + lines
-- -----------------------------------------------------------------------------
create table accounting.invoices (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  customer_id      uuid not null references accounting.customers(id),
  invoice_no       text,
  invoice_date     date not null,
  due_date         date,
  currency_code    char(3) not null references accounting.currencies(code),
  fx_rate          numeric(20,10) not null default 1,
  status           accounting.doc_status not null default 'draft',
  subtotal         numeric(20,4) not null default 0,
  tax_total        numeric(20,4) not null default 0,
  total            numeric(20,4) not null default 0,
  base_total       numeric(20,4) not null default 0,
  amount_paid      numeric(20,4) not null default 0,
  journal_entry_id uuid references accounting.journal_entries(id),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, invoice_no)
);

create index on accounting.invoices (company_id, status);
create index on accounting.invoices (company_id, customer_id);

create table accounting.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  invoice_id  uuid not null references accounting.invoices(id) on delete cascade,
  line_no     integer not null,
  account_id  uuid not null references accounting.accounts(id),  -- income account
  description text,
  quantity    numeric(20,4) not null default 1,
  unit_price  numeric(20,4) not null default 0,
  tax_code_id uuid references accounting.tax_codes(id),
  line_total  numeric(20,4) not null default 0,
  unique (invoice_id, line_no)
);

create index on accounting.invoice_lines (invoice_id);
create index on accounting.invoice_lines (account_id);
create index on accounting.invoice_lines (tax_code_id);

-- -----------------------------------------------------------------------------
-- Bills (AP) + lines
-- -----------------------------------------------------------------------------
create table accounting.bills (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  supplier_id      uuid not null references accounting.suppliers(id),
  bill_no          text,
  bill_date        date not null,
  due_date         date,
  currency_code    char(3) not null references accounting.currencies(code),
  fx_rate          numeric(20,10) not null default 1,
  status           accounting.doc_status not null default 'draft',
  subtotal         numeric(20,4) not null default 0,
  tax_total        numeric(20,4) not null default 0,
  total            numeric(20,4) not null default 0,
  base_total       numeric(20,4) not null default 0,
  amount_paid      numeric(20,4) not null default 0,
  journal_entry_id uuid references accounting.journal_entries(id),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, supplier_id, bill_no)
);

create index on accounting.bills (company_id, status);
create index on accounting.bills (company_id, supplier_id);

create table accounting.bill_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  bill_id     uuid not null references accounting.bills(id) on delete cascade,
  line_no     integer not null,
  account_id  uuid not null references accounting.accounts(id),  -- expense account
  description text,
  quantity    numeric(20,4) not null default 1,
  unit_price  numeric(20,4) not null default 0,
  tax_code_id uuid references accounting.tax_codes(id),
  line_total  numeric(20,4) not null default 0,
  unique (bill_id, line_no)
);

create index on accounting.bill_lines (bill_id);
create index on accounting.bill_lines (account_id);
create index on accounting.bill_lines (tax_code_id);

-- -----------------------------------------------------------------------------
-- Import staging framework (nothing reaches live tables until committed)
-- -----------------------------------------------------------------------------
create table accounting.import_batches (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  import_type   text not null,                 -- chart_of_accounts | customers | trial_balance | ...
  source_system text,                          -- accountedge | myob | csv | ...
  status        accounting.import_status not null default 'uploaded',
  file_path     text,
  row_count     integer not null default 0,
  error_count   integer not null default 0,
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now()
);

create index on accounting.import_batches (company_id, status);

create table accounting.import_staging_rows (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references accounting.import_batches(id) on delete cascade,
  company_id uuid not null references core.companies(id) on delete cascade,
  row_no     integer not null,
  raw        jsonb not null,
  mapped     jsonb,
  status     text not null default 'pending',  -- pending | valid | error
  errors     jsonb,
  unique (batch_id, row_no)
);

create index on accounting.import_staging_rows (batch_id);

-- -----------------------------------------------------------------------------
-- Dashboards & report exports
-- -----------------------------------------------------------------------------
create table accounting.dashboard_configs (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  user_id    uuid references core.users(id) on delete cascade,  -- null = company default
  name       text not null,
  layout     jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index on accounting.dashboard_configs (company_id);

create table accounting.report_exports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  report_key   text not null,
  params       jsonb not null default '{}'::jsonb,
  format       text not null default 'csv',
  file_path    text,
  generated_by uuid references core.users(id),
  created_at   timestamptz not null default now()
);

create index on accounting.report_exports (company_id, report_key);

-- -----------------------------------------------------------------------------
-- General Ledger: derived view over POSTED journal lines only.
-- The GL is never a base table; the journal is the single source of truth.
-- -----------------------------------------------------------------------------
create view accounting.general_ledger as
select
  jl.company_id,
  je.entry_no,
  je.entry_date,
  je.period_id,
  je.source,
  je.source_id,
  jl.account_id,
  a.code        as account_code,
  a.name        as account_name,
  at.category   as account_category,
  jl.description,
  jl.currency_code,
  jl.debit,
  jl.credit,
  jl.base_debit,
  jl.base_credit,
  je.id         as journal_entry_id,
  jl.id         as journal_line_id
from accounting.journal_lines jl
join accounting.journal_entries je on je.id = jl.journal_entry_id
join accounting.accounts a on a.id = jl.account_id
join accounting.account_types at on at.id = a.account_type_id
where je.status = 'posted';

comment on view accounting.general_ledger is 'Posted journal lines, enriched with account metadata. Source of all financial reports.';

-- updated_at triggers for accounting tables that carry it.
create trigger trg_accounts_updated_at before update on accounting.accounts
  for each row execute function core.set_updated_at();
create trigger trg_customers_updated_at before update on accounting.customers
  for each row execute function core.set_updated_at();
create trigger trg_suppliers_updated_at before update on accounting.suppliers
  for each row execute function core.set_updated_at();
create trigger trg_invoices_updated_at before update on accounting.invoices
  for each row execute function core.set_updated_at();
create trigger trg_bills_updated_at before update on accounting.bills
  for each row execute function core.set_updated_at();
create trigger trg_journal_entries_updated_at before update on accounting.journal_entries
  for each row execute function core.set_updated_at();
