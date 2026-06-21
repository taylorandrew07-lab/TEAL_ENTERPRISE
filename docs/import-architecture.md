# Import / Migration Architecture

**TEAL Enterprise — Accounting Module**
Owning agent: Import / Migration Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive reference for how external and legacy data is brought into the
Accounting module: the staged import framework (`accounting.import_batches` +
`accounting.import_staging_rows`), the upload → validate → commit lifecycle, the per-type validation
rules, the column-mapping configuration, and the opening-balance migration strategy used to move the
Taylor group companies off **AccountEdge Pro / MYOB**. It conforms to `_ARCHITECTURE-SPEC.md`
throughout and integrates with the ledger through the `source`/`source_id` contract and the
`post_journal_entry` function defined in `accounting-engine.md`.

> **The one rule that governs everything here.** Imports are *always staged and validated*, and
> **nothing is written to live accounting tables until a batch is `validated` and explicitly
> committed** (spec §10). The staging tables are a quarantine; the live tables are downstream of an
> explicit, permission-gated, transactional commit.

---

## 1. Scope and design stance

Migration is a first-class, Phase-1 capability, not an afterthought: the Taylor group runs on
AccountEdge Pro / MYOB today, and go-live means moving real charts of accounts, customer/supplier
cards, open AR/AP items, opening balances, and a window of historical transactions onto TEAL with
**zero loss and provable balance**. Every byte of that migration passes through the staged framework.

Design principles:

- **Quarantine before commit.** Raw rows land in `import_staging_rows` and are never trusted. Live
  tables (`accounts`, `customers`, `journal_entries`, …) are written only by the commit step, only
  for a `validated` batch, only inside one transaction.
- **The ledger owns balance, not the importer.** Transactional imports (opening balances, journals)
  build `draft` journal entries and post them through `accounting.post_journal_entry`
  (`accounting-engine.md` §5.2). The importer never bypasses the posting function, the immutability
  triggers, or the period gate. An unbalanced import cannot become a posted entry — the engine
  rejects it exactly as it would reject a hand-keyed unbalanced journal.
- **Idempotent and re-runnable.** A batch can be uploaded, validated, fixed, and re-validated any
  number of times before commit, and the engine's `unique (company_id, source, source_id)` guard
  (`accounting-engine.md` §9) makes a re-run of a committed transactional import a no-op rather than
  a double-post.
- **No fake data, no shortcuts.** No demo seeds, no "import then fix later." A batch either commits
  clean or does not commit (spec §10).

---

## 2. The staged framework — tables

The framework is exactly the two tables in `_ARCHITECTURE-SPEC.md` §5, used as the spec mandates. No
new tables are required for Phase 1; mapping templates are configuration (§7) and may be stored as a
`jsonb` column or a small reference table (Open Question).

### 2.1 `accounting.import_batches` — the batch header

```
accounting.import_batches(
    id           uuid PK default gen_random_uuid(),
    company_id   uuid not null references core.companies(id),
    import_type  -- 'chart_of_accounts' | 'customers' | 'suppliers'
                 -- | 'opening_balances' | 'journal_entries'
                 -- | 'invoices' | 'bills' | 'bank_transactions'
    source_system -- 'accountedge_pro' | 'myob_accountright' | 'myob_business'
                  -- | 'quickbooks' | 'xero' | 'csv_generic'
    status       enum[uploaded, validating, validated, failed, committed],
    file_path    -- Supabase Storage object path of the uploaded source file
    row_count    -- total data rows parsed from the file
    error_count  -- number of staging rows currently in error (batch-level rollup)
    created_by   uuid references core.users(id),
    created_at   timestamptz default now()
)
```

Notes on usage of the spec columns:

- `import_type` and `source_system` together pick the **parser**, the **mapping template** (§7), and
  the **validation rule set** (§5). They are the batch's routing key.
- `file_path` is the Storage object key (§4.1), never the file contents.
- `row_count` is the number of *data* rows (header row excluded), set at parse.
- `error_count` is the batch-level rollup of per-row errors (§8). `0` is the precondition for the
  batch to reach `validated`.
- `created_by` is the migrating user; commit and validate permissions are gated against them (§9).

### 2.2 `accounting.import_staging_rows` — the quarantine

```
accounting.import_staging_rows(
    id         uuid PK default gen_random_uuid(),
    batch_id   uuid not null references accounting.import_batches(id),
    company_id uuid not null,                 -- denormalized for RLS (spec §4, §7)
    row_no     int  not null,                 -- 1-based source row ordinal (stable across re-runs)
    raw        jsonb not null,                -- the parsed source row, column-name → value, verbatim
    mapped     jsonb,                         -- canonical fields after column mapping (§6)
    status     -- 'pending' | 'valid' | 'error' | 'committed' | 'skipped'
    errors     jsonb                          -- array of per-row error objects (§8)
)
```

- `raw` is the **source of truth for the row** — the verbatim parsed cells keyed by the source
  column header. It is written once at parse and never mutated; re-mapping and re-validation
  recompute `mapped`/`status`/`errors` but leave `raw` intact, which is what makes a batch
  re-runnable (§10).
- `mapped` is the canonical representation produced by applying the mapping template to `raw`
  (§6). Validation reads `mapped`, not `raw`.
- `row_no` is stable: it ties a staging row to a physical source row so a user fixing line 47 in the
  preview is fixing the same line on re-validate.
- `status` is the per-row state (§3.3); `errors` is the per-row error list (§8).

> Per spec §8.3 of the engine doc, `row_no` is an *internal ordinal where gaps are harmless* — it is
> not an auditor-facing number and may come from a plain counter.

---

## 3. Lifecycle

### 3.1 Batch state machine

```
                 parse OK                 all rows valid           commit (txn)
   ┌──────────┐ ──────────► ┌────────────┐ ──────────► ┌───────────┐ ─────────► ┌───────────┐
   │ uploaded │             │ validating │             │ validated │            │ committed │
   └──────────┘ ◄──────────  └────────────┘ ──────────► └───────────┘            └───────────┘
        │  parse/validate         any row in error           │ re-validate            (terminal,
        │  fails fatally                │                     │ after edits             immutable)
        ▼                               ▼                     ▼
   ┌────────┐                      ┌────────┐  ◄── fix & re-validate ──┘
   │ failed │                      │ failed │  (failed → validating again)
   └────────┘                      └────────┘
```

| Status       | Meaning                                                                                  | Live tables touched? |
|--------------|------------------------------------------------------------------------------------------|----------------------|
| `uploaded`   | File is in Storage and the batch row exists; not yet parsed/mapped/validated.             | No |
| `validating` | Parse + map + validation rules are running (or queued for large files, §11).              | No |
| `validated`  | `error_count = 0`; every row is `valid`. The batch is **eligible** for commit.            | No (preview only) |
| `failed`     | At least one row is in error, or a fatal structural/parse error occurred.                 | No |
| `committed`  | Commit transaction succeeded; rows are reflected in live tables. **Terminal.**            | **Yes (only here)** |

The invariant restated against this table: **only the `validated → committed` transition writes live
data, and it does so atomically.** `uploaded`, `validating`, `validated`, and `failed` are all
read-only with respect to the live accounting tables. A batch can bounce between `failed` and
`validating` indefinitely as the user fixes and re-validates; it cannot reach `committed` without
first being `validated`.

### 3.2 Why `validated` is a distinct, sticky state

`validated` is a *gate*, not a transient. Validation produces a **preview** (§3.4) the user reviews
before committing. The batch can sit at `validated` while the user inspects the preview, and commit
is a deliberate second action (with its own permission, §9). If the underlying live data changes
between validation and commit in a way that would break a referential rule (e.g. an account the
import depends on is deactivated), the commit step re-asserts the critical referential and balance
rules inside the commit transaction (§3.5) and aborts rather than committing stale-valid data.

### 3.3 Row state machine

```
pending ──map+validate──► valid ──commit──► committed
   │                        ▲
   └──validate fails──► error┘   (fix in preview, or fix source mapping, then re-validate)
                          │
                          └──user marks non-essential row──► skipped (excluded from commit)
```

- `pending` — parsed, not yet validated (or invalidated by an edit awaiting re-validation).
- `valid` — passed every applicable rule; `errors` is empty.
- `error` — failed one or more rules; `errors` lists them (§8). Blocks the batch from `validated`.
- `skipped` — user-excluded (e.g. a blank trailer row, or a duplicate they choose to drop). Skipped
  rows are ignored by both validation rollup and commit.
- `committed` — written to live tables by the commit step.

### 3.4 Preview / review

When a batch reaches `validated`, the UI renders a **preview** entirely from staging — no live writes:

- For **master-data** imports (CoA, customers, suppliers): the canonical records that *would* be
  created/updated, with a per-row "new vs update vs duplicate" badge from duplicate detection (§5.5).
- For **transactional** imports (opening balances, journals, invoices, bills, bank transactions): the
  **proposed journal entries** rendered as Dr/Cr lines, plus the aggregate proof (e.g. "Trial balance
  nets to 0.00"; "Opening balance entry balances: Dr 1,284,300.00 = Cr 1,284,300.00").

The preview is the human checkpoint that satisfies "no reports/dashboards before real data" in spirit:
the user sees the *exact* postings before any of them exist in the ledger.

### 3.5 Commit (transactional)

Commit runs in a single database transaction (a `security definer` function, e.g.
`accounting.commit_import_batch(p_batch_id)`), permission-gated by `import.commit` (§9). In order:

1. **Re-assert preconditions.** Batch is `validated`; `error_count = 0`; no row is `pending`/`error`.
   Re-run the *critical* referential and accounting rules (§5) against current live data inside the
   transaction (catching changes since validation, §3.2).
2. **Write live rows by type.** Master-data imports upsert into `accounts` / `customers` /
   `suppliers`. Transactional imports build `draft` journal entries and call
   `accounting.post_journal_entry` for each (`accounting-engine.md` §5.2) — inheriting balance,
   period, and immutability enforcement for free. Document imports (invoices/bills) insert the
   document header+lines and post the document's entry with the appropriate `source`.
3. **Record provenance.** Stamp each committed staging row with the live `id`(s) it produced (in
   `mapped` or `errors`-adjacent provenance, e.g. `mapped.committed_ref`), set row `status =
   'committed'`, and write a `core.audit_logs` row for the batch commit (spec §5 audit, §27 of the
   audit doc).
4. **Flip the batch.** `import_batches.status = 'committed'`.

If **any** step raises, the whole transaction rolls back: no live rows, no posted entries, batch
stays `validated` (or is moved to `failed` with the error recorded). This is the rollback semantics —
all-or-nothing per batch. There is no partial commit.

### 3.6 Rollback semantics

- **Pre-commit:** trivial — nothing live exists. Re-validating, editing mappings, or deleting the
  batch discards only staging rows and the Storage object.
- **During commit:** the commit transaction rolls back atomically on any failure (§3.5). Because
  transactional imports post via `post_journal_entry`, a mid-commit failure leaves zero posted
  entries from this batch (each post is inside the same transaction).
- **Post-commit ("undo a committed batch"):** a committed batch is **not** deleted, because posted
  journal entries are immutable (spec §6 invariant 2). Undo is achieved by **reversing** every
  journal entry the batch posted — `accounting.reverse_journal_entry` per entry
  (`accounting-engine.md` §5.3) — and deactivating (not deleting) any master records it created that
  have no postings. The batch carries the list of produced entry ids (from step 3), so "reverse this
  import" is a deterministic loop. Master records with postings are deactivated (`is_active = false`),
  never hard-deleted, matching the engine's never-delete-posted-history stance.

---

## 4. The pipeline stages

```
 upload ──► parse ──► map ──► validate ──► preview/review ──► commit ──► (rollback = reverse)
(Storage)  (CSV/    (raw→    (rules per     (from staging)   (txn,        (post-commit)
           Excel)   mapped)   type, §5)                       post_journal_entry)
```

### 4.1 Upload — to Supabase Storage

The source file is uploaded to a private Supabase Storage bucket, e.g.
`imports/{company_id}/{batch_id}/{original_filename}`, and `import_batches.file_path` is set to that
object key. Access is RLS/policy-scoped to the company (spec §7). The file is retained for audit and
for re-parse (re-run, §10); it is the immutable source artifact. The batch is created with
`status = 'uploaded'`. Storage holds the bytes; Postgres holds the batch metadata — the file
contents are never copied into `import_batches`.

### 4.2 Parse — CSV / Excel

A parser selected by `source_system` reads the object from Storage and produces one
`import_staging_rows` row per data row, with `raw` = the cell map keyed by the source header. Supported:

- **CSV** — AccountEdge Pro and MYOB both export tab- or comma-delimited text. Handle delimiter
  sniffing, quoted fields, embedded newlines, and the **MYOB/AccountEdge BOM + tab-delimited `.txt`**
  convention. Detect and skip the header row; capture it to drive auto-mapping (§6).
- **Excel (.xlsx/.xls)** — read the first/declared sheet; coerce cells to text for `raw` (mapping and
  validation do typed coercion later, §5.1). Excel date serials are normalized to ISO dates here.

Parse failures that are *structural* (unreadable file, no header, zero data rows, wildly inconsistent
column counts) move the **batch** to `failed` immediately with a batch-level error. Row-level oddities
(a bad date in row 12) are *not* parse failures — they surface as row errors in validation.
`row_count` is set to the number of data rows parsed.

### 4.3 Map — raw `jsonb` → mapped `jsonb`

The mapping template (§6) for `(source_system, import_type)` is applied to each row's `raw` to produce
`mapped`: source columns are renamed/transformed into the **canonical field names** for the type, with
source-quirk handling (sign conventions, MYOB account-number formatting, etc.). `mapped` is what every
validation rule and the commit step read. Re-running map is cheap and side-effect-free — it only
rewrites `mapped`.

### 4.4 Validate — rules per type

The validation rule set for the `import_type` runs over `mapped` (and, for cross-row rules like
trial-balance-nets-to-zero, over the batch). Each failing rule appends an error object to the row's
`errors` and sets `status = 'error'`; clean rows become `valid`. The batch `error_count` is the count
of `error` rows. If `error_count = 0`, the batch becomes `validated`; otherwise `failed`
(re-validatable). Full rule catalogue in §5.

### 4.5 Preview / review, 4.6 Commit, 4.7 Rollback

Covered in §3.4–§3.6.

---

## 5. Validation

Validation is layered. A row must clear **structural → referential → accounting → currency →
duplicate** checks (cheapest/most-fundamental first; later layers may be skipped once a row is already
in error to keep the error list focused, or run fully to give the user every problem at once — TEAL
runs all applicable layers and reports all findings, matching the trial-balance "show everything"
ethos). Rules are expressed as pure predicates over `mapped` (+ batch context); none of them write
live data.

### 5.1 Structural

Type/shape of the value, independent of any other data.

- Required canonical fields present and non-empty.
- Numbers parse to `numeric`; dates parse to ISO; codes match expected shape.
- Money coerces to `numeric(20,4)`; no more than the currency's `decimal_places` (spec §5 currencies).
- Enumerated source values are recognized (e.g. an MYOB account "Account Type" string maps to a known
  `account_type` key).

```
rule structural.required_fields(row, required[]):
    for f in required:
        if is_blank(row.mapped[f]):
            error(row, code='REQUIRED_MISSING', field=f, message=f+' is required')

rule structural.numeric(row, field):
    if row.mapped[field] is not null and not parses_numeric(row.mapped[field]):
        error(row, code='NOT_NUMERIC', field=field,
              value=row.mapped[field], message=field+' is not a number')
```

### 5.2 Referential

The thing this row points at must exist (in live tables or earlier in the same batch).

- Customer/supplier import: `receivable_account_id` / `payable_account_id` resolves to an existing,
  active `accounting.accounts` row of the correct control type.
- Invoice/bill import: the `customer`/`supplier` exists (by code or name) and each line's
  `account_id` resolves to an active GL account; `tax_code` resolves to an active `tax_codes` row.
- Opening balances / journals: every account code resolves to an active leaf account
  (`accounting-engine.md` §2.3 — post only to leaves).

**Intra-batch references.** A combined migration may import the chart *and* customers in one go (or as
ordered batches). A referential rule resolves first against committed live data, then against rows
**earlier in the same validated batch** (e.g. a customer's receivable account is a new account in the
same CoA batch). Ordering of import types at go-live: **chart of accounts → tax codes → customers /
suppliers → opening balances → historical documents/journals → bank transactions.**

```
rule referential.account_exists(row, field):
    code = row.mapped[field]
    if not exists_active_account(company_id, code)
       and not defined_earlier_in_batch(batch, code):
        error(row, code='ACCOUNT_NOT_FOUND', field=field, value=code,
              message='account '+code+' does not exist or is inactive')
```

### 5.3 Accounting

The deep checks that make TEAL refuse bad books.

- **Trial balance / opening balance must net to zero.** For an `opening_balances` or
  `journal_entries` batch, `SUM(debit) = SUM(credit)` across the rows that form one entry (in
  transaction *and* base currency, mirroring `accounting-engine.md` §4.1). This is a **batch-level**
  (cross-row) rule.
- **Line-level sanity.** A row cannot be both debit and credit; amounts non-negative (mirrors the
  `journal_lines` CHECKs, `accounting-engine.md` §3.2).
- **Document math.** Invoice/bill: `subtotal + tax_total = total`; `SUM(line_total) = subtotal`.
- **Period openness.** Transactional rows' dates fall in an existing **open** period (the commit will
  post them; pre-checking here gives the user the error in preview, not at commit).

```
rule accounting.batch_balances(batch):
    sum_d  = SUM(row.mapped.debit  for row in batch where row.status != 'skipped')
    sum_c  = SUM(row.mapped.credit for row in batch where row.status != 'skipped')
    sum_bd = SUM(row.mapped.base_debit  ...)
    sum_bc = SUM(row.mapped.base_credit ...)
    if sum_d != sum_c:
        batch_error(code='BATCH_UNBALANCED_TXN',
            message='debits '+sum_d+' != credits '+sum_c+
                    ' — add Opening Balance Equity line for the difference')
    if sum_bd != sum_bc:
        batch_error(code='BATCH_UNBALANCED_BASE', ...)
```

> Note the importer does **not** auto-balance silently. As in the engine (`accounting-engine.md`
> §4.3), an imbalance is surfaced; the user resolves it (commonly by adding/letting the importer add
> the explicit Opening Balance Equity balancing line, §6.4 / §7's opening-balance strategy below).

### 5.4 Currency

- `currency_code` is a known active `accounting.currencies` row.
- A row with a non-base currency carries an `fx_rate` (or one is resolvable from
  `accounting.exchange_rates` for `entry_date`); `base_debit`/`base_credit` are derived as
  `round(amount * fx_rate, 4)` and re-checked for base-currency balance (spec §8;
  `accounting-engine.md` §3.2). FX rates are captured at transaction time and never re-derived (spec
  §8) — for historical imports the rate from the source system (or the migration-date rate) is used
  and frozen.
- Bank/account currency consistency: a row posting to a currency-pinned account
  (`accounts.currency_code`) must use that currency.

### 5.5 Duplicate detection

- **Master data:** detect by natural key per type — account `code`, customer/supplier `code` (then
  `name`+`tax_reg_no` as a soft match). Result drives the preview badge: *new* (insert), *update*
  (matched existing — upsert), or *duplicate within file* (two source rows collide → one flagged).
- **Documents:** detect by `(customer, invoice_no)` / `(supplier, bill_no)` against live documents and
  within the batch.
- **Transactional re-run:** the engine's `unique (company_id, source, source_id)` is the *hard*
  backstop (`accounting-engine.md` §9). Duplicate detection here is the *soft, user-facing* warning so
  duplicates are caught at preview rather than as a commit-time unique violation.

```
rule duplicate.master_code(row, type):
    code = row.mapped.code
    if exists_live(type, company_id, code):
        warn(row, code='DUPLICATE_EXISTING', field='code', value=code,
             action='update', message='will update existing '+type+' '+code)
    if appears_more_than_once_in_batch(batch, code):
        error(row, code='DUPLICATE_IN_FILE', field='code', value=code,
              message='code '+code+' appears multiple times in this file')
```

### 5.6 Validation rules per import type (summary)

| Import type | Key structural | Key referential | Key accounting | Currency | Duplicate |
|-------------|----------------|-----------------|----------------|----------|-----------|
| **chart_of_accounts** | code, name, account type present; code shape | parent code exists (live or in-batch); account-type key known; child category matches parent (`accounting-engine.md` §2.3) | — | optional `currency_code` known | account `code` unique |
| **customers** | code, name present | `receivable_account_id` is an active AR control account | — | `currency_code` known | customer `code` unique |
| **suppliers** | code, name present | `payable_account_id` is an active AP control account | — | `currency_code` known | supplier `code` unique |
| **opening_balances / trial_balance** | account, debit/credit numeric | every account code resolves to active leaf account | **batch nets to zero (txn + base)**; not-both-sides; balancing OBE line | per-row currency + fx_rate; base balance | one row per account |
| **journal_entries** | entry_date, account, debit/credit | account codes resolve; period open for date | **each entry balances** (group by entry key); not-both-sides | fx_rate + base balance | `(source_ref)` unique |
| **invoices** | invoice_no, date, customer, line account/amount | customer exists; line accounts + tax codes resolve | `subtotal+tax=total`; `Σline_total=subtotal`; period open | currency + fx_rate | `(customer, invoice_no)` |
| **bills** | bill_no, date, supplier, line account/amount | supplier exists; line accounts + tax codes resolve | `subtotal+tax=total`; period open | currency + fx_rate | `(supplier, bill_no)` |
| **bank_transactions** | date, amount, bank account | bank account resolves to a `bank_accounts`/GL account; contra account resolves | not-both-sides; period open | account currency consistency | `(bank_account, date, amount, ref)` |

---

## 6. Mapping configuration

### 6.1 What a mapping is

A mapping is a declarative transform from a source file's columns to the type's **canonical fields**.
It lives as `jsonb` (a saved template, §6.3) and is applied at the map stage (§4.3) to turn `raw` into
`mapped`. A mapping entry per canonical field names: the source column(s), an optional transform, an
optional constant default, and whether it is required.

### 6.2 Example — AccountEdge Pro chart of accounts

AccountEdge / MYOB export the chart as a tab-delimited file. Representative source columns:

```
Account Number    Account Name              Header   Account Type       Currency   Opening Balance
1-1100            Business Bank Account #1  N        Bank               TTD        50000.00
1-1200            Trade Debtors             N        Accounts Receivable TTD       10000.00
2-2100            Trade Creditors           N        Accounts Payable   TTD        8000.00
4-1000            Sales Income              N        Income             TTD        0.00
6-1000            General Expenses          N        Expense            TTD        0.00
```

Mapping JSON (`source_system = 'accountedge_pro'`, `import_type = 'chart_of_accounts'`):

```json
{
  "source_system": "accountedge_pro",
  "import_type": "chart_of_accounts",
  "delimiter": "\t",
  "has_header": true,
  "fields": {
    "code": {
      "from": "Account Number",
      "transform": "strip_hyphen",
      "required": true,
      "note": "MYOB '1-1100' -> '11100'; configurable to keep the hyphen"
    },
    "name":            { "from": "Account Name", "required": true },
    "is_header":       { "from": "Header", "transform": "yn_to_bool" },
    "account_type_key":{ "from": "Account Type", "transform": "map_account_type", "required": true },
    "currency_code":   { "from": "Currency", "default": "TTD" },
    "opening_balance": { "from": "Opening Balance", "transform": "to_numeric_4" }
  },
  "lookups": {
    "map_account_type": {
      "Bank": "bank",
      "Accounts Receivable": "accounts_receivable",
      "Accounts Payable": "accounts_payable",
      "Income": "income",
      "Expense": "expense",
      "Other Current Asset": "current_asset",
      "Fixed Asset": "fixed_asset",
      "Other Current Liability": "current_liability",
      "Equity": "equity"
    }
  }
}
```

Resulting `mapped` for the first data row:

```json
{
  "code": "11100",
  "name": "Business Bank Account #1",
  "is_header": false,
  "account_type_key": "bank",
  "currency_code": "TTD",
  "opening_balance": "50000.0000"
}
```

### 6.3 Saved mapping templates per source system

Mappings are saved and reused so go-live across the Taylor group companies is repeatable. A template
is keyed by `(source_system, import_type)` and versioned. TEAL ships **built-in templates** for the
expected sources:

- `accountedge_pro` — tab-delimited `.txt`/CSV; `1-xxxx` account-number ranges; "Card" exports for
  customers/suppliers; "Journal" / "General Journal" exports for transactions.
- `myob_accountright` / `myob_business` — same number-range convention; slightly different column
  headers; `.txt` (tab) and CSV.
- `quickbooks`, `xero` — reference templates (IIF / CSV) for companies not on MYOB.
- `csv_generic` — a no-assumptions template the user maps by hand in the UI.

A user opens a batch, the parser reads the header row, and the built-in template **auto-maps** by
matching source headers; the user adjusts any unmatched columns in the mapping UI and **saves** the
result as a (company-scoped) template for the next file. Auto-map confidence is shown per column; an
unmatched required field blocks validation with a clear "map this column" prompt.

### 6.4 Handling source-system quirks

The map stage is where AccountEdge/MYOB idiosyncrasies are normalized, so validation and commit see
clean canonical data:

- **Account-number format.** MYOB `1-1100` → canonical `code`. Default transform strips the hyphen;
  configurable to preserve it. The number's leading digit (1/2/3/4/6…) is *not* trusted for category —
  the explicit "Account Type" column is mapped instead (§6.2 `map_account_type`).
- **Header vs detail accounts.** MYOB "Header" accounts are non-posting roll-up parents → mapped to
  `is_header`/parent rows; only detail accounts are posted to (`accounting-engine.md` §2.3).
- **Sign conventions.** MYOB opening balances and journal exports may carry a single signed "Amount"
  column rather than separate Debit/Credit, and credits may be negative. A `split_signed_amount`
  transform turns one signed column into `{debit, credit}` per the account's normal balance.
- **Debit/Credit columns.** Where the export *does* have separate columns, map directly; blank = 0.
- **Dates.** MYOB `DD/MM/YYYY` and Excel serials → ISO `YYYY-MM-DD` (T&T locale).
- **Tax codes.** MYOB tax codes (e.g. `VAT`, `GST`, `N-T`) → `accounting.tax_codes.code` via a lookup;
  `N-T` ("not taxable") maps to no tax line.
- **Multi-currency cards.** MYOB foreign-currency customer/supplier currency → `currency_code`; the
  account's currency pin is validated (§5.4).
- **Opening Balance column on cards/accounts.** When the CoA/customer/supplier export carries opening
  balances inline, those are *not* applied as master-data fields; they are routed into the
  **opening-balance** import (§7) so they post as a balanced journal entry, never as a silent field.

---

## 7. Opening balances strategy

Opening balances are the heart of the migration and the place the staged framework most clearly earns
its keep. The strategy: **opening balances become one balanced journal entry with
`source = 'opening_balance'`**, posted through the engine, dated at the migration cut-over.

### 7.1 From staged rows to one balanced entry

An `opening_balances` batch stages one row per account (and per open AR/AP item, §7.3), each with a
debit or credit. On commit, the importer builds **one** `draft` journal entry whose lines are those
rows, dated the cut-over date in the first open period, and posts it via
`accounting.post_journal_entry` (`accounting-engine.md` §5.2, §10.5). Because the engine enforces
`SUM(debit) = SUM(credit)` in both currencies, the opening entry **cannot post unless it balances** —
which is exactly the §5.3 accounting validation, re-asserted at commit.

Example proposed entry (preview), TTD base:

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Business Bank Account (`bank`) | 50,000.00 | |
| 2 | Trade Debtors / AR control (`accounts_receivable`) | 10,000.00 | |
| 3 | Trade Creditors / AP control (`accounts_payable`) | | 8,000.00 |
| 4 | … remaining asset/liability/equity/retained-earnings accounts … | … | … |
| N | **Opening Balance Equity** (`equity`) | | *balancing* |

### 7.2 Opening Balance Equity / suspense account (partial migrations)

A full migration of *every* account nets to zero on its own and needs no plug. Real migrations are
rarely complete in one shot — you bring in cash, AR, AP, and fixed assets first, and the rest later.
The difference is parked in a dedicated **Opening Balance Equity (OBE)** account (an `equity`/suspense
account):

- Each opening-balance batch balances **against OBE**: the importer computes the difference between
  total debits and credits of the staged accounts and posts the balancing line to OBE. This lets a
  *partial* set of accounts post a balanced entry today.
- As later batches bring in the remaining accounts, each balances against OBE again. When migration is
  complete, **OBE should net to zero** (or to a known, explained residual such as prior-year retained
  earnings, which is then reclassified by a manual journal). A non-zero OBE after go-live is a visible
  "migration not finished / something doesn't tie out" flag — the suspense account does its job.
- OBE is also the counter-account for **per-customer/supplier opening items** (§7.3): Dr AR control /
  Cr OBE for receivables, Dr OBE / Cr AP control for payables, preserving aging by original invoice
  date (`accountedge-myob-audit.md` §19).

This is the standard, audit-friendly approach: no opening balance is invented against income/expense
(which would distort the first period's P&L); everything lands against equity/suspense and is
reconciled to zero as the picture completes.

### 7.3 Sub-ledger detail (AR/AP open items)

The GL effect of opening AR/AP is the single control-account line above. The **detail** — which
customer owes what, on which invoice, aged from which date — is reconstructed by the AR/AP layer from
the migrated open-item rows (a separate `invoices`/`bills` opening import, or open-item lines within
the opening-balance batch). The sub-ledger total must equal the control-account opening balance — a
referential/accounting cross-check (§5.2/§5.3) before commit.

---

## 8. Error reporting

### 8.1 Per-row errors in `errors jsonb`

Each staging row's `errors` is an **array of error objects**, one per failed rule, so a user sees
*every* problem with a row at once (not just the first):

```json
[
  {
    "code": "ACCOUNT_NOT_FOUND",
    "layer": "referential",
    "field": "receivable_account_id",
    "value": "11250",
    "message": "account 11250 does not exist or is inactive",
    "severity": "error"
  },
  {
    "code": "NOT_NUMERIC",
    "layer": "structural",
    "field": "opening_balance",
    "value": "5,0O0.00",
    "message": "opening_balance is not a number (contains a letter 'O')",
    "severity": "error"
  }
]
```

Fields: `code` (stable machine code), `layer` (structural/referential/accounting/currency/duplicate),
`field` (canonical field, or null for batch/cross-row rules), `value` (the offending value),
`message` (human text), `severity` (`error` blocks commit; `warning` is informational, e.g. a
duplicate that will update). A row is `error` if it has any `severity = 'error'` entry.

### 8.2 Batch-level rollup

`import_batches.error_count` is the count of rows with `status = 'error'`. Cross-row failures (e.g.
`BATCH_UNBALANCED_TXN`, §5.3) are surfaced as a batch-level error (attached to a synthetic batch error
list and/or the offending rows) and likewise block `validated`. The UI shows: total rows, valid,
error, warning, skipped — and, for transactional batches, the **balance proof** (Dr total, Cr total,
difference). A single number — "0 errors" — is the green light to commit.

### 8.3 How a user fixes and re-validates

The fix loop is deliberately tight and re-runnable (§10):

1. **Inspect.** The preview groups errors by `code`/`field` so systemic problems are obvious
   ("47 rows: ACCOUNT_NOT_FOUND for account 11250" → the account simply wasn't imported yet).
2. **Fix at the right layer:**
   - **Mapping problem** (wrong column mapped, missing transform) → edit the mapping template (§6) and
     **re-map + re-validate** the whole batch. One fix clears many rows.
   - **Source-data problem** (a genuine typo in the file) → either fix the source file and **re-upload
     /re-parse**, or edit the row's `mapped` value inline in the preview (the edit sets the row back to
     `pending` and is re-validated). `raw` is preserved; only `mapped` changes.
   - **Ordering problem** (referenced account/customer not yet imported) → import the prerequisite
     batch first, then re-validate (intra-/inter-batch resolution, §5.2).
   - **Non-essential row** → mark `skipped` to exclude it.
3. **Re-validate.** Re-running validation recomputes `status`/`errors` for every row from `mapped`. As
   `error_count` reaches 0 the batch flips `failed → validating → validated`.
4. **Commit.** With 0 errors and a clean balance proof, the user (with `import.commit`) commits (§3.5).

Nothing in this loop touches live tables — the entire fix cycle happens in quarantine.

---

## 9. Permissions, audit, idempotency, large files

### 9.1 Permissions (data-driven, spec §7)

Import actions are gated by data-driven permissions, never hard-coded:

- `import.create` / `import.upload` — create a batch, upload a file.
- `import.validate` — run mapping + validation.
- `import.commit` — the privileged action that writes live data; typically Company Admin /
  Accountant. Checked inside `commit_import_batch` via `core.has_permission(company_id,
  'import.commit')` (spec §7), in addition to RLS scoping the batch to the user's company.
- `import.rollback` — reverse a committed batch (§3.6).

RLS on `import_batches` / `import_staging_rows` scopes every row by `company_id` exactly like the rest
of the schema (spec §7); a user only ever sees and acts on their own company's imports.

### 9.2 Audit

Batch lifecycle transitions (`validated`, `committed`, rollback) and the commit's live writes are
recorded in `core.audit_logs` (spec §5; `accountedge-myob-audit.md` §27), with `before`/`after`
capturing the batch state and the produced entry/record ids. The Storage file is the retained source
artifact. Posted opening/journal entries are immutable and reversal-only like all posted history.

### 9.3 Idempotency and re-runs

- **Pre-commit re-runs are free.** Re-parse/re-map/re-validate any number of times; `raw` is stable,
  `mapped`/`status`/`errors` are recomputed; `row_no` is stable so fixes stick.
- **Commit is idempotent at the boundary.** Transactional imports post via `post_journal_entry`, and
  `journal_entries`' `unique (company_id, source, source_id)` (`accounting-engine.md` §9) means a
  replayed commit of the same logical document cannot double-post — it hits the unique guard and the
  service reads back the existing entry. The importer derives a **stable `source_id`** per logical
  entry (e.g. a deterministic id from the batch + natural key) so re-running a partially-committed
  batch (after a crash) skips already-posted entries and completes the rest, rather than duplicating.
- **A committed batch is terminal**; "re-importing" the same data is a new batch whose duplicate
  detection (§5.5) flags every row as an existing-record update or a would-be duplicate.

### 9.4 Large-file handling

Go-live files (years of transactions) can be large. Strategy:

- **Stream the parse.** Read the Storage object as a stream and **batch-insert** staging rows
  (chunked), never loading the whole file into memory.
- **Async validation for big batches.** Validation runs as a background job; the batch sits at
  `validating` and the UI polls/streams progress (rows validated / errors so far). Set-based SQL does
  the heavy referential and balance checks (joins against live tables, `GROUP BY` for batch balance)
  rather than row-by-row application loops.
- **Set-based commit.** The commit transaction inserts/posts in bulk where possible; transactional
  posting still funnels through `post_journal_entry` per entry, but documents are grouped so one
  opening-balance batch is *one* large entry, not thousands of tiny ones (§7.1).
- **Chunked transactional history.** For long historical-document imports, split by period/month into
  ordered batches so each commit transaction is bounded and a failure localizes to one period's batch
  (the all-or-nothing guarantee then applies per batch, keeping rollback tractable). The first-open
  period and opening-balance cut-over remain a single batch.
- `row_no` and the streamed insert use a plain ordinal/sequence — gaps are harmless here
  (`accounting-engine.md` §8.3).

---

## Open Questions

1. **Mapping template storage.** Saved templates as a dedicated reference table
   (`accounting.import_mappings`) vs a `jsonb` settings blob vs built-in code constants? Spec §5 does
   not define a mappings table; built-ins + a company-scoped override table is the leaning.
2. **Opening Balance Equity provisioning.** Auto-seed an `Opening Balance Equity` account per company
   on first opening-balance import, or require it to be configured (mirrors the engine's FX-rounding
   account Open Question, `accounting-engine.md`)?
3. **Document imports vs opening-balance lines for AR/AP open items.** Import open invoices/bills as
   full `invoices`/`bills` documents (preserving line/tax detail and aging) vs summarized opening
   sub-ledger lines? Affects how much historical document fidelity migrates.
4. **Inline preview edits.** How much inline editing of `mapped` to allow in the preview vs forcing a
   source-file/mapping fix and re-parse — and how that edit is itself audited.
5. **Per-batch vs per-period commit for history.** Confirm the chunking granularity (month vs quarter)
   for large historical-transaction imports and whether `bank_transactions` post as journals or as
   future banking documents (coordinate with the banking/reconciliation doc, Phase 2).
6. **Source-system coverage.** Which built-in templates ship in Phase 1 (AccountEdge Pro + MYOB
   confirmed) vs deferred (QuickBooks IIF, Xero) per `accountedge-myob-audit.md` §26.

## Decisions Locked

- **Nothing is written to live accounting tables until a batch is `validated` and explicitly
  committed**; the commit is a single all-or-nothing transaction (spec §10; §3.5).
- **Two tables, used as specified:** `accounting.import_batches` (header, status lifecycle
  `uploaded → validating → validated → failed → committed`, `error_count` rollup) and
  `accounting.import_staging_rows` (`raw` verbatim, `mapped` canonical, per-row `status` + `errors`).
  No live-table writes outside commit. (spec §5; §2–§3)
- **The ledger owns balance.** Transactional imports build `draft` entries and post via
  `accounting.post_journal_entry` with the correct `source` (`opening_balance`/`import`/`invoice`/
  `bill`/…); the importer never bypasses the posting function, immutability triggers, or period gate
  (`accounting-engine.md` §5, §10).
- **Validation is layered** structural → referential → accounting → currency → duplicate; opening
  balances / trial balances **must net to zero in both currencies** before commit (§5).
- **Opening balances post one balanced entry against Opening Balance Equity**; OBE absorbs partial
  migrations and must net to zero when migration completes; no opening balance is plugged to
  income/expense (§7).
- **Re-runnable and idempotent:** pre-commit re-validation is free; commit idempotency is guaranteed by
  the engine's `unique (company_id, source, source_id)`; rollback of a committed batch is by
  **reversing** its posted entries, never deleting posted history (§3.6, §9.3).
- **Permission-gated commit** (`import.commit`) and full audit of batch lifecycle; RLS scopes every
  import row by company (spec §7; §9).

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative schema §5, double-entry invariants §6, RBAC
§7, multi-currency §8, T&T §9, non-negotiables §10); `accounting-engine.md` (posting function,
reversal, period gate, immutability, idempotency that this pipeline relies on);
`accountedge-myob-audit.md` (§19 Opening Balances, §26 Import/Export — the source-system requirements
this document implements); sibling docs `multi-currency.md`, `rbac-model.md`, `reporting.md`
(anticipated).
