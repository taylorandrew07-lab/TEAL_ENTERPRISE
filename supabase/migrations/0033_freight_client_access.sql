-- =============================================================================
-- TEAL Enterprise — Migration 0033: Freight customer-portal access
-- -----------------------------------------------------------------------------
-- Customer Portal, Phase 1 (security foundation). Mirrors the proven cargo
-- client-portal pattern (0005/0006): a bridge table linking an external auth user
-- to ONE customer contact, plus a SECURITY DEFINER helper returning the customer
-- contact ids the current user may see. External portal users are NEVER company
-- members (no core.company_memberships row), so the internal SELECT policies
-- (0025 core.can_read) already deny them every base table; the curated portal_*
-- views in 0034 are their only window. See docs/freight/_FREIGHT-SPEC.md (portal).
-- =============================================================================

create type freight.client_access_status as enum ('active', 'suspended', 'revoked');

-- External client-portal access. An ACTIVE row lets the user read ONLY the
-- portal_* views for THEIR customer_contact_id — never base freight tables.
create table freight.client_access (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  customer_contact_id uuid not null,
  user_id             uuid not null references core.users(id) on delete cascade,
  role                text not null default 'freight_client_viewer',
  status              freight.client_access_status not null default 'active',
  created_by          uuid references core.users(id),
  created_at          timestamptz not null default now(),
  foreign key (company_id, customer_contact_id) references freight.contacts (company_id, id) on delete cascade,
  unique (customer_contact_id, user_id)
);
create index on freight.client_access (company_id);
create index on freight.client_access (user_id);
create index on freight.client_access (customer_contact_id);
comment on table freight.client_access is 'External customer-portal access. Active rows grant read-only portal access to ONE customer contact''s shipments. Never a company membership.';

-- The customer-contact ids the current user has ACTIVE portal access to.
-- SECURITY DEFINER + empty search_path + fully-qualified names (mirrors
-- cargo.user_client_ids / the core helpers in 0003). Returns nothing for staff
-- (who have no client_access row), so the portal views are a no-op for them.
create or replace function freight.user_customer_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select ca.customer_contact_id
  from freight.client_access ca
  where ca.user_id = auth.uid() and ca.status = 'active';
$$;

-- Grants for the new objects (schema-wide grants only cover tables that existed
-- when they ran). RLS does the gating.
grant select, insert, update, delete on freight.client_access to authenticated;
grant execute on function freight.user_customer_ids() to authenticated;

-- RLS: staff read/manage gated by the freight module + comms.manage; the portal
-- user may read ONLY their own access rows (so getPortalContext can resolve them).
alter table freight.client_access enable row level security;

create policy client_access_sel on freight.client_access for select
  using ((select core.can_read(company_id, 'freight')));

create policy client_access_self_sel on freight.client_access for select
  using (user_id = auth.uid());

create policy client_access_ins on freight.client_access for insert
  with check ((select core.has_permission(company_id, 'freight.comms.manage')));

create policy client_access_upd on freight.client_access for update
  using ((select core.has_permission(company_id, 'freight.comms.manage')))
  with check ((select core.has_permission(company_id, 'freight.comms.manage')));

create policy client_access_del on freight.client_access for delete
  using ((select core.has_permission(company_id, 'freight.comms.manage')));

create trigger trg_audit after insert or update or delete on freight.client_access
  for each row execute function core.audit_trigger();
