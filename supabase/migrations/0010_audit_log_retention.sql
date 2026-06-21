-- =============================================================================
-- TEAL Enterprise — Migration 0010: audit-log retention (don't block deletes)
-- -----------------------------------------------------------------------------
-- core.audit_logs has an AFTER DELETE trigger on tenant tables (incl. core.companies).
-- When a company is deleted, that trigger inserts an audit row referencing the
-- just-deleted company_id — which violated the audit_logs.company_id FK and made
-- company deletion impossible. Audit logs are append-only history and should survive
-- their subject's deletion, so we drop the hard FK (keep the column for filtering).
-- =============================================================================

alter table core.audit_logs drop constraint if exists audit_logs_company_id_fkey;
alter table core.audit_logs drop constraint if exists audit_logs_user_id_fkey;
