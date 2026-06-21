-- =============================================================================
-- TEAL Enterprise — Migration 0001: Core platform schema
-- -----------------------------------------------------------------------------
-- Creates the `core` schema: companies, users, RBAC, memberships, clients,
-- documents, audit logs, and the module registry. Conforms to docs/_ARCHITECTURE-SPEC.md.
-- RLS policies and helper functions are added in 0003. The cross-schema FK from
-- core.companies.base_currency_code -> accounting.currencies is added in 0002.
-- =============================================================================

create schema if not exists core;

-- gen_random_uuid() lives in pgcrypto (available by default on Supabase).
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type core.company_status as enum ('active', 'suspended', 'archived');
create type core.membership_status as enum ('active', 'invited', 'suspended');

-- -----------------------------------------------------------------------------
-- Companies (tenants)
-- -----------------------------------------------------------------------------
create table core.companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  legal_name              text,
  country_code            char(2) not null default 'TT',
  -- FK to accounting.currencies(code) added in migration 0002 (schema ordering).
  base_currency_code      char(3) not null default 'TTD',
  fiscal_year_start_month smallint not null default 1
                            check (fiscal_year_start_month between 1 and 12),
  timezone                text not null default 'America/Port_of_Spain',
  status                  core.company_status not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table core.companies is 'Tenant entities. Every accounting record is scoped to a company.';

-- -----------------------------------------------------------------------------
-- Users (mirror of auth.users; id equals the Supabase auth uid)
-- -----------------------------------------------------------------------------
create table core.users (
  id             uuid primary key,            -- = auth.users.id
  email          text not null,
  full_name      text,
  is_super_admin boolean not null default false,
  created_at     timestamptz not null default now()
);

comment on table core.users is 'Application profile mirror of auth.users. is_super_admin grants platform-wide access.';

-- -----------------------------------------------------------------------------
-- RBAC: roles, permissions, role_permissions
-- -----------------------------------------------------------------------------
create table core.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references core.companies(id) on delete cascade,  -- null = system role
  key         text not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  -- system roles (company_id null) unique by key; company roles unique within company.
  unique (company_id, key)
);

comment on table core.roles is 'Roles are scoped to a company, or system-wide when company_id is null.';

create table core.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  description text,
  category    text not null
);

comment on table core.permissions is 'Data-driven permission catalogue. Access rules are never hard-coded in application logic.';

create table core.role_permissions (
  role_id       uuid not null references core.roles(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- -----------------------------------------------------------------------------
-- Company memberships: user <-> company link carrying a role.
-- A user can belong to many companies with a different role in each.
-- -----------------------------------------------------------------------------
create table core.company_memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references core.users(id) on delete cascade,
  company_id uuid not null references core.companies(id) on delete cascade,
  role_id    uuid not null references core.roles(id) on delete restrict,
  status     core.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create index on core.company_memberships (company_id);
create index on core.company_memberships (user_id);
-- role_id is an ON DELETE RESTRICT FK and a role-scoped lookup key; index it so role
-- deletes and role-membership queries don't seq-scan as the platform grows.
create index on core.company_memberships (role_id);

comment on table core.company_memberships is 'Per-company role assignment for a user. Basis of RLS company scoping.';

-- -----------------------------------------------------------------------------
-- Clients (platform-level contacts, shared across modules)
-- -----------------------------------------------------------------------------
create table core.clients (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  type       text not null default 'organization',  -- organization | person
  name       text not null,
  email      text,
  phone      text,
  address    jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on core.clients (company_id);

-- -----------------------------------------------------------------------------
-- Documents (metadata; binaries live in Supabase Storage)
-- -----------------------------------------------------------------------------
create table core.documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies(id) on delete cascade,
  owner_module text not null,                 -- e.g. 'accounting'
  entity_type  text,                          -- e.g. 'invoice'
  entity_id    uuid,
  storage_path text not null,
  filename     text not null,
  mime_type    text,
  uploaded_by  uuid references core.users(id),
  created_at   timestamptz not null default now()
);

create index on core.documents (company_id);
create index on core.documents (company_id, entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Audit logs (append-only; populated by triggers in 0004)
-- -----------------------------------------------------------------------------
create table core.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references core.companies(id) on delete set null,
  user_id       uuid references core.users(id) on delete set null,
  action        text not null,                -- insert | update | delete | custom action key
  entity_schema text not null,
  entity_type   text not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);

create index on core.audit_logs (company_id, created_at desc);
create index on core.audit_logs (entity_schema, entity_type, entity_id);

comment on table core.audit_logs is 'Append-only audit trail. Never updated or deleted by application code.';

-- -----------------------------------------------------------------------------
-- Module registry
-- -----------------------------------------------------------------------------
create table core.modules (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,           -- 'accounting', 'survey', ...
  name        text not null,
  description text
);

create table core.company_modules (
  company_id uuid not null references core.companies(id) on delete cascade,
  module_id  uuid not null references core.modules(id) on delete cascade,
  enabled    boolean not null default true,
  settings   jsonb not null default '{}'::jsonb,
  primary key (company_id, module_id)
);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_companies_updated_at before update on core.companies
  for each row execute function core.set_updated_at();
create trigger trg_clients_updated_at before update on core.clients
  for each row execute function core.set_updated_at();
