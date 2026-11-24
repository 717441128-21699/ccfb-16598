import { describe, expect, it } from 'vitest';
import { BEER_STYLES } from '../src/domain/yeast';
import { generateReferenceBatch } from '../src/domain/demo';
import {
  ETHANOL_PER_CO2_MASS,
  compareReadings,
  detectPrimaryEnd,
  estimateGravity,
  hallAbvPercent,
  sgFromAbvPercent,
} from '../src/domain/fermentation';

const START = new Date('2026-11-10T08:00:00').getTime();

function ipaFixture() {
  return generateReferenceBatch({
    id: 'test-ipa',
    name: '测试 IPA',
    beerName: '验收批次',
    style: BEER_STYLES[0],
    yeastId: 'us05-like',
    startedAt: START,
    days: 10,
    peakHour: 52,
    seed: 4242,
    signatureHz: 560,
    durationMs: 128,
  });
}

describe('stoichiometric gravity model', () => {
  it('uses the glucose to ethanol/CO2 mass ratio', () => {
    expect(ETHANOL_PER_CO2_MASS).toBeCloseTo(46.068 / 44.0095, 5);
    // 100 g CO2 corresponds to about 104.7 g ethanol.
    expect(100 * ETHANOL_PER_CO2_MASS).toBeCloseTo(104.68, 1);
  });

  it('inverts the Hall ABV/gravity relation exactly', () => {
    for (const [og, fg] of [
      [1.04, 1.008],
      [1.052, 1.011],
      [1.062, 1.012],
      [1.085, 1.018],
    ] as const) {
      const abv = hallAbvPercent(og, fg);
      expect(sgFromAbvPercent(og, abv)).toBeCloseTo(fg, 9);
    }
  });

  it('maps a realistic full fermentation to OG/FG within 0.0005 SG', () => {
    const og = 1.062;
    const fg = 1.012;
    const volumeL = 19;
    const abv = hallAbvPercent(og, fg);
    const ethanolG = (abv / 100) * volumeL * 1000 * 0.789;
    const co2G = ethanolG / ETHANOL_PER_CO2_MASS;
    // At 20 C the model converts mass back to wet airlock volume; estimate accepts mL.
    const gasMl = (co2G / 44.0095) * 8.314462618 * 293.15 / (101.325 - 2.338) * 1000;
    const estimate = estimateGravity({ og, volumeL, cumulativeGasMl: gasMl });
    expect(Math.abs(estimate.sg - fg)).toBeLessThan(0.0005);
    expect(estimate.abv).toBeCloseTo(abv, 1);
  });
});

describe('acceptance: hydrometer agreement and primary-end day', () => {
  it('keeps every daily inferred SG within 0.003 of rounded hydrometer readings', () => {
    const fx = ipaFixture();
    const report = compareReadings(fx.jar, fx.buckets, fx.readings, 0.003);
    expect(report.comparisons.length).toBeGreaterThanOrEqual(8);
    for (const c of report.comparisons) {
      expect(c.absResidual, `${new Date(c.reading.t).toISOString()} residual`).toBeLessThanOrEqual(0.003);
    }
    expect(report.maxAbs).toBeLessThanOrEqual(0.003);
    expect(report.withinTolerance).toBe(true);
  });

  it('identifies the seeded main fermentation end day as day 7', () => {
    const fx = ipaFixture();
    const end = detectPrimaryEnd(fx.jar, fx.buckets, fx.readings);
    expect(end.peakDay).toBe(3);
    expect(end.endDay).toBe(fx.truth.primaryEndDay);
    expect(end.endDay).toBe(7);
  });

  it('does not claim an end for a batch with only two days of data', () => {
    const fx = ipaFixture();
    fx.buckets = fx.buckets.filter((b) => b.t < START + 2 * 86_400_000);
    const end = detectPrimaryEnd(fx.jar, fx.buckets, fx.readings);
    expect(end.endDay).toBeUndefined();
  });
});
