# Accounting Engine

**TEAL Enterprise — Accounting Module**
Owning agent: Accounting Engine Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This is the definitive technical reference for the double-entry ledger at the heart of the Accounting module. It specifies the journal model, the posting lifecycle and the SQL that enforces it, period control, the derived General Ledger, and how every financial source document collapses into a balanced journal entry. Where `_ARCHITECTURE-SPEC.md` defers an implementation choice to this document, the decision is made and justified here.

This document conforms to `_ARCHITECTURE-SPEC.md` and is authoritative on engine internals. It cross-references `_ARCHITECTURE-SPEC.md` throughout and is intended to sit alongside the sibling docs for currency, AR/AP, tax, and import (named in the spec repo layout).

---

## 1. Scope and the one invariant that matters

The engine exists to guarantee one thing above all others: **the books always balance, and posted history never changes.** Everything below — column semantics, triggers, views, document patterns — is in service of the four non-negotiable invariants in `_ARCHITECTURE-SPEC.md` §6:

1. An entry may become `posted` only if `SUM(debit) = SUM(credit)` in **both** transaction currency and base currency.
2. Posted entries are immutable; corrections are reversing entries, never edits.
3. Posting into a `closed` or `locked` period is rejected.
4. Every financial document posts a balanced entry via `source` / `source_id`.

The journal (`accounting.journal_entries` + `accounting.journal_lines`) is the **single book of record**. The General Ledger, trial balance, account balances, and every report are *derived* from posted journal lines. There is no other place where money is recorded.

### 1.1 Decision locked: native Postgres `enum` types

The spec (§4) leaves the enum-vs-`text+check` choice to this document and defaults to native enums. **We use native Postgres `enum` types** for all closed, stable domains in the accounting schema (`account_category`, `normal_balance`, `period_status`, `journal_source`, `journal_status`, `tax_type`, document `status` sets).

Justification:

- **Storage and comparison cost.** A native enum stores as a 4-byte `oid`-backed value and compares as an integer, versus variable-length text plus a `check` string comparison on every row touched. The ledger is the hottest read path in the system (every report scans `journal_lines`); the saving compounds.
- **A single source of truth for the domain.** The allowed values live in one `CREATE TYPE`, not duplicated across a `check` on the header table, a `check` on a history table, and application constants.
- **Ordering.** Enum declaration order gives a free, meaningful sort (`draft < posted < void`) without a lookup table.
- **The cost is bounded.** The usual objection — "you can't easily remove a value" — does not bite here. These domains are genuinely closed (an accounting category is asset/liability/equity/income/expense; that list is fixed by accounting itself). Adding a value is `ALTER TYPE ... ADD VALUE`, which is online. We will never need to *remove* `asset`.

Open, company-extensible domains are **not** enums and remain reference tables: `account_types` (companies define their own chart structure on top of the five fixed categories), `tax_codes`, `currencies`. Those are data, not types.

```sql
create type accounting.account_category as enum ('asset','liability','equity','income','expense');
create type accounting.normal_balance   as enum ('debit','credit');
create type accounting.period_status    as enum ('open','closed','locked');
create type accounting.journal_source   as enum
  ('manual','invoice','bill','payment','receipt','opening_balance','fx_revaluation','import');
create type accounting.journal_status   as enum ('draft','posted','void');
create type accounting.tax_type         as enum ('vat','withholding','other');
```

---

## 2. Double-entry fundamentals as implemented

### 2.1 The five categories and normal balances

Every account belongs, through its `account_type`, to exactly one of five categories. Each category has a **normal balance** — the side (debit or credit) on which an increase is recorded.

| Category    | Normal balance | A debit … | A credit … | Lives on |
|-------------|----------------|-----------|------------|----------|
| `asset`     | `debit`        | increases | decreases  | Balance Sheet |
| `liability` | `credit`       | decreases | increases  | Balance Sheet |
| `equity`    | `credit`       | decreases | increases  | Balance Sheet |
| `income`    | `credit`       | decreases | increases  | Income Statement |
| `expense`   | `debit`        | increases | decreases  | Income Statement |

The accounting identity holds at all times over posted data:

```
Assets = Liabilities + Equity + (Income − Expenses)
```

The **signed balance** of any account is computed once and reused everywhere:

```
signed_balance(account) =
    (SUM(debit) − SUM(credit))                if normal_balance = 'debit'
    (SUM(credit) − SUM(debit))                if normal_balance = 'credit'
```

A positive signed balance always means "more of what this account normally holds." This single rule drives the GL view, the trial balance, and the financial statements — there is no per-report sign logic.

### 2.2 `accounting.account_types` — the category layer

`account_types` is the reference layer that binds a chart account to a category and a normal balance. Some rows are system-seeded (`is_system = true`, shared structural types); companies may add their own subtypes.

```sql
create table accounting.account_types (
    id              uuid primary key default gen_random_uuid(),
    key             text not null,                       -- 'current_asset','fixed_asset','accounts_receivable', ...
    name            text not null,
    category        accounting.account_category not null,
    normal_balance  accounting.normal_balance   not null,
    is_system       boolean not null default false,
    created_at      timestamptz not null default now(),
    unique (key)
);
```

> **Integrity rule.** `normal_balance` is *not* free to contradict `category`. Asset/expense types are `debit`; liability/equity/income types are `credit`. This is enforced so a misconfigured type cannot silently invert a whole class of accounts:

```sql
alter table accounting.account_types
  add constraint account_types_normal_balance_matches_category check (
      (category in ('asset','expense')   and normal_balance = 'debit')
   or (category in ('liability','equity','income') and normal_balance = 'credit')
  );
```

Seed set (system types, per spec §4 seed/): `current_asset`, `fixed_asset`, `bank`, `accounts_receivable`, `current_liability`, `accounts_payable`, `tax_payable`, `long_term_liability`, `equity`, `retained_earnings`, `income`, `other_income`, `cost_of_sales`, `expense`, `other_expense`.

### 2.3 `accounting.accounts` — the chart of accounts

The chart of accounts is tenant-scoped (`company_id`), hierarchical (`parent_account_id`), and may optionally pin a transaction currency (e.g. a USD bank account).

```sql
create table accounting.accounts (
    id                 uuid primary key default gen_random_uuid(),
    company_id         uuid not null references core.companies(id),
    code               text not null,                    -- '1000','1100','4000' — company chart code
    name               text not null,
    account_type_id    uuid not null references accounting.account_types(id),
    parent_account_id  uuid references accounting.accounts(id),
    currency_code      char(3) references accounting.currencies(code),  -- null = multi/base
    is_bank_account    boolean not null default false,
    is_active          boolean not null default true,
    description        text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz,
    created_by         uuid references core.users(id),
    updated_by         uuid references core.users(id),
    unique (company_id, code)
);

create index on accounting.accounts (company_id, account_type_id);
create index on accounting.accounts (company_id, parent_account_id);
```

**Hierarchy semantics.** `parent_account_id` builds presentation/roll-up groups (e.g. *Current Assets → Bank → TTD Operating Account*). Only **leaf** accounts (no children) should be posted to; parent accounts aggregate their descendants. A child must share its parent's `category` (you cannot file an income account under an asset header). The hierarchy is a tree within a single company:

```sql
-- a parent must belong to the same company
alter table accounting.accounts add constraint accounts_parent_same_company check (true); -- enforced in trigger below
```

Same-company and same-category parentage, plus the "post only to leaves" rule, are enforced by a `BEFORE INSERT/UPDATE` trigger (cheaper and clearer than recursive `check`s):

```sql
create or replace function accounting.validate_account()
returns trigger language plpgsql as $$
declare
    parent record;
    self_cat accounting.account_category;
begin
    select category into self_cat
      from accounting.account_types where id = new.account_type_id;

    if new.parent_account_id is not null then
        select a.company_id, t.category
          into parent
          from accounting.accounts a
          join accounting.account_types t on t.id = a.account_type_id
         where a.id = new.parent_account_id;

        if parent.company_id <> new.company_id then
            raise exception 'parent account % belongs to a different company', new.parent_account_id;
        end if;
        if parent.category <> self_cat then
            raise exception 'account category % does not match parent category %', self_cat, parent.category;
        end if;
        if new.parent_account_id = new.id then
            raise exception 'account cannot be its own parent';
        end if;
    end if;
    return new;
end $$;

create trigger trg_validate_account
  before insert or update on accounting.accounts
  for each row execute function accounting.validate_account();
```

A recursive view exposes the full path for reporting:

```sql
create or replace view accounting.account_tree as
with recursive t as (
    select a.id, a.company_id, a.code, a.name, a.parent_account_id,
           a.code as path_code, 1 as depth
      from accounting.accounts a
     where a.parent_account_id is null
    union all
    select a.id, a.company_id, a.code, a.name, a.parent_account_id,
           t.path_code || ' / ' || a.code, t.depth + 1
      from accounting.accounts a
      join t on a.parent_account_id = t.id
)
select * from t;
```

---

## 3. The journal model

Two tables, one immutable book. The header (`journal_entries`) carries the event; the lines (`journal_lines`) carry the money.

### 3.1 `accounting.journal_entries` — header

```sql
create table accounting.journal_entries (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references core.companies(id),
    entry_no      bigint,                                 -- assigned at post time, per company, gap-free
    entry_date    date not null,
    period_id     uuid not null references accounting.accounting_periods(id),
    currency_code char(3) not null references accounting.currencies(code),
    description   text,
    source        accounting.journal_source not null default 'manual',
    source_id     uuid,                                   -- FK-by-convention to the originating document
    status        accounting.journal_status not null default 'draft',
    posted_at     timestamptz,
    posted_by     uuid references core.users(id),
    reversed_by_entry_id   uuid references accounting.journal_entries(id),  -- set on the reversed original
    reverses_entry_id      uuid references accounting.journal_entries(id),  -- set on the reversal
    created_by    uuid references core.users(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz,

    unique (company_id, entry_no),                        -- entry_no unique within a company (null allowed for drafts)
    unique (company_id, source, source_id)                -- idempotency: one entry per source document (see §9)
);

create index on accounting.journal_entries (company_id, status, entry_date);
create index on accounting.journal_entries (company_id, period_id);
create index on accounting.journal_entries (source, source_id);
```

**Column semantics.**

- `entry_no` — human-facing, **gap-free** sequence **per company**, assigned only at the moment of posting (§8). `null` while `draft`.
- `entry_date` — the accounting date; must fall inside `period_id`'s `[start_date, end_date]` (enforced at post).
- `period_id` — the period the entry posts into; its `status` gates posting (§6).
- `currency_code` — the transaction currency of the entry. Individual lines may differ only where the design later allows mixed-currency entries; in Phase 1 all lines share the header currency.
- `source` / `source_id` — provenance. `manual` entries have `source_id = null`. Document-generated entries carry the document's `id`, giving a bidirectional link and the idempotency guarantee.
- `status` — lifecycle (§4). Only `draft` and `void` headers are mutable; `posted` is immutable.
- `posted_at` / `posted_by` — stamped by the posting function, never by the application directly.
- `reverses_entry_id` / `reversed_by_entry_id` — the reversal linkage (§5.3).

**CHECK constraints on the header:**

```sql
alter table accounting.journal_entries
  add constraint je_posted_fields_present check (
      (status <> 'posted') or (posted_at is not null and posted_by is not null and entry_no is not null)
  ),
  add constraint je_draft_has_no_post_stamp check (
      (status <> 'draft') or (posted_at is null and posted_by is null)
  ),
  add constraint je_reversal_not_self check (reverses_entry_id is distinct from id);
```

### 3.2 `accounting.journal_lines` — lines

```sql
create table accounting.journal_lines (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references core.companies(id),
    journal_entry_id  uuid not null references accounting.journal_entries(id) on delete cascade,
    line_no           int  not null,                      -- 1..N within the entry, contiguous
    account_id        uuid not null references accounting.accounts(id),
    description       text,
    debit             numeric(20,4) not null default 0,
    credit            numeric(20,4) not null default 0,
    currency_code     char(3) not null references accounting.currencies(code),
    fx_rate           numeric(20,8) not null default 1,   -- transaction → base
    base_debit        numeric(20,4) not null default 0,
    base_credit       numeric(20,4) not null default 0,
    tax_code_id       uuid references accounting.tax_codes(id),
    created_at        timestamptz not null default now(),

    unique (journal_entry_id, line_no)
);

create index on accounting.journal_lines (account_id);
create index on accounting.journal_lines (company_id, account_id);
create index on accounting.journal_lines (journal_entry_id);
```

**Column semantics.**

- `line_no` — 1-based, contiguous ordering within the entry. Assigned by the writing service (or via `row_number()` when building from a document). Unique per entry.
- `debit` / `credit` — transaction-currency amounts. A line is *either* a debit *or* a credit, never both, never negative.
- `currency_code` / `fx_rate` — the line's currency and the rate to base. In Phase 1 `currency_code = header.currency_code`; `fx_rate` is captured **at transaction time and never re-derived** (spec §8).
- `base_debit` / `base_credit` — base-currency equivalents, computed as `round(debit * fx_rate, 4)` / `round(credit * fx_rate, 4)`. Stored, not derived on read, so historical statements never drift when rates change.
- `tax_code_id` — when the line is a tax component, links to the `tax_codes` row that produced it (used by VAT reporting).

**CHECK constraints on lines** (spec §5 mandates the first two; we add the sign/base-consistency rules):

```sql
alter table accounting.journal_lines
  add constraint jl_not_both_sides check (not (debit > 0 and credit > 0)),
  add constraint jl_non_negative   check (debit >= 0 and credit >= 0),
  add constraint jl_base_non_negative check (base_debit >= 0 and base_credit >= 0),
  -- the base side must mirror the transaction side (a debit line has zero base_credit, etc.)
  add constraint jl_base_side_mirrors check (
      (debit  > 0 or base_debit  = 0) and
      (credit > 0 or base_credit = 0)
  ),
  add constraint jl_some_amount check (debit > 0 or credit > 0);   -- no all-zero lines
```

### 3.3 Why two amounts per line (transaction + base)

The base-currency columns are not redundant. They are how invariant #1 is satisfied *in base currency*. Two foreign-currency lines that balance in USD might not balance in TTD if each used a slightly different rate. By storing `base_debit`/`base_credit` per line at the rate in force, the engine can prove balance on **both** axes at post time and forever after, and every base-currency report (trial balance, statements) sums the stored base amounts rather than re-multiplying by a "current" rate.

---

## 4. The posting lifecycle

```
            create / edit lines                post_journal_entry()
   ┌───────┐ ─────────────────►  ┌───────┐  ────────────────────►  ┌────────┐
   │ draft │                     │ draft │   balance + period OK   │ posted │
   └───────┘ ◄─────────────────  └───────┘  ◄── rejected if not    └────────┘
        edit freely (mutable)                                          │ immutable
                                                                       │
                                              void_journal_entry()     ▼
                                          (posts a reversal, marks  ┌──────┐
                                           original linked)         │ void │
                                                                    └──────┘
```

- **`draft`** — fully mutable. Lines may be added, edited, deleted. `entry_no` is `null`. No `posted_at`/`posted_by`. Drafts have no effect on the GL whatsoever (the GL view reads only `posted`).
- **`posted`** — immutable book of record. Appears in the GL. Cannot be edited or deleted. Acquires a gap-free `entry_no`, `posted_at`, `posted_by`.
- **`void`** — a *posted* entry that has been reversed. The original stays in the book (it really happened); a linked reversing entry cancels its effect. `draft` entries are never "voided" — they are simply deleted.

### 4.1 The exact balancing rule

An entry is balanced **iff**, across all its lines:

```
SUM(debit) = SUM(credit)          -- transaction currency
AND
SUM(base_debit) = SUM(base_credit) -- base currency
```

Both equalities must hold to the full `numeric(20,4)` precision (no rounding tolerance is applied to the transaction-currency check; see §4.3 on the base-currency rounding penny). This is invariant #1 and is the gate of the posting function.

### 4.2 Immutability of posted entries

Immutability is enforced in the database, not merely in application code, so no code path (including imports and future modules) can mutate posted history:

```sql
create or replace function accounting.guard_posted_immutable()
returns trigger language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        if old.status = 'posted' then
            raise exception 'posted journal entry % is immutable and cannot be deleted', old.id;
        end if;
        return old;
    end if;

    -- UPDATE: allow only the controlled transitions
    if old.status = 'posted' then
        -- the only legal change to a posted header is linking it to its reversal,
        -- or flipping it to 'void' as part of the reversal flow
        if new.status = 'void'
           and new.reversed_by_entry_id is not null
           and old.reversed_by_entry_id is null then
            return new;  -- void-via-reversal path, performed inside void_journal_entry()
        end if;

        if row(new.company_id, new.entry_no, new.entry_date, new.period_id,
                new.currency_code, new.source, new.source_id, new.posted_at, new.posted_by)
           is distinct from
           row(old.company_id, old.entry_no, old.entry_date, old.period_id,
                old.currency_code, old.source, old.source_id, old.posted_at, old.posted_by)
        then
            raise exception 'posted journal entry % is immutable', old.id;
        end if;
    end if;
    return new;
end $$;

create trigger trg_guard_je_immutable
  before update or delete on accounting.journal_entries
  for each row execute function accounting.guard_posted_immutable();
```

Lines of a posted entry are likewise frozen:

```sql
create or replace function accounting.guard_posted_lines()
returns trigger language plpgsql as $$
declare st accounting.journal_status;
begin
    select status into st from accounting.journal_entries
     where id = coalesce(new.journal_entry_id, old.journal_entry_id);
    if st = 'posted' then
        raise exception 'lines of posted entry % are immutable', coalesce(new.journal_entry_id, old.journal_entry_id);
    end if;
    return coalesce(new, old);
end $$;

create trigger trg_guard_jl_immutable
  before insert or update or delete on accounting.journal_lines
  for each row execute function accounting.guard_posted_lines();
```

### 4.3 The base-currency rounding penny

When `SUM(debit) = SUM(credit)` in transaction currency but per-line rounding makes `SUM(base_debit) ≠ SUM(base_credit)` by a cent or two, the engine does **not** silently fudge. The document-generation layer (§7) is responsible for posting a balancing line to an **FX Rounding** account (an `other_income`/`other_expense` account) so that both equalities hold exactly before `post_journal_entry` is ever called. The posting function enforces exact equality and rejects anything that does not already balance — it never invents a line.

---

## 5. How posting is enforced (concrete SQL)

### 5.1 The balance-check query

This is the single query that decides balance. It returns one row; the entry is balanced iff all four sums reconcile.

```sql
-- balance check for one entry
select
    coalesce(sum(debit), 0)       as sum_debit,
    coalesce(sum(credit), 0)      as sum_credit,
    coalesce(sum(base_debit), 0)  as sum_base_debit,
    coalesce(sum(base_credit), 0) as sum_base_credit,
    count(*)                      as line_count
from accounting.journal_lines
where journal_entry_id = $1;
```

### 5.2 `accounting.post_journal_entry(entry_id)`

A `security definer` function is the **only** sanctioned path from `draft` to `posted`. It validates structure, balance (both currencies), and the period, stamps the audit fields, assigns the gap-free `entry_no`, and flips the status — all in one transaction. Any failure raises and rolls back; the entry stays `draft`.

```sql
create or replace function accounting.post_journal_entry(p_entry_id uuid)
returns accounting.journal_entries
language plpgsql
security definer
set search_path = accounting, core, public
as $$
declare
    je   accounting.journal_entries;
    per  accounting.accounting_periods;
    b    record;
    v_no bigint;
begin
    -- 1. Lock the header so two posters cannot race the same entry.
    select * into je
      from accounting.journal_entries
     where id = p_entry_id
     for update;

    if not found then
        raise exception 'journal entry % not found', p_entry_id;
    end if;

    -- 2. Only drafts may be posted.
    if je.status <> 'draft' then
        raise exception 'entry % is % and cannot be posted', p_entry_id, je.status;
    end if;

    -- 3. Period must exist and be OPEN.
    select * into per
      from accounting.accounting_periods
     where id = je.period_id
     for share;           -- block the period from being closed mid-post

    if not found then
        raise exception 'period % does not exist', je.period_id;
    end if;
    if per.status <> 'open' then
        raise exception 'period % is % — posting rejected', per.name, per.status;
    end if;
    if je.entry_date < per.start_date or je.entry_date > per.end_date then
        raise exception 'entry_date % is outside period % (% .. %)',
            je.entry_date, per.name, per.start_date, per.end_date;
    end if;
    if per.company_id <> je.company_id then
        raise exception 'period/company mismatch on entry %', p_entry_id;
    end if;

    -- 4. Balance check — both transaction and base currency.
    select coalesce(sum(debit),0)       as sum_debit,
           coalesce(sum(credit),0)      as sum_credit,
           coalesce(sum(base_debit),0)  as sum_base_debit,
           coalesce(sum(base_credit),0) as sum_base_credit,
           count(*)                     as line_count
      into b
      from accounting.journal_lines
     where journal_entry_id = p_entry_id;

    if b.line_count < 2 then
        raise exception 'entry % must have at least two lines', p_entry_id;
    end if;
    if b.sum_debit <> b.sum_credit then
        raise exception 'entry % unbalanced in txn currency: debit % <> credit %',
            p_entry_id, b.sum_debit, b.sum_credit;
    end if;
    if b.sum_base_debit <> b.sum_base_credit then
        raise exception 'entry % unbalanced in base currency: base_debit % <> base_credit %',
            p_entry_id, b.sum_base_debit, b.sum_base_credit;
    end if;
    if b.sum_debit = 0 then
        raise exception 'entry % has zero value', p_entry_id;
    end if;

    -- 5. Assign the gap-free, per-company entry_no (see §8).
    v_no := accounting.next_entry_no(je.company_id);

    -- 6. Stamp and flip. The immutability trigger permits draft→posted.
    update accounting.journal_entries
       set status    = 'posted',
           entry_no  = v_no,
           posted_at = now(),
           posted_by = auth.uid(),
           updated_at = now()
     where id = p_entry_id
     returning * into je;

    return je;
end $$;
```

Notes:

- **`auth.uid()`** is Supabase's current authenticated user; it becomes `posted_by`. The function is `security definer` so it can write the stamp regardless of the caller's table grants, but RLS-level permission to post is checked before calling (see §10).
- The `for update` on the header plus `for share` on the period are the concurrency guards (§9).
- The function is **idempotent at the boundary**: re-calling it on an already-`posted` entry raises rather than double-posting.

### 5.3 Reversing-entry mechanism (corrections)

Posted entries are never edited. To correct one you post a **reversal**: a new entry that swaps debits and credits of the original, dated in an open period, linked both ways. `void_journal_entry` performs this atomically and marks the original `void`.

```sql
create or replace function accounting.reverse_journal_entry(
    p_entry_id    uuid,
    p_reverse_date date default null,
    p_reason      text default null
) returns accounting.journal_entries
language plpgsql security definer
set search_path = accounting, core, public
as $$
declare
    orig accounting.journal_entries;
    per  accounting.accounting_periods;
    rev  accounting.journal_entries;
    v_date date;
begin
    select * into orig from accounting.journal_entries where id = p_entry_id for update;
    if not found then raise exception 'entry % not found', p_entry_id; end if;
    if orig.status <> 'posted' then
        raise exception 'only posted entries can be reversed (entry % is %)', p_entry_id, orig.status;
    end if;
    if orig.reversed_by_entry_id is not null then
        raise exception 'entry % is already reversed', p_entry_id;
    end if;

    v_date := coalesce(p_reverse_date, current_date);

    -- target period for the reversal (must be open; resolved by date + company)
    select * into per
      from accounting.accounting_periods
     where company_id = orig.company_id
       and v_date between start_date and end_date;
    if not found then raise exception 'no period covers reversal date %', v_date; end if;

    -- 1. create the reversal header (draft)
    insert into accounting.journal_entries
        (company_id, entry_date, period_id, currency_code, description,
         source, source_id, status, reverses_entry_id, created_by)
    values
        (orig.company_id, v_date, per.id, orig.currency_code,
         coalesce(p_reason, 'Reversal of entry ' || orig.entry_no::text),
         orig.source, orig.source_id, 'draft', orig.id, auth.uid())
    returning * into rev;

    -- 2. copy lines with debit/credit (and base) swapped
    insert into accounting.journal_lines
        (company_id, journal_entry_id, line_no, account_id, description,
         debit, credit, currency_code, fx_rate, base_debit, base_credit, tax_code_id)
    select company_id, rev.id, line_no, account_id,
           'Reversal: ' || coalesce(description,''),
           credit, debit,                  -- swap
           currency_code, fx_rate,
           base_credit, base_debit,        -- swap
           tax_code_id
      from accounting.journal_lines
     where journal_entry_id = orig.id;

    -- 3. post the reversal (re-validates balance + period)
    rev := accounting.post_journal_entry(rev.id);

    -- 4. link original → reversal and mark it void (allowed by the immutability trigger)
    update accounting.journal_entries
       set reversed_by_entry_id = rev.id,
           status = 'void',
           updated_at = now()
     where id = orig.id;

    return rev;
end $$;
```

A reversal is itself a normal posted entry — it appears in the GL, keeps the books balanced, and preserves a complete audit trail (the original and its reversal are both visible and linked). Voiding a source document (e.g. cancelling an invoice) calls this on the document's `journal_entry_id`.

---

## 6. Period control

`accounting.accounting_periods` partitions each company's fiscal year into periods and gates posting. T&T fiscal-year flexibility is honoured via `core.companies.fiscal_year_start_month` (spec §5, §9); periods are generated to align with it.

```sql
create table accounting.accounting_periods (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references core.companies(id),
    fiscal_year  int  not null,
    period_no    int  not null,                 -- 1..12 (or 1..13 with an adjustment period)
    name         text not null,                 -- 'FY2026 P06 — June'
    start_date   date not null,
    end_date     date not null,
    status       accounting.period_status not null default 'open',
    closed_at    timestamptz,
    closed_by    uuid references core.users(id),
    created_at   timestamptz not null default now(),

    unique (company_id, fiscal_year, period_no),
    exclude using gist (                          -- no overlapping periods per company
        company_id with =,
        daterange(start_date, end_date, '[]') with &&
    ),
    check (end_date >= start_date)
);

create index on accounting.accounting_periods (company_id, status);
```

### 6.1 Lifecycle

```
open ──close──► closed ──lock──► locked
 ▲                │
 └──── reopen ────┘   (reopen allowed from closed; never from locked)
```

- **`open`** — the only state into which entries may be posted. Reversals and adjustments are still possible.
- **`closed`** — month-end is done; routine posting is blocked. A `closed` period may be **reopened** to `open` by an authorised user (Company Admin / Accountant with the `period.reopen` permission) to post a late adjustment, then re-closed.
- **`locked`** — permanent. Used after statutory filing / audit sign-off / year-end. **No path back to open.** Any posting or reversal targeting a `locked` period is rejected.

```sql
create or replace function accounting.set_period_status(p_period_id uuid, p_status accounting.period_status)
returns accounting.accounting_periods
language plpgsql security definer
set search_path = accounting, core, public
as $$
declare per accounting.accounting_periods;
begin
    select * into per from accounting.accounting_periods where id = p_period_id for update;
    if not found then raise exception 'period % not found', p_period_id; end if;

    if per.status = 'locked' then
        raise exception 'period % is locked and cannot change state', per.name;
    end if;
    if p_status = 'open' and per.status = 'closed'
       and not core.has_permission(per.company_id, 'period.reopen') then
        raise exception 'reopening period % requires period.reopen', per.name;
    end if;

    update accounting.accounting_periods
       set status    = p_status,
           closed_at = case when p_status in ('closed','locked') then now() else null end,
           closed_by = case when p_status in ('closed','locked') then auth.uid() else null end
     where id = p_period_id
     returning * into per;
    return per;
end $$;
```

### 6.2 How posting respects periods

`post_journal_entry` (§5.2) does three period checks before it will post: the period must **exist**, be **`open`**, and **contain** `entry_date`. The `for share` lock taken on the period row blocks a concurrent `close`/`lock` from sneaking in between the check and the write — the closer must wait for the poster's transaction to commit, and vice versa. This makes "post into an open period" and "close the period" mutually serialised.

---

## 7. The General Ledger as a derived view

Per spec §5, the GL is **not a table**. It is a view over posted journal lines. Reports never read drafts.

### 7.1 `accounting.general_ledger`

```sql
create or replace view accounting.general_ledger as
select
    jl.id                         as line_id,
    je.company_id,
    je.id                         as journal_entry_id,
    je.entry_no,
    je.entry_date,
    je.period_id,
    je.source,
    je.source_id,
    je.description                as entry_description,
    jl.line_no,
    jl.account_id,
    acc.code                      as account_code,
    acc.name                      as account_name,
    at.category                   as account_category,
    at.normal_balance,
    jl.description                as line_description,
    jl.currency_code,
    jl.debit,
    jl.credit,
    jl.fx_rate,
    jl.base_debit,
    jl.base_credit,
    -- signed movement in base currency, oriented to the account's normal balance
    case when at.normal_balance = 'debit'
         then jl.base_debit - jl.base_credit
         else jl.base_credit - jl.base_debit
    end                           as signed_base_movement,
    je.posted_at,
    je.posted_by,
    jl.tax_code_id
from accounting.journal_lines jl
join accounting.journal_entries je on je.id = jl.journal_entry_id
join accounting.accounts        acc on acc.id = jl.account_id
join accounting.account_types   at  on at.id  = acc.account_type_id
where je.status = 'posted';
```

RLS on the base tables (`journal_entries`, `journal_lines`, `accounts`) flows through the view, so a user only ever sees GL rows for companies they belong to (spec §7).

### 7.2 Running-balance ledger for one account

The classic "account activity with running balance," ordered by date then entry number:

```sql
select gl.*,
       sum(gl.signed_base_movement)
           over (partition by gl.account_id
                 order by gl.entry_date, gl.entry_no, gl.line_no
                 rows between unbounded preceding and current row) as running_base_balance
from accounting.general_ledger gl
where gl.company_id = $1
  and gl.account_id = $2
  and gl.entry_date between $3 and $4
order by gl.entry_date, gl.entry_no, gl.line_no;
```

### 7.3 Account balance (as of a date)

```sql
select a.id, a.code, a.name, at.category, at.normal_balance,
       coalesce(sum(jl.base_debit),  0) as total_base_debit,
       coalesce(sum(jl.base_credit), 0) as total_base_credit,
       case when at.normal_balance = 'debit'
            then coalesce(sum(jl.base_debit),0) - coalesce(sum(jl.base_credit),0)
            else coalesce(sum(jl.base_credit),0) - coalesce(sum(jl.base_debit),0)
       end as balance_base
from accounting.accounts a
join accounting.account_types at on at.id = a.account_type_id
left join accounting.journal_lines jl on jl.account_id = a.id
left join accounting.journal_entries je
       on je.id = jl.journal_entry_id
      and je.status = 'posted'
      and je.entry_date <= $2          -- as-of date
where a.company_id = $1
group by a.id, a.code, a.name, at.category, at.normal_balance
order by a.code;
```

### 7.4 Trial balance

The trial balance is the proof-of-balance report: the sum of all debit balances must equal the sum of all credit balances. Each account is shown on its natural side.

```sql
with bal as (
    select a.id, a.code, a.name, at.category, at.normal_balance,
           coalesce(sum(jl.base_debit),0)  as d,
           coalesce(sum(jl.base_credit),0) as c
    from accounting.accounts a
    join accounting.account_types at on at.id = a.account_type_id
    left join accounting.journal_lines jl on jl.account_id = a.id
    left join accounting.journal_entries je
           on je.id = jl.journal_entry_id
          and je.status = 'posted'
          and je.company_id = $1
          and je.entry_date between $2 and $3        -- period range
    where a.company_id = $1
    group by a.id, a.code, a.name, at.category, at.normal_balance
)
select code, name, category,
       case when (d - c) > 0 then  (d - c) else 0 end as debit_balance,
       case when (c - d) > 0 then  (c - d) else 0 end as credit_balance
from bal
where d <> 0 or c <> 0
order by code;
-- Invariant: SUM(debit_balance) = SUM(credit_balance). If not, the ledger is corrupt.
```

A nightly integrity job asserts `SUM(debit_balance) = SUM(credit_balance)` per company; a mismatch is a hard alert because it means an unbalanced entry escaped posting (which the trigger should make impossible).

---

## 8. Numbering strategy

Two distinct kinds of number, two distinct strategies.

### 8.1 `entry_no` — gap-free, per company

`entry_no` is the audit-facing journal number. Auditors expect it to be **gap-free** within a company (a gap suggests a deleted/hidden entry). A bare Postgres `sequence` is *not* gap-free (rolled-back transactions burn numbers), so `entry_no` is allocated from a **per-company counter row** locked at post time:

```sql
create table accounting.number_counters (
    company_id  uuid not null references core.companies(id),
    kind        text not null,            -- 'journal_entry', 'invoice', 'bill', ...
    next_value  bigint not null default 1,
    primary key (company_id, kind)
);

create or replace function accounting.next_entry_no(p_company_id uuid)
returns bigint language plpgsql as $$
declare v bigint;
begin
    insert into accounting.number_counters (company_id, kind, next_value)
         values (p_company_id, 'journal_entry', 1)
    on conflict (company_id, kind) do nothing;

    update accounting.number_counters
       set next_value = next_value + 1
     where company_id = p_company_id and kind = 'journal_entry'
     returning next_value - 1 into v;     -- the value we just consumed

    return v;
end $$;
```

Because the counter is bumped **inside the same transaction** as the `draft→posted` flip, a rollback returns the number to the pool — gap-free is preserved. The `update` takes a row lock on the single counter row, serialising number allocation per company (this is the one deliberate serialisation point; it is cheap because posting is not high-frequency and the lock is held only for the post transaction).

### 8.2 Document numbers (`invoice_no`, `bill_no`)

User-facing document numbers may be formatted (`INV-2026-00042`) and are allocated by the same counter mechanism (`kind = 'invoice'`), then formatted by the document service. They are gap-free per company per document type. Drafts that are deleted before issue do not consume a number (allocate at issue, not at create), matching the `entry_no`-at-post discipline.

### 8.3 When a sequence is acceptable

`id` (uuid) needs no sequence. Internal, non-audit ordinals where gaps are harmless (e.g. an import batch row ordinal) may use a plain `sequence` or `bigserial`. The rule: **anything an auditor or counterparty will read must be gap-free; everything else may be a sequence.**

---

## 9. Concurrency, idempotency, integrity

**Concurrency.**
- Posting locks the header (`for update`) and the period (`for share`), so two concurrent posts of the same entry serialise, and a period cannot be closed underneath a post.
- `entry_no` allocation locks one counter row per company, guaranteeing a dense sequence even under parallel posting.
- The period table's `exclude using gist` constraint makes overlapping periods structurally impossible, so date→period resolution is unambiguous.

**Idempotency.**
- `unique (company_id, source, source_id)` on `journal_entries` means a given source document can have **at most one** journal entry. Re-running invoice posting (retry, double-click, import replay) hits the unique violation instead of creating a duplicate. Document services use `insert ... on conflict (company_id, source, source_id) do nothing` and then read back the existing entry.
- `post_journal_entry` raises on a non-draft entry, so a retried post is a no-op error rather than a double-post.

**Integrity guarantees (defence in depth).**
1. Row-level `check`s reject malformed lines (both-sided, negative, all-zero) at write time.
2. The balance gate in `post_journal_entry` rejects unbalanced entries in both currencies.
3. The immutability triggers reject any mutation/deletion of posted entries or their lines.
4. Period checks + locks reject posting into closed/locked periods.
5. FKs (`company_id`, `account_id`, `period_id`, `currency_code`) reject orphans; `account_types` category/normal-balance `check` rejects inverted accounts.
6. The nightly trial-balance assertion is the backstop: if it ever finds `SUM(debit) ≠ SUM(credit)`, an invariant was breached and the system raises a hard alert.
7. All writes happen inside transactions; a failed post leaves the entry exactly as it was (`draft`, no number, no stamp).

Everything posting-related is funnelled through the `security definer` functions; application code is **not** granted direct `update`/`delete` on posted rows. RLS (spec §7) governs which company's data a user can touch; the functions govern *how*.

---

## 10. Source documents → balanced journal entries

Every financial document collapses to a balanced entry tagged with its `source`/`source_id`. The document service builds `draft` lines (including the FX-rounding line if needed, §4.3), then calls `post_journal_entry`. Patterns below are in base currency for clarity (TTD); the transaction-currency amounts and `fx_rate` ride along on each line. Account references are by role; actual `account_id`s come from `customers.receivable_account_id`, `suppliers.payable_account_id`, `tax_codes.collected_account_id/paid_account_id`, and `bank_accounts.account_id`.

### 10.1 Sales invoice with VAT (`source = 'invoice'`)

Customer invoiced for services 1,000.00 + 12.5% VAT = 1,125.00.

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Accounts Receivable (`customers.receivable_account_id`) | 1,125.00 | |
| 2 | Sales / Revenue (`invoice_lines.account_id`) | | 1,000.00 |
| 3 | VAT Output / Collected (`tax_codes.collected_account_id`) | | 125.00 |

AR (asset) up by a debit; revenue (income) and VAT payable (liability) up by credits. `tax_code_id` is stamped on line 3 for VAT reporting.

### 10.2 Supplier bill with VAT (`source = 'bill'`)

Bill received for 1,000.00 + 12.5% input VAT = 1,125.00.

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Expense / Asset (`bill_lines.account_id`) | 1,000.00 | |
| 2 | VAT Input / Paid (`tax_codes.paid_account_id`) | 125.00 | |
| 3 | Accounts Payable (`suppliers.payable_account_id`) | | 1,125.00 |

Expense and recoverable input VAT up by debits; AP (liability) up by a credit.

### 10.3 Customer receipt (`source = 'receipt'`)

Customer pays 1,125.00 against the invoice into the bank.

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Bank (`bank_accounts.account_id`) | 1,125.00 | |
| 2 | Accounts Receivable (`customers.receivable_account_id`) | | 1,125.00 |

Bank (asset) up; AR (asset) down — the receivable is cleared. The AR/AP doc layer also records the allocation against `invoices.amount_paid` and flips `invoices.status` to `paid`/`partial`.

### 10.4 Supplier payment (`source = 'payment'`)

Pay the supplier 1,125.00 from the bank.

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Accounts Payable (`suppliers.payable_account_id`) | 1,125.00 | |
| 2 | Bank (`bank_accounts.account_id`) | | 1,125.00 |

AP (liability) down via debit; bank (asset) down via credit.

### 10.5 Opening balances (`source = 'opening_balance'`)

Migrating in: bank 50,000.00 (debit) and an outstanding customer balance 10,000.00 (debit), against retained earnings / opening equity (credit) so the entry balances.

| Line | Account (role) | Debit | Credit |
|------|----------------|------:|-------:|
| 1 | Bank | 50,000.00 | |
| 2 | Accounts Receivable | 10,000.00 | |
| 3 | Opening Balances Equity (`equity`) | | 60,000.00 |

Opening balances post a single (often large, multi-line) entry into the first open period, dated the migration cut-over date, balanced against an Opening Balances Equity account. Per-customer/per-supplier sub-ledger detail is reconstructed by the AR/AP doc layer from migrated open items; the GL effect is this one balanced entry.

### 10.6 Foreign-currency example (the base-currency check earning its keep)

A USD invoice of 1,000.00 at `fx_rate = 6.7800` posts:

| Line | Account | Debit (USD) | Credit (USD) | base_debit (TTD) | base_credit (TTD) |
|------|---------|------------:|-------------:|-----------------:|------------------:|
| 1 | AR (USD) | 1,000.00 | | 6,780.00 | |
| 2 | Revenue | | 1,000.00 | | 6,780.00 |

Both `SUM(debit)=SUM(credit)=1,000.00` (USD) **and** `SUM(base_debit)=SUM(base_credit)=6,780.00` (TTD) hold, so the entry posts. Where VAT and multiple rates introduce a base-currency cent imbalance, the document layer appends an FX-rounding line (§4.3) before posting.

---

## 11. Optional `accounting.account_balances` materialization (later optimization)

The balance and trial-balance queries in §7 scan `journal_lines`. At small-to-medium volume on a properly indexed table this is fine. When line counts grow into the millions, a maintained **per account, per period** balance table can serve trial balances and dashboards in O(accounts) instead of O(lines). This is a **performance optimization, never a substitute for the journal** (spec §5).

```sql
create table accounting.account_balances (
    company_id     uuid not null references core.companies(id),
    account_id     uuid not null references accounting.accounts(id),
    period_id      uuid not null references accounting.accounting_periods(id),
    base_debit     numeric(20,4) not null default 0,
    base_credit    numeric(20,4) not null default 0,
    txn_debit      numeric(20,4) not null default 0,
    txn_credit     numeric(20,4) not null default 0,
    line_count     bigint not null default 0,
    updated_at     timestamptz not null default now(),
    primary key (company_id, account_id, period_id)
);
```

**Maintenance strategy.**

- **Incremental on post.** A trigger on `journal_lines` (or a step inside `post_journal_entry`) upserts the delta into the matching `(account_id, period_id)` bucket whenever an entry is posted. Because posted lines are immutable and reversals are *new* posted entries, every change to the ledger is an insert of posted lines — there are no in-place updates or deletes to chase. The materialization therefore only ever accumulates; it never has to reverse a mutation.

```sql
-- inside the post path, after status flips to 'posted':
insert into accounting.account_balances as ab
    (company_id, account_id, period_id, base_debit, base_credit, txn_debit, txn_credit, line_count)
select je.company_id, jl.account_id, je.period_id,
       sum(jl.base_debit), sum(jl.base_credit),
       sum(jl.debit), sum(jl.credit), count(*)
  from accounting.journal_lines jl
  join accounting.journal_entries je on je.id = jl.journal_entry_id
 where jl.journal_entry_id = p_entry_id
 group by je.company_id, jl.account_id, je.period_id
on conflict (company_id, account_id, period_id) do update
   set base_debit  = ab.base_debit  + excluded.base_debit,
       base_credit = ab.base_credit + excluded.base_credit,
       txn_debit   = ab.txn_debit   + excluded.txn_debit,
       txn_credit  = ab.txn_credit  + excluded.txn_credit,
       line_count  = ab.line_count  + excluded.line_count,
       updated_at  = now();
```

- **Rebuild / reconcile job.** A scheduled job recomputes balances from the journal (the §7.3 query, grouped by period) and compares to `account_balances`. Any drift is a bug; the job logs it and can fully rebuild a company's buckets from scratch. The journal remains the truth — `account_balances` is always reconstructable and is dropped/rebuilt without data loss.
- **Read path.** Trial balance and dashboards read `account_balances` (summing the relevant periods) when present and current; the §7 queries remain the authoritative fallback and the reconciliation oracle.

Do not build this until measured query latency justifies it.

---

## Open Questions

- **Multi-currency lines within one entry.** Phase 1 assumes all lines share the header currency. Do we need genuinely mixed-currency single entries (e.g. an FX settlement that debits a USD bank and credits a TTD account directly)? If so, the header `currency_code` becomes informational and the balance check relies solely on the base-currency equality. (Coordinate with the currency doc.)
- **Adjustment / period 13.** Should year-end adjustments use a dedicated 13th period (`period_no = 13`) rather than the final calendar period? Affects period generation and statutory reporting.
- **Reopen audit.** Should reopening a `closed` period write a `core.audit_logs` row automatically (almost certainly yes) and should it require a reason string?
- **FX rounding account auto-provisioning.** Should the chart auto-seed an "FX Rounding" account per company, or is it a configured account on the company settings?
- **Entry-number formatting.** Is the bare integer `entry_no` sufficient for audit, or do we also want a formatted `entry_ref` (e.g. `JE-2026-000042`) like documents?

## Decisions Locked

- **Native Postgres `enum` types** for all closed accounting domains (`account_category`, `normal_balance`, `period_status`, `journal_source`, `journal_status`, `tax_type`); reference tables for open/company-extensible domains. (§1.1)
- The **journal is the single book of record**; the **General Ledger is a derived view** over `status = 'posted'` lines only. (§7)
- **Both** transaction-currency **and** base-currency balance must hold exactly to post; enforced by the `security definer` `accounting.post_journal_entry`, never by application code alone. (§4.1, §5.2)
- **Posted entries and their lines are immutable**, enforced by database triggers; corrections are **reversing entries** via `accounting.reverse_journal_entry`. (§4.2, §5.3)
- Posting respects period state with row locks: only `open` periods accept entries; `closed` is reopenable with permission; `locked` is permanent. (§6)
- `entry_no` is **gap-free per company**, allocated from a locked counter row at post time; documents use the same counter mechanism per type. Plain sequences only where gaps are harmless. (§8)
- **Idempotency** via `unique (company_id, source, source_id)` on `journal_entries`; one entry per source document. (§9)
- `accounting.account_balances` is an **optional later optimization**, reconstructable from the journal, never the system of record. (§11)

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative cross-cutting spec — schema names, invariants §6, RBAC §7, currency §8, T&T §9). Sibling module docs (currency, AR/AP, tax, import) integrate with this engine through the `source`/`source_id` contract and the `post_journal_entry` / `reverse_journal_entry` functions defined here.
