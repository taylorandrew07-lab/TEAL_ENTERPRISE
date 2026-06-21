// =============================================================================
// Cargo Assurance — unit conversions
// -----------------------------------------------------------------------------
// Preserve original values AND conversions separately. NEVER assume a temperature
// or density the source does not provide — such conversions return a flag instead
// of a fabricated number. Pure and dependency-free.
// =============================================================================
import { round } from './numeric';

export type VolumeUnit = 'm3' | 'bbl' | 'L' | 'usgal';

// Cubic metres per 1 unit (exact/standard factors).
const M3_PER: Record<VolumeUnit, number> = {
  m3: 1,
  bbl: 0.158987294928, // US petroleum barrel (42 US gal)
  L: 0.001,
  usgal: 0.003785411784,
};

/** Convert a volume between supported units. */
export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return round(value);
  return round((value * M3_PER[from]) / M3_PER[to]);
}

export function celsiusToFahrenheit(c: number): number {
  return round((c * 9) / 5 + 32, 4);
}

export function fahrenheitToCelsius(f: number): number {
  return round(((f - 32) * 5) / 9, 4);
}

/** API gravity <-> specific gravity (60/60°F). */
export function apiToSpecificGravity(api: number): number {
  return round(141.5 / (api + 131.5), 6);
}

export function specificGravityToApi(sg: number): number {
  return round(141.5 / sg - 131.5, 4);
}

export interface StandardVolumeResult {
  /** Volume corrected to the standard reference, or null when it cannot be derived. */
  value: number | null;
  /** Set when inputs were insufficient — the caller must flag for review, never assume. */
  flag?: 'missing_vcf';
}

/**
 * Convert an observed volume to standard volume using a Volume Correction Factor.
 * The VCF (e.g. from ASTM tables) MUST be supplied; this engine never assumes a
 * temperature/density correction the source documents do not support.
 */
export function toStandardVolume(observedVolume: number, vcf: number | null | undefined): StandardVolumeResult {
  if (vcf == null || !Number.isFinite(vcf)) return { value: null, flag: 'missing_vcf' };
  return { value: round(observedVolume * vcf) };
}
