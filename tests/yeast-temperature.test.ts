import { describe, expect, it } from 'vitest';
import {
  YEAST_PROFILES,
  peakAdvanceForWarming,
  predictedPeakHours,
  speedAtTemperature,
} from '../src/domain/yeast';

describe('acceptance: temperature and densest bubbling period', () => {
  it.each(YEAST_PROFILES)('$name: +2 °C always advances the peak inside the table', (yeast) => {
    for (const point of yeast.table) {
      const t = point.tempC;
      if (t + 2 > yeast.maxC) continue;
      const shift = peakAdvanceForWarming(yeast, t, 2);
      expect(shift.toHours).toBeLessThan(shift.fromHours);
      expect(shift.advanceHours).toBeGreaterThan(0);
      // Vendor-style Q10 ~2 means a 2 C step should not wildly move the peak.
      expect(shift.advanceHours).toBeLessThan(shift.fromHours * 0.3);
    }
  });

  it('uses the inverse of the vendor speed ratio, not an arbitrary shift', () => {
    const yeast = YEAST_PROFILES[0];
    for (const point of yeast.table.slice(0, -1)) {
      const t2 = point.tempC + 2;
      if (t2 > yeast.maxC) continue;
      const h1 = predictedPeakHours(yeast, point.tempC);
      const h2 = predictedPeakHours(yeast, t2);
      const speedRatio = speedAtTemperature(yeast, t2) / speedAtTemperature(yeast, point.tempC);
      expect(h1 / h2).toBeCloseTo(speedRatio, 6);
    }
  });

  it('gives the expected US-05-style magnitude: 20 to 22 C advances peak by roughly 5-8 hours', () => {
    const yeast = YEAST_PROFILES[0];
    const shift = peakAdvanceForWarming(yeast, 20, 2);
    expect(shift.fromHours).toBeCloseTo(48, 5);
    expect(shift.toHours).toBeCloseTo(48 / 1.15, 1);
    expect(shift.advanceHours).toBeGreaterThan(4.5);
    expect(shift.advanceHours).toBeLessThan(8.5);
  });

  it('cold lager peaks later than warm ale', () => {
    const lager = YEAST_PROFILES.find((y) => y.id === 'lager-w3470')!;
    const hefe = YEAST_PROFILES.find((y) => y.id === 'hefe-like')!;
    expect(predictedPeakHours(lager, 12)).toBeGreaterThan(80);
    expect(predictedPeakHours(hefe, 22)).toBeLessThan(40);
  });
});
