# TEAL Enterprise — Code Audit Report

**Date:** 2026-06-20
**Scope:** Accounting module (DB schema, RLS, posting engine), Cargo-Assurance engine, platform module framework, and per-request session context.
**Auditor:** Multi-agent audit workflow (`teal-code-audit`) — 5 dimension auditors → adversarial verification (1 verifier per finding) → lead synthesis. 33 agents, 26 confirmed findings of 27 raised.

---

## ✅ Remediation status — 2026-06-20 (all findings addressed)

Every confirmed finding has been fixed. Verified with `npx tsc --noEmit` (0), `npx vitest run`
(42 tests incl. 8 new permission-parity + 6 new engine-hardening tests), and `npx next build` (0).
SQL changes are authored (unexecuted — Supabase still pending) and a foreign-currency posting check
(TEST 7) was added to `supabase/tests/accounting_engine_test.sql`.

| Finding | Fix |
| --- | --- |
| Critical — base-currency trusted | `post_journal_entry` now **recomputes** `base_debit/base_credit` from `accounting.fx_rate()` (rejecting missing rates); reversals keep the original's base; per-line base CHECKs added (`0002`/`0004`). |
| High — line tenant/account consistency | Composite FKs `(company_id, journal_entry_id)` and `(company_id, account_id)` + `unique(company_id,id)` on entries/accounts (`0002`). |
| High — base one-side | `journal_lines_base_one_side` + `journal_lines_base_side` CHECKs (`0002`). |
| High — permission 4-copy drift | Single-source `src/core/rbac/catalog.ts` (core + manifest perms + role grants); `context.ts` & registry consume it; **parity test** `permissions-parity.test.ts` guards seed↔catalog↔constants; `cargo.config.manage` drift fixed. |
| High — rules-engine DoS | Depth (64) / node (10k) / sum-arg (1k) caps throwing `RuleEvaluationError` (`rules-engine.ts`). |
| Med — period overlap / lock bypass | `btree_gist` EXCLUDE on periods + posting raises on >1 matching period (`0002`/`0004`). |
| Med — reversal idempotency | `reversal_of` column + unique index + guard in `reverse_journal_entry` (`0002`/`0004`). |
| Med — category hack / CORE_PERMISSION_KEYS | Explicit `category` on every manifest permission; derived hack removed; keys sourced from catalogue. |
| Med — schema collision | Planned Cargo Monitoring → schema/key `cargo_monitoring`; schema-distinctness test added. |
| Med — manual add-a-module | Parity test now fails CI on any catalogue/seed drift (silent lock-out prevented). Full scaffolding generator noted as a follow-up. |
| Med — per-row write policies | `core.has_permission(...)` wrapped in `(select …)` in all generated + custom write policies (`0003`/`0006`). |
| Med — role_id index | `create index on core.company_memberships (role_id)` (`0001`). |
| Low ×11 | platform `exchange_rates` visibility; user-private dashboards; report-export access; `core.user_directory` view (hides `is_super_admin`); audit on `journal_lines`/`invoice_lines`/`bill_lines` + cargo governance tables; `round()` half-away-from-zero fix; non-finite density flag; meter rollover guard; `weightedMean` positive-weight guard; `getPlatformContext` role reuse + `Promise.all`; FK covering indexes (accounting + cargo). |

Remaining as a deliberate follow-up (not a risk today): a manifest→seed **codegen generator** to
complement the parity test (the test already prevents the dangerous drift).

---

## Executive Summary

TEAL Enterprise's accounting and cargo-assurance foundation is well-architected and security-conscious: RLS is data-driven, helper functions are hardened against `search_path` injection, posted journals are immutable via DB triggers, and the module framework is internally consistent with schema-per-module isolation. The audit surfaced **no exploitable cross-tenant breach**. The most serious issues are defense-in-depth gaps in the double-entry engine — base-currency amounts are entirely trusted from the client with no constraint tying them to transaction amounts or `fx_rate`, and journal-line tenant/account consistency is enforced nowhere — which can silently misstate the base-currency general ledger. The largest threat to the owner's goal of safely adding modules is **architectural drift**: the permission catalogue is hand-duplicated across four copies with no parity check, a schema-name collision is baked into the module catalogue, and the entire "add a module" playbook is manual. None of these block expansion today, but they should be hardened before module #3 is built.

Note: severities below reflect the verified verdicts. Several findings were honestly down-rated during adversarial verification (e.g. the base-currency gate from critical→high) because the project is intentionally pre-Supabase, so nothing is being corrupted in a running system yet — these are gaps in authored code that will ship as written.

## Ability to Expand TEAL — Readiness Assessment

**Rating: Adequate (with named pre-conditions).**

The extensibility backbone is genuinely sound — schema-per-module isolation, a pure-TypeScript manifest registry (`src/core/modules/registry.ts`) with unit-testable helpers, data-driven RLS policy generation from a `(schema, table, permission)` catalogue, and external-portal access modelled as additive grant roles rather than weakened tenant RLS. That is a strong base to build on.

However, the "adding the Nth module is repeatable, not bespoke" claim is **not yet enforced by tooling**, and the four architecture findings concentrate exactly there:

- The permission catalogue is hand-maintained in **four uncoordinated copies** (manifests, `supabase/seed/seed.sql`, `src/core/rbac/permissions.ts`, and `CORE_PERMISSION_KEYS` in `context.ts`) with **no parity test** — and drift already exists (the `cargo.config.manage` description differs between manifest and seed). A key present in a manifest but missing from the seed yields a permission the UI gates on but RLS never grants — a silent lock-out.
- A **latent schema collision** is baked into `docs/platform-module-framework.md` §11 and the `core.modules` seed: both `cargo_assurance` and the planned `cargo` (Cargo Monitoring) module claim Postgres schema `cargo`, which breaks one-schema-per-module the moment Cargo Monitoring is built.
- The §9 add-a-module playbook is **nine manual steps** editing shared/core files, with a hand-rolled super-admin cross-join re-run after every module — no scaffolding, codegen, or validation.

These are all fixable **cheaply now, before tenant data exists**, which is why the rating is "adequate" rather than "needs-work." But they are the single highest-leverage things to harden before expanding.

## Findings (grouped by severity)

### Critical

| Sev | Dimension | File | Issue | Recommended fix |
|---|---|---|---|---|
| Critical | accounting | `supabase/migrations/0002_accounting_schema.sql` (lines 159-178; enforced by `post_journal_entry`, `0004` lines 98-100) | `base_debit`/`base_credit` default to 0 with no link to `debit`/`credit`/`fx_rate`. The posting gate only checks `sum(base_debit)=sum(base_credit)`, so an entry with all base amounts left at the 0 default passes (0=0) while balanced in txn currency — posting silently contributes **zero** to the base-currency GL. The test suite never exercises a foreign-currency entry. | Recompute base amounts server-side from a validated `exchange_rates` lookup (trigger or in `post_journal_entry`); add a per-line CHECK relating base amounts to the side and rejecting zero-base when txn is non-zero; add a foreign-currency test case. |

_(Verified verdict honestly down-rated this to **high** as a defense-in-depth gap since base amounts are app-populated and no live data exists yet; the original cataloged severity was critical. It remains the top-priority correctness gap.)_

### High

| Sev | Dimension | File | Issue | Recommended fix |
|---|---|---|---|---|
| High | accounting | `supabase/migrations/0002_accounting_schema.sql` (`journal_lines`, company_id line 161, account_id FK line 164) | A line's `company_id` is not enforced equal to its parent entry's, and `account_id` FK is unscoped by company. A user with `journals.manage` can post lines against another tenant's account or attribute lines to the wrong company, corrupting per-company trial balances. | Add `unique(company_id,id)` on entries and accounts; composite FKs so `(company_id, journal_entry_id)` matches the entry and `account_id` is scoped to the company — or validate in a BEFORE INSERT trigger and in `post_journal_entry`. |
| High | accounting | `supabase/migrations/0002_accounting_schema.sql` (`journal_lines_one_side`, line 177) | The one-side check covers only `debit`/`credit`, not the base columns, so a line may carry both `base_debit > 0` AND `base_credit > 0`, distorting one-sided/turnover base figures while still passing the sum-based balance gate. | Add `constraint journal_lines_base_one_side check (not (base_debit > 0 and base_credit > 0))`. |
| High | architecture | `supabase/seed/seed.sql` (45-66, 144-156) vs manifests vs `rbac/permissions.ts` | Permission catalogue duplicated by hand in 4+ places with no parity check; drift already present (`cargo.config.manage` description differs between manifest and seed). Per-module hand-sync risks silent UI/RLS divergence (lock-outs or orphan rows). | Make manifests the single source of truth; codegen seed + rbac constants, or add a CI test asserting set-equality (key, name, description, category) across all copies. Resolve the description drift now. |
| High | cargo_engine | `src/modules/cargo-assurance/rules-engine.ts` (`evaluateNode` 50-74, `evaluateMethodology` 77-83) | No recursion depth or node-count limit; a client-supplied deeply-nested rule tree throws native `RangeError`, not `RuleEvaluationError`, bypassing the engine's error contract and crashing the evaluating worker (DoS). No cap on `sum` arg count. | Enforce max depth (~64) and max node count (~10k) throwing `RuleEvaluationError`; thread a depth param or use an iterative evaluator; cap `sum` args; convert any `RangeError` to `RuleEvaluationError` at the top level. Add deep-tree/wide-sum tests. |

_(The cargo rules-engine finding was verified-down-rated to medium pending tracing to a live untrusted handler; listed here at its cataloged high severity given the contract-bypass.)_

### Medium

| Sev | Dimension | File | Issue | Recommended fix |
|---|---|---|---|---|
| Medium | accounting | `supabase/migrations/0002_accounting_schema.sql` (`accounting_periods` 100-114; `post_journal_entry` `0004` 102-115) | Only `unique(company_id, fiscal_year, period_no)` and `end_date >= start_date` are enforced — overlapping periods (e.g. period 13 adjustment over period 12) are allowed. `post_journal_entry` resolves the period via `ORDER BY ... LIMIT 1`, silently picking one; if it is open while the intended period is locked, the lock is bypassed. | Add a `btree_gist` EXCLUDE constraint forbidding overlapping `daterange` per company; make `post_journal_entry` raise when more than one period matches `entry_date`. |
| Medium | accounting | `supabase/migrations/0004_functions_posting.sql` (`reverse_journal_entry` 134-178) | Only checks the original is `status='posted'`; no `reversed_by` linkage and no check for an existing reversal, so it can be run repeatedly, creating duplicate offsetting reversals and inflating volume / polluting the audit trail. | Add a `reversal_of`/`reversed_by` column, set it during reversal, and raise if already reversed; store the bidirectional link. |
| Medium | architecture | `src/core/modules/registry.ts` (`allModulePermissions()` 53-57) | `category` is derived as `m.key.replace('_assurance','')`, yielding `accounting`/`cargo`, which disagrees with the seeded `core.permissions.category` (sales/purchases/banking/reporting/...) for ~9 of 15 accounting permissions. Fragile string hack; latent today (only consumer ignores `category`). | Make `category` an explicit manifest field sourced from the same place as the seed, or remove the unused derived field; delete the `replace()` hack. |
| Medium | architecture | `src/core/session/context.ts` (`CORE_PERMISSION_KEYS` 16-22) | The 5 core permission keys are hard-coded, a fourth uncoordinated copy. Adding a core permission requires editing this array or super-admins silently won't receive it. | Source core keys from a shared `CORE_PERMISSIONS` catalogue consumed by both `context.ts` and seed codegen, or fetch `core.permissions` at runtime for super-admins. |
| Medium | architecture | `docs/platform-module-framework.md` (§11; `seed.sql` 126, 129) | Both `cargo_assurance` and planned `cargo` (Cargo Monitoring) claim Postgres schema `cargo`, violating one-schema-per-module the moment Monitoring is built. | Reassign Cargo Monitoring to its own schema (e.g. `cargo_monitoring`) in the catalogue and `core.modules` seed now; add a parity assertion that all module schemas are distinct. |
| Medium | architecture | `docs/platform-module-framework.md` (§9 steps 2,4,5) | The add-a-module playbook is nine manual steps editing shared files (registry, seed, rbac), with a hand-duplicated super-admin cross-join — no scaffolding, codegen, or validation. | Build a manifest-driven generator emitting registry/seed/rbac artifacts; add a CI parity test; replace the duplicated cross-join with a single post-insert step. |
| Medium | performance | `supabase/migrations/0003_rls_and_helpers.sql` (write policies 114-124; `0006` 104-114) | Write policies call `core.has_permission(company_id, ...)` inline per row (not wrapped in a scalar sub-select like the SELECT policies), so set-based/bulk writes re-run the permission EXISTS once per row. | Wrap in `(select core.has_permission(company_id, 'perm'))` so the planner caches per distinct company_id; validate with EXPLAIN ANALYZE. |
| Medium | performance | `supabase/migrations/0001_core_schema.sql` (`company_memberships` 101-102) | No index on `company_memberships.role_id` (FK with ON DELETE RESTRICT), forcing seq scans on role deletion and role-scoped lookups at scale. Hot `has_permission` path is already covered by `unique(user_id, company_id)`. | `create index on core.company_memberships (role_id);` |

### Low

| Sev | Dimension | File | Issue | Recommended fix |
|---|---|---|---|---|
| Low | security | `supabase/migrations/0003_rls_and_helpers.sql` (`exchange_rates_sel` 110-112) | Platform-wide rates (`company_id IS NULL`) are invisible to non-super-admins because `NULL IN (...)` is NULL, breaking the intended "null = platform-wide" design and risking blank/wrong FX. | Add `company_id is null` to the SELECT policy (mirror the `roles` policy), or model FX rates as a globally-readable reference catalogue. |
| Low | security | `supabase/migrations/0004_functions_posting.sql` (audit loop 268-291) | Cargo tables (`assurance_reviews`, `review_snapshots`, `field_corrections`, `client_access`, `documents`) get no audit trigger, weakening the tamper-evidence story for an assurance product. | Extend the DO loop to attach `core.audit_trigger()` to the security-significant cargo tables. |
| Low | security | `supabase/migrations/0003_rls_and_helpers.sql` (`dashboard_configs_sel`, `report_exports_sel` 104-105/110-112) | SELECT policies gate on company membership only, so any member can read other members' saved dashboards and report-export params/file paths (within-tenant only). | Tighten to user-private (`user_id = auth.uid()` / `generated_by = auth.uid()` or a `reports.export` permission), or document company-wide intent. |
| Low (info) | security | `supabase/migrations/0003_rls_and_helpers.sql` (`users_sel` 146-147 via `user_in_my_company`) | Co-members can read each other's `email` and `is_super_admin`; broadcasting super-admin status aids attacker reconnaissance. | Confirm intent; expose a narrower `security_invoker` directory view (id, full_name, email) and keep `is_super_admin` off the membership read path. |
| Low | accounting | `supabase/migrations/0004_functions_posting.sql` (audit loop 268-291) | Audit trigger covers `journal_entries` but not `journal_lines`, so the pre-posting history of how balanced amounts were assembled is not auditable. | Add `accounting.journal_lines` (and ideally `invoice_lines`/`bill_lines`) to the attachment loop. |
| Low | accounting | `supabase/migrations/0002_accounting_schema.sql` (`journal_lines` fx_rate 169, base 170-171) | No CHECK forcing `fx_rate=1`/`base==txn` when a line's currency equals the company base currency; same-currency lines can post with base ≠ txn. | Compute base server-side, or add a trigger enforcing `base_debit=debit`, `base_credit=credit`, `fx_rate=1` for base-currency lines. |
| Low | cargo_engine | `src/modules/cargo-assurance/numeric.ts` (`round()` 9-13) | The single `Number.EPSILON` correction is ~64× too small at the engine's 4dp scale, so documented half-away-from-zero rounding silently rounds down on `.5` boundaries (e.g. `round(1.005,2)=1.00`), a directional bias on settlement-grade quantities. No boundary tests exist. | Use a scale-relative/relative-epsilon or decimal-based half-up implementation; add boundary tests (1.005, 0.285, 2.675, negative mirrors). |
| Low | cargo_engine | `src/modules/cargo-assurance/numeric.ts` (`round()` line 10) | `round()` passes non-finite values through unchanged; e.g. `densityFromApi(-131.5)` → `Infinity` flows into `observedVolumeToMass` producing `Infinity` tonnes with an empty flags array, contradicting "flag, never fabricate." | Have `round()` (or the SG/API conversions) return null/flag on non-finite/singular inputs, mirroring `toStandardVolume`; re-check `Number.isFinite(density15)`. Add tests for the `api=-131.5` singularity. |
| Low | cargo_engine | `src/modules/cargo-assurance/measurement.ts` (`meterQuantity` 21-26) | Rollover branch only checks `rolloverMax > 0`, not that `rolloverMax >= opening`; an inconsistent max can yield a plausible but wrong positive quantity with no flag. | Apply the rollover correction only when `rolloverMax >= opening`; otherwise leave `raw` negative so the caller flags it. Add an inconsistent-`rolloverMax` test. |
| Low (info) | cargo_engine | `src/modules/cargo-assurance/numeric.ts` (`weightedMean` 39-43) | Only guards `w === 0`; mixed-sign weights can zero/near-zero the total, returning null or a distorted mean. Only current caller filters positive weights, so safe today; exported primitive is unhardened for future use. | Ignore/reject items with `weight <= 0` and base the zero-check on the sum of used non-negative weights; document the precondition. |
| Low | performance | `src/core/session/context.ts` (`getPlatformContext` 74-83, 111-116) | After loading all memberships (which include `role_id`), a second query re-fetches `role_id` for the active company — a redundant round-trip per regular-user request. | Reuse the first query's rows; read `role_id` for `activeCompanyId` from memory. |
| Low | performance | `src/core/session/context.ts` (`getPlatformContext` serial chain 45→51→71→97→111→119) | 5-6 strictly serial Supabase round-trips per request; the `company_modules` and membership-role reads are independent once `activeCompanyId` is known and could parallelize, and the whole shape could collapse into one RPC. | Short term: `Promise.all` the independent reads. Medium term: a single `core.resolve_platform_context()` RPC. |
| Low | performance | `supabase/migrations/0002_accounting_schema.sql` (e.g. `journal_lines.tax_code_id` 172, `invoice_lines.account_id` 276; cargo `0005` doc/evidence FKs) | Several FK columns lack covering indexes, so parent updates/deletes (RESTRICT/SET NULL) and reporting/traceability joins degrade to child-table seq scans at scale. | Add indexes on the joined/integrity-checked FK columns (`invoice_lines(account_id)`, `journal_lines(tax_code_id)`, cargo `source_document_id`/`evidence_document_id`, etc.). |

## Top Recommendations (ordered by leverage)

1. **Harden the double-entry base-currency engine.** Recompute `base_debit`/`base_credit` in `post_journal_entry` (or a BEFORE trigger) from a validated `exchange_rates` lookup instead of trusting client values; add per-line CHECKs (base consistent with side, non-zero when txn is non-zero, `journal_lines_base_one_side`, and `fx_rate=1`/`base==txn` for base-currency lines); add a foreign-currency test. Fixes the critical + two high + two low accounting findings at once.
2. **Enforce journal-line tenant/account consistency** via composite FKs (or BEFORE INSERT trigger + posting check) so a line can never reference another company's account or be misattributed.
3. **Make the permission catalogue single-source-of-truth + CI-checked.** Generate seed rows, rbac constants, and `CORE_PERMISSION_KEYS` from the manifests; add a parity test; resolve the `cargo.config.manage` drift; drop the `replace('_assurance','')` category hack. This directly unblocks safe, repeatable module addition.
4. **Fix the latent schema collision now** — reassign Cargo Monitoring to its own schema before any tenant data exists, and assert all module schemas are distinct.
5. **Close the period-overlap / lock-bypass gap** with a `btree_gist` EXCLUDE constraint and an ambiguity check in `post_journal_entry`.
6. **Close the RLS visibility/disclosure gaps** (platform `exchange_rates`, user-private dashboards/exports, co-member `is_super_admin` disclosure).
7. **Extend audit coverage** to `journal_lines` and the cargo governance tables.
8. **Fix engine numeric correctness** — replace the `EPSILON` rounding hack, flag non-finite results instead of fabricating, add boundary tests.
9. **Bound the cargo rules-engine** (depth/node-count limits + `RangeError`→`RuleEvaluationError`) before it is fed untrusted client procedures.

## Strengths / What's Solid

- **No cross-tenant breach found.** Tenant isolation via `company_id` membership holds across the schema; external/client-portal access is modelled as *additive* grant roles that never weaken tenant RLS (`0006`).
- **Hardened helper functions.** All RLS helpers are `SECURITY DEFINER` with `set search_path = ''` and fully-qualified names, preventing search_path injection (`0003` lines 13-56).
- **Correct view hardening.** `general_ledger` and `published_reviews` are `security_invoker = true`, so underlying RLS applies — a subtle, correct Postgres 15+ choice.
- **Posted-entry immutability at the DB layer.** Guard triggers on both header and lines reject mutation of posted entries; corrections are forced through reversing entries (`0004` lines 187-232). The GL is a derived view over posted lines only, keeping the journal as the single source of truth.
- **Strong dual-currency balance gate.** `post_journal_entry` validates both transaction- and base-currency aggregate balance — stronger than typical single-currency checks (the gaps above are about per-line trust, not the aggregate gate).
- **Data-driven, least-privilege permission model.** Read = membership, write = `core.has_permission` against a catalogue; SELECT policies already use the cached `(select core.user_companies())` InitPlan form; idempotent seed (`on conflict do nothing`); typed rbac constants.
- **Configurable, no hard-coded tax rates;** per-company number sequences serialized via `UPDATE ... RETURNING` row locking.
- **Clean extensibility backbone.** `registry.ts` is pure, DB-free, unit-testable TypeScript; the framework doc itself surfaces the drift question as an open item, showing the coupling is consciously tracked rather than hidden.
- **Cargo engine designed for safe evaluation** — no `eval`, whitelisted operators, div-by-zero and non-finite guards already present (the findings are about completing those guards, not introducing them).
