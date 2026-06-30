// Carrier tracking framework — direct, per-line container tracking (no paid
// aggregator). Each shipping line that exposes an API gets a connector here; the
// dispatcher routes a lookup to the right line and normalises the result into our
// TrackingUpdate shape (modelled on the DCSA Track & Trace standard), which the
// caller writes to freight.tracking_events. Lines without an API fall back to
// manual entry. Live calls read each carrier's key from server env (e.g.
// MAERSK_API_KEY); absent key => "not configured" and the UI uses manual tracking.
// See docs/freight/_FREIGHT-SPEC.md §3.10 / §6.

export type CarrierKey =
  | 'maersk' | 'cma_cgm' | 'hapag_lloyd' | 'msc' | 'cosco' | 'one' | 'evergreen' | 'manual';

export interface CarrierInfo {
  key: CarrierKey;
  name: string;
  scac: string | null;        // standard carrier alpha code
  hasApi: boolean;            // does the line offer a usable API at all
  dcsa: boolean;              // follows the DCSA T&T standard (shared connector shape)
  envKey?: string;            // server env var holding the API credential
  /** Best-effort web tracking URL with {n} = container number, for manual lookups
   *  on lines we don't call via API. Carriers change these occasionally — adjust as
   *  needed; the universal fallback (track-trace.com) always works as a backstop. */
  track?: string;
}

// Universal multi-carrier lookup, used for 'manual' / unknown lines.
export const UNIVERSAL_TRACK_URL = 'https://www.track-trace.com/container';

export const CARRIERS: CarrierInfo[] = [
  { key: 'maersk',       name: 'Maersk',        scac: 'MAEU', hasApi: true,  dcsa: true,  envKey: 'MAERSK_API_KEY',    track: 'https://www.maersk.com/tracking/{n}' },
  { key: 'cma_cgm',      name: 'CMA CGM',       scac: 'CMDU', hasApi: true,  dcsa: false, envKey: 'CMA_CGM_API_KEY',   track: 'https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference={n}' },
  { key: 'hapag_lloyd',  name: 'Hapag-Lloyd',   scac: 'HLCU', hasApi: true,  dcsa: true,  envKey: 'HAPAG_API_KEY',     track: 'https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container={n}' },
  { key: 'msc',          name: 'MSC',           scac: 'MSCU', hasApi: true,  dcsa: true,  envKey: 'MSC_API_KEY',       track: 'https://www.msc.com/en/track-a-shipment?trackingNumber={n}' },
  { key: 'cosco',        name: 'COSCO',         scac: 'COSU', hasApi: false, dcsa: false, envKey: 'COSCO_API_KEY',     track: 'https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number={n}' },
  { key: 'one',          name: 'Ocean Network Express', scac: 'ONEY', hasApi: true, dcsa: true, envKey: 'ONE_API_KEY', track: 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?cntrNo={n}' },
  { key: 'evergreen',    name: 'Evergreen',     scac: 'EGLV', hasApi: true,  dcsa: false, envKey: 'EVERGREEN_API_KEY', track: 'https://www.shipmentlink.com/tam/jsp/TAM/code/trace_cntr_no.jsp?cntr_no={n}' },
  { key: 'manual',       name: 'Any line (track-trace.com)', scac: null, hasApi: false, dcsa: false, track: UNIVERSAL_TRACK_URL },
];

export function carrierInfo(key: string): CarrierInfo | undefined {
  return CARRIERS.find((c) => c.key === key);
}

/** Build a manual web-tracking URL for a carrier + container number. */
export function carrierTrackingUrl(key: string, containerNo: string): string {
  const info = carrierInfo(key);
  const tmpl = info?.track ?? UNIVERSAL_TRACK_URL;
  return tmpl.includes('{n}') ? tmpl.replace('{n}', encodeURIComponent(containerNo.trim())) : tmpl;
}

/** A normalised tracking event (DCSA-ish). */
export interface TrackingEventDTO {
  event_type: string;          // e.g. 'discharged', 'gate_out', 'departed', 'arrived'
  location?: string | null;
  vessel?: string | null;
  voyage?: string | null;
  occurred_at?: string | null; // ISO
  raw?: unknown;
}

export interface TrackingUpdate {
  eta?: string | null;         // ISO date/time
  current_location?: string | null;
  events: TrackingEventDTO[];
}

export interface TrackingResult {
  ok: boolean;
  configured: boolean;         // is this carrier's API set up (env key present)?
  update?: TrackingUpdate;
  message?: string;
}

export interface CarrierTrackingProvider {
  key: CarrierKey;
  fetch(containerNo: string, opts?: { bookingRef?: string | null; blNumber?: string | null }): Promise<TrackingResult>;
}

// --- Provider implementations -------------------------------------------------
// Each live carrier connector will: read its env key, call the line's API, and map
// the response into TrackingUpdate. Until a key is configured they return a clear
// "not configured" result so the UI can prompt for manual entry. Implementing one
// line later = filling in the fetch body below; nothing else changes.

function notConfigured(info: CarrierInfo): TrackingResult {
  return {
    ok: false,
    configured: false,
    message: info.hasApi
      ? `${info.name} tracking isn't connected yet. Register on the ${info.name} developer portal and add ${info.envKey} to the server, then this will pull ETAs automatically. Use "Record tracking" for now.`
      : `${info.name} has no usable public API — record tracking manually (or parse arrival-notice emails once Outlook is connected).`,
  };
}

function makeCarrierProvider(info: CarrierInfo): CarrierTrackingProvider {
  return {
    key: info.key,
    async fetch(_containerNo, _opts) {
      const key = info.envKey ? process.env[info.envKey] : undefined;
      if (!info.hasApi || !key) return notConfigured(info);
      // TODO(per-carrier): call info's API with the credential and map → TrackingUpdate.
      // DCSA-standard carriers (info.dcsa) share one mapping; others get a bespoke map.
      return { ok: false, configured: true, message: `${info.name} connector is registered but its fetch implementation is pending.` };
    },
  };
}

const manualProvider: CarrierTrackingProvider = {
  key: 'manual',
  async fetch() {
    return { ok: false, configured: true, message: 'Manual tracking — enter ETA and events by hand.' };
  },
};

const PROVIDERS = new Map<CarrierKey, CarrierTrackingProvider>(
  CARRIERS.map((c) => [c.key, c.key === 'manual' ? manualProvider : makeCarrierProvider(c)]),
);

export function getTrackingProvider(key: string): CarrierTrackingProvider {
  return PROVIDERS.get(key as CarrierKey) ?? manualProvider;
}

/** Resolve a carrier key from a contact/carrier name or SCAC (best-effort). */
export function resolveCarrierKey(nameOrScac?: string | null): CarrierKey | null {
  if (!nameOrScac) return null;
  const s = nameOrScac.trim().toLowerCase();
  const hit = CARRIERS.find(
    (c) => c.key !== 'manual' && (c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase()) || c.scac?.toLowerCase() === s),
  );
  return hit?.key ?? null;
}
