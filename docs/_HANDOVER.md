# TEAL Enterprise — Session Handover

> Living reference for continuing work in a new session. Last updated after the Codex
> audit remediation + multi-currency + atomic-templates work. Owner: Andrew Taylor (sole super admin).

---

## 1. What this is
**TEAL Enterprise** — a multi-tenant, modular business operating platform for the Taylor Engineering Group.
Modules: **accounting**, **cargo** (Cargo Assurance, schema `cargo`, module key `cargo_assurance`), and
**freight** ("Jupiter Logistics", a full freight-forwarding operations system — the focus of recent work).

**Stack:** Next.js 14 (App Router, server components + server actions), Supabase (Postgres + RLS + Auth + Storage),
TypeScript. No client-side data fetching; auth is fully server-side.

**Repo:** github.com/taylorandrew07-lab/TEAL_ENTERPRISE · branch **main** (direct commits, no PRs).

---

## 2. Deploy pipeline (IMPORTANT — push to main = live)
Per `docs/deployment.md`. On every push to `main`:
- **GitHub Action "Deploy DB migrations"** runs `scripts/db-migrate.mjs` → applies any new `supabase/migrations/*.sql`
  (each in its own transaction; failure rolls back and is NOT recorded) then `supabase/seed/seed.sql`, against the
  **single hosted Supabase project**.
- **GitHub Action "CI"** → typecheck + vitest + build.
- **Vercel** → builds & deploys the Next app.

**Workflow to ship anything:**
```
npm run typecheck && npm test && npm run build      # verify locally first (all must pass)
git add -A && git commit -m "..." && git push origin main
# then watch the DB migrate (critical when a migration changed):
RID=$(gh run list --workflow="db-migrate.yml" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
```
Migrations are **append-only** — never edit an applied one; add a new numbered migration to fix forward.
(If a just-pushed migration FAILED, it wasn't recorded, so you may edit that same file and re-push.)

**Gotchas learned the hard way:**
- Typed routes (`experimental.typedRoutes`): new routes fail standalone `tsc` until `next build` regenerates
  `.next/types`. `npm run build` fixes it; for client-component `<Link>` to a brand-new route, cast `href={'/x' as Route}`.
- Postgres has **no `min(uuid)`** — use `min(id::text)`.
- `tg_op` is NOT valid in a `CREATE TRIGGER ... WHEN` clause (only inside the function).
- A composite-FK target needs its `unique (company_id, id)` created BEFORE the referencing table.
- LF→CRLF git warnings on Windows are harmless.
- The freight Supabase client is cast `schema('freight' as any)` because `database.types.ts` isn't regenerated
  (would need `npm run db:types` against a running DB). Functionally fine.

---

## 3. Security & access model (all DB-enforced)
- **Per-account, per-module isolation:** `core.user_module_access(user_id, company_id, module_key)` is the read gate.
  `core.can_read(company, module)` = super admin OR (active member AND has a grant for that module). All module-table
  SELECT policies use it. `getPlatformContext` also intersects `enabledModuleKeys` with these grants. **Fail-closed.**
  NOTE: module key for cargo is `cargo_assurance` (not schema name `cargo`).
- **Super admin / owner protection** (migration 0013): protected owner can't be deleted/demoted; last super admin
  can't be removed; only a super admin can set `is_super_admin`. Owner is `core.platform_settings.protected_super_admin_id`
  (backfilled by 0030; setup-admin sets it).
- **Access request → approval:** `core.access_requests`; user self-requests a module (`/request-access`), an approver
  (super admin or `users.manage`) approves (`/admin/access-requests`) → writes `user_module_access` + seeds the module's
  full role perms. No self-approval (trigger). `src/modules/admin/access.ts`.
- **Reducible permissions:** per-membership `core.membership_permissions` (Admin → Users & Access checkboxes;
  `src/modules/admin/users.ts`). `core.has_permission()` reads these. Escalation guards (0014 + 0028): can't change own
  grants; can't grant/revoke a perm you don't hold.
- **Owner transfer / super-admin mgmt:** `/admin/platform` (`src/modules/admin/platform.ts`).
- **Session:** persistent + **httpOnly** + secure + sameSite cookies (`src/lib/supabase/cookie-options.ts`) → mobile
  logs in once; XSS can't read the token. Baseline security headers in `next.config.mjs`.
- **Audit:** `core.audit_trigger` on privilege + financial tables (incl. users/roles/permissions/platform_settings/
  user_module_access via 0026, and freight shipments/quotes/charges/billing/etc.).

---

## 4. Freight module — what exists
End-to-end single workflow: **enquiry/RFQ → supplier quotes → customer quotation (margin) → client approval
(auto-advances to booking) → containers + tracking + free-time/demurrage → documents → payment → release.**

- **Shipment workspace** (`app/freight/shipments/[id]/page.tsx`): stage machine, parties, milestones, tasks,
  quotes, documents (with visibility), communications, containers+tracking+free-time, **costs/charges (multi-currency,
  base-currency rollups)**, **payment & release** (gated).
- **Quotes** (`app/freight/quotes/**`): RFQ → recipients → supplier-quote comparison → customer quotation (revisions,
  margin) → post-to-charges (idempotent). Approval auto-advances shipment stage.
- **Containers**: free-time/demurrage/detention engine (`freetime.ts`) + per-container penalty rates; **direct
  per-carrier tracking framework** (`tracking.ts`: Maersk/CMA CGM/Hapag/MSC/COSCO/ONE/Evergreen, env-key gated) +
  manual deep-link tracking (`TrackLinks.tsx`) — NO paid aggregator.
- **Payment/release** (`shipment_billing`, `shipment_payments`): record invoice total + payments; **DB-enforced
  release gate** (0030/0032) blocks release & stage→delivery/POD/completed unless paid / open-account / explicit override.
- **Contacts CRM** + **CSV import** (`/freight/contacts/import`). **Global search** (`/freight/search`).
  **Operational dashboard** (`app/freight/page.tsx`).
- **Module code:** `src/modules/freight/{context,lifecycle,queries,actions,status,documents,tracking,freetime,TrackLinks}`.
- **Branding:** indigo palette (tokens in `app/globals.css`; favicon via `scripts/gen-icons.mjs`); full indigo header.
  Jupiter module status = **live**.

**Intentional forward-looking seams (built, dormant — do NOT delete):**
- AI: `freight.ai_jobs`, `freight.prompts` (per-stage prompts; `performed_by` human→ai flip; tool-actions = existing
  server actions). Plug in later: add Anthropic key + prompts; no rewrite.
- Email (Microsoft 365/Graph): `freight.mailboxes`, `freight.outbound_emails`, `freight.email_links`. Needs Azure app + mailbox addresses (owner doesn't have yet).
- Tracking: `freight.tracking_events` + per-carrier API keys (owner won't pay for an aggregator; direct lines).
- Customer portal: `freight.client.view` perm, `freight_client_viewer` role, document `visibility` — wired when the portal is built.

---

## 5. Migrations (freight + security), 0019→0038
(0033 client_access+user_customer_ids · 0034 portal_* views · 0035 notification prefs/read-state/portal-notif
view+fns · 0036 notification triggers + re-created apply_stage_automation · 0037 restore service_role grants on
app schemas — see §7b.)

0019 schema · 0020 RLS · 0021 functions(reference gen + stage automation) · 0022 quote refs · 0023 documents/email/
tracking/notifications/import · 0024 container rates · 0025 **per-account isolation** (user_module_access, can_read,
SELECT rewrite, self-role guard) · 0026 access_requests + privilege audit triggers · 0027 payment/release tables ·
0028 extend permission guard (revoke/update) · 0029 **audit P0** (freight API exposure, restore private accounting
policies, cargo key) · 0030 DB release gate + owner backfill · 0031 lock reference fn · 0032 **audit round-2**
(restore dashboard/report policies, delegated-approver grants, charges.quote_line unique, DB stage gate).

---

## 6. Security audits — status
Two independent audits (internal multi-agent + external Codex, run twice). **All P0s fixed & live.** Notable fixes:
freight schema wasn't exposed to the prod API (freight data was broken in prod — fixed 0029); my 0025 blanket SELECT
rewrite had clobbered private banking/treasury/parallel-rate AND dashboard/report policies (restored 0029/0032);
cargo module-key mismatch; payment-release now DB-enforced; httpOnly cookies; reference fn locked; quote-post idempotent.

**Deferred workstreams (none block trusted-internal use):**
- **A — Customer portal security** (client-scoped RLS, doc visibility enforcement, email-attachment validation):
  do WITH the portal (deferred by owner). Guardrail: don't onboard a client as a plain company member until then.
- **B — Accounting MODULE internals** (composite FKs, transactional posting RPCs, lock accounting numbering fns,
  F-08/F-09): **owner said: for the accounting module, only ensure isolation (done). Do NOT refactor its internals now.**
- **C — Multi-currency FX:** DONE for freight finance.

**Posture:** safe to onboard **trusted internal non-super staff** now. NOT safe for external/client users until A.

---

## 7. IN FLIGHT
**Efficiency / interconnection / dead-code audit — DONE & applied** (run `wf_d318f007-52f`, 2026-06-30; 21
findings, all 21 adversarially verified, 0 rejected). Cleanup commit applies the low-risk subset; typecheck +
vitest (42) + build all green. APPLIED:
- *Deleted dead code:* `getModuleForPath` (registry + barrel); `src/lib/supabase/client.ts` (unused browser
  Supabase client — auth is fully server-side); `RfqRow.recipientCount/quoteCount`; `CompanyMember.roleKey/roleName`
  (+ the dead `roles` join in listCompanyMembers); `Template.keys`/`allKeys` in the Users page; the unused `owner`
  return field of `getPlatformAdminInfo`.
- *Optimized:* freight dashboard `listShipments({limit:10})`; `getDashboardStats` now one parallel batch (was 4
  serial round-trips) and no longer double-queries containers — new `getContainerRiskBoard()` fetches unreturned
  containers ONCE and yields both the risk count and ranked list; `profitAndLoss` drops an O(accounts×lines)
  `rows.find`; `getPlatformContext` folds the `user_module_access` read into its parallel batch.
- *Rewired (dedup):* `RiskBadge` extracted to `freight/status.tsx` (was copy-pasted in 3 pages); accounting
  base-currency reads consolidated to `accounting/context.ts` `activeBaseCurrency()` + `companyBaseCurrencyOf()`
  (intercompany keeps its null contract); `listCurrencyCodes` defined once in `accounting/context.ts`.

**DEFERRED by triage (verified-real but each wants its own careful pass — NOT done):**
- *OPTIMIZE — unbounded list queries* (`listContacts`/`listAllContainers`/`listRfqs`/`listCustomerQuotes`/
  `listOpenTasks` have no `.limit()`): needs real pagination (and a light id+name `listContactOptions` for the
  workspace dropdowns), not a bare cap. Harmless at current volume.
- *OPTIMIZE — `trialBalance` on the accounting dashboard* pulls the whole `general_ledger` per render for one
  total: real fix is a DB SUM aggregate/RPC + matching the existing per-account-round-then-filter semantics. Touches
  live financials → migration + care.
- *REWIRE — `accountsByCategory`/`accountsForCompany`* (AR/AP/banking/intercompany): verifier says low-value and
  risky (intercompany has a deliberate cross-company auth gate; AR/AP return different shapes). Leave or do minimally.
- *REWIRE — shared `FormError` banner*: the danger-banner markup is copy-pasted across ~36 files (cargo + freight +
  accounting's local `ErrorBanner`s + UserManagement's `bannerStyle`). Extract ONE `src/core/ui/FormError.tsx` and
  sweep all of them — platform-wide, own task.
- *REWIRE — RBAC role-template seeding* (`grantUserModule`/`inviteUser`/`applyTemplate`/`createCompany` each
  hand-roll "role→role_permissions→membership_permissions"): extract `seedMembershipPermissionsFromRole(... mode:
  add|replace)`. Security-sensitive (F-11 add-before-remove ordering, differing error idioms) → careful standalone.
- One verify branch (a minor `{overdue,watch,none}` sort-order map duplicated in `queries.ts`/`containers/page.tsx`)
  hit the workflow's output-retry cap and was dropped before reporting — trivial, fold into a shared const if touched.

---

## 7b. CUSTOMER PORTAL — SHIPPED & LIVE (all 4 phases, 2026-06-30)
External customers log in at **/portal** and see ONLY their own shipments. Built per
`C:\Users\Andrew\.claude\plans\cryptic-orbiting-duckling.md`. Owner decisions: clients see tracking + quote +
invoice/payment + free-time/demurrage (incl. penalty) + client-visible docs; **invite-only**; email via **M365
(deferred)** so in-app works now and emails queue.
- **Phase 1 (0033/0034):** `freight.client_access` (external user→customer contact, NEVER a company membership) +
  `freight.user_customer_ids()`. The portal reads ONLY **security-definer `portal_*` views** (portal_shipments/
  milestones/containers/documents/quote/quote_lines/billing/customer/notifications) — each exposes only safe
  columns + scopes rows to the signed-in customer. No internal RLS changed; base tables stay staff-only.
- **Phase 2:** internal routes moved under **`app/(internal)/`** (URLs unchanged) so `/portal` has its own minimal
  shell. `getPortalContext`/`requirePortal` (`src/core/session/portal-{context,guard}.ts`), portal query layer
  (`src/modules/freight/portal/queries.ts`, reads `portal_*` only; doc URLs signed via service role AFTER the view
  authorises), pages: my shipments, tracking detail, documents, account, notifications.
- **Phase 3:** invite-only access mgmt at **/freight/settings/portal** (`src/modules/freight/portal/admin.ts` —
  grant/revoke/reset; membership-free; gated `freight.comms.manage`).
- **Phase 4 (0035/0036):** `notification_preferences` + read-state; `portal_notifications` view + mark-read fns;
  `enqueue_notification()` + re-created `apply_stage_automation()` (0021 body verbatim + arrival/delivery enqueue)
  + ETA + free-time/demurrage triggers. In-app notification centre (bell/unread/mark-read) + opt-in prefs.
  Pluggable `EmailSender` (NoopSender default; `M365GraphSender` stub via `FREIGHT_EMAIL_PROVIDER`) +
  `dispatch.ts` (client_visible-only attachments). **Emails queue in `outbound_emails` and send only once M365
  is wired.**
- **Self-verifying deploy:** `supabase/tests/portal_isolation_test.sql` + `stage_automation_test.sql` run in the
  db-migrate workflow (tx + rollback) — every deploy proves a portal user sees only their data, can't read base
  tables, loses access on revoke, and that stage automation + notifications still fire. Both green on live.
- **service_role grants fix (0037):** found via the E2E test — earlier migrations granted only to `authenticated`,
  so `service_role` (server-only, bypasses RLS) had NO grants on core/accounting/cargo/freight. This had silently
  broken the portal admin action (createAdminClient core.users lookup + email display). 0037 restores the standard
  service_role grants + default privileges. (Any future service-role/webhook/cron code now works.)
- **END-TO-END VERIFIED LIVE (2026-06-30):** a throwaway script seeded a real test customer + shipment in prod,
  created a real portal login, signed in AS the customer, and ran 18 checks — all PASS: membership-free grant;
  sign-in; portal_shipments scoped + cost/margin columns absent; base tables denied; client_visible-only docs;
  sent quote (no margin) + lines; billing; container + penalty; arrival + eta_update notifications; mark-read RPC;
  prefs write; revoke kills access. Test data fully cleaned up (no residue in prod). The portal DATA + SECURITY
  layer is proven against production.
- **REMAINING for portal go-live:** (1) wire the M365 connector to actually SEND the queued emails (Azure app +
  mailbox addresses + implement `M365GraphSender`/inbound linking; optional: schedule `dispatchOutboundEmails`);
  (2) only-structural-tested: the document signed-URL download (signing path verified, but not a real byte download
  — internal-uploaded docs have bytes so it's fine) and the browser pixel rendering of the portal pages (the
  underlying queries are all proven). Confirm both when onboarding the first real customer.

## 7c. PROVIDER-AGNOSTIC AI INFRASTRUCTURE — SHIPPED & LIVE (2026-06-30, dormant)
Owner wants AI but **provider-agnostic** ("any AI, any model"), with **per-task model tiering** (cheap models
for simple tasks, premium reserved) so it's cheap + swappable. Built the full plumbing; **no business tasks
wired yet** (owner chose "pure infrastructure only"). Nothing calls a model until a provider key is set AND a
task is switched on. Pattern mirrors the email NoopSender.
- **`src/core/ai/`** — provider-agnostic interface (normalised messages/tools/tool-calls/structured-output).
  Adapters over raw `fetch` (ZERO new deps): `providers/anthropic.ts` (native) + `providers/openai-compatible.ts`
  reaching **OpenAI, DeepSeek, Gemini (its OpenAI endpoint), GLM/Z.ai** — and any OpenAI-compatible base
  (Groq/Together/OpenRouter/Ollama) via an env base-URL override. `providers/noop.ts` default. `registry.ts`
  (`getAIProvider`, `providerStatus`, 5 presets). Keys via server env: `AI_ANTHROPIC_API_KEY`, `AI_OPENAI_API_KEY`,
  `AI_DEEPSEEK_API_KEY`, `AI_GEMINI_API_KEY`, `AI_GLM_API_KEY` (+ optional `AI_<ID>_BASE_URL`).
- **`src/modules/freight/ai/`** — `tiers.ts` (AITier cheap|standard|premium, AIMode off|suggest|auto, the AI task
  catalogue, TIER_MODEL defaults); `0038 freight.ai_task_settings` (per-company per-task override of mode/tier/
  provider/model, RLS gated `freight.ai.manage`); `config.ts` (resolver: DB override → code default; default mode
  'off'); `runner.ts` (`runAiJob` generic — renders the active `freight.prompts` template, calls the provider,
  records `freight.ai_jobs`; short-circuits to 'skipped' when off/no-key; `testProvider` for the settings check);
  `approval.ts` (approve/reject ai_jobs — **executor seam documented, not wired**: when a task is enabled, map
  stored `tool_calls[].name` → a freight action core fn); `queries.ts`; `settings-actions.ts`;
  `prompts.defaults.ts`.
- **UI**: `/freight/ai` (AI inbox: awaiting-approval + recent activity) and `/freight/settings/ai` (per-task model/
  mode table, provider status, live connection test, editable prompts + install-defaults). Manifest nav: `ai` +
  `ai_settings`. Permission `freight.ai.manage` already seeded.
- **TO SWITCH ON (per task):** add a provider key to the server env (Vercel) → open `/freight/settings/ai`, set a
  task to **Suggest** + pick provider/model (or leave tier default) → install/edit the prompt → run it; the AI
  drafts, a human approves in `/freight/ai`. To make a task actually EXECUTE on approval, wire its executor in
  `approval.ts` (extract a core fn from the matching action in `src/modules/freight/actions.ts` — see the Plan
  agent's tool-surface table in chat). `auto` mode + real task wiring is the last step per task.
- **Model guidance (provider-agnostic):** CHEAP tier (Haiku / GPT-mini-nano / Gemini Flash-Lite / Groq-or-local
  Llama) for classify/extract/summarise/template-fill ≈ 80% of tasks; STANDARD (Sonnet / GPT-4.1-class /
  Gemini Flash-Pro) for drafting/comparison; PREMIUM (Opus / GPT-5-o-class / Gemini Pro-high) ONLY for multi-step
  agentic chains. Always use structured/JSON output so cheap models stay reliable. Defaults already encode this.

## 8. Next work (priority order)
1. **Efficiency-audit cleanup — DONE** (see §7). **Customer portal — DONE & live** (see §7b). **AI infrastructure
   — DONE & live, dormant** (see §7c).
2. **Bring it up for real use / onboard a test teammate**: create a teammate, Request access, approve, verify they
   see only that module, run a shipment RFQ→release. (Owner wanted to actually use it before extra features.)
3. **Customer portal** (workstream A) — when ready: client-scoped access (mirror `cargo.client_access` pattern),
   DB-enforced doc visibility, then portal UI.
4. **Microsoft 365 email connector** — when owner provides Azure app + mailbox addresses. Drains `outbound_emails`,
   auto-links inbound to shipments/RFQs.
5. **Container tracking go-live** — when owner provides per-carrier API keys; fill `tracking.ts` fetch bodies.
6. **AI activation** — when owner provides Anthropic key + prompts; AI worker drains `ai_jobs` (human-approval first).
7. Minor: module enable/disable admin UI; below-cost margin policy; bridge freight payments → accounting AR.

---

## 9. Memory & conventions
- Memory dir: `C:\Users\Andrew\.claude\projects\c--Users-Andrew-OneDrive-Documents-Apps\memory\` — see
  `MEMORY.md`, `project-jupiter-freight-module.md`, `project-security-requirements.md`, `user-andrew-taylor.md`.
- Spec: `docs/freight/_FREIGHT-SPEC.md`. Platform conventions: `docs/platform-module-framework.md`,
  `docs/_ARCHITECTURE-SPEC.md`, `docs/security-and-permissions.md`.
- Conventions: one Postgres schema per module; every business table has `company_id` + RLS; parent tables expose
  `unique (company_id, id)` so children use composite FKs; module manifest in `src/core/modules/manifests/` +
  register in `registry.ts`; permissions/roles live in `src/core/rbac/catalog.ts` AND `seed.sql` AND (role keys)
  `permissions.ts` — kept in lock-step by `src/core/rbac/__tests__/permissions-parity.test.ts` (CI guard; adding a
  role/permission means updating all three with exact-matching name/description).

---

## 10. Owner preferences (how to work)
High-level/strategic; communicates by voice (expect added requirements mid-task). Wants momentum + shipped work,
but press on genuinely ambiguous high-stakes decisions. Be honest in audits/triage — never defensive about our own
code. Verify before claiming done; state failures plainly. Deploys are live — confirm migrations succeed after push.
