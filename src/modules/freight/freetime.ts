// Free-time / demurrage / detention compute — pure, no DB. Works off the dates the
// team enters (discharge, gate-out, return) plus the agreed free-time days, so it
// runs with or without a live carrier ETA feed. Demurrage accrues at the port after
// free time (before the box is collected); detention accrues once it's out (before
// it's returned empty). See docs/freight/_FREIGHT-SPEC.md §6.

export interface ContainerDates {
  free_time_days: number | null;
  discharge_date: string | null;  // YYYY-MM-DD — arrived/discharged at destination port
  gate_out_date: string | null;   // left the port (collected)
  returned_date: string | null;   // empty returned to carrier
  // optional per-container daily rates → drive estimated penalty amounts
  demurrage_rate?: number | null;
  detention_rate?: number | null;
  storage_rate?: number | null;
  storage_days?: number | null;
  rate_currency?: string | null;
}

export interface FreeTimeStatus {
  freeTimeDays: number | null;
  demurrageDays: number;            // chargeable days incurred at port
  detentionDays: number;            // chargeable days incurred out of port
  storageDays: number;              // chargeable storage days (if tracked)
  freeTimeRemaining: number | null; // days left before demurrage starts (null if not applicable)
  phase: 'before_arrival' | 'at_port' | 'out' | 'returned' | 'unknown';
  risk: 'none' | 'watch' | 'overdue';
  estPenalty: number;               // estimated cost from rates × chargeable days
  rateCurrency: string | null;
}

const DAY = 86_400_000;

function toUtc(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d.length === 10 ? `${d}T00:00:00Z` : d).getTime();
  return Number.isNaN(t) ? null : t;
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY));
}

export function computeFreeTime(c: ContainerDates, now: number = Date.now()): FreeTimeStatus {
  const free = c.free_time_days ?? null;
  const discharge = toUtc(c.discharge_date);
  const gateOut = toUtc(c.gate_out_date);
  const returned = toUtc(c.returned_date);

  let demurrageDays = 0;
  let detentionDays = 0;
  let freeTimeRemaining: number | null = null;
  let phase: FreeTimeStatus['phase'] = 'unknown';

  // Demurrage window: discharge → gate-out (or now if still at port)
  if (discharge != null) {
    const end = gateOut ?? now;
    const daysAtPort = daysBetween(discharge, end);
    if (free != null) {
      demurrageDays = Math.max(0, daysAtPort - free);
      if (gateOut == null) {
        freeTimeRemaining = free - daysAtPort; // may be negative (already in demurrage)
        phase = 'at_port';
      }
    } else if (gateOut == null) {
      phase = 'at_port';
    }
  }

  // Detention window: gate-out → return (or now if still out)
  if (gateOut != null) {
    const end = returned ?? now;
    const daysOut = daysBetween(gateOut, end);
    if (free != null) detentionDays = Math.max(0, daysOut - free);
    phase = returned != null ? 'returned' : 'out';
    if (returned == null && free != null) {
      const rem = free - daysOut;
      freeTimeRemaining = freeTimeRemaining == null ? rem : Math.min(freeTimeRemaining, rem);
    }
  }

  if (discharge == null && gateOut == null) phase = 'before_arrival';

  const storageDays = c.storage_days ?? 0;

  let risk: FreeTimeStatus['risk'] = 'none';
  if (demurrageDays > 0 || detentionDays > 0) risk = 'overdue';
  else if (freeTimeRemaining != null && freeTimeRemaining <= 3) risk = 'watch';

  const estPenalty =
    demurrageDays * Number(c.demurrage_rate ?? 0) +
    detentionDays * Number(c.detention_rate ?? 0) +
    storageDays * Number(c.storage_rate ?? 0);

  return {
    freeTimeDays: free, demurrageDays, detentionDays, storageDays, freeTimeRemaining, phase, risk,
    estPenalty, rateCurrency: c.rate_currency ?? null,
  };
}

export function riskLabel(s: FreeTimeStatus): string {
  if (s.risk === 'overdue') {
    const parts: string[] = [];
    if (s.demurrageDays > 0) parts.push(`${s.demurrageDays}d demurrage`);
    if (s.detentionDays > 0) parts.push(`${s.detentionDays}d detention`);
    return parts.join(' · ') || 'Overdue';
  }
  if (s.risk === 'watch' && s.freeTimeRemaining != null) {
    return `${s.freeTimeRemaining}d free time left`;
  }
  if (s.freeTimeRemaining != null && s.freeTimeRemaining > 3) return `${s.freeTimeRemaining}d free time left`;
  return '—';
}
