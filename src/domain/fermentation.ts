import type {
  AccuracyReport,
  BubbleEvent,
  GasBucket,
  GravityEstimate,
  HydrometerReading,
  Jar,
  ReadingComparison,
} from '../types';

export const M_GLUCOSE = 180.156;
export const M_ETHANOL = 46.068;
export const M_CO2 = 44.0095;
export const ETHANOL_DENSITY_G_PER_ML = 0.789;
export const GAS_CONSTANT_L_KPA = 8.314462618;

/** 2 mol CO2 and 2 mol ethanol are produced per mol glucose. */
export const CO2_PER_SUGAR_MASS = (2 * M_CO2) / M_GLUCOSE; // ≈ 0.4886 g/g
export const SUGAR_PER_CO2_MASS = 1 / CO2_PER_SUGAR_MASS; // ≈ 2.0467 g/g
export const ETHANOL_PER_CO2_MASS = M_ETHANOL / M_CO2; // equal stoichiometric mol count

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** ASBC polynomial: specific gravity -> degrees Plato. */
export function platoFromSg(sg: number): number {
  return (
    -616.868 +
    1111.14 * sg -
    630.272 * sg * sg +
    135.997 * sg * sg * sg
  );
}

/** Invert the Plato polynomial with bisection in the normal brewing range. */
export function sgFromPlato(plato: number): number {
  let lo = 0.99;
  let hi = 1.14;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (platoFromSg(mid) < plato) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Antoine equation for water vapour pressure in kPa. */
export function waterVapourKPa(tempC: number): number {
  const t = clamp(tempC, 1, 99);
  const mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t));
  return mmHg * 0.133322;
}

/**
 * Convert the measured wet airlock gas volume to CO2 mass.
 * Bubble gas is assumed saturated with water; subtract water vapour partial pressure.
 */
export function co2VolumeToMassG(
  volumeMl: number,
  tempC = 20,
  pressureKPa = 101.325,
  wet = true,
): number {
  const volumeL = Math.max(0, volumeMl) / 1000;
  const tempK = tempC + 273.15;
  const vapour = wet ? waterVapourKPa(tempC) : 0;
  const co2Pressure = Math.max(0, pressureKPa - vapour);
  const moles = (co2Pressure * volumeL) / (GAS_CONSTANT_L_KPA * tempK);
  return moles * M_CO2;
}

export function co2MassToVolumeMl(
  massG: number,
  tempC = 20,
  pressureKPa = 101.325,
  wet = true,
): number {
  const tempK = tempC + 273.15;
  const vapour = wet ? waterVapourKPa(tempC) : 0;
  const co2Pressure = Math.max(1, pressureKPa - vapour);
  const moles = Math.max(0, massG) / M_CO2;
  return ((moles * GAS_CONSTANT_L_KPA * tempK) / co2Pressure) * 1000;
}

/** Michael Hall / Zymurgy ABV relation from original and current specific gravity. */
export function hallAbvPercent(og: number, sg: number): number {
  return ((76.08 * (og - sg)) / (1.775 - og)) * (sg / 0.794);
}

/** Invert hallAbvPercent for current SG, given OG and gas-derived ABV. */
export function sgFromAbvPercent(og: number, abvPercent: number): number {
  const k = (abvPercent * 0.794 * (1.775 - og)) / 76.08;
  const discriminant = og * og - 4 * k;
  if (discriminant < 0) {
    // Physically impossible input; clamp to the lower plausible branch boundary.
    return og / 2;
  }
  // The high root is the current gravity near OG.
  return (og + Math.sqrt(discriminant)) / 2;
}

export interface GravityInput {
  og: number;
  volumeL: number;
  cumulativeGasMl: number;
  tempC?: number;
  pressureKPa?: number;
  /** Calibrated multiplier for dissolved CO2, missed bubbles and leakage. */
  productionFactor?: number;
}

export function estimateGravity(input: GravityInput): GravityEstimate {
  const {
    og,
    volumeL,
    cumulativeGasMl,
    tempC = 20,
    pressureKPa = 101.325,
    productionFactor = 1,
  } = input;

  const measuredCo2G = co2VolumeToMassG(cumulativeGasMl, tempC, pressureKPa);
  const co2MassG = measuredCo2G * productionFactor;
  const ethanolMassG = co2MassG * ETHANOL_PER_CO2_MASS;
  const sugarMassG = co2MassG * SUGAR_PER_CO2_MASS;
  const ethanolMl = ethanolMassG / ETHANOL_DENSITY_G_PER_ML;
  const abv = volumeL > 0 ? (ethanolMl / (volumeL * 1000)) * 100 : 0;
  const sg = clamp(sgFromAbvPercent(og, abv), 0.99, og + 0.0005);

  return {
    sg,
    plato: platoFromSg(sg),
    abv,
    co2MassG,
    ethanolMassG,
    sugarMassG,
    gasVolumeL: cumulativeGasMl / 1000,
    calibrated: productionFactor !== 1,
  };
}

export function bucketKey(jarId: string, t: number): string {
  return `${jarId}:${t}`;
}

export function cumulativeGasMl(
  buckets: GasBucket[],
  jarId: string,
  untilT = Number.POSITIVE_INFINITY,
): number {
  let total = 0;
  for (const b of buckets) {
    if (b.jarId === jarId && b.t <= untilT) total += b.volumeMl;
  }
  return total;
}

export function cumulativeBubbleCount(
  buckets: GasBucket[],
  jarId: string,
  untilT = Number.POSITIVE_INFINITY,
): number {
  let total = 0;
  for (const b of buckets) {
    if (b.jarId === jarId && b.t <= untilT) total += b.bubbles;
  }
  return total;
}

export function estimateJarAt(
  jar: Jar,
  buckets: GasBucket[],
  t: number,
): GravityEstimate {
  return estimateGravity({
    og: jar.og,
    volumeL: jar.volumeL,
    cumulativeGasMl: cumulativeGasMl(buckets, jar.id, t),
    tempC: jar.tempC,
    pressureKPa: jar.pressureKPa,
    productionFactor: jar.productionFactor,
  });
}

/** Expected escaped CO2 mass implied by a hydrometer SG. */
export function expectedCo2FromReading(jar: Jar, sg: number): number {
  const abv = hallAbvPercent(jar.og, sg);
  const ethanolMassG = (abv / 100) * jar.volumeL * 1000 * ETHANOL_DENSITY_G_PER_ML;
  return ethanolMassG / ETHANOL_PER_CO2_MASS;
}

/**
 * Fit one robust gas-production scale factor from paired hydrometer readings.
 * A single scalar is enough to absorb mean bubble-volume, dissolution and leak error.
 */
export function fitProductionFactor(
  jar: Jar,
  buckets: GasBucket[],
  readings: HydrometerReading[],
): number {
  const ratios: number[] = [];
  for (const r of readings) {
    if (r.sg >= jar.og - 0.003) continue;
    const rawCo2G = co2VolumeToMassG(
      cumulativeGasMl(buckets, jar.id, r.t),
      jar.tempC,
      jar.pressureKPa,
    );
    const expectedCo2G = expectedCo2FromReading(jar, r.sg);
    if (rawCo2G > 5 && expectedCo2G > 5) {
      ratios.push(clamp(expectedCo2G / rawCo2G, 0.5, 2.5));
    }
  }
  if (ratios.length === 0) return jar.productionFactor;
  // Fit relative to the current factor so repeated calibration is stable.
  return clamp(jar.productionFactor * median(ratios), 0.5, 2.5);
}

export function compareReadings(
  jar: Jar,
  buckets: GasBucket[],
  readings: HydrometerReading[],
  tolerance = 0.003,
): AccuracyReport {
  const comparisons: ReadingComparison[] = readings
    .filter((r) => r.jarId === jar.id)
    .sort((a, b) => a.t - b.t)
    .map((reading) => {
      const estimatedSg = estimateJarAt(jar, buckets, reading.t).sg;
      const residual = estimatedSg - reading.sg;
      return { reading, estimatedSg, residual, absResidual: Math.abs(residual) };
    });

  const residuals = comparisons.map((c) => c.residual);
  const maxAbs = comparisons.reduce((m, c) => Math.max(m, c.absResidual), 0);
  const rmse = Math.sqrt(
    residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, residuals.length),
  );
  const bias = residuals.reduce((a, b) => a + b, 0) / Math.max(1, residuals.length);

  return {
    comparisons,
    maxAbs,
    rmse,
    bias,
    withinTolerance: comparisons.length > 0 && maxAbs <= tolerance + 1e-9,
    tolerance,
  };
}

export interface RatePoint {
  t: number;
  bubblesPerHour: number;
  mlPerHour: number;
  bubbles: number;
  volumeMl: number;
  minutes: number;
}

export function bucketToRatePoint(b: GasBucket): RatePoint {
  const hours = Math.max(1 / 60, b.minutes / 60);
  return {
    t: b.t,
    bubblesPerHour: b.bubbles / hours,
    mlPerHour: b.volumeMl / hours,
    bubbles: b.bubbles,
    volumeMl: b.volumeMl,
    minutes: b.minutes,
  };
}

export function jarRateSeries(buckets: GasBucket[], jarId: string): RatePoint[] {
  return buckets
    .filter((b) => b.jarId === jarId)
    .sort((a, b) => a.t - b.t)
    .map(bucketToRatePoint);
}

export interface DailyFermentationPoint {
  day: number;
  t: number;
  bubbles: number;
  volumeMl: number;
  bubblesPerHour: number;
  mlPerHour: number;
  estimatedSg: number;
  abv: number;
}

/** Aggregate gas from startedAt into fixed 24 h fermentation days. */
export function dailySeries(
  jar: Jar,
  buckets: GasBucket[],
  maxDays = 30,
): DailyFermentationPoint[] {
  const days: DailyFermentationPoint[] = [];
  for (let day = 0; day < maxDays; day += 1) {
    const start = jar.startedAt + day * DAY_MS;
    const end = start + DAY_MS;
    let bubbles = 0;
    let volumeMl = 0;
    for (const b of buckets) {
      if (b.jarId !== jar.id) continue;
      // Bucket belongs to the day containing its start.
      if (b.t >= start && b.t < end) {
        bubbles += b.bubbles;
        volumeMl += b.volumeMl;
      }
    }
    const estimate = estimateJarAt(jar, buckets, end);
    days.push({
      day: day + 1,
      t: end,
      bubbles,
      volumeMl,
      bubblesPerHour: bubbles / 24,
      mlPerHour: volumeMl / 24,
      estimatedSg: estimate.sg,
      abv: estimate.abv,
    });
  }
  // Remove empty trailing days.
  let last = days.length - 1;
  while (last > 0 && days[last].bubbles === 0 && days[last].volumeMl === 0) last -= 1;
  return days.slice(0, last + 1);
}

export interface PrimaryEndResult {
  endDay?: number;
  endAt?: number;
  peakDay?: number;
  peakAt?: number;
  peakBubblesPerHour: number;
  reason: string;
}

/**
 * Main fermentation end: after the rate peak, a day is below 10% of peak and
 * gravity movement has nearly plateaued. The next day must also stay quiet.
 */
export function detectPrimaryEnd(
  jar: Jar,
  buckets: GasBucket[],
  readings: HydrometerReading[] = [],
): PrimaryEndResult {
  const days = dailySeries(jar, buckets, jar.status === 'archived' ? 60 : 30);
  if (days.length < 3) {
    return { peakBubblesPerHour: 0, reason: '数据不足 3 天，尚不能判定主发酵结束日。' };
  }

  const activeDays = days.filter((d) => d.bubbles > 0 || d.volumeMl > 0);
  const peak = activeDays.reduce(
    (best, d) => (d.bubblesPerHour > best.bubblesPerHour ? d : best),
    activeDays[0],
  );
  if (!peak || peak.bubblesPerHour <= 0) {
    return { peakBubblesPerHour: 0, reason: '还没有可识别的冒泡数据。' };
  }

  const rateThreshold = Math.max(peak.bubblesPerHour * 0.1, 0.5);
  const sortedReadings = readings
    .filter((r) => r.jarId === jar.id)
    .sort((a, b) => a.t - b.t);

  for (let i = peak.day; i < days.length; i += 1) {
    const current = days[i];
    const next = days[i + 1];
    if (!next) break;
    const quiet =
      current.bubblesPerHour <= rateThreshold && next.bubblesPerHour <= rateThreshold;
    if (!quiet) continue;

    const previous = days[i - 1];
    const gravitySlope = previous
      ? Math.abs(current.estimatedSg - previous.estimatedSg)
      : 1;
    const plateau = gravitySlope <= 0.0025 || current.estimatedSg <= jar.targetFg + 0.003;

    const dayReadings = sortedReadings.filter(
      (r) => r.t >= jar.startedAt + (current.day - 1) * DAY_MS && r.t < current.t + DAY_MS,
    );
    const readingConfirms =
      dayReadings.length === 0 ||
      dayReadings.some((r) => Math.abs(r.sg - jar.targetFg) <= 0.004) ||
      plateau;

    if (plateau && readingConfirms) {
      return {
        endDay: current.day,
        endAt: jar.startedAt + (current.day - 1) * DAY_MS,
        peakDay: peak.day,
        peakAt: jar.startedAt + (peak.day - 1) * DAY_MS + 12 * HOUR_MS,
        peakBubblesPerHour: peak.bubblesPerHour,
        reason: `第 ${current.day} 天冒泡速率已低于峰值 10%，比重连续趋缓。`,
      };
    }
  }

  return {
    peakDay: peak.day,
    peakAt: jar.startedAt + (peak.day - 1) * DAY_MS + 12 * HOUR_MS,
    peakBubblesPerHour: peak.bubblesPerHour,
    reason: '已找到冒泡高峰，但尚未出现持续低位和比重 plateau。',
  };
}

/** Convert raw mic events into persisted interval buckets. */
export function eventsToBucket(
  jarId: string,
  events: BubbleEvent[],
  bucketStart: number,
  minutes = 1,
): GasBucket {
  const inBucket = events.filter(
    (e) =>
      e.accepted &&
      e.matchedJarId === jarId &&
      e.t >= bucketStart &&
      e.t < bucketStart + minutes * MINUTE_MS,
  );
  return {
    jarId,
    t: bucketStart,
    minutes,
    bubbles: inBucket.length,
    volumeMl: inBucket.reduce((sum, e) => sum + (e.volumeMl ?? 0), 0),
  };
}
