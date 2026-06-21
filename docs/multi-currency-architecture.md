# Multi-Currency Architecture

**TEAL Enterprise — Accounting Module**
Owning agent: Multi-Currency Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive reference for how the Accounting module records, converts, and reports money across more than one currency. It specifies the currency model, exchange-rate storage and lookup, the dual-amount storage rule, rounding, realized and unrealized FX gain/loss, dual-currency balancing, and the reporting consequences — all in service of the multi-currency requirements in `_ARCHITECTURE-SPEC.md` §8.

This document conforms to `_ARCHITECTURE-SPEC.md` and is authoritative on currency internals. It sits alongside `accounting-engine.md` (the ledger that posts every entry described here) and the AR/AP, tax, and import sibling docs. It contains no migrations or application code by design; SQL and pseudocode appear only to make rules precise.

---

## 1. Scope and the one rule that matters

The module operates in many currencies but keeps its books in exactly one per company — the **base currency**. The single rule that governs everything below:

> **Every monetary line carries its transaction-currency amount AND its base-currency equivalent, and the base-currency equivalent is computed once, at transaction time, from a rate that is stored on the row and never re-derived from later rates.**

Conversion is a recording event, not a reporting transformation. We do not store amounts in one currency and convert them on the fly when a report runs, because the "correct" rate for a 2024 transaction is the rate that applied in 2024, not today's rate. The ledger therefore stores both numbers, and history is frozen.

This rule is the currency-side expression of the engine's two deepest invariants (`accounting-engine.md` §1): the books always balance — *in both currencies* — and posted history never changes.

---

## 2. The currency model

### 2.1 `accounting.currencies` — the registry of recognised currencies

```
accounting.currencies(code char(3) PK, name, symbol,
                      decimal_places int default 2, is_active bool default true)
```

A currency is identified by its ISO-4217 three-letter `code` (`TTD`, `USD`, `GBP`, `EUR`). The registry is **platform-wide reference data**, not company-scoped — there is one definition of "USD" for the whole platform, seeded in `supabase/seed/` (`_ARCHITECTURE-SPEC.md` §3, §8). It is an open, extensible reference table, not a Postgres enum, precisely because companies may need currencies we did not anticipate; per `accounting-engine.md` §1.1, currencies are *data, not types*.

Key columns:

- **`decimal_places`** — the number of minor-unit digits the currency is conventionally quoted to. `TTD`, `USD`, `GBP`, `EUR` are all `2`. This drives **display formatting** and the **rounding precision** of computed amounts (§5). It does **not** change storage precision: every monetary column is `numeric(20,4)` regardless of currency (`_ARCHITECTURE-SPEC.md` §4). A zero-decimal currency such as `JPY` would carry `decimal_places = 0`; a three-decimal currency such as `BHD` would carry `3`. The platform supports `0`–`4` cleanly because storage holds four decimals.
- **`symbol`** — presentation only (`$`, `£`, `€`). Never used for identity or arithmetic; `code` is the key.
- **`is_active`** — soft on/off switch. An inactive currency stays valid on historical rows (history never changes) but is hidden from new-transaction currency pickers.

Seed set: `TTD, USD, GBP, EUR`, extensible (`_ARCHITECTURE-SPEC.md` §8).

### 2.2 Base currency — one per company, default TTD

Each company declares a single base currency on `core.companies`:

```
core.companies(... base_currency_code char(3) references accounting.currencies(code) ...)
```

Default **TTD** (`_ARCHITECTURE-SPEC.md` §5, §8, §9). The base currency is the currency in which the company keeps its books, files its statutory returns, and presents every financial statement. It is the denominator of the `base_*` columns everywhere in the ledger. For the Taylor group operating primarily in Trinidad & Tobago, TTD is the natural base; a future foreign subsidiary could be created with, say, `USD` base without any code change.

The base currency is effectively immutable once a company has posted transactions. Changing it would invalidate every stored `base_*` amount (each was computed against the old base). If it must ever change, that is a migration event with full re-statement, not a settings toggle — flagged in Open Questions.

### 2.3 Transaction currency — the currency a document is denominated in

Any document (invoice, bill, payment, receipt, manual journal) is denominated in a single **transaction currency**, carried as `currency_code` on the header and copied to each line:

- `accounting.journal_entries.currency_code` — the entry's denomination.
- `accounting.journal_lines.currency_code` — per-line denomination (normally equal to the header; see §7.2 for the mixed-currency exception).
- `accounting.invoices.currency_code`, `accounting.bills.currency_code`, etc.
- `accounting.customers.currency_code` / `accounting.suppliers.currency_code` — the party's default trading currency.
- `accounting.bank_accounts.currency_code` and `accounting.accounts.currency_code` — an account may be *denominated* in a foreign currency (a USD bank account, a USD-only receivable control); see §6.1.

When the transaction currency equals the base currency (the common TTD-on-TTD case), `fx_rate = 1`, `base_debit = debit`, `base_credit = credit`, and everything below degenerates to a single-currency ledger with zero overhead.

---

## 3. Exchange rates

### 3.1 `accounting.exchange_rates` — design

```
accounting.exchange_rates(id, company_id uuid null,
                          from_currency, to_currency,
                          rate numeric, rate_date date, source, created_at)
```

Each row asserts: *on `rate_date`, one unit of `from_currency` was worth `rate` units of `to_currency`* (`_ARCHITECTURE-SPEC.md` §5).

**Direction is explicit.** The pair is directional: `from_currency → to_currency`. A USD→TTD rate of `6.7800` means **1 USD = 6.7800 TTD**. The inverse (TTD→USD) is a *different* logical fact; we do not assume `1/rate` is acceptable to store as a separate truth, because real markets quote bid/ask spreads and a stored inverse can drift from the quoted direct. Lookup (§3.3) handles inversion explicitly and transparently when only the opposite direction exists.

**Company-specific vs platform-wide.** `company_id` is **nullable** and this is deliberate:

- `company_id IS NULL` → a **platform-wide** rate, available to every company. This is the shared reference feed (e.g. a daily central-bank or market rate ingested for the whole platform).
- `company_id = <id>` → a **company-specific override**. A company that negotiates its own rate with its bank, or that must use a contractually fixed rate, records it here and it takes precedence for that company only.

This mirrors the `core.roles` "null = system" pattern in the spec (`_ARCHITECTURE-SPEC.md` §5) — null scope means "applies to everyone unless overridden."

**`rate_date`** is the date the rate is effective, independent of `created_at` (when the row was inserted). Rates are looked up by *effective date*, never by insertion time, so a late-entered rate for last week still applies to last week's transactions.

**`source`** records provenance: `'manual'`, `'central_bank'`, `'ecb'`, `'bank_negotiated'`, `'import'`, etc. It is informational and auditable; it never affects lookup precedence except as a tie-break policy choice (§3.3). Provenance matters for an audit trail — "where did this 6.78 come from?" must always be answerable.

Suggested uniqueness and indexing (stated as intent, not migration): a row is unique on `(coalesce(company_id, '...sentinel...'), from_currency, to_currency, rate_date, source)`, with a lookup index on `(from_currency, to_currency, rate_date desc)` filtered/ordered so the resolver finds the newest effective rate fast.

### 3.2 What a rate is, and is not

A stored rate is a **conversion fact for recording**, captured into `fx_rate` on the document at transaction time (§4). After that point the document does not consult `exchange_rates` again for that recorded amount — the rate is frozen on the row. The `exchange_rates` table is consulted to *originate* a transaction and to *revalue* open balances (§5), never to re-state settled history.

### 3.3 Rate lookup strategy

Resolving "the rate to convert `from_currency` into `to_currency` as at `on_date`" follows a deterministic precedence:

1. **Identity.** If `from = to`, the rate is exactly `1`. No lookup.
2. **Direct, company-specific, on/before date.** Newest `rate_date <= on_date` where `company_id = company` and the pair matches directly. Company override wins.
3. **Direct, platform-wide, on/before date.** Newest `rate_date <= on_date` where `company_id IS NULL`, pair matches directly.
4. **Inverse, company-specific, on/before date.** Newest matching `to → from`; return `1 / rate`.
5. **Inverse, platform-wide, on/before date.** Same, platform scope; return `1 / rate`.
6. **Triangulate through base** (optional, policy-gated). If `from → to` is unavailable directly or inverted, resolve `from → base` and `base → to` and multiply. Triangulation is only enabled where a company has opted in, because it compounds spread error.
7. **No rate found** → see §3.4.

Within a step, the **newest `rate_date <= on_date` wins**; if two rows tie on date, the configured `source` precedence (or most recent `created_at`) breaks the tie. We always use the most recent rate effective *on or before* the transaction date — never a future rate, which would let later market moves leak into past records.

```
function resolve_rate(company_id, from_ccy, to_ccy, on_date) -> numeric:
    if from_ccy = to_ccy: return 1
    -- direct, company override then platform; then inverse; then optional triangulation
    r := newest_rate(company_id, from_ccy, to_ccy, on_date)         -- steps 2,3
    if r is not null: return r
    r := newest_rate(company_id, to_ccy, from_ccy, on_date)         -- steps 4,5
    if r is not null: return 1 / r
    if triangulation_enabled(company_id):
        a := resolve_rate(company_id, from_ccy, base_ccy(company_id), on_date)
        b := resolve_rate(company_id, base_ccy(company_id), to_ccy, on_date)
        if a is not null and b is not null: return a * b
    raise MissingExchangeRate(from_ccy, to_ccy, on_date)            -- step 7
```

`newest_rate(...)` itself prefers the company-specific row over the platform-wide row for the same pair and date.

### 3.4 Missing rate — fail loud, never guess

If no rate can be resolved, the operation **fails explicitly**. We never default a foreign transaction to `fx_rate = 1`, never silently use a stale rate from an unrelated date without it being the legitimate "newest on/before" result, and never invent a number.

- **At transaction entry**, the user is blocked with a clear, actionable error — *"No USD→TTD exchange rate on or before 2026-06-17. Enter a rate to continue."* — and offered an inline rate-entry path that inserts a `source = 'manual'` row into `exchange_rates` and proceeds.
- **At posting**, the posting function (`accounting-engine.md` §4/§5) refuses to compute `base_*` from a null rate. Because the dual-currency balance check (§7) cannot pass without valid `base_*` amounts, a missing rate can never produce a half-converted or unbalanced posted entry.
- **At revaluation** (§5), a missing period-end rate aborts the revaluation run for the affected currency and reports it; it does not partially revalue.

The principle: a missing rate is a data-completeness error to be surfaced, never an arithmetic problem to be papered over. Guessing a rate corrupts the base-currency books silently, which is the one failure mode we will not tolerate.

---

## 4. The dual-amount storage rule

### 4.1 Every monetary line stores both currencies

This is the heart of the architecture and a direct mandate of `_ARCHITECTURE-SPEC.md` §4 and §8. On `accounting.journal_lines`:

```
debit       numeric(20,4) default 0   -- transaction currency
credit      numeric(20,4) default 0   -- transaction currency
currency_code                         -- the transaction currency
fx_rate     numeric       default 1   -- captured at transaction time
base_debit  numeric(20,4)             -- = round(debit  * fx_rate, base_dp)
base_credit numeric(20,4)             -- = round(credit * fx_rate, base_dp)
```

And on document headers, the same pairing: invoices and bills carry `total` (transaction currency) alongside `base_total`, plus `fx_rate` (`_ARCHITECTURE-SPEC.md` §5):

```
accounting.invoices(... currency_code, fx_rate, total, base_total ...)
accounting.bills    (... currency_code, fx_rate, total, base_total ...)
```

The convention throughout: a bare amount column (`debit`, `credit`, `total`) is in **transaction currency**; a `base_*` column is in the company's **base currency**. `base_amount = round(txn_amount * fx_rate, base_decimal_places)` where `fx_rate` converts transaction → base.

### 4.2 `fx_rate` is captured once and frozen

`fx_rate` is resolved (via §3.3) and written **at transaction time**, then the `base_*` amounts are computed from it and stored. From that moment:

- The row's `base_*` amounts are **facts of record**, not derivations to be recomputed.
- Later rate changes do **not** touch posted rows. Tomorrow's USD→TTD rate has no effect on yesterday's posted invoice.
- Reports read `base_*` directly. They never multiply a transaction amount by a current rate to present base figures.

This is `_ARCHITECTURE-SPEC.md` §8 stated operationally: *"Store `fx_rate` and base-currency equivalents at transaction time; never re-derive historically."*

### 4.3 WHY — historical accuracy is non-negotiable

Storing both amounts with a frozen rate is not redundancy; it is correctness:

1. **A transaction's base value is fixed at the moment it occurs.** When a USD 1,000 invoice is raised at 6.78, its value to a TTD-base company is TTD 6,780 — *forever*. That is the number that hit the books, the number on the filed accounts, the number the auditor signed. If we instead stored only USD 1,000 and multiplied by "today's rate" in reports, the historical invoice would silently change value every day the rate moved. That is not accounting; that is a moving target.

2. **Realized gain/loss only exists because the recording rate is frozen.** The whole concept of an FX gain (§5) is the *difference* between the rate at invoice time and the rate at settlement time. If amounts were always re-derived at the current rate, that difference would be erased and FX gains/losses would be invisible — a material reporting failure.

3. **Reproducibility and audit.** Any historical report must be reproducible to the cent years later, on any rate database state. Frozen `base_*` plus frozen `fx_rate` makes every past report a pure function of stored rows. Re-derivation makes past reports a function of *current* rates — non-reproducible by construction.

4. **Statutory filings are point-in-time.** T&T statutory accounts (`_ARCHITECTURE-SPEC.md` §9) are struck at a date and must not move afterward. Frozen base amounts are the only way to guarantee a filed balance sheet still foots next year.

The cost — two stored numbers plus a rate per line — is trivial. The alternative corrupts history. We always pay the storage.

---

## 5. Rounding

### 5.1 Storage precision vs display precision

Two distinct precisions, never conflated:

- **Storage precision is `numeric(20,4)`** for every monetary column, all currencies (`_ARCHITECTURE-SPEC.md` §4). Four decimal places of headroom means intermediate conversions do not lose cents to premature truncation, and three-decimal currencies (e.g. `BHD`) are representable.
- **Currency precision is `currencies.decimal_places`** — the unit a currency is actually denominated and *settled* in (2 for TTD/USD/GBP/EUR). Computed monetary amounts are rounded to this many places.

### 5.2 Rounding policy

- **Function:** banker's rounding (round-half-to-even) on computed monetary results, to the target currency's `decimal_places`. Half-to-even avoids the systematic upward bias of half-up across many lines. (This is a Decision Locked; the engine and currency code use one shared rounding helper so AR/AP, tax, and revaluation agree to the cent.)
- **What gets rounded:** any amount a person sees or settles — a line's `base_debit`/`base_credit`, a document's `base_total`, a tax amount, a revaluation delta. Rounding is applied to `decimal_places` of the *target* currency (base currency for `base_*` amounts).
- **What does NOT get rounded:** `fx_rate` itself is kept at full stored precision (`numeric`, many decimals). Rounding the rate, then multiplying, magnifies error; we round the *product*, not the rate.
- **Order of operations:** convert first at full rate precision, then round the result to base `decimal_places`. `base_debit = round_half_even(debit * fx_rate, base_dp)`.

### 5.3 Where rounding differences go

Two distinct sources of sub-cent residue, handled differently:

1. **Per-line conversion rounding** is already absorbed: each `base_*` is independently rounded to base `decimal_places`, so each line is internally consistent.

2. **Cross-line balancing residue.** When a balanced transaction-currency entry is converted line-by-line, the rounded `base_debit` total can differ from the rounded `base_credit` total by a cent or two (each line rounded independently; the roundings do not necessarily cancel). Because a posted entry **must** balance in base currency exactly (§7, `accounting-engine.md` §4.1), this residue must be posted somewhere. It is posted to a dedicated **Rounding / Exchange account** as a balancing line:

```
-- after converting all lines, compute the base imbalance:
delta := sum(base_debit) - sum(base_credit)         -- in base currency
if delta <> 0:
    if delta > 0:   -- base debits exceed base credits → add a base credit
        post line: account = FX/Rounding, base_credit = delta, credit = 0 (txn), fx_rate = 1
    else:           -- base credits exceed base debits → add a base debit
        post line: account = FX/Rounding, base_debit  = -delta, debit  = 0 (txn), fx_rate = 1
```

The plug line carries **zero transaction amount** and a non-zero `base_*` amount, so the entry still balances in transaction currency (the plug adds nothing there) while becoming exactly balanced in base currency. The account is an income/expense account ("Exchange Rounding" or "Realised Exchange Gain/Loss" — same account family as §5/§6); its sign over time nets to near zero. `delta` here is always small (a few minor units) — a large `delta` signals a genuine bug, not rounding, and should trip an assertion. Whether this account is auto-seeded per company or configured on company settings is an Open Question (echoing `accounting-engine.md`).

---

## 6. Realized vs unrealized FX gain/loss

### 6.1 Definitions

A **foreign-currency monetary balance** — an open USD receivable, an open USD payable, a USD bank balance — was recorded at the rate prevailing when it arose. As the rate moves, that balance is worth a different amount in base currency. The change in base value is an FX gain or loss:

- **Realized** gain/loss arises on **settlement** — when the foreign balance is actually collected, paid, or converted. The rate at settlement differs from the rate at origination; the difference is real cash-equivalent value gained or lost, and it is recognised when the settling document posts. *It has happened.*

- **Unrealized** gain/loss arises on **revaluation** of a *still-open* balance at a reporting date. We mark the open foreign balance to the period-end rate to state the balance sheet correctly, but no cash has moved — the gain/loss is on paper and may reverse before settlement. *It has not happened yet.*

Both hit an **FX Gain/Loss account** (income-statement, income side when a gain, expense side when a loss). Realized and unrealized may use the same account or two sub-accounts ("Realised FX" / "Unrealised FX"); presenting them separately is common and recommended.

### 6.2 Realized — recognised by the settling document

Realized FX is computed by the AR/AP settlement logic (see the AR/AP sibling doc) at the moment a receipt or payment posts, comparing the receipt-date rate to the original document rate. Worked through in §7.3. No special `source` is needed — it is part of the receipt/payment journal entry (`source = 'receipt'` / `'payment'`).

### 6.3 Unrealized — `source = 'fx_revaluation'`

Revaluation is a **period-end batch process** that marks open foreign-currency monetary balances to the period-end rate and posts the paper difference. Every entry it creates carries `source = 'fx_revaluation'` (`_ARCHITECTURE-SPEC.md` §8; `accounting.journal_source` enum in `accounting-engine.md` §1.1), which makes revaluation entries trivially identifiable, reportable, and reversible.

Algorithm (per company, per period-end date `d`):

```
for each monetary account A denominated in a foreign currency F (F <> base):
    open_txn   := transaction-currency balance of A as at d        -- e.g. USD 1,000
    recorded_base := base-currency carrying amount of A as at d    -- sum of base_* to date
    rate_d     := resolve_rate(company, F, base, d)                -- period-end rate
    revalued_base := round_half_even(open_txn * rate_d, base_dp)
    delta := revalued_base - recorded_base                         -- unrealized gain/loss
    if delta <> 0:
        post fx_revaluation entry (see pattern below)
```

**Debit/credit pattern.** The revaluation entry adjusts the foreign account's *base* carrying value while leaving its *transaction-currency* balance untouched (no USD moved). So every line is **base-only**: a non-zero `base_*` amount with **zero transaction amount** and `fx_rate` informational. The counter-line is the FX Gain/Loss account.

For a foreign **asset** (receivable, bank) whose base value **rose** (`delta > 0`, an unrealized gain):

| Account                 | base_debit | base_credit | debit (txn) | credit (txn) |
|-------------------------|-----------:|------------:|------------:|-------------:|
| Foreign asset (A)       |   delta    |      0      |      0      |      0       |
| Unrealised FX Gain/Loss |     0      |   delta     |      0      |      0       |

For a foreign asset whose base value **fell** (`delta < 0`, an unrealized loss), the sides flip: credit the asset's base value down, debit Unrealised FX Gain/Loss. For a foreign **liability** (payable), the gain/loss sense inverts (a rising rate on a payable is a loss). The entry balances trivially in transaction currency (all txn amounts zero) and exactly in base currency (the two `base_*` legs are equal and opposite).

### 6.4 Reversal of unrealized entries

Because unrealized FX is a paper estimate that the *next* settlement or revaluation supersedes, the standard policy is that each period-end revaluation entry is **auto-reversed on the first day of the next period** (a paired `fx_revaluation` reversal via `accounting.reverse_journal_entry`, `accounting-engine.md` §4.2/§5.3). This prevents double-counting: when the balance is later revalued again, or settled and its realized gain recognised, the prior unrealized estimate has already been backed out. The carrying amount thus always traces back to the frozen origination base plus realized settlements — never an accumulation of stale estimates.

---

## 7. Posting balance in dual currency

### 7.1 Balance in BOTH currencies — non-negotiable

From `_ARCHITECTURE-SPEC.md` §6.1 and `accounting-engine.md` §4.1: a journal entry may post only if

```
SUM(debit)      = SUM(credit)        -- transaction currency
AND SUM(base_debit) = SUM(base_credit)   -- base currency
```

Both equalities hold **exactly** (`numeric`, no float). The engine's `post_journal_entry` enforces both; application code never bypasses it. For a single-currency entry the second check is implied by the first (same rate on every line), but it is checked anyway because mixed-currency entries (§7.2) and rounding plugs (§5.3) make it a genuinely independent constraint.

### 7.2 Multi-currency entries — the transfer case

Some entries are denominated in more than one currency on their lines. The canonical example is a **transfer between a USD bank and a TTD bank**. Per-line `currency_code` and `fx_rate` exist precisely so each line converts on its own terms; the header `currency_code` becomes informational and **the base-currency equality carries the balance** (this is the mixed-currency case flagged in `accounting-engine.md` Open Questions, resolved here for transfers).

Worked: move **USD 1,000** out of the USD bank into the TTD bank, at a USD→TTD rate of **6.7800**, so TTD **6,780.00** lands.

| Account        | currency | debit (txn) | credit (txn) | fx_rate | base_debit | base_credit |
|----------------|----------|------------:|-------------:|--------:|-----------:|------------:|
| TTD Bank       | TTD      |  6,780.00   |      0       |  1.0000 |  6,780.00  |      0      |
| USD Bank       | USD      |     0       |   1,000.00   |  6.7800 |     0      |  6,780.00   |

- **Transaction currency:** the two lines are in *different* currencies, so `SUM(debit) = 6,780.00` and `SUM(credit) = 1,000.00` do **not** match as raw numbers — and that is expected. Each line is internally valid; there is no single transaction currency to balance against. The header currency is informational only.
- **Base currency:** `SUM(base_debit) = 6,780.00 = SUM(base_credit)`. **This is the equality that must hold**, and it does. Base currency is the common denominator that makes a multi-currency entry balanceable at all.

This is exactly why dual-amount storage is mandatory rather than convenient: without `base_*` on every line, a USD-to-TTD transfer simply cannot be expressed as a balanced double entry. (If the two banks happened to be the same currency, both `SUM`s match and the entry is ordinary.)

### 7.3 Realized gain/loss as a balanced multi-currency entry

The realized-FX worked example (§8.2) is itself a multi-currency entry: the cash and the receivable clear at *different* rates, and the base-currency difference is the realized gain/loss line that makes base debits equal base credits.

---

## 8. Worked examples

A TTD-base company (the default) trades with a US customer. Base currency **TTD**, `decimal_places = 2`.

### 8.1 A USD invoice to a TTD-base company

On **2026-03-01**, issue invoice for **USD 1,000.00**. Resolved USD→TTD rate (§3.3) for 2026-03-01 is **6.7500**. Captured `fx_rate = 6.7500`; `base_total = round(1000 × 6.75, 2) = TTD 6,750.00`. (Tax omitted for clarity; in reality VAT flows via `tax_codes`, `_ARCHITECTURE-SPEC.md` §9.)

Header: `invoices(currency_code = USD, fx_rate = 6.7500, total = 1000.00, base_total = 6750.00)`.

Journal entry (`source = 'invoice'`), currency USD throughout:

| Account                 | currency | debit (txn) | credit (txn) | fx_rate | base_debit | base_credit |
|-------------------------|----------|------------:|-------------:|--------:|-----------:|------------:|
| Accounts Receivable     | USD      |  1,000.00   |      0       |  6.7500 |  6,750.00  |      0      |
| Sales / Revenue         | USD      |     0       |   1,000.00   |  6.7500 |     0      |  6,750.00   |

Balances in **both** currencies: txn 1,000 = 1,000; base 6,750.00 = 6,750.00. The receivable now sits on the books at a **frozen** base value of TTD 6,750.00 carrying USD 1,000.00 (§4.2).

### 8.2 The receipt at a different rate — realized gain/loss

On **2026-04-15** the customer pays the full **USD 1,000.00** into the USD bank. The USD→TTD rate has moved to **6.9000** (USD strengthened against TTD). The receipt converts cash at the *receipt-date* rate; the receivable is cleared at its *original recorded* rate (6.7500); the difference is realized FX.

- Cash received in base: `round(1000 × 6.9000, 2) = TTD 6,900.00`.
- Receivable cleared in base: the frozen `TTD 6,750.00` from §8.1.
- **Realized gain** = 6,900.00 − 6,750.00 = **TTD 150.00** (we received more TTD value than the receivable carried).

Journal entry (`source = 'receipt'`), a multi-currency entry (§7.2):

| Account                  | currency | debit (txn) | credit (txn) | fx_rate | base_debit | base_credit |
|--------------------------|----------|------------:|-------------:|--------:|-----------:|------------:|
| USD Bank                 | USD      |  1,000.00   |      0       |  6.9000 |  6,900.00  |      0      |
| Accounts Receivable      | USD      |     0       |   1,000.00   |  6.7500 |     0      |  6,750.00   |
| Realised FX Gain/Loss    | TTD      |     0       |      0       |  1.0000 |     0      |   150.00    |

- **Transaction currency:** the two USD lines net to zero (1,000 in, 1,000 out); the FX line is base-only. USD nets to zero, as it must — the customer paid exactly the invoiced USD.
- **Base currency:** `SUM(base_debit) = 6,900.00`; `SUM(base_credit) = 6,750.00 + 150.00 = 6,900.00`. Balanced. The TTD 150 lands in income as a realized FX **gain**.

Had the rate fallen to, say, 6.6000, cash base would be TTD 6,600.00, the receivable still clears at 6,750.00, and the TTD 150.00 difference would be a realized **loss** — debit Realised FX Gain/Loss `base_debit = 150.00`, and the balancing flips accordingly.

### 8.3 Period-end revaluation — unrealized gain/loss

Variation: the customer has **not** paid by period end **2026-03-31**. The USD 1,000 receivable is still open, carried at its frozen TTD 6,750.00 (rate 6.7500). The 2026-03-31 USD→TTD rate is **6.8200**.

- Revalued base = `round(1000 × 6.8200, 2) = TTD 6,820.00`.
- Recorded carrying base = TTD 6,750.00.
- **Unrealized gain** `delta = 6,820.00 − 6,750.00 = TTD 70.00`.

Revaluation entry (`source = 'fx_revaluation'`), base-only legs (§6.3) — the receivable is a foreign **asset** whose base value rose:

| Account                  | currency | debit (txn) | credit (txn) | fx_rate | base_debit | base_credit |
|--------------------------|----------|------------:|-------------:|--------:|-----------:|------------:|
| Accounts Receivable      | USD      |     0       |      0       |  6.8200 |   70.00    |      0      |
| Unrealised FX Gain/Loss  | TTD      |     0       |      0       |  1.0000 |     0      |   70.00     |

- **Transaction currency:** all zero — no USD moved. Balanced (0 = 0). The receivable still carries USD 1,000.
- **Base currency:** 70.00 = 70.00. Balanced. The balance sheet at 2026-03-31 now states the receivable at TTD 6,820.00, and the income statement shows a TTD 70.00 unrealized gain.

On **2026-04-01** this entry **auto-reverses** (§6.4), restoring the carrying base to 6,750.00. When the receipt then posts on 2026-04-15 at 6.9000 (§8.2), the **full** realized gain of TTD 150.00 is recognised cleanly — the prior unrealized 70.00 was already reversed, so there is no double count. Across the two periods the company recognises 70.00 unrealized (Q1), −70.00 reversal, then 150.00 realized — net 150.00, exactly the true economic gain.

---

## 9. Reporting implications

### 9.1 Base currency is the reporting currency

All financial statements — trial balance, balance sheet, income statement, GL, AR/AP aging — are presented in the company's **base currency**, summing the `base_*` columns (`_ARCHITECTURE-SPEC.md` §8; the derived `general_ledger` view of `accounting-engine.md` §7 reads `base_debit`/`base_credit`). Because base amounts are frozen at transaction time (§4), every report is reproducible to the cent for any historical date with no dependence on the current rate table. A trial balance run today for 2026-03-31 returns the identical numbers it returned on 2026-03-31.

### 9.2 Optional transaction-currency columns

Operationally useful but never the books of record:

- **Foreign-currency sub-ledgers.** AR/AP aging and bank reconciliations can show the *transaction-currency* balance alongside base (a USD-denominated receivables aging showing USD 1,000 and TTD 6,820), so a user reconciling against a foreign bank statement sees the currency they actually hold.
- **Per-currency exposure report.** Aggregate open monetary balances by transaction currency to show net FX exposure ahead of revaluation — driven by the same open-balance query revaluation uses (§6.3).
- **Currency column on transaction listings.** Document lists show `currency_code`, transaction `total`, `fx_rate`, and `base_total` side by side, so the conversion is transparent and auditable on screen.

These are presentational overlays. The statutory and management financial statements are base-currency; transaction-currency figures are supplementary columns, clearly labelled, never substituted for the base totals.

### 9.3 FX gain/loss visibility

Because realized FX rides on `source = 'receipt'`/`'payment'` entries and unrealized on `source = 'fx_revaluation'`, the income statement can break out FX results by filtering journal `source` — total realized vs unrealized FX for a period is a single query over `journal_lines` joined to `journal_entries`, with no special tagging beyond the `source` enum the engine already records.

---

## Open Questions

- **Base-currency change.** Should the platform support changing a company's `base_currency_code` after transactions exist (a full re-statement migration), or is it permanently fixed at company creation? Current assumption: effectively immutable.
- **Rounding/FX account provisioning.** Auto-seed an "Exchange Rounding" and "FX Gain/Loss" account per company, or require them as configured accounts on company settings? (Shared question with `accounting-engine.md`.) And: one combined account or separate Realised / Unrealised / Rounding accounts?
- **Triangulation policy.** Is base-currency triangulation (§3.3 step 6) enabled by default, opt-in per company, or disallowed? It trades coverage for compounded spread error.
- **Inverse-rate storage.** Do any company/bank arrangements require storing both directions explicitly (bid/ask) rather than inverting at lookup? Affects the uniqueness key on `exchange_rates`.
- **Unrealized auto-reversal scope.** Confirm every `fx_revaluation` entry auto-reverses next period (§6.4), and whether any balance type should instead carry forward without reversal.
- **Rate feed source of record.** Which provenance(s) (`source`) feed the platform-wide rates, at what cadence, and what is the tie-break precedence when multiple sources publish the same `(pair, date)`?
- **Mixed-currency entries beyond transfers.** §7.2 resolves transfers; are there other genuinely mixed-currency single entries (e.g. multi-currency settlements) that need the same treatment? (Coordinate with `accounting-engine.md` Open Questions.)

## Decisions Locked

- **`accounting.currencies` is platform-wide reference data** (not company-scoped, not an enum) keyed by ISO-4217 `code`, carrying `decimal_places` that drive display and rounding precision while storage stays `numeric(20,4)`. (§2.1)
- **One base currency per company** (`core.companies.base_currency_code`, default **TTD**), effectively immutable once transactions exist; it is the denominator of every `base_*` column. (§2.2)
- **Dual-amount storage is mandatory:** every monetary line stores transaction-currency amounts AND base-currency equivalents, with `fx_rate` captured at transaction time and **never re-derived historically**, for historical accuracy, reproducibility, and the existence of realized FX. (§4)
- **`exchange_rates` are directional** (`from_currency → to_currency`), **company-specific overrides platform-wide** (`company_id` null = platform), looked up by **newest `rate_date <= transaction date`** with direct → inverse → optional triangulation precedence. (§3)
- **A missing rate fails loudly** at entry, posting, and revaluation — never defaulted, never guessed. (§3.4)
- **Banker's rounding to currency `decimal_places`**, on the *product* not the rate; cross-line base residue is plugged to a dedicated **Rounding/Exchange account** as a base-only balancing line. (§5)
- **Entries balance in BOTH transaction and base currency**; for multi-currency entries (e.g. a USD↔TTD bank transfer) the **base-currency equality carries the balance** and the header currency is informational. (§7)
- **Realized FX** is recognised on settlement within `receipt`/`payment` entries; **unrealized FX** is recognised by period-end **`source = 'fx_revaluation'`** entries (base-only legs against an FX Gain/Loss account) and **auto-reverses** the following period. (§6)
- **All reports are presented in base currency** by summing frozen `base_*` columns; transaction-currency figures are optional supplementary columns, never the books of record. (§9)

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative cross-cutting spec — money/dual-amount §4, schema names §5, double-entry invariants §6, multi-currency §8, T&T §9); `accounting-engine.md` (the ledger, `post_journal_entry` dual-currency balance check, `reverse_journal_entry`, `journal_source` enum, derived `general_ledger`). Sibling AR/AP, tax, and import docs originate the documents whose realized FX (AR/AP), tax conversion (tax), and rate-bearing rows (import) flow through the rules defined here.
