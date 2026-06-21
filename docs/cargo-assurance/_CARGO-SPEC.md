# TEAL Cargo Assurance — Authoritative Module Spec (internal working reference)

> Single source of truth for the Cargo Assurance module. Every Cargo Assurance document and every
> migration must conform to the names, types, principles, and invariants below.
> Status: Draft v1 — 2026-06-17. Owner: Orchestrator Agent.
> Parent platform spec: [../_ARCHITECTURE-SPEC.md](../_ARCHITECTURE-SPEC.md) (conform to it; this
> spec only adds the `cargo` module on top of the platform core).

---

## 1. Product position

TEAL Cargo Assurance is a **separate module inside TEAL Enterprise**, peer to the Accounting module.
It is **not** a standalone app. It reuses the platform core: companies (tenants), users, RBAC,
`core.clients`, Supabase Auth, Storage, audit logging, RLS, and reporting/export conventions.
Accounting must continue to work unchanged; Cargo Assurance domain logic lives in its own `cargo`
Postgres schema and `src/modules/cargo-assurance/` code, never mixed into Accounting.

- Route: `/cargo-assurance`
- Module key (core.modules): `cargo_assurance`
- Owning company (example): **Taylor Engineering Limited** (a `core.companies` tenant).
- A **Client** (e.g. ExxonMobil) is a `core.clients` row scoped to that company.

### Scope: all liquid bulk cargo (not fuel only)
The module handles **any liquid bulk cargo** — fuels and gasoil, gasoline, jet, crude, lube/base
oils, bitumen, vegetable oils, and liquid chemicals (methanol, ethanol, caustic soda, molasses, …),
plus **vessel bunker on/off-hire surveys** (where the measured liquid is the vessel's own fuel). Each
review/loadout carries a **cargo type** (`cargo.cargo_types`) and a **quantity basis** — volume or
**mass (metric tonnes)** — because many liquid cargoes settle by weight. Mass is derived from density
(from specific gravity or API) and standard volume; see §6a and §7. "Fuel" appears throughout as the
worked example because the first reviews are fuel, but nothing in the engine is fuel-specific.

### Core purpose (read this before designing anything)
A **retrospective, batch analytical and reporting system**, NOT an everyday operational data-entry
app. Over a 6- or 12-month period Taylor performs hundreds of cargo loadouts. At period end,
administrators **bulk-upload** the accumulated certificates/reports/spreadsheets; the system
**extracts**, **reconstructs each loadout automatically**, applies the **client's reporting logic**
and **Taylor's corrected reconciliation logic**, **compares all measurement methods**, **aggregates
across the whole period**, identifies **procedural drift and recurring directional variance**, and
produces a **client dashboard + assurance report**. The primary experience is the **review period**,
not creating individual daily operations.

## 2. Primary record: the Assurance Review

The **top-level record is `cargo.assurance_reviews`**. Individual loadouts exist only as automatically
extracted, auditable records beneath a review. **"New Loadout" is NOT a primary navigation item.**

Initial navigation (top level): Portfolio Overview · Assurance Reviews · Import Documents ·
Data Review · Analysis · Client Reports · Clients & Procedures · Terminals, Vessels & Meters ·
Calculation Methods · Cargo Assurance Settings.

## 3. Roles & access (data-driven, extends core RBAC)

Five module roles (seeded as system roles or as company roles via the existing RBAC tables):

| Role key | Name | Nature |
| --- | --- | --- |
| `ca_admin` | TEAL Cargo Assurance Administrator | Internal (Taylor) full module control |
| `ca_analyst` | TEAL Cargo Assurance Analyst | Internal: upload, validate, analyse |
| `ca_reviewer` | TEAL Reviewer/Publisher | Internal: approve & publish |
| `ca_client_admin` | Client Administrator | External: read-only + manage own client's viewers |
| `ca_client_viewer` | Client Viewer | External: read-only published dashboards/reports |

- **No surveyor role / no surveyor workflow** in the initial release.
- **Strict multi-tenant + multi-client isolation:** a client must NEVER see another client's
  documents, calculations, findings, or reports. Client users see **only published** snapshots for
  **their** `client_id`.
- Client portal access is modelled by `cargo.client_access(client_id, user_id, role)` — the security
  doc is authoritative. Internal users are scoped by `core.company_memberships` as usual.

### Permission keys (added to core.permissions, category `cargo`)
`cargo.reviews.manage`, `cargo.reviews.review`, `cargo.reviews.publish`, `cargo.documents.upload`,
`cargo.extraction.correct`, `cargo.data.review`, `cargo.config.manage` (procedures/templates/methods),
`cargo.assets.manage` (terminals/vessels/meters), `cargo.reports.view`, `cargo.reports.export`,
`cargo.client.view` (external read-only of own client's published reviews).

## 4. Non-negotiable principles

1. **Never discard the original document.** Store original filename, checksum, type, batch, uploader,
   timestamp, client, detected type, extraction status/confidence, source references, raw + normalized
   values, validation status.
2. **Never invent a missing value.** Mark missing / uncertain / requiring review. Never present an
   estimate as a measured fact.
3. **Source traceability:** every extracted value links to its source document + page/table/cell/
   worksheet wherever technically possible.
4. **Three result layers, never overwrite raw evidence:**
   - **Raw Evidence** — what the certificates/reports actually recorded.
   - **Client Procedure Result** — the client's configured reporting methodology.
   - **Taylor Corrected Reconciliation Result** — Taylor's defensible receipt/mass-balance method.
   Every difference between layers must be traceable and explainable.
5. **No hard-coded client procedures** (e.g. ExxonMobil). Procedures are versioned templates.
   Historical reviews keep the template/methodology **version** used when calculated.
6. **No arbitrary client-written code** for formulas — a safe, tested, **versioned rules engine**.
7. **Published reports are reproducible** — a snapshot is preserved; later corrections create a new
   version, never silently changing a published report.
8. **Batch-analysis focus**; out of scope initially: daily surveyor entry, live capture, real-time
   monitoring, mobile survey forms, scheduling, surveyor assignment, client entry of raw readings.
9. **Neutral, defensible findings language** — never allege theft/fraud/tampering without
   independently verified evidence; no strong trend conclusions below a configurable minimum sample.

## 5. Platform conventions inherited (from the core spec)

- Schema: new Postgres schema **`cargo`** (exposed to PostgREST). Code in `src/modules/cargo-assurance/`.
- PKs `uuid default gen_random_uuid()`. Every tenant table has
  `company_id uuid not null references core.companies(id)`.
- `created_at/updated_at timestamptz`, `created_by/updated_by uuid references core.users(id)`.
- Money `numeric(20,4)`; **fuel quantities `numeric(20,4)`** with explicit `unit`.
- RLS enabled on every table; reuse `core.user_companies()` / `core.has_permission()`; add client-
  portal policies. Audit via `core.audit_logs` with `entity_schema = 'cargo'`.
- Files stored in Supabase Storage; `cargo.documents` is the module's authoritative ingestion record
  (may also register a `core.documents` row with `owner_module='cargo_assurance'`).

## 6. Canonical `cargo` schema (authoritative names)

> Enums shown as `enum[...]`; implement as native Postgres enum types in schema `cargo`.

### Configuration & reference
- `cargo.client_procedures(id, company_id, client_id→core.clients, name, version int, status enum[draft,active,archived], config jsonb, required_documents jsonb, measurement_methods jsonb, tolerances jsonb, terminology jsonb, effective_from date, created_by, created_at, updated_at)` — versioned client procedure templates. **(client_id, version)** identifies a pinned version.
- `cargo.calculation_methodologies(id, company_id, key, name, version int, description, formula_rules jsonb, status enum[draft,active,archived], created_by, created_at)` — Taylor corrected methodology versions (versioned rules engine config).
- `cargo.extraction_templates(id, company_id, client_id null, document_type cargo.document_type, name, version int, status, field_map jsonb, table_structures jsonb, unit_mappings jsonb, date_formats jsonb, validation_rules jsonb, confidence_thresholds jsonb, created_by, created_at)` — configurable extraction.
- `cargo.terminals(id, company_id, client_id null, name, code, location, berths jsonb, is_active, created_at)`
- `cargo.vessels(id, company_id, name, imo, default_client_id null, is_active, created_at)`
- `cargo.vessel_tanks(id, company_id, vessel_id, name, default_role cargo.tank_role, capacity numeric(20,4), unit, is_active)` — per-loadout role may differ; stored on the reading.
- `cargo.meters(id, company_id, meter_type enum[vessel_flow,shore_flow], physical_id, name, terminal_id null, vessel_id null, calibration_factor numeric, calibration_date date, replaced_by_meter_id null, is_active, created_at)` — physical meters tracked independently for bias analytics.
- `cargo.products(id, company_id, name, grade, default_density numeric, default_api numeric, is_active)`

### Reviews
- `cargo.assurance_reviews(id, company_id, client_id, title, start_date, end_date, reporting_currency char(3) null, procedure_id→client_procedures, methodology_id→calculation_methodologies, included_terminals uuid[], included_vessels uuid[], included_products uuid[], status enum[draft,in_review,reviewed,approved,published], notes, created_by, created_at, updated_at, approved_by, approved_at, published_by, published_at)`
- `cargo.review_snapshots(id, review_id, company_id, version int, snapshot jsonb, report_pdf_path, report_xlsx_path, created_by, created_at)` — reproducible published snapshot; (review_id, version) unique.

### Ingestion
- `cargo.import_batches(id, company_id, review_id, status enum[uploaded,processing,completed,failed,cancelled], file_count int, processed_count int, failed_count int, created_by, created_at, updated_at)`
- `cargo.documents(id, company_id, review_id, batch_id, client_id, original_filename, checksum text, file_type, storage_path, page_count, uploaded_by, uploaded_at, detected_document_type cargo.document_type, classification_confidence numeric, extraction_status enum[pending,processing,extracted,needs_review,failed], extraction_confidence numeric, raw_extraction jsonb, normalized_extraction jsonb, validation_status enum[pending,valid,invalid,needs_review], parent_archive_id null, created_at)` — **never deleted**; duplicates detected by checksum.
- `cargo.extracted_fields(id, company_id, document_id, field_key, raw_value, normalized_value, unit, confidence numeric, source_page int, source_table text, source_cell text, source_worksheet text, status enum[ok,missing,uncertain,needs_review], created_at)`
- `cargo.field_corrections(id, company_id, extracted_field_id, original_value, corrected_value, reason, corrected_by, corrected_at)` — preserve original + corrected; never silently alter approved reviews.

### Loadouts & measurements
- `cargo.loadouts(id, company_id, review_id, client_id, vessel_id, terminal_id, berth, certificate_number, loadout_date, start_time, completion_time, product_id, nominated_quantity numeric(20,4), reported_delivered_quantity numeric(20,4), unit, match_confidence numeric, status enum[extracted,needs_review,approved,excluded], exclusion_reason, created_by, created_at, updated_at)` — reconstructed automatically.
- `cargo.loadout_documents(loadout_id, document_id unique, company_id, role)` — grouping; a document maps to at most one loadout (prevents double counting).
- `cargo.loadout_tank_readings(id, company_id, loadout_id, vessel_tank_id, tank_role cargo.tank_role, received_flag bool, opening_sounding numeric, closing_sounding numeric, opening_quantity numeric(20,4), closing_quantity numeric(20,4), unit, temperature numeric, density numeric, api_gravity numeric, std_volume_basis enum[none,at_15c,at_60f], raw_difference numeric(20,4), corrected_receipt_difference numeric(20,4), procedural_effect numeric(20,4), explanation, source_document_id, confidence)` — non-receiving tank ⇒ corrected_receipt_difference 0 unless documented transfer.
- `cargo.loadout_measurements(id, company_id, loadout_id, method cargo.measurement_method, raw_values jsonb, normalized_values jsonb, calculated_quantity numeric(20,4), original_unit, converted_unit, formula, formula_version, source_document_id, confidence, included bool, exclusion_reason)`
- `cargo.loadout_results(id, company_id, loadout_id, layer enum[raw_evidence,client_procedure,taylor_corrected], quantity numeric(20,4), unit, basis, details jsonb, methodology_version, created_at)` — the three layers.
- `cargo.loadout_adjustments(id, company_id, loadout_id, type enum[non_receiving_tank,consumption,internal_transfer,temperature_density,meter_correction,other], quantity numeric(20,4), supported_by enum[fueltrax,engine_log,duration_rate,client_approved,documented_transfer,none], evidence_document_id, explanation, created_at)` — drift waterfall components.
- `cargo.internal_transfers(id, company_id, loadout_id, from_tank_id, to_tank_id, quantity numeric(20,4), unit, source_document_id, matched bool)` — net to zero across affected tanks.
- `cargo.consumption_records(id, company_id, loadout_id null, hire_period_id null, classification enum[documented,estimated,unsupported,unexplained], quantity numeric(20,4), unit, source enum[fueltrax,engine_log,duration_rate,client_approved,other], evidence_document_id, explanation)` — never present estimate as measured.

### Hire periods (on-hire / off-hire reconciliation)
- `cargo.hire_periods(id, company_id, review_id null, client_id, vessel_id, charterer_client_id null, on_hire_date, on_hire_time, on_hire_location, off_hire_date, off_hire_time, off_hire_location, status enum[extracted,needs_review,approved,excluded], created_by, created_at)`
- `cargo.hire_period_documents(hire_period_id, document_id unique, company_id, role enum[on_hire,off_hire,supporting])`
- `cargo.hire_tank_readings(id, company_id, hire_period_id, boundary enum[on_hire,off_hire], vessel_tank_id, product_id, sounding numeric, quantity numeric(20,4), unit, temperature numeric, density numeric, api_gravity numeric, std_volume numeric(20,4))`
- `cargo.hire_period_results(id, company_id, hire_period_id, product_id, on_hire_rob numeric(20,4), fuel_received numeric(20,4), verified_consumption numeric(20,4), external_discharged numeric(20,4), other_adjustments numeric(20,4), expected_off_hire_rob numeric(20,4), actual_off_hire_rob numeric(20,4), variance numeric(20,4), unexplained_residual numeric(20,4), unit, data_quality jsonb, created_at)` — per fuel grade.

### Exceptions, analytics, findings
- `cargo.data_exceptions(id, company_id, review_id, loadout_id null, hire_period_id null, document_id null, type cargo.exception_type, severity enum[info,warning,error], message, status enum[open,resolved,excluded], resolved_by, resolved_at, resolution_note, created_at)` — the exception queue.
- `cargo.review_aggregates(id, review_id, company_id, computed_at, metrics jsonb)` — period-level totals snapshot (also exposed via views).
- `cargo.meter_analytics(id, company_id, meter_id, review_id null, loadout_count int, total_volume numeric(20,4), mean_variance_pct numeric, median_variance_pct numeric, weighted_variance_pct numeric, stddev numeric, cumulative_variance numeric(20,4), same_direction_pct numeric, computed_at)` — per physical meter bias.
- `cargo.findings(id, company_id, review_id, category enum[procedural_effect,reconciliation_gap,directional_variance,persistent_bias,measurement_inconsistency,calibration_concern,explained_variance,unexplained_residual], title, statement text, supporting_record_ids jsonb, sample_size int, comparison_method, reference_method, absolute_variance numeric(20,4), variance_pct numeric, tolerance numeric, data_quality_notes, severity, status, created_at)`

### Shared enum types (schema `cargo`)
- `cargo.document_type enum[vessel_sounding_certificate, vessel_flow_meter_report, shore_flow_meter_report, shore_tank_certificate, fueltrax_report, bunker_delivery_note, loadout_summary, calibration_certificate, on_hire_certificate, off_hire_certificate, other]`
- `cargo.measurement_method enum[vessel_sounding, vessel_meter, shore_meter, shore_tank, fueltrax, client_reported, other]`
- `cargo.tank_role enum[receiving, non_receiving, day_service, settling, transfer, excluded]`
- `cargo.exception_type enum[missing_reading, invalid_sequence, unit_mismatch, unknown_tank, unknown_meter, missing_date, duplicate_certificate, unmatched_document, implausible_quantity, undocumented_transfer, expired_calibration, low_confidence, indeterminate_formula]`

## 6a. Liquid-cargo generalization (migration 0007)

Added in `supabase/migrations/0007_liquid_cargo.sql` (additive; does not alter 0005):

- `cargo.cargo_types(id, key unique, name, category[petroleum|chemical|vegetable_oil|other], default_density_kg_m3, is_system, is_active, created_at)` — **system reference** list of liquid cargo types (global, no `company_id`, seeded like `accounting.currencies`). `default_density_kg_m3` is an **illustrative @15°C default only** — a parcel's real density always comes from its certificate, never assumed from this default.
- `cargo.quantity_basis enum[volume, mass]` — whether a review reports/settles in volume or mass.
- `cargo.products.cargo_type_id → cargo.cargo_types` — every product belongs to a cargo type.
- `cargo.assurance_reviews.default_cargo_type_id`, `cargo.assurance_reviews.quantity_basis` (default `volume`).
- `cargo.client_procedures.quantity_basis` (default `volume`) — procedures may settle in mass.

RLS: `cargo.cargo_types` is non-sensitive global reference — `select using (true)` for authenticated;
writes restricted to super admins. Manifest exposes a `default_quantity_basis` setting and a
**Cargo Types** configuration screen.

### Mass conversion (volume ↔ metric tonnes)
Implemented in `src/modules/cargo-assurance/mass.ts` (pure, unit-tested):
- **Density at 15°C** from specific gravity (`density = sg × 999.016`) or from API gravity.
- **Mass** = standard volume × density; both **weight in vacuum** and **weight in air** (air-buoyancy
  1.1 kg/m³) are produced; metric tonnes in air is the usual cargo-trade settlement figure.
- **Standard volume** requires a supplied **VCF** (e.g. ASTM 54) or an explicit volumetric expansion
  coefficient the caller opts into; the engine **never assumes** a temperature/density correction the
  source lacks — it flags `missing_density` / `missing_vcf` / `approximate_vcf` instead.

> Note: on/off-hire **hire periods** measure the **vessel's own bunker fuel** ROB, so `fuel_received`
> and "per fuel grade" are correct there even in a general cargo module.

## 7. Calculation invariants

- **Variance** = comparison method − reference method. **Variance %** = (comparison − reference) /
  reference × 100. Reference method is configurable per procedure/review; never hard-code one method
  as absolute truth. Sign convention explained everywhere: positive ⇒ comparison reports more.
- **Claimed-over-received** = shore reported delivery − Taylor corrected vessel receipt.
- **Procedural apparent loss** = Taylor corrected vessel result − client procedure result.
- **Unexplained residual** = Taylor corrected vessel receipt − selected independent reference.
- **Non-receiving tank:** raw difference preserved as evidence; corrected receipt difference = 0
  unless a documented transfer occurred; the delta is recorded as a **procedural effect** and
  aggregated across the review.
- **Day/service tank:** reductions are not automatically delivery shortage; classify as consumption
  (documented / estimated / unsupported / unexplained) with evidence.
- **Internal transfers net to zero** across all affected tanks.
- **Meter qty** = closing totalizer − opening totalizer (× meter factor; handle rollover, units,
  calibration). **Shore delivery** = opening inventory − closing inventory (± documented receipts/
  withdrawals/returns/transfers, temperature/density corrections).
- **Mass balance:** received = ending inventory − starting inventory + consumption + external
  discharged − other external received; internal transfers net to zero.
- **Hire period:** expected_off_hire_rob = on_hire_rob + fuel_received − verified_consumption −
  external_discharged + other_adjustments; hire variance = actual − expected (positive ⇒ more ROB
  than expected). If consumption/transfer evidence is unavailable, show only the verified
  on-hire→off-hire change; do **not** infer an unexplained loss from incomplete information.
- **Percentages never summed.** Cumulative percentages computed from aggregated quantities or
  correctly weighted averages.
- **Units:** support m³, bbl, L, US gal, °C, °F, density, API gravity, std volume @15°C / @60°F.
  Preserve original values and conversions separately; never assume temperature/density the source
  doesn't support — flag it.

## 8. Future Accounting connection (design-for, not depend-on)

Do not make Accounting a dependency of the initial release. Reuse shared `core.companies` /
`core.clients` identifiers so later links (survey revenue, invoices, expenses, fuel-loss exposure,
credit/shortage claims) are natural. Financial exposure in a review is optional and uses
`reporting_currency`.

## 9. Initial delivery workflow (acceptance spine)

Create review → select client/period/procedure → bulk-upload certificates → classify + extract →
group documents into loadouts → review exceptions & low-confidence in a spreadsheet workspace →
engine produces client-procedure + Taylor-corrected results → aggregate across period → review
findings → reviewer approves & publishes → client gets read-only published dashboard + downloadable
report. Hire-period certificates use the **same** upload/extraction/tracing/validation/approval/
versioning workflow.

## 10. Document conventions

Each Cargo Assurance doc opens with: title, "TEAL Enterprise — Cargo Assurance Module", owning agent,
status (`Draft v1 — 2026-06-17`), and a 2–3 sentence purpose. Each ends with **Open Questions** and
**Decisions Locked**, and cross-references sibling docs by filename.
