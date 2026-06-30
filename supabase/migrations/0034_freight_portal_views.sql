-- =============================================================================
-- TEAL Enterprise — Migration 0034: Freight customer-portal read surface
-- -----------------------------------------------------------------------------
-- Customer Portal, Phase 1. The portal_* views are the ONLY thing an external
-- customer may read. Each view (a) selects ONLY client-safe columns — internal
-- cost/margin/profit, supplier quotes, internal docs/notes and other modules are
-- structurally absent — and (b) scopes every row to the signed-in customer via
-- freight.user_customer_ids() (0033).
--
-- These are SECURITY DEFINER views (NOT security_invoker): they execute as the
-- view owner, which owns the base freight tables and is therefore exempt from
-- their RLS, so the view's own WHERE clause is the single, auditable access gate.
-- This gives BOTH row-scoping AND column-hiding in one place and changes NO
-- existing internal RLS policy. Correctness rests on these WHERE clauses + the
-- impersonation isolation test (supabase/tests/portal_isolation.test.sql).
-- supplier_quotes / charges / tasks / communications get NO portal view at all.
-- =============================================================================

-- Shipment header + tracking (no total_cost / total_charge / expected_profit /
-- owner / carrier / created_by).
create view freight.portal_shipments as
select
  s.id, s.company_id, s.reference, s.stage, s.status, s.mode, s.direction, s.incoterm,
  s.origin_name, s.origin_country, s.destination_name, s.destination_country,
  s.commodity, s.description, s.weight_kg, s.volume_m3, s.packages, s.package_type,
  s.is_dangerous_goods, s.temperature_control,
  s.vessel, s.voyage, s.booking_ref, s.bl_number,
  s.etd, s.eta, s.atd, s.ata, s.opened_at, s.created_at,
  s.customer_contact_id
from freight.shipments s
where s.customer_contact_id in (select freight.user_customer_ids());

-- Milestone timeline (planned/actual dates).
create view freight.portal_milestones as
select m.id, m.shipment_id, m.key, m.planned_at, m.actual_at
from freight.milestones m
join freight.shipments s on s.id = m.shipment_id
where s.customer_contact_id in (select freight.user_customer_ids());

-- Containers + free-time. est_penalty + the per-container charge rates ARE shown
-- (owner decision: the customer should see the demurrage/detention they'd owe).
create view freight.portal_containers as
select
  c.id, c.shipment_id, c.container_no, c.iso_type, c.size, c.ownership, c.seal_no,
  c.status, c.current_location,
  c.loaded_date, c.discharge_date, c.gate_out_date, c.returned_date,
  c.free_time_days, c.demurrage_days, c.detention_days, c.storage_days,
  c.est_penalty, c.demurrage_rate, c.detention_rate, c.storage_rate, c.rate_currency
from freight.containers c
join freight.shipments s on s.id = c.shipment_id
where s.customer_contact_id in (select freight.user_customer_ids());

-- Documents — ONLY client_visible, joined to the bytes metadata in core.documents.
-- Internal (e.g. Master B/L) and client_on_request docs never appear. The portal
-- query layer mints a signed URL via the service role for an already-authorised
-- storage_path (the view is the authorisation), so the storage bucket RLS (0017)
-- is left untouched.
create view freight.portal_documents as
select
  sd.id, sd.shipment_id, sd.document_id, sd.doc_type, sd.title, sd.created_at,
  d.filename, d.mime_type, d.storage_path
from freight.shipment_documents sd
join freight.shipments s on s.id = sd.shipment_id
join core.documents d on d.id = sd.document_id
where sd.visibility = 'client_visible'
  and s.customer_contact_id in (select freight.user_customer_ids());

-- The customer's quotation (selling price only — no total_cost / margin / notes).
-- Drafts are never shown.
create view freight.portal_quote as
select
  cq.id, cq.shipment_id, cq.reference, cq.revision, cq.status, cq.currency_code,
  cq.total_amount, cq.valid_until, cq.sent_at, cq.decided_at
from freight.customer_quotes cq
join freight.shipments s on s.id = cq.shipment_id
where cq.status <> 'draft'
  and s.customer_contact_id in (select freight.user_customer_ids());

-- Customer-quotation line items only (NEVER supplier-quote lines).
create view freight.portal_quote_lines as
select
  ql.id, ql.customer_quote_id, ql.charge_code, ql.description, ql.quantity, ql.unit,
  ql.rate, ql.currency_code, ql.amount, ql.sort_order
from freight.quote_lines ql
join freight.customer_quotes cq on cq.id = ql.customer_quote_id
join freight.shipments s on s.id = cq.shipment_id
where ql.customer_quote_id is not null
  and cq.status <> 'draft'
  and s.customer_contact_id in (select freight.user_customer_ids());

-- What the customer owes / has paid (freight's own AR side; never the accounting
-- schema). Payment status is derived in the app via the existing paymentStatus().
create view freight.portal_billing as
select
  sb.shipment_id, sb.invoice_total, sb.amount_paid, sb.payment_terms,
  sb.released, sb.released_at
from freight.shipment_billing sb
join freight.shipments s on s.id = sb.shipment_id
where s.customer_contact_id in (select freight.user_customer_ids());

-- The customer's own contact (display name for the portal header).
create view freight.portal_customer as
select c.id, c.name
from freight.contacts c
where c.id in (select freight.user_customer_ids());

grant select on freight.portal_shipments   to authenticated;
grant select on freight.portal_milestones  to authenticated;
grant select on freight.portal_containers  to authenticated;
grant select on freight.portal_documents   to authenticated;
grant select on freight.portal_quote       to authenticated;
grant select on freight.portal_quote_lines to authenticated;
grant select on freight.portal_billing     to authenticated;
grant select on freight.portal_customer    to authenticated;
