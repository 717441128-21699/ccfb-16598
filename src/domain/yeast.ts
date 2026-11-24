import type { BeerStyle, YeastProfile } from '../types';

/**
 * Built-in speed curves are normalized so speed = 1 at refTempC.
 * They follow the usual yeast-manufacturer pattern: approximately Q10 ≈ 2,
 * i.e. +2 °C gives about 12–16% more fermentation speed in the healthy range.
 * The table is editable because exact vendor tables differ by strain and batch.
 */
export const YEAST_PROFILES: YeastProfile[] = [
  {
    id: 'us05-like',
    name: '美式艾尔酵母（US-05 型走势）',
    vendor: '常见干酵母温度-速度模板，可替换为厂商表',
    minC: 12,
    maxC: 25,
    refTempC: 20,
    peakAtRefHours: 48,
    q10: 2.05,
    table: [
      { tempC: 12, speed: 0.56 },
      { tempC: 14, speed: 0.66 },
      { tempC: 16, speed: 0.77 },
      { tempC: 18, speed: 0.88 },
      { tempC: 20, speed: 1.0 },
      { tempC: 22, speed: 1.15 },
      { tempC: 24, speed: 1.33 },
      { tempC: 25, speed: 1.43 },
    ],
  },
  {
    id: 's04-like',
    name: '英式艾尔酵母（S-04 型走势）',
    vendor: '常见絮凝型艾尔酵母模板',
    minC: 14,
    maxC: 24,
    refTempC: 20,
    peakAtRefHours: 42,
    q10: 2.15,
    table: [
      { tempC: 14, speed: 0.63 },
      { tempC: 16, speed: 0.75 },
      { tempC: 18, speed: 0.88 },
      { tempC: 20, speed: 1.0 },
      { tempC: 22, speed: 1.17 },
      { tempC: 24, speed: 1.38 },
    ],
  },
  {
    id: 'hefe-like',
    name: '小麦酵母（WB-06 型走势）',
    vendor: '酯香小麦酵母模板',
    minC: 18,
    maxC: 28,
    refTempC: 22,
    peakAtRefHours: 36,
    q10: 2.2,
    table: [
      { tempC: 18, speed: 0.73 },
      { tempC: 20, speed: 0.86 },
      { tempC: 22, speed: 1.0 },
      { tempC: 24, speed: 1.17 },
      { tempC: 26, speed: 1.37 },
      { tempC: 28, speed: 1.61 },
    ],
  },
  {
    id: 'lager-w3470',
    name: '拉格酵母（W-34/70 型走势）',
    vendor: '低温拉格酵母模板',
    minC: 9,
    maxC: 15,
    refTempC: 12,
    peakAtRefHours: 96,
    q10: 2.3,
    table: [
      { tempC: 9, speed: 0.78 },
      { tempC: 10, speed: 0.85 },
      { tempC: 11, speed: 0.92 },
      { tempC: 12, speed: 1.0 },
      { tempC: 13, speed: 1.09 },
      { tempC: 14, speed: 1.18 },
      { tempC: 15, speed: 1.28 },
    ],
  },
  {
    id: 'saison-like',
    name: '赛松高温酵母（3711 型走势）',
    vendor: '高温高发酵度赛松模板',
    minC: 20,
    maxC: 32,
    refTempC: 26,
    peakAtRefHours: 30,
    q10: 1.9,
    table: [
      { tempC: 20, speed: 0.68 },
      { tempC: 22, speed: 0.77 },
      { tempC: 24, speed: 0.88 },
      { tempC: 26, speed: 1.0 },
      { tempC: 28, speed: 1.14 },
      { tempC: 30, speed: 1.3 },
      { tempC: 32, speed: 1.47 },
    ],
  },
];

export const BEER_STYLES: BeerStyle[] = [
  {
    id: 'american-ipa',
    name: '美式 IPA',
    color: '#f59e0b',
    defaultOg: 1.062,
    defaultFg: 1.012,
    volumeL: 19,
    tempC: 19,
    yeastId: 'us05-like',
    peakHourFactor: 1.05,
    expectedPrimaryDays: 7,
    attenuation: 0.79,
    processNote: '高温放量发酵，第 3 天前后冒泡最密；主发酵约 7 天，之后干投。',
  },
  {
    id: 'stout',
    name: '世涛 / 波特',
    color: '#7c3f1d',
    defaultOg: 1.052,
    defaultFg: 1.014,
    volumeL: 19,
    tempC: 20,
    yeastId: 's04-like',
    peakHourFactor: 1.12,
    expectedPrimaryDays: 8,
    attenuation: 0.73,
    processNote: '絮凝快、峰期略晚且低一些；比重 plateau 后可升温二乙酰还原。',
  },
  {
    id: 'hefeweizen',
    name: '德式小麦',
    color: '#eab308',
    defaultOg: 1.05,
    defaultFg: 1.012,
    volumeL: 20,
    tempC: 22,
    yeastId: 'hefe-like',
    peakHourFactor: 0.9,
    expectedPrimaryDays: 5,
    attenuation: 0.76,
    processNote: '22 °C 左右酯香明显，峰期来得快；注意顶部泡沫和气塞溢出。',
  },
  {
    id: 'pilsner',
    name: '皮尔森 / 拉格',
    color: '#84cc16',
    defaultOg: 1.048,
    defaultFg: 1.01,
    volumeL: 20,
    tempC: 12,
    yeastId: 'lager-w3470',
    peakHourFactor: 1.0,
    expectedPrimaryDays: 12,
    attenuation: 0.8,
    processNote: '低温启动，峰期约第 4 天；主发酵 10–14 天，随后低温熟成。',
  },
  {
    id: 'saison',
    name: '赛松',
    color: '#fb923c',
    defaultOg: 1.058,
    defaultFg: 1.006,
    volumeL: 20,
    tempC: 27,
    yeastId: 'saison-like',
    peakHourFactor: 0.82,
    expectedPrimaryDays: 6,
    attenuation: 0.88,
    processNote: '高温、高发酵度，峰期早且猛烈；需重点监视冒泡突然加快和溢罐。',
  },
];

export function getYeast(id: string, extra: YeastProfile[] = []): YeastProfile {
  return [...extra, ...YEAST_PROFILES].find((y) => y.id === id) ?? YEAST_PROFILES[0];
}

export function getStyle(id: string, extra: BeerStyle[] = []): BeerStyle {
  return [...extra, ...BEER_STYLES].find((s) => s.id === id) ?? BEER_STYLES[0];
}

/** Piecewise-linear interpolation of the vendor speed table. */
export function speedAtTemperature(yeast: YeastProfile, tempC: number): number {
  const table = [...yeast.table].sort((a, b) => a.tempC - b.tempC);
  if (table.length === 0) {
    return Math.pow(yeast.q10, (tempC - yeast.refTempC) / 10);
  }
  if (tempC <= table[0].tempC) {
    const first = table[0];
    return Math.max(0.05, first.speed * Math.pow(yeast.q10, (tempC - first.tempC) / 10));
  }
  const last = table[table.length - 1];
  if (tempC >= last.tempC) {
    return Math.max(0.05, last.speed * Math.pow(yeast.q10, (tempC - last.tempC) / 10));
  }
  for (let i = 0; i < table.length - 1; i += 1) {
    const a = table[i];
    const b = table[i + 1];
    if (tempC >= a.tempC && tempC <= b.tempC) {
      const u = (tempC - a.tempC) / (b.tempC - a.tempC);
      return a.speed + (b.speed - a.speed) * u;
    }
  }
  return 1;
}

/** Hours from pitch/start to the densest bubbling interval. */
export function predictedPeakHours(
  yeast: YeastProfile,
  tempC: number,
  styleFactor = 1,
): number {
  const refSpeed = speedAtTemperature(yeast, yeast.refTempC);
  const currentSpeed = speedAtTemperature(yeast, tempC);
  return yeast.peakAtRefHours * styleFactor * (refSpeed / currentSpeed);
}

export function predictedPeak(
  yeast: YeastProfile,
  tempC: number,
  styleFactor = 1,
  startedAt?: number,
) {
  const peakHours = predictedPeakHours(yeast, tempC, styleFactor);
  return {
    tempC,
    peakHours,
    speed: speedAtTemperature(yeast, tempC),
    peakDate: startedAt ? new Date(startedAt + peakHours * 3_600_000) : undefined,
  };
}

/**
 * Returns how many hours earlier the peak is at tempC + deltaC.
 * Positive advanceHours means the warmer fermentation peaks earlier.
 */
export function peakAdvanceForWarming(
  yeast: YeastProfile,
  tempC: number,
  deltaC = 2,
  styleFactor = 1,
): { fromHours: number; toHours: number; advanceHours: number } {
  const fromHours = predictedPeakHours(yeast, tempC, styleFactor);
  const toHours = predictedPeakHours(yeast, tempC + deltaC, styleFactor);
  return { fromHours, toHours, advanceHours: fromHours - toHours };
}
