// Read-only data access for the customer portal. Reads ONLY the portal_* views
// (0034), which expose client-safe columns scoped to the signed-in customer via
// freight.user_customer_ids(). Never touches base freight tables. Document URLs are
// signed with the service role AFTER portal_documents has authorised the file
// (client_visible + owned), so the storage bucket policy stays untouched.
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeFreeTime, type FreeTimeStatus } from '@/modules/freight/freetime';
import { paymentStatus, type ShipmentBilling } from '@/modules/freight/queries';

async function portalClient() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.schema('freight' as any);
}

export interface PortalShipmentRow {
  id: string; reference: string | null; stage: string; status: string;
  mode: string | null; direction: string | null; origin_name: string | null;
  destination_name: string | null; commodity: string | null; eta: string | null;
  etd: string | null; ata: string | null; atd: string | null; created_at: string;
}

export interface PortalShipmentDetail extends PortalShipmentRow {
  incoterm: string | null; origin_country: string | null; destination_country: string | null;
  description: string | null; weight_kg: number | null; volume_m3: number | null;
  packages: number | null; package_type: string | null; is_dangerous_goods: boolean;
  temperature_control: string | null; vessel: string | null; voyage: string | null;
  booking_ref: string | null; bl_number: string | null; opened_at: string;
}

export async function getPortalShipments(): Promise<PortalShipmentRow[]> {
  const freight = await portalClient();
  const { data } = await freight.from('portal_shipments').select('*').order('created_at', { ascending: false });
  return (data as PortalShipmentRow[] | null) ?? [];
}

export async function getPortalShipmentDetail(id: string): Promise<PortalShipmentDetail | null> {
  const freight = await portalClient();
  const { data } = await freight.from('portal_shipments').select('*').eq('id', id).maybeSingle();
  return (data as PortalShipmentDetail | null) ?? null;
}

export interface PortalMilestoneRow { id: string; shipment_id: string; key: string; planned_at: string | null; actual_at: string | null; }

export async function getPortalMilestones(shipmentId: string): Promise<PortalMilestoneRow[]> {
  const freight = await portalClient();
  const { data } = await freight.from('portal_milestones').select('*').eq('shipment_id', shipmentId);
  return (data as PortalMilestoneRow[] | null) ?? [];
}

export interface PortalContainerRow {
  id: string; shipment_id: string; container_no: string | null; iso_type: string | null;
  size: string | null; status: string; current_location: string | null;
  free_time_days: number | null; discharge_date: string | null; gate_out_date: string | null;
  returned_date: string | null; demurrage_days: number; detention_days: number; storage_days: number;
  est_penalty: number; demurrage_rate: number | null; detention_rate: number | null;
  storage_rate: number | null; rate_currency: string | null;
}

export async function getPortalContainers(shipmentId: string): Promise<{ row: PortalContainerRow; ft: FreeTimeStatus }[]> {
  const freight = await portalClient();
  const { data } = await freight.from('portal_containers').select('*').eq('shipment_id', shipmentId);
  return ((data as PortalContainerRow[] | null) ?? []).map((row) => ({ row, ft: computeFreeTime(row) }));
}

export interface PortalDocumentRow {
  id: string; shipment_id: string; document_id: string; doc_type: string; title: string | null;
  filename: string; mime_type: string | null; created_at: string; url: string | null;
}

export async function getPortalDocuments(shipmentId: string): Promise<PortalDocumentRow[]> {
  const freight = await portalClient();
  const { data } = await freight
    .from('portal_documents')
    .select('id, shipment_id, document_id, doc_type, title, filename, mime_type, storage_path, created_at')
    .eq('shipment_id', shipmentId)
    .order('created_at', { ascending: false });
  const rows = (data as (PortalDocumentRow & { storage_path: string })[] | null) ?? [];
  if (rows.length === 0) return [];

  // The view already authorised these (client_visible + owned). Sign with the
  // service role so the customer can download without a storage-bucket policy.
  const admin = createAdminClient();
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await admin.storage.from('documents').createSignedUrls(paths, 3600);
    ((signed as { path: string; signedUrl: string }[] | null) ?? []).forEach((s) => {
      if (s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    });
  }
  return rows.map((r) => ({
    id: r.id, shipment_id: r.shipment_id, document_id: r.document_id, doc_type: r.doc_type,
    title: r.title, filename: r.filename, mime_type: r.mime_type, created_at: r.created_at,
    url: urlByPath.get(r.storage_path) ?? null,
  }));
}

export interface PortalQuoteRow {
  id: string; shipment_id: string; reference: string | null; revision: number; status: string;
  currency_code: string | null; total_amount: number; valid_until: string | null;
  sent_at: string | null; decided_at: string | null;
}
export interface PortalQuoteLineRow {
  id: string; charge_code: string | null; description: string; quantity: number; unit: string | null;
  rate: number; currency_code: string | null; amount: number; sort_order: number;
}

/** The latest (highest-revision) non-draft customer quotation for a shipment + its lines. */
export async function getPortalQuote(shipmentId: string): Promise<{ quote: PortalQuoteRow; lines: PortalQuoteLineRow[] } | null> {
  const freight = await portalClient();
  const { data } = await freight
    .from('portal_quote').select('*').eq('shipment_id', shipmentId)
    .order('revision', { ascending: false }).limit(1).maybeSingle();
  const quote = data as PortalQuoteRow | null;
  if (!quote) return null;
  const { data: lines } = await freight
    .from('portal_quote_lines').select('*').eq('customer_quote_id', quote.id).order('sort_order');
  return { quote, lines: (lines as PortalQuoteLineRow[] | null) ?? [] };
}

export interface PortalBilling extends ShipmentBilling { shipment_id: string; }

export async function getPortalBilling(shipmentId: string): Promise<{ billing: PortalBilling; status: ReturnType<typeof paymentStatus> } | null> {
  const freight = await portalClient();
  const { data } = await freight.from('portal_billing').select('*').eq('shipment_id', shipmentId).maybeSingle();
  const billing = data as PortalBilling | null;
  if (!billing) return null;
  return { billing, status: paymentStatus(billing) };
}
