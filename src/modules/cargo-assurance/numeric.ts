// =============================================================================
// Cargo Assurance — numeric helpers
// -----------------------------------------------------------------------------
// Pure, dependency-free numeric utilities used across the calculation engine.
// Quantities are stored as numeric(20,4); round to 4 decimals at boundaries.
// =============================================================================

/**
 * Round to `dp` decimals (default 4) using half-away-from-zero.
 * Non-finite inputs pass through unchanged (callers that must not surface a
 * fabricated number — e.g. mass.ts — check Number.isFinite and flag instead).
 * The exponential-string shift avoids the binary-float bias where, for example,
 * 1.005 * 100 = 100.49999999999999 would otherwise round DOWN to 1.00.
 */
export function round(value: number, dp = 4): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(value)}e${dp}`));
  return sign * Number(`${shifted}e-${dp}`);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function mean(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population standard deviation. Returns null for fewer than 2 values. */
export function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = sum(values.map((v) => (v - m) ** 2)) / values.length;
  return Math.sqrt(variance);
}

/**
 * Weighted mean of {value, weight}. Only POSITIVE weights contribute (a weight is a
 * magnitude — e.g. a reference quantity — so non-positive weights are ignored rather
 * than allowed to cancel the denominator). Returns null when no positive weight remains.
 */
export function weightedMean(items: { value: number; weight: number }[]): number | null {
  const usable = items.filter((i) => i.weight > 0 && Number.isFinite(i.weight));
  const w = sum(usable.map((i) => i.weight));
  if (w === 0) return null;
  return sum(usable.map((i) => i.value * i.weight)) / w;
}
