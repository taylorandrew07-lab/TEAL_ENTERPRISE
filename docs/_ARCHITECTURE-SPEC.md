# TEAL Enterprise — Authoritative Architecture Spec (internal working reference)

> This file is the single source of truth for cross-cutting decisions. Every architecture
> document and every migration must conform to the names, types, and invariants below.
> Status: Draft v1 — 2026-06-17. Owner: Orchestrator Agent.

## 1. Platform

TEAL Enterprise is a modular business operating platform for the Taylor group of companies
(maritime, logistics, surveying, claims, ship agency, freight forwarding, accounting) operating
primarily in **Trinidad & Tobago**. **Accounting is the first module.** Future modules: Survey
Management, Claims Management, Cargo Monitoring, Ship Agency Operations, Freight Forwarding,
Compliance, Document Management, Reporting & Analytics, Administration.

Design imperative: a **shared platform core** plus **loosely-coupled modules**. Accounting must
never embed logic that other modules depend on directly; modules integrate through the core and
through well-defined service boundaries.

## 2. Tech stack

- Next.js (App Router) + React + TypeScript, deployed on Vercel.
- Supabase: Postgres, Auth, Storage, Row Level Security.
- PWA / offline-ready architecture (view-first offline; no offline editing until sync rules exist).

## 3. Repository structure

```
TEAL ENTERPRISE/
├── app/                      # Next.js App Router
│   ├── (platform)/           # core shell: auth, company switcher, admin
│   └── (accounting)/         # accounting module routes
├── src/
│   ├── core/                 # platform core libs (auth, rbac, companies, audit, modules)
│   └── modules/accounting/   # accounting domain libs (ledger, ar, ap, currency, tax, import)
├── supabase/
│   ├── migrations/           # ordered SQL migrations
│   └── seed/                 # reference seed data (currencies, account types, permissions)
├── docs/                     # architecture pack
└── tests/
```

## 4. Database conventions

- Two Postgres schemas now: **`core`** (platform) and **`accounting`** (module). Both exposed to
  PostgREST. Future modules get their own schemas (`survey`, `claims`, ...).
- Primary keys: `uuid` default `gen_random_uuid()`.
- Every tenant-scoped table has `company_id uuid not null references core.companies(id)`.
- Timestamps: `created_at timestamptz default now()`, `updated_at timestamptz`, plus
  `created_by`/`updated_by uuid references core.users(id)` where relevant.
- Money: `numeric(20,4)`. Amounts stored in **transaction currency** AND **base-currency
  equivalent** (`base_*` columns).
- Soft delete via `deleted_at timestamptz` where business rules require recoverability.
- **RLS enabled on every table.**
- Enums implemented as Postgres `enum` types or `text` + `check` (documents may show either; the
  Accounting Engine doc is authoritative on the final choice — default to native enum types).

## 5. Canonical Phase 1 schema (authoritative names)

### core
- `core.companies(id, name, legal_name, country_code default 'TT', base_currency_code char(3) references accounting.currencies(code), fiscal_year_start_month int default 1, timezone text default 'America/Port_of_Spain', status, created_at, updated_at)`
- `core.users(id [= auth.users.id], email, full_name, is_super_admin bool default false, created_at)`
- `core.roles(id, company_id uuid null [null = system role], key, name, description, is_system bool)`
- `core.permissions(id, key unique, name, description, category)`
- `core.role_permissions(role_id, permission_id)`
- `core.company_memberships(id, user_id, company_id, role_id, status enum[active,invited,suspended], created_at)`
- `core.clients(id, company_id, type, name, email, phone, address jsonb, created_at)` — platform-level contacts
- `core.documents(id, company_id, owner_module, entity_type, entity_id, storage_path, filename, mime_type, uploaded_by, created_at)`
- `core.audit_logs(id, company_id, user_id, action, entity_schema, entity_type, entity_id, before jsonb, after jsonb, ip inet, created_at)`
- `core.modules(id, key, name, description)` — module registry
- `core.company_modules(company_id, module_id, enabled bool, settings jsonb)`

### accounting
- `accounting.currencies(code char(3) PK, name, symbol, decimal_places int default 2, is_active bool default true)`
- `accounting.exchange_rates(id, company_id uuid null, from_currency, to_currency, rate numeric, rate_date date, source, created_at)`
- `accounting.account_types(id, key, name, category enum[asset,liability,equity,income,expense], normal_balance enum[debit,credit], is_system bool)`
- `accounting.accounts(id, company_id, code, name, account_type_id, parent_account_id uuid null, currency_code char(3) null, is_bank_account bool, is_active bool, description, created_at, updated_at)` — chart of accounts
- `accounting.accounting_periods(id, company_id, fiscal_year int, period_no int, name, start_date, end_date, status enum[open,closed,locked], created_at)`
- `accounting.journal_entries(id, company_id, entry_no, entry_date, period_id, currency_code, description, source enum[manual,invoice,bill,payment,receipt,opening_balance,fx_revaluation,import], source_id uuid, status enum[draft,posted,void], posted_at, posted_by, created_by, created_at, updated_at)`
- `accounting.journal_lines(id, company_id, journal_entry_id, line_no, account_id, description, debit numeric(20,4) default 0, credit numeric(20,4) default 0, currency_code, fx_rate numeric default 1, base_debit numeric(20,4), base_credit numeric(20,4), tax_code_id uuid null, created_at)`
  - CHECK: `not (debit > 0 and credit > 0)`; CHECK `debit >= 0 and credit >= 0`.
- `accounting.tax_codes(id, company_id, code, name, rate numeric, tax_type enum[vat,withholding,other], collected_account_id, paid_account_id, is_active)`
- `accounting.customers(id, company_id, code, name, receivable_account_id, currency_code, tax_reg_no, email, phone, address jsonb, is_active, created_at)`
- `accounting.suppliers(id, company_id, code, name, payable_account_id, currency_code, tax_reg_no, email, phone, address jsonb, is_active, created_at)`
- `accounting.bank_accounts(id, company_id, account_id [GL account link], name, bank_name, account_number, currency_code, is_active, created_at)`
- `accounting.invoices(id, company_id, customer_id, invoice_no, invoice_date, due_date, currency_code, fx_rate, status enum[draft,open,partial,paid,void], subtotal, tax_total, total, base_total, amount_paid, journal_entry_id, notes, created_at, updated_at)`
- `accounting.invoice_lines(id, company_id, invoice_id, line_no, account_id, description, quantity, unit_price, tax_code_id, line_total)`
- `accounting.bills(id, company_id, supplier_id, bill_no, bill_date, due_date, currency_code, fx_rate, status, subtotal, tax_total, total, base_total, amount_paid, journal_entry_id, notes, created_at, updated_at)`
- `accounting.bill_lines(id, company_id, bill_id, line_no, account_id, description, quantity, unit_price, tax_code_id, line_total)`
- `accounting.import_batches(id, company_id, import_type, source_system, status enum[uploaded,validating,validated,failed,committed], file_path, row_count, error_count, created_by, created_at)`
- `accounting.import_staging_rows(id, batch_id, company_id, row_no, raw jsonb, mapped jsonb, status, errors jsonb)`
- `accounting.dashboard_configs(id, company_id, user_id uuid null, name, layout jsonb, is_default, created_at)`
- `accounting.report_exports(id, company_id, report_key, params jsonb, format, file_path, generated_by, created_at)`

### General Ledger
Not a base table. The GL is **derived from posted `accounting.journal_lines`** (entries with
`status = 'posted'`). Provide a view `accounting.general_ledger` and balance queries. An optional
maintained `accounting.account_balances` (per account per period) may be added later for
performance — flagged as a later optimization, never a substitute for the journal.

## 6. Double-entry invariants (non-negotiable)

1. A journal entry may move to `status = 'posted'` only if `SUM(debit) = SUM(credit)` in **both**
   transaction currency and base currency (enforced by a `BEFORE` trigger / posting function).
2. Posted entries are **immutable**. Corrections are made via **reversing entries**, never edits.
3. Posting into a `closed` or `locked` period is rejected.
4. Every business document that has financial effect (invoice, bill, payment, receipt, opening
   balance) posts a balanced journal entry via `source` / `source_id`.

## 7. Security / RBAC model

- Seed roles: **Super Admin** (platform-wide), **Company Admin**, **Accountant / Admin User**,
  **Office User**, **View-only User**.
- Permissions are **data-driven** (`core.permissions` + `core.role_permissions`). Never hard-code
  business access rules in application logic.
- RLS: a row is readable if the current user has an `active` `core.company_memberships` row for the
  row's `company_id`; writable if their role additionally grants the relevant permission. Super
  Admin bypasses company scoping.
- Helper functions: `core.user_companies()` → set of `company_id`; `core.has_permission(company_id,
  permission_key)` → boolean. Both `security definer`, used by RLS policies.

## 8. Multi-currency

- Each company has a base currency (default **TTD**). Transactions in any currency.
- Store `fx_rate` and base-currency equivalents at transaction time; never re-derive historically.
- Revaluation produces journal entries with `source = 'fx_revaluation'`.
- Seed currencies: TTD, USD, GBP, EUR (extensible).

## 9. Trinidad & Tobago

Design for VAT, withholding tax, corporation tax, PAYE, NIS, Health Surcharge — but **no
hard-coded rates**. All taxes flow through `accounting.tax_codes` and configuration. TTD base
currency; T&T fiscal-year and statutory reporting are considered in the period model.

## 10. Non-negotiables

No demo/fake data. No fake dashboards. No throwaway schemas. No single-company assumptions.
Double-entry always. No hard-coded tax. No hard-coded permissions. No reports before the ledger
exists. No dashboards before real accounting data exists. Imports always staged + validated.
No offline editing before sync rules are defined. No accounting logic mixed into future modules.

## 11. Document conventions

Each architecture doc opens with: title, "TEAL Enterprise — Accounting Module", owning agent,
status (`Draft v1 — 2026-06-17`), and a 2–3 sentence purpose. Each doc ends with **Open Questions**
and **Decisions Locked** sections, and cross-references sibling docs by filename.
