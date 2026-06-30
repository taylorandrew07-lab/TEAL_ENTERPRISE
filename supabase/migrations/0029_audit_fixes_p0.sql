-- =============================================================================
-- TEAL Enterprise — Migration 0029: external audit P0 fixes
-- -----------------------------------------------------------------------------
-- F-06  Expose the `freight` schema to the production Data API (0009 only listed
--       core/accounting/cargo, so freight data calls failed in prod).
-- F-01  Restore the PRIVATE accounting SELECT policies that 0025's blanket rewrite
--       clobbered: parallel_rates (private.view) and treasury_* (banking.private).
-- F-05  Cargo module-key mismatch: 0025 gated cargo tables on module 'cargo', but the
--       module key is 'cargo_assurance'. Re-gate cargo SELECT on 'cargo_assurance'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- F-06 — expose freight to PostgREST (RLS still enforces everything).
-- -----------------------------------------------------------------------------
grant usage on schema freight to anon, authenticated, service_role;
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, core, accounting, cargo, freight';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- F-01 — restore private accounting read gates (has_permission already includes
-- super admin). These are truly private: gated by the private permission, NOT by
-- mere module access.
-- -----------------------------------------------------------------------------
drop policy if exists parallel_rates_sel on accounting.parallel_rates;
create policy parallel_rates_sel on accounting.parallel_rates for select
  using ((select core.has_permission(company_id, 'private.view')));

do $$
declare t text;
begin
  foreach t in array array['treasury_banks', 'treasury_accounts', 'treasury_statements', 'treasury_transactions'] loop
    execute format('drop policy if exists %I on accounting.%I', t || '_sel', t);
    execute format(
      'create policy %I on accounting.%I for select using ((select core.has_permission(company_id, %L)))',
      t || '_sel', t, 'banking.private');
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- F-05 — re-gate cargo SELECT policies on the correct module key 'cargo_assurance'
-- (schema name 'cargo' != module key). Mirrors the 0025 loop, cargo schema only.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'cargo'
      and cmd = 'SELECT'
      and policyname ~ '_sel$'
      and policyname !~ 'client_sel$'
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = r.schemaname and table_name = r.tablename and column_name = 'company_id'
    ) then
      execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      execute format(
        'create policy %I on %I.%I for select using ((select core.can_read(company_id, %L)))',
        r.policyname, r.schemaname, r.tablename, 'cargo_assurance');
    end if;
  end loop;
end $$;
