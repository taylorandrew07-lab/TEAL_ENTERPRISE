// =============================================================================
// Liquid Cargo Assurance — mass / weight conversions
// -----------------------------------------------------------------------------
// Converts liquid-cargo VOLUME to MASS (metric tonnes), the usual settlement
// basis for bulk liquid cargo surveys. Works for any liquid cargo (fuels, gasoil,
// gasoline, crude, lube/base oils, vegetable oils, chemicals, molasses, ...),
// driven by density (derived from specific gravity or API when needed) and a
// standard-volume basis.
//
// DISCIPLINE (same as the rest of the engine): never fabricate a density or a
// temperature/volume correction the source documents do not support. When an input
// is missing, the result carries a flag and a null quantity rather than a guess.
// Pure and dependency-free. See docs/cargo-assurance/cargo-calculation-engine.md.
// =============================================================================
import { round } from './numeric';
import { apiToSpecificGravity } from './units';

/** Density of pure water at 15°C (kg/m³) — the reference for SG(60/60°F) → density. */
export const WATER_DENSITY_15C = 999.016;
/** ASTM air-buoyancy correction for petroleum weight-in-air (kg/m³). */
export const AIR_BUOYANCY = 1.1;

/** Density at 15°C (kg/m³) from specific gravity (60/60°F). */
export function densityFromSG(sg: number, waterDensity = WATER_DENSITY_15C): number {
  return round(sg * waterDensity, 4);
}

/** Density at 15°C (kg/m³) from API gravity. */
export function densityFromApi(api: number, waterDensity = WATER_DENSITY_15C): number {
  return densityFromSG(apiToSpecificGravity(api), waterDensity);
}

export interface MassQuantities {
  /** Mass in vacuum (kg) = standard volume × density. */
  massVacuumKg: number;
  /** Weight in air (kg) = standard volume × (density − air buoyancy). */
  massAirKg: number;
  massVacuumTonnes: number;
  /** Metric tonnes in air — the usual cargo-trade settlement figure. */
  massAirTonnes: number;
}

/** Convert a STANDARD volume (m³ at 15°C) plus density (kg/m³ at 15°C) to mass. */
export function volumeToMass(
  standardVolumeM3: number,
  density15KgM3: number,
  airBuoyancy = AIR_BUOYANCY,
): MassQuantities {
  const massVacuumKg = round(standardVolumeM3 * density15KgM3, 4);
  const massAirKg = round(standardVolumeM3 * (density15KgM3 - airBuoyancy), 4);
  return {
    massVacuumKg,
    massAirKg,
    massVacuumTonnes: round(massVacuumKg / 1000, 4),
    massAirTonnes: round(massAirKg / 1000, 4),
  };
}

export interface ObservedMassInput {
  /** Observed (gross) volume in m³ at the observed temperature. */
  observedVolume: number;
  /** Density at 15°C (kg/m³) if known directly. */
  density15KgM3?: number | null;
  /** Specific gravity 60/60°F (used to derive density when density15 is absent). */
  sg?: number | null;
  /** API gravity (used to derive density when density15 and sg are absent). */
  api?: number | null;
  /** Volume Correction Factor (e.g. ASTM 54). Supplied when available — never assumed. */
  vcf?: number | null;
  /** Observed temperature (°C). Only used with an explicit expansion coefficient. */
  temperatureC?: number | null;
  /**
   * Optional volumetric expansion coefficient (per °C). When provided WITH a
   * temperature, an APPROXIMATE VCF = 1 − coeff×(T − 15) is used and the result is
   * flagged `approximate_vcf`. This is a convenience for cargoes lacking ASTM tables;
   * it is never applied unless the caller explicitly opts in.
   */
  expansionCoeffPerC?: number | null;
  waterDensity?: number;
  airBuoyancy?: number;
}

export interface MassResult {
  standardVolumeM3: number | null;
  density15KgM3: number | null;
  massAirTonnes: number | null;
  massVacuumTonnes: number | null;
  /** True when an approximate (coefficient-based) VCF was used rather than a supplied VCF. */
  approximate: boolean;
  /** e.g. 'missing_density', 'missing_vcf', 'approximate_vcf'. Caller flags for review. */
  flags: string[];
}

/**
 * Convert an OBSERVED volume to mass, deriving density and standard volume from the
 * available inputs and flagging (never fabricating) anything that cannot be derived.
 */
export function observedVolumeToMass(input: ObservedMassInput): MassResult {
  const flags: string[] = [];

  // 1) Density at 15°C — direct, else from SG, else from API.
  let density15: number | null = null;
  if (input.density15KgM3 != null && Number.isFinite(input.density15KgM3)) {
    density15 = round(input.density15KgM3, 4);
  } else if (input.sg != null && Number.isFinite(input.sg)) {
    density15 = densityFromSG(input.sg, input.waterDensity);
  } else if (input.api != null && Number.isFinite(input.api)) {
    density15 = densityFromApi(input.api, input.waterDensity);
  } else {
    flags.push('missing_density');
  }

  // A singular input (e.g. API = -131.5 → division by zero) yields a non-finite
  // density. Never let that fabricate an Infinity mass — flag it and drop the value.
  if (density15 != null && !Number.isFinite(density15)) {
    density15 = null;
    flags.push('invalid_density');
  }

  // 2) Standard volume — supplied VCF, else an explicit approximate coefficient.
  let standardVolume: number | null = null;
  let approximate = false;
  if (input.vcf != null && Number.isFinite(input.vcf)) {
    standardVolume = round(input.observedVolume * input.vcf);
  } else if (
    input.expansionCoeffPerC != null &&
    Number.isFinite(input.expansionCoeffPerC) &&
    input.temperatureC != null &&
    Number.isFinite(input.temperatureC)
  ) {
    const vcf = 1 - input.expansionCoeffPerC * (input.temperatureC - 15);
    standardVolume = round(input.observedVolume * vcf);
    approximate = true;
    flags.push('approximate_vcf');
  } else {
    flags.push('missing_vcf');
  }

  if (density15 == null || standardVolume == null) {
    return {
      standardVolumeM3: standardVolume,
      density15KgM3: density15,
      massAirTonnes: null,
      massVacuumTonnes: null,
      approximate,
      flags,
    };
  }

  const mass = volumeToMass(standardVolume, density15, input.airBuoyancy);
  return {
    standardVolumeM3: standardVolume,
    density15KgM3: density15,
    massAirTonnes: mass.massAirTonnes,
    massVacuumTonnes: mass.massVacuumTonnes,
    approximate,
    flags,
  };
}
