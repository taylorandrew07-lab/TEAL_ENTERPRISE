-- =============================================================================
-- TEAL Enterprise — Migration 0031: lock down the reference-number generator (F-14)
-- -----------------------------------------------------------------------------
-- freight.next_reference() mutates per-company counters and was directly callable by
-- any authenticated user (default PUBLIC execute), letting them burn shipment / RFQ /
-- quote reference numbers. Make the assign_* trigger functions SECURITY DEFINER so
-- they can still use it, then revoke EXECUTE from callers.
-- =============================================================================

alter function freight.assign_shipment_reference() security definer set search_path = '';
alter function freight.assign_quote_request_reference() security definer set search_path = '';
alter function freight.assign_customer_quote_reference() security definer set search_path = '';

revoke execute on function freight.next_reference(uuid, text, text) from public;
revoke execute on function freight.next_reference(uuid, text, text) from authenticated;
revoke execute on function freight.next_reference(uuid, text, text) from anon;
