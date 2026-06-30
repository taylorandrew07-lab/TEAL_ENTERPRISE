-- =============================================================================
-- TEAL Enterprise — Migration 0024: Freight container penalty rates
-- -----------------------------------------------------------------------------
-- Per-container daily rates so the free-time engine can estimate penalty AMOUNTS
-- (not just days): est_penalty = demurrage_days*demurrage_rate
--                              + detention_days*detention_rate
--                              + storage_days*storage_rate.
-- Rates are per-container overrides for now; carrier/contract rate tables can be
-- layered later. See docs/freight/_FREIGHT-SPEC.md §6.
-- =============================================================================

alter table freight.containers
  add column demurrage_rate numeric(20,4),
  add column detention_rate numeric(20,4),
  add column storage_rate   numeric(20,4),
  add column rate_currency  char(3);
