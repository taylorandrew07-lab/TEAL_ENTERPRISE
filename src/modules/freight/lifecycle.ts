// Freight shipment lifecycle — the canonical stage order, labels, and grouping.
// The DB enum freight.shipment_stage is the source of truth; this mirrors it for
// the UI (ordered progress, labels, next-stage suggestion). Keep in sync with
// migration 0019 and docs/freight/_FREIGHT-SPEC.md §2.

export type ShipmentStage =
  | 'lead' | 'rfq' | 'supplier_quoting' | 'customer_quote' | 'customer_approval'
  | 'booking_confirmed' | 'cargo_ready' | 'collection' | 'export_clearance' | 'loaded'
  | 'departed' | 'in_transit' | 'arrival' | 'import_clearance' | 'delivery'
  | 'proof_of_delivery' | 'invoiced' | 'completed' | 'archived';

export type ShipmentMode = 'sea_fcl' | 'sea_lcl' | 'air' | 'road' | 'rail' | 'multimodal';
export type ShipmentDirection = 'import' | 'export' | 'cross_trade';
export type ShipmentStatus = 'active' | 'on_hold' | 'cancelled';

/** Ordered lifecycle — index gives progress position. */
export const STAGE_ORDER: ShipmentStage[] = [
  'lead', 'rfq', 'supplier_quoting', 'customer_quote', 'customer_approval',
  'booking_confirmed', 'cargo_ready', 'collection', 'export_clearance', 'loaded',
  'departed', 'in_transit', 'arrival', 'import_clearance', 'delivery',
  'proof_of_delivery', 'invoiced', 'completed', 'archived',
];

export const STAGE_LABELS: Record<ShipmentStage, string> = {
  lead: 'Lead',
  rfq: 'Request for Quote',
  supplier_quoting: 'Supplier Quoting',
  customer_quote: 'Customer Quotation',
  customer_approval: 'Customer Approval',
  booking_confirmed: 'Booking Confirmed',
  cargo_ready: 'Cargo Ready',
  collection: 'Collection',
  export_clearance: 'Export Clearance',
  loaded: 'Loaded',
  departed: 'Departed',
  in_transit: 'In Transit',
  arrival: 'Arrival',
  import_clearance: 'Import Clearance',
  delivery: 'Delivery',
  proof_of_delivery: 'Proof of Delivery',
  invoiced: 'Invoiced',
  completed: 'Completed',
  archived: 'Archived',
};

/** Coarse phase used for grouping/colour. */
export function stagePhase(stage: ShipmentStage): 'quoting' | 'booking' | 'transit' | 'closing' | 'done' {
  const i = STAGE_ORDER.indexOf(stage);
  if (i <= STAGE_ORDER.indexOf('customer_approval')) return 'quoting';
  if (i <= STAGE_ORDER.indexOf('export_clearance')) return 'booking';
  if (i <= STAGE_ORDER.indexOf('arrival')) return 'transit';
  if (i <= STAGE_ORDER.indexOf('invoiced')) return 'closing';
  return 'done';
}

export function nextStage(stage: ShipmentStage): ShipmentStage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

export const MODE_LABELS: Record<ShipmentMode, string> = {
  sea_fcl: 'Sea — FCL',
  sea_lcl: 'Sea — LCL',
  air: 'Air',
  road: 'Road',
  rail: 'Rail',
  multimodal: 'Multimodal',
};

export const DIRECTION_LABELS: Record<ShipmentDirection, string> = {
  import: 'Import',
  export: 'Export',
  cross_trade: 'Cross-trade',
};

export const CONTACT_ROLE_LABELS: Record<string, string> = {
  client: 'Client',
  consignee: 'Consignee',
  shipper: 'Shipper',
  supplier: 'Supplier',
  shipping_line: 'Shipping Line',
  airline: 'Airline',
  trucker: 'Trucker',
  warehouse: 'Warehouse',
  customs_broker: 'Customs Broker',
  overseas_agent: 'Overseas Agent',
  port_authority: 'Port Authority',
  government_agency: 'Government Agency',
  other: 'Other',
};
