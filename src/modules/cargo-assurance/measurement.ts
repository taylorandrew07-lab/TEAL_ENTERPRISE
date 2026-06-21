// =============================================================================
// Cargo Assurance — measurement-method calculations
// -----------------------------------------------------------------------------
// Meter, shore-tank, and general vessel mass-balance quantity calculations.
// Pure functions; see docs/cargo-assurance/cargo-calculation-engine.md.
// =============================================================================
import { round } from './numeric';

/**
 * Meter quantity = (closing − opening) × factor, with totalizer rollover support.
 * When the totalizer rolled over (closing < opening) and a rolloverMax is known,
 * the wrapped span is used. Without a rolloverMax, a closing < opening is returned
 * as-is (negative) so the caller can flag it rather than silently "correcting".
 */
export function meterQuantity(opts: {
  opening: number;
  closing: number;
  factor?: number;
  rolloverMax?: number;
}): number {
  const { opening, closing, factor = 1, rolloverMax } = opts;
  let raw = closing - opening;
  // Apply the rollover correction only when the max is consistent (>= opening).
  // An inconsistent max is ignored so `raw` stays negative and the caller can flag it,
  // rather than fabricating a plausible-but-wrong positive quantity.
  if (raw < 0 && rolloverMax != null && rolloverMax >= opening) {
    raw = rolloverMax - opening + closing;
  }
  return round(raw * factor);
}

/**
 * Shore delivery via tank mass balance:
 *   opening + receiptsIn − otherWithdrawals − closing = delivered to vessel.
 * Adjust for documented intervening receipts and other (non-delivery) withdrawals.
 */
export function shoreDelivery(opts: {
  opening: number;
  closing: number;
  receiptsIn?: number;
  otherWithdrawals?: number;
}): number {
  const { opening, closing, receiptsIn = 0, otherWithdrawals = 0 } = opts;
  return round(opening + receiptsIn - otherWithdrawals - closing);
}

/**
 * General vessel mass balance — fuel received during the operation:
 *   received = endInventory − startInventory + consumption
 *              + externalDischarged − otherExternalReceived
 * Internal transfers net to zero when all affected tanks are included, so they do
 * not appear here.
 */
export function vesselReceipt(opts: {
  startInventory: number;
  endInventory: number;
  consumption?: number;
  externalDischarged?: number;
  otherExternalReceived?: number;
}): number {
  const {
    startInventory,
    endInventory,
    consumption = 0,
    externalDischarged = 0,
    otherExternalReceived = 0,
  } = opts;
  return round(endInventory - startInventory + consumption + externalDischarged - otherExternalReceived);
}
