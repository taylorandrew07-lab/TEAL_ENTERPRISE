# TEAL Enterprise — Handoff

**Date:** 2026-06-17
**Status:** ⏸ Paused — foundation authored; blocked on Supabase provisioning pending internal approvals.

> The build is parked at a clean, self-consistent checkpoint. Nothing is half-written. The next
> step (running the database foundation) requires a Supabase project, which is on hold until
> budget/approvals are granted. No paid resources are required to read, review, or extend the
> documentation and code authored so far.

> **Audit-remediation milestone (2026-06-20):** a multi-agent code audit (`docs/audits/code-audit-2026-06-20.md`)
> raised 26 confirmed findings — **all now fixed** (tsc 0 / vitest 42 / next build 0). Key expansion-safety
> win: a single-source RBAC catalogue (`src/core/rbac/catalog.ts`) + a **parity test** that fails CI if the
> manifests, DB seed, and typed constants ever drift (prevents silent permission lock-outs as modules are
> added). Plus DB-integrity hardening (server-side base-currency recompute via `accounting.fx_rate()`,
> composite journal-line FKs, period-overlap exclusion, reversal idempotency), RLS/disclosure fixes
> (`core.user_directory` hides super-admin status; platform FX visibility; user-private dashboards/exports),
> performance (wrapped permission checks, role_id + FK indexes, fewer/parallel session round-trips), and a
> latent schema-collision fix (Cargo Monitoring → its own `cargo_monitoring` schema). SQL is authored but
> unexecuted (Supabase pending); a foreign-currency posting check was added to the engine test.

---

## 1. Where we are

- **Cycle 0 — Architecture pack: COMPLETE.** 12 documents + authoritative spec in [`docs/`](docs/).
- **Cycle 1 — Project skeleton + database foundation: AUTHORED, NOT YET EXECUTED.**
  Migrations, seed, and a correctness test are written and manually reviewed but have **not** been
  run against a live database (this environment has no Docker/psql; a hosted Supabase project is
  the chosen path but is awaiting approval).

## 2. Why we paused

The database foundation can only be verified by running it against a real Postgres. The chosen path
is a **hosted Supabase project**, which incurs cost and therefore needs approval before provisioning.
Until then we deliberately do **not** stack later code (auth, app shell, onboarding) on an unverified
schema — foundation-first discipline requires proving the ledger invariants on a live DB first.

## 3. What is done (authored & reviewed)

| Area | Files |
| --- | --- |
| Architecture pack (12 docs + spec) | `docs/*.md`, `docs/_ARCHITECTURE-SPEC.md` |
| Project skeleton | `package.json`, `tsconfig.json`, `next.config.mjs`, `.env.example`, `.gitignore` |
| App shell (minimal, no fake data) | `app/layout.tsx`, `app/page.tsx`, `app/globals.css` |
| Supabase client libs | `src/lib/supabase/{client,server,admin}.ts` |
| RBAC constants (mirror of seed) | `src/core/rbac/permissions.ts` |
| Core schema migration | `supabase/migrations/0001_core_schema.sql` |
| Accounting schema + GL view | `supabase/migrations/0002_accounting_schema.sql` |
| RLS helpers, policies, grants | `supabase/migrations/0003_rls_and_helpers.sql` |
| Posting / immutability / numbering / audit | `supabase/migrations/0004_functions_posting.sql` |
| Reference seed (no demo data) | `supabase/seed/seed.sql` |
| Accounting correctness test | `supabase/tests/accounting_engine_test.sql` |
| Supabase local config | `supabase/config.toml` |
| **Platform module framework** (doc) | `docs/platform-module-framework.md` |
| **Module framework code** (pure TS, no DB) | `src/core/modules/{types,registry,index}.ts`, `src/core/modules/manifests/{accounting,cargo-assurance}.ts` |
| **Cargo Assurance architecture pack** (8 docs) | `docs/cargo-assurance/*.md` |
| Cargo schema migration (31 tables, 25 enums) | `supabase/migrations/0005_cargo_schema.sql` |
| Cargo RLS + client-portal access | `supabase/migrations/0006_cargo_rls.sql` |
| Cargo module + permissions + roles (seed) | `supabase/seed/seed.sql` (appended) |
| Cargo permission/role constants (TS mirror) | `src/core/rbac/permissions.ts` |
| **Platform app shell (BUILT & VERIFIED)** | `src/core/session/*`, `src/core/ui/*`, `app/layout.tsx`, `app/page.tsx`, `app/accounting/*`, `app/cargo-assurance/*` |
| **Cargo calculation engine (BUILT & UNIT-TESTED)** | `src/modules/cargo-assurance/{numeric,units,measurement,tanks,comparison,aggregation,hire,rules-engine}.ts` + `__tests__/engine.test.ts` (23 tests) |

> **Build-verified milestone (2026-06-17):** `npm install` + `npx tsc --noEmit` + `npx next build`
> all pass (exit 0). The registry-driven platform shell — module launcher, per-module navigation,
> company switcher, permission gating, and honest connection-state banners — compiles and renders
> `/`, `/accounting`, `/cargo-assurance`. It degrades gracefully to an "unconfigured" state with no
> Supabase, so it runs today; it wires to real auth/company/permission data the moment the DB is up.
>
> **Calculation-engine milestone (2026-06-17):** the Cargo Assurance calculation engine is implemented
> in pure TypeScript and **unit-tested with `npm test` (23/23 passing, `tsc` clean)** — entirely
> without Supabase. Covers unit conversions (never assuming an unsupported temp/density), meter /
> shore-tank / mass-balance, the three result layers, non-receiving-tank logic (the spec's 17.0→16.6
> example: raw −0.4, corrected 0.0, procedural −0.4), day-tank consumption classification, the
> comparison engine sign convention, period aggregation that never sums percentages, hire-period ROB
> reconciliation (no inferred loss on incomplete evidence), and a SAFE versioned rules engine
> (declarative rule trees, whitelisted operators, no `eval`). This de-risks the hardest domain logic
> before it is wired to the database.

## 4. What is NOT done / unverified

- Migrations have **never been executed**; the schema is unproven at runtime.
- Seed has not been applied; the correctness test (`supabase/tests/accounting_engine_test.sql`) has
  not been run, so the double-entry invariants are asserted in design but not yet demonstrated.
- The **company-switcher shell, module launcher, and per-module navigation are built and
  build-verified** (above). Still pending: the actual **Supabase Auth sign-in flow** and
  first-company **onboarding**, and the in-module screens (chart of accounts, reviews, etc.).
- The shell's data layer (`getPlatformContext`) issues real `core` queries but has only been
  exercised in the **unconfigured** path; the authenticated path is unverified until a live DB
  exists.
- `npm install` HAS now been run (a `package-lock.json` is present) and `next build` passes; the
  migrations/seed remain unexecuted (no DB).

## 5. How to resume (when Supabase is approved)

Chosen path: **hosted Supabase project**. From the project root:

```bash
# 1. Create a project at https://supabase.com (note project-ref; set a DB password)
supabase login
supabase link --project-ref <your-project-ref>

# 2. Apply migrations
supabase db push

# 3. Apply seed: Dashboard → SQL Editor → paste & run supabase/seed/seed.sql

# 4. Run correctness checks: SQL Editor → paste & run supabase/tests/accounting_engine_test.sql
#    Expect TEST1..TEST6 PASSED + "ALL ACCOUNTING ENGINE CHECKS PASSED".

# 5. App env: copy .env.example -> .env.local, fill Project URL + anon key + service_role key
npm install
npm run db:types      # generate src/lib/database.types.ts from the live schema
npm run dev           # http://localhost:3000
```

Alternative (no cost, needs Docker Desktop): `supabase start` then `supabase db reset` runs
migrations **and** seed locally (seed path is wired in `supabase/config.toml`), then run the test
against the local DB.

### First live-run watch-items (things most likely to need a fix on first execution)
- `security_invoker` on the `accounting.general_ledger` view requires Postgres 15+ (Supabase is 15).
- The `authenticated` role grants assume Supabase's standard roles exist (they do on Supabase).
- The posting functions check `core.has_permission(...)`, which needs a JWT `sub`; the test script
  sets `request.jwt.claims` to a seeded super-admin user so the checks pass.
- Migration version ordering uses `0001..0004` prefixes; if the CLI insists on timestamp versions,
  rename the files to `YYYYMMDDHHMMSS_*.sql` (content unchanged).

## 6. Next cycle (Cycle 2 — after the foundation is verified)

Apply + verify migrations → generate types → Supabase Auth sign-in + `auth.users`→`core.users`
sync → company-switcher app shell + permission-aware nav → first-company onboarding (periods +
chart of accounts) → RLS cross-company isolation test suite. Detail in
[`docs/master-roadmap.md`](docs/master-roadmap.md) §6.

## 7. Decisions pending (business, not assumable)

- **Supabase provisioning** — blocked on approval/budget. (Hosted project chosen once approved.)
- Which Taylor-group legal entities become the first real companies (and each one's base currency
  and fiscal-year start; default TTD / January).
- Which AccountEdge Pro / MYOB export files to target first for the import framework.
- Whether to offer a standard Trinidad & Tobago chart-of-accounts template to new companies.

## 8. Can be done now WITHOUT Supabase (if you want to keep moving)

- Build the Cycle 2 auth flow + company-switcher app shell as code (can't be runtime-verified, but
  can be written and reviewed).
- Author the chart-of-accounts template and import column-mapping templates as data files.
- `npm install` + `npm run typecheck` to lock dependencies and catch type errors (no DB needed).
- Initialize git (`git init`) for version control.
