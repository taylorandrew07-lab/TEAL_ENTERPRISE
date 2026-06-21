# Deployment & CI/CD

**TEAL Enterprise — operations runbook**

## Topology

```
GitHub (taylorandrew07-lab/TEAL_ENTERPRISE, main)
  ├── GitHub Actions: CI            → typecheck + unit tests (RBAC parity) + build on every push/PR
  ├── GitHub Actions: DB migrate    → applies new supabase/migrations + seed to Supabase on merge to main
  └── Vercel (Git integration)      → builds & deploys the Next.js app on every push to main
Supabase project gysgmzbvnjlagiekovya (region us-east-1) → Postgres + Auth + Storage
Vercel region iad1 (US-East) → co-located with Supabase for low latency
```

## GitHub secrets (Settings → Secrets and variables → Actions)

- `DATABASE_URL` — the Supabase **Session pooler** connection string (used only by the DB-migrate
  Action). Set via `gh secret set DATABASE_URL`.

## Vercel — environment variables (Project → Settings → Environment Variables)

Add these for **Production** (and Preview if you use it):

| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gysgmzbvnjlagiekovya.supabase.co` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` | public (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | **secret** — server only |
| `NEXT_PUBLIC_APP_NAME` | `TEAL Enterprise` | |
| `NEXT_PUBLIC_DEFAULT_BASE_CURRENCY` | `TTD` | |

The DB password / pooler connection string is **not** needed by the app (the app uses the anon +
service keys with RLS); it is only used by the migration Action/secret.

## Supabase cost control (keep the bill predictable)

The project is on **Pro** (~US$25/mo base, which includes generous compute/egress/storage). To avoid
overage charges:

1. **Spend Cap: ON.** Settings → Billing → Subscription → ensure the spend cap is enabled. With it on,
   if you ever exceed plan limits the service throttles instead of billing overages. (On by default.)
2. **No preview branches.** Supabase database *branches* each run a separate paid compute instance.
   This repo deliberately deploys migrations to the **single** project via the GitHub Action — it does
   **not** use Supabase Branching — so PRs cost nothing extra. Do not enable the Supabase GitHub
   Branching integration unless you accept per-branch compute cost.
3. **Don't enable paid add-ons** unless needed: PITR (point-in-time recovery), read replicas, larger
   compute, or additional egress. The included Pro compute is fine for now.
4. **Vercel** Hobby/Pro: the app is a standard Next.js app; no always-on cost beyond Vercel's plan.

## Manual operations

- Apply migrations locally: `DATABASE_URL=<pooler-uri> node scripts/db-migrate.mjs`
- Run the live engine test: `DATABASE_URL=<pooler-uri> node scripts/db-test.mjs`
- Verify reference data: `DATABASE_URL=<pooler-uri> node scripts/db-verify.mjs`
- Regenerate types (needs Docker OR a Supabase access token):
  `supabase gen types typescript --project-id gysgmzbvnjlagiekovya --schema core,accounting,cargo > src/lib/database.types.ts`
