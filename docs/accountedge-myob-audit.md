# AccountEdge / MYOB Infrastructure Audit

**TEAL Enterprise — Accounting Module**
**Owning agent:** AccountEdge / MYOB Audit Agent
**Status:** Draft v1 — 2026-06-17

**Purpose:** This document audits the standard infrastructure of mature desktop/SMB accounting
software (AccountEdge Pro, MYOB Business/AccountRight, and the broader category, with reference
to QuickBooks and Xero conventions) to extract the *system infrastructure* that any complete
accounting module must provide. It is a requirements-discovery reference, not a UI clone: for each
functional area it records the purpose, standard entities, workflows and their states, the
double-entry postings each workflow generates, and an explicit TEAL **include vs defer** decision
mapped to the canonical schema in `_ARCHITECTURE-SPEC.md`.

> Posting convention used throughout: **Dr** = debit, **Cr** = credit. All postings land in
> `accounting.journal_entries` + `accounting.journal_lines` with the appropriate `source` value,
> per spec §6 invariant 4. The GL is derived from posted lines (spec §5, General Ledger).

---

## 1. General Ledger (GL)

**Purpose.** The central record of every financial movement; the spine all other modules post into.
Every report (Trial Balance, P&L, Balance Sheet) is a query over the GL.

**Standard entities.** Accounts (chart), journal entries (header), journal lines (detail with
Dr/Cr), accounting periods, account balances (often a maintained summary in mature systems for
performance).

**Workflows & states.** Source documents (invoices, bills, payments, etc.) and manual journals
generate journal entries. Entry lifecycle: **draft → posted → void** (corrections via reversal).
MYOB/AccountEdge effectively post on save; QuickBooks/Xero keep a draft concept for some documents.

**Postings.** The GL does not "generate" postings of its own; it *receives* every balanced entry.
Each entry must satisfy `SUM(Dr) = SUM(Cr)` in transaction **and** base currency.

**TEAL must include (Phase 1).** GL derived from posted `accounting.journal_lines` (spec §5). View
`accounting.general_ledger` + balance queries. Posting function enforcing spec §6 invariants 1–4.
**Defer (Later):** maintained `accounting.account_balances` per-account-per-period as a performance
optimization only — never a substitute for the journal.

**Canonical tables:** `accounting.journal_entries`, `accounting.journal_lines`,
`accounting.account_balances` (later), view `accounting.general_ledger`.

---

## 2. Chart of Accounts (CoA)

**Purpose.** The structured list of accounts that classifies all transactions into asset, liability,
equity, income, expense. The backbone of every report's grouping and the normal-balance rules.

**Standard entities.** Account types (with category + normal balance), accounts (code, name, type,
parent for hierarchy/roll-up), header vs detail/posting accounts, linked/control accounts (AR, AP,
bank, retained earnings, tax collected/paid, FX gain/loss). MYOB groups by number ranges
(1-xxxx asset, 2-xxxx liability, 3-xxxx equity, 4-xxxx income, 6-xxxx expense, etc.).

**Workflows & states.** Create/edit/deactivate account; cannot delete an account that has postings
(deactivate instead). Designate "linked accounts" so document types know where to post.

**Postings.** None directly; the CoA defines the *targets* of postings and enforces normal balance
direction per `account_types.normal_balance`.

**TEAL must include (Phase 1).** `accounting.account_types` (seeded, category + normal_balance per
spec §5), `accounting.accounts` with `parent_account_id` for hierarchy, `is_bank_account`,
`is_active` (deactivate, never hard-delete posted accounts). Control accounts wired via the
linked-account ids on customers/suppliers/tax codes. **Defer (Phase 2):** rich account-grouping
report layouts, multiple chart templates per industry.

**Canonical tables:** `accounting.account_types`, `accounting.accounts`.

---

## 3. Sales / Accounts Receivable (AR)

**Purpose.** Track what customers owe and the income earned. Drives the AR control account and aging.

**Standard entities.** Customers, quotes, sales orders, invoices, customer payments/receipts, credit
notes, AR control account, income accounts, tax collected.

**Workflows & states.** Quote → Order → Invoice → Payment is the canonical AR funnel (MYOB calls
these *Quote / Order / Invoice*). Invoice states: **draft → open → partial → paid → void**.

**Postings (invoice on issue):**
- Dr Accounts Receivable (control) — `total`
- Cr Income account(s) — per line `line_total`
- Cr Tax Collected (VAT output) — `tax_total`

**Postings (customer receipt):** see §17 Receipts.

**TEAL must include (Phase 1).** Invoices + lines posting the above entry with `source = 'invoice'`.
AR control via `customers.receivable_account_id`. Aging from open invoices.
**Defer (Phase 2):** quotes, sales orders (non-posting stages, §10/§11).

**Canonical tables:** `accounting.invoices`, `accounting.invoice_lines`, `accounting.customers`.

---

## 4. Purchases / Accounts Payable (AP)

**Purpose.** Track what the business owes suppliers and the expenses/assets acquired.

**Standard entities.** Suppliers, purchase orders, bills, supplier payments, supplier (debit) notes,
AP control account, expense/asset accounts, tax paid.

**Workflows & states.** Purchase Order → Bill → Payment. Bill states mirror invoices:
**draft → open → partial → paid → void**.

**Postings (bill on entry):**
- Dr Expense / Asset / Inventory account(s) — per line
- Dr Tax Paid (VAT input) — `tax_total`
- Cr Accounts Payable (control) — `total`

**Postings (supplier payment):** see §16 Payments.

**TEAL must include (Phase 1).** Bills + lines posting the above with `source = 'bill'`. AP control
via `suppliers.payable_account_id`. **Defer (Phase 2):** purchase orders (§12).

**Canonical tables:** `accounting.bills`, `accounting.bill_lines`, `accounting.suppliers`.

---

## 5. Banking

**Purpose.** Record money in/out through bank and cash accounts; surface real cash position.

**Standard entities.** Bank accounts (linked to a GL account), spend money / receive money
transactions, transfers between accounts, bank feeds (Xero/MYOB live feeds), imported statements.

**Workflows & states.** Spend Money (Dr expense/AP, Cr bank), Receive Money (Dr bank, Cr income/AR),
Transfer Money (Dr bank A, Cr bank B). States: unreconciled → reconciled (see §6).

**Postings (transfer):**
- Dr Destination bank — amount
- Cr Source bank — amount

**TEAL must include (Phase 1).** `accounting.bank_accounts` linking to a GL `account_id`. Spend/
Receive money modeled as payments/receipts or manual journals. **Defer (Phase 2):** account
transfers UI; **Later:** live bank feeds.

**Canonical tables:** `accounting.bank_accounts` (+ payments/receipts via journal entries).

---

## 6. Bank Reconciliation

**Purpose.** Match GL bank-account activity to the bank statement so the ledger balance equals the
real statement balance; the core control against error and fraud.

**Standard entities.** Statement lines, GL bank transactions, reconciliation sessions (statement
date + closing balance), match links, reconciliation reports.

**Workflows & states.** Import/enter statement → match each statement line to a GL transaction (or
create a new one) → confirm when *Unreconciled difference = 0* → lock the reconciliation. Lines:
**unmatched → matched → reconciled**.

**Postings.** Reconciliation itself posts nothing; *new* transactions created during matching post
normally (e.g. bank fees: Dr Bank Charges, Cr Bank). It only flags `cleared/reconciled` state.

**TEAL must include (Phase 2).** A reconciliation table set (sessions + statement lines + match
links) over `bank_accounts`. **Defer to Phase 2** — depends on banking + payments existing first.
**Later:** auto-suggested matches, feed rules.

**Canonical tables:** new `accounting.bank_reconciliations` / `bank_statement_lines` (Phase 2;
not yet in spec §5 — flagged as Open Question).

---

## 7. Customers

**Purpose.** Master records for parties the business sells to; carry credit terms, tax id, currency,
and the AR control linkage.

**Standard entities.** Customer card: code, name, contact, billing/shipping address, currency, tax
registration, default terms, default income account, opening balance.

**Workflows & states.** Create → active → inactive. Opening balance handled via §18.

**Postings.** None on creation. Opening balance posts via `source = 'opening_balance'` (§18).

**TEAL must include (Phase 1).** `accounting.customers` per spec §5, including
`receivable_account_id`, `currency_code`, `tax_reg_no`, `address jsonb`, `is_active`. Platform-level
contacts may also exist in `core.clients`; accounting customers are the module-scoped financial card.

**Canonical tables:** `accounting.customers` (+ `core.clients` at platform level).

---

## 8. Suppliers

**Purpose.** Master records for parties the business buys from; carry terms, tax id, currency, AP
control linkage.

**Standard entities.** Supplier card: code, name, contact, address, currency, tax registration,
default terms, default expense account, opening balance.

**Workflows & states.** Create → active → inactive.

**Postings.** None on creation; opening balance via §18.

**TEAL must include (Phase 1).** `accounting.suppliers` per spec §5 with `payable_account_id`,
`currency_code`, `tax_reg_no`, `address jsonb`, `is_active`.

**Canonical tables:** `accounting.suppliers` (+ `core.clients`).

---

## 9. Items / Inventory

**Purpose.** Reusable product/service records that speed up invoicing and (for stock items) track
quantity-on-hand and cost of goods sold.

**Standard entities.** Items (service vs inventoried), unit price, income/expense/asset linked
accounts, quantity on hand, average/standard cost, locations. MYOB items carry "I sell / I buy /
I inventory" flags and three linked accounts.

**Workflows & states.** Buy item (increases on-hand, Dr Inventory asset), sell item (Dr COGS, Cr
Inventory; plus the sale postings), adjust inventory, build/auto-build (assemblies).

**Postings (sale of an inventoried item) — in addition to the invoice posting (§3):**
- Dr Cost of Goods Sold — item cost
- Cr Inventory Asset — item cost

**Postings (inventory adjustment):** Dr/Cr Inventory Asset vs an adjustment/variance account.

**TEAL must include:** **Defer.** Phase 1 invoice/bill lines post directly to GL accounts (no item
master). **Phase 2:** a service-item catalog (price + default account) for convenience. **Later:**
true perpetual inventory (on-hand, costing, COGS automation, assemblies) — significant subsystem.

**Canonical tables:** none in spec §5 yet; new `accounting.items` (+ inventory ledger) when built.

---

## 10. Jobs / Projects

**Purpose.** Dimensional tagging of transactions to a job/project/cost-centre for profitability
reporting, independent of the account structure. Highly relevant to TEAL (survey/claims/cargo work).

**Standard entities.** Jobs (code, name, customer, budget, header/detail), job line allocations on
transactions, job profit reports. MYOB supports header/detail jobs and budgets.

**Workflows & states.** Open → in-progress → closed. Each posting line may carry a `job_id`.

**Postings.** No separate posting; jobs are a *dimension* on existing journal lines used for
filtered reporting (Job P&L).

**TEAL must include:** **Defer (Phase 2/Later).** Add an optional `job_id` dimension to
`accounting.journal_lines` (and document/invoice lines) plus a `jobs` table. Architecturally
important because future modules (survey, claims) map their work to jobs — but the *accounting*
module should expose it as a generic dimension, not embed module logic (spec §1, §10).

**Canonical tables:** new `accounting.jobs` + nullable `job_id` on `journal_lines` (Phase 2).

---

## 11. Quotes

**Purpose.** A non-binding price offer to a customer; no financial effect until converted.

**Standard entities.** Quote header + lines (same shape as an invoice), expiry/valid-until, status.

**Workflows & states.** **draft → sent → accepted/declined → converted (to order/invoice) →
expired.** Convert copies lines into an invoice.

**Postings.** **None** — quotes never touch the GL.

**TEAL must include:** **Defer (Phase 2).** Implement as a non-posting document sharing the
invoice-line shape; conversion creates a real `accounting.invoices` row that then posts.

**Canonical tables:** new `accounting.quotes` / `quote_lines` (Phase 2).

---

## 12. Sales Orders

**Purpose.** A confirmed customer commitment not yet invoiced (goods/services pending delivery);
tracks backorders and deposits.

**Standard entities.** Order header + lines, ordered vs delivered quantity, customer deposits.

**Workflows & states.** **open → partially fulfilled → fulfilled → invoiced → closed.**

**Postings.** No posting for the order itself. A **customer deposit/prepayment** does post:
- Dr Bank — deposit amount
- Cr Customer Deposits (liability) — deposit amount

**TEAL must include:** **Defer (Phase 2/Later).** Non-posting order document; deposit handling
later. Lower priority for TEAL's service-oriented businesses than quotes.

**Canonical tables:** new `accounting.sales_orders` (Phase 2+).

---

## 13. Purchase Orders

**Purpose.** A commitment to a supplier before the bill arrives; controls committed spend.

**Standard entities.** PO header + lines, ordered vs received quantity, links to resulting bill.

**Workflows & states.** **open → partially received → received → billed → closed.**

**Postings.** **None** until converted to a bill (which posts per §4). Some systems accrue goods-
received-not-invoiced (Dr Inventory/GRNI clearing, Cr GRNI liability) — advanced, deferred.

**TEAL must include:** **Defer (Phase 2/Later).** Non-posting PO document converting to a bill.

**Canonical tables:** new `accounting.purchase_orders` (Phase 2+).

---

## 14. Invoices

**Purpose.** The legal demand for payment that records earned income and creates the receivable.

**Standard entities.** Invoice header (customer, dates, currency, fx_rate, totals, status,
`journal_entry_id`) + lines (account, qty, unit price, tax code, line total).

**Workflows & states.** **draft → open → partial → paid → void.** Void via reversing entry (spec §6
invariant 2), never edit a posted invoice.

**Postings (on issue):**
- Dr Accounts Receivable — `total`
- Cr Income account(s) — line totals (ex-tax)
- Cr Tax Collected — `tax_total`

Base-currency equivalents stored on each line (`base_debit`/`base_credit`) using `fx_rate`.

**TEAL must include (Phase 1).** Full invoice posting with `source = 'invoice'`,
`source_id = invoices.id`. Status maintained as receipts are applied.

**Canonical tables:** `accounting.invoices`, `accounting.invoice_lines`, `journal_entries`,
`journal_lines`.

---

## 15. Bills

**Purpose.** A supplier's demand for payment that records expense/asset and creates the payable.

**Standard entities.** Bill header (supplier, dates, currency, fx_rate, totals, status,
`journal_entry_id`) + lines.

**Workflows & states.** **draft → open → partial → paid → void.**

**Postings (on entry):**
- Dr Expense / Asset account(s) — line totals (ex-tax)
- Dr Tax Paid — `tax_total`
- Cr Accounts Payable — `total`

**TEAL must include (Phase 1).** Full bill posting with `source = 'bill'`,
`source_id = bills.id`.

**Canonical tables:** `accounting.bills`, `accounting.bill_lines`, `journal_entries`,
`journal_lines`.

---

## 16. Credit Notes (and Supplier Debit Notes)

**Purpose.** Reverse or reduce a previously issued invoice (customer credit) or bill (supplier
debit), e.g. returns, allowances, overcharges.

**Standard entities.** Credit note header + lines (mirror of invoice/bill), application links to the
original or to future documents, refund vs apply-as-credit.

**Workflows & states.** **draft → open → applied/refunded → closed.**

**Postings (customer credit note — reverses invoice):**
- Dr Income (or Sales Returns) — line totals
- Dr Tax Collected — tax
- Cr Accounts Receivable — `total`

**Postings (supplier debit note — reverses bill):**
- Dr Accounts Payable — `total`
- Cr Expense/Asset — line totals
- Cr Tax Paid — tax

**TEAL must include:** **Phase 1 (recommended)** at least customer credit notes, since AR is Phase 1
and refunds are routine. Can be modeled as a negative/credit invoice variant posting the reversal.
**Defer to Phase 2:** supplier debit notes if AP credits are rare initially.

**Canonical tables:** reuse `accounting.invoices`/`bills` with a credit-note flag, or new
`accounting.credit_notes` (decision flagged as Open Question).

---

## 17. Payments (Money Out) & 17b. Receipts (Money In)

**Purpose.** Settle payables (payments) and receivables (receipts), and record direct spend/receive
money not tied to a document.

**Standard entities.** Payment/receipt header (bank account, date, currency, fx_rate, amount),
allocation lines linking to specific bills/invoices, over/under-payment handling.

**Workflows & states.** **draft → posted → void.** Allocation: full, partial (sets document to
`partial`), or on-account (unallocated credit).

**Postings (customer receipt against invoice):**
- Dr Bank — amount received
- Cr Accounts Receivable — amount applied

**Postings (supplier payment against bill):**
- Dr Accounts Payable — amount applied
- Cr Bank — amount paid

**FX on settlement.** If `fx_rate` at payment differs from invoice/bill rate, post the difference to
**Realized FX Gain/Loss** (Dr loss / Cr gain) so AR/AP clears exactly (spec §8).

**TEAL must include (Phase 1).** Payments (`source = 'payment'`) and receipts (`source = 'receipt'`)
posting the above, updating `amount_paid` and `status` on the related bill/invoice, with realized FX
handling. **Defer (Phase 2):** batch payments, payment allocation across many documents at once.

**Canonical tables:** `accounting.journal_entries` (source payment/receipt) + a payment/allocation
table (new `accounting.payments` + `payment_allocations`, flagged as Open Question; minimally the
journal entry carries the effect).

---

## 18. Journal Entries (Manual)

**Purpose.** Direct GL adjustments not arising from a document — accruals, depreciation, corrections,
reclassifications.

**Standard entities.** Journal header + balanced Dr/Cr lines. MYOB calls this *Record Journal Entry*.

**Workflows & states.** **draft → posted → void.** Posted is immutable; reverse to correct
(spec §6 invariant 2). "Reverse" creates a mirror entry.

**Postings.** User-defined balanced lines; the posting function enforces `SUM(Dr)=SUM(Cr)` in both
currencies and rejects closed/locked periods (spec §6 invariants 1, 3).

**TEAL must include (Phase 1).** Manual journals with `source = 'manual'`, plus a reversing-entry
action. This is the primitive every other workflow builds on.

**Canonical tables:** `accounting.journal_entries`, `accounting.journal_lines`.

---

## 19. Opening Balances

**Purpose.** Establish starting balances when migrating onto the system: GL account balances, and
per-customer/supplier open items.

**Standard entities.** Opening-balance journal (against an Opening Balance Equity / suspense
account), open AR/AP item list, conversion/migration date.

**Workflows & states.** Entered once at go-live; account opening balances must net to zero against
Opening Balance Equity.

**Postings (account opening balances):**
- Dr each asset/expense account with a debit balance
- Cr each liability/equity/income account with a credit balance
- Balancing line to **Opening Balance Equity** (suspense)

Customer/supplier opening balances post Dr AR / Cr Opening Balance Equity (and the reverse for AP),
preserving aging by original invoice date.

**TEAL must include (Phase 1).** Opening balances via `source = 'opening_balance'`. Critical for
migrating the Taylor group companies off existing systems (spec context). Imports must be staged +
validated (spec §10).

**Canonical tables:** `accounting.journal_entries` (source opening_balance), via
`accounting.import_batches`/`import_staging_rows` for bulk entry.

---

## 20. Recurring Transactions

**Purpose.** Templates that auto-generate periodic invoices, bills, or journals (rent, subscriptions,
depreciation).

**Standard entities.** Recurring template (frequency, next-run date, end condition) referencing a
document template; generated-document log.

**Workflows & states.** **active → due → generated (draft or auto-post) → next scheduled → ended.**

**Postings.** None by the template; each *generated* document posts per its type (§14/§15/§18).

**TEAL must include:** **Defer (Phase 2).** Build the document types first; add a recurring scheduler
that clones templates into draft documents for review. **Later:** auto-post option.

**Canonical tables:** new `accounting.recurring_templates` (Phase 2).

---

## 21. Accounting Periods

**Purpose.** Divide the fiscal year into reporting/control windows; the unit of locking and
period-based reporting. T&T fiscal-year considerations apply (spec §9).

**Standard entities.** Periods (fiscal_year, period_no, name, start/end, status), fiscal-year
definition (driven by `core.companies.fiscal_year_start_month`).

**Workflows & states.** Period status **open → closed → locked.** Year-end roll closes income/expense
to Retained Earnings.

**Postings (year-end close).** Optional closing entries:
- Dr Income accounts / Cr Income Summary; Dr Income Summary / Cr Expense accounts
- Net to **Retained Earnings** (Dr or Cr depending on profit/loss)

Many modern systems compute retained earnings dynamically rather than posting hard closing
entries — TEAL should derive it and treat hard close as optional.

**TEAL must include (Phase 1).** `accounting.accounting_periods` with `fiscal_year`, `period_no`,
`status`. Period resolution on every journal entry (`period_id`). **Defer (Phase 2):** automated
year-end close wizard.

**Canonical tables:** `accounting.accounting_periods`.

---

## 22. Period Locking

**Purpose.** Prevent posting/editing into finalized periods to preserve reported figures and satisfy
audit/tax requirements.

**Standard entities.** Period status (`open/closed/locked`), lock date, permission to post to a
locked period (usually Admin-only override).

**Workflows & states.** Lock a period → posting attempts into it are rejected. "Closed" may allow
adjustments with permission; "locked" is hard.

**Postings.** None; this is an *enforcement* concern that *blocks* postings (spec §6 invariant 3).

**TEAL must include (Phase 1).** Posting function rejects entries whose `period_id` is `closed` or
`locked`. Override gated by a data-driven permission (spec §7). **Defer (Phase 2):** company-wide
lock-date convenience setting separate from per-period status.

**Canonical tables:** `accounting.accounting_periods.status` (enforced in the posting function).

---

## 23. Multi-Currency

**Purpose.** Transact in currencies other than the company base currency and report consolidated in
base currency. Essential for TEAL (USD-heavy maritime/freight, TTD base).

**Standard entities.** Currencies, exchange rates (dated), per-account/customer/supplier currency,
realized & unrealized FX gain/loss accounts.

**Workflows & states.** Each transaction stores `currency_code`, `fx_rate`, and base-currency
equivalents at transaction time (spec §8 — never re-derive historically). Period-end revaluation of
open foreign-currency balances.

**Postings (realized FX on settlement).** See §17. **Postings (unrealized FX revaluation):**
- Dr/Cr the foreign-currency control account vs **Unrealized FX Gain/Loss**, posted with
  `source = 'fx_revaluation'` (spec §8); typically reversed at the start of the next period.

**TEAL must include (Phase 1).** Currency + fx_rate + `base_*` columns are already mandated on
journal lines, invoices, bills (spec §4, §5, §8). Realized FX on settlement = Phase 1.
**Defer (Phase 2):** unrealized FX revaluation run.

**Canonical tables:** `accounting.currencies`, `accounting.exchange_rates`, `base_*` columns
throughout.

---

## 24. Payroll

**Purpose.** Calculate wages, statutory deductions, and post the resulting liabilities/expenses.
T&T context: PAYE, NIS, Health Surcharge (spec §9).

**Standard entities.** Employees, pay items (earnings/deductions), pay runs, payslips, statutory
tax tables, leave accruals.

**Workflows & states.** Pay run: **draft → calculated → approved → posted → paid.**

**Postings (per pay run):**
- Dr Wages/Salaries Expense (gross) and Dr Employer NIS Expense
- Cr Net Pay / Bank — net to employees
- Cr PAYE Payable, Cr NIS Payable, Cr Health Surcharge Payable — statutory deductions

**TEAL must include:** **Defer (Later).** Payroll is a large, jurisdiction-heavy subsystem. Phase 1/2
records payroll outcomes via manual journals (or an import) to the correct liability/expense
accounts. Full payroll engine is a later module, with **no hard-coded rates** — all via
`accounting.tax_codes`/config (spec §9, §10).

**Canonical tables:** none in Phase 1; statutory liabilities live as GL accounts + `tax_codes`.

---

## 25. Reports (Standard Set)

**Purpose.** Turn the GL into decision and compliance information. **No reports before the ledger
exists** (spec §10).

**Standard set & source:**
- **Trial Balance** — sum of Dr/Cr per account from posted lines; proves the books balance.
- **Profit & Loss (Income Statement)** — income/expense accounts over a period.
- **Balance Sheet** — asset/liability/equity balances as at a date; includes derived Retained
  Earnings + current-year earnings.
- **Cash Flow Statement** — movement in cash accounts (indirect or direct method).
- **General Ledger Detail** — transaction listing per account.
- **AR Aging** — open invoices bucketed (current/30/60/90+).
- **AP Aging** — open bills bucketed.
- **Account Transactions / Journal report**, **Tax/VAT report** (collected vs paid), **Customer/
  Supplier statements**, **Budget vs Actual** (later).

**Workflows & states.** Parameterized (date range, period, company, currency) → rendered → optionally
exported and archived.

**TEAL must include (Phase 1).** Trial Balance, P&L, Balance Sheet, GL detail, AR & AP aging, Tax
report — all as queries over posted `journal_lines`. **Phase 2:** Cash Flow, statements, exports
archive. **Later:** Budget vs Actual, custom report builder, dashboards (no dashboards before real
data — spec §10).

**Canonical tables:** derived from `accounting.journal_lines` + `accounts`; `accounting.report_exports`
for archived outputs; `accounting.dashboard_configs` (Phase 2+).

---

## 26. Import / Export

**Purpose.** Bring in legacy/external data (CoA, customers, suppliers, opening balances, transactions,
bank statements) and export data/reports out.

**Standard entities.** Import batch, staged rows (raw + mapped + status + errors), field mappings,
import templates; export files/formats (CSV, PDF, Excel; QuickBooks IIF, MYOB .txt as references).

**Workflows & states.** **uploaded → validating → validated → committed** (or **failed**). Imports
are **always staged + validated** before commit (spec §10).

**Postings.** Transactional imports (opening balances, journals) post on commit with
`source = 'import'`; master-data imports post nothing.

**TEAL must include (Phase 1).** `accounting.import_batches` + `accounting.import_staging_rows` with
the staged/validated lifecycle, used for go-live migration. Export of reports.
**Defer (Phase 2):** broader ongoing import connectors, scheduled exports.

**Canonical tables:** `accounting.import_batches`, `accounting.import_staging_rows`,
`accounting.report_exports`.

---

## 27. Audit Trail

**Purpose.** Immutable record of who changed what and when; required for accounting integrity and
T&T statutory/audit needs.

**Standard entities.** Audit log entries (user, action, entity, before/after, timestamp, IP).
Reinforced by the immutability rule: posted entries are never edited, only reversed (spec §6).

**Workflows & states.** Every create/update/delete/post/void on financial entities writes an audit
row. Append-only; never edited.

**Postings.** None.

**TEAL must include (Phase 1).** `core.audit_logs` capturing before/after JSON on all accounting
mutations, plus the structural audit guarantee that posted journals are immutable (reversal-only).

**Canonical tables:** `core.audit_logs`.

---

## 28. User Permissions

**Purpose.** Control who can see and do what, per company; segregation of duties is a core
accounting control.

**Standard entities.** Users, roles, permissions, role-permissions, company memberships. Seed roles:
Super Admin, Company Admin, Accountant/Admin User, Office User, View-only User (spec §7).

**Workflows & states.** Invite → membership `invited → active → suspended`. Permissions are
**data-driven**, never hard-coded (spec §7, §10).

**Postings.** None.

**TEAL must include (Phase 1).** Full RBAC via `core.roles`, `core.permissions`,
`core.role_permissions`, `core.company_memberships`, enforced by RLS using `core.user_companies()`
and `core.has_permission()` (spec §7). Permission-gated actions: posting, period override, void,
import commit, report access.

**Canonical tables:** `core.users`, `core.roles`, `core.permissions`, `core.role_permissions`,
`core.company_memberships`.

---

## 29. Summary Table — Phase Mapping

| # | Area | Phase | Canonical table(s) |
|---|------|-------|--------------------|
| 1 | General Ledger | **P1** | `journal_entries`, `journal_lines`, view `general_ledger`; `account_balances` (Later) |
| 2 | Chart of Accounts | **P1** | `account_types`, `accounts` |
| 3 | Sales / AR | **P1** | `invoices`, `invoice_lines`, `customers` |
| 4 | Purchases / AP | **P1** | `bills`, `bill_lines`, `suppliers` |
| 5 | Banking | **P1** core / **P2** transfers; feeds Later | `bank_accounts` |
| 6 | Bank Reconciliation | **P2** | new `bank_reconciliations`, `bank_statement_lines` |
| 7 | Customers | **P1** | `customers` (+ `core.clients`) |
| 8 | Suppliers | **P1** | `suppliers` (+ `core.clients`) |
| 9 | Items / Inventory | **P2** items / **Later** inventory | new `items` (+ inventory ledger) |
| 10 | Jobs / Projects | **P2** | new `jobs` + `job_id` on `journal_lines` |
| 11 | Quotes | **P2** | new `quotes`, `quote_lines` |
| 12 | Sales Orders | **P2 / Later** | new `sales_orders` |
| 13 | Purchase Orders | **P2 / Later** | new `purchase_orders` |
| 14 | Invoices | **P1** | `invoices`, `invoice_lines` |
| 15 | Bills | **P1** | `bills`, `bill_lines` |
| 16 | Credit Notes | **P1** (customer) / **P2** (supplier) | `invoices`/`bills` variant or new `credit_notes` |
| 17 | Payments & Receipts | **P1** | `journal_entries` (payment/receipt) + new `payments`/`payment_allocations` |
| 18 | Journal Entries (manual) | **P1** | `journal_entries`, `journal_lines` |
| 19 | Opening Balances | **P1** | `journal_entries` (opening_balance) via `import_batches` |
| 20 | Recurring Transactions | **P2** | new `recurring_templates` |
| 21 | Accounting Periods | **P1** | `accounting_periods` |
| 22 | Period Locking | **P1** | `accounting_periods.status` (posting fn) |
| 23 | Multi-Currency | **P1** core / **P2** revaluation | `currencies`, `exchange_rates`, `base_*` cols |
| 24 | Payroll | **Later** | none P1; GL accounts + `tax_codes` |
| 25 | Reports | **P1** core set / **P2** cash flow+stmts / **Later** budgets | derived from `journal_lines`; `report_exports`, `dashboard_configs` |
| 26 | Import / Export | **P1** | `import_batches`, `import_staging_rows`, `report_exports` |
| 27 | Audit Trail | **P1** | `core.audit_logs` |
| 28 | User Permissions | **P1** | `core.roles`, `permissions`, `role_permissions`, `company_memberships` |

**Phase 1 (ledger-complete core):** GL, CoA, AR (customers/invoices/receipts/customer credit notes),
AP (suppliers/bills/payments), banking core, manual journals, opening balances, periods + locking,
multi-currency core (incl. realized FX), core reports, import/export, audit trail, RBAC.
**Phase 2:** bank reconciliation, jobs dimension, quotes, service items, recurring transactions, FX
revaluation, supplier debit notes, cash-flow & statements, account transfers.
**Later:** perpetual inventory, sales/purchase orders, payroll engine, bank feeds, budgets,
dashboards, `account_balances` optimization.

---

## Open Questions

1. **Payments modeling:** does TEAL add explicit `accounting.payments` + `payment_allocations`
   tables (cleaner allocation, partial settlement, FX), or carry settlement purely through
   `journal_entries` with `source = 'payment'/'receipt'`? Spec §5 does not yet define these tables.
2. **Credit notes:** reuse `invoices`/`bills` with a credit-note flag and negative effect, or
   introduce dedicated `accounting.credit_notes`? Affects aging and reporting joins.
3. **Bank reconciliation tables** are not in spec §5 — names/shape to be ratified
   (`bank_reconciliations`, `bank_statement_lines`).
4. **Jobs dimension:** confirm `job_id` is added as a generic nullable dimension on `journal_lines`
   (and document lines) so future modules tag work without embedding module logic (spec §1).
5. **Retained earnings / year-end:** derive dynamically vs post hard closing entries — confirm the
   default (recommendation: derive; hard close optional).
6. **Items in Phase 2:** service-item catalog scope (price + default account only) vs anything more.

## Decisions Locked

- Every financially-effective workflow posts a **balanced** `accounting.journal_entry` via
  `source`/`source_id` (spec §6 invariant 4). The GL is **derived from posted lines**, never a
  separate source of truth (spec §5).
- **Posted entries are immutable; corrections are reversals**, never edits (spec §6 invariant 2).
  Voids = reversing entries.
- **No posting into `closed`/`locked` periods** (spec §6 invariant 3), enforced in the posting
  function; override is a data-driven permission (spec §7).
- **Multi-currency** stores `fx_rate` + base equivalents at transaction time and never re-derives
  historically (spec §8); realized FX on settlement is Phase 1, revaluation is Phase 2.
- **No hard-coded tax rates or permissions; imports always staged + validated; no reports/dashboards
  before real ledger data** (spec §10).
- **Phase 1 = a complete, balanced double-entry ledger** (GL, CoA, AR, AP, banking, journals, opening
  balances, periods, multi-currency core, core reports, import, audit, RBAC). All order/quote/PO,
  reconciliation, jobs, inventory, recurring, payroll, and dashboard features are Phase 2 or Later.

---

**Cross-references:** `_ARCHITECTURE-SPEC.md` (authoritative schema, invariants, RBAC, currency).
Anticipated sibling docs: `accounting-engine.md` (posting function, enum decisions), `rbac-model.md`,
`multi-currency.md`, `import-pipeline.md`, `reporting.md`.
