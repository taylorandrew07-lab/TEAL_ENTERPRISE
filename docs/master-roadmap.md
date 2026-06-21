# Master Roadmap

**TEAL Enterprise — Accounting Module**
**Owning agent:** Orchestrator Agent
**Status:** Draft v1 — 2026-06-17 · ⏸ **PAUSED** — Supabase provisioning on hold pending internal approvals (see [HANDOFF.md](../HANDOFF.md))

> Purpose: This is the living build plan for TEAL Enterprise, starting with the Accounting module.
> It sequences foundation-first work, tracks what is done vs pending, and defines the autonomous
> cycle the build follows. It is the index the Orchestrator consults at the start of every cycle.
> Authoritative cross-cutting decisions live in [_ARCHITECTURE-SPEC.md](_ARCHITECTURE-SPEC.md).

---

## 1. Guiding order of construction

The build proceeds **foundation-first**, never UI-first:

```
Documentation  →  Database (schema + RLS + functions)  →  Core platform shell
   →  Accounting engine (journals/posting)  →  Source documents (AR/AP/banking)
   →  Reporting on real data  →  Import  →  Dashboards  →  Offline view  →  Hardening
```

A feature is only "done" when it is documented, migrated, secured (RLS), and validated for
accounting correctness per [testing-strategy.md](testing-strategy.md).

---

## 2. Architecture pack — Cycle 0 (COMPLETE — 2026-06-17)

The first deliverable, the architecture pack, is complete:

| Document | Owning agent | Status |
| --- | --- | --- |
| [_ARCHITECTURE-SPEC.md](_ARCHITECTURE-SPEC.md) | Orchestrator | ✅ Done |
| [teal-enterprise-platform-vision.md](teal-enterprise-platform-vision.md) | Orchestrator | ✅ Done |
| [accountedge-myob-audit.md](accountedge-myob-audit.md) | Audit Agent | ✅ Done |
| [trinidad-accounting-requirements.md](trinidad-accounting-requirements.md) | T&T Agent | ✅ Done |
| [accounting-engine.md](accounting-engine.md) | Accounting Engine Agent | ✅ Done |
| [security-and-permissions.md](security-and-permissions.md) | Security Agent | ✅ Done |
| [multi-currency-architecture.md](multi-currency-architecture.md) | Multi-Currency Agent | ✅ Done |
| [import-architecture.md](import-architecture.md) | Import / Migration Agent | ✅ Done |
| [offline-architecture.md](offline-architecture.md) | Offline / Sync Agent | ✅ Done |
| [reporting-and-dashboards.md](reporting-and-dashboards.md) | Dashboard / Reporting Agent | ✅ Done |
| [ui-workflows.md](ui-workflows.md) | UI / Workflow Agent | ✅ Done |
| [testing-strategy.md](testing-strategy.md) | QA / Validation Agent | ✅ Done |
| [platform-module-framework.md](platform-module-framework.md) | Orchestrator | ✅ Done |

---

## 2a. Platform Module Framework (COMPLETE — 2026-06-17)

TEAL Enterprise is now formally defined as **a platform of modules**: one shared core, one Postgres
schema + one code folder per module, declarative **module manifests** consumed by the core, and a
repeatable **"add a module" playbook**. This is the infrastructure that lets many apps (Accounting,
Cargo Assurance, and future modules) plug in cleanly. See
[platform-module-framework.md](platform-module-framework.md).

Implemented (no Supabase required — pure TypeScript + SQL authored):
- `src/core/modules/types.ts` — the `ModuleManifest` contract (navigation, permissions, settings).
- `src/core/modules/registry.ts` — registry: launcher, per-module nav, route gating, permission parity.
- `src/core/modules/manifests/accounting.ts`, `…/cargo-assurance.ts` — the two live module manifests.
- Module registry + permissions wired data-driven in `supabase/seed/seed.sql`.

**Platform app shell — BUILT & BUILD-VERIFIED (2026-06-17).** The registry now drives a real UI:
`src/core/session/*` (typed platform context: user, active company, permissions, enabled modules,
with honest unconfigured/unauthenticated/no-company states), `src/core/ui/*` (`AppShell`,
`CompanySwitcher`, `ModuleLauncher`, reusable `ModuleShell`, `ModuleEmptyState`), and routes
`app/layout.tsx`, `app/page.tsx` (launcher), `app/accounting/*`, `app/cargo-assurance/*`.
`npm install` + `tsc --noEmit` + `next build` all pass (exit 0); `/`, `/accounting`,
`/cargo-assurance` render. Adding a module to the registry makes it appear in the launcher and gain a
navigated shell automatically — the framework is proven end-to-end in code, not just docs.

## 2b. Cargo Assurance — module #2 (foundation AUTHORED — 2026-06-17)

The second module proves the framework. Architecture pack in [cargo-assurance/](cargo-assurance/):
`_CARGO-SPEC.md`, `cargo-data-model.md`, `cargo-ingestion-and-extraction.md`,
`cargo-calculation-engine.md`, `cargo-aggregation-and-analytics.md`,
`cargo-dashboards-and-reporting.md`, `cargo-security-and-multitenancy.md`,
`cargo-assurance-roadmap.md`. Schema authored as `supabase/migrations/0005_cargo_schema.sql`
(31 tables, 25 enums, `cargo` schema, no cross-module FKs) and `0006_cargo_rls.sql` (RLS on every
table via the core helpers + additive read-only **client-portal** access). Phased build plan in
[cargo-assurance/cargo-assurance-roadmap.md](cargo-assurance/cargo-assurance-roadmap.md).

---

## 2b. Database & skeleton — Cycle 1 (AUTHORED — 2026-06-17)

Project skeleton and the database foundation are authored (migrations + seed + correctness test).
**Not yet executed against a live database in the build environment (no Docker available);** first
run is via local Docker Supabase or a hosted project — see README and §7.

| Artifact | Status |
| --- | --- |
| Next.js + TypeScript skeleton, Supabase clients, app shell | ✅ Authored |
| `supabase/migrations/0001_core_schema.sql` (core schema) | ✅ Authored |
| `supabase/migrations/0002_accounting_schema.sql` (accounting schema + GL view) | ✅ Authored |
| `supabase/migrations/0003_rls_and_helpers.sql` (RLS, helpers, grants) | ✅ Authored |
| `supabase/migrations/0004_functions_posting.sql` (posting, immutability, numbering, audit) | ✅ Authored |
| `supabase/seed/seed.sql` (currencies, account types, permissions, roles, modules) | ✅ Authored |
| `supabase/tests/accounting_engine_test.sql` (correctness checks) | ✅ Authored |
| Execute migrations + run correctness test against a real DB | ⏳ Pending DB access |

---

## 3. Phase 1 build target & checklist

Phase 1 is complete only when every item below is implemented, migrated, RLS-secured, and tested.

### 3.1 Platform core
- [ ] Next.js (App Router) + TypeScript project scaffold; Supabase client wiring; Vercel config.
- [ ] Supabase project + local dev (supabase CLI) + migration pipeline.
- [ ] `core` schema: companies, users, roles, permissions, role_permissions, company_memberships,
      clients, documents, audit_logs, modules, company_modules.
- [ ] Supabase Auth integration; `auth.users` → `core.users` sync.
- [ ] User ↔ company memberships with per-company role.
- [ ] Data-driven RBAC; seed roles (Super Admin, Company Admin, Accountant/Admin User, Office User,
      View-only) + seed permission catalogue.
- [ ] RLS on every table; `core.user_companies()` + `core.has_permission()` helpers; Super Admin bypass.
- [ ] Audit logging triggers.
- [ ] App shell: auth, company switcher, module nav.

### 3.2 Accounting engine
- [ ] `accounting` schema migrations for all canonical tables.
- [ ] Currencies + exchange_rates tables (seed TTD, USD, GBP, EUR).
- [ ] Account types (seed) + chart of accounts (per-company).
- [ ] Journal entries + journal lines with CHECK constraints.
- [ ] `post_journal_entry()` / `reverse_journal_entry()` functions; balance enforcement in txn + base ccy.
- [ ] Accounting periods + open/closed/locked enforcement.
- [ ] `accounting.general_ledger` view + trial-balance query.
- [ ] Per-company numbering for entry_no / document numbers.

### 3.3 Subledgers & banking foundation
- [ ] Customers + Suppliers (with control accounts).
- [ ] Bank accounts (GL-linked) foundation.
- [ ] Invoice + invoice_lines foundation (posting a balanced JE).
- [ ] Bill + bill_lines foundation (posting a balanced JE).
- [ ] Tax codes (configurable; no hard-coded rates).

### 3.4 Cross-cutting foundations
- [ ] Import staging framework (import_batches + import_staging_rows; nothing live until committed).
- [ ] Basic report export framework (report_exports → Storage); Trial Balance, P&L, Balance Sheet.
- [ ] Dashboard configuration tables (dashboard_configs).
- [ ] Offline VIEW foundation (PWA shell + read-only cache; no offline editing).
- [ ] Documentation kept current for all of the above.

---

## 4. Phased roadmap beyond Phase 1

| Phase | Theme | Highlights |
| --- | --- | --- |
| **P1** | Foundation | Core platform + accounting engine + AR/AP/banking foundations + import staging + base reports (above). |
| **P2** | Operational AR/AP | Full invoicing/billing lifecycle, payments/receipts allocation, credit notes, recurring transactions, bank reconciliation, AR/AP aging, VAT report. |
| **P3** | Multi-currency depth & close | FX revaluation runs, period close workflow, opening-balance migration tooling, comparatives. |
| **P4** | Items/Jobs & richer reporting | Items, jobs/projects (cost tracking), quotes/orders, configurable dashboards, report builder. |
| **P5** | Offline drafts & sync | Outbox-based offline draft capture with server-authoritative posting; conflict rules. |
| **P6** | Payroll & statutory (T&T) | PAYE, NIS, Health Surcharge, payroll postings & statutory reports (configurable). |
| **P7** | Platform modules | Survey, Claims, Cargo, Ship Agency, etc. integrating via core — accounting stays loosely coupled. |

---

## 5. Autonomous build cycle

Each cycle the Orchestrator:

1. Reviews the long-term vision ([teal-enterprise-platform-vision.md](teal-enterprise-platform-vision.md)).
2. Reviews the current codebase + this roadmap.
3. Identifies the highest-priority missing **foundation** (top of the checklist, dependencies first).
4. Selects the correct specialist agent(s).
5. Produces/updates documentation for the change.
6. Implements the code or migration.
7. Validates security (RLS) and accounting correctness ([testing-strategy.md](testing-strategy.md)).
8. Updates this roadmap (check items off; note decisions).
9. Proceeds to the next highest-priority task.

Business decisions are assumed using the spec defaults unless genuinely ambiguous.

---

## 6. Next cycle (Cycle 2)

**Target:** Execute the foundation and stand up authentication + the company-scoped app shell.

1. Apply migrations + seed against a real database (local Docker Supabase or a hosted project) and
   run `supabase/tests/accounting_engine_test.sql`; fix anything the live run surfaces.
2. Generate TypeScript types (`npm run db:types`).
3. Supabase Auth flow: sign-in, `auth.users` → `core.users` profile sync (trigger or callback),
   and session handling middleware.
4. App shell: the `(platform)` layout, company switcher (active-company context), permission-aware
   navigation, and protected routes.
5. First real company onboarding flow: create a company, seed its accounting periods, and let an
   admin build/import its chart of accounts.
6. Add the RLS isolation test suite (cross-company read/write denial) per testing-strategy.md.

> Cycle 2 requires either Docker locally or hosted Supabase credentials — see Open Questions.

---

## 7. Open Questions

- **Supabase environment:** RESOLVED — hosted Supabase project chosen. **BLOCKED**: provisioning is
  on hold until internal approvals/budget are granted; no paid resource will be created before then.
  Resume steps are in [HANDOFF.md](../HANDOFF.md) §5.
- **First real companies:** Which Taylor-group legal entities seed the first production companies,
  and what is each one's base currency and fiscal-year start? (Default: TTD, January.)
- **Migration sources:** Which AccountEdge Pro / MYOB export files are available for the import
  framework to target first (chart of accounts, trial balance, customers/suppliers)?
- **Chart-of-accounts template:** Should a standard T&T chart-of-accounts template be offered to new
  companies, and who validates it with an accountant?

## 8. Decisions Locked

- Architecture pack (Cycle 0) is complete and authoritative; build proceeds foundation-first.
- Two Postgres schemas now (`core`, `accounting`); future modules get their own schemas.
- Double-entry, RLS, data-driven permissions, configurable tax, and staged imports are
  non-negotiable and apply from the first migration.
- Cycle 1 is the database + project-skeleton foundation, per §6.
