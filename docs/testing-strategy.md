# Testing Strategy

**TEAL Enterprise — Accounting Module**
Owning agent: QA / Accounting Validation Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This document defines how TEAL Enterprise proves it is correct before any feature is called "done." It is built around one conviction: a production accounting system earns trust only by demonstrating, repeatedly and automatically, that the books always balance and posted history never changes. It specifies the test pyramid for this stack, the accounting-correctness and security suites that are the system's conscience, and the CI and regression policy that keep them running.

This document conforms to `_ARCHITECTURE-SPEC.md` and cross-references `accounting-engine.md` (engine internals and posting SQL), `trinidad-accounting-requirements.md` (tax/period statutory rules), and `accountedge-myob-audit.md` (parity expectations). It is authoritative on test policy; where it asserts an expected debit/credit, the Accounting Engine doc is authoritative on the SQL that produces it, and the two must agree.

---

## 1. Testing philosophy for a production-grade accounting system

The ordering of our priorities is not negotiable, and it is not the conventional software ordering:

1. **Correctness of double-entry.** Every posted entry balances in transaction *and* base currency. This is tested at every layer and is allowed to fail a build on its own.
2. **Immutability and auditability.** Posted history cannot change; corrections are reversing entries; the audit log records who did what.
3. **Tenant isolation.** Company A can never read or write Company B's data. A leak here is a security incident, not a bug.
4. **Functional correctness of workflows.** Invoices, bills, payments, imports behave as specified.
5. **Performance and UX.** Last — fast wrong numbers are worse than slow right ones.

Three principles follow:

- **The ledger is tested where it is enforced.** The invariants in `_ARCHITECTURE-SPEC.md` §6 are enforced by Postgres triggers and posting functions (`accounting-engine.md`), so they are *primarily* tested against a real Postgres database, not against mocks. A TypeScript unit test that mocks the database can prove our intent; only a database test proves the guarantee. We do both, and we trust the database test.
- **Tests assert money, not mechanics.** A passing test for a posting routine is one that checks the resulting debits and credits hit the expected accounts for the expected amounts — not merely that a function was called. Assertions are written in the language of accounting: "AR is debited by the gross total, revenue is credited by the net, VAT payable is credited by the tax."
- **Red before green, always.** Every accounting-correctness and RLS test is first observed to fail when its guard is removed (drop the trigger, drop the policy) before it is trusted to pass. A test that has never failed is not yet evidence.

---

## 2. The test pyramid for this stack

```
                 ┌───────────────────────────┐
                 │  E2E (Next.js workflows)   │   few, slow, high-value
                 │  Playwright on real app    │
                 ├───────────────────────────┤
                 │  Integration                │   the load-bearing tier
                 │  real Postgres / Supabase   │   functions · triggers · RLS
                 ├───────────────────────────┤
                 │  Database (pgTAP / SQL)     │   invariants at the source
                 ├───────────────────────────┤
                 │  Unit (domain logic, TS)    │   many, fast, pure
                 │  src/modules/accounting     │
                 └───────────────────────────┘
```

Unlike a typical web app, the widest *value* in this pyramid sits in the integration and database tiers, because that is where the money rules live. The unit tier is broad but shallow; it guards pure calculation. We do not chase a tall E2E tier — E2E proves the wiring, not the arithmetic.

### 2.1 Unit — domain logic in `src/modules/accounting`

Pure TypeScript, no database, no network. Targets the calculation and shaping logic that prepares postings before they reach Postgres: line-total and tax math, fx base-amount conversion, the function that turns an invoice into a set of journal lines, numbering format helpers, period-resolution helpers.

- Runner: Vitest.
- No I/O. If a function needs the database, it belongs in the integration tier, not here.
- These tests are allowed to be exhaustive about edge cases (rounding, zero-quantity lines, 100% withholding) because they are cheap.

### 2.2 Integration — Postgres functions, triggers, RLS (real test DB)

The load-bearing tier. Runs against a **real Postgres** instance (Supabase local stack in CI, or a Postgres service container) with all migrations from `supabase/migrations/` applied and reference seed from `supabase/seed/` loaded. No mocks of the database.

Covers: the posting function and its `BEFORE` trigger; period-status enforcement; immutability triggers; numbering sequences; RLS policies exercised *through* PostgREST-equivalent role context (`set local role`, `set local request.jwt.claims`); the `core.user_companies()` / `core.has_permission()` helpers; derived views (`accounting.general_ledger`, trial balance).

- Runner: Vitest (orchestration) issuing SQL via a Postgres client, each test in its own transaction that is rolled back, OR pgTAP for assertions that read best as SQL.
- This is where "posting an unbalanced entry is rejected" is *actually* proven.

### 2.3 End-to-end — Next.js workflows

A small, curated set of full-stack journeys through the App Router UI against a running app and a real test database: create invoice → post → see it on the customer ledger → record receipt → invoice marked paid; run an import end to end; switch companies and confirm the other company's data is absent.

- Runner: Playwright.
- Authenticates as seeded *test* users (created by fixtures, see §7) with specific roles. Asserts both UI state and the resulting database rows.
- Kept few and high-value; E2E exists to prove the wiring between UI, API, and DB, not to re-test arithmetic already covered below.

### 2.4 Database-level — pgTAP / SQL assertions

Invariants asserted at the source, independent of any application code, so they hold even if a future module talks to the schema directly. Implemented as pgTAP test functions or plain SQL assertion scripts that `RAISE EXCEPTION` on violation.

Two flavours:
- **Structural** — constraints, triggers, and policies exist and are enabled (e.g. RLS is on for every table in `accounting` and `core`; the `journal_lines` CHECKs exist).
- **Behavioural** — seed a fixture, attempt an operation, assert the outcome (used heavily by §3 and §4).

---

## 3. Accounting-correctness test suite (the heart)

This suite is the reason the document exists. Each invariant below is stated, then given concrete assertions. Pseudocode is illustrative; the authoritative SQL lives in `accounting-engine.md`. Every test here runs in the integration or database tier against real Postgres.

### 3.1 Every posted entry balances — transaction AND base currency

The single most important test in the system.

```
TEST balanced_posting_required:
  given a draft entry in TTD with lines:
      debit  1000.00  base_debit  1000.00   (account: Cash)
      credit 1000.00  base_credit 1000.00   (account: Sales)
  when post(entry)
  then status = 'posted'
       AND sum(debit)  = sum(credit)         -- 1000 = 1000  txn ccy
       AND sum(base_debit) = sum(base_credit) -- 1000 = 1000  base ccy

TEST unbalanced_txn_rejected:
  given a draft entry with debit 1000.00, credit 900.00
  when post(entry)
  then RAISES (posting refused)  AND status still 'draft'

TEST balanced_txn_but_unbalanced_base_rejected:   -- the subtle one
  given a USD entry, fx_rate 6.8, lines balance in USD
        but base_debit != base_credit (e.g. a miscomputed conversion)
  when post(entry)
  then RAISES                                       -- base ccy must balance too
```

SQL assertion (database tier):

```sql
-- For every posted entry, both checks must hold. Must return zero rows.
select je.id
from accounting.journal_entries je
join accounting.journal_lines jl on jl.journal_entry_id = je.id
where je.status = 'posted'
group by je.id
having round(sum(jl.debit),4)      <> round(sum(jl.credit),4)
    or round(sum(jl.base_debit),4) <> round(sum(jl.base_credit),4);
```

### 3.2 Posted entries are immutable; corrections via reversing entries

```
TEST posted_entry_not_editable:
  given a posted entry E
  when UPDATE a journal_line of E (change an amount or account)
  then RAISES                                       -- immutability trigger fires
  when UPDATE E.entry_date or E.description
  then RAISES
  when DELETE a line of E
  then RAISES

TEST correction_is_reversal:
  given a posted entry E (Dr A 100 / Cr B 100)
  when reverse(E)
  then a new entry R exists with source linkage to E
       AND R lines are Dr B 100 / Cr A 100         -- mirror image
       AND R is posted and balanced
       AND E is unchanged                           -- original preserved
  and the net of E + R over accounts A and B is zero
```

A draft entry, by contrast, *is* freely editable — assert that too, so the immutability trigger is proven to discriminate on `status`.

### 3.3 Posting into a closed or locked period is rejected

```
TEST post_into_open_period_ok:
  given period P status 'open', entry dated within P
  when post(entry) then status = 'posted'

TEST post_into_closed_period_rejected:
  given period P status 'closed', entry dated within P
  when post(entry) then RAISES

TEST post_into_locked_period_rejected:
  given period P status 'locked'
  when post(entry) then RAISES

TEST reopen_then_post:                              -- guards the state machine
  given P 'closed', reopen to 'open', then post
  then status = 'posted'

TEST cannot_lock_period_with_draft_or_unbalanced:   -- per engine rules
  attempt to close P while a draft entry sits in P
  then RAISES or is flagged per accounting-engine.md policy
```

### 3.4 Trial Balance nets to zero; Balance Sheet balances

```
TEST trial_balance_nets_zero:
  given any set of posted entries for a company
  when select sum(base_debit) - sum(base_credit) from posted lines
  then result = 0.0000                              -- to 4dp, base ccy

TEST balance_sheet_identity:
  given posted entries
  compute Assets, Liabilities, Equity from account_types.category
  then Assets = Liabilities + Equity + (Income - Expense for the period)
       i.e. the accounting equation holds at all times
```

SQL assertion:

```sql
-- Company-wide trial balance in base currency must net to zero. Zero rows = pass.
select company_id, round(sum(base_debit) - sum(base_credit), 4) as net
from accounting.general_ledger          -- view over posted lines
group by company_id
having round(sum(base_debit) - sum(base_credit), 4) <> 0;
```

### 3.5 Source documents generate correct, balanced postings

For each document type, the expected debit/credit pattern is asserted exactly. Amounts are the *base-currency* postings; in single-currency cases transaction and base coincide. AR/AP control accounts come from `customers.receivable_account_id` / `suppliers.payable_account_id`; tax accounts from `tax_codes`.

**Sales invoice** (net 1000, VAT 12.5% = 125, gross 1125):

| Account | Debit | Credit |
|---|---|---|
| Accounts Receivable (control) | 1125.00 | |
| Sales / Revenue (per line account) | | 1000.00 |
| VAT Payable (`tax_codes.collected_account_id`) | | 125.00 |

```
assert sum(debit) == sum(credit) == 1125.00
assert AR.debit == invoice.total (gross)
assert revenue.credit == invoice.subtotal (net)
assert vat_payable.credit == invoice.tax_total
assert invoice.journal_entry_id is not null and that entry is posted
```

**Supplier bill** (net 800, VAT 100, gross 900):

| Account | Debit | Credit |
|---|---|---|
| Expense / Asset (per line account) | 800.00 | |
| VAT Receivable (`tax_codes.paid_account_id`) | 100.00 | |
| Accounts Payable (control) | | 900.00 |

**Customer payment / receipt** (receive 1125 against the invoice above):

| Account | Debit | Credit |
|---|---|---|
| Bank (`bank_accounts.account_id`) | 1125.00 | |
| Accounts Receivable (control) | | 1125.00 |

```
assert bank.debit == receipt.amount
assert AR.credit == receipt.amount
assert invoice.amount_paid increased by receipt.amount
assert invoice.status transitions open -> partial -> paid correctly
```

**Supplier payment** (pay 900 against the bill):

| Account | Debit | Credit |
|---|---|---|
| Accounts Payable (control) | 900.00 | |
| Bank | | 900.00 |

**Opening balance** (e.g. opening AR of 5000 brought forward):

| Account | Debit | Credit |
|---|---|---|
| Accounts Receivable (control) | 5000.00 | |
| Opening Balance Equity | | 5000.00 |

```
assert entry.source == 'opening_balance'
assert the full opening-balance batch nets to zero across all accounts
       (assets debited, liabilities/equity credited, contra to Opening Balance Equity)
```

For every document test, two universal assertions also apply: the generated entry **balances** (3.1) and the document carries a valid `journal_entry_id` pointing at a **posted** entry.

### 3.6 Multi-currency: base amounts at captured fx_rate; FX gain/loss

```
TEST base_amount_at_captured_rate:
  given a USD invoice, total 1000.00 USD, fx_rate 6.80 captured at invoice date
  then base_total == 6800.00 TTD
       AND each journal_line base_debit/base_credit == debit/credit * 6.80
       AND base amounts never re-derive when today's rate changes

TEST realized_fx_on_settlement:
  given USD invoice posted at rate 6.80  -> AR base 6800.00
  when paid in full at rate 7.00         -> bank base 7000.00
  then a realized FX gain of 200.00 is posted
       Dr Bank 7000 / Cr AR 6800 / Cr FX Gain 200   (entry balances in base)
       AND in transaction currency the USD amounts net exactly (1000 USD = 1000 USD)

TEST unrealized_fx_revaluation:
  given an open USD AR balance of 1000.00 at period end, period-end rate 7.10
  when run revaluation (source = 'fx_revaluation')
  then unrealized gain of (7.10-6.80)*1000 = 300.00 is posted to FX revaluation accounts
       AND the entry balances in base ccy
       AND transaction-currency movement on the AR control is zero
       AND a subsequent-period reversal of the unrealized entry exists per policy
```

### 3.7 Numbering integrity (no gaps / no duplicates where required)

```
TEST entry_no_unique_per_company:
  given many posted entries for company C
  then count(distinct entry_no) == count(*) within C    -- no dupes

TEST sequential_no_gaps_where_required:
  for sequences that must be gapless (e.g. invoice_no per company per series)
  then the set of numbers is contiguous with no holes

TEST concurrent_numbering_no_collision:
  given two concurrent posts for the same company
  then both succeed with distinct numbers (sequence/lock behaves under contention)
```

SQL assertion for duplicates:

```sql
-- Must return zero rows.
select company_id, entry_no, count(*)
from accounting.journal_entries
group by company_id, entry_no
having count(*) > 1;
```

---

## 4. Security / RLS test suite

Every test here runs against real Postgres with RLS enabled, executed *as a specific user* by setting the role and JWT claims the way PostgREST would, so policies are exercised exactly as in production. Tests assert both directions: the permitted action succeeds and the forbidden action is *denied* (returns zero rows or raises), never silently allowed.

### 4.1 Cross-company isolation

```
SETUP: company A and company B (fixtures). User uA is an active member of A only.

TEST read_isolation:
  acting as uA:
    select from accounting.journal_entries where company_id = B  -> 0 rows
    select from accounting.invoices       where company_id = B  -> 0 rows
    (RLS filters silently; B is invisible, not an error)

TEST write_isolation:
  acting as uA:
    insert a journal_entry with company_id = B   -> denied (0 rows / RLS error)
    update an existing A-visible row to set company_id = B -> denied

TEST membership_required:
  user with NO active membership sees nothing in any tenant table
  suspended/invited membership grants no access (status must be 'active')
```

### 4.2 Permission enforcement per role

Permissions are data-driven (`core.permissions` + `core.role_permissions`); tests must reflect that and never assume hard-coded keys in app code.

```
TEST view_only_cannot_write:
  user with View-only role on A:
    can SELECT invoices in A
    INSERT/UPDATE/post in A -> denied (lacks the write permission)

TEST accountant_can_post:
  user with Accountant role granted 'accounting.journal.post':
    post(entry) in A -> succeeds

TEST permission_revocation_takes_effect:
  remove the write permission from the role
  same user's write -> now denied            -- proves data-driven enforcement

TEST has_permission_helper:
  core.has_permission(A, 'accounting.invoice.create') reflects role_permissions
  for the acting user, true/false as seeded
```

### 4.3 Super Admin bypass

```
TEST super_admin_reads_all_companies:
  user with core.users.is_super_admin = true:
    select across companies A and B -> sees both
TEST super_admin_writes_cross_company:
    insert/update in A and B -> permitted
TEST non_super_admin_no_bypass:
    is_super_admin = false with membership in A only -> B invisible (regression guard)
```

### 4.4 Audit-log population

```
TEST audit_on_post:
  when an entry is posted by user u in company A
  then a core.audit_logs row exists with
       action ~ 'post', entity_schema='accounting', entity_type='journal_entry',
       entity_id = E.id, user_id = u, company_id = A, after jsonb populated

TEST audit_on_sensitive_change:
  period close/lock, permission change, membership change each write an audit row
TEST audit_is_append_only:
  attempt to UPDATE/DELETE a core.audit_logs row -> denied
```

---

## 5. Import test suite

The import rule from `_ARCHITECTURE-SPEC.md` §10 is absolute: imports are always staged and validated, and staging never touches live tables until an explicit commit.

```
TEST staging_does_not_touch_live:
  upload a batch -> rows land ONLY in accounting.import_staging_rows
  assert no rows created in journal_entries / invoices / accounts during upload/validate
  batch.status walks: uploaded -> validating -> validated  (no 'committed' yet)

TEST validation_catches_unbalanced_trial_balance:
  stage an opening trial balance whose debits != credits
  when validate(batch)
  then batch.status = 'failed', error_count > 0
       staging rows flagged with errors jsonb
       NOTHING posted to live tables

TEST validation_catches_unknown_account / bad_currency / bad_date:
  each invalid mapped row is flagged; batch fails; live tables untouched

TEST commit_is_atomic_and_balanced:
  given a validated, balanced batch
  when commit(batch)
  then all generated journal entries are posted and balanced (3.1)
       batch.status = 'committed'
       staging row count == produced live rows as expected

TEST rollback_on_commit_failure:
  force a failure mid-commit (e.g. a closed period mid-batch)
  then the WHOLE commit rolls back: zero live rows created, batch not 'committed'
       (all-or-nothing; no partial import ever persists)

TEST cross_company_import_isolation:
  a batch for company A can never write rows for company B (RLS + company_id check)
```

---

## 6. (covered above)

> Sections 3–5 constitute the correctness, security, and import suites. Section 7 addresses how their fixtures are created without violating the no-demo-data rule.

---

## 7. Test data strategy without violating the no-demo-data rule

`_ARCHITECTURE-SPEC.md` §10 forbids demo/fake data. That rule governs **application and seed data shipped with the product**. It does **not** forbid ephemeral fixtures created inside a test and destroyed when the test ends. The line is drawn precisely:

**Legitimate seed / reference data (lives in `supabase/seed/`, ships with the product, used by tests as-is):**
- `accounting.currencies` — TTD, USD, GBP, EUR.
- `accounting.account_types` — the five categories and their normal balances.
- `core.permissions` — the permission catalogue.
- System roles (`is_system = true`) and their `role_permissions`.

These are not "demo data"; they are the reference substrate the system requires to function. Tests consume them and must never mutate them.

**Test fixtures / factories (created inside tests, never shipped, always torn down):**
- Companies, users, memberships, chart-of-accounts entries, customers/suppliers, invoices, bills, periods, journal entries.
- Built by factory helpers in `tests/` (e.g. `makeCompany()`, `makeAccount()`, `makePostedEntry()`), parameterised so each test states exactly the money it cares about.

Isolation and teardown rules:
- **Transaction-per-test where possible.** Integration/DB tests run inside a transaction that is rolled back at the end — nothing persists, fastest teardown, perfect isolation.
- **Truncate-on-teardown otherwise.** For E2E and tests that must commit (numbering sequences, cross-transaction visibility), teardown truncates fixture tables for the test's company and removes its users. Reference/seed tables are excluded from truncation by an explicit allowlist.
- **No shared mutable fixtures across tests.** Each test makes its own company so a failure or leftover in one cannot poison another. Company IDs are unique per test run.
- **A guard test** asserts that the seed tables contain exactly the reference rows and no stray fixture rows leaked into them — proving the wall between seed and fixtures holds.

This gives realistic, fully-balanced test scenarios with zero fake data in any environment a user touches.

---

## 8. CI approach, coverage targets, regression policy

### 8.1 CI (GitHub Actions)

Pipeline stages, fail-fast in order, run on every pull request and on the default branch:

1. **Lint + typecheck** — ESLint, `tsc --noEmit`.
2. **Unit (Vitest)** — pure domain tests; no services.
3. **Database up** — start the **Supabase local stack** (or a `postgres` service container), apply all `supabase/migrations/`, load `supabase/seed/`.
4. **Database / pgTAP tests** — structural and behavioural invariants (§3, §4 at the SQL layer).
5. **Integration (Vitest + real Postgres)** — posting, triggers, RLS, helpers, views.
6. **E2E (Playwright)** — build and run the Next.js app against the test DB; run the curated journeys.
7. **Coverage gate** — aggregate and enforce thresholds (§8.2).

Sketch:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase db start          # or apply migrations to the service DB
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:db             # pgTAP / SQL assertions
      - run: npm run test:integration    # real Postgres, RLS as roles
      - run: npm run test:e2e
      - run: npm run coverage:check
```

The accounting-correctness DB suite (§3) and the RLS suite (§4) are **blocking**: a single failure fails the build with no override. There is no "flaky, re-run it" allowance for these two suites — a non-deterministic correctness test is itself a defect to fix.

### 8.2 Coverage targets

Coverage is necessary, not sufficient — we measure it but trust the invariant suites more.

- **Domain logic (`src/modules/accounting`): ≥ 90% line and branch.** This is pure money math; high coverage is achievable and expected.
- **Posting / period / immutability triggers and functions: 100% of branches.** Every rejection path (unbalanced txn, unbalanced base, closed period, locked period, edit-after-post) must have a test that hits it.
- **RLS policies: every policy exercised by at least one allow test and one deny test.** Measured by a policy-coverage checklist, not just line coverage.
- **Platform core (`src/core`): ≥ 80%.**
- Overall repo: ≥ 80%, but a drop in the two invariant areas above fails regardless of the aggregate.

### 8.3 Regression policy

- **Every production bug becomes a test first.** A fix is not merged until a test reproduces the bug (fails on the old code) and passes on the fix. The test names the issue.
- **Invariant tests are permanent.** A §3/§4 test is never deleted to make a build pass; if a requirement genuinely changes, the spec changes first, then the test, with the change recorded in Decisions Locked here and in the relevant doc.
- **Guard-removal validation.** Periodically (and whenever a trigger/policy is touched) confirm each invariant test fails when its guard is dropped — proving the test still guards something.
- **No silent skips.** Skipped or quarantined tests are listed in the PR and tracked as Open Questions; a suite cannot ship with hidden `.skip`s on correctness or RLS cases.

---

## 9. QA agent per-cycle checklist

The QA / Accounting Validation Agent runs this before any feature is "done." Every box must be green or the feature is not done.

**Accounting correctness**
- [ ] All posted entries balance in transaction currency (§3.1) — DB assertion returns zero rows.
- [ ] All posted entries balance in base currency (§3.1) — DB assertion returns zero rows.
- [ ] Company-wide trial balance nets to zero in base currency (§3.4).
- [ ] Balance Sheet identity holds (Assets = Liabilities + Equity + period P&L) (§3.4).
- [ ] Posted entries proven immutable; edit/delete rejected; reversal path works (§3.2).
- [ ] Posting into closed and locked periods rejected; open period accepts (§3.3).
- [ ] Each touched source document (invoice/bill/payment/receipt/opening) posts the exact expected debits/credits (§3.5).
- [ ] Multi-currency base amounts at captured `fx_rate`; realized and unrealized FX gain/loss correct (§3.6).
- [ ] Numbering: no duplicates per company; gapless where required; safe under concurrency (§3.7).

**Security / RLS**
- [ ] Cross-company read isolation holds (User A cannot see Company B) (§4.1).
- [ ] Cross-company write isolation holds, including re-assigning `company_id` (§4.1).
- [ ] Membership must be `active`; suspended/invited grant nothing (§4.1).
- [ ] Per-role permission enforcement: View-only cannot write, Accountant can post, revocation takes effect (§4.2).
- [ ] Super Admin bypass works; non-super-admin gets no bypass (§4.3).
- [ ] Audit log populated on post, period close/lock, permission and membership changes; append-only (§4.4).

**Import**
- [ ] Staging never touches live tables before commit (§5).
- [ ] Validation rejects unbalanced trial balances and bad rows; nothing posted on failure (§5).
- [ ] Commit is atomic and produces balanced postings; failure rolls back entirely (§5).

**Hygiene**
- [ ] No demo/fake data introduced; fixtures created and torn down within tests; seed/reference data untouched (§7).
- [ ] New behaviour covered by tests at the correct tier; coverage gates met (§8.2).
- [ ] Any new bug fixed in this cycle has a regression test that failed before the fix (§8.3).
- [ ] No new skipped/quarantined correctness or RLS tests.

---

## Open Questions

- Tooling for the database tier: standardise on **pgTAP** for behavioural DB tests, or keep behavioural assertions in Vitex-over-SQL and reserve pgTAP for structural checks? (Leaning pgTAP for structural, Vitest for behavioural to share fixtures with integration tests — pending confirmation.)
- Exact RLS test harness: simulate PostgREST via `set local role` + `set local request.jwt.claims`, versus hitting the running PostgREST/Supabase API over HTTP. The former is faster and deterministic; the latter is higher fidelity. May run both for the RLS suite.
- Unrealized FX reversal policy (auto-reverse next period vs. standing revaluation) — must be locked in `accounting-engine.md` before §3.6 tests are finalised.
- Gapless-numbering scope: which series are statutorily required to be gapless under T&T rules (`trinidad-accounting-requirements.md`) versus merely unique?
- Performance/load testing tier (large ledgers, report query times) — out of scope for v1 correctness gate; to be specified separately.

## Decisions Locked

- Priority order for testing is: double-entry correctness → immutability/audit → tenant isolation → functional → performance. Correctness and RLS suites are independently build-blocking.
- The double-entry and RLS invariants are tested **primarily against real Postgres** (integration + database tiers); mocks may supplement but never substitute.
- Fixtures created and destroyed within tests are permitted and are **not** "demo data"; seed/reference data (`currencies`, `account_types`, `permissions`, system roles) is the only data tests treat as pre-existing, and tests never mutate it.
- Every production bug must be reproduced by a failing test before its fix is merged; invariant tests are permanent and never deleted to green a build.
- Coverage: ≥ 90% domain logic, 100% of posting/period/immutability rejection branches, every RLS policy with an allow-and-deny pair; aggregate ≥ 80%. A regression in the invariant areas fails the build regardless of aggregate coverage.

---

*Cross-references: `_ARCHITECTURE-SPEC.md` (invariants §6, RBAC §7, multi-currency §8, non-negotiables §10), `accounting-engine.md` (posting SQL, triggers, derived GL), `trinidad-accounting-requirements.md` (tax/period statutory rules), `accountedge-myob-audit.md` (parity expectations).*
