// =============================================================================
// Cargo Assurance — tank classification & corrected-receipt logic
// -----------------------------------------------------------------------------
// The heart of the "Taylor corrected reconciliation" layer. Raw evidence is never
// overwritten; corrected receipt differences and procedural effects are derived.
// See docs/cargo-assurance/cargo-calculation-engine.md (non-receiving tank logic).
// =============================================================================
import { round } from './numeric';

export type TankRole = 'receiving' | 'non_receiving' | 'day_service' | 'settling' | 'transfer' | 'excluded';

export interface TankReadingInput {
  role: TankRole;
  openingQuantity: number;
  closingQuantity: number;
  /** Whether this tank actually received fuel in the loadout. */
  receivedFuel: boolean;
  /** Net documented transfer into (+) or out of (−) this tank, if any. */
  documentedTransfer?: number;
}

export interface TankReadingResult {
  /** Raw evidence: closing − opening (preserved, never overwritten). */
  rawDifference: number;
  /** Corrected receipt attributed to this tank. */
  correctedReceiptDifference: number;
  /** Procedural effect = raw − corrected (what the client procedure over/understates). */
  proceduralEffect: number;
  explanation: string;
}

/**
 * Apply corrected-receipt logic to a single tank reading.
 *
 * - A receiving tank's corrected receipt = its raw change (the genuine delivery).
 * - A non-receiving / static tank that did not receive fuel contributes 0 corrected
 *   receipt unless a documented transfer occurred; its raw change is preserved as
 *   evidence and the difference becomes a procedural effect.
 * - Excluded tanks contribute nothing.
 */
export function evaluateTankReading(input: TankReadingInput): TankReadingResult {
  const rawDifference = round(input.closingQuantity - input.openingQuantity);

  if (input.role === 'excluded') {
    return {
      rawDifference,
      correctedReceiptDifference: 0,
      proceduralEffect: round(rawDifference - 0),
      explanation: 'Excluded tank: not included in corrected reconciliation.',
    };
  }

  // A tank that genuinely received fuel: corrected receipt is its real change.
  if (input.receivedFuel) {
    const corrected = rawDifference;
    return {
      rawDifference,
      correctedReceiptDifference: corrected,
      proceduralEffect: round(rawDifference - corrected),
      explanation: 'Receiving tank: corrected receipt equals measured change.',
    };
  }

  // Non-receiving: only a documented transfer changes the corrected receipt.
  const transfer = input.documentedTransfer ?? 0;
  const corrected = round(transfer);
  return {
    rawDifference,
    correctedReceiptDifference: corrected,
    proceduralEffect: round(rawDifference - corrected),
    explanation: transfer
      ? 'Non-receiving tank with documented transfer.'
      : 'Non-receiving tank measurement variation (corrected receipt set to zero).',
  };
}

export type ConsumptionSource = 'fueltrax' | 'engine_log' | 'duration_rate' | 'client_approved' | 'none';
export type ConsumptionClassification = 'documented' | 'estimated' | 'unsupported' | 'unexplained';

/**
 * Classify a day/service-tank reduction as consumption. A reduction is NEVER
 * automatically a delivery shortage. An estimate is never presented as measured fact.
 */
export function classifyConsumption(amount: number, source: ConsumptionSource): {
  classification: ConsumptionClassification;
  amount: number;
  isEstimate: boolean;
} {
  const map: Record<ConsumptionSource, ConsumptionClassification> = {
    fueltrax: 'documented',
    engine_log: 'documented',
    client_approved: 'documented',
    duration_rate: 'estimated',
    none: amount > 0 ? 'unsupported' : 'unexplained',
  };
  const classification = map[source];
  return { classification, amount: round(amount), isEstimate: classification !== 'documented' };
}
