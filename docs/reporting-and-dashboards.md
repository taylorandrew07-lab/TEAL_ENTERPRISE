# Reporting & Dashboards

**TEAL Enterprise — Accounting Module**
Owning agent: Dashboard / Reporting Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This document specifies the reporting and dashboard layer of the Accounting module: the canonical financial report set, how each report is *computed* from posted journal data, the report-definition and export architecture (`accounting.report_exports`), the dashboard configuration model (`accounting.dashboard_configs`), multi-currency presentation, performance strategy, and the governance checks that keep every report self-reconciling. It conforms to `_ARCHITECTURE-SPEC.md` and builds directly on the derived General Ledger and balance queries defined in `accounting-engine.md`.

This document is **read-only over the ledger**. It defines no new write paths into accounting data and introduces no money-bearing tables. Everything here consumes `accounting.journal_lines` / `accounting.general_ledger` and the derived balances; it never originates an entry.

---

## 1. The one principle this layer must not violate

**Reports and dashboards are built only on real ledger data derived from posted journal entries.** This is not a stylistic preference; it is invariant, drawn from `_ARCHITECTURE-SPEC.md` §10 ("No reports before the ledger exists. No dashboards before real accounting data exists.") and §5 (the GL is derived from `status = 'posted'` lines).

Concretely:

- **No fabricated or demo data.** A report or widget with no underlying posted entries renders an honest **empty state**, never sample numbers, never a placeholder chart. A dashboard for a company with an empty ledger shows "No posted entries yet," not a fake cash curve.
- **Posted only.** Every figure traces to `accounting.journal_entries.status = 'posted'`. Drafts and voided entries are excluded by construction because every query reads through `accounting.general_ledger` (which already filters `status = 'posted'`, per `accounting-engine.md` §7.1) or applies the same predicate inline.
- **Derived, never authored.** Reports compute from the journal at read time (or from a reconcilable rollup, §8). No report stores its own copy of a balance as truth; the only persisted report artefacts are *exports* — frozen point-in-time renderings with their parameters recorded (§5).
- **Base currency by default.** Every monetary figure presents in the company's base currency (`core.companies.base_currency_code`, default TTD) using the stored `base_debit` / `base_credit`, which were fixed at transaction time and never re-derived (`_ARCHITECTURE-SPEC.md` §8). Original transaction currency is an optional secondary presentation (§7).

If the ledger is empty, this layer produces nothing but empty states. That is the correct behaviour.

---

## 2. The report set and the single computation primitive

### 2.1 One signed-balance rule drives every statement

The engine doc (`accounting-engine.md` §2.1) establishes the rule this whole layer reuses:

```
signed_base_movement(line) =
    base_debit  − base_credit     when the account's normal_balance = 'debit'
    base_credit − base_debit      when the account's normal_balance = 'credit'
```

A positive signed balance always means "more of what this account normally holds." `accounting.general_ledger` already exposes this as the `signed_base_movement` column. **There is no per-report sign logic** — Trial Balance, P&L, and Balance Sheet are all aggregations of the same signed base movement, sliced by `account_category` and bounded by date. This is why the reports cannot disagree with each other: they are the same arithmetic over the same rows.

### 2.2 The canonical Phase 1 report set

| Report | Bounds | Reads | Reconciles to |
|--------|--------|-------|---------------|
| Trial Balance | as-of date *or* period range | balances per account | debits = credits |
| Profit & Loss (Income Statement) | period range (flow) | income + expense categories | net profit feeds Balance Sheet equity |
| Balance Sheet | as-of date (stock) | asset/liability/equity + retained P&L | assets = liabilities + equity |
| Cash Flow | period range (flow) | bank/cash accounts + indirect derivation | Δ cash = closing − opening bank balances |
| General Ledger detail | period range, optional account filter | every posted line | sum of movements = TB |
| Account transaction listing | period range, one account, running balance | one account's lines | closing balance = TB line |
| AR Aging | as-of date | open invoices / AR sub-ledger | total = AR control account balance |
| AP Aging | as-of date | open bills / AP sub-ledger | total = AP control account balance |
| VAT / Tax report | period range, tax type | tax-coded lines | net VAT = tax control account movement |

Each is specified in §3. Every SQL sketch below is parameterised by `company_id` (`$1`) and, depending on whether the report is a *flow* (covers a range) or a *stock* (a point in time), by a date range (`$2`, `$3`) or an as-of date (`$2`). All amounts are base currency unless explicitly dual-presented.

---

## 3. The reports, computed from the ledger

### 3.1 Trial Balance — the proof-of-balance report

**Definition.** Every account with activity, shown on its natural side (debit-balance accounts in the debit column, credit-balance accounts in the credit column), such that total debits equal total credits. It is the integrity backbone: if it does not balance, the ledger is corrupt.

**Source approach.** Sum stored `base_debit` / `base_credit` per account over posted entries up to the as-of date (cumulative TB) or within a period range (movement TB), then split the net into the correct column. This is the §7.4 query in `accounting-engine.md`, restated here as the canonical form for an **as-of cumulative** trial balance:

```sql
-- Trial Balance as of $2, company $1, base currency
with bal as (
    select a.id, a.code, a.name, at.category, at.normal_balance,
           coalesce(sum(jl.base_debit),  0) as d,
           coalesce(sum(jl.base_credit), 0) as c
    from accounting.accounts a
    join accounting.account_types at on at.id = a.account_type_id
    left join accounting.journal_lines  jl on jl.account_id = a.id
    left join accounting.journal_entries je
           on je.id = jl.journal_entry_id
          and je.status = 'posted'
          and je.entry_date <= $2          -- as-of (omit lower bound for cumulative)
    where a.company_id = $1
    group by a.id, a.code, a.name, at.category, at.normal_balance
)
select code, name, category,
       case when (d - c) > 0 then (d - c) else 0 end as debit_balance,
       case when (c - d) > 0 then (c - d) else 0 end as credit_balance
from bal
where d <> 0 or c <> 0
order by code;
-- Governance invariant: SUM(debit_balance) = SUM(credit_balance) exactly.
```

**Parameters.** `company_id`; as-of date *or* `(date_from, date_to)`; currency = base (default) with an optional original-currency variant (§7). A "period" parameter resolves to the period's `[start_date, end_date]` via `accounting.accounting_periods`.

**Presentation.** Two money columns in base currency, a total row asserting equality, optional comparative column (§5.4).

### 3.2 Profit & Loss (Income Statement) — a flow report

**Definition.** Revenue less expenses over a period, yielding net profit. Income and expense categories only; balance-sheet categories are excluded. It is a *flow* report: it always covers a date range, never an as-of point.

**Source approach.** Aggregate `signed_base_movement` for `income` and `expense` accounts within the range. Because income has a `credit` normal balance, its signed movement is naturally positive for revenue earned; expense (debit normal balance) is positive for cost incurred. Net profit = income − expense.

```sql
-- Profit & Loss for [$2, $3], company $1, base currency
select gl.account_category,
       gl.account_id, gl.account_code, gl.account_name,
       sum(gl.signed_base_movement) as amount_base
from accounting.general_ledger gl
where gl.company_id = $1
  and gl.account_category in ('income','expense')
  and gl.entry_date between $2 and $3
group by gl.account_category, gl.account_id, gl.account_code, gl.account_name
order by gl.account_category desc, gl.account_code;   -- income block, then expense block

-- Roll-up:
--   total_income  = SUM(amount_base) where category = 'income'
--   total_expense = SUM(amount_base) where category = 'expense'
--   net_profit    = total_income − total_expense
```

For a structured statement (Revenue → Cost of Sales → Gross Profit → Operating Expenses → Net Profit) the same query groups by the account hierarchy (`accounting.account_tree`, `accounting-engine.md` §2.3) and by `account_type.key` (`cost_of_sales`, `other_income`, etc.).

**Parameters.** `company_id`; `(date_from, date_to)` or a period/fiscal-year selection; base currency. Comparatives: same query over the prior period (§5.4).

**Presentation.** Grouped income and expense sections, subtotals, gross and net profit lines, all base currency.

### 3.3 Balance Sheet — a stock report

**Definition.** Financial position at a point in time: assets = liabilities + equity, where equity includes accumulated retained earnings (all prior-period net profit) plus the current-period net profit not yet closed to retained earnings. It is a *stock* report (as-of a single date).

**Source approach.** Cumulative `signed_base_movement` from the beginning of the ledger to the as-of date, for `asset`, `liability`, `equity`. The accounting identity from `accounting-engine.md` §2.1 is what makes it balance:

```
Assets = Liabilities + Equity + (Income − Expenses)
```

So the Balance Sheet must fold the **net of income and expenses up to the as-of date** into equity (as "Current Earnings" / retained earnings), otherwise it will not balance.

```sql
-- Balance Sheet as of $2, company $1, base currency
with cum as (
    select gl.account_category, gl.account_id, gl.account_code, gl.account_name,
           sum(gl.signed_base_movement) as bal_base
    from accounting.general_ledger gl
    where gl.company_id = $1
      and gl.entry_date <= $2
    group by gl.account_category, gl.account_id, gl.account_code, gl.account_name
)
select
    (select coalesce(sum(bal_base),0) from cum where account_category = 'asset')      as total_assets,
    (select coalesce(sum(bal_base),0) from cum where account_category = 'liability')  as total_liabilities,
    (select coalesce(sum(bal_base),0) from cum where account_category = 'equity')     as equity_accounts,
    -- net profit-to-date folded into equity (income − expense)
    (select coalesce(sum(bal_base),0) from cum where account_category = 'income')
      - (select coalesce(sum(bal_base),0) from cum where account_category = 'expense') as current_earnings;

-- Governance invariant:
--   total_assets = total_liabilities + equity_accounts + current_earnings
```

The detailed statement returns the `cum` rows for asset/liability/equity grouped by the account hierarchy, plus a synthetic "Current Year Earnings" equity line equal to `current_earnings`. Period-close (when implemented) moves `current_earnings` into a retained-earnings account via a posted closing entry; until then it is computed live so the sheet always balances.

**Parameters.** `company_id`; as-of date (or period end); base currency; comparative as-of a prior date.

**Presentation.** Asset section; liability + equity section (including current earnings); a balance-check line that must read zero.

### 3.4 Cash Flow — indirect method (note)

**Definition.** The change in cash and cash-equivalent balances over a period, reconciled from net profit through changes in working capital and non-cash items.

**Method note.** Phase 1 uses the **indirect method** derived from the ledger, because it requires no extra tagging beyond the existing chart and is fully reconstructable from posted entries. The anchor and the reconciliation oracle is the **direct change in bank/cash balances**: the movement in the cash accounts over the period must equal the net of all cash-flow sections. The indirect statement is then built as:

- **Net profit** for the period (the P&L net, §3.2).
- **± changes in working capital**: the period movement (`signed_base_movement`) of receivable, payable, tax, and other current asset/liability accounts (a rise in AR consumes cash; a rise in AP releases cash).
- **± non-cash items**: e.g. depreciation, FX revaluation (entries with `source = 'fx_revaluation'`), identified by account type or source.

```sql
-- Cash anchor: movement in cash/bank accounts over [$2,$3]  (the figure everything must reconcile to)
select coalesce(sum(gl.signed_base_movement), 0) as net_cash_movement
from accounting.general_ledger gl
join accounting.accounts a on a.id = gl.account_id
where gl.company_id = $1
  and a.is_bank_account = true          -- cash & cash-equivalent accounts
  and gl.entry_date between $2 and $3;

-- Working-capital component (example: AR movement) over [$2,$3]
select coalesce(sum(gl.signed_base_movement), 0) as ar_movement
from accounting.general_ledger gl
join accounting.accounts a       on a.id = gl.account_id
join accounting.account_types at on at.id = a.account_type_id
where gl.company_id = $1
  and at.key = 'accounts_receivable'
  and gl.entry_date between $2 and $3;
-- Governance: net_profit + working-capital movements (sign-adjusted) + non-cash items
--             MUST equal net_cash_movement.
```

**Parameters.** `company_id`; `(date_from, date_to)`; base currency. The opening/closing cash positions come from the §3.1 cumulative balance of bank accounts at `date_from − 1` and `date_to`.

**Presentation.** Operating / investing / financing sections (Phase 1 may collapse to operating + a "movements in cash" reconciliation), ending with closing cash = opening cash + net movement, all base currency. The classification of accounts into operating/investing/financing is a configurable mapping on the account or account type (an Open Question).

### 3.5 General Ledger detail

**Definition.** Every posted line, optionally filtered by account, period, source, with full provenance — the auditor's raw view.

**Source approach.** Direct selection from `accounting.general_ledger` (already posted-only). This is intentionally close to the raw view; the report simply applies filters and ordering.

```sql
select gl.entry_date, gl.entry_no, gl.account_code, gl.account_name,
       gl.entry_description, gl.line_description,
       gl.currency_code, gl.debit, gl.credit,         -- original currency
       gl.base_debit, gl.base_credit,                 -- base currency
       gl.source, gl.source_id, gl.posted_at
from accounting.general_ledger gl
where gl.company_id = $1
  and gl.entry_date between $2 and $3
  and ($4::uuid is null or gl.account_id = $4)        -- optional account filter
order by gl.entry_date, gl.entry_no, gl.line_no;
```

**Parameters.** `company_id`; `(date_from, date_to)`; optional `account_id`; optional `source`; base currency with original-currency columns alongside.

**Presentation.** A flat, paginated, provenance-rich table, exportable to CSV/Excel for audit (§5).

### 3.6 Account transaction listing (running balance)

**Definition.** One account's activity over a range with a running base-currency balance — the classic "account statement."

**Source approach.** The §7.2 running-balance query from `accounting-engine.md`:

```sql
select gl.entry_date, gl.entry_no, gl.entry_description, gl.line_description,
       gl.base_debit, gl.base_credit, gl.signed_base_movement,
       sum(gl.signed_base_movement) over (
           partition by gl.account_id
           order by gl.entry_date, gl.entry_no, gl.line_no
           rows between unbounded preceding and current row
       ) as running_base_balance
from accounting.general_ledger gl
where gl.company_id = $1
  and gl.account_id = $2
  and gl.entry_date between $3 and $4
order by gl.entry_date, gl.entry_no, gl.line_no;
```

An **opening balance** line (cumulative signed movement before `date_from`, via the §3.1 pattern) is prepended so the running balance is correct from the first displayed row.

**Parameters.** `company_id`, `account_id`, `(date_from, date_to)`; base currency.

**Presentation.** Date / reference / debit / credit / running balance. The closing running balance must equal that account's Trial Balance line for the same as-of date (governance, §9).

### 3.7 AR Aging

**Definition.** Outstanding customer balances bucketed by how overdue they are (Current, 1–30, 31–60, 61–90, 90+), as of a date.

**Source approach.** Aging is computed from the AR **sub-ledger** — open `accounting.invoices` (`status in ('open','partial')`) with outstanding amount, bucketed against `due_date` relative to the as-of date. The sub-ledger total must reconcile to the **AR control account** GL balance (§9).

```sql
-- AR Aging as of $2, company $1, base currency
select c.id as customer_id, c.code, c.name,
       sum(case when $2 <= i.due_date
                then i.base_total - i.amount_paid * i.fx_rate else 0 end) as bucket_current,
       sum(case when $2 - i.due_date between 1  and 30
                then i.base_total - i.amount_paid * i.fx_rate else 0 end) as bucket_1_30,
       sum(case when $2 - i.due_date between 31 and 60
                then i.base_total - i.amount_paid * i.fx_rate else 0 end) as bucket_31_60,
       sum(case when $2 - i.due_date between 61 and 90
                then i.base_total - i.amount_paid * i.fx_rate else 0 end) as bucket_61_90,
       sum(case when $2 - i.due_date > 90
                then i.base_total - i.amount_paid * i.fx_rate else 0 end) as bucket_90_plus,
       sum(i.base_total - i.amount_paid * i.fx_rate)                      as total_outstanding
from accounting.invoices i
join accounting.customers c on c.id = i.customer_id
where i.company_id = $1
  and i.status in ('open','partial')
  and i.invoice_date <= $2
group by c.id, c.code, c.name
order by total_outstanding desc;
-- Governance: SUM(total_outstanding) = AR control account balance as of $2 (§9).
```

(The exact outstanding-in-base expression depends on how the AR/AP doc layer stores partial-payment base amounts; the authoritative outstanding figure is the AR control account's open-item base balance. The query above is the sub-ledger sketch; reconciliation to the control account is the check that matters — see Open Questions.)

**Parameters.** `company_id`; as-of date; optional customer; base currency (original currency optional, §7); configurable bucket boundaries.

**Presentation.** Customer rows × aging buckets, totals row, base currency.

### 3.8 AP Aging

**Definition.** The supplier-side mirror of AR Aging: outstanding `accounting.bills` (`status in ('open','partial')`) bucketed by `due_date`.

**Source approach.** Identical shape to §3.7 over `accounting.bills` / `accounting.suppliers`, reconciling to the **AP control account** balance.

```sql
-- AP Aging as of $2, company $1, base currency
select s.id as supplier_id, s.code, s.name,
       sum(case when $2 <= b.due_date then b.base_total - b.amount_paid * b.fx_rate else 0 end) as bucket_current,
       sum(case when $2 - b.due_date between 1  and 30 then b.base_total - b.amount_paid * b.fx_rate else 0 end) as bucket_1_30,
       sum(case when $2 - b.due_date between 31 and 60 then b.base_total - b.amount_paid * b.fx_rate else 0 end) as bucket_31_60,
       sum(case when $2 - b.due_date between 61 and 90 then b.base_total - b.amount_paid * b.fx_rate else 0 end) as bucket_61_90,
       sum(case when $2 - b.due_date > 90              then b.base_total - b.amount_paid * b.fx_rate else 0 end) as bucket_90_plus,
       sum(b.base_total - b.amount_paid * b.fx_rate)                                                              as total_outstanding
from accounting.bills b
join accounting.suppliers s on s.id = b.supplier_id
where b.company_id = $1
  and b.status in ('open','partial')
  and b.bill_date <= $2
group by s.id, s.code, s.name
order by total_outstanding desc;
-- Governance: SUM(total_outstanding) = AP control account balance as of $2 (§9).
```

**Parameters / presentation.** As §3.7, supplier-side.

### 3.9 VAT / tax report

**Definition.** For a period and a tax type (`vat`, `withholding`, `other`), the output tax collected, input tax paid, and the net payable/recoverable — the figures behind a statutory return. No hard-coded rates (`_ARCHITECTURE-SPEC.md` §9): everything flows through `accounting.tax_codes`.

**Source approach.** Sum posted `journal_lines` that carry a `tax_code_id`, joined to `tax_codes` to classify output (collected) vs input (paid). Output VAT lands as credits to the collected account; input VAT as debits to the paid account.

```sql
-- VAT report for [$2,$3], company $1, tax_type = $4, base currency
select tc.id as tax_code_id, tc.code, tc.name, tc.rate,
       -- output (collected): credits on the collected account
       sum(case when jl.account_id = tc.collected_account_id then jl.base_credit - jl.base_debit else 0 end) as output_tax,
       -- input (paid): debits on the paid account
       sum(case when jl.account_id = tc.paid_account_id      then jl.base_debit  - jl.base_credit else 0 end) as input_tax
from accounting.journal_lines  jl
join accounting.journal_entries je on je.id = jl.journal_entry_id and je.status = 'posted'
join accounting.tax_codes      tc on tc.id = jl.tax_code_id
where jl.company_id = $1
  and je.entry_date between $2 and $3
  and tc.tax_type = $4
group by tc.id, tc.code, tc.name, tc.rate
order by tc.code;
-- net_vat_payable = SUM(output_tax) − SUM(input_tax)
-- Governance: net movement must equal the movement of the VAT control account(s) over the period.
```

The taxable-base figures (net of tax) come from the same entries' non-tax lines associated with each document; the report can present taxable amount, tax amount, and gross per tax code.

**Parameters.** `company_id`; `(date_from, date_to)` (the filing period); `tax_type`; base currency.

**Presentation.** Output section, input section, net payable/recoverable, grouped by tax code; designed to map onto T&T VAT return fields without embedding rates.

---

## 4. Reporting architecture

### 4.1 Report definitions

A **report definition** is the metadata that describes a report independent of any one run: its stable `report_key`, its parameter schema, its category, and its required permission. In Phase 1 the report set is fixed (the nine reports of §3), so report definitions live as a typed registry in module code (`src/modules/accounting`) rather than a database table — there is no user-authored report builder yet. Each definition declares:

- `report_key` — stable identifier, e.g. `trial_balance`, `profit_and_loss`, `balance_sheet`, `cash_flow`, `general_ledger`, `account_transactions`, `ar_aging`, `ap_aging`, `vat_report`. This is exactly the `report_key` recorded on `accounting.report_exports`.
- **Parameter schema** — typed parameters with validation (see §4.2).
- **Kind** — `stock` (as-of) or `flow` (range), which determines period semantics (§5).
- **Permission** — the `core.permissions` key required to run/export it (e.g. `report.view`, `report.export`), enforced via `core.has_permission` and RLS on the underlying tables.
- **Renderers** — which output formats it supports (table, CSV, Excel, PDF).

Keeping definitions as code in Phase 1 keeps the surface small and avoids a half-built report-builder; a database-backed `report_definitions` table is a deliberate later step once user-defined reports are in scope.

### 4.2 Parameterization

Every report takes a common parameter envelope plus report-specific parameters:

- **Common:** `company_id` (always; scoped and RLS-checked), `currency_mode` (`base` default | `original`), `as_of` **or** `(date_from, date_to)` depending on kind, optional `comparative` (§5.4).
- **Period resolution:** a `period_id` parameter resolves server-side to `[start_date, end_date]` from `accounting.accounting_periods`; a `fiscal_year` resolves to its constituent periods. Resolving periods server-side (not trusting client dates blindly) keeps "as-of period end" semantics exact and respects closed/locked state (§5).
- **Report-specific:** `account_id` (ledger/transaction listing), `tax_type` (VAT report), aging bucket boundaries (AR/AP aging), `source` filter (GL detail).

Parameters are validated against the definition's schema before any query runs; invalid or out-of-scope parameters (e.g. a `company_id` the user has no membership for) are rejected before touching the ledger.

### 4.3 Export framework and `accounting.report_exports`

A generated output (CSV / PDF / Excel) is a **frozen artefact**: the report computed at a moment, with its exact parameters recorded, stored in Supabase Storage, and indexed by a row in `accounting.report_exports`. This gives a durable, shareable, audit-traceable record of "what the numbers were when we filed/sent this."

`accounting.report_exports` (per `_ARCHITECTURE-SPEC.md` §5):

```sql
create table accounting.report_exports (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references core.companies(id),
    report_key    text not null,                 -- matches a report definition key (§4.1)
    params        jsonb not null,                -- the exact resolved parameters used
    format        text not null check (format in ('csv','pdf','xlsx')),
    file_path     text,                          -- Supabase Storage object path (null until generated)
    status        text not null default 'pending'
                  check (status in ('pending','generating','ready','failed')),
    row_count     bigint,
    error         text,
    base_currency_code char(3) references accounting.currencies(code),
    generated_by  uuid references core.users(id),
    created_at    timestamptz not null default now(),
    completed_at  timestamptz
);

create index on accounting.report_exports (company_id, report_key, created_at desc);
create index on accounting.report_exports (company_id, status);
```

RLS scopes exports to the user's companies exactly as every other tenant table (`_ARCHITECTURE-SPEC.md` §7).

**Phase 1 export flow (basic framework).**

1. **Request.** The user runs a report with resolved parameters and chooses a format. A `report_exports` row is inserted with `status = 'pending'`, the **resolved** `params` (including the company's base currency at generation time in `base_currency_code`), and `generated_by = auth.uid()`.
2. **Generate.** A server routine (Next.js route handler / server action in `app/(accounting)`) runs the report definition's query, marks the row `generating`, renders the chosen format:
   - **CSV** — direct stream of the result rows (GL detail, transaction listings, agings export cleanly).
   - **Excel (xlsx)** — the same rows with typed money columns and a header block (company, report, parameters, base currency).
   - **PDF** — a laid-out statement (Trial Balance, P&L, Balance Sheet) with company header, period, and the governance check line printed on the document.
3. **Store.** The rendered file is uploaded to Supabase Storage under a company-scoped path, e.g. `report-exports/{company_id}/{report_key}/{id}.{format}`. Storage access is governed by the same membership rules; the object is never world-readable.
4. **Finalize.** The row is updated to `status = 'ready'`, `file_path`, `row_count`, `completed_at`. On error, `status = 'failed'` with `error` recorded. Failures never leave a partial file claimed as ready.

The export is **immutable once `ready`** — re-running a report produces a *new* export row, never an overwrite, so a previously sent/filed figure is always retrievable. This mirrors the engine's "posted history never changes" discipline at the reporting boundary.

Phase 1 deliberately keeps this synchronous-or-simple-async and format-minimal (CSV always; PDF/Excel for the core statements). A queue/worker and a richer template engine are later optimizations.

---

## 5. As-of, period, and closed/locked semantics

### 5.1 Stock vs flow

The single most important reporting distinction:

- **Flow reports** (P&L, Cash Flow, GL detail, transaction listing, VAT report) sum movements **within** `[date_from, date_to]`.
- **Stock reports** (Balance Sheet, cumulative Trial Balance, account balance) sum movements **from the beginning of the ledger up to** the as-of date.

`entry_date` (not `posted_at`) drives both. A report "as of 30 June" includes every posted entry with `entry_date <= 2026-06-30`, regardless of when it was physically posted. This is the accounting-correct behaviour: late entries into an open June period change the June Balance Sheet because they belong to June by `entry_date`.

### 5.2 Period boundaries

A period parameter resolves through `accounting.accounting_periods` to its `[start_date, end_date]`. A flow report "for period FY2026 P06" means `entry_date between P06.start_date and P06.end_date`. A stock report "as of P06" means `entry_date <= P06.end_date`. Because periods cannot overlap (the `exclude using gist` constraint, `accounting-engine.md` §6), period→date resolution is unambiguous.

### 5.3 How closed/locked periods interact with reporting

Reporting is **read-only**, so period status never blocks a report — you can and must report on `closed` and `locked` periods (statutory filing reads locked data). Period state matters to reporting in three ways:

1. **Stability / finality.** Figures for a `locked` period are guaranteed immutable (no posting or reversal can target a locked period, `accounting-engine.md` §6.1), so an export over a locked period is a permanently reproducible artefact. An `open` period's figures can still change; a report over an open period is a snapshot, and exports record the generation time precisely so a later figure does not silently contradict an earlier export.
2. **Comparatives.** Prior-period comparatives almost always reference `closed`/`locked` periods — stable by definition.
3. **Display cue.** Reports may annotate whether the period is `open` (provisional), `closed`, or `locked` (final), so a reader knows whether the number can still move. This is presentation only; it never changes the arithmetic.

### 5.4 Comparatives (period vs prior)

A comparative column runs the **same report query** over a second window and joins on account (or category):

- **Flow** comparatives: current `[date_from, date_to]` vs the immediately prior period of equal length, or same period last fiscal year.
- **Stock** comparatives: current as-of date vs the prior period end (or same date last year).

The variance column is a straight subtraction of base-currency figures. Because both columns are the identical computation over different bounds, they are guaranteed consistent.

```sql
-- P&L with prior-period comparative, base currency
with cur as (
    select account_id, account_code, account_name, account_category,
           sum(signed_base_movement) as amount_base
    from accounting.general_ledger
    where company_id = $1 and account_category in ('income','expense')
      and entry_date between $2 and $3            -- current period
    group by account_id, account_code, account_name, account_category
),
pri as (
    select account_id, sum(signed_base_movement) as amount_base
    from accounting.general_ledger
    where company_id = $1 and account_category in ('income','expense')
      and entry_date between $4 and $5            -- prior period
    group by account_id
)
select cur.account_category, cur.account_code, cur.account_name,
       cur.amount_base                                   as current_amount,
       coalesce(pri.amount_base, 0)                      as prior_amount,
       cur.amount_base - coalesce(pri.amount_base, 0)    as variance
from cur
left join pri on pri.account_id = cur.account_id
order by cur.account_category desc, cur.account_code;
```

---

## 6. Dashboards

### 6.1 `accounting.dashboard_configs`

A dashboard is a **layout of widgets**, configured per company and optionally per user, stored as `jsonb` (per `_ARCHITECTURE-SPEC.md` §5):

```sql
create table accounting.dashboard_configs (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references core.companies(id),
    user_id     uuid references core.users(id),    -- null = company-wide default layout
    name        text not null,
    layout      jsonb not null,                     -- widget array + grid placement (§6.3)
    is_default  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz,
    created_by  uuid references core.users(id),
    updated_by  uuid references core.users(id)
);

-- one default per (company, user-scope)
create unique index dashboard_configs_one_default
    on accounting.dashboard_configs (company_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'))
    where is_default;

create index on accounting.dashboard_configs (company_id, user_id);
```

Resolution order when a user opens the dashboard: their personal default (`user_id = me, is_default`) if present, else the company default (`user_id is null, is_default`), else an empty starter layout. RLS scopes rows to the user's companies; personal layouts additionally filter on `user_id = auth.uid()`.

### 6.2 The widget model

A widget is a typed, parameterised reference to a **real query** — never a static figure. Each widget in `layout` declares:

- `id` — stable widget instance id within the layout.
- `type` — widget kind: `kpi`, `bar`, `line`, `table`, `aging`, `pnl_snapshot`.
- `source` — the `report_key` or named query it draws from (every widget maps to a §3 report or a thin aggregate over the GL).
- `params` — widget parameters (period, as-of, account filter), resolved the same way as report parameters (§4.2), inheriting the dashboard's currency mode (base default).
- `layout` — grid placement (`x`, `y`, `w`, `h`).
- `title`, optional `format` hints.

Widgets render **empty states** when no posted data backs them — a "Cash Position" widget on an empty ledger reads "No bank activity yet," never a fabricated number (§1).

### 6.3 Layout JSON example

```json
{
  "version": 1,
  "currency_mode": "base",
  "widgets": [
    {
      "id": "w-cash",
      "type": "kpi",
      "title": "Cash Position",
      "source": "cash_position",
      "params": { "as_of": "period_end" },
      "layout": { "x": 0, "y": 0, "w": 3, "h": 2 }
    },
    {
      "id": "w-ar",
      "type": "kpi",
      "title": "Total Receivables",
      "source": "ar_total",
      "params": { "as_of": "today" },
      "layout": { "x": 3, "y": 0, "w": 3, "h": 2 }
    },
    {
      "id": "w-ap",
      "type": "kpi",
      "title": "Total Payables",
      "source": "ap_total",
      "params": { "as_of": "today" },
      "layout": { "x": 6, "y": 0, "w": 3, "h": 2 }
    },
    {
      "id": "w-pnl",
      "type": "pnl_snapshot",
      "title": "P&L — Current Period",
      "source": "profit_and_loss",
      "params": { "period": "current", "comparative": "prior_period" },
      "layout": { "x": 0, "y": 2, "w": 6, "h": 4 }
    },
    {
      "id": "w-topcust",
      "type": "bar",
      "title": "Top Customers by Revenue (YTD)",
      "source": "top_customers",
      "params": { "period": "fiscal_year_to_date", "limit": 5 },
      "layout": { "x": 6, "y": 2, "w": 6, "h": 4 }
    },
    {
      "id": "w-aging",
      "type": "aging",
      "title": "AR Aging",
      "source": "ar_aging",
      "params": { "as_of": "today" },
      "layout": { "x": 0, "y": 6, "w": 12, "h": 4 }
    }
  ]
}
```

The layout is fully configurable: users (with the right permission) add, remove, resize, and reorder widgets; the edited `layout` jsonb is saved back to their personal `dashboard_configs` row, leaving the company default untouched.

### 6.4 Example widgets, each backed by a real query

**Cash Position** (`cash_position`, KPI) — cumulative base balance of all bank/cash accounts as of a date:

```sql
select coalesce(sum(gl.signed_base_movement), 0) as cash_position_base
from accounting.general_ledger gl
join accounting.accounts a on a.id = gl.account_id
where gl.company_id = $1
  and a.is_bank_account = true
  and gl.entry_date <= $2;
```

**Total Receivables** (`ar_total`, KPI) — the AR control account balance (= AR aging total, §3.7):

```sql
select coalesce(sum(gl.signed_base_movement), 0) as ar_total_base
from accounting.general_ledger gl
join accounting.accounts a       on a.id = gl.account_id
join accounting.account_types at on at.id = a.account_type_id
where gl.company_id = $1
  and at.key = 'accounts_receivable'
  and gl.entry_date <= $2;
```

**Total Payables** (`ap_total`, KPI) — the AP control account balance, identical shape with `at.key = 'accounts_payable'`.

**P&L Snapshot** (`profit_and_loss`, pnl_snapshot) — the §3.2 query for the current period, with prior-period comparative (§5.4); the widget shows income, expense, and net profit, base currency.

**Top Customers** (`top_customers`, bar) — revenue per customer over a window. Because revenue is posted from invoices (`source = 'invoice'`, `source_id = invoice.id`), revenue is attributed to customers by joining GL income lines back through the originating invoice:

```sql
select c.id, c.code, c.name,
       sum(gl.signed_base_movement) as revenue_base
from accounting.general_ledger gl
join accounting.invoices  i on i.id = gl.source_id and gl.source = 'invoice'
join accounting.customers c on c.id = i.customer_id
where gl.company_id = $1
  and gl.account_category = 'income'
  and gl.entry_date between $2 and $3
group by c.id, c.code, c.name
order by revenue_base desc
limit $4;
```

Every widget is a thin wrapper over the §3 report queries or the GL view; none invents data, and all present base currency by default.

---

## 7. Multi-currency presentation

- **Base currency is the default and the only axis on which statements aggregate.** Trial Balance, P&L, Balance Sheet, Cash Flow, agings, and dashboards all sum the stored `base_debit` / `base_credit`, which were fixed at transaction time (`_ARCHITECTURE-SPEC.md` §8, `accounting-engine.md` §3.3). Historical statements therefore never drift when exchange rates move.
- **Original transaction currency is an optional secondary presentation.** GL detail and account transaction listings expose the original `currency_code`, `debit`, `credit` alongside the base columns (the GL view already carries both). A "by currency" view of a multi-currency bank or AR account can group by `currency_code` to show original-currency subtotals next to their base equivalents.
- **Aggregated statements never mix currencies in one figure.** Summing USD and GBP amounts is meaningless; only their base-currency equivalents are summed. Where a report wants to show original currency, it does so per currency, never as a cross-currency total.
- **FX revaluation** entries (`source = 'fx_revaluation'`) appear in reports like any other posted entry; they are the mechanism by which open foreign-currency balances are restated, and the Balance Sheet/P&L pick them up automatically because they are posted lines.

The `currency_mode` parameter (`base` | `original`) on reports and on `dashboard_configs.layout` selects presentation; `base` is the default everywhere.

---

## 8. Performance

### 8.1 Querying large ledgers

Every report scans `journal_lines` (through the GL view), so the ledger is the hot path. The engine already indexes it for exactly these queries (`accounting-engine.md` §3.2): `(company_id, account_id)`, `(account_id)`, `(company_id, status, entry_date)` on entries, `(company_id, period_id)`. The reporting layer relies on:

- **`company_id` + `entry_date` range** predicates hitting the entry index, so flow reports scan only the relevant period.
- **`status = 'posted'`** baked into the GL view so the planner can use partial-index-friendly predicates.
- **Account/category joins** kept to `accounts` / `account_types` (small, cached relations).

For the largest companies, additional covering indexes on `journal_lines (company_id, account_id) include (base_debit, base_credit)` can make balance aggregation index-only.

### 8.2 The optional `accounting.account_balances` rollup

When line counts grow into the millions, the maintained **per account, per period** rollup defined in `accounting-engine.md` §11 serves Trial Balance, Balance Sheet, and dashboard KPIs in O(accounts) instead of O(lines):

- It is **incrementally maintained on post** (every ledger change is an insert of posted lines; reversals are new posted entries, so the rollup only ever accumulates — `accounting-engine.md` §11).
- Stock reports read it by **summing periods up to the as-of period**; flow reports read the **single period bucket**.
- It is **reconstructable from the journal** and reconciled by a scheduled job; the §3 GL queries remain the authoritative fallback and the reconciliation oracle. **It is never the system of record** (`_ARCHITECTURE-SPEC.md` §5).
- **Do not build it until measured latency justifies it.** Phase 1 reports run directly off the indexed GL; the rollup is a later optimization, swapped in transparently behind the same report definitions.

### 8.3 Caching strategy

- **Cache by stability, keyed on period state.** Reports over `locked` periods are immutable and may be cached indefinitely (keyed on `company_id`, `report_key`, resolved params, and the period's `locked` state). Reports over `closed` periods cache until reopened. Reports over `open` periods are **not** cached (or cached very briefly), because new posts can change them — correctness beats staleness here.
- **Exports are the durable cache.** A `ready` `report_exports` artefact *is* a cached, frozen rendering; re-requesting the identical report over a locked period can return the existing export rather than recomputing.
- **Dashboard widgets** cache per `(company_id, widget source, resolved params)` with a short TTL, invalidated whenever a new entry is posted for the company (a lightweight "last posted at" timestamp per company is enough to bust dashboard caches without per-widget tracking).
- **Never cache across companies or across users in a way that could leak** — cache keys always include `company_id`, and any user-scoped layout caches include `user_id`. RLS remains the backstop.

---

## 9. Governance: reports must reconcile

Reports are not merely displayed; they are **checked**. Each statement carries an invariant that must hold, and a violation is treated as a corruption alert, not a rounding curiosity.

| Report | Invariant that must hold |
|--------|--------------------------|
| Trial Balance | `SUM(debit_balance) = SUM(credit_balance)` exactly |
| Balance Sheet | `total_assets = total_liabilities + equity + current_earnings` |
| P&L → Balance Sheet | P&L `net_profit` for the period reconciles to the change in retained earnings + current earnings |
| Cash Flow | sum of cash-flow sections = movement in bank/cash account balances over the period |
| Account transaction listing | closing running balance = that account's Trial Balance line for the as-of date |
| AR Aging | `SUM(total_outstanding)` = AR control account base balance as of the date |
| AP Aging | `SUM(total_outstanding)` = AP control account base balance as of the date |
| VAT report | net VAT = net movement of the VAT control account(s) over the period |
| GL detail | sum of `signed_base_movement` per account = the account's Trial Balance line |

These are not new rules; they are consequences of the **single signed-balance computation** (§2.1) applied consistently. Because Trial Balance, P&L, and Balance Sheet are the same arithmetic over the same posted rows, they cannot disagree unless the ledger itself is unbalanced — which the engine's posting gate and nightly trial-balance assertion (`accounting-engine.md` §5.2, §7.4, §9) make structurally impossible.

**Where the checks run.**

- **In the report itself.** Statements compute and display their balance-check line (e.g. the Balance Sheet prints a "Difference" line that must read zero; the Trial Balance prints both totals). A non-zero check is surfaced to the user, never hidden.
- **In exports.** The governance check is rendered onto the exported PDF/Excel, so a filed or sent artefact carries its own proof of balance.
- **In the nightly job.** The engine's per-company trial-balance assertion (`accounting-engine.md` §9) is the backstop; if it ever fires, every report is suspect until the breach is found. Reporting trusts the journal precisely because that backstop exists.

A report that cannot reconcile does not get "fixed" cosmetically — the discrepancy is escalated, because it means an invariant upstream of reporting was breached.

---

## 10. How this layer stays loosely coupled

Per `_ARCHITECTURE-SPEC.md` §1 and §10, accounting must not embed logic other modules depend on, and modules integrate through the core. Reporting honours this:

- Reporting reads **only** accounting tables/views and `core` reference data (companies, users, permissions). It writes only `report_exports` and `dashboard_configs` — its own artefacts.
- Future modules (Survey, Claims, ...) that want financial figures consume them through the **report definitions / queries** here or through their own schema-level views over the GL, never by reaching into journal internals. The `source` / `source_id` contract (`accounting-engine.md` §10) is the only coupling, and it is one-directional (documents → journal → reports).
- The dashboard widget model is generic enough that the future Reporting & Analytics module can reuse `dashboard_configs` and the widget contract for cross-module dashboards, with accounting widgets being one widget family among several.

---

## Open Questions

- **Cash-flow account classification.** The indirect cash-flow statement needs each account mapped to operating / investing / financing. Is this a new attribute on `accounting.account_types` (or `accounts`), a configuration table, or a derived heuristic from account category? (Coordinate with the chart-of-accounts seed.)
- **Retained-earnings roll / period 13.** Should the Balance Sheet's "current earnings" be a live computation indefinitely, or should a year-end closing entry (possibly in a 13th adjustment period, per `accounting-engine.md` Open Questions) roll it into a retained-earnings account, after which prior-year P&L is read from the closing entry rather than recomputed?
- **Database-backed report definitions / user-defined reports.** Phase 1 keeps definitions in code. When do we introduce a `report_definitions` table and a user-facing report builder, and what is its parameter/permission model?
- **Export queue and templating.** Phase 1 keeps export generation simple. At what volume do PDF/Excel rendering and large CSV exports need an async worker/queue, and which templating engine produces statutory-grade PDF statements?
- **AR/AP outstanding-in-base source.** Should aging read outstanding amounts from the document tables (`invoices`/`bills` `base_total`, `amount_paid`) or from open-item allocations in the AR/AP sub-ledger? The reconciliation target (control-account balance) is fixed; the sub-ledger source of truth should be settled with the AR/AP doc.
- **Statutory T&T report templates.** Which exact T&T return layouts (VAT, withholding) must the VAT/tax report and its PDF export map onto, and are any required as fixed government forms?

## Decisions Locked

- **Reports and dashboards are derived only from posted journal data** (`status = 'posted'`), through `accounting.general_ledger` and the engine's balance queries. No fabricated/demo data; empty ledgers render empty states. (§1)
- **One signed-base-movement primitive** (`accounting-engine.md` §2.1) drives Trial Balance, P&L, and Balance Sheet; there is no per-report sign logic, which is *why* the statements reconcile. (§2.1, §9)
- **Base currency is the default and the only aggregation axis**; original currency is an optional secondary presentation; statements never mix currencies in a single figure. (§7)
- **Stock vs flow** is the governing date semantic: stock reports are cumulative `entry_date <= as_of`; flow reports sum within a range. `entry_date`, not `posted_at`, drives reporting. (§5.1)
- **Reporting is read-only over the ledger**; period status never blocks reporting, but `locked` periods yield permanently reproducible figures and `open` periods yield snapshots. (§5.3)
- **`accounting.report_exports`** records every generated CSV/PDF/Excel as an **immutable, parameter-stamped artefact** in Supabase Storage; re-running creates a new export, never an overwrite. (§4.3)
- **`accounting.dashboard_configs`** stores per-company and optional per-user `jsonb` layouts; every widget is backed by a real query and renders empty states without posted data. (§6)
- **`accounting.account_balances`** may back reports for performance but is reconstructable, reconciled, and **never the system of record**; build only when latency justifies it. (§8.2)
- **Every statement must reconcile** to its invariant (TB debits=credits; Balance Sheet balances; agings = control accounts; VAT = control movement), surfaced in-report and in exports, with the engine's nightly assertion as backstop. (§9)

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative cross-cutting spec — canonical schema §5, GL-as-view §5, double-entry invariants §6, RBAC §7, multi-currency §8, T&T §9, non-negotiables §10). `accounting-engine.md` (the journal model, `accounting.general_ledger` view §7, signed-balance rule §2.1, balance/trial-balance queries §7.3–§7.4, period control §6, and the optional `accounting.account_balances` rollup §11 that this layer reads). Sibling module docs (currency, AR/AP, tax, import) supply the documents whose posted entries every report consumes via the `source`/`source_id` contract.
