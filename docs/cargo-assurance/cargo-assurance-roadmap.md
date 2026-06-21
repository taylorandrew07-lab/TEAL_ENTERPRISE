# Cargo Assurance Roadmap

**TEAL Enterprise — Cargo Assurance Module**
Owning agent: Orchestrator Agent
Status: Draft v1 — 2026-06-20

**Purpose.** This is the phased build plan for the Cargo Assurance module — the second module proving the platform framework. It sequences foundation-first work (schema → RLS → engine → analytics → dashboards → hardening), maps every spec acceptance criterion to the phase that delivers it, and specifies the one sanctioned demonstration seed. It conforms to `_CARGO-SPEC.md` (the module spec, especially §9 the acceptance spine), `../platform-module-framework.md` §9 (the add-a-module playbook), and `../master-roadmap.md` (foundation-first cycle and the Supabase provisioning block). It is the index the Orchestrator consults at the start of every Cargo Assurance cycle.

---

## 1. Guiding order of construction

The module is built **foundation-first**, never UI-first, exactly mirroring the platform order and the `_CARGO-SPEC.md` §9 acceptance spine:

```
Docs  →  cargo schema + RLS migrations  →  manifest/registry/seed/types
   →  Ingestion + extraction + data-review workspace
   →  Calculation engine (3 layers) + comparison + hire periods
   →  Aggregation / analytics / findings
   →  Dashboards + client reporting + published snapshots + client portal
   →  Hardening + the sanctioned demonstration review
```

A feature is "done" only when it is **documented, migrated, RLS-secured, and validated** (calculation correctness + cross-tenant + cross-client isolation) per `../testing-strategy.md` and the invariants in `_CARGO-SPEC.md` §7. Each phase below lists its deliverables, its dependencies, and the acceptance items it satisfies.

---

## 2. Architecture pack — Cycle 0 (COMPLETE)

The Cargo Assurance architecture pack is authored and authoritative. Every migration and every line of module code must conform to it.

| Document | Owning agent | Status |
| --- | --- | --- |
| [_CARGO-SPEC.md](_CARGO-SPEC.md) — authoritative module spec | Orchestrator | ✅ Done |
| [cargo-data-model.md](cargo-data-model.md) — column-level DDL, enums, ERD, RLS shape | Data-Model Agent | ✅ Done |
| [cargo-ingestion-and-extraction.md](cargo-ingestion-and-extraction.md) — upload, classify, extract, trace, validate | Ingestion Agent | ✅ Done |
| [cargo-calculation-engine.md](cargo-calculation-engine.md) — three layers, comparison, hire balance, sign convention | Calculation Agent | ✅ Done |
| [cargo-aggregation-and-analytics.md](cargo-aggregation-and-analytics.md) — period roll-up, meter bias, waterfalls, findings | Analytics Agent | ✅ Done |
| [cargo-dashboards-and-reporting.md](cargo-dashboards-and-reporting.md) — internal dashboards, client report, snapshots, portal | Dashboard/Reporting Agent | ✅ Done |
| [cargo-security-and-multitenancy.md](cargo-security-and-multitenancy.md) — RLS, client portal access, isolation | Security Agent | ✅ Done |
| [cargo-assurance-roadmap.md](cargo-assurance-roadmap.md) — this document | Orchestrator | ✅ Done |

> The pack documents the full module. The phases below turn it into migrations, code, and a published review. Nothing in the pack is hard-coded to a single client; ExxonMobil appears only as a worked example and in the demonstration seed (§6).

---

## 3. Phased build plan

Each phase follows the `platform-module-framework.md` §9 playbook order (manifest/registry/migrations → seed → constants → domain code → routes → tests → roadmap update) and is gated on the dependencies stated. Status keys: ✅ Done · 🟦 Authored (no live DB) · ⏳ Pending DB · ☐ Not started.

### P0 — Foundation (cargo schema, RLS, manifest, registry, seed, types)

**Theme.** Make the `cargo` module a registered, schema-isolated, RLS-secured citizen of the platform core. This phase can be **fully authored now** without Supabase; only the live execution is blocked.

**Deliverables**
- `supabase/migrations/0005_cargo_schema.sql` — the `cargo` schema: all enum types (`document_type`, `measurement_method`, `tank_role`, `exception_type`), all canonical tables from `_CARGO-SPEC.md` §6 / `cargo-data-model.md`, plus derived **views** for aggregates. Touches only the `cargo` schema. 🟦
- `supabase/migrations/0006_cargo_rls.sql` — RLS on every `cargo` table using core helpers (`core.user_companies()`, `core.has_permission()`), plus the **additive client-portal** policies keyed on `cargo.client_access` that only widen read access to a client's **own published** snapshots, never broadening tenant data. 🟦
- `src/core/modules/manifests/cargo_assurance.ts` — manifest (key `cargo_assurance`, route `/cargo-assurance`, schema `cargo`, navigation per `_CARGO-SPEC.md` §2, the §3 permission catalogue, settings schema), registered in `src/core/modules/registry.ts`. 🟦
- Seed additions to `supabase/seed/seed.sql` — `core.modules` row for `cargo_assurance`; the `cargo.*` permission rows (category `cargo`, from §3); the five module roles (`ca_admin`, `ca_analyst`, `ca_reviewer`, `ca_client_admin`, `ca_client_viewer`) and their `core.role_permissions` grants. 🟦
- Permission-key constants mirrored in `src/modules/cargo-assurance/` (or shared) for UI gating. 🟦
- TypeScript types regenerated (`npm run db:types`) once the schema runs. ⏳
- **Calculation rule unit tests in TS** authored now against the §7 invariants (variance sign, non-receiving tank ⇒ 0 corrected, internal transfers net to zero, meter rollover, hire balance, percentages-never-summed) using fixtures — runnable without a DB. 🟦

**Dependencies.** Platform core migrations `0001`–`0004` and seed (authored in Cycle 1). Live execution depends on **Supabase provisioning (blocked, §5)**; migration ordering is fixed at `0005`→`0006` per `platform-module-framework.md` §6.

**Acceptance satisfied.** AC-1, AC-2 foundations (schema isolation, RLS, three-layer table shape, version-pinning columns present). Enables every later phase.

---

### P1 — Ingestion, extraction & data review

**Theme.** Bulk-upload at period end; classify, extract, trace, validate; reconstruct loadouts; surface exceptions and low-confidence in a spreadsheet workspace. Per `cargo-ingestion-and-extraction.md`.

**Deliverables**
- Create-review → select client/period/procedure flow (`cargo.assurance_reviews`, pinning `procedure_id` + `methodology_id`).
- Bulk import: `cargo.import_batches` + `cargo.documents` (original filename, checksum, type, batch, uploader, timestamp, client, detected type, raw + normalized extraction) — **documents never deleted**; duplicate detection by checksum; archive expansion via `parent_archive_id`.
- Classification + extraction into `cargo.extracted_fields` with full **source traceability** (page/table/cell/worksheet) and `confidence`; `cargo.extraction_templates` drive configurable extraction.
- Automatic **loadout reconstruction** (`cargo.loadouts` + `cargo.loadout_documents`, a document maps to at most one loadout — no double counting); hire-period certificates use the **same** pipeline (`cargo.hire_periods` + `cargo.hire_period_documents`).
- **Never invent a value:** missing/uncertain marked, not estimated; `cargo.data_exceptions` queue populated (`missing_reading`, `unmatched_document`, `duplicate_certificate`, `low_confidence`, …).
- **Data Review spreadsheet workspace**: review/correct exceptions and low-confidence fields; `cargo.field_corrections` preserve original + corrected, never silently altering approved reviews.
- Routes under `app/(cargo-assurance)/` for Import Documents and Data Review, gated by `cargo.documents.upload`, `cargo.extraction.correct`, `cargo.data.review`.

**Dependencies.** P0 (schema, RLS, types). Supabase Storage for files. Live ingestion needs the DB (§5); template config and extraction-mapping logic can be unit-tested against fixtures now.

**Acceptance satisfied.** AC-3, AC-4, AC-5, AC-6, AC-13 (originals preserved, traceability, no invented values, loadout grouping without double counting, exception queue, data-review corrections).

---

### P2 — Calculation engine, comparison & hire periods

**Theme.** Produce the three result layers, compare all measurement methods, and reconcile hire periods. Per `cargo-calculation-engine.md` and `_CARGO-SPEC.md` §7.

**Deliverables**
- Versioned **rules engine** (safe, whitelisted rule-tree AST — no `eval`, no client code) reading pinned `cargo.client_procedures.config` and `cargo.calculation_methodologies.formula_rules`; golden-fixture tested before any version goes `active`.
- `cargo.loadout_measurements` per method (raw → normalized → calculated, original + converted units, `formula_version`, `included` flag without deleting evidence).
- **Three layers** written as three `cargo.loadout_results` rows: `raw_evidence`, `client_procedure`, `taylor_corrected`, each stamping `methodology_version`; inter-layer differences traceable.
- **Tank-role reconciliation** (`cargo.loadout_tank_readings`): non-receiving tank ⇒ `corrected_receipt_difference = 0` unless documented transfer, delta recorded as **procedural effect**; day/service reductions classified as consumption (`cargo.consumption_records`), never delivery shortage; internal transfers (`cargo.internal_transfers`) net to zero.
- **Comparison/variance** with the single sign convention (`variance = comparison − reference`, positive ⇒ comparison reports more), configurable reference method; claimed-over-received, procedural apparent loss, unexplained residual per §7. Meter qty and shore-delivery formulas with documented rollover/calibration/adjustments. Drift waterfall components in `cargo.loadout_adjustments`.
- **Hire-period balance** (`cargo.hire_tank_readings`, `cargo.hire_period_results`): `expected_off_hire_rob = on_hire_rob + fuel_received − verified_consumption − external_discharged + other_adjustments`; variance = actual − expected; with incomplete evidence show only the verified on→off change — **no inferred loss**.

**Dependencies.** P0 + P1 (extracted, reconstructed loadouts and pinned procedure/methodology versions). The TS rule library (started in P0) is the deliverable's core and is unit-testable without a DB.

**Acceptance satisfied.** AC-7, AC-8, AC-9, AC-10, AC-11, AC-14 (three layers, versioned rules, comparison + sign convention, non-receiving/day-tank/transfer handling, hire reconciliation, percentages never summed / units preserved).

---

### P3 — Aggregation, analytics & findings

**Theme.** Roll the whole period up; detect procedural drift, recurring directional variance and persistent per-meter bias; generate neutral findings. Per `cargo-aggregation-and-analytics.md`.

**Deliverables**
- `cargo.review_aggregates` period-level totals (also via views); **percentages computed from aggregated quantities / correctly weighted averages, never summed**.
- `cargo.meter_analytics` per **physical** meter (tracked independently across replacements): mean/median/weighted variance %, stddev, cumulative variance, `same_direction_pct` — the persistent directional-bias signal.
- Period drift waterfall from `cargo.loadout_adjustments`; aggregated procedural effect across the review.
- `cargo.findings` with **neutral, defensible language**: no theft/fraud/tampering allegations without independently verified evidence; no strong trend conclusion below the configurable minimum sample size; every finding carries `supporting_record_ids`, `sample_size`, `comparison_method`, `reference_method`, tolerance, and data-quality notes.

**Dependencies.** P2 (loadout results, adjustments, hire results). Aggregation math is unit-testable against fixtures now.

**Acceptance satisfied.** AC-12, AC-15, AC-16 (period aggregation without summing percentages, persistent per-meter directional-variance detection, neutral findings with sample-size guardrails).

---

### P4 — Dashboards, client reporting, published snapshots & client portal

**Theme.** Internal analysis dashboards; reviewer approve & publish; reproducible snapshot; external client read-only portal. Per `cargo-dashboards-and-reporting.md` and `cargo-security-and-multitenancy.md`.

**Deliverables**
- Internal Portfolio Overview / Analysis dashboards over the aggregates and findings.
- **Reviewer approve & publish** workflow (`cargo.assurance_reviews` status `reviewed → approved → published`; `approved_by/at`, `published_by/at`), gated by `cargo.reviews.publish`.
- **Reproducible published snapshot** `cargo.review_snapshots` (`(review_id, version)` unique, `snapshot jsonb`, report PDF + XLSX paths via the core reporting/export framework); later corrections create a **new version**, never silently changing a published report.
- **Client portal**: external `ca_client_admin` / `ca_client_viewer` see **only published** snapshots for **their** `client_id`, via the additive `cargo.client_access` RLS policies. Client report download (`cargo.reports.view` / `cargo.reports.export` / `cargo.client.view`).
- Routes for Client Reports and the client-facing dashboard under `app/(cargo-assurance)/`.

**Dependencies.** P3 (aggregates + findings to publish). Live portal and snapshot generation need the DB and Storage (§5). **Cross-client isolation tests are mandatory** before any portal route is considered done.

**Acceptance satisfied.** AC-17, AC-18, AC-19, AC-20 (approve/publish, reproducible versioned snapshots, client read-only of own published data, strict cross-client isolation).

---

### P5 — Hardening & the sanctioned demonstration review

**Theme.** Security/performance hardening, full test matrix, and load the **one sanctioned demonstration review** (§6) end-to-end as the final acceptance proof.

**Deliverables**
- Full test matrix per `../testing-strategy.md`: calculation correctness (every §7 invariant), cross-tenant isolation, **cross-client isolation**, extraction-confidence handling, snapshot reproducibility.
- Performance pass on bulk import + period aggregation for a 12-month volume.
- Audit coverage check: every state-changing `cargo` table writes `core.audit_logs` with `entity_schema = 'cargo'`.
- **Seed the demonstration review** (§6) — clearly labelled, segregated demonstration data — and walk it through the complete `_CARGO-SPEC.md` §9 spine (create → upload → extract → reconstruct → review exceptions → engine → aggregate → findings → approve/publish → client portal).
- Update `../master-roadmap.md` and `../../HANDOFF.md`.

**Dependencies.** P0–P4 complete; a live DB (§5).

**Acceptance satisfied.** AC-21 (the demonstration review reproduces the ExxonMobil-style 12-month scenario, including the non-receiving-tank procedural-effect example) plus regression confirmation of AC-1…AC-20.

---

## 4. Acceptance-criteria → phase checklist

The criteria below are the `_CARGO-SPEC.md` §9 acceptance spine, expanded into testable items. Each maps to the phase that delivers it.

| # | Acceptance criterion (from `_CARGO-SPEC.md` §9 + principles §4/§7) | Phase |
| --- | --- | --- |
| AC-1 | `cargo` schema isolated; tenant scoping (`company_id`) on every table; manifest/registry/seed register the module | P0 |
| AC-2 | RLS on every table via core helpers; additive client-portal policies never weaken tenant isolation | P0 (+P4 portal) |
| AC-3 | Create review → select client / period / procedure; procedure + methodology **version pinned** | P1 |
| AC-4 | Bulk upload; original document **never discarded** (filename, checksum, type, batch, uploader, time); duplicates by checksum | P1 |
| AC-5 | Classify + extract with **source traceability** (page/table/cell/worksheet) and confidence | P1 |
| AC-6 | Loadouts reconstructed automatically; a document maps to ≤1 loadout (**no double counting**); hire certs use the same pipeline | P1 |
| AC-7 | **Three result layers** (raw evidence / client procedure / Taylor corrected) computed and never overwriting raw evidence | P2 |
| AC-8 | **Versioned rules engine**; no arbitrary client code; golden-fixture tested before `active` | P2 |
| AC-9 | Compare all measurement methods; one **sign convention**; configurable reference; claimed-over-received / procedural apparent loss / unexplained residual | P2 |
| AC-10 | Non-receiving tank ⇒ corrected diff 0, delta = procedural effect; day/service ⇒ classified consumption; internal transfers net to zero | P2 |
| AC-11 | Hire-period reconciliation; with incomplete evidence show only verified on→off change — **no inferred loss** | P2 |
| AC-12 | Aggregate across the whole period; **percentages never summed** (computed from quantities / weighted) | P3 |
| AC-13 | Exception queue + **never invent a value** (missing/uncertain flagged); data-review corrections preserve original + corrected | P1 |
| AC-14 | Units preserved with conversions stored separately; never assume temperature/density the source lacks — flag it | P2 |
| AC-15 | Persistent **directional variance / per-physical-meter bias** detected across the period | P3 |
| AC-16 | **Neutral, defensible findings**; no fraud allegations without verified evidence; minimum-sample guardrail | P3 |
| AC-17 | Reviewer **approve & publish** workflow | P4 |
| AC-18 | **Reproducible snapshot**; corrections create a new version, never silently changing a published report | P4 |
| AC-19 | Client gets read-only **published** dashboard + downloadable report for **their** client only | P4 |
| AC-20 | **Strict cross-client isolation** — a client never sees another client's documents/calcs/findings/reports | P4 (tested P5) |
| AC-21 | End-to-end **demonstration review** reproduces the 12-month ExxonMobil-style scenario incl. the 17.0→16.6 m³ example | P5 |

---

## 5. Supabase dependency & what can be built now

**Blocked.** Live Supabase provisioning is **on hold pending internal approvals/budget** (`../master-roadmap.md` §7; resume steps in `../../HANDOFF.md` §5). No paid resource is created before approval. This blocks: executing `0005`/`0006`, generating live TS types, live ingestion/Storage, the portal, snapshot generation, and the seeded demonstration walk-through.

**Buildable now without Supabase** (the integration backbone and the defensible math are verifiable today):
- `0005_cargo_schema.sql` and `0006_cargo_rls.sql` **authored** (reviewed against `cargo-data-model.md`), ready to run the moment the DB exists.
- The **manifest** (`cargo_assurance.ts`) + **registry** entry + **seed** rows (module, permissions, roles, grants) — pure data/TypeScript, unit-testable without a DB (`platform-module-framework.md` §5).
- Permission-key constants for UI gating.
- The **versioned calculation rules library in TypeScript, fully unit-tested** against `_CARGO-SPEC.md` §7 invariants with golden fixtures (variance sign, non-receiving-tank procedural effect, internal-transfer netting, meter rollover, mass balance, hire balance, percentages-never-summed). This is the highest-value pre-DB work — it de-risks P2 entirely.
- All Cargo Assurance docs (this pack) kept current.

When provisioning is approved, the first Fuel cycle is: run `0005`+`0006`, run the seed delta, regenerate types, then execute the RLS isolation + calculation test suites against the live DB before any UI work.

---

## 6. Seed demonstration plan (the one sanctioned exception to no-demo-data)

> **SANCTIONED EXCEPTION.** TEAL's standing rule is **no demo/sample data in the platform.** This demonstration review is the **single explicit exception**, because reproducing it is an **acceptance requirement** (`_CARGO-SPEC.md` §9, AC-21). It MUST be **clearly labelled and segregated as demonstration data** — its own demonstration company/client, an unmistakable title (e.g. "DEMONSTRATION — not a client review"), and a `is_demonstration`/equivalent marker — and **must never be mixed into a real client's production review** or counted in any real client's analytics. It exists only to prove the end-to-end spine works on a realistic dataset.

**Scenario.** A realistic **12-month, ExxonMobil-style** assurance review for the demonstration client, exercising every pipeline and every invariant:

- **Multiple vessels, terminals and physical meters** — several vessels loading across more than one terminal/berth, with **vessel flow meters** and **shore flow meters** as distinct **physical** meters (so per-meter bias analytics, P3, have something to find), including at least one **meter replacement** mid-period to prove physical-meter continuity.
- **Receiving and non-receiving tanks** on the vessels, plus **day/service-tank consumption** during loadouts (classified consumption, never delivery shortage).
- **FuelTrax reports**, **vessel sounding certificates**, and **shore (terminal) meter readings** as independent measurement methods to compare.
- **Missing-document exceptions** — some loadouts deliberately lack a certificate or a reading so the exception queue, "never invent a value," and the data-review workspace are exercised.
- A **persistent terminal-meter directional variance** — one shore meter consistently reads in the same direction across many loadouts, so `cargo.meter_analytics.same_direction_pct` and the directional-variance / persistent-bias finding (AC-15) trigger above the minimum sample size.
- **The non-receiving-tank worked example:** a non-receiving tank reads **17.0 → 16.6 m³**. The **client procedure** result includes the **−0.4 m³** in its reported figure; **Taylor's corrected reconciliation assigns 0.0** (no documented transfer), and records the **−0.4 m³ as a procedural effect** aggregated across the review. This single record proves the three-layer divergence (AC-7), the tank-role rule (AC-10), and the procedural-drift aggregation (AC-12).
- **At least one hire period** (on-hire / off-hire) with complete evidence (full balance) and **one with incomplete evidence** (verified on→off change only, **no inferred loss**) to prove AC-11.

**How it is run.** In P5, this dataset is uploaded through the **real** `_CARGO-SPEC.md` §9 spine — bulk import → classify/extract → reconstruct → review exceptions → engine (three layers) → aggregate → findings → reviewer approve & publish → client portal — producing a published, reproducible snapshot. Nothing about the demonstration bypasses the production pipeline; only the **data** is labelled demonstration.

---

## 7. Open Questions

1. **Demonstration marker mechanism.** Is segregation best expressed as a dedicated demonstration `core.companies` tenant, a demonstration `core.clients` row, an `is_demonstration` boolean on `cargo.assurance_reviews`, or all three? (Default: a demonstration company + an unmistakable review title + a boolean flag, so it can never co-mingle with production analytics.)
2. **Demonstration document corpus.** Do we synthesise the 12-month certificate/report set, or anonymise and clearly relabel a historical real set? Whichever is chosen, it must carry no real client identity and be marked demonstration.
3. **Reference-method default for the demo (and platform).** Should the demo procedure ship the proposed default precedence (FuelTrax > shore meter > shore tank) or force an explicit choice? (Inherited open question from `cargo-calculation-engine.md`.)
4. **Manifest ↔ `core.permissions` parity.** Do we add the CI check (raised in `platform-module-framework.md` §12) before P0 is marked done, so the `cargo.*` permission list can't drift from the seed?
5. **Supabase resume timing.** All live phases depend on the provisioning unblock (§5); the open question is only *when*, not *whether* — see `../../HANDOFF.md` §5.

## 8. Decisions Locked

1. **Foundation-first, same order as the platform:** docs → `cargo` schema + RLS → manifest/registry/seed/types → ingestion → engine → analytics → dashboards/portal → hardening. A feature is done only when documented, migrated, RLS-secured, and validated.
2. **Migration ordering is fixed:** `0005_cargo_schema` then `0006_cargo_rls`, touching only the `cargo` schema and appending to shared seed — never altering core or accounting (`platform-module-framework.md` §6/§9).
3. **The integration backbone and calculation math are built now, DB or not:** manifest/registry/seed authored; schema/RLS authored; the versioned rules engine unit-tested in TypeScript against the §7 invariants before any live run.
4. **Strict isolation is non-negotiable from the first migration:** tenant isolation via core helpers on every table; the additive `cargo.client_access` portal policies only widen read access to a client's own **published** snapshots; cross-tenant **and** cross-client isolation tests gate P4.
5. **Published reports are reproducible:** snapshots are versioned and immutable; corrections create a new version, never silently changing a published report.
6. **One sanctioned demonstration review only:** the 12-month ExxonMobil-style seed (incl. the 17.0→16.6 m³ procedural-effect example) is the sole exception to no-demo-data, clearly labelled and segregated, never mixed with a real client's production review — and it is run through the real §9 pipeline, not a bypass.

---

*Cross-references: `_CARGO-SPEC.md` (authoritative module spec, §9 acceptance spine), `../platform-module-framework.md` (§9 add-a-module playbook), `../master-roadmap.md` (foundation-first cycle, Supabase block), `cargo-data-model.md`, `cargo-ingestion-and-extraction.md`, `cargo-calculation-engine.md`, `cargo-aggregation-and-analytics.md`, `cargo-dashboards-and-reporting.md`, `cargo-security-and-multitenancy.md`, `../testing-strategy.md`, `../../HANDOFF.md`.*
