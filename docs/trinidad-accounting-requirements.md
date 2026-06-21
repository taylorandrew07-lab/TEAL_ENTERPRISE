# Trinidad & Tobago Accounting Requirements

**TEAL Enterprise — Accounting Module**

- **Owning agent:** Trinidad & Tobago Accounting Agent
- **Status:** Draft v1 — 2026-06-17

**Purpose.** This document captures the Trinidad & Tobago (T&T) statutory and practical accounting context that the TEAL Accounting module must accommodate, and maps each requirement to a *configurable, data-driven* mechanism in TEAL. It exists so that engineers and admins understand the local rules without ever encoding those rules as constants. Read it alongside `_ARCHITECTURE-SPEC.md` (the authoritative source of table names and invariants).

> ## ⚠️ Governing principle: NOTHING is hard-coded
>
> **No tax rate, threshold, levy percentage, contribution band, fiscal date, or statutory rule described in this document is ever to be written into application code, SQL constants, or compiled logic.** Every figure below is an **illustrative default** — a starting value an administrator *sets as data* and can change at any time without a code change or migration. T&T rates and rules change by Finance Act and Budget; treating any of them as a baked-in constant is a defect.
>
> Where a number appears in this document it is **labelled illustrative** and is **subject to change** and **must be verified with a qualified T&T accountant or the Board of Inland Revenue (BIR)** before use. TEAL stores these values in configuration tables (`accounting.tax_codes`, `accounting.accounts`, `core.companies`, `accounting.accounting_periods`, and module settings `jsonb`), never in code.

---

## 1. Currency & FX realities

### 1.1 Base currency

The Trinidad & Tobago Dollar (**TTD**) is the default base currency for T&T companies. Per `_ARCHITECTURE-SPEC.md` §5, `core.companies.base_currency_code` defaults to `TTD` and references `accounting.currencies`. This is a **default, not a constant** — base currency is a per-company configuration value, so a group entity reporting in another currency can be set up without code change.

### 1.2 Common foreign currencies

T&T businesses (maritime, logistics, ship agency, freight forwarding) routinely transact in:

- **USD** — the dominant foreign trade currency; vendor invoices, freight, bunkers, agency disbursements.
- **GBP** and **EUR** — European principals, P&I clubs, classification societies, surveyors.

Seed currencies are TTD, USD, GBP, EUR (`_ARCHITECTURE-SPEC.md` §8), and the list is **extensible** via `accounting.currencies` — admins add currencies as data.

### 1.3 FX realities specific to T&T

These practical realities shape requirements but are **not** encoded as rules:

- **Restricted USD availability.** Access to USD through the local banking system is constrained; the rate a business *actually* obtains (card rate, negotiated rate, parallel sources) can differ from any published mid-rate. TEAL therefore must let users record the **actual `fx_rate` used at transaction time** rather than forcing a system-derived rate.
- **Multiple rate sources.** Central Bank reference rate, individual commercial-bank buy/sell rates, and card-settlement rates all coexist. `accounting.exchange_rates` carries a `source` column and an optional `company_id` so each company can maintain its own rate table; no single rate provider is hard-coded.
- **Buy vs sell spread.** Receipts (selling foreign currency) and payments (buying foreign currency) may use different rates. TEAL stores the rate per transaction, never a global daily constant.
- **Realised vs unrealised FX.** Settlement at a different rate from invoice date produces realised gain/loss; period-end open balances produce unrealised gain/loss. Both flow through journal entries with `source = 'fx_revaluation'` (revaluation) or normal settlement postings (`_ARCHITECTURE-SPEC.md` §6.4, §8).

### 1.4 How TEAL accommodates it

- Per §8, every transaction stores its own `fx_rate` and **base-currency equivalents** (`base_debit`/`base_credit`, `base_total`); historical rates are never re-derived.
- FX gain/loss accounts are ordinary `accounting.accounts` chosen by configuration, not special-cased in code.
- Revaluation runs produce balanced journal entries; the gain/loss account used is an admin setting.

---

## 2. VAT (Value Added Tax) — fully configurable

VAT is the largest local indirect-tax surface. **Every aspect is configured, not coded.**

### 2.1 VAT as `accounting.tax_codes` data

VAT is represented as rows in `accounting.tax_codes` (`_ARCHITECTURE-SPEC.md` §5):

```
accounting.tax_codes(
  id, company_id, code, name,
  rate numeric,                 -- the VAT percentage, set as DATA
  tax_type enum[vat,withholding,other],
  collected_account_id,         -- OUTPUT VAT control (liability)
  paid_account_id,              -- INPUT VAT control (asset / recoverable)
  is_active
)
```

An administrator creates VAT codes such as:

| Code (illustrative) | Name (illustrative) | `rate` | `tax_type` | Notes |
|---|---|---|---|---|
| `VAT-STD` | Standard-rated VAT | *(admin-set %)* | `vat` | The prevailing standard rate is an **illustrative default the admin enters** — verify current rate with BIR. |
| `VAT-ZERO` | Zero-rated | `0` | `vat` | Exports, certain basic foods/medicines — classification is configured per item/account. |
| `VAT-EXEMPT` | Exempt | `0` (no recovery) | `vat` | Distinct from zero-rated; modelled as a separate code so reporting can separate them. |

> **Illustrative only.** The standard VAT rate, the zero-rated list, the exempt list, and the registration threshold are all **subject to change by Finance Act** and **must be confirmed with a T&T accountant**. None of these is written into TEAL code — they are rows and settings.

### 2.2 Input vs output VAT

- **Output VAT** — VAT charged to customers on `accounting.invoices` / `invoice_lines`. Posts a **credit** to the VAT code's `collected_account_id` (a liability control account).
- **Input VAT** — VAT charged by suppliers on `accounting.bills` / `bill_lines`. Posts a **debit** to the VAT code's `paid_account_id` (a recoverable-asset control account).

The direction (which control account, debit vs credit) is derived from the document type and the tax code's mapped accounts — **not** from any rate-specific branch in code.

### 2.3 VAT control accounts

VAT control accounts are ordinary `accounting.accounts` rows. Typical configuration (illustrative naming):

- `Output VAT Payable` (liability) → referenced by `tax_codes.collected_account_id`.
- `Input VAT Recoverable` (asset) → referenced by `tax_codes.paid_account_id`.
- Optionally a `VAT Control / Settlement` account used when computing the net VAT position for a return period.

The **net VAT due to / from BIR** is `output VAT − input VAT` for the period, derived from posted `accounting.journal_lines` tagged with `tax_code_id`. It is a **query over the ledger**, not a stored constant.

### 2.4 VAT return periods & reporting

- T&T VAT is filed on a **periodic cycle** (commonly bi-monthly / two-monthly for many registrants; period length is **set by BIR per registrant** and must be verified).
- TEAL models VAT periods through `accounting.accounting_periods` and/or a configurable VAT-period setting in the Tax module `settings jsonb`. The **period length and filing cadence are configuration**, not hard-coded.
- The VAT return figure is produced by a **report** (a `report_key` in `accounting.report_exports`) that sums `journal_lines.tax_code_id` movements for VAT codes over the selected period — output VAT, input VAT, and net payable/recoverable. Because it reads the ledger, it is always consistent with posted entries (no parallel tax ledger).
- VAT registration number is stored per company (Tax module setting) and per counterparty on `accounting.customers.tax_reg_no` / `accounting.suppliers.tax_reg_no` (§5).

> **Reminder:** registration threshold, return frequency, filing deadlines, and any partial-exemption / apportionment rules are **illustrative defaults to be confirmed with a T&T accountant** and are stored as configuration.

---

## 3. Withholding tax (WHT) — configurable

Withholding tax applies to certain payments (notably to non-residents, and certain distributions/services). TEAL models it generically:

- WHT is a `accounting.tax_codes` row with `tax_type = 'withholding'` and an admin-set `rate`.
- The withheld amount posts to a **WHT-payable control account** (a configured `accounting.accounts` liability), representing tax withheld on behalf of BIR pending remittance.
- WHT can apply on the **payment / bill** side (amounts withheld from supplier payments) and is reported via a ledger query over WHT-tagged lines.
- Different WHT rates by payment type / residency are simply **different tax-code rows** — the variation is data, never a `switch` in code.

> **Illustrative only.** WHT rates, which payments attract WHT, treaty-reduced rates, and remittance deadlines vary and are **subject to double-taxation treaties and Finance Act changes** — confirm with a T&T accountant. TEAL stores them as tax-code data and account mappings.

---

## 4. Corporation tax, Business Levy & Green Fund Levy — configurable

These are **profit/turnover-based** charges typically computed at period close, not per-transaction. TEAL treats them as **configurable provisions**, not coded formulas.

### 4.1 Corporation tax

- Computed on chargeable profits; the rate(s) (including any differentiated rates for specific sectors such as certain financial or energy entities) are **illustrative defaults** to be confirmed with a T&T accountant.
- In TEAL, the corporation-tax **provision** is recorded as a manual or computed journal entry: debit a tax-expense account, credit a tax-payable liability account — both ordinary `accounting.accounts`.
- The **rate(s) and any capital-allowance / disallowance adjustments are configuration and accounting workpapers**, not application logic. A future Tax module can store the effective rate as a setting and propose the entry, but the figure remains admin-reviewable data.

### 4.2 Business Levy

- A minimum charge based on **gross revenue/turnover**, typically applying when it exceeds corporation tax (subject to exemptions, e.g. early-years exemptions and threshold). Rate, threshold, exemptions are **illustrative and to be verified**.
- Modelled as a configured provision: rate stored as a setting; base (turnover) derived from the income ledger; entry posts expense vs payable. No hard-coded percentage or threshold.

### 4.3 Green Fund Levy

- A levy on **gross sales/receipts** funding the National Environmental Fund. Rate and base are **illustrative defaults to be confirmed**.
- Same pattern: configured rate × ledger-derived base → provision journal entry to expense and a payable control account.

> All three are computed from **ledger-derived bases × admin-configured rates**, posted as ordinary balanced journal entries. None of the rates, thresholds, or exemption rules is hard-coded.

---

## 5. Payroll-related statutory items (PAYE, NIS, Health Surcharge)

> **Scope note.** Payroll is **not a Phase 1 deliverable**. This section specifies the *data each item needs* and *how a future Payroll module would compute them*, so that the accounting core and chart of accounts are ready. **All rates, bands, ceilings, and tables are configuration** held by the future Payroll module — never hard-coded.

### 5.1 PAYE (Pay As You Earn — income tax on employment)

- **What it computes:** employee income tax withheld from salary each pay period.
- **Data needed (held as config / employee data, illustrative):** personal allowance / tax-free threshold, tax rate band(s) (T&T commonly uses a banded rate structure — *illustrative, verify*), pay-period frequency, gross pay, allowable deductions, year-to-date accumulators.
- **How a future module computes it:** applies the **configured** allowance and rate band table to period taxable pay; the resulting withholding posts as a payroll journal — debit gross wages (expense), credit PAYE-payable (liability to BIR), credit net-pay (to bank/employee).
- Rate bands and allowances are **a configurable table**, not constants.

### 5.2 NIS (National Insurance)

- **What it computes:** employer and employee National Insurance contributions, generally based on an **earnings-class / band table** (each weekly-earnings class maps to a fixed contribution).
- **Data needed (illustrative):** the NIS earnings-class table (class → assumed earnings → employee contribution → employer contribution), pay frequency, employee earnings, NIS registration number.
- **How a future module computes it:** look up the employee's earnings class in the **configured** class table; post employee contribution (deduction) and employer contribution (expense) to NIS-payable control accounts.
- The entire class/band table is **uploaded/edited as data** (it changes periodically) — never embedded in code.

### 5.3 Health Surcharge

- **What it computes:** a flat per-period health surcharge deducted from employees, with amount typically depending on whether earnings exceed a small threshold (a **two-tier flat amount**, illustrative).
- **Data needed (illustrative):** the surcharge amount tier(s) and the earnings threshold separating them, pay frequency, employee earnings.
- **How a future module computes it:** apply the **configured** tier table; post deduction to a Health-Surcharge-payable control account.

### 5.4 Common payroll-ledger pattern

All payroll statutory items resolve to **balanced journal entries** posting to **configured control accounts** (PAYE-payable, NIS-payable, Health-Surcharge-payable), then cleared on remittance to BIR/NIBTT. The Payroll module computes; the Accounting core only sees journal entries. Rates/tables live in Payroll **settings data**.

---

## 6. BIR file numbers & tax registration identifiers

T&T entities and counterparties carry several official identifiers. TEAL stores them as **data fields**, with light/optional validation only:

- **BIR (Board of Inland Revenue) File Number** — the company's primary tax identifier. Stored as a **company-level Tax setting** (Tax module `settings jsonb`) — not in code.
- **VAT registration number** — company-level setting; also captured per counterparty.
- **NIS / NIBTT employer registration number** — company-level Payroll/Tax setting (future).
- **PAYE / withholding identifiers** — as required, stored as settings.

For trading partners:

- `accounting.customers.tax_reg_no` and `accounting.suppliers.tax_reg_no` (`_ARCHITECTURE-SPEC.md` §5) hold the counterparty's tax/VAT/BIR identifier. These print on invoices and feed VAT/WHT reporting.

> Identifier formats are **conventions, not enforced constants**. Any format checks are configurable validation, not hard-coded business rules.

---

## 7. Accounting periods, fiscal year & statutory cycles

### 7.1 Fiscal year

- `core.companies.fiscal_year_start_month` (default `1` = January) controls the fiscal year. Many T&T companies align to a **calendar / January start**, but this is a **per-company default, not a constant** — entities with a different year-end set it freely.
- `accounting.accounting_periods` defines the operating periods (`fiscal_year`, `period_no`, `start_date`, `end_date`, `status enum[open,closed,locked]`). Period structure (monthly vs quarterly) is configuration.

### 7.2 Period control & posting

- Posting into a `closed` or `locked` period is rejected (`_ARCHITECTURE-SPEC.md` §6.3). Statutory close (year-end lock after filing) uses `status = 'locked'`.

### 7.3 Statutory reporting / return cycles (illustrative — verify cadence)

These cadences drive **report scheduling**, not coded logic. All due dates/frequencies are **illustrative defaults to confirm with a T&T accountant / BIR**:

- **VAT returns** — periodic (commonly bi-monthly); cadence is per-registrant configuration (§2.4).
- **PAYE / NIS / Health Surcharge remittances** — typically **monthly** remittance to BIR/NIBTT (future Payroll).
- **Business Levy / Green Fund Levy** — typically **quarterly** instalments plus annual reconciliation.
- **Corporation tax** — **quarterly** instalments plus annual return; year-end provision at close.
- **Annual financial statements / income tax return** — filed after fiscal year-end per BIR deadlines.

TEAL supports these by deriving every figure from the posted ledger and exposing **configurable report periods**; no deadline or frequency is compiled into the application.

---

## 8. Requirements → TEAL mechanism → Phase

Every requirement maps to a **data-driven** mechanism. "Phase" follows the module roadmap: **Phase 1** = ledger + AR/AP + multi-currency + tax-code tagging; **Phase 2** = tax returns/reporting & provisions; **Later** = Payroll and advanced automation.

| # | T&T requirement | Configurable mechanism in TEAL (no hard-coding) | Phase |
|---|---|---|---|
| 1 | TTD base currency | `core.companies.base_currency_code` default `TTD` (per-company setting) | Phase 1 |
| 2 | Foreign currencies USD/GBP/EUR + extensibility | `accounting.currencies` rows (extensible) | Phase 1 |
| 3 | Actual FX rate per transaction (USD scarcity, spreads) | `fx_rate` + `base_*` equivalents stored per line; `accounting.exchange_rates` with `source`, optional `company_id` | Phase 1 |
| 4 | Realised/unrealised FX gain/loss | Settlement postings + `source='fx_revaluation'` entries to configured gain/loss accounts | Phase 1 (realised) / Phase 2 (revaluation) |
| 5 | VAT standard / zero / exempt | `accounting.tax_codes` rows (`tax_type='vat'`, admin-set `rate`) | Phase 1 (capture) |
| 6 | Output VAT (sales) | `tax_codes.collected_account_id` liability control; posted from invoices | Phase 1 |
| 7 | Input VAT (purchases) | `tax_codes.paid_account_id` recoverable-asset control; posted from bills | Phase 1 |
| 8 | VAT control & net position | Configured control `accounting.accounts`; net = ledger query over `tax_code_id` | Phase 1 (accounts) / Phase 2 (net report) |
| 9 | VAT return periods & filing | Configurable VAT period (settings / `accounting_periods`); report via `report_exports` | Phase 2 |
| 10 | Withholding tax | `accounting.tax_codes` (`tax_type='withholding'`) + WHT-payable control account | Phase 1 (capture) / Phase 2 (reporting) |
| 11 | Corporation tax provision | Configured rate setting × ledger base → manual/computed provision journal | Phase 2 |
| 12 | Business Levy | Configured rate/threshold setting × turnover base → provision journal | Phase 2 |
| 13 | Green Fund Levy | Configured rate setting × gross-receipts base → provision journal | Phase 2 |
| 14 | PAYE | Future Payroll module: configurable allowance + rate-band table → payroll journal to PAYE-payable | Later |
| 15 | NIS | Future Payroll: configurable earnings-class table → NIS-payable (employee + employer) | Later |
| 16 | Health Surcharge | Future Payroll: configurable tier/threshold table → Health-Surcharge-payable | Later |
| 17 | BIR file no., VAT/NIS reg nos. (company) | Tax/Payroll module `settings jsonb` company-level fields | Phase 1 (Tax settings) / Later (Payroll) |
| 18 | Counterparty tax reg numbers | `accounting.customers.tax_reg_no`, `accounting.suppliers.tax_reg_no` | Phase 1 |
| 19 | Fiscal year convention | `core.companies.fiscal_year_start_month` (per-company) | Phase 1 |
| 20 | Accounting periods & statutory close | `accounting.accounting_periods` with `open/closed/locked` | Phase 1 |
| 21 | Statutory return cycles (VAT/levy/tax/payroll) | Configurable report periods over posted ledger; scheduling as settings | Phase 2 / Later |

---

## Open Questions

1. **VAT period model:** should VAT return periods be first-class rows (a dedicated `vat_periods` table) or derived from `accounting.accounting_periods` plus a cadence setting? Cross-team decision with the Accounting Engine doc.
2. **Levy bases:** exact definition of "gross revenue" vs "gross receipts" for Business Levy vs Green Fund Levy — needs a T&T accountant to confirm the ledger query that defines each base.
3. **WHT on which document side:** confirm whether WHT capture is needed on payments only or also on accruals/bills at point of recording.
4. **Multi-rate exposure for corporation tax:** do any group entities fall under special-sector rates requiring more than one configured rate? Determine before building the Phase 2 provision tool.
5. **Tax settings home:** confirm that company-level tax identifiers live in a Tax module `settings jsonb` rather than new columns on `core.companies` (keeps core lean).
6. **Rounding conventions** for VAT and statutory figures — confirm BIR-acceptable rounding and make it a configurable policy, not a code constant.

## Decisions Locked

1. **No tax rule, rate, threshold, band, ceiling, or deadline is hard-coded.** Every figure is configuration data (`accounting.tax_codes`, `accounting.accounts`, `core.companies`, `accounting.accounting_periods`, module `settings jsonb`). All rates cited in this document are **illustrative defaults to be verified with a qualified T&T accountant / BIR**.
2. **All taxes flow through `accounting.tax_codes`** and are tagged on `journal_lines.tax_code_id`; tax figures are **derived from the posted ledger**, never kept in a parallel tax store.
3. **TTD is the default base currency**, set per company, with USD/GBP/EUR seeded and the currency list extensible as data.
4. **Per-transaction FX:** actual `fx_rate` and base-currency equivalents are stored at transaction time and never re-derived (conforms to `_ARCHITECTURE-SPEC.md` §8).
5. **Statutory provisions and returns are reports/journals over the ledger**, with admin-reviewable figures — no automated posting of un-reviewed tax amounts in Phase 1/2.
6. **Payroll statutory items are deferred to a future Payroll module**; the accounting core only consumes the resulting balanced journal entries.

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative schema, invariants §6, multi-currency §8, T&T note §9). Sibling accounting docs (Accounting Engine, Multi-Currency, Tax) should reference this file for the T&T configuration model.
