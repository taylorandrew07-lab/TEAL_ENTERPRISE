// =============================================================================
// Cargo Assurance — period-level aggregation
// -----------------------------------------------------------------------------
// CRITICAL INVARIANT: percentages are NEVER summed or naively averaged. Cumulative
// percentages are computed from aggregated quantities; cross-record averages use
// correctly weighted means. See docs/cargo-assurance/cargo-aggregation-and-analytics.md.
// =============================================================================
import { round, sum, median, stddev, weightedMean } from './numeric';

/**
 * Cumulative variance % across many records — computed from the AGGREGATED
 * quantities, not from per-record percentages. Returns null if total reference is 0.
 */
export function cumulativeVariancePct(totalComparison: number, totalReference: number): number | null {
  if (totalReference === 0) return null;
  return round(((totalComparison - totalReference) / totalReference) * 100, 4);
}

/**
 * Weighted mean variance % — weight each record's variance % by its reference
 * quantity (so large loadouts dominate proportionally). This is the correct way
 * to "average" percentages.
 */
export function weightedMeanVariancePct(records: { variancePct: number; referenceQty: number }[]): number | null {
  const usable = records.filter((r) => Number.isFinite(r.variancePct) && r.referenceQty > 0);
  if (!usable.length) return null;
  const m = weightedMean(usable.map((r) => ({ value: r.variancePct, weight: r.referenceQty })));
  return m == null ? null : round(m, 4);
}

/** Simple (unweighted) median of per-record variance percentages. */
export function medianVariancePct(variancePcts: number[]): number | null {
  const m = median(variancePcts.filter(Number.isFinite));
  return m == null ? null : round(m, 4);
}

export function stddevVariancePct(variancePcts: number[]): number | null {
  const s = stddev(variancePcts.filter(Number.isFinite));
  return s == null ? null : round(s, 4);
}

/**
 * Percentage of records biased in the SAME (dominant) direction. Zero-variance
 * records are excluded from the base. Returns null when there are no non-zero records.
 */
export function sameDirectionPct(variances: number[]): number | null {
  const nonZero = variances.filter((v) => v !== 0);
  if (!nonZero.length) return null;
  const pos = nonZero.filter((v) => v > 0).length;
  const neg = nonZero.length - pos;
  return round((Math.max(pos, neg) / nonZero.length) * 100, 4);
}

/** Percentage of records within an absolute tolerance on their variance %. */
export function withinTolerancePct(variancePcts: number[], tolerancePct: number): number | null {
  if (!variancePcts.length) return null;
  const within = variancePcts.filter((v) => Math.abs(v) <= tolerancePct).length;
  return round((within / variancePcts.length) * 100, 4);
}

/** Data completeness = present required fields / expected required fields. */
export function dataCompletenessPct(presentRequired: number, expectedRequired: number): number | null {
  if (expectedRequired === 0) return null;
  return round((presentRequired / expectedRequired) * 100, 4);
}

export interface LoadoutRollup {
  nominated: number;
  reportedDelivery: number;
  clientProcedure: number;
  taylorCorrected: number;
  fueltrax?: number;
  vesselMeter?: number;
  shoreMeter?: number;
  shoreTank?: number;
  documentedConsumption?: number;
  nonReceivingProceduralEffect?: number;
}

export interface ReviewTotals {
  loadoutCount: number;
  totalNominated: number;
  totalReportedDelivery: number;
  totalClientProcedure: number;
  totalTaylorCorrected: number;
  totalFueltrax: number;
  totalVesselMeter: number;
  totalShoreMeter: number;
  totalShoreTank: number;
  totalDocumentedConsumption: number;
  totalNonReceivingProceduralEffect: number;
  /** Taylor corrected − client procedure, summed from quantities. */
  cumulativeProceduralApparentLoss: number;
  /** Shore reported − Taylor corrected, summed from quantities. */
  cumulativeClaimedOverReceived: number;
}

/** Aggregate loadout rollups into period totals (all from quantities, never percentages). */
export function aggregateReview(loadouts: LoadoutRollup[]): ReviewTotals {
  const pick = (f: (l: LoadoutRollup) => number) => round(sum(loadouts.map(f)));
  const totalClientProcedure = pick((l) => l.clientProcedure);
  const totalTaylorCorrected = pick((l) => l.taylorCorrected);
  const totalReportedDelivery = pick((l) => l.reportedDelivery);
  return {
    loadoutCount: loadouts.length,
    totalNominated: pick((l) => l.nominated),
    totalReportedDelivery,
    totalClientProcedure,
    totalTaylorCorrected,
    totalFueltrax: pick((l) => l.fueltrax ?? 0),
    totalVesselMeter: pick((l) => l.vesselMeter ?? 0),
    totalShoreMeter: pick((l) => l.shoreMeter ?? 0),
    totalShoreTank: pick((l) => l.shoreTank ?? 0),
    totalDocumentedConsumption: pick((l) => l.documentedConsumption ?? 0),
    totalNonReceivingProceduralEffect: pick((l) => l.nonReceivingProceduralEffect ?? 0),
    cumulativeProceduralApparentLoss: round(totalTaylorCorrected - totalClientProcedure),
    cumulativeClaimedOverReceived: round(totalReportedDelivery - totalTaylorCorrected),
  };
}
