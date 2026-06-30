// Display badges for shipment stage and status. Plain server components (spans +
// the shared .badge utility classes from globals.css). Colour follows the coarse
// lifecycle phase so the list scans quickly.
import { STAGE_LABELS, stagePhase, type ShipmentStage, type ShipmentStatus } from './lifecycle';

const PHASE_BADGE: Record<ReturnType<typeof stagePhase>, string> = {
  quoting: 'badge-warning',
  booking: 'badge-brand',
  transit: 'badge-brand',
  closing: 'badge-neutral',
  done: 'badge-success',
};

export function StageBadge({ stage }: { stage: ShipmentStage }) {
  return <span className={`badge ${PHASE_BADGE[stagePhase(stage)]}`}>{STAGE_LABELS[stage]}</span>;
}

const STATUS_BADGE: Record<ShipmentStatus, { cls: string; label: string }> = {
  active: { cls: 'badge-success', label: 'Active' },
  on_hold: { cls: 'badge-warning', label: 'On hold' },
  cancelled: { cls: 'badge-danger', label: 'Cancelled' },
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.active;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

// Generic badge for quote/RFQ/supplier-quote statuses (snake_case → Title Case).
const QUOTE_BADGE: Record<string, string> = {
  draft: 'badge-neutral', sent: 'badge-brand', partial: 'badge-warning', closed: 'badge-neutral',
  cancelled: 'badge-danger', pending: 'badge-warning', responded: 'badge-success', declined: 'badge-danger',
  no_response: 'badge-neutral', received: 'badge-neutral', shortlisted: 'badge-warning',
  selected: 'badge-success', rejected: 'badge-danger', expired: 'badge-neutral',
  approved: 'badge-success', superseded: 'badge-neutral',
};

export function QuoteStatusBadge({ status }: { status: string }) {
  const cls = QUOTE_BADGE[status] ?? 'badge-neutral';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  return <span className={`badge ${cls}`}>{label}</span>;
}

// Document confidentiality — the Master B/L (internal) vs House B/L (client) control.
const VIS_BADGE: Record<string, { cls: string; label: string }> = {
  internal: { cls: 'badge-danger', label: 'Internal only' },
  client_visible: { cls: 'badge-success', label: 'Client-visible' },
  client_on_request: { cls: 'badge-warning', label: 'On request' },
};

export function DocVisibilityBadge({ visibility }: { visibility: string }) {
  const v = VIS_BADGE[visibility] ?? VIS_BADGE.internal;
  return <span className={`badge ${v.cls}`}>{v.label}</span>;
}
