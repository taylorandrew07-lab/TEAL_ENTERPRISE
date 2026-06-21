-- =============================================================================
-- TEAL Enterprise — Migration 0007: Liquid-cargo generalization (Cargo Assurance)
-- -----------------------------------------------------------------------------
-- Generalizes the assurance module from fuels-only to ANY liquid bulk cargo
-- (gasoil, gasoline, crude, lube/base oils, vegetable oils, chemicals, molasses,
-- ...). Adds:
--   * cargo.cargo_types — system reference list of liquid cargo types (like
--     accounting.currencies / account_types: global, no company_id, seeded).
--   * cargo.quantity_basis enum — report/settle in volume OR mass.
--   * cargo-type links on products and reviews; a quantity_basis on reviews and
--     client procedures.
-- Purely additive — does not alter migration 0005. Conforms to
-- docs/cargo-assurance/_FUEL-SPEC.md and docs/platform-module-framework.md.
-- =============================================================================

-- Report/settlement basis: many liquid cargoes settle in metric tonnes (mass),
-- others in volume. Conversion between them uses density + standard volume (see
-- src/modules/cargo-assurance/mass.ts).
create type cargo.quantity_basis as enum ('volume', 'mass');

-- -----------------------------------------------------------------------------
-- Cargo types — system reference data (global, not tenant-scoped).
-- default_density_kg_m3 is an ILLUSTRATIVE default at 15°C; the actual density of
-- a parcel always comes from its certificate (never assumed from this default).
-- -----------------------------------------------------------------------------
create table cargo.cargo_types (
  id                    uuid primary key default gen_random_uuid(),
  key                   text not null unique,
  name                  text not null,
  category              text not null,            -- petroleum | chemical | vegetable_oil | other
  default_density_kg_m3 numeric(20,6),            -- illustrative default @15°C, configurable
  is_system             boolean not null default true,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

comment on table cargo.cargo_types is
  'System reference list of liquid bulk cargo types. default_density_kg_m3 is an illustrative @15C '
  'default only; a parcel''s real density comes from its certificate and is never assumed.';

-- -----------------------------------------------------------------------------
-- Cargo-type links + quantity basis.
-- -----------------------------------------------------------------------------
alter table cargo.products
  add column cargo_type_id uuid references cargo.cargo_types(id) on delete set null;

alter table cargo.assurance_reviews
  add column default_cargo_type_id uuid references cargo.cargo_types(id) on delete set null,
  add column quantity_basis cargo.quantity_basis not null default 'volume';

alter table cargo.client_procedures
  add column quantity_basis cargo.quantity_basis not null default 'volume';

create index on cargo.products (cargo_type_id);

comment on column cargo.assurance_reviews.quantity_basis is
  'Whether this review reports/settles in volume or mass. Mass uses density + standard volume.';

-- -----------------------------------------------------------------------------
-- RLS: cargo types are non-sensitive global reference data — readable by any
-- authenticated user; only super admins may modify the system list. (Per-company
-- custom cargo types can be added later via products / a future company-scoped table.)
-- -----------------------------------------------------------------------------
alter table cargo.cargo_types enable row level security;

create policy cargo_types_sel on cargo.cargo_types for select
  using (true);
create policy cargo_types_ins on cargo.cargo_types for insert
  with check (core.is_super_admin());
create policy cargo_types_upd on cargo.cargo_types for update
  using (core.is_super_admin()) with check (core.is_super_admin());
create policy cargo_types_del on cargo.cargo_types for delete
  using (core.is_super_admin());

grant select, insert, update, delete on cargo.cargo_types to authenticated;
