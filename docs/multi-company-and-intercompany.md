# Multi-Company & Inter-Company Architecture

**TEAL Enterprise — Platform Core + Accounting Module**
**Owning agent:** Inter-Company Agent
**Status:** Draft v1 — 2026-06-21

> **Purpose.** This is the definitive reference for two related things: (1) how TEAL Enterprise is *already* multi-tenant — every record scoped to a `company_id`, isolated by RLS, and selected by an active-company cookie — and how a company independently owns its accounting books; and (2) the **inter-company transfer model** being built on top of that, where one balanced economic event is recorded as two linked journal entries (one per company) through Due-from / Due-to control accounts, tracked by a `core.intercompany_transfers` link table that later powers group consolidation and elimination.
>
> It contains no migrations and no application code by design; table and function names are real and authoritative. SQL fragments appear only to make rules precise.

Related: [_ARCHITECTURE-SPEC.md](_ARCHITECTURE-SPEC.md) (authoritative names/types), [platform-module-framework.md](platform-module-framework.md) (one core, many modules; per-company module enablement), [security-and-permissions.md](security-and-permissions.md) (RLS/RBAC), [accounting-engine.md](accounting-engine.md) (the ledger, `post_journal_entry`, `reverse_journal_entry`, the derived `general_ledger`), [multi-currency-architecture.md](multi-currency-architecture.md) (base currency, `fx_rate`, dual-amount storage — the foundation for §6 multi-currency inter-company).

---

## 1. How multi-tenancy already works

TEAL Enterprise is multi-tenant **today**. Tenancy is not a feature to be added; it is the substrate every table, query, and screen already sits on. The pieces:

### 1.1 `company_id` on every business row

A **company** (`core.companies`) is the tenant. Every business table — across both `core` and `accounting` — carries a `company_id uuid not null references core.companies(id) on delete cascade`. This is visible throughout `0001_core_schema.sql` (`core.clients`, `core.documents`, `core.audit_logs`) and `0002_accounting_schema.sql` (`accounts`, `accounting_periods`, `tax_codes`, `journal_entries`, `journal_lines`, `customers`, `suppliers`, `bank_accounts`, `invoices`, `bills`, …). A company also declares its own `base_currency_code` (default `TTD`), `country_code`, `fiscal_year_start_month`, and `timezone` — so each tenant keeps its books on its own terms.

The `accounting` schema goes further than a bare `company_id`: it uses **composite foreign keys** to make cross-tenant references structurally impossible. `accounting.accounts` and `accounting.journal_entries` both declare `unique (company_id, id)`, and `accounting.journal_lines` then references `(company_id, journal_entry_id) → journal_entries(company_id, id)` and `(company_id, account_id) → accounts(company_id, id)`. A journal line therefore *cannot* point at another company's entry or account even if application code tried — the database rejects it. This matters in §5: an inter-company transfer is **two entries in two companies**, never one entry spanning two companies.

### 1.2 RLS scopes every row by membership

`0003_rls_and_helpers.sql` enables row-level security on every tenant table and gates it with three SECURITY DEFINER helpers:

- `core.user_companies()` → the set of `company_id`s the current `auth.uid()` is an **active** member of (from `core.company_memberships` where `status = 'active'`).
- `core.has_permission(p_company, p_key)` → true if the user is a super admin, or holds a role in `p_company` whose permissions include `p_key`.
- `core.is_super_admin()` → reads `core.users.is_super_admin`.

The standard policy shape (applied in a loop to every company-scoped table) is:

```
select using ((select core.is_super_admin()) or company_id in (select core.user_companies()))
insert with check ((select core.has_permission(company_id, '<perm>')))
update / delete using/with check ((select core.has_permission(company_id, '<perm>')))
```

So **read = active membership; write = the relevant permission for that company**. A user who belongs to companies A and B sees A's and B's rows and nothing else; the database enforces it regardless of what the application asks for. The derived `accounting.general_ledger` view runs `security_invoker = true`, so the underlying tables' RLS still applies through the view.

### 1.3 The active-company cookie and the company switcher

A user may belong to many companies, but acts in **one at a time**. The active company lives in an HTTP-only cookie (`teal_active_company`), read and written in `src/core/session/active-company.ts`:

- `readActiveCompanyId()` reads the cookie.
- `setActiveCompany(formData)` — the `'use server'` action bound to the company switcher form — writes the cookie and `revalidatePath('/', 'layout')` so the whole shell re-scopes.

`src/core/session/context.ts` (`getPlatformContext`, memoized per request) resolves the session: it loads the user's companies (all of them for a super admin; the user's active memberships otherwise), picks the active company (the cookie if it is still a company the user may act in, else the first available), and loads that company's **enabled modules** and the active role's **permissions**. Module code reads the active company through `accountingDb()` (`src/modules/accounting/context.ts`), which returns `{ supabase, acc: supabase.schema('accounting'), companyId: ctx.activeCompanyId, ctx }`. Every query then filters `.eq('company_id', companyId)` *and* is independently constrained by RLS — belt and braces.

The cookie selects scope; **RLS enforces it**. Switching companies cannot leak data, because even with a forged cookie the user only ever sees companies in `core.user_companies()`.

### 1.4 What each company independently owns

Within its tenant boundary, a company owns a **complete, self-contained set of accounting books**:

- **Chart of accounts** — `accounting.accounts`, `unique (company_id, code)`. Company A's `1200 Accounts Receivable` is a different row from company B's.
- **Accounting periods** — `accounting.accounting_periods`, `unique (company_id, fiscal_year, period_no)`, with a per-company no-overlap exclusion constraint. Each company opens, closes, and locks its own periods on its own fiscal calendar (`core.companies.fiscal_year_start_month`).
- **Settings** — base currency, tax codes (`accounting.tax_codes`, no hard-coded rates), per-company number sequences (`accounting.number_sequences`), and per-company module settings (`core.company_modules.settings jsonb`).
- **AR / AP** — `customers`, `suppliers`, `invoices`, `bills` and their lines, each with their own control accounts.
- **Journals & GL** — `journal_entries` / `journal_lines`, posted via `accounting.post_journal_entry`, surfaced through the per-company `general_ledger` view.
- **Reports** — trial balance, balance sheet, income statement, AR/AP aging, dashboards (`dashboard_configs`), exports (`report_exports`) — all summing that company's `base_*` columns only.

Two companies in the same Taylor group are, accounting-wise, **two separate ledgers** that happen to share a platform, a user base, and a design system. Nothing flows between them automatically. The inter-company model in §5 is the *only* sanctioned bridge, and it bridges them as two explicit, linked, balanced entries — never as a shared row.

---

## 2. Company administration

### 2.1 Create / list / switch

- **List.** Resolved per request in `getPlatformContext`: super admins get every `core.companies` row; regular users get the companies behind their active memberships. RLS (`companies_sel`) backs this — `core.is_super_admin() or id in (select core.user_companies())`.
- **Switch.** `setActiveCompany` (§1.3) sets the cookie; the next render re-scopes. No data moves.
- **Create.** Inserting `core.companies` is governed by `companies_ins`, whose check is `core.is_super_admin()`. **Today, only a super admin can create a company** (see §2.4). Company creation also implies bootstrapping: a base currency, an initial membership for the creator, the company's default system roles, and the modules the company should run (§2.3).

### 2.2 Memberships & roles per company

The user ↔ company link is `core.company_memberships (user_id, company_id, role_id, status)`, `unique (user_id, company_id)` — **a user has exactly one role per company**, and a different role in each company they belong to. Roles live in `core.roles`, scoped per company (`company_id` set) or system-wide (`company_id null`). Permissions are a **data-driven catalogue** (`core.permissions`) wired to roles through `core.role_permissions`; access rules are never hard-coded in application logic. `can(ctx, perm)` in `src/core/session/types.ts` checks the active role's permission set resolved by the context.

Managing memberships and company roles is gated by the `users.manage` permission (the `company_memberships` and `roles` policies in `0003`). So a **company admin** (a role carrying `users.manage`) can invite users, assign roles, and define company-specific roles *for their own company* — without being a platform super admin.

### 2.3 Enabling modules per company

Modules are registered platform-wide in `core.modules` (`accounting`, `cargo`, …) and **enabled per company** in `core.company_modules (company_id, module_id, enabled, settings jsonb)`. `getPlatformContext` loads the active company's enabled module keys; `requireModule` (`src/core/session/guard.ts`) gates module routes on them. Toggling `company_modules` is gated by `company.manage`. This is how one company in the group can run Accounting only while another runs Accounting + Cargo Assurance — a data change, not a code change (per `platform-module-framework.md`).

### 2.4 RLS note — creating companies currently needs a super admin

`companies_ins` requires `core.is_super_admin()`. This is a deliberate v1 simplification: there is no "create a company" permission a non-super-admin can hold, because creating a tenant is a privileged platform act (it provisions a brand-new isolation boundary, seeds roles, and grants the creator the first membership). The consequence: **today, a group administrator who is not a super admin cannot self-serve a new subsidiary company** — a super admin must create it (or run a privileged provisioning action). Loosening this — e.g. a `companies.create` permission, or a "group owner" who may spin up companies within their group — is an Open Question (§7), and it interacts with how the *first* membership is granted (a chicken-and-egg the super-admin path currently sidesteps).

---

## 3. The shape of the problem inter-company solves

Within the Taylor group, two companies on the platform routinely transact with **each other**: company A funds company B, A pays an expense on B's behalf, A allocates shared overhead to B, A lends to B. Each such event is **one economic transaction with two accounting consequences** — a debit somewhere in A and a matching credit-equivalent somewhere in B — that today would have to be keyed twice, by hand, with no link between the two sides and no way to prove they agree.

The requirements that fall out of this:

1. Recording one event must post **balanced entries in *both* companies' ledgers**, each on its own chart, periods, and numbering (§1.4) — never one entry spanning two tenants (§1.1 forbids that structurally).
2. The two sides must sit in **control accounts** that make the relationship visible and reconcilable: A is *owed by* B (an asset, "Due from B"); B *owes* A (a liability, "Due to A"). These two should always agree.
3. There must be a **durable link** between the two entries so the platform can later (a) reconcile the pair, (b) reverse them together, and (c) **eliminate** them in group/consolidated reporting (§6.2).

The model in §4–§5 delivers exactly this.

---

## 4. The inter-company model

### 4.1 Due-from / Due-to control accounts

Each participating company carries one **inter-company control account per counterparty company** in its own chart of accounts (`accounting.accounts`):

- In the **source** company (the one giving value): a **"Due from <counterparty>"** account — an **asset** (a receivable from the related company).
- In the **target** company (the one receiving value): a **"Due to <counterparty>"** account — a **liability** (a payable to the related company).

These are ordinary `accounting.accounts` rows of category `asset` / `liability`, flagged as inter-company and associated with the counterparty `company_id` (so the platform knows account X in company A pairs with account Y in company B). They are *control* accounts: their balance is the running net inter-company position, and — within a same-base-currency pair — A's "Due from B" and B's "Due to A" must be **equal and opposite at all times** (the reconciliation invariant). How these accounts are provisioned — auto-created when an inter-company relationship is first established, or configured on company settings — is an Open Question (§7), mirroring the FX/Rounding-account question in `multi-currency-architecture.md`.

### 4.2 The linked-entries pattern

One inter-company transfer becomes **two independent journal entries**, one per company, each balanced on its own books and posted through the standard engine (`accounting.post_journal_entry`) — there is no special posting path, no bypass of period/permission/balance checks. They carry `source = 'manual'` for v1 (a dedicated `intercompany` value on the `accounting.entry_source` enum is a roadmap item, §7).

Worked: company **A** transfers **TTD 10,000** of value to company **B** (say, A pays a B supplier, or funds B). Both companies are TTD-base (same-currency v1, §5).

**Source company A** — entry A (A is now owed by B):

| Account | debit | credit |
|---|---:|---:|
| Due from B (asset, inter-co control) | 10,000.00 | 0 |
| Bank / Expense / source account | 0 | 10,000.00 |

**Target company B** — entry B (B now owes A, and books the value it received):

| Account | debit | credit |
|---|---:|---:|
| Expense / Asset received | 10,000.00 | 0 |
| Due to A (liability, inter-co control) | 0 | 10,000.00 |

Each entry balances on its own (debits = credits, in both transaction and base currency — `multi-currency-architecture.md` §7). After both post, A's "Due from B" carries +10,000 and B's "Due to A" carries +10,000: equal and opposite, the relationship is visible from either side, and the group nets to zero (§6.2). The two are recorded and posted **transactionally where possible** — both succeed or the transfer is rolled back / surfaced as an error — so the books never carry a one-sided inter-company entry. (Cross-company posting is the one place a server action must legitimately act in two tenants in one operation; it does so by posting two single-tenant entries, each fully RLS-valid for a user who is a member of both companies — see §5.3.)

### 4.3 `core.intercompany_transfers` — the link table

The durable spine connecting the two sides is a new **core** table (it spans two companies, so it belongs in `core`, not in any one module's schema — consistent with `platform-module-framework.md`'s rule that cross-cutting links live in the core):

```
core.intercompany_transfers(
  id                  uuid pk,
  source_company_id   uuid references core.companies(id),   -- A
  target_company_id   uuid references core.companies(id),   -- B
  source_entry_id     uuid,   -- accounting.journal_entries in A
  target_entry_id     uuid,   -- accounting.journal_entries in B
  amount              numeric(20,4),    -- transaction-currency amount of the transfer
  currency_code       char(3),          -- v1: equals both companies' base currency
  -- multi-currency (v6): source/target base amounts + the fx rate(s) used
  transfer_date       date,
  description         text,
  status              text,             -- draft | posted | reversed
  created_by          uuid references core.users(id),
  created_at          timestamptz,
  check (source_company_id <> target_company_id)
)
```

This row is the **identity of the economic event**. It pairs the two journal entries, records the amount/currency/date once, and is the join key for:

- **Reconciliation** — confirming A's "Due from B" balance equals B's "Due to A" balance, transfer by transfer.
- **Joint reversal** — reversing a transfer reverses *both* entries via `accounting.reverse_journal_entry` (each on its own books), and flips the link `status` to `reversed`. Because the engine guarantees posted entries are immutable and reversible at most once, the pair stays consistent.
- **Elimination** — group consolidation (§6.2) reads this table to know exactly which entries/balances to cancel.

**RLS on the link table** must reflect that it touches two tenants: a user may see / create a transfer row only if they are an active member (with the right permission) of the company they are acting *from*, and the counterparty must be a real company. A natural policy: `select using` membership in **either** `source_company_id` **or** `target_company_id`; `insert with check` the relevant inter-company permission (a new `intercompany.transfer` key) in the **source** company *and* membership in the target. The exact two-sided policy is an Open Question (§7) because it is the one place RLS must reason about a row that legitimately belongs to two tenants at once.

### 4.4 Same-currency v1

**Version 1 is restricted to transfers where both companies share the same base currency** (the common all-TTD intra-group case). With one currency, the amount, both entries' base amounts, and both control-account balances are all in the same unit; the reconciliation invariant ("Due from" = "Due to") is a plain equality with no FX residue. This keeps v1 correct and simple. The moment the two companies have **different** base currencies, an exchange rate enters between two *bases* and the symmetry breaks — that is §6.1, deliberately deferred.

---

## 5. How posting to both companies works

### 5.1 One action, two single-tenant postings

A new `'use server'` action (its own file, owned by this agent — not touching `ar.ts`/`ap.ts`/`actions.ts`) orchestrates the transfer. It does **not** invent a new posting mechanism; it calls the existing engine twice, exactly as `createInvoice` in `ar.ts` assembles a balanced entry and calls `acc.rpc('post_journal_entry', { p_entry_id })`. Sequence:

1. Validate input (source company, target company, amount > 0, date, control accounts resolved on both sides, same currency).
2. Insert the `core.intercompany_transfers` link row (`status = 'draft'`).
3. In **company A**: insert entry A + its two lines (Dr Due-from-B, Cr source), `post_journal_entry(entryA)`.
4. In **company B**: insert entry B + its two lines (Dr received value, Cr Due-to-A), `post_journal_entry(entryB)`.
5. Link both `journal_entries.source_id`/the transfer's `source_entry_id` & `target_entry_id`, set transfer `status = 'posted'`.
6. On any failure, surface `{ error }` (client-form pattern) / redirect with `?error=`; do not leave one side posted without the other (see §5.2).

### 5.2 Atomicity — both or neither

The hard requirement: **the platform must never carry a posted source entry with no posted target entry** (or vice-versa). Options, in order of preference:

- A **database function** (`accounting.post_intercompany_transfer(...)` or `core.*`) that, in a single transaction, creates and posts both entries and the link row. SECURITY DEFINER, checking `core.has_permission` for the inter-company permission in *both* companies. This gives true atomicity and is the recommended target (it mirrors how `post_journal_entry` already owns the integrity-critical path). — **Open Question / roadmap (§7).**
- Interim application-level orchestration that, if step 4 fails after step 3 posted, immediately reverses entry A (`reverse_journal_entry`) and marks the transfer `failed`. Correct but leaves a reversal trail rather than a clean rollback.

Either way the engine's own guarantees hold per entry: each side must balance in both currencies, fall in an **open** period *for its own company*, and respect that company's numbering and permissions. A transfer can thus legitimately fail if, say, B's target period is closed while A's is open — surfaced as an actionable error, never a half-posted transfer.

### 5.3 Authorization across two tenants

The acting user must be authorized in **both** companies for the posting to succeed, because `post_journal_entry` internally calls `core.has_permission(company_id, 'journals.post')` for *that* entry's company and raises if absent. So a user posting an inter-company transfer A→B needs `journals.post` (and the inter-company permission) in **A and B**. This is the correct constraint for an intra-group operator who administers both companies, and it falls out of the existing engine with no new enforcement. A user who is a member of A but not B cannot post the B side — which is exactly why the same-operator, multi-company case (§7 access control) is the primary v1 audience.

---

## 6. Considerations & roadmap

### 6.1 Multi-currency inter-company (FX between two base currencies)

When A is TTD-base and B is USD-base, a single transfer amount cannot be one number on both books. The transfer has a **transaction currency** and each company records its own **base equivalent** using its own `fx_rate` (`multi-currency-architecture.md` §4): entry A converts the amount into TTD; entry B converts it into USD. Consequences:

- The "Due from B" balance (in A's TTD books) and "Due to A" balance (in B's USD books) are **no longer a plain equality** — they agree only after translation at a chosen rate, and they drift as rates move. The pair becomes a **monetary foreign-currency balance** on each side, subject to realized FX on settlement and unrealized FX on revaluation (`multi-currency-architecture.md` §6).
- `core.intercompany_transfers` must store the **transaction-currency amount plus both base amounts and the rate(s) used**, so consolidation (§6.2) can re-derive the elimination cleanly and any FX difference lands in an FX gain/loss account on the appropriate side.
- The **choice of which base is the bridge currency** for the transaction (A's, B's, or a third) and how period-end revaluation treats inter-company balances are Open Questions. This whole sub-feature is **deferred past v1** (§4.4) precisely because it layers two independent FX surfaces (one per company) on top of an already-careful linked posting.

### 6.2 Group / consolidated reporting with inter-company elimination

The point of the link table is **consolidation**. A consolidated report over a set of companies (a "group") is, first approximation, the sum of each company's `base_*` GL — but that **double-counts every inter-company transfer**: A's "Due from B" asset and B's "Due to A" liability are the *same* internal balance and must net to zero in the group view; likewise an inter-company income/expense pair must cancel.

`core.intercompany_transfers` makes elimination **exact rather than heuristic**: the group report walks the link table, and for every transfer whose both companies are inside the consolidation set, it **eliminates** the paired control-account balances (and any paired P&L lines) it points to. Same-currency (v1) elimination is a clean cancellation; multi-currency elimination (§6.1) cancels the matched portion and routes the translation difference to a consolidation FX reserve. A **group** is a new concept (a set of companies, likely `core.company_groups` + membership) needed to define "inside the consolidation set" and to scope who may run consolidated reports — Open Question / roadmap (§7). Elimination entries are *reporting-only*: they never post to any company's actual ledger (each company's statutory books stay standalone and correct), consistent with §1.4.

### 6.3 Recurring inter-company allocations

Many intra-group transfers repeat: monthly shared-overhead allocation, management fees, cost-sharing on a fixed key. A **recurring allocation** is a saved template (counterparties, accounts, amount or a percentage/driver-based split) that, on a schedule, generates a fresh `core.intercompany_transfers` + its two entries through the very same posting path (§5). Each run produces a normal, auditable, reversible transfer — recurrence is just *automated origination*, never a new posting mechanism. Driver-based allocation (split by headcount, revenue, floor area) and the scheduling/runner are roadmap; the data model is the same link table with a `recurring_template_id` (§7).

### 6.4 Per-company numbering

Numbering is already per company: `accounting.number_sequences (company_id, key, prefix, next_value, padding)` and `accounting.next_number(company, key)` serialize a sequence **within one company** (`0004_functions_posting.sql`). An inter-company transfer therefore yields **two independent entry numbers** — one from A's `journal_entry` sequence, one from B's — which is *correct*: each company's statutory journal must number contiguously on its own. The shared identity is the `core.intercompany_transfers.id` (and optionally a human-readable group transfer reference drawn from a platform-level sequence), not a shared entry number. A dedicated `intercompany` number-sequence key per company (so inter-company transfers are findable as a class within each ledger) is a small roadmap nicety.

### 6.5 Access control when a user belongs to several companies

This is the central UX/security question and the v1 audience. A single operator who administers several group companies wants to: see all their companies (already true — §1.1, §2.1), switch between them (already true — §1.3), and **act across two at once** for a transfer. The model handles it cleanly because:

- The active-company cookie still scopes *normal* work to one company; only the inter-company action deliberately touches two, and it does so as two RLS-valid single-tenant postings (§5.1).
- The engine already demands the user hold `journals.post` in **each** company they post into (§5.3), so authority is checked per side — a user can only originate a transfer between two companies they are genuinely authorized in.
- A new `intercompany.transfer` permission gates *initiating* a transfer; consolidated reporting gets its own permission (e.g. `reports.consolidated`) scoped to a group (§6.2). Membership in **both** companies (or super-admin) remains the floor.

The open edges: should a transfer be allowed when the user is a member of A but only an *approver* in B (a two-person, two-sided approval flow)? How does the link-table RLS (§4.3) express "visible to members of either side"? These are Open Questions, but the multi-company-membership case itself is already first-class in the platform — inter-company simply leans on it.

---

## 7. Open Questions

- **Self-serve company creation.** Should a non-super-admin "group owner" be able to create companies (a `companies.create` permission, or a group-scoped grant), given `companies_ins` currently requires `core.is_super_admin()` and the first-membership bootstrap? (§2.4)
- **Inter-company control-account provisioning.** Auto-create a "Due from / Due to <counterparty>" account pair when an inter-company relationship is first established, or require them as configured accounts on company settings? How is the A-account↔B-account pairing recorded? (§4.1)
- **`entry_source` value.** Add a dedicated `intercompany` value to the `accounting.entry_source` enum (vs. reusing `manual`), so inter-company entries are filterable as a class on each ledger. (§4.2)
- **Atomic posting function.** Build `accounting.post_intercompany_transfer(...)` (single-transaction, both sides + link row, SECURITY DEFINER checking permission in both companies) as the integrity-critical path, vs. interim application-level orchestration with compensating reversal. (§5.2)
- **Link-table RLS.** The exact two-sided policy for `core.intercompany_transfers` (visible to members of *either* company; insert requires permission in source + membership in target). (§4.3)
- **Multi-currency bridge currency & revaluation.** Which base is the bridge currency for a cross-base transfer; how period-end revaluation treats open inter-company balances; what FX columns the link table stores. (§6.1)
- **Group model & consolidation scope.** Introduce `core.company_groups` (+ membership) to define a consolidation set and gate consolidated reporting (`reports.consolidated`); how multi-currency elimination routes the translation difference to a consolidation FX reserve. (§6.2)
- **Recurring allocations.** Template model (`recurring_template_id`), driver-based split (headcount/revenue/area), and the scheduler/runner. (§6.3)
- **Two-sided approval.** Should originating a transfer require approval on the target side when the user is not fully authorized in both companies? (§6.5)

## 8. Decisions Locked

- **The platform is already multi-tenant.** Every business row carries `company_id`; RLS scopes **read = active membership, write = the relevant permission** via `core.user_companies()` / `core.has_permission()`; the active-company cookie (`teal_active_company`) selects scope and the company switcher (`setActiveCompany`) re-scopes the shell. (§1)
- **Each company independently owns its full books** — chart of accounts, periods, settings, tax codes, numbering, AR/AP, journals, GL, and reports — isolated by `company_id` and, in `accounting`, by composite FKs that make cross-tenant references structurally impossible. (§1.1, §1.4)
- **A user has one role per company** (`core.company_memberships`, `unique (user_id, company_id)`) and may belong to many companies with a different role in each; memberships/roles are managed under `users.manage`, modules enabled per company under `company.manage`. (§2.2, §2.3)
- **Creating a company currently requires a super admin** (`companies_ins` ⇒ `core.is_super_admin()`); loosening this is deferred. (§2.4)
- **One inter-company event = two linked, single-tenant journal entries**, each balanced and posted through the standard `post_journal_entry` engine — never one entry spanning two tenants. (§4.2, §5.1)
- **Due-from (asset) / Due-to (liability) control accounts** carry the inter-company position; same-currency, they are equal and opposite (the reconciliation invariant). (§4.1)
- **`core.intercompany_transfers` is the link spine** pairing the two entries; it lives in `core` because it spans two tenants, and it is the join key for reconciliation, joint reversal, and consolidation elimination. (§4.3)
- **v1 is same-base-currency only.** Cross-base-currency inter-company (two FX surfaces, drifting control balances, consolidation FX reserve) is explicitly deferred. (§4.4, §6.1)
- **Posting is atomic — both sides or neither** — and authorization is checked per side (`journals.post` in *each* company), which falls out of the existing engine. (§5.2, §5.3)
- **Consolidation eliminates via the link table** (reporting-only entries; each company's statutory books stay standalone); per-company numbering yields two independent entry numbers tied together only by the transfer id. (§6.2, §6.4)

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative names/types; multi-tenant `company_id` + RLS); `platform-module-framework.md` (one core / many modules; per-company module enablement; cross-cutting links live in `core`); `security-and-permissions.md` (the RLS helpers and RBAC catalogue this model reuses); `accounting-engine.md` (`post_journal_entry` / `reverse_journal_entry`, immutability, the derived `general_ledger`); `multi-currency-architecture.md` (base currency, `fx_rate`, dual-amount storage — the foundation for multi-currency inter-company in §6.1).
