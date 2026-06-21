-- =============================================================================
-- TEAL Enterprise — Migration 0006: Cargo Assurance RLS, helpers, and grants
-- -----------------------------------------------------------------------------
-- Enables RLS on every `cargo` table. Internal tenant policies mirror the
-- accounting style: SELECT requires active company membership (or super admin);
-- INSERT/UPDATE/DELETE require the relevant cargo.* permission on the row's
-- company. Adds ADDITIVE client-portal SELECT policies so external users in
-- cargo.client_access may read ONLY published review snapshots / published
-- review headers for THEIR client_id — never documents, drafts, exceptions,
-- or any other client's data. Tenant isolation is never weakened.
-- Conforms to docs/cargo-assurance/_FUEL-SPEC.md §3/§4 and docs/security-and-permissions.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Client-portal helper. Returns the client_ids the current user has ACTIVE
-- cargo.client_access to. SECURITY DEFINER with an empty search_path and
-- fully-qualified names, matching the core helpers in 0003.
-- -----------------------------------------------------------------------------
create or replace function cargo.user_client_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select ca.client_id
  from cargo.client_access ca
  where ca.user_id = auth.uid() and ca.status = 'active';
$$;

-- -----------------------------------------------------------------------------
-- Schema + object grants. RLS does the gating; these grants merely allow the
-- authenticated role to attempt access. anon gets nothing. service_role bypasses RLS.
-- -----------------------------------------------------------------------------
grant usage on schema cargo to authenticated;
grant select, insert, update, delete on all tables in schema cargo to authenticated;
grant select on cargo.published_reviews to authenticated;
grant execute on function cargo.user_client_ids() to authenticated;

-- The published_reviews view must run with the invoker's privileges so the
-- underlying assurance_reviews RLS applies (Postgres 15+). Without this the
-- view owner would bypass RLS.
alter view cargo.published_reviews set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- Standard tenant tables: read = active membership; write = relevant permission.
-- Every table below carries a company_id column. Permission keys per spec §3:
--   reviews          -> cargo.reviews.manage
--   snapshots        -> cargo.reviews.publish
--   documents/import -> cargo.documents.upload
--   extracted/corr   -> cargo.extraction.correct
--   loadouts/hire/   -> cargo.data.review
--     measurements/results/exceptions/aggregates/analytics/findings
--   config/templates/methods/procedures -> cargo.config.manage
--   assets (terminals/vessels/tanks/meters/products) -> cargo.assets.manage
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- configuration & reference
      ('client_procedures',        'cargo.config.manage'),
      ('calculation_methodologies','cargo.config.manage'),
      ('extraction_templates',     'cargo.config.manage'),
      ('terminals',                'cargo.assets.manage'),
      ('vessels',                  'cargo.assets.manage'),
      ('vessel_tanks',             'cargo.assets.manage'),
      ('meters',                   'cargo.assets.manage'),
      ('products',                 'cargo.assets.manage'),
      -- reviews
      ('assurance_reviews',        'cargo.reviews.manage'),
      ('review_snapshots',         'cargo.reviews.publish'),
      -- ingestion
      ('import_batches',           'cargo.documents.upload'),
      ('documents',                'cargo.documents.upload'),
      ('extracted_fields',         'cargo.extraction.correct'),
      ('field_corrections',        'cargo.extraction.correct'),
      -- loadouts & measurements
      ('loadouts',                 'cargo.data.review'),
      ('loadout_documents',        'cargo.data.review'),
      ('loadout_tank_readings',    'cargo.data.review'),
      ('loadout_measurements',     'cargo.data.review'),
      ('loadout_results',          'cargo.data.review'),
      ('loadout_adjustments',      'cargo.data.review'),
      ('internal_transfers',       'cargo.data.review'),
      ('consumption_records',      'cargo.data.review'),
      -- hire periods
      ('hire_periods',             'cargo.data.review'),
      ('hire_period_documents',    'cargo.data.review'),
      ('hire_tank_readings',       'cargo.data.review'),
      ('hire_period_results',      'cargo.data.review'),
      -- exceptions, analytics, findings
      ('data_exceptions',          'cargo.data.review'),
      ('review_aggregates',        'cargo.data.review'),
      ('meter_analytics',          'cargo.data.review'),
      ('findings',                 'cargo.data.review')
    ) as t(tbl, perm)
  loop
    execute format('alter table cargo.%I enable row level security', r.tbl);

    -- Helpers wrapped in a scalar sub-select so they evaluate once per statement
    -- (per distinct company_id), not per row — matters for bulk document/loadout writes.
    execute format(
      'create policy %I on cargo.%I for select using ((select core.is_super_admin()) or company_id in (select core.user_companies()))',
      r.tbl || '_sel', r.tbl);

    execute format(
      'create policy %I on cargo.%I for insert with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_ins', r.tbl, r.perm);

    execute format(
      'create policy %I on cargo.%I for update using ((select core.has_permission(company_id, %L))) with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_upd', r.tbl, r.perm, r.perm);

    execute format(
      'create policy %I on cargo.%I for delete using ((select core.has_permission(company_id, %L)))',
      r.tbl || '_del', r.tbl, r.perm);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Audit coverage for the security-significant cargo governance tables, so the
-- assurance trail (who changed reviews, corrections, snapshots, portal access,
-- documents) is tamper-evident. Uses the same SECURITY DEFINER core.audit_trigger.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'assurance_reviews', 'review_snapshots', 'field_corrections',
    'client_access', 'documents', 'loadouts'
  ] loop
    execute format(
      'create trigger trg_audit after insert or update or delete on cargo.%I for each row execute function core.audit_trigger()',
      t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- cargo.client_access: internal management of external portal users.
-- Read by company members; managed with cargo.config.manage. Additionally, an
-- external user may read their OWN access rows so the portal can resolve them.
-- -----------------------------------------------------------------------------
alter table cargo.client_access enable row level security;
create policy client_access_sel on cargo.client_access for select
  using (
    core.is_super_admin()
    or company_id in (select core.user_companies())
    or user_id = auth.uid()
  );
create policy client_access_ins on cargo.client_access for insert
  with check (core.has_permission(company_id, 'cargo.config.manage'));
create policy client_access_upd on cargo.client_access for update
  using (core.has_permission(company_id, 'cargo.config.manage'))
  with check (core.has_permission(company_id, 'cargo.config.manage'));
create policy client_access_del on cargo.client_access for delete
  using (core.has_permission(company_id, 'cargo.config.manage'));

-- =============================================================================
-- ADDITIVE client-portal SELECT policies.
-- Postgres combines multiple permissive policies for the same command with OR,
-- so these widen read access for external client users WITHOUT touching the
-- tenant policies above. They are deliberately scoped to:
--   * only rows for a client_id the user has ACTIVE cargo.client_access to, and
--   * only data tied to a PUBLISHED review.
-- No client-portal policies exist for documents, drafts, exceptions, raw
-- extraction, or any other table — external users simply cannot read them.
-- =============================================================================

-- Published snapshots for the user's client(s). The snapshot is the reproducible
-- published artefact; gated through its parent review's published status.
create policy review_snapshots_client_sel on cargo.review_snapshots for select
  using (
    exists (
      select 1
      from cargo.assurance_reviews ar
      where ar.id = cargo.review_snapshots.review_id
        and ar.status = 'published'
        and ar.client_id in (select cargo.user_client_ids())
    )
  );

-- The minimal published review header for the user's client(s).
create policy assurance_reviews_client_sel on cargo.assurance_reviews for select
  using (
    status = 'published'
    and client_id in (select cargo.user_client_ids())
  );

-- =============================================================================
-- Grants finalised. (Table privileges granted above apply to all current cargo
-- tables; the policies enforce row-level visibility.)
-- =============================================================================
