# UI & Workflows

**TEAL Enterprise — Accounting Module**
Owning agent: UI / Workflow Agent
Status: Draft v1 — 2026-06-17

**Purpose.** This document specifies the information architecture, navigation, and user workflows for the TEAL Enterprise platform shell and the Accounting module (Phase 1). It defines how the app is structured, how routing maps to the repository layout in `_ARCHITECTURE-SPEC.md` §3, how data-driven permissions gate the interface, and how the core accounting tasks flow step-by-step — always referencing the postings and lifecycle rules defined in `accounting-engine.md`. It covers information architecture and workflow only; it does not prescribe visual design and contains no screenshots.

This document conforms to `_ARCHITECTURE-SPEC.md`. It is authoritative on UI structure and workflow sequencing; it is **not** authoritative on engine internals (`accounting-engine.md`), import internals (`import-architecture.md`), or the schema (`_ARCHITECTURE-SPEC.md` §5). Where a UI rule appears to conflict with those, they win.

---

## 1. First principles for the interface

Five rules shape every screen and flow below.

1. **The UI is never the only gate.** Every permission check, balance check, and period check rendered in the interface is a *mirror* of a server-enforced rule (RLS in `_ARCHITECTURE-SPEC.md` §7; posting/period functions in `accounting-engine.md` §5–§6). The UI hides what a user may not do to keep the screen honest and uncluttered; the database refuses what a user may not do. A bypassed or stale client never escapes an invariant.
2. **No fake data, ever.** Empty states are real (§10). A brand-new company shows genuine "nothing here yet" affordances and the action that creates the first real record — never seeded demo rows, never a fake dashboard (`_ARCHITECTURE-SPEC.md` §10).
3. **Company context is ambient and explicit.** Every accounting screen reads and writes within exactly one active company. The active company is always visible and always switchable; it is never assumed (`_ARCHITECTURE-SPEC.md` §10, "no single-company assumptions").
4. **Drafts are safe; posting is a deliberate, server-confirmed act.** Editing a draft is optimistic and forgiving. Posting, closing a period, and voiding are server-confirmed transitions whose success the UI waits for and reflects truthfully (§9).
5. **Modules are loosely coupled in the shell too.** Accounting is the only live module, but the navigation, routing, and permission model are built so future modules slot in without reshaping the core (`_ARCHITECTURE-SPEC.md` §1).

---

## 2. The app shell

### 2.1 Three regions of ambient context

Every authenticated screen is composed of a persistent shell wrapping a routed content area. The shell carries three pieces of always-on context:

- **Company switcher** — the active-company selector. Establishes the tenant scope for everything below it.
- **Module navigation** — the set of modules enabled for the active company. Accounting is live; others are placeholders.
- **Identity & session** — the signed-in user, their role *in the active company*, and account/sign-out controls.

A breadcrumb / page-title strip and the routed content fill the remainder. The shell itself is rendered by `app/(platform)/` (§3); the content area is owned by whichever module route is active.

### 2.2 Top-level navigation

Top-level navigation is a two-axis model:

- **Module axis (primary).** Switches the whole working context between modules. Phase 1: **Accounting** (live) plus disabled, clearly-labelled placeholders for the future modules named in `_ARCHITECTURE-SPEC.md` §1 (Survey Management, Claims Management, Cargo Monitoring, Ship Agency Operations, Freight Forwarding, Compliance, Document Management, Reporting & Analytics, Administration). Placeholders are visible (so the platform's scope is legible) but inert and never routable in Phase 1.
- **Section axis (within a module).** Switches between the screens of the active module (Dashboard, Chart of Accounts, Journals, Sales, Purchases, Banking, Periods, Reports, Imports, Settings for Accounting — §6 lists routes).

A **Platform / Administration** area sits outside any module: company management, memberships & roles, and the user's own profile. It is reachable from the identity menu and from the Administration placeholder once that module lands.

### 2.3 The company switcher (active-company context)

The company switcher is the spine of the multi-tenant UX.

- **What it lists.** Exactly the companies for which the signed-in user has an `active` `core.company_memberships` row (`_ARCHITECTURE-SPEC.md` §5, §7). A Super Admin (`core.users.is_super_admin`) sees all companies, reflecting the RLS bypass (`_ARCHITECTURE-SPEC.md` §7).
- **What selecting one does.** Sets the active `company_id` for the session. Every subsequent read and write is scoped to it. The selection survives reloads (persisted client-side and revalidated against memberships on load) and is encoded in the route where practical so links are shareable and deep-linkable within a company.
- **Role is per-company.** The user's role, and therefore their permissions, are resolved *for the active company* via the membership's `role_id`. Switching companies can change what the user may see and do; the navigation and action affordances re-resolve on switch (§5).
- **Edge cases.**
  - *No memberships.* The user lands on a "no company access" state (§10.1) with a path to request access; no module navigation renders.
  - *Single membership.* The switcher still renders (no single-company assumption) but auto-selects the only company.
  - *Membership suspended/removed mid-session.* The next server interaction fails RLS; the UI catches this and returns the user to company selection rather than showing a half-broken screen.

### 2.4 Module navigation and enablement

A module appears as **live** for the active company only if it has an enabled `core.company_modules` row (`_ARCHITECTURE-SPEC.md` §5). In Phase 1 that is Accounting. The shell reads the module registry (`core.modules`) and the per-company enablement to build the module axis, so turning a future module on for a company is a data change, not a code change — mirroring the data-driven philosophy of permissions.

---

## 3. Routing → repository structure

Routing follows the App Router route-group layout in `_ARCHITECTURE-SPEC.md` §3. Two route groups carry Phase 1:

- **`app/(platform)/`** — the core shell and everything tenant-cross-cutting: authentication, the company switcher, company management, memberships/roles, and admin. This group renders the persistent shell and owns the active-company context that the accounting group consumes.
- **`app/(accounting)/`** — the accounting module's routes. These render inside the shell and assume an active company resolved by the platform group.

Mapping rules:

- The **shell layout** (company switcher, module nav, identity) lives in the `(platform)` group's root layout so it wraps both groups. Accounting routes inherit it.
- **Auth screens** (sign-in, callback, accept-invite) live in `(platform)` and render *without* the company switcher (no company context yet).
- **Accounting screens** live in `(accounting)` and are only reachable when (a) the user is authenticated, (b) an active company is selected, and (c) the Accounting module is enabled for that company. Failing any of these redirects to the appropriate platform screen (sign-in, company selection, or a "module not enabled" state).
- **Future module groups** (`app/(survey)/`, `app/(claims)/`, …) will be added the same way — a new route group rendering inside the same platform shell — so the shell never needs to know about a module's internals (`_ARCHITECTURE-SPEC.md` §1).

Server components read data through the core libs (`src/core/*`) and accounting libs (`src/modules/accounting/*`) per `_ARCHITECTURE-SPEC.md` §3; the UI layer does not reach into the database directly and does not contain business rules.

---

## 4. The platform/accounting boundary in the UI

The shell enforces the loose coupling of `_ARCHITECTURE-SPEC.md` §1 at the interface level:

- The **platform layer** knows about users, companies, memberships, roles, permissions, modules, and audit. It knows *that* Accounting exists (via `core.modules`) but nothing about journals, invoices, or periods.
- The **accounting layer** consumes the active-company context and the resolved permission set, then renders its own sections and forms. It never renders platform chrome itself.
- A future module reuses the same contract: "give me the active company and the user's permissions, render inside the shell." No accounting concept leaks into the shell, and no module concept leaks into another module.

---

## 5. Role-aware UI (data-driven permissions)

### 5.1 The model the UI mirrors

Access is **data-driven** (`_ARCHITECTURE-SPEC.md` §7): the permission set comes from `core.permissions` joined through `core.role_permissions` for the active company membership's `role_id`. The UI hard-codes **no** business access rules. It asks the same question RLS asks — *does this user have permission `X` in this company?* — using the resolved permission set for the session, which corresponds to `core.has_permission(company_id, permission_key)` server-side.

Seed roles (`_ARCHITECTURE-SPEC.md` §7): Super Admin, Company Admin, Accountant / Admin User, Office User, View-only User. The UI never branches on role *name*; it branches on *permission keys* so that a customer-defined role with a custom permission mix renders correctly with no code change.

### 5.2 Three layers of UI gating (all mirrors, never sole gates)

1. **Navigation gating.** A section appears in the module nav only if the user holds at least one permission that the section requires to be useful (e.g. the Journals section needs a `journal.*` read permission). Hiding a link is a courtesy, not security.
2. **Action gating.** Within a screen, action affordances (Post, Void, Close Period, Reverse, Create, Edit, Delete, Export, Commit Import) are shown enabled only when the corresponding permission is held — e.g. *Post* requires the journal-post permission; *Reopen period* requires `period.reopen` (`accounting-engine.md` §6.1). When a permission is absent, the affordance is hidden or shown disabled with a reason, depending on whether its mere existence is informative.
3. **Route gating.** Navigating directly to a route the user cannot use (typed URL, stale link) resolves to a "not authorised" state rather than a broken screen. This is still only a UI mirror: the underlying reads/writes are independently refused by RLS and the posting functions.

### 5.3 Why the UI gate is never trusted alone

Every gated action ultimately calls a server path that re-checks permission (RLS for row reads/writes; `core.has_permission` inside `set_period_status` and the posting functions). If a client is stale, tampered with, or racing a permission change, the server rejects the action and the UI surfaces the rejection. This is the §1 rule made concrete: **UI checks mirror RLS; they never replace it.**

### 5.4 Read-only and elevated experiences

- **View-only users** see sections and records but every mutating affordance is absent. They can run and view reports they are permitted to read, but Export may be separately gated.
- **Super Admin** sees the cross-company surfaces (company creation, module enablement, all memberships) that ordinary roles do not, reflecting the RLS bypass.

---

## 6. Phase 1 routes (route table)

Routes are grouped by repository route group (§3). "Reads" and "Writes" name the canonical schema objects (`_ARCHITECTURE-SPEC.md` §5); writes that have financial effect always go through the posting functions in `accounting-engine.md` §5.

### 6.1 `app/(platform)/` — shell, auth, admin

| Route (conceptual) | Purpose | Reads | Writes |
|---|---|---|---|
| `/sign-in`, `/auth/callback` | Authenticate via Supabase Auth | `core.users` | session only |
| `/accept-invite` | Accept a company membership invitation | `core.company_memberships` (invited) | `core.company_memberships.status → active` |
| `/select-company` | Choose active company when none selected | `core.companies`, `core.company_memberships` | active-company session context |
| `/admin/companies` | List/create companies (Super Admin) | `core.companies`, `core.company_modules` | `core.companies`, `core.company_modules` |
| `/admin/companies/:id` | Company profile & module enablement | `core.companies`, `core.modules`, `core.company_modules` | `core.companies`, `core.company_modules` |
| `/admin/companies/:id/members` | Memberships & role assignment | `core.company_memberships`, `core.roles` | `core.company_memberships` |
| `/admin/roles` | Roles & permission mapping (data-driven) | `core.roles`, `core.permissions`, `core.role_permissions` | `core.roles`, `core.role_permissions` |
| `/profile` | Current user's profile | `core.users` | `core.users` |
| `/audit` | Audit log viewer (permitted roles) | `core.audit_logs` | — |

### 6.2 `app/(accounting)/` — accounting module (active company assumed)

| Route (conceptual) | Purpose | Reads | Writes |
|---|---|---|---|
| `/accounting` | Module home / overview (real data only) | derived balances via `accounting.general_ledger`; `accounting.accounting_periods` | — |
| `/accounting/setup` | Guided company-accounting setup (§7.1) | `core.companies`, `accounting.currencies`, `accounting.account_types` | `core.companies` (base currency, fiscal year), `accounting.accounts`, `accounting.accounting_periods` |
| `/accounting/accounts` | Chart of accounts (tree) | `accounting.accounts`, `accounting.account_types`, `accounting.account_tree` | `accounting.accounts` |
| `/accounting/accounts/:id` | Account detail + activity (running balance) | `accounting.general_ledger` (running balance, `accounting-engine.md` §7.2) | `accounting.accounts` |
| `/accounting/journals` | Journal list (draft/posted/void) | `accounting.journal_entries` | — |
| `/accounting/journals/new` | New manual journal entry (draft) | `accounting.accounts`, `accounting.currencies`, `accounting.accounting_periods` | `accounting.journal_entries`, `accounting.journal_lines` (draft) |
| `/accounting/journals/:id` | View/edit a journal; post; reverse | `accounting.journal_entries`, `accounting.journal_lines` | draft edits; `post_journal_entry`; `reverse_journal_entry` |
| `/accounting/customers` | Customers list | `accounting.customers` | `accounting.customers` |
| `/accounting/invoices` | Sales invoices list | `accounting.invoices` | — |
| `/accounting/invoices/new` | Create sales invoice (draft) | `accounting.customers`, `accounting.accounts`, `accounting.tax_codes` | `accounting.invoices`, `accounting.invoice_lines` (draft) |
| `/accounting/invoices/:id` | View/issue/post invoice; receive payment | `accounting.invoices`, `accounting.invoice_lines` | invoice posting (`source='invoice'`); receipt (`source='receipt'`) — `accounting-engine.md` §10.1, §10.3 |
| `/accounting/suppliers` | Suppliers list | `accounting.suppliers` | `accounting.suppliers` |
| `/accounting/bills` | Supplier bills list | `accounting.bills` | — |
| `/accounting/bills/new` | Enter supplier bill (draft) | `accounting.suppliers`, `accounting.accounts`, `accounting.tax_codes` | `accounting.bills`, `accounting.bill_lines` (draft) |
| `/accounting/bills/:id` | View/post bill; pay supplier | `accounting.bills`, `accounting.bill_lines` | bill posting (`source='bill'`); payment (`source='payment'`) — `accounting-engine.md` §10.2, §10.4 |
| `/accounting/banking` | Bank accounts list (Phase 1 foundation) | `accounting.bank_accounts`, `accounting.accounts` | `accounting.bank_accounts` |
| `/accounting/banking/:id` | Bank account detail / linked GL activity | `accounting.bank_accounts`, `accounting.general_ledger` | `accounting.bank_accounts` |
| `/accounting/periods` | Period calendar; open/close/lock | `accounting.accounting_periods` | `set_period_status` (`accounting-engine.md` §6) |
| `/accounting/taxes` | Tax codes config (no hard-coded rates) | `accounting.tax_codes`, `accounting.accounts` | `accounting.tax_codes` |
| `/accounting/reports` | Report catalogue | report definitions | — |
| `/accounting/reports/:key` | Run/view a report; export | `accounting.general_ledger`, balance queries (`accounting-engine.md` §7) | `accounting.report_exports` (on export) |
| `/accounting/imports` | Import batches list | `accounting.import_batches` | — |
| `/accounting/imports/new` | Run an import (upload→map→validate→review→commit) | `accounting.import_batches`, `accounting.import_staging_rows` | per `import-architecture.md`; commit posts via §10 patterns |
| `/accounting/settings` | Module settings (FX rounding account, defaults) | `core.companies`, `accounting.accounts` | company/module settings |

> Routes are *conceptual* paths to express IA and data flow; the exact App Router segment names are an implementation detail bound by §3's groups. Every write above is independently authorised by RLS and, where financial, funnelled through the engine functions — never by the screen alone.

---

## 7. Core accounting workflows

Each workflow below is a state-driven flow. Where a step has a financial effect, the resulting posting is referenced by its pattern in `accounting-engine.md` §10 rather than re-derived here.

### 7.1 Set up a company (base currency, fiscal year, chart of accounts)

**Goal.** Take a freshly created `core.companies` row to a state where it can post entries.

**Preconditions.** User holds company-admin / setup permission for the active company. The company exists (created in `(platform)` admin, `_ARCHITECTURE-SPEC.md` §5).

**Flow (`/accounting/setup`, guided, resumable):**

1. **Confirm base currency.** Choose `core.companies.base_currency_code` from active `accounting.currencies` (seed TTD, USD, GBP, EUR — `_ARCHITECTURE-SPEC.md` §8). Default **TTD**. *State:* until set, no posting is possible because base-currency equivalents are undefined. Once a posted entry exists, base currency is treated as locked (changing it would invalidate stored `base_*` amounts).
2. **Set fiscal year.** Choose `core.companies.fiscal_year_start_month` (default 1). This drives period generation (`accounting-engine.md` §6) and T&T statutory alignment (`_ARCHITECTURE-SPEC.md` §9).
3. **Generate the first periods.** The system creates `accounting.accounting_periods` for the current fiscal year aligned to the start month, all `open`. The setup confirms which period is current.
4. **Build the chart of accounts.** Either adopt a standard starter chart (created as real `accounting.accounts` rows the user reviews and edits — not demo data they must delete) or build it manually (§7.2). Each account is bound to an `accounting.account_types` row carrying its category and normal balance (`accounting-engine.md` §2.2).
5. **Designate control & utility accounts.** Identify the accounts that document flows reference by role: AR control, AP control, VAT collected/paid, bank, opening-balances equity, and the FX-rounding account (`accounting-engine.md` §4.3). These are stored as settings the document layer reads.
6. **(Optional) Opening balances.** If migrating, post the opening-balance entry (`source='opening_balance'`, `accounting-engine.md` §10.5) into the first open period, dated the cut-over.

**Result state.** Company has base currency, fiscal year, open periods, a chart of accounts, and the role accounts wired — it is "ready to post." The setup screen reflects completion and stops prompting.

**Postings referenced.** Opening balances → `accounting-engine.md` §10.5.

### 7.2 Create / edit the chart of accounts

**Flow (`/accounting/accounts`):**

1. View the chart as a **tree** (parent → child roll-up, `accounting.account_tree`, `accounting-engine.md` §2.3).
2. **Create an account:** code (unique per company), name, `account_type_id` (which fixes category + normal balance), optional `parent_account_id`, optional pinned `currency_code` (e.g. a USD bank account), `is_bank_account`, `is_active`, description.
3. **UI validation mirrors the engine's account rules** (`accounting-engine.md` §2.3): a child must share its parent's category; an account cannot be its own parent; parent must be the same company. These are *previewed* in the form; the database trigger is the real gate.
4. **Edit:** name, description, active flag, parentage freely while no posting constraint is violated. The UI signals that accounts with posted activity cannot be re-categorised in ways that would invert historical postings — the type/category change is restricted to preserve the integrity rule (`accounting-engine.md` §2.2).
5. **Deactivate vs delete:** accounts with posted activity are **deactivated** (`is_active=false`), never deleted, so historical GL references stay intact. Only never-used accounts may be removed.

**Validation UX.** "Post only to leaf accounts" (`accounting-engine.md` §2.3) is surfaced in journal/document forms by offering only leaf accounts as posting targets; parent accounts appear as non-selectable headers.

### 7.3 Record a manual journal entry (draft → post) with the balance indicator

This is the canonical demonstration of the posting lifecycle (`accounting-engine.md` §4).

**Flow (`/accounting/journals/new` → `/accounting/journals/:id`):**

1. **Create draft.** Enter `entry_date`, `currency_code` (defaults to base), description. The period is **resolved from the date** against `accounting.accounting_periods`; the form shows which period the entry will hit and its status. *State: `draft`* — fully mutable, no `entry_no`, no GL effect (`accounting-engine.md` §4).
2. **Add lines.** Each line: a **leaf** account, description, and an amount in either the **debit** or **credit** column (never both — mirrors the `jl_not_both_sides` / `jl_non_negative` checks, `accounting-engine.md` §3.2). For non-base currency, the line carries `fx_rate`; base equivalents are computed and shown.
3. **Live balance indicator.** A persistent indicator shows running **ΣDebit**, **ΣCredit**, and the **difference**, in both transaction and base currency. It mirrors the exact balancing rule (`accounting-engine.md` §4.1): balanced **iff** ΣDebit = ΣCredit *and* Σbase_debit = Σbase_credit. The indicator is red/"out of balance" with the signed difference until both equalities hold, then green/"balanced."
4. **Post gate.** *Post* is enabled only when: the indicator is balanced, there are ≥ 2 lines, the entry has non-zero value, the resolved period is **open**, the date falls inside the period, and the user holds the post permission. Each unmet condition is shown as the specific reason Post is blocked — these are UI mirrors of the checks in `post_journal_entry` (`accounting-engine.md` §5.2).
5. **Post.** Posting calls `accounting.post_journal_entry` (`accounting-engine.md` §5.2). The UI shows a pending state and **waits for server confirmation** (§9). On success the entry returns as *`posted`* with its gap-free `entry_no`, `posted_at`, `posted_by`, and is now immutable in the UI (edit affordances removed). On failure (e.g. period closed in a race) the server reason is surfaced and the entry stays `draft`.
6. **Correct a posted entry.** Posted entries are never edited (`accounting-engine.md` §4.2). The only correction affordance is **Reverse**, which calls `accounting.reverse_journal_entry` (`accounting-engine.md` §5.3), posts the swapped entry into an open period, and marks the original `void` with both-way links shown in the UI.

**Postings referenced.** Manual entry posts exactly the lines entered; lifecycle and reversal per `accounting-engine.md` §4–§5.

### 7.4 Create and post a sales invoice; receive a customer payment

**Create & post invoice (`/accounting/invoices/new` → `/accounting/invoices/:id`):**

1. **Draft invoice.** Select customer (`accounting.customers`; its `receivable_account_id` and `currency_code` drive the posting). Set `invoice_date`, `due_date`, currency, `fx_rate` if foreign. *State: invoice `draft`.*
2. **Add lines.** Each `invoice_lines` row: revenue/income account, description, quantity, unit price, optional `tax_code_id` (`accounting.tax_codes` — no hard-coded rate, `_ARCHITECTURE-SPEC.md` §9). The form computes `subtotal`, `tax_total`, `total`, and base equivalents live.
3. **Issue / post.** Posting allocates the gap-free `invoice_no` (at issue, not at create — `accounting-engine.md` §8.2) and posts the balanced entry `source='invoice'` per `accounting-engine.md` §10.1: **DR Accounts Receivable**, **CR Revenue**, **CR VAT Collected**. If foreign-currency rounding leaves a base cent imbalance, the document layer appends the FX-rounding line before posting (`accounting-engine.md` §4.3). *State: invoice `open`*, `journal_entry_id` linked.
4. **Result.** Invoice appears in the list as `open`; AR is increased; the entry is visible in the GL.

**Receive a customer payment (from `/accounting/invoices/:id` or a receipts action):**

1. **Record receipt.** Choose the bank account (`accounting.bank_accounts`), amount, date, and the invoice(s) it settles.
2. **Post receipt.** Posts `source='receipt'` per `accounting-engine.md` §10.3: **DR Bank**, **CR Accounts Receivable**. The AR/AP doc layer updates `invoices.amount_paid` and flips `invoices.status` to `partial` or `paid` (`accounting-engine.md` §10.3).
3. **Result state.** Invoice status reflects `partial`/`paid`; bank balance up; AR cleared by the settled amount.

**Void.** Voiding an issued invoice reverses its journal entry via `reverse_journal_entry` on the invoice's `journal_entry_id` (`accounting-engine.md` §5.3, §10), never by deleting history.

### 7.5 Enter and post a supplier bill; pay a supplier

**Enter & post bill (`/accounting/bills/new` → `/accounting/bills/:id`):**

1. **Draft bill.** Select supplier (`accounting.suppliers`; `payable_account_id`, `currency_code`). Set `bill_no` (the supplier's reference), `bill_date`, `due_date`, currency, `fx_rate`. *State: bill `draft`.*
2. **Add lines.** Each `bill_lines` row: expense/asset account, description, quantity, unit price, optional input-VAT `tax_code_id`. Totals and base equivalents computed live.
3. **Post.** Posts the balanced entry `source='bill'` per `accounting-engine.md` §10.2: **DR Expense/Asset**, **DR VAT Input/Paid**, **CR Accounts Payable**. *State: bill `open`*, `journal_entry_id` linked, AP increased.

**Pay a supplier:**

1. **Record payment.** Choose bank account, amount, date, and bill(s) settled.
2. **Post payment.** Posts `source='payment'` per `accounting-engine.md` §10.4: **DR Accounts Payable**, **CR Bank**. The doc layer updates `bills.amount_paid` and status.
3. **Result state.** Bill `partial`/`paid`; AP reduced; bank reduced.

**Void.** Same reversing-entry discipline as invoices (`accounting-engine.md` §5.3).

### 7.6 Bank account setup (Phase 1 foundation)

Phase 1 establishes bank accounts as first-class records; bank-statement reconciliation is a later phase.

**Flow (`/accounting/banking`):**

1. **Create bank account** (`accounting.bank_accounts`): name, bank name, account number, `currency_code`, and the **linked GL account** (`account_id`) — an `accounting.accounts` row with `is_bank_account=true` (`_ARCHITECTURE-SPEC.md` §5; `accounting-engine.md` §2.3). The UI offers only bank-type leaf accounts for the link, or offers to create one.
2. **Currency consistency.** The bank account's `currency_code` should match its linked GL account's pinned currency where set; the form flags mismatches.
3. **Result.** The bank account becomes selectable in receipt and payment flows (§7.4, §7.5) and its activity is viewable via the linked GL account's running balance (`accounting-engine.md` §7.2).

**Foundation only.** No statement import or reconciliation matching in Phase 1; the data model and screen are laid so those slot in later without rework.

### 7.7 Open / close / lock an accounting period

Period state directly governs whether posting is allowed (`accounting-engine.md` §6).

**Flow (`/accounting/periods`):**

1. **View the period calendar** for a fiscal year: each `accounting.accounting_periods` row with its `status` (`open` / `closed` / `locked`), date range, and name.
2. **Close a period.** *Close* (open → closed) calls `set_period_status` (`accounting-engine.md` §6). After close, routine posting into it is blocked. The UI warns about any remaining `draft` entries dated in the period (they will be unpostable until reopened).
3. **Reopen a period.** *Reopen* (closed → open) is shown only to users holding `period.reopen` (`accounting-engine.md` §6.1); the UI gate mirrors the permission check inside `set_period_status`. Used for late adjustments, then re-closed.
4. **Lock a period.** *Lock* (closed → locked) is **permanent** — the UI presents it as irreversible and confirms deliberately. After lock there is **no path back to open** (`accounting-engine.md` §6.1); no posting or reversal can target it.
5. **State machine shown to the user:** `open ⇄ closed → locked` (reopen only from closed; lock is terminal), exactly the lifecycle in `accounting-engine.md` §6.1.

**Posting interaction.** Every posting form (§7.3–§7.5) resolves its period from the entry date and refuses to enable Post when that period is not `open` — a UI mirror of the period gate in `post_journal_entry` (`accounting-engine.md` §6.2). A period closed during editing surfaces on the next post attempt as a server rejection.

### 7.8 Run a report and export it

Reports exist only because the ledger exists (`_ARCHITECTURE-SPEC.md` §10: "no reports before the ledger exists"). Every report derives from posted journal lines (`accounting-engine.md` §7).

**Flow (`/accounting/reports` → `/accounting/reports/:key`):**

1. **Choose a report** from the catalogue (Phase 1: Trial Balance, General Ledger / account activity, Balance Sheet, Income Statement, AR/AP aging as the doc layer supports).
2. **Set parameters.** Period or date range, account filters, currency view (base by default). Parameters captured as the `params` of any export.
3. **Run.** The report queries the derived GL and balance queries (`accounting-engine.md` §7.3, §7.4). RLS on the base tables flows through the views, so a user only sees their companies' data (`accounting-engine.md` §7.1). The Trial Balance shows its proof-of-balance invariant (ΣDebit = ΣCredit, `accounting-engine.md` §7.4).
4. **Export.** *Export* (gated by permission) records an `accounting.report_exports` row (`report_key`, `params`, `format`, `file_path`, `generated_by`) and produces the file. The export captures the parameters so the output is reproducible and auditable.

**Empty / no-data.** If no posted entries fall in range, the report renders a true empty result (zeros / "no postings in this period"), never fabricated figures.

### 7.9 Run an import (upload → map → validate → review → commit)

Imports are **always staged and validated** before they touch the ledger (`_ARCHITECTURE-SPEC.md` §10). This section gives the UI flow; `import-architecture.md` is authoritative on staging, mapping, and validation internals.

**Flow (`/accounting/imports/new`), five explicit stages, each its own UI step and resumable from the batch:**

1. **Upload.** Choose `import_type` and `source_system`, upload the file. Creates `accounting.import_batches` (`status='uploaded'`, `file_path`, `row_count`). Raw rows are staged into `accounting.import_staging_rows` (`raw` jsonb).
2. **Map.** Map source columns to target fields. The mapping is stored on staging rows (`mapped` jsonb). The UI shows a sample of mapped rows so the user can confirm the mapping before validating.
3. **Validate.** Run validation (`status='validating' → 'validated'` or `'failed'`). Per-row `errors` are written to staging rows; the batch's `error_count` is set. The UI lists errors grouped by type with row references. Nothing is posted yet.
4. **Review.** The user reviews validated rows and errors. They may go back to **Map** to fix a systematic mapping problem, fix source data and re-upload, or proceed with the clean rows per the policy `import-architecture.md` defines (e.g. all-or-nothing vs. commit-valid-only).
5. **Commit.** *Commit* (gated by permission; enabled only from `validated`) writes the real records and posts the resulting balanced journal entries via the same engine patterns as manual document entry (`accounting-engine.md` §10), using the idempotency guarantee `unique (company_id, source, source_id)` so a replayed commit cannot double-post (`accounting-engine.md` §9). Batch moves to `status='committed'`.

**States the UI reflects:** `uploaded → validating → validated → committed`, with `failed` as a terminal-until-fixed branch — exactly the `import_batches.status` enum (`_ARCHITECTURE-SPEC.md` §5). Commit is irreversible at the batch level; corrections after commit follow normal reversing-entry rules (`accounting-engine.md` §5.3).

**Cross-reference.** Mapping engine, validation rules, source-system adapters, and error taxonomy: `import-architecture.md`.

---

## 8. Form & validation UX principles

These apply to every form above.

- **Balanced-entry enforcement in the UI.** Any double-entry form (manual journal; and implicitly the document forms whose postings must balance) shows the live debit/credit/difference indicator in **both** currencies and disables the committing action until both equalities hold (`accounting-engine.md` §4.1). This is a usability mirror; the `post_journal_entry` balance gate is the real enforcement (`accounting-engine.md` §5.2).
- **One side per line.** Amount entry offers debit *or* credit, never both, and rejects negatives at input — mirroring `jl_not_both_sides` / `jl_non_negative` (`accounting-engine.md` §3.2).
- **Post only to leaves.** Account pickers offer only active leaf accounts; parents render as non-selectable group headers (`accounting-engine.md` §2.3).
- **Preventing posting to closed periods.** Every dated, postable form resolves and displays the target period and its status, and disables Post when the period is not `open`, stating the reason. Because the period can change underneath the user, the UI treats the server's period rejection as authoritative and surfaces it cleanly (`accounting-engine.md` §6.2).
- **Currency selection.** Forms default to the company base currency. Choosing a non-base currency reveals `fx_rate` and shows the computed base equivalents per line, captured at transaction time and never re-derived (`_ARCHITECTURE-SPEC.md` §8; `accounting-engine.md` §3.2). Where a foreign-currency document's base amounts round to a cent imbalance, the user is told an FX-rounding line will be added on post (`accounting-engine.md` §4.3).
- **Optimistic vs server-confirmed states.** Two distinct interaction modes:
  - *Optimistic (drafts).* Editing draft headers/lines, mapping imports, building a chart — the UI updates immediately and reconciles in the background; conflicts roll back visibly.
  - *Server-confirmed (irreversible/financial).* **Post**, **Reverse**, **Close/Lock period**, **Commit import**, **Void** are never shown as done until the server confirms. The UI shows a pending state, awaits the function result, and reflects exactly what the server returned (including the assigned `entry_no`/document number). A failure leaves the prior state intact and shows the server's reason. This division keeps editing fast while making every irreversible act trustworthy.
- **Errors are reasons, not codes.** Validation messages name the specific rule (out of balance by X; period FY2026 P06 is closed; account is not a leaf; you lack permission to post). They map one-to-one onto the engine's rejection messages so UI and server tell the same story.

---

## 9. State, latency, and confirmation

- **Draft work is local-first and forgiving.** Drafts have no GL effect (`accounting-engine.md` §4), so autosave and optimistic edits are safe.
- **Irreversible transitions wait for the server.** Posting, reversing, period close/lock, and import commit go through `security definer` functions (`accounting-engine.md` §5, §6) that are the sole source of truth for success. The UI never pre-declares these complete.
- **Idempotency makes retries safe.** Because document posting is idempotent on `(company_id, source, source_id)` (`accounting-engine.md` §9), a double-click or reconnect-retry on Post/Commit cannot duplicate an entry; the UI can safely retry a timed-out post and reconcile to the single resulting entry.
- **Concurrency surfaces honestly.** If a period is closed, or a permission is revoked, between render and action, the server rejects and the UI returns the user to a correct state with the reason — never a silent success.

---

## 10. Empty states (real, not demo)

A brand-new company has genuinely no accounting data. Every empty state is real and points to the action that creates the first real record (`_ARCHITECTURE-SPEC.md` §10: no demo data, no fake dashboards).

### 10.1 No company access
User with no `active` membership: a "no company access" screen explaining they must be invited/added, with no module navigation. (Distinct from "company has no data.")

### 10.2 New company, before setup
`/accounting` for a company with no base currency / periods / accounts: a setup prompt routing to `/accounting/setup` (§7.1). No dashboard tiles render — there is nothing to total. The overview states "Set up this company to begin," not fake figures.

### 10.3 Empty chart of accounts
`/accounting/accounts` with no accounts: offer "create your first account" and/or "adopt a starter chart" (real rows the user keeps/edits, §7.2).

### 10.4 No journals / invoices / bills / bank accounts / periods
Each list screen with zero rows shows a plain "nothing here yet" with the create affordance the user is permitted to use. No example rows, no placeholder amounts.

### 10.5 Reports with no postings
A report run before any posting renders a true empty/zeroed result with "no postings in this period," never invented numbers (`_ARCHITECTURE-SPEC.md` §10: no reports/dashboards before real data).

### 10.6 No imports
`/accounting/imports` with no batches: "start an import" routing to the staged flow (§7.9).

---

## 11. Accessibility, responsive & PWA (high level)

- **Accessibility.** Keyboard-operable throughout (the journal grid especially — tab order across account → debit → credit → next line); programmatic labels on every field; the balance indicator and validation reasons exposed to assistive technology as live status, not colour alone (out-of-balance is conveyed by text + sign, not just red). Account pickers and the company switcher are navigable and announce the active selection. Targets meet contrast and focus-visibility norms.
- **Responsive.** The shell collapses the module/section navigation on small screens while keeping the company switcher and active context reachable. Data-dense screens (journal grid, trial balance, GL) prioritise horizontal scannability and allow horizontal scroll rather than truncating financial figures; entry forms reflow to single-column without losing the running balance indicator.
- **PWA / offline.** Per `_ARCHITECTURE-SPEC.md` §2 and §10, Phase 1 is **view-first offline**: previously loaded company data and reports may be viewable offline, but **no offline editing or posting** is permitted until sync rules are defined. The UI clearly indicates offline/stale state and disables all mutating affordances (Post, Commit, Close, Create) while offline, since those require the server-confirmed path (§9). Installability and a responsive shell are in scope; offline write is explicitly out of scope.

---

## Open Questions

- **Active-company encoding.** Should the active `company_id` live in the route path (shareable deep links per company) or purely in session state? Affects link sharing and the §3 group layout.
- **Section-to-permission map.** The precise mapping of each accounting section/action to permission keys in `core.permissions` needs to be fixed jointly with the RBAC seed (`_ARCHITECTURE-SPEC.md` §7) so navigation gating (§5.2) is exact.
- **Starter chart of accounts.** Is there a canonical T&T starter chart we offer at setup (§7.1, §10.3), and is it a seed template or generated? Coordinate with `_ARCHITECTURE-SPEC.md` §9 and the accounting seed data.
- **Receipts/payments as first-class screens.** Should customer receipts and supplier payments have their own list routes, or remain actions on invoices/bills? (§7.4–§7.5.)
- **Import commit policy in the UI.** All-or-nothing vs. commit-valid-only at the Review→Commit step (§7.9) — to be settled in `import-architecture.md` and reflected in the review screen.
- **Module placeholder behaviour.** Do disabled future-module entries link to a "coming soon" page or remain fully inert? (§2.2.)

## Decisions Locked

- **The shell is owned by `app/(platform)/` and wraps every module**; accounting screens live in `app/(accounting)/` and assume an active company resolved by the platform layer (§3, §4) — conforming to `_ARCHITECTURE-SPEC.md` §3.
- **Active-company context is always present, always switchable, never assumed**; role and permissions re-resolve per active company (§2.3) — no single-company assumption (`_ARCHITECTURE-SPEC.md` §10).
- **All UI gating is data-driven and mirrors RLS; it is never the sole gate** (§1, §5). The UI branches on permission keys, never role names.
- **Drafts are optimistic; Post / Reverse / Close / Lock / Commit / Void are server-confirmed** through the engine's `security definer` functions and reflect exactly what the server returns (§8, §9) — per `accounting-engine.md` §5–§6.
- **The journal-entry form's live balance indicator mirrors the dual-currency balancing rule** and gates Post; the engine's `post_journal_entry` is the real enforcement (§7.3, §8) — per `accounting-engine.md` §4.1, §5.2.
- **Posting into closed/locked periods is blocked in the UI as a mirror** of the period gate; the period state machine shown is `open ⇄ closed → locked` (§7.7) — per `accounting-engine.md` §6.
- **Every empty state is real**; no demo data, no fake dashboards, no reports before postings exist (§10) — per `_ARCHITECTURE-SPEC.md` §10.
- **Imports always flow upload → map → validate → review → commit**, staged and validated before any posting (§7.9) — per `_ARCHITECTURE-SPEC.md` §10 and `import-architecture.md`.
- **Phase 1 PWA is view-first offline with no offline editing/posting** (§11) — per `_ARCHITECTURE-SPEC.md` §2, §10.

---

*Cross-references:* `_ARCHITECTURE-SPEC.md` (authoritative cross-cutting spec — repo structure §3, schema §5, invariants §6, RBAC §7, currency §8, T&T §9, non-negotiables §10); `accounting-engine.md` (journal model, posting lifecycle, period control, derived GL, source-document postings §10, numbering, concurrency); `import-architecture.md` (staging, mapping, validation, and commit internals for §7.9).
