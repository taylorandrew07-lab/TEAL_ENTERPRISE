// Read-side data access for Freight Forwarding (server components). RLS scopes all
// results to the active company. Contact names are resolved in JS to keep queries
// simple and avoid cross-row embeds. Mirrors the cargo-assurance queries pattern.
import { freightDb } from './context';
import { computeFreeTime } from './freetime';
import type { ShipmentStage, ShipmentStatus, ShipmentMode, ShipmentDirection } from './lifecycle';

// ----------------------------------------------------------------------------- types
export interface ContactRow {
  id: string;
  name: string;
  kind: string;
  roles: string[] | null;
  country_code: string | null;
  is_active: boolean;
  emails: { label?: string; address?: string }[] | null;
  phones: { label?: string; number?: string }[] | null;
}

export interface ShipmentRow {
  id: string;
  reference: string | null;
  stage: ShipmentStage;
  status: ShipmentStatus;
  mode: ShipmentMode | null;
  direction: ShipmentDirection | null;
  origin_name: string | null;
  destination_name: string | null;
  commodity: string | null;
  eta: string | null;
  etd: string | null;
  customer_contact_id: string | null;
  customerName: string | null;
  total_charge: number;
  total_cost: number;
  expected_profit: number;
  currency_code: string | null;
  created_at: string;
}

export interface ShipmentDetail extends ShipmentRow {
  incoterm: string | null;
  description: string | null;
  weight_kg: number | null;
  volume_m3: number | null;
  packages: number | null;
  package_type: string | null;
  is_dangerous_goods: boolean;
  temperature_control: string | null;
  vessel: string | null;
  voyage: string | null;
  booking_ref: string | null;
  bl_number: string | null;
  ata: string | null;
  atd: string | null;
  origin_country: string | null;
  destination_country: string | null;
  carrier_contact_id: string | null;
  owner_user_id: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface PartyRow { id: string; contact_id: string; role: string; contactName: string | null; }
export interface MilestoneRow { id: string; key: string; planned_at: string | null; actual_at: string | null; source: string; }
export interface TaskRow {
  id: string; title: string; description: string | null; status: string; priority: string;
  due_at: string | null; shipment_id: string | null; assignee_user_id: string | null;
  auto_generated: boolean; shipmentRef?: string | null;
}
export interface CommunicationRow {
  id: string; channel: string; direction: string; subject: string | null; body: string | null;
  occurred_at: string; ai_generated: boolean; party_contact_id: string | null;
}
export interface ChargeRow {
  id: string; kind: 'cost' | 'charge'; description: string; charge_code: string | null;
  amount: number; currency_code: string | null; contact_id: string | null; invoiced: boolean;
}
export interface ContainerRow {
  id: string; container_no: string | null; iso_type: string | null; size: string | null;
  ownership: string | null; status: string; current_location: string | null;
  free_time_days: number | null; demurrage_days: number; detention_days: number; storage_days: number;
  discharge_date: string | null; gate_out_date: string | null; returned_date: string | null;
  demurrage_rate: number | null; detention_rate: number | null; storage_rate: number | null;
  rate_currency: string | null; est_penalty: number;
  shipment_id?: string | null; shipmentRef?: string | null;
}

// ----------------------------------------------------------------------------- helpers
async function contactNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { freight } = await freightDb();
  const { data } = await freight.from('contacts').select('id, name').in('id', unique);
  return new Map((data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
}

// ----------------------------------------------------------------------------- contacts
export async function listContacts(): Promise<ContactRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('contacts')
    .select('id, name, kind, roles, country_code, is_active, emails, phones')
    .eq('company_id', companyId)
    .order('name');
  return (data as ContactRow[] | null) ?? [];
}

export async function getContact(id: string): Promise<ContactRow | null> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return null;
  const { data } = await freight
    .from('contacts')
    .select('id, name, kind, roles, country_code, is_active, emails, phones')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();
  return (data as ContactRow | null) ?? null;
}

// ----------------------------------------------------------------------------- shipments
export async function listShipments(filter?: { stage?: string; status?: string }): Promise<ShipmentRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  let q = freight
    .from('shipments')
    .select('id, reference, stage, status, mode, direction, origin_name, destination_name, commodity, eta, etd, customer_contact_id, total_charge, total_cost, expected_profit, currency_code, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (filter?.stage) q = q.eq('stage', filter.stage);
  if (filter?.status) q = q.eq('status', filter.status);
  const { data } = await q;
  const rows = (data as any[] | null) ?? [];
  const names = await contactNameMap(rows.map((r) => r.customer_contact_id));
  return rows.map((r) => ({ ...r, customerName: names.get(r.customer_contact_id) ?? null }));
}

export async function getShipment(id: string): Promise<ShipmentDetail | null> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return null;
  const { data } = await freight
    .from('shipments')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const r = data as any;
  const names = await contactNameMap([r.customer_contact_id]);
  return { ...r, customerName: names.get(r.customer_contact_id) ?? null } as ShipmentDetail;
}

export async function getShipmentParties(shipmentId: string): Promise<PartyRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('shipment_parties')
    .select('id, contact_id, role')
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId);
  const rows = (data as any[] | null) ?? [];
  const names = await contactNameMap(rows.map((r) => r.contact_id));
  return rows.map((r) => ({ ...r, contactName: names.get(r.contact_id) ?? null }));
}

export async function getShipmentMilestones(shipmentId: string): Promise<MilestoneRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('milestones')
    .select('id, key, planned_at, actual_at, source')
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId);
  return (data as MilestoneRow[] | null) ?? [];
}

export async function getShipmentTasks(shipmentId: string): Promise<TaskRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('tasks')
    .select('id, title, description, status, priority, due_at, shipment_id, assignee_user_id, auto_generated')
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId)
    .order('created_at');
  return (data as TaskRow[] | null) ?? [];
}

export async function getShipmentCommunications(shipmentId: string): Promise<CommunicationRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('communications')
    .select('id, channel, direction, subject, body, occurred_at, ai_generated, party_contact_id')
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false });
  return (data as CommunicationRow[] | null) ?? [];
}

export async function getShipmentCharges(shipmentId: string): Promise<ChargeRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('charges')
    .select('id, kind, description, charge_code, amount, currency_code, contact_id, invoiced')
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId)
    .order('created_at');
  return (data as ChargeRow[] | null) ?? [];
}

const CONTAINER_COLS = 'id, container_no, iso_type, size, ownership, status, current_location, free_time_days, demurrage_days, detention_days, storage_days, discharge_date, gate_out_date, returned_date, demurrage_rate, detention_rate, storage_rate, rate_currency, est_penalty, shipment_id';

export async function getShipmentContainers(shipmentId: string): Promise<ContainerRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('containers')
    .select(CONTAINER_COLS)
    .eq('company_id', companyId)
    .eq('shipment_id', shipmentId);
  return (data as ContainerRow[] | null) ?? [];
}

export async function listAllContainers(): Promise<ContainerRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('containers')
    .select(CONTAINER_COLS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  const rows = (data as ContainerRow[] | null) ?? [];
  return attachShipmentRefs(rows as any) as Promise<ContainerRow[]>;
}

export interface TrackingEventRow {
  id: string; event_type: string; location: string | null; vessel: string | null;
  voyage: string | null; eta: string | null; occurred_at: string | null; source: string | null;
}

export async function getContainerTrackingEvents(containerId: string): Promise<TrackingEventRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('tracking_events')
    .select('id, event_type, location, vessel, voyage, eta, occurred_at, source')
    .eq('company_id', companyId).eq('container_id', containerId)
    .order('occurred_at', { ascending: false }).limit(50);
  return (data as TrackingEventRow[] | null) ?? [];
}

// ----------------------------------------------------------------------------- tasks (cross-shipment)
export async function listOpenTasks(): Promise<TaskRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('tasks')
    .select('id, title, description, status, priority, due_at, shipment_id, assignee_user_id, auto_generated')
    .eq('company_id', companyId)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .order('due_at', { ascending: true, nullsFirst: false });
  const rows = (data as TaskRow[] | null) ?? [];
  // attach shipment references
  const shipmentIds = [...new Set(rows.map((t) => t.shipment_id).filter(Boolean) as string[])];
  if (shipmentIds.length) {
    const { data: ships } = await freight.from('shipments').select('id, reference').in('id', shipmentIds);
    const refs = new Map((ships ?? []).map((s: { id: string; reference: string | null }) => [s.id, s.reference]));
    return rows.map((t) => ({ ...t, shipmentRef: t.shipment_id ? refs.get(t.shipment_id) ?? null : null }));
  }
  return rows;
}

// ----------------------------------------------------------------------------- dashboard
export interface DashboardStats {
  activeShipments: number;
  inTransit: number;
  pendingQuotes: number;
  awaitingApproval: number;
  openTasks: number;
  arrivingSoon: number;
  freeTimeRisk: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { freight, companyId } = await freightDb();
  const empty: DashboardStats = { activeShipments: 0, inTransit: 0, pendingQuotes: 0, awaitingApproval: 0, openTasks: 0, arrivingSoon: 0, freeTimeRisk: 0 };
  if (!companyId) return empty;

  const count = async (build: (q: any) => any): Promise<number> => {
    const base = freight.from('shipments').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
    const { count: c } = await build(base);
    return c ?? 0;
  };

  const [activeShipments, inTransit, awaitingApproval] = await Promise.all([
    count((q) => q.eq('status', 'active')),
    count((q) => q.eq('stage', 'in_transit')),
    count((q) => q.eq('stage', 'customer_approval')),
  ]);

  const { count: pendingQuotes } = await freight
    .from('customer_quotes').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('status', 'sent');

  const { count: openTasks } = await freight
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).neq('status', 'done').neq('status', 'cancelled');

  // arriving within 7 days
  const horizon = new Date(); horizon.setUTCDate(horizon.getUTCDate() + 7);
  const { count: arrivingSoon } = await freight
    .from('shipments').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('eta', new Date().toISOString().slice(0, 10))
    .lte('eta', horizon.toISOString().slice(0, 10));

  // free-time risk: containers not yet returned, with demurrage/detention incurred or free time running out
  const { data: ctrs } = await freight
    .from('containers')
    .select('free_time_days, discharge_date, gate_out_date, returned_date')
    .eq('company_id', companyId).is('returned_date', null);
  const freeTimeRisk = ((ctrs as any[] | null) ?? [])
    .map((c) => computeFreeTime(c).risk).filter((r) => r !== 'none').length;

  return {
    activeShipments,
    inTransit,
    awaitingApproval,
    pendingQuotes: pendingQuotes ?? 0,
    openTasks: openTasks ?? 0,
    arrivingSoon: arrivingSoon ?? 0,
    freeTimeRisk,
  };
}

// ----------------------------------------------------------------------------- quotes: types
export interface RfqRow {
  id: string; reference: string | null; status: string; due_by: string | null;
  shipment_id: string | null; shipmentRef?: string | null; created_at: string;
  recipientCount?: number; quoteCount?: number;
}
export interface RecipientRow {
  id: string; contact_id: string; status: string; sent_at: string | null; responded_at: string | null; contactName: string | null;
}
export interface SupplierQuoteRow {
  id: string; contact_id: string; status: string; currency_code: string | null;
  total_amount: number | null; transit_time_days: number | null; valid_until: string | null;
  notes: string | null; received_at: string; contactName: string | null;
}
export interface CustomerQuoteRow {
  id: string; reference: string | null; revision: number; status: string; currency_code: string | null;
  total_amount: number; total_cost: number; margin: number; valid_until: string | null;
  shipment_id: string; shipmentRef?: string | null; created_at: string;
}
export interface QuoteLineRow {
  id: string; charge_code: string | null; description: string; quantity: number; unit: string | null;
  rate: number; currency_code: string | null; amount: number; sort_order: number;
}

// ----------------------------------------------------------------------------- quotes: RFQs
export async function listRfqs(): Promise<RfqRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('quote_requests')
    .select('id, reference, status, due_by, shipment_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  const rows = (data as RfqRow[] | null) ?? [];
  return attachShipmentRefs(rows);
}

export async function getRfq(id: string): Promise<RfqRow | null> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return null;
  const { data } = await freight
    .from('quote_requests')
    .select('id, reference, status, due_by, shipment_id, created_at')
    .eq('company_id', companyId).eq('id', id).maybeSingle();
  if (!data) return null;
  const [withRef] = await attachShipmentRefs([data as RfqRow]);
  return withRef;
}

export async function getRfqRecipients(rfqId: string): Promise<RecipientRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('quote_request_recipients')
    .select('id, contact_id, status, sent_at, responded_at')
    .eq('company_id', companyId).eq('quote_request_id', rfqId);
  const rows = (data as any[] | null) ?? [];
  const names = await contactNameMap(rows.map((r) => r.contact_id));
  return rows.map((r) => ({ ...r, contactName: names.get(r.contact_id) ?? null }));
}

export async function getSupplierQuotesForRfq(rfqId: string): Promise<SupplierQuoteRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('supplier_quotes')
    .select('id, contact_id, status, currency_code, total_amount, transit_time_days, valid_until, notes, received_at')
    .eq('company_id', companyId).eq('quote_request_id', rfqId)
    .order('total_amount', { ascending: true, nullsFirst: false });
  const rows = (data as any[] | null) ?? [];
  const names = await contactNameMap(rows.map((r) => r.contact_id));
  return rows.map((r) => ({ ...r, contactName: names.get(r.contact_id) ?? null }));
}

// ----------------------------------------------------------------------------- quotes: customer quotes
export async function listCustomerQuotes(): Promise<CustomerQuoteRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('customer_quotes')
    .select('id, reference, revision, status, currency_code, total_amount, total_cost, margin, valid_until, shipment_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  const rows = (data as CustomerQuoteRow[] | null) ?? [];
  return attachShipmentRefs(rows) as Promise<CustomerQuoteRow[]>;
}

export async function getCustomerQuote(id: string): Promise<CustomerQuoteRow | null> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return null;
  const { data } = await freight
    .from('customer_quotes')
    .select('id, reference, revision, status, currency_code, total_amount, total_cost, margin, valid_until, shipment_id, created_at')
    .eq('company_id', companyId).eq('id', id).maybeSingle();
  if (!data) return null;
  const [withRef] = await attachShipmentRefs([data as CustomerQuoteRow]);
  return withRef as CustomerQuoteRow;
}

export async function getQuoteLines(customerQuoteId: string): Promise<QuoteLineRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('quote_lines')
    .select('id, charge_code, description, quantity, unit, rate, currency_code, amount, sort_order')
    .eq('company_id', companyId).eq('customer_quote_id', customerQuoteId)
    .order('sort_order');
  return (data as QuoteLineRow[] | null) ?? [];
}

// RFQs + customer quotes attached to a single shipment (for the workspace).
export async function getShipmentQuotes(shipmentId: string): Promise<{ rfqs: RfqRow[]; customerQuotes: CustomerQuoteRow[] }> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return { rfqs: [], customerQuotes: [] };
  const [{ data: rfqs }, { data: cqs }] = await Promise.all([
    freight.from('quote_requests').select('id, reference, status, due_by, shipment_id, created_at').eq('company_id', companyId).eq('shipment_id', shipmentId).order('created_at', { ascending: false }),
    freight.from('customer_quotes').select('id, reference, revision, status, currency_code, total_amount, total_cost, margin, valid_until, shipment_id, created_at').eq('company_id', companyId).eq('shipment_id', shipmentId).order('revision', { ascending: false }),
  ]);
  return { rfqs: (rfqs as RfqRow[] | null) ?? [], customerQuotes: (cqs as CustomerQuoteRow[] | null) ?? [] };
}

// ----------------------------------------------------------------------------- payment & release
export interface ShipmentBilling {
  invoice_total: number; amount_paid: number; payment_terms: string;
  released: boolean; released_at: string | null;
}
export interface PaymentRow {
  id: string; amount: number; currency_code: string | null; method: string | null;
  reference: string | null; paid_at: string | null;
}

export async function getShipmentBilling(shipmentId: string): Promise<ShipmentBilling> {
  const empty: ShipmentBilling = { invoice_total: 0, amount_paid: 0, payment_terms: 'prepaid', released: false, released_at: null };
  const { freight, companyId } = await freightDb();
  if (!companyId) return empty;
  const { data } = await freight.from('shipment_billing')
    .select('invoice_total, amount_paid, payment_terms, released, released_at')
    .eq('company_id', companyId).eq('shipment_id', shipmentId).maybeSingle();
  return (data as ShipmentBilling | null) ?? empty;
}

export async function getShipmentPayments(shipmentId: string): Promise<PaymentRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('shipment_payments')
    .select('id, amount, currency_code, method, reference, paid_at')
    .eq('company_id', companyId).eq('shipment_id', shipmentId)
    .order('paid_at', { ascending: false });
  return (data as PaymentRow[] | null) ?? [];
}

export function paymentStatus(b: ShipmentBilling): 'uninvoiced' | 'unpaid' | 'partial' | 'paid' {
  if (!(b.invoice_total > 0)) return 'uninvoiced';
  if (b.amount_paid <= 0) return 'unpaid';
  if (b.amount_paid < b.invoice_total) return 'partial';
  return 'paid';
}

// ----------------------------------------------------------------------------- global search
export interface SearchResults {
  term: string;
  shipments: { id: string; reference: string | null; stage: string; commodity: string | null; lane: string; customerName: string | null }[];
  contacts: { id: string; name: string; roles: string[] | null }[];
  containers: { id: string; container_no: string | null; shipment_id: string | null; status: string; shipmentRef: string | null }[];
  customerQuotes: { id: string; reference: string | null; shipment_id: string; status: string }[];
  rfqs: { id: string; reference: string | null; shipment_id: string | null; status: string }[];
  total: number;
}

// One box → shipments, contacts, containers, quotations and RFQs. RLS scopes every
// query to the active company; results are read-only (any company member may read).
export async function globalSearch(rawTerm: string): Promise<SearchResults> {
  const term = (rawTerm ?? '').replace(/[%,()*]/g, ' ').trim();
  const empty: SearchResults = { term, shipments: [], contacts: [], containers: [], customerQuotes: [], rfqs: [], total: 0 };
  const { freight, companyId } = await freightDb();
  if (!companyId || term.length < 2) return empty;
  const like = `%${term}%`;

  const [shipRes, contactRes, ctrRes, cqRes, rfqRes] = await Promise.all([
    freight.from('shipments')
      .select('id, reference, stage, commodity, origin_name, destination_name, customer_contact_id')
      .eq('company_id', companyId)
      .or(`reference.ilike.${like},commodity.ilike.${like},origin_name.ilike.${like},destination_name.ilike.${like},vessel.ilike.${like},voyage.ilike.${like},booking_ref.ilike.${like},bl_number.ilike.${like}`)
      .limit(12),
    freight.from('contacts')
      .select('id, name, roles')
      .eq('company_id', companyId)
      .or(`name.ilike.${like},tax_id.ilike.${like},country_code.ilike.${like}`)
      .limit(12),
    freight.from('containers')
      .select('id, container_no, shipment_id, status')
      .eq('company_id', companyId)
      .or(`container_no.ilike.${like},seal_no.ilike.${like},current_location.ilike.${like}`)
      .limit(12),
    freight.from('customer_quotes')
      .select('id, reference, shipment_id, status')
      .eq('company_id', companyId)
      .ilike('reference', like)
      .limit(12),
    freight.from('quote_requests')
      .select('id, reference, shipment_id, status')
      .eq('company_id', companyId)
      .ilike('reference', like)
      .limit(12),
  ]);

  const shipRows = (shipRes.data as any[] | null) ?? [];
  const names = await contactNameMap(shipRows.map((r) => r.customer_contact_id));
  const shipments = shipRows.map((r) => ({
    id: r.id, reference: r.reference, stage: r.stage, commodity: r.commodity,
    lane: [r.origin_name, r.destination_name].filter(Boolean).join(' → '),
    customerName: names.get(r.customer_contact_id) ?? null,
  }));

  const ctrRows = (ctrRes.data as any[] | null) ?? [];
  const ctrShipIds = [...new Set(ctrRows.map((c) => c.shipment_id).filter(Boolean) as string[])];
  const ctrRefs = new Map<string, string | null>();
  if (ctrShipIds.length) {
    const { data } = await freight.from('shipments').select('id, reference').in('id', ctrShipIds);
    (data ?? []).forEach((s: { id: string; reference: string | null }) => ctrRefs.set(s.id, s.reference));
  }
  const containers = ctrRows.map((c) => ({
    id: c.id, container_no: c.container_no, shipment_id: c.shipment_id, status: c.status,
    shipmentRef: c.shipment_id ? ctrRefs.get(c.shipment_id) ?? null : null,
  }));

  const contacts = (contactRes.data as any[] | null) ?? [];
  const customerQuotes = (cqRes.data as any[] | null) ?? [];
  const rfqs = (rfqRes.data as any[] | null) ?? [];
  const total = shipments.length + contacts.length + containers.length + customerQuotes.length + rfqs.length;
  return { term, shipments, contacts, containers, customerQuotes, rfqs, total };
}

// ----------------------------------------------------------------------------- documents
export interface ShipmentDocumentRow {
  id: string; document_id: string; doc_type: string; visibility: string;
  title: string | null; filename: string; mime_type: string | null; created_at: string; url: string | null;
}

export async function getShipmentDocuments(shipmentId: string): Promise<ShipmentDocumentRow[]> {
  const { freight, core, supabase, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight
    .from('shipment_documents')
    .select('id, document_id, doc_type, visibility, title, created_at')
    .eq('company_id', companyId).eq('shipment_id', shipmentId)
    .order('created_at', { ascending: false });
  const rows = (data as any[] | null) ?? [];
  if (!rows.length) return [];

  const { data: docs } = await core.from('documents')
    .select('id, filename, mime_type, storage_path').in('id', rows.map((r) => r.document_id));
  const docMap = new Map(((docs as any[] | null) ?? []).map((d) => [d.id, d]));
  const paths = ((docs as any[] | null) ?? []).map((d) => d.storage_path).filter(Boolean);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('documents').createSignedUrls(paths, 3600);
    ((signed as any[] | null) ?? []).forEach((s) => { if (s.signedUrl) urlByPath.set(s.path, s.signedUrl); });
  }
  return rows.map((r) => {
    const d = docMap.get(r.document_id);
    return {
      id: r.id, document_id: r.document_id, doc_type: r.doc_type, visibility: r.visibility, title: r.title,
      filename: d?.filename ?? 'file', mime_type: d?.mime_type ?? null, created_at: r.created_at,
      url: d?.storage_path ? urlByPath.get(d.storage_path) ?? null : null,
    };
  });
}

// ----------------------------------------------------------------------------- dashboard sections
export interface ApprovalRow { id: string; reference: string | null; shipment_id: string; shipmentRef?: string | null; total_amount: number; currency_code: string | null; }
export interface ArrivalRow { id: string; reference: string | null; eta: string | null; lane: string; customerName: string | null; stage: string; }
export interface CommRow { id: string; channel: string; direction: string; subject: string | null; occurred_at: string; shipment_id: string | null; shipmentRef?: string | null; }

export async function getPendingApprovals(limit = 8): Promise<ApprovalRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('customer_quotes')
    .select('id, reference, shipment_id, total_amount, currency_code')
    .eq('company_id', companyId).eq('status', 'sent')
    .order('sent_at', { ascending: true }).limit(limit);
  return attachShipmentRefs((data as ApprovalRow[] | null) ?? []) as Promise<ApprovalRow[]>;
}

export async function getBookingsToConfirm(limit = 8): Promise<ArrivalRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('shipments')
    .select('id, reference, eta, origin_name, destination_name, stage, customer_contact_id')
    .eq('company_id', companyId).eq('stage', 'customer_approval').eq('status', 'active')
    .order('updated_at', { ascending: true }).limit(limit);
  return shapeArrivals((data as any[] | null) ?? []);
}

export async function getArrivals(days = 14, limit = 8): Promise<ArrivalRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const today = new Date(); const horizon = new Date(); horizon.setUTCDate(horizon.getUTCDate() + days);
  const { data } = await freight.from('shipments')
    .select('id, reference, eta, origin_name, destination_name, stage, customer_contact_id')
    .eq('company_id', companyId).eq('status', 'active')
    .gte('eta', today.toISOString().slice(0, 10)).lte('eta', horizon.toISOString().slice(0, 10))
    .order('eta', { ascending: true }).limit(limit);
  return shapeArrivals((data as any[] | null) ?? []);
}

async function shapeArrivals(rows: any[]): Promise<ArrivalRow[]> {
  const names = await contactNameMap(rows.map((r) => r.customer_contact_id));
  return rows.map((r) => ({
    id: r.id, reference: r.reference, eta: r.eta, stage: r.stage,
    lane: [r.origin_name, r.destination_name].filter(Boolean).join(' → '),
    customerName: names.get(r.customer_contact_id) ?? null,
  }));
}

export async function getAtRiskContainers(limit = 8): Promise<ContainerRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('containers').select(CONTAINER_COLS)
    .eq('company_id', companyId).is('returned_date', null);
  const rows = (data as ContainerRow[] | null) ?? [];
  const ranked = rows
    .map((c) => ({ c, ft: computeFreeTime(c) }))
    .filter((x) => x.ft.risk !== 'none')
    .sort((a, b) => ({ overdue: 0, watch: 1, none: 2 } as Record<string, number>)[a.ft.risk] - ({ overdue: 0, watch: 1, none: 2 } as Record<string, number>)[b.ft.risk])
    .slice(0, limit)
    .map((x) => x.c);
  return attachShipmentRefs(ranked as any) as Promise<ContainerRow[]>;
}

export async function getRecentCommunications(limit = 8): Promise<CommRow[]> {
  const { freight, companyId } = await freightDb();
  if (!companyId) return [];
  const { data } = await freight.from('communications')
    .select('id, channel, direction, subject, occurred_at, shipment_id')
    .eq('company_id', companyId).order('occurred_at', { ascending: false }).limit(limit);
  return attachShipmentRefs((data as CommRow[] | null) ?? []) as Promise<CommRow[]>;
}

// ----------------------------------------------------------------------------- helper
async function attachShipmentRefs<T extends { shipment_id: string | null; shipmentRef?: string | null }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.shipment_id).filter(Boolean) as string[])];
  if (!ids.length) return rows;
  const { freight } = await freightDb();
  const { data } = await freight.from('shipments').select('id, reference').in('id', ids);
  const refs = new Map((data ?? []).map((s: { id: string; reference: string | null }) => [s.id, s.reference]));
  return rows.map((r) => ({ ...r, shipmentRef: r.shipment_id ? refs.get(r.shipment_id) ?? null : null }));
}
