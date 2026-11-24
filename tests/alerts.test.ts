import { describe, expect, it } from 'vitest';
import type { GasBucket, Jar } from '../src/types';
import { checkStuck, checkSuddenSpike, checkTemperatureWithLimit } from '../src/domain/alerts';

const NOW = new Date('2026-11-25T12:00:00').getTime();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const jar = {
  id: 'j1',
  name: '测试罐',
  startedAt: NOW - 2 * DAY,
  og: 1.055,
  targetFg: 1.012,
  tempC: 20,
  status: 'active',
} as Jar;

describe('fermentation alerts', () => {
  it('warns and escalates high temperature against yeast maximum', () => {
    expect(checkTemperatureWithLimit({ ...jar, tempC: 25.5 }, 25)?.level).toBe('warning');
    expect(checkTemperatureWithLimit({ ...jar, tempC: 27.2 }, 25)?.level).toBe('critical');
    expect(checkTemperatureWithLimit({ ...jar, tempC: 20 }, 25)).toBeNull();
  });

  it('detects a sudden rate spike against the previous two-hour baseline', () => {
    const buckets: GasBucket[] = [
      { jarId: 'j1', t: NOW - 135 * MIN, minutes: 120, bubbles: 4, volumeMl: 2 },
      { jarId: 'j1', t: NOW - 15 * MIN, minutes: 15, bubbles: 20, volumeMl: 12 },
    ];
    const alert = checkSuddenSpike(jar, buckets, NOW);
    expect(alert?.type).toBe('spike');
    expect(alert?.level).toBe('critical');
  });

  it('does not alert for a normal recent rate', () => {
    const buckets: GasBucket[] = [
      { jarId: 'j1', t: NOW - 135 * MIN, minutes: 120, bubbles: 30, volumeMl: 18 },
      { jarId: 'j1', t: NOW - 15 * MIN, minutes: 15, bubbles: 5, volumeMl: 3 },
    ];
    expect(checkSuddenSpike(jar, buckets, NOW)).toBeNull();
  });

  it('warns after 6 quiet hours when gravity remains high', () => {
    const buckets: GasBucket[] = [
      { jarId: 'j1', t: NOW - 9 * HOUR, minutes: 60, bubbles: 12, volumeMl: 7 },
    ];
    const alert = checkStuck(jar, buckets, NOW);
    expect(alert?.type).toBe('stuck');
    expect(alert?.level).toBe('warning');
  });

  it('escalates a batch that has never produced a detected bubble after one day', () => {
    const alert = checkStuck({ ...jar, startedAt: NOW - 26 * HOUR }, [], NOW);
    expect(alert?.type).toBe('stuck');
    expect(alert?.level).toBe('critical');
  });

  it('does not call a completed warm jar stuck just because monitoring stopped', () => {
    const oldJar = { ...jar, status: 'conditioning' as const };
    expect(checkStuck(oldJar, [], NOW)).toBeNull();
  });
});
