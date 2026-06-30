-- =============================================================================
-- TEAL Enterprise — Migration 0037: restore service_role grants on app schemas
-- -----------------------------------------------------------------------------
-- The earlier schema migrations granted table/function privileges to `authenticated`
-- only (RLS does the gating there). They omitted `service_role` — the trusted,
-- SERVER-ONLY backend role (bypasses RLS by design; its key never reaches the
-- browser). That omission breaks any server code using the service-role client to
-- touch app tables — notably the customer-portal admin action, which looks up
-- core.users by email and reads portal-user emails. This restores service_role to
-- the conventional Supabase posture (full access to the app schemas) and sets
-- default privileges so future tables are covered too.
-- No RLS policy is changed; no end-user (anon/authenticated) gains anything.
-- =============================================================================
do $$
declare s text;
begin
  foreach s in array array['core', 'accounting', 'cargo', 'freight'] loop
    execute format('grant usage on schema %I to service_role', s);
    execute format('grant all on all tables in schema %I to service_role', s);
    execute format('grant all on all routines in schema %I to service_role', s);
    execute format('grant all on all sequences in schema %I to service_role', s);
    execute format('alter default privileges in schema %I grant all on tables to service_role', s);
    execute format('alter default privileges in schema %I grant all on routines to service_role', s);
    execute format('alter default privileges in schema %I grant all on sequences to service_role', s);
  end loop;
end $$;
