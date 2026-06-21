-- =============================================================================
-- TEAL Enterprise — Migration 0005: Cargo Assurance module schema
-- -----------------------------------------------------------------------------
-- Creates the `cargo` schema: a retrospective, batch analytical and reporting
-- system for cargo loadout / hire-period assurance. Versioned client procedures
-- and Taylor calculation methodologies, document ingestion (never deleted),
-- field-level extraction with source traceability, reconstructed loadouts,
-- three-layer results (raw evidence / client procedure / Taylor corrected),
-- hire-period reconciliation, exceptions, analytics, findings, reproducible
-- published snapshots, and the client-portal access table.
-- Conforms to docs/cargo-assurance/_FUEL-SPEC.md and docs/_ARCHITECTURE-SPEC.md.
-- RLS, client-portal policies, and grants are in 0006.
-- =============================================================================

create schema if not exists cargo;

-- -----------------------------------------------------------------------------
-- Shared enum types (schema `cargo`) — spec §6 "Shared enum types".
-- -----------------------------------------------------------------------------
create type cargo.document_type as enum (
  'vessel_sounding_certificate',
  'vessel_flow_meter_report',
  'shore_flow_meter_report',
  'shore_tank_certificate',
  'fueltrax_report',
  'bunker_delivery_note',
  'loadout_summary',
  'calibration_certificate',
  'on_hire_certificate',
  'off_hire_certificate',
  'other'
);

create type cargo.measurement_method as enum (
  'vessel_sounding',
  'vessel_meter',
  'shore_meter',
  'shore_tank',
  'fueltrax',
  'client_reported',
  'other'
);

create type cargo.tank_role as enum (
  'receiving',
  'non_receiving',
  'day_service',
  'settling',
  'transfer',
  'excluded'
);

create type cargo.exception_type as enum (
  'missing_reading',
  'invalid_sequence',
  'unit_mismatch',
  'unknown_tank',
  'unknown_meter',
  'missing_date',
  'duplicate_certificate',
  'unmatched_document',
  'implausible_quantity',
  'undocumented_transfer',
  'expired_calibration',
  'low_confidence',
  'indeterminate_formula'
);

-- -----------------------------------------------------------------------------
-- Per-table status / classification enums (spec §6 inline enum[...] values).
-- -----------------------------------------------------------------------------
create type cargo.config_status         as enum ('draft', 'active', 'archived');
create type cargo.review_status          as enum ('draft', 'in_review', 'reviewed', 'approved', 'published');
create type cargo.batch_status           as enum ('uploaded', 'processing', 'completed', 'failed', 'cancelled');
create type cargo.extraction_status      as enum ('pending', 'processing', 'extracted', 'needs_review', 'failed');
create type cargo.validation_status      as enum ('pending', 'valid', 'invalid', 'needs_review');
create type cargo.field_status           as enum ('ok', 'missing', 'uncertain', 'needs_review');
create type cargo.loadout_status         as enum ('extracted', 'needs_review', 'approved', 'excluded');
create type cargo.std_volume_basis       as enum ('none', 'at_15c', 'at_60f');
create type cargo.result_layer           as enum ('raw_evidence', 'client_procedure', 'taylor_corrected');
create type cargo.adjustment_type        as enum (
  'non_receiving_tank', 'consumption', 'internal_transfer',
  'temperature_density', 'meter_correction', 'other'
);
create type cargo.adjustment_support     as enum (
  'fueltrax', 'engine_log', 'duration_rate', 'client_approved', 'documented_transfer', 'none'
);
create type cargo.consumption_class      as enum ('documented', 'estimated', 'unsupported', 'unexplained');
create type cargo.consumption_source     as enum ('fueltrax', 'engine_log', 'duration_rate', 'client_approved', 'other');
create type cargo.hire_status            as enum ('extracted', 'needs_review', 'approved', 'excluded');
create type cargo.hire_boundary          as enum ('on_hire', 'off_hire');
create type cargo.hire_document_role     as enum ('on_hire', 'off_hire', 'supporting');
create type cargo.exception_severity     as enum ('info', 'warning', 'error');
create type cargo.exception_status       as enum ('open', 'resolved', 'excluded');
create type cargo.meter_type            as enum ('vessel_flow', 'shore_flow');
create type cargo.finding_category       as enum (
  'procedural_effect', 'reconciliation_gap', 'directional_variance', 'persistent_bias',
  'measurement_inconsistency', 'calibration_concern', 'explained_variance', 'unexplained_residual'
);
create type cargo.client_access_status   as enum ('active', 'invited', 'suspended');

-- =============================================================================
-- Configuration & reference
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Client procedures — versioned client reporting-methodology templates.
-- (client_id, version) identifies a pinned version; historical reviews keep the
-- exact version used at calculation time. No hard-coded client procedures.
-- -----------------------------------------------------------------------------
create table cargo.client_procedures (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  client_id           uuid not null references core.clients(id) on delete restrict,
  name                text not null,
  version             integer not null default 1,
  status              cargo.config_status not null default 'draft',
  config              jsonb not null default '{}'::jsonb,
  required_documents  jsonb not null default '[]'::jsonb,
  measurement_methods jsonb not null default '[]'::jsonb,
  tolerances          jsonb not null default '{}'::jsonb,
  terminology         jsonb not null default '{}'::jsonb,
  effective_from      date,
  created_by          uuid references core.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, version)
);

create index on cargo.client_procedures (company_id);
create index on cargo.client_procedures (company_id, client_id);
create index on cargo.client_procedures (company_id, status);

comment on table cargo.client_procedures is 'Versioned client reporting-methodology templates. (client_id, version) is a pinned version preserved by historical reviews.';

-- -----------------------------------------------------------------------------
-- Calculation methodologies — Taylor corrected reconciliation rules-engine
-- configuration, versioned. No arbitrary client code; safe versioned rules only.
-- -----------------------------------------------------------------------------
create table cargo.calculation_methodologies (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies(id) on delete cascade,
  key           text not null,
  name          text not null,
  version       integer not null default 1,
  description   text,
  formula_rules jsonb not null default '{}'::jsonb,
  status        cargo.config_status not null default 'draft',
  created_by    uuid references core.users(id),
  created_at    timestamptz not null default now(),
  unique (company_id, key, version)
);

create index on cargo.calculation_methodologies (company_id);
create index on cargo.calculation_methodologies (company_id, status);

comment on table cargo.calculation_methodologies is 'Versioned Taylor corrected reconciliation rules-engine config. Historical reviews pin the methodology version used.';

-- -----------------------------------------------------------------------------
-- Extraction templates — configurable per document type (optionally per client).
-- -----------------------------------------------------------------------------
create table cargo.extraction_templates (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  client_id            uuid references core.clients(id) on delete cascade,  -- null = generic template
  document_type        cargo.document_type not null,
  name                 text not null,
  version              integer not null default 1,
  status               cargo.config_status not null default 'draft',
  field_map            jsonb not null default '{}'::jsonb,
  table_structures     jsonb not null default '{}'::jsonb,
  unit_mappings        jsonb not null default '{}'::jsonb,
  date_formats         jsonb not null default '{}'::jsonb,
  validation_rules     jsonb not null default '{}'::jsonb,
  confidence_thresholds jsonb not null default '{}'::jsonb,
  created_by           uuid references core.users(id),
  created_at           timestamptz not null default now()
);

create index on cargo.extraction_templates (company_id);
create index on cargo.extraction_templates (company_id, document_type);
create index on cargo.extraction_templates (company_id, client_id);

comment on table cargo.extraction_templates is 'Configurable extraction templates keyed by document type, optionally scoped to a client.';

-- -----------------------------------------------------------------------------
-- Terminals
-- -----------------------------------------------------------------------------
create table cargo.terminals (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  client_id  uuid references core.clients(id) on delete set null,  -- null = shared/generic
  name       text not null,
  code       text,
  location   text,
  berths     jsonb not null default '[]'::jsonb,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index on cargo.terminals (company_id);
create index on cargo.terminals (company_id, client_id);

comment on table cargo.terminals is 'Loading terminals and their berths.';

-- -----------------------------------------------------------------------------
-- Vessels
-- -----------------------------------------------------------------------------
create table cargo.vessels (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  name              text not null,
  imo               text,
  default_client_id uuid references core.clients(id) on delete set null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create index on cargo.vessels (company_id);
create index on cargo.vessels (company_id, default_client_id);

comment on table cargo.vessels is 'Vessels receiving cargo. IMO recorded where available.';

-- -----------------------------------------------------------------------------
-- Vessel tanks — default role; per-loadout role may differ (stored on reading).
-- -----------------------------------------------------------------------------
create table cargo.vessel_tanks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  vessel_id    uuid not null references cargo.vessels(id) on delete cascade,
  name         text not null,
  default_role cargo.tank_role not null default 'receiving',
  capacity     numeric(20,4),
  unit         text,
  is_active    boolean not null default true
);

create index on cargo.vessel_tanks (company_id);
create index on cargo.vessel_tanks (vessel_id);

comment on table cargo.vessel_tanks is 'Vessel tanks. default_role is overridable per loadout on the tank reading.';

-- -----------------------------------------------------------------------------
-- Meters — physical meters tracked independently for bias / drift analytics.
-- -----------------------------------------------------------------------------
create table cargo.meters (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  meter_type           cargo.meter_type not null,
  physical_id          text,
  name                 text,
  terminal_id          uuid references cargo.terminals(id) on delete set null,
  vessel_id            uuid references cargo.vessels(id) on delete set null,
  calibration_factor   numeric(20,10),
  calibration_date     date,
  replaced_by_meter_id uuid references cargo.meters(id) on delete set null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create index on cargo.meters (company_id);
create index on cargo.meters (company_id, meter_type);
create index on cargo.meters (terminal_id);
create index on cargo.meters (vessel_id);

comment on table cargo.meters is 'Physical meters tracked independently across calibrations/replacements for bias analytics.';

-- -----------------------------------------------------------------------------
-- Products (cargo grades)
-- -----------------------------------------------------------------------------
create table cargo.products (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  name            text not null,
  grade           text,
  default_density numeric(20,10),
  default_api     numeric(20,10),
  is_active       boolean not null default true
);

create index on cargo.products (company_id);

comment on table cargo.products is 'Fuel products / grades with default density and API gravity.';

-- =============================================================================
-- Reviews
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Assurance reviews — the top-level record. Loadouts exist only beneath these.
-- procedure_id / methodology_id pin the exact versions used.
-- -----------------------------------------------------------------------------
create table cargo.assurance_reviews (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  client_id          uuid not null references core.clients(id) on delete restrict,
  title              text not null,
  start_date         date not null,
  end_date           date not null,
  reporting_currency char(3),
  procedure_id       uuid references cargo.client_procedures(id) on delete restrict,
  methodology_id     uuid references cargo.calculation_methodologies(id) on delete restrict,
  included_terminals uuid[] not null default '{}',
  included_vessels   uuid[] not null default '{}',
  included_products  uuid[] not null default '{}',
  status             cargo.review_status not null default 'draft',
  notes              text,
  created_by         uuid references core.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  approved_by        uuid references core.users(id),
  approved_at        timestamptz,
  published_by       uuid references core.users(id),
  published_at       timestamptz,
  check (end_date >= start_date)
);

create index on cargo.assurance_reviews (company_id);
create index on cargo.assurance_reviews (company_id, client_id);
create index on cargo.assurance_reviews (company_id, status);

comment on table cargo.assurance_reviews is 'Top-level assurance review over a period. Pins the client procedure and Taylor methodology versions used.';

-- -----------------------------------------------------------------------------
-- Review snapshots — reproducible published snapshot. (review_id, version) unique.
-- Corrections create a new version, never silently changing a published report.
-- -----------------------------------------------------------------------------
create table cargo.review_snapshots (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null references cargo.assurance_reviews(id) on delete cascade,
  company_id       uuid not null references core.companies(id) on delete cascade,
  version          integer not null,
  snapshot         jsonb not null default '{}'::jsonb,
  report_pdf_path  text,
  report_xlsx_path text,
  created_by       uuid references core.users(id),
  created_at       timestamptz not null default now(),
  unique (review_id, version)
);

create index on cargo.review_snapshots (company_id);
create index on cargo.review_snapshots (review_id);

comment on table cargo.review_snapshots is 'Immutable, reproducible published snapshot of a review. Client portal reads only these.';

-- =============================================================================
-- Ingestion
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Import batches — a bulk upload of accumulated documents into a review.
-- -----------------------------------------------------------------------------
create table cargo.import_batches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  review_id       uuid references cargo.assurance_reviews(id) on delete cascade,
  status          cargo.batch_status not null default 'uploaded',
  file_count      integer not null default 0,
  processed_count integer not null default 0,
  failed_count    integer not null default 0,
  created_by      uuid references core.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on cargo.import_batches (company_id);
create index on cargo.import_batches (review_id);
create index on cargo.import_batches (company_id, status);

comment on table cargo.import_batches is 'A bulk upload of accumulated certificates/reports into a review.';

-- -----------------------------------------------------------------------------
-- Documents — the authoritative ingestion record. NEVER deleted; duplicates
-- detected by checksum. Stores original + raw + normalized extraction.
-- -----------------------------------------------------------------------------
create table cargo.documents (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references core.companies(id) on delete cascade,
  review_id                uuid references cargo.assurance_reviews(id) on delete set null,
  batch_id                 uuid references cargo.import_batches(id) on delete set null,
  client_id                uuid references core.clients(id) on delete set null,
  original_filename        text not null,
  checksum                 text,
  file_type                text,
  storage_path             text not null,
  page_count               integer,
  uploaded_by              uuid references core.users(id),
  uploaded_at              timestamptz not null default now(),
  detected_document_type   cargo.document_type,
  classification_confidence numeric(20,10),
  extraction_status        cargo.extraction_status not null default 'pending',
  extraction_confidence    numeric(20,10),
  raw_extraction           jsonb,
  normalized_extraction    jsonb,
  validation_status        cargo.validation_status not null default 'pending',
  parent_archive_id        uuid references cargo.documents(id) on delete set null,
  created_at               timestamptz not null default now()
);

create index on cargo.documents (company_id);
create index on cargo.documents (review_id);
create index on cargo.documents (batch_id);
create index on cargo.documents (company_id, client_id);
create index on cargo.documents (company_id, checksum);  -- duplicate detection
create index on cargo.documents (company_id, extraction_status);

comment on table cargo.documents is 'Authoritative ingestion record. Never deleted. Duplicates detected by checksum. Preserves original + raw + normalized extraction.';

-- -----------------------------------------------------------------------------
-- Extracted fields — field-level values with full source traceability.
-- -----------------------------------------------------------------------------
create table cargo.extracted_fields (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  document_id      uuid not null references cargo.documents(id) on delete cascade,
  field_key        text not null,
  raw_value        text,
  normalized_value text,
  unit             text,
  confidence       numeric(20,10),
  source_page      integer,
  source_table     text,
  source_cell      text,
  source_worksheet text,
  status           cargo.field_status not null default 'ok',
  created_at       timestamptz not null default now()
);

create index on cargo.extracted_fields (company_id);
create index on cargo.extracted_fields (document_id);
create index on cargo.extracted_fields (document_id, field_key);

comment on table cargo.extracted_fields is 'Field-level extraction with source page/table/cell/worksheet traceability. Missing/uncertain never invented.';

-- -----------------------------------------------------------------------------
-- Field corrections — preserve original + corrected; never silently alter.
-- -----------------------------------------------------------------------------
create table cargo.field_corrections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  extracted_field_id uuid not null references cargo.extracted_fields(id) on delete cascade,
  original_value     text,
  corrected_value    text,
  reason             text,
  corrected_by       uuid references core.users(id),
  corrected_at       timestamptz not null default now()
);

create index on cargo.field_corrections (company_id);
create index on cargo.field_corrections (extracted_field_id);

comment on table cargo.field_corrections is 'Append-only corrections preserving the original and corrected values with a reason.';

-- =============================================================================
-- Loadouts & measurements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Loadouts — reconstructed automatically from grouped documents.
-- -----------------------------------------------------------------------------
create table cargo.loadouts (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references core.companies(id) on delete cascade,
  review_id                   uuid not null references cargo.assurance_reviews(id) on delete cascade,
  client_id                   uuid references core.clients(id) on delete set null,
  vessel_id                   uuid references cargo.vessels(id) on delete set null,
  terminal_id                 uuid references cargo.terminals(id) on delete set null,
  berth                       text,
  certificate_number          text,
  loadout_date                date,
  start_time                  timestamptz,
  completion_time             timestamptz,
  product_id                  uuid references cargo.products(id) on delete set null,
  nominated_quantity          numeric(20,4),
  reported_delivered_quantity numeric(20,4),
  unit                        text,
  match_confidence            numeric(20,10),
  status                      cargo.loadout_status not null default 'extracted',
  exclusion_reason            text,
  created_by                  uuid references core.users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index on cargo.loadouts (company_id);
create index on cargo.loadouts (review_id);
create index on cargo.loadouts (company_id, client_id);
create index on cargo.loadouts (company_id, status);

comment on table cargo.loadouts is 'Automatically reconstructed loadouts beneath a review. Not a primary navigation/data-entry item.';

-- -----------------------------------------------------------------------------
-- Loadout documents — grouping. A document maps to AT MOST ONE loadout
-- (document_id unique) to prevent double counting.
-- -----------------------------------------------------------------------------
create table cargo.loadout_documents (
  id          uuid primary key default gen_random_uuid(),
  loadout_id  uuid not null references cargo.loadouts(id) on delete cascade,
  document_id uuid not null references cargo.documents(id) on delete cascade,
  company_id  uuid not null references core.companies(id) on delete cascade,
  role        text,
  unique (document_id)
);

create index on cargo.loadout_documents (company_id);
create index on cargo.loadout_documents (loadout_id);

comment on table cargo.loadout_documents is 'Groups documents into a loadout. document_id is unique so a document counts toward at most one loadout.';

-- -----------------------------------------------------------------------------
-- Loadout tank readings — per-tank opening/closing measurements and effects.
-- Non-receiving tank ⇒ corrected_receipt_difference 0 unless documented transfer.
-- -----------------------------------------------------------------------------
create table cargo.loadout_tank_readings (
  id                           uuid primary key default gen_random_uuid(),
  company_id                   uuid not null references core.companies(id) on delete cascade,
  loadout_id                   uuid not null references cargo.loadouts(id) on delete cascade,
  vessel_tank_id               uuid references cargo.vessel_tanks(id) on delete set null,
  tank_role                    cargo.tank_role not null default 'receiving',
  received_flag                boolean not null default false,
  opening_sounding             numeric(20,4),
  closing_sounding             numeric(20,4),
  opening_quantity             numeric(20,4),
  closing_quantity             numeric(20,4),
  unit                         text,
  temperature                  numeric(20,4),
  density                      numeric(20,10),
  api_gravity                  numeric(20,10),
  std_volume_basis             cargo.std_volume_basis not null default 'none',
  raw_difference               numeric(20,4),
  corrected_receipt_difference numeric(20,4),
  procedural_effect            numeric(20,4),
  explanation                  text,
  source_document_id           uuid references cargo.documents(id) on delete set null,
  confidence                   numeric(20,10)
);

create index on cargo.loadout_tank_readings (company_id);
create index on cargo.loadout_tank_readings (loadout_id);
create index on cargo.loadout_tank_readings (vessel_tank_id);

comment on table cargo.loadout_tank_readings is 'Per-tank readings. Non-receiving tanks carry corrected_receipt_difference 0 (unless documented transfer); delta recorded as procedural_effect.';

-- -----------------------------------------------------------------------------
-- Loadout measurements — each measurement method's values and result.
-- -----------------------------------------------------------------------------
create table cargo.loadout_measurements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  loadout_id          uuid not null references cargo.loadouts(id) on delete cascade,
  method              cargo.measurement_method not null,
  raw_values          jsonb,
  normalized_values   jsonb,
  calculated_quantity numeric(20,4),
  original_unit       text,
  converted_unit      text,
  formula             text,
  formula_version     text,
  source_document_id  uuid references cargo.documents(id) on delete set null,
  confidence          numeric(20,10),
  included            boolean not null default true,
  exclusion_reason    text
);

create index on cargo.loadout_measurements (company_id);
create index on cargo.loadout_measurements (loadout_id);
create index on cargo.loadout_measurements (loadout_id, method);

comment on table cargo.loadout_measurements is 'One row per measurement method per loadout, preserving raw + normalized values and the formula version used.';

-- -----------------------------------------------------------------------------
-- Loadout results — the three layers (raw / client procedure / Taylor corrected).
-- -----------------------------------------------------------------------------
create table cargo.loadout_results (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  loadout_id          uuid not null references cargo.loadouts(id) on delete cascade,
  layer               cargo.result_layer not null,
  quantity            numeric(20,4),
  unit                text,
  basis               text,
  details             jsonb,
  methodology_version text,
  created_at          timestamptz not null default now()
);

create index on cargo.loadout_results (company_id);
create index on cargo.loadout_results (loadout_id);
create index on cargo.loadout_results (loadout_id, layer);

comment on table cargo.loadout_results is 'Three result layers per loadout: raw_evidence, client_procedure, taylor_corrected. Raw evidence never overwritten.';

-- -----------------------------------------------------------------------------
-- Loadout adjustments — drift-waterfall components with evidence support.
-- -----------------------------------------------------------------------------
create table cargo.loadout_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  loadout_id          uuid not null references cargo.loadouts(id) on delete cascade,
  type                cargo.adjustment_type not null,
  quantity            numeric(20,4),
  supported_by        cargo.adjustment_support not null default 'none',
  evidence_document_id uuid references cargo.documents(id) on delete set null,
  explanation         text,
  created_at          timestamptz not null default now()
);

create index on cargo.loadout_adjustments (company_id);
create index on cargo.loadout_adjustments (loadout_id);

comment on table cargo.loadout_adjustments is 'Drift-waterfall adjustment components per loadout, each tagged with its evidence support level.';

-- -----------------------------------------------------------------------------
-- Internal transfers — must net to zero across affected tanks.
-- -----------------------------------------------------------------------------
create table cargo.internal_transfers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  loadout_id         uuid not null references cargo.loadouts(id) on delete cascade,
  from_tank_id       uuid references cargo.vessel_tanks(id) on delete set null,
  to_tank_id         uuid references cargo.vessel_tanks(id) on delete set null,
  quantity           numeric(20,4),
  unit               text,
  source_document_id uuid references cargo.documents(id) on delete set null,
  matched            boolean not null default false
);

create index on cargo.internal_transfers (company_id);
create index on cargo.internal_transfers (loadout_id);

comment on table cargo.internal_transfers is 'Internal tank-to-tank transfers; expected to net to zero across affected tanks.';

-- -----------------------------------------------------------------------------
-- Consumption records — never present an estimate as a measured fact.
-- -----------------------------------------------------------------------------
create table cargo.consumption_records (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  loadout_id         uuid references cargo.loadouts(id) on delete cascade,
  hire_period_id     uuid,  -- FK added after cargo.hire_periods is created
  classification     cargo.consumption_class not null,
  quantity           numeric(20,4),
  unit               text,
  source             cargo.consumption_source not null default 'other',
  evidence_document_id uuid references cargo.documents(id) on delete set null,
  explanation        text
);

create index on cargo.consumption_records (company_id);
create index on cargo.consumption_records (loadout_id);
create index on cargo.consumption_records (hire_period_id);

comment on table cargo.consumption_records is 'Consumption classified documented/estimated/unsupported/unexplained. Estimates never presented as measured facts.';

-- =============================================================================
-- Hire periods (on-hire / off-hire reconciliation)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hire periods — boundary survey reconciliation, same workflow as loadouts.
-- -----------------------------------------------------------------------------
create table cargo.hire_periods (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  review_id           uuid references cargo.assurance_reviews(id) on delete set null,
  client_id           uuid not null references core.clients(id) on delete restrict,
  vessel_id           uuid references cargo.vessels(id) on delete set null,
  charterer_client_id uuid references core.clients(id) on delete set null,
  on_hire_date        date,
  on_hire_time        timestamptz,
  on_hire_location    text,
  off_hire_date       date,
  off_hire_time       timestamptz,
  off_hire_location   text,
  status              cargo.hire_status not null default 'extracted',
  created_by          uuid references core.users(id),
  created_at          timestamptz not null default now()
);

create index on cargo.hire_periods (company_id);
create index on cargo.hire_periods (review_id);
create index on cargo.hire_periods (company_id, client_id);

comment on table cargo.hire_periods is 'On-hire / off-hire boundary surveys. Uses the same upload/extraction/validation/approval workflow as loadouts.';

-- Now that cargo.hire_periods exists, wire the deferred FK from consumption_records.
alter table cargo.consumption_records
  add constraint consumption_records_hire_period_id_fkey
  foreign key (hire_period_id) references cargo.hire_periods(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- Hire period documents — document_id unique (one document, one hire period).
-- -----------------------------------------------------------------------------
create table cargo.hire_period_documents (
  id             uuid primary key default gen_random_uuid(),
  hire_period_id uuid not null references cargo.hire_periods(id) on delete cascade,
  document_id    uuid not null references cargo.documents(id) on delete cascade,
  company_id     uuid not null references core.companies(id) on delete cascade,
  role           cargo.hire_document_role not null default 'supporting',
  unique (document_id)
);

create index on cargo.hire_period_documents (company_id);
create index on cargo.hire_period_documents (hire_period_id);

comment on table cargo.hire_period_documents is 'Groups documents into a hire period. document_id unique to prevent double counting.';

-- -----------------------------------------------------------------------------
-- Hire tank readings — per boundary, per tank.
-- -----------------------------------------------------------------------------
create table cargo.hire_tank_readings (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  hire_period_id uuid not null references cargo.hire_periods(id) on delete cascade,
  boundary       cargo.hire_boundary not null,
  vessel_tank_id uuid references cargo.vessel_tanks(id) on delete set null,
  product_id     uuid references cargo.products(id) on delete set null,
  sounding       numeric(20,4),
  quantity       numeric(20,4),
  unit           text,
  temperature    numeric(20,4),
  density        numeric(20,10),
  api_gravity    numeric(20,10),
  std_volume     numeric(20,4)
);

create index on cargo.hire_tank_readings (company_id);
create index on cargo.hire_tank_readings (hire_period_id);
create index on cargo.hire_tank_readings (hire_period_id, boundary);

comment on table cargo.hire_tank_readings is 'Per-tank readings at the on-hire and off-hire boundaries.';

-- -----------------------------------------------------------------------------
-- Hire period results — per cargo grade ROB reconciliation.
-- -----------------------------------------------------------------------------
create table cargo.hire_period_results (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  hire_period_id       uuid not null references cargo.hire_periods(id) on delete cascade,
  product_id           uuid references cargo.products(id) on delete set null,
  on_hire_rob          numeric(20,4),
  fuel_received        numeric(20,4),
  verified_consumption numeric(20,4),
  external_discharged  numeric(20,4),
  other_adjustments    numeric(20,4),
  expected_off_hire_rob numeric(20,4),
  actual_off_hire_rob  numeric(20,4),
  variance             numeric(20,4),
  unexplained_residual numeric(20,4),
  unit                 text,
  data_quality         jsonb,
  created_at           timestamptz not null default now()
);

create index on cargo.hire_period_results (company_id);
create index on cargo.hire_period_results (hire_period_id);

comment on table cargo.hire_period_results is 'Per-grade hire-period ROB reconciliation. Incomplete evidence shows only verified change, never an inferred loss.';

-- =============================================================================
-- Exceptions, analytics, findings
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Data exceptions — the exception / review queue.
-- -----------------------------------------------------------------------------
create table cargo.data_exceptions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies(id) on delete cascade,
  review_id       uuid not null references cargo.assurance_reviews(id) on delete cascade,
  loadout_id      uuid references cargo.loadouts(id) on delete cascade,
  hire_period_id  uuid references cargo.hire_periods(id) on delete cascade,
  document_id     uuid references cargo.documents(id) on delete set null,
  type            cargo.exception_type not null,
  severity        cargo.exception_severity not null default 'warning',
  message         text,
  status          cargo.exception_status not null default 'open',
  resolved_by     uuid references core.users(id),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);

create index on cargo.data_exceptions (company_id);
create index on cargo.data_exceptions (review_id);
create index on cargo.data_exceptions (review_id, status);
create index on cargo.data_exceptions (loadout_id);
create index on cargo.data_exceptions (hire_period_id);

comment on table cargo.data_exceptions is 'Exception queue: missing readings, sequence/unit issues, duplicates, low confidence, etc.';

-- -----------------------------------------------------------------------------
-- Review aggregates — period-level totals snapshot (also exposed via views).
-- -----------------------------------------------------------------------------
create table cargo.review_aggregates (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references cargo.assurance_reviews(id) on delete cascade,
  company_id  uuid not null references core.companies(id) on delete cascade,
  computed_at timestamptz not null default now(),
  metrics     jsonb not null default '{}'::jsonb
);

create index on cargo.review_aggregates (company_id);
create index on cargo.review_aggregates (review_id);

comment on table cargo.review_aggregates is 'Period-level aggregate metrics snapshot for a review.';

-- -----------------------------------------------------------------------------
-- Meter analytics — per physical meter bias across a review.
-- -----------------------------------------------------------------------------
create table cargo.meter_analytics (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references core.companies(id) on delete cascade,
  meter_id             uuid not null references cargo.meters(id) on delete cascade,
  review_id            uuid references cargo.assurance_reviews(id) on delete cascade,
  loadout_count        integer not null default 0,
  total_volume         numeric(20,4),
  mean_variance_pct    numeric(20,10),
  median_variance_pct  numeric(20,10),
  weighted_variance_pct numeric(20,10),
  stddev               numeric(20,10),
  cumulative_variance  numeric(20,4),
  same_direction_pct   numeric(20,10),
  computed_at          timestamptz not null default now()
);

create index on cargo.meter_analytics (company_id);
create index on cargo.meter_analytics (meter_id);
create index on cargo.meter_analytics (review_id);

comment on table cargo.meter_analytics is 'Per physical meter bias/drift analytics for a review. Percentages are correctly weighted, never summed.';

-- -----------------------------------------------------------------------------
-- Findings — neutral, defensible findings; respects minimum sample size.
-- -----------------------------------------------------------------------------
create table cargo.findings (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references core.companies(id) on delete cascade,
  review_id             uuid not null references cargo.assurance_reviews(id) on delete cascade,
  category              cargo.finding_category not null,
  title                 text,
  statement             text,
  supporting_record_ids jsonb not null default '[]'::jsonb,
  sample_size           integer,
  comparison_method     text,
  reference_method      text,
  absolute_variance     numeric(20,4),
  variance_pct          numeric(20,10),
  tolerance             numeric(20,10),
  data_quality_notes    text,
  severity              cargo.exception_severity not null default 'info',
  status                cargo.exception_status not null default 'open',
  created_at            timestamptz not null default now()
);

create index on cargo.findings (company_id);
create index on cargo.findings (review_id);
create index on cargo.findings (review_id, category);

comment on table cargo.findings is 'Neutral, defensible findings. No strong conclusions below the configured minimum sample; never alleges fraud without verified evidence.';

-- =============================================================================
-- Client portal access
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Client access — external client-portal membership. An external user with an
-- active row here may read ONLY published snapshots for their client_id.
-- -----------------------------------------------------------------------------
create table cargo.client_access (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  client_id  uuid not null references core.clients(id) on delete cascade,
  user_id    uuid not null references core.users(id) on delete cascade,
  role       text not null default 'ca_client_viewer',  -- ca_client_admin | ca_client_viewer
  status     cargo.client_access_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create index on cargo.client_access (company_id);
create index on cargo.client_access (user_id);
create index on cargo.client_access (client_id);

comment on table cargo.client_access is 'External client-portal access. Active rows grant read-only access to published reviews for that client_id only.';

-- =============================================================================
-- Derived views
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Published reviews — the minimal review row exposed to the client portal,
-- restricted to reviews that actually have a published status. Runs with the
-- invoker's privileges so the underlying RLS applies (Postgres 15).
-- -----------------------------------------------------------------------------
create view cargo.published_reviews as
select
  r.id,
  r.company_id,
  r.client_id,
  r.title,
  r.start_date,
  r.end_date,
  r.reporting_currency,
  r.status,
  r.published_by,
  r.published_at
from cargo.assurance_reviews r
where r.status = 'published';

comment on view cargo.published_reviews is 'Published reviews only. Minimal client-facing review header; backed by RLS on assurance_reviews.';

-- =============================================================================
-- FK covering indexes for source/evidence-document traceability columns. These FKs
-- are ON DELETE SET NULL, so without an index a document delete seq-scans each child;
-- they are also the join path for "all data sourced from document X".
-- =============================================================================
create index on cargo.loadout_tank_readings (source_document_id);
create index on cargo.loadout_measurements (source_document_id);
create index on cargo.loadout_adjustments (evidence_document_id);
create index on cargo.internal_transfers (source_document_id);
create index on cargo.consumption_records (evidence_document_id);
create index on cargo.data_exceptions (document_id);
create index on cargo.meters (replaced_by_meter_id);

-- =============================================================================
-- updated_at triggers for cargo tables that carry an updated_at column.
-- =============================================================================
create trigger trg_cargo_client_procedures_updated_at before update on cargo.client_procedures
  for each row execute function core.set_updated_at();
create trigger trg_cargo_assurance_reviews_updated_at before update on cargo.assurance_reviews
  for each row execute function core.set_updated_at();
create trigger trg_cargo_import_batches_updated_at before update on cargo.import_batches
  for each row execute function core.set_updated_at();
create trigger trg_cargo_loadouts_updated_at before update on cargo.loadouts
  for each row execute function core.set_updated_at();
