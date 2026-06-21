# TEAL Enterprise

Modular business operating platform for the Taylor group of companies (maritime, logistics,
surveying, claims, ship agency, freight forwarding, accounting) in Trinidad & Tobago. The first
module is **Accounting** — a production-grade, double-entry accounting system built foundation-first.

This is not a demo or prototype. See [`docs/`](docs/) for the full architecture pack and
[`docs/master-roadmap.md`](docs/master-roadmap.md) for build status.

## Stack

Next.js (App Router) · React · TypeScript · Supabase (Postgres, Auth, Storage, RLS) · Vercel · PWA.

## Architecture at a glance

- **Two Postgres schemas:** `core` (platform: companies, users, RBAC, audit, modules) and
  `accounting` (the accounting module). Future modules get their own schemas.
- **Multi-company:** every record is scoped to a company; users belong to many companies with a
  per-company role. Tenant isolation is enforced by Row Level Security.
- **Double-entry:** all financial activity posts balanced journal entries. Posting is gated by a
  database function that enforces balance in transaction *and* base currency, open periods, and
  permissions. Posted entries are immutable; corrections are reversing entries.
- **Data-driven permissions & tax:** no access rules or tax rates are hard-coded.

## Repository layout

```
app/            Next.js App Router (platform shell + accounting routes)
src/core/       platform core libs (auth, rbac, ...)
src/modules/    accounting domain libs (built in later cycles)
supabase/
  migrations/   ordered SQL migrations (0001..0004)
  seed/         reference seed data (currencies, account types, permissions, roles)
  tests/        SQL correctness checks
docs/           architecture pack
```

## Prerequisites

- Node.js 20+
- Supabase CLI (`npm i -g supabase`)
- Docker Desktop — **required** to run the local Supabase stack (`supabase start`). If you cannot
  run Docker locally, point the app at a hosted Supabase project instead (see below).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + keys
```

### Option A — local Supabase (needs Docker)

```bash
supabase start                       # boots Postgres, Auth, Storage locally
supabase db reset                    # applies migrations in supabase/migrations + seed
npm run db:types                     # generate TypeScript types from the schema
```

### Option B — hosted Supabase project

```bash
supabase link --project-ref <your-project-ref>
supabase db push                     # apply migrations to the hosted project
# then run supabase/seed/seed.sql against the project once
```

### Run the app

```bash
npm run dev        # http://localhost:3000
```

## Validate accounting correctness

After applying migrations + seed, run the engine checks (creates no persistent data — it rolls back):

```bash
# local stack
supabase db reset
# then execute the test script against the local db, e.g.:
#   psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/accounting_engine_test.sql
```

The script asserts: balanced entries post, posted entries are immutable, unbalanced entries are
rejected, closed-period posting is rejected, the trial balance nets to zero, and reversals balance.

## Status

Cycle 0 (architecture pack) and Cycle 1 (project skeleton + database foundation) are in place.
Migrations have been authored and manually reviewed but **not yet executed against a live database**
in this environment (no Docker). First run should be done with Docker locally or a hosted project.
See [`docs/master-roadmap.md`](docs/master-roadmap.md).
