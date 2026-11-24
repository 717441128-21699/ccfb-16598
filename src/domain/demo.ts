import type {
  BeerStyle,
  GasBucket,
  HydrometerReading,
  Jar,
  SoundSignature,
} from '../types';
import {
  DAY_MS,
  HOUR_MS,
  co2MassToVolumeMl,
  expectedCo2FromReading,
  hallAbvPercent,
  sgFromAbvPercent,
} from './fermentation';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSignatureTemplate(
  jarId: string,
  centerHz: number,
  durationMs: number,
  sampleCount = 18,
): SoundSignature {
  const low = centerHz < 450 ? 0.48 : centerHz < 700 ? 0.3 : 0.16;
  const high = centerHz > 800 ? 0.28 : centerHz > 500 ? 0.18 : 0.08;
  const mid = Math.max(0.25, 1 - low - high);
  return {
    jarId,
    trainedAt: Date.now() - DAY_MS,
    sampleCount,
    centerHz,
    centroidHz: centerHz * 1.12,
    bandwidthHz: centerHz * 0.34,
    durationMs,
    decayMs: durationMs * 0.72,
    lowRatio: low,
    midRatio: mid,
    highRatio: high,
    spread: {
      logHz: 0.075,
      duration: durationMs * 0.16,
      centroid: centerHz * 0.12,
      bandwidth: centerHz * 0.08,
      band: 0.08,
    },
  };
}

export interface ReferenceBatchOptions {
  id: string;
  name: string;
  beerName: string;
  style: BeerStyle;
  yeastId: string;
  startedAt: number;
  days: number;
  peakHour: number;
  seed: number;
  signatureHz: number;
  durationMs: number;
  status?: Jar['status'];
  createReadings?: boolean;
}

export interface ReferenceBatch {
  jar: Jar;
  buckets: GasBucket[];
  readings: HydrometerReading[];
  truth: {
    peakHour: number;
    primaryEndDay: number;
    finalSg: number;
    finalAbv: number;
    totalCo2G: number;
  };
}

/**
 * Generate a physically consistent fixture: gravity determines ABV/CO2 through
 * the same stoichiometric model used by the app. It simulates an airlock log and
 * daily rounded hydrometer readings for tests and first-run demonstration.
 */
export function generateReferenceBatch(opts: ReferenceBatchOptions): ReferenceBatch {
  const rand = mulberry32(opts.seed);
  const fg = opts.style.defaultFg;
  const jar: Jar = {
    id: opts.id,
    name: opts.name,
    beerName: opts.beerName,
    styleId: opts.style.id,
    yeastId: opts.yeastId,
    color: opts.style.color,
    startedAt: opts.startedAt,
    volumeL: opts.style.volumeL,
    og: opts.style.defaultOg,
    targetFg: fg,
    tempC: opts.style.tempC,
    pressureKPa: 101.325,
    bubbleVolumeMl: opts.signatureHz > 750 ? 0.34 : opts.signatureHz < 450 ? 1.15 : 0.62,
    productionFactor: 1,
    status: opts.status ?? 'active',
    signature: makeSignatureTemplate(opts.id, opts.signatureHz, opts.durationMs),
  };

  const finalAbv = hallAbvPercent(jar.og, fg);
  const totalCo2G = expectedCo2FromReading(jar, fg);
  // Weibull/Cumulative shape k=2; choosing tau = peakHour*sqrt(2) puts mode at peakHour.
  const tau = opts.peakHour * Math.SQRT2;
  const progress = (hour: number) => {
    if (hour <= 0) return 0;
    const x = hour / tau;
    return 1 - Math.exp(-x * x);
  };

  const buckets: GasBucket[] = [];
  const intervalHours = 1;
  const totalHours = opts.days * 24;
  for (let endHour = intervalHours; endHour <= totalHours; endHour += intervalHours) {
    const startProgress = progress(endHour - intervalHours);
    const endProgress = progress(endHour);
    const producedCo2G = totalCo2G * (endProgress - startProgress);
    if (producedCo2G < 0.01) continue;
    const gasMl = co2MassToVolumeMl(producedCo2G, jar.tempC, jar.pressureKPa);
    const bubbles = Math.max(0, Math.round(gasMl / jar.bubbleVolumeMl));
    if (bubbles <= 0) continue;
    const t = jar.startedAt + (endHour - intervalHours) * HOUR_MS;
    // Small independent per-bubble volume variation; hourly total stays close to physics.
    let volumeMl = 0;
    for (let i = 0; i < bubbles; i += 1) {
      volumeMl += jar.bubbleVolumeMl * (0.82 + rand() * 0.36);
    }
    buckets.push({
      jarId: jar.id,
      t,
      minutes: intervalHours * 60,
      bubbles,
      volumeMl,
    });
  }

  const readings: HydrometerReading[] = [];
  if (opts.createReadings !== false) {
    for (let day = 1; day <= opts.days; day += 1) {
      const hour = day * 24;
      const p = progress(hour);
      const trueSg = sgFromAbvPercent(jar.og, finalAbv * p);
      // Hydrometer resolution is 0.001 SG; that is the quantization seen by the user.
      const rounded = Math.round(trueSg * 1000) / 1000;
      readings.push({
        id: `${jar.id}-r${day}`,
        jarId: jar.id,
        t: jar.startedAt + hour * HOUR_MS,
        sg: rounded,
        tempC: jar.tempC - 0.5 + rand(),
        note: day === 7 ? '读数已接近终比重' : undefined,
      });
    }
  }

  return {
    jar,
    buckets,
    readings,
    truth: {
      peakHour: opts.peakHour,
      primaryEndDay: 7,
      finalSg: fg,
      finalAbv,
      totalCo2G,
    },
  };
}
