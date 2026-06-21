import { describe, it, expect } from 'vitest';
import { convertVolume, celsiusToFahrenheit, apiToSpecificGravity, specificGravityToApi, toStandardVolume } from '../units';
import { meterQuantity, shoreDelivery, vesselReceipt } from '../measurement';
import { evaluateTankReading, classifyConsumption } from '../tanks';
import { variance, variancePct, claimedOverReceived, proceduralApparentLoss, unexplainedResidual } from '../comparison';
import {
  cumulativeVariancePct,
  weightedMeanVariancePct,
  sameDirectionPct,
  withinTolerancePct,
  aggregateReview,
} from '../aggregation';
import { reconcileHirePeriod, expectedOffHireRob } from '../hire';
import { densityFromSG, densityFromApi, volumeToMass, observedVolumeToMass } from '../mass';
import { round, weightedMean } from '../numeric';
import {
  evaluateNode,
  evaluateMethodology,
  RuleEvaluationError,
  MAX_RULE_DEPTH,
  MAX_SUM_ARGS,
  type Methodology,
  type RuleNode,
} from '../rules-engine';

describe('units', () => {
  it('converts barrels to cubic metres and back', () => {
    expect(convertVolume(100, 'bbl', 'm3')).toBeCloseTo(15.8987, 4);
    expect(convertVolume(convertVolume(100, 'bbl', 'm3'), 'm3', 'bbl')).toBeCloseTo(100, 2);
  });
  it('converts litres and US gallons to m3 (engine rounds to 4 dp, numeric(20,4))', () => {
    expect(convertVolume(1000, 'L', 'm3')).toBeCloseTo(1, 6);
    // 1000 US gal = 3.785411784 m3 -> 3.7854 at the engine's 4-dp contract.
    expect(convertVolume(1000, 'usgal', 'm3')).toBeCloseTo(3.7854, 4);
  });
  it('handles temperature and API/SG', () => {
    expect(celsiusToFahrenheit(15)).toBeCloseTo(59, 4);
    expect(specificGravityToApi(apiToSpecificGravity(35))).toBeCloseTo(35, 3);
  });
  it('never assumes a standard-volume correction the source lacks', () => {
    expect(toStandardVolume(100, undefined)).toEqual({ value: null, flag: 'missing_vcf' });
    expect(toStandardVolume(100, 0.985).value).toBeCloseTo(98.5, 4);
  });
});

describe('measurement methods', () => {
  it('meter quantity = (closing - opening) x factor', () => {
    expect(meterQuantity({ opening: 1000, closing: 1150 })).toBe(150);
    expect(meterQuantity({ opening: 1000, closing: 1150, factor: 1.002 })).toBeCloseTo(150.3, 4);
  });
  it('handles totalizer rollover when a max is known', () => {
    expect(meterQuantity({ opening: 9990, closing: 40, rolloverMax: 10000 })).toBe(50);
  });
  it('shore delivery via tank mass balance', () => {
    expect(shoreDelivery({ opening: 500, closing: 350 })).toBe(150);
    expect(shoreDelivery({ opening: 500, closing: 350, receiptsIn: 20, otherWithdrawals: 5 })).toBe(165);
  });
  it('vessel mass balance receipt', () => {
    expect(
      vesselReceipt({ startInventory: 100, endInventory: 280, consumption: 20, externalDischarged: 0, otherExternalReceived: 0 }),
    ).toBe(200);
  });
});

describe('tank classification (non-receiving tank logic)', () => {
  it('reproduces the spec example: 17.0 -> 16.6 non-receiving tank', () => {
    const r = evaluateTankReading({
      role: 'non_receiving',
      openingQuantity: 17.0,
      closingQuantity: 16.6,
      receivedFuel: false,
    });
    expect(r.rawDifference).toBeCloseTo(-0.4, 4);
    expect(r.correctedReceiptDifference).toBe(0);
    expect(r.proceduralEffect).toBeCloseTo(-0.4, 4);
  });
  it('a receiving tank corrected receipt equals its measured change', () => {
    const r = evaluateTankReading({ role: 'receiving', openingQuantity: 10, closingQuantity: 60, receivedFuel: true });
    expect(r.rawDifference).toBe(50);
    expect(r.correctedReceiptDifference).toBe(50);
    expect(r.proceduralEffect).toBe(0);
  });
  it('a documented transfer changes a non-receiving tank corrected receipt', () => {
    const r = evaluateTankReading({
      role: 'transfer',
      openingQuantity: 20,
      closingQuantity: 12,
      receivedFuel: false,
      documentedTransfer: -8,
    });
    expect(r.rawDifference).toBe(-8);
    expect(r.correctedReceiptDifference).toBe(-8);
    expect(r.proceduralEffect).toBe(0);
  });
  it('classifies consumption without presenting estimates as measured', () => {
    expect(classifyConsumption(12, 'fueltrax').classification).toBe('documented');
    expect(classifyConsumption(12, 'duration_rate')).toMatchObject({ classification: 'estimated', isEstimate: true });
    expect(classifyConsumption(12, 'none').classification).toBe('unsupported');
  });
});

describe('comparison engine sign convention', () => {
  it('variance = comparison - reference (positive = comparison reports more)', () => {
    expect(variance(105, 100)).toBe(5);
    expect(variance(95, 100)).toBe(-5);
  });
  it('variance % is null when the reference is zero', () => {
    expect(variancePct(5, 0)).toBeNull();
    expect(variancePct(105, 100)).toBeCloseTo(5, 4);
  });
  it('derived comparison metrics', () => {
    expect(claimedOverReceived(200, 196)).toBe(4);
    expect(proceduralApparentLoss(200, 196)).toBe(4);
    expect(unexplainedResidual(196, 192)).toBe(4);
  });
});

describe('aggregation (never sum percentages)', () => {
  it('cumulative variance % comes from aggregated quantities, not averaged percentages', () => {
    // Two loadouts: small one with a big %, large one with a small %.
    const records = [
      { variancePct: 10, referenceQty: 10 }, // comparison 11
      { variancePct: 1, referenceQty: 1000 }, // comparison 1010
    ];
    const naiveAverage = (10 + 1) / 2; // 5.5 — WRONG way
    const weighted = weightedMeanVariancePct(records)!;
    const cumulative = cumulativeVariancePct(11 + 1010, 10 + 1000)!;
    expect(weighted).toBeCloseTo(1.0891, 3);
    expect(cumulative).toBeCloseTo(1.0891, 3);
    expect(weighted).not.toBeCloseTo(naiveAverage, 1);
  });
  it('same-direction and within-tolerance percentages', () => {
    expect(sameDirectionPct([1, 2, 3, -1])).toBeCloseTo(75, 4); // 3 of 4 positive
    expect(sameDirectionPct([0, 0])).toBeNull();
    expect(withinTolerancePct([0.2, -0.4, 1.2, -2.0], 1.0)).toBeCloseTo(50, 4);
  });
  it('aggregates a review and derives cumulative procedural apparent loss', () => {
    const totals = aggregateReview([
      { nominated: 100, reportedDelivery: 99, clientProcedure: 98.6, taylorCorrected: 99, nonReceivingProceduralEffect: -0.4 },
      { nominated: 200, reportedDelivery: 201, clientProcedure: 200.5, taylorCorrected: 201, nonReceivingProceduralEffect: -0.5 },
    ]);
    expect(totals.loadoutCount).toBe(2);
    expect(totals.totalTaylorCorrected).toBe(300);
    expect(totals.totalClientProcedure).toBeCloseTo(299.1, 4);
    expect(totals.cumulativeProceduralApparentLoss).toBeCloseTo(0.9, 4);
    expect(totals.cumulativeClaimedOverReceived).toBeCloseTo(0, 4);
  });
});

describe('hire-period reconciliation', () => {
  it('computes expected off-hire ROB and variance when evidence is complete', () => {
    expect(expectedOffHireRob({ onHireRob: 500, fuelReceived: 200, verifiedConsumption: 40 })).toBe(660);
    const r = reconcileHirePeriod({
      onHireRob: 500,
      actualOffHireRob: 655,
      fuelReceived: 200,
      verifiedConsumption: 40,
      externalDischarged: 0,
      evidenceComplete: true,
    });
    expect(r.expectedOffHireRob).toBe(660);
    expect(r.variance).toBe(-5);
  });
  it('does NOT infer loss when consumption/transfer evidence is missing', () => {
    const r = reconcileHirePeriod({
      onHireRob: 500,
      actualOffHireRob: 655,
      fuelReceived: 200,
      verifiedConsumption: null,
      externalDischarged: null,
      evidenceComplete: false,
    });
    expect(r.flag).toBe('insufficient_evidence');
    expect(r.expectedOffHireRob).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.verifiedChange).toBe(155); // only the verified on->off change
  });
});

describe('mass conversion (liquid cargo)', () => {
  it('derives density at 15C from SG and API', () => {
    expect(densityFromSG(0.85)).toBeCloseTo(849.1636, 3); // 0.85 x 999.016
    expect(densityFromApi(35)).toBeCloseTo(849.5, 0); // ~SG 0.8498
  });
  it('converts standard volume + density to tonnes (vacuum and in air)', () => {
    const m = volumeToMass(1000, 850);
    expect(m.massVacuumTonnes).toBeCloseTo(850, 4); // 1000 x 850 / 1000
    expect(m.massAirTonnes).toBeCloseTo(848.9, 4); // 1000 x (850 - 1.1) / 1000
  });
  it('observed volume -> mass using a supplied VCF and SG', () => {
    const r = observedVolumeToMass({ observedVolume: 1010, vcf: 0.99, sg: 0.85 });
    expect(r.standardVolumeM3).toBeCloseTo(999.9, 4);
    expect(r.density15KgM3).toBeCloseTo(849.1636, 3);
    expect(r.massAirTonnes).toBeCloseTo(round999(999.9 * (849.1636 - 1.1)) / 1000, 2);
    expect(r.flags).toHaveLength(0);
  });
  it('flags missing density and missing VCF instead of fabricating', () => {
    expect(observedVolumeToMass({ observedVolume: 1000, vcf: 0.99 }).flags).toContain('missing_density');
    expect(observedVolumeToMass({ observedVolume: 1000, sg: 0.85 }).flags).toContain('missing_vcf');
    expect(observedVolumeToMass({ observedVolume: 1000, sg: 0.85 }).massAirTonnes).toBeNull();
  });
  it('only applies an approximate VCF when the caller explicitly opts in', () => {
    const r = observedVolumeToMass({ observedVolume: 1000, sg: 0.85, temperatureC: 30, expansionCoeffPerC: 0.0008 });
    expect(r.approximate).toBe(true);
    expect(r.flags).toContain('approximate_vcf');
    expect(r.massAirTonnes).not.toBeNull();
  });
});

function round999(v: number): number {
  return Math.round(v * 10000) / 10000;
}

describe('safe versioned rules engine', () => {
  it('evaluates declarative nodes without eval', () => {
    const ctx = { a: 10, b: 4 };
    expect(evaluateNode({ op: 'sub', args: [{ ref: 'a' }, { ref: 'b' }] }, ctx)).toBe(6);
    expect(evaluateNode({ op: 'sum', args: [{ ref: 'a' }, { ref: 'b' }, { const: 1 }] }, ctx)).toBe(15);
  });
  it('rejects unknown inputs and division by zero', () => {
    expect(() => evaluateNode({ ref: 'missing' }, {})).toThrow(RuleEvaluationError);
    expect(() => evaluateNode({ op: 'div', args: [{ const: 1 }, { const: 0 }] }, {})).toThrow(RuleEvaluationError);
  });
  it('pins a methodology that separates client vs Taylor treatment of a non-receiving tank', () => {
    const methodology: Methodology = {
      key: 'taylor_corrected',
      version: 1,
      outputs: {
        clientReceived: { op: 'sum', args: [{ ref: 'receivingDelta' }, { ref: 'nonReceivingDelta' }] },
        taylorReceived: { ref: 'receivingDelta' },
        proceduralApparentLoss: {
          op: 'sub',
          args: [{ ref: 'receivingDelta' }, { op: 'sum', args: [{ ref: 'receivingDelta' }, { ref: 'nonReceivingDelta' }] }],
        },
      },
    };
    const out = evaluateMethodology(methodology, { receivingDelta: 50.0, nonReceivingDelta: -0.4 });
    expect(out.clientReceived).toBeCloseTo(49.6, 4);
    expect(out.taylorReceived).toBe(50);
    expect(out.proceduralApparentLoss).toBeCloseTo(0.4, 4);
  });
});

describe('audit hardening — numeric, mass, meter, rules-engine bounds', () => {
  it('round() is correct half-away-from-zero on .5 boundaries (no float bias)', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(0.285, 2)).toBe(0.29);
    expect(round(-1.005, 2)).toBe(-1.01);
  });

  it('weightedMean ignores non-positive weights and returns null when none remain', () => {
    expect(weightedMean([{ value: 10, weight: -5 }, { value: 2, weight: 5 }])).toBe(2);
    expect(weightedMean([{ value: 10, weight: 0 }, { value: 2, weight: -1 }])).toBeNull();
  });

  it('observedVolumeToMass flags a singular density instead of returning Infinity tonnes', () => {
    const r = observedVolumeToMass({ observedVolume: 1000, vcf: 0.99, api: -131.5 });
    expect(r.flags).toContain('invalid_density');
    expect(r.massAirTonnes).toBeNull();
  });

  it('meterQuantity ignores an inconsistent rolloverMax (< opening) rather than fabricating', () => {
    // rolloverMax 5000 < opening 9990: do NOT "correct"; leave the negative for the caller to flag.
    expect(meterQuantity({ opening: 9990, closing: 40, rolloverMax: 5000 })).toBe(-9950);
    // a consistent max still corrects.
    expect(meterQuantity({ opening: 9990, closing: 40, rolloverMax: 10000 })).toBe(50);
  });

  it('rules-engine rejects an over-deep rule tree with RuleEvaluationError (no stack overflow)', () => {
    let deep: RuleNode = { const: 1 };
    for (let i = 0; i < MAX_RULE_DEPTH + 5; i++) deep = { op: 'neg', args: [deep] };
    expect(() => evaluateNode(deep, {})).toThrow(RuleEvaluationError);
  });

  it('rules-engine rejects an over-wide sum', () => {
    const wide: RuleNode = { op: 'sum', args: Array.from({ length: MAX_SUM_ARGS + 1 }, () => ({ const: 1 })) };
    expect(() => evaluateNode(wide, {})).toThrow(RuleEvaluationError);
  });
});
