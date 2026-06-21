// =============================================================================
// Cargo Assurance — comparison engine
// -----------------------------------------------------------------------------
// Consistent, explained sign convention. No measurement method is hard-coded as
// absolute truth — the reference is supplied by the caller (procedure/review).
// See docs/cargo-assurance/cargo-calculation-engine.md (comparison engine).
// =============================================================================
import { round } from './numeric';

/**
 * Variance = comparison − reference.
 * Positive ⇒ the comparison method reports MORE than the reference.
 * Negative ⇒ the comparison method reports LESS than the reference.
 */
export function variance(comparison: number, reference: number): number {
  return round(comparison - reference);
}

/**
 * Variance % = (comparison − reference) / reference × 100.
 * Returns null when the reference is zero (undefined percentage — flag, never fabricate).
 */
export function variancePct(comparison: number, reference: number): number | null {
  if (reference === 0) return null;
  return round(((comparison - reference) / reference) * 100, 4);
}

/** Claimed-over-received = shore reported delivery − Taylor corrected vessel receipt. */
export function claimedOverReceived(shoreReportedDelivery: number, taylorCorrectedReceipt: number): number {
  return round(shoreReportedDelivery - taylorCorrectedReceipt);
}

/** Procedural apparent loss = Taylor corrected vessel result − client procedure result. */
export function proceduralApparentLoss(taylorCorrectedResult: number, clientProcedureResult: number): number {
  return round(taylorCorrectedResult - clientProcedureResult);
}

/** Unexplained residual = Taylor corrected vessel receipt − selected independent reference. */
export function unexplainedResidual(taylorCorrectedReceipt: number, selectedReference: number): number {
  return round(taylorCorrectedReceipt - selectedReference);
}

/** Human-readable direction of a variance, for findings text. */
export function describeVariance(value: number): 'positive' | 'negative' | 'none' {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'none';
}
