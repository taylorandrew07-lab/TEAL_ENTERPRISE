-- =============================================================================
-- TEAL Enterprise — Migration 0009: expose core/accounting/cargo to the Data API
-- -----------------------------------------------------------------------------
-- By default Supabase only exposes `public` (+ graphql_public) to PostgREST, so
-- supabase-js `.schema('core')` / `.schema('accounting')` / `.schema('cargo')`
-- calls fail and the app sees no company/modules. This exposes the platform +
-- module schemas to the Data API (RLS still enforces tenant isolation). This is
-- the same mechanism the Supabase dashboard "Exposed schemas" setting uses.
-- =============================================================================

-- API roles need USAGE on the schemas (table-level grants remain authenticated-only
-- from the earlier migrations; anon still reads nothing because RLS + no table grants).
grant usage on schema core, accounting, cargo to anon, authenticated, service_role;

-- PostgREST exposed-schema list (must include the existing public + graphql_public).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, core, accounting, cargo';

-- Tell PostgREST to reload its config and schema cache so the change is live.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
