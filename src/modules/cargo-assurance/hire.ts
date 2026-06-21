// =============================================================================
// Cargo Assurance — vessel on-hire / off-hire reconciliation
// -----------------------------------------------------------------------------
// Per fuel grade. If reliable consumption/transfer evidence is unavailable, ONLY
// the verified on-hire → off-hire change is reported — no unexplained loss is
// inferred from incomplete information. See docs/cargo-assurance/cargo-calculation-engine.md.
// =============================================================================
import { round } from './numeric';

export interface HirePeriodInput {
  onHireRob: number;
  actualOffHireRob: number;
  fuelReceived?: number;
  /** Verified consumption; pass null/undefined when it cannot be established. */
  verifiedConsumption?: number | null;
  externalDischarged?: number | null;
  otherAdjustments?: number;
  /** Whether the consumption/transfer evidence is sufficient to compute an expected ROB. */
  evidenceComplete: boolean;
}

export interface HirePeriodResult {
  onHireRob: number;
  actualOffHireRob: number;
  fuelReceived: number;
  /** Verified change regardless of evidence completeness: actual − on-hire. */
  verifiedChange: number;
  /** Expected off-hire ROB, or null when evidence is incomplete. */
  expectedOffHireRob: number | null;
  /** Hire variance = actual − expected; null when expected is null. */
  variance: number | null;
  /** Set when evidence was insufficient, so the result is change-only (no inferred loss). */
  flag?: 'insufficient_evidence';
  explanation: string;
}

/**
 * Expected off-hire ROB =
 *   onHireRob + fuelReceived − verifiedConsumption − externalDischarged + otherAdjustments
 */
export function expectedOffHireRob(opts: {
  onHireRob: number;
  fuelReceived?: number;
  verifiedConsumption?: number;
  externalDischarged?: number;
  otherAdjustments?: number;
}): number {
  const {
    onHireRob,
    fuelReceived = 0,
    verifiedConsumption = 0,
    externalDischarged = 0,
    otherAdjustments = 0,
  } = opts;
  return round(onHireRob + fuelReceived - verifiedConsumption - externalDischarged + otherAdjustments);
}

/** Reconcile a hire period for one fuel grade, honoring the incomplete-evidence rule. */
export function reconcileHirePeriod(input: HirePeriodInput): HirePeriodResult {
  const fuelReceived = input.fuelReceived ?? 0;
  const verifiedChange = round(input.actualOffHireRob - input.onHireRob);

  if (!input.evidenceComplete || input.verifiedConsumption == null || input.externalDischarged == null) {
    return {
      onHireRob: round(input.onHireRob),
      actualOffHireRob: round(input.actualOffHireRob),
      fuelReceived: round(fuelReceived),
      verifiedChange,
      expectedOffHireRob: null,
      variance: null,
      flag: 'insufficient_evidence',
      explanation:
        'Insufficient consumption/transfer evidence — reporting the verified on-hire to off-hire ' +
        'change only. No unexplained loss is inferred.',
    };
  }

  const expected = expectedOffHireRob({
    onHireRob: input.onHireRob,
    fuelReceived,
    verifiedConsumption: input.verifiedConsumption,
    externalDischarged: input.externalDischarged,
    otherAdjustments: input.otherAdjustments,
  });
  const variance = round(input.actualOffHireRob - expected);

  return {
    onHireRob: round(input.onHireRob),
    actualOffHireRob: round(input.actualOffHireRob),
    fuelReceived: round(fuelReceived),
    verifiedChange,
    expectedOffHireRob: expected,
    variance,
    explanation:
      variance === 0
        ? 'Actual off-hire ROB matches expected.'
        : variance > 0
          ? 'More fuel remained onboard than expected (positive variance).'
          : 'Less fuel remained onboard than expected (negative variance).',
  };
}
