export type ID = string;

export type RouteId = 'jars' | 'listen' | 'curves' | 'records';

export type JarStatus = 'active' | 'primary-done' | 'conditioning' | 'archived';

export interface YeastSpeedPoint {
  tempC: number;
  /** Relative fermentation speed; 1.0 is the profile reference temperature. */
  speed: number;
}

export interface YeastProfile {
  id: string;
  name: string;
  vendor: string;
  minC: number;
  maxC: number;
  refTempC: number;
  /** Expected densest-bubbling time at refTempC. */
  peakAtRefHours: number;
  /** Optional Q10 fallback used outside explicit table. */
  q10: number;
  table: YeastSpeedPoint[];
}

export interface BeerStyle {
  id: string;
  name: string;
  color: string;
  defaultOg: number;
  defaultFg: number;
  volumeL: number;
  tempC: number;
  yeastId: string;
  /** Multiplier on yeast peak prediction; <1 faster, >1 slower. */
  peakHourFactor: number;
  expectedPrimaryDays: number;
  attenuation: number;
  processNote: string;
  custom?: boolean;
}

export interface SoundSignature {
  jarId: ID;
  trainedAt: number;
  sampleCount: number;
  centerHz: number;
  centroidHz: number;
  bandwidthHz: number;
  durationMs: number;
  decayMs: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  /** Standard deviations used by the weighted nearest-centroid classifier. */
  spread: {
    logHz: number;
    duration: number;
    centroid: number;
    bandwidth: number;
    band: number;
  };
}

export interface Jar {
  id: ID;
  name: string;
  beerName: string;
  styleId: ID;
  yeastId: ID;
  color: string;
  startedAt: number;
  volumeL: number;
  og: number;
  targetFg: number;
  tempC: number;
  pressureKPa: number;
  /** Mean gas volume represented by one counted bubble. */
  bubbleVolumeMl: number;
  /** Multiplies counted airlock gas to total produced CO2 (dissolution/leak calibration). */
  productionFactor: number;
  status: JarStatus;
  signature: SoundSignature | null;
  notes?: string;
}

export interface BubbleFeatures {
  rms: number;
  peakHz: number;
  centroidHz: number;
  bandwidthHz: number;
  flatness: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  zcr: number;
  durationMs: number;
  attackMs: number;
  decayMs: number;
  tonalConfidence: number;
  minnaertVolumeMl: number;
}

export type RejectReason =
  | 'too_short'
  | 'too_long_sustained'
  | 'low_frequency_hum'
  | 'broadband_noise'
  | 'speech_modulation'
  | 'no_narrow_resonance'
  | 'below_threshold';

export interface BubbleEvent {
  id: ID;
  t: number;
  source: 'mic' | 'demo';
  accepted: boolean;
  rejectReason?: RejectReason;
  confidence: number;
  matchedJarId?: ID | null;
  volumeMl?: number;
  features: BubbleFeatures;
}

export interface GasBucket {
  /** Jar id plus bucket start are the logical key. */
  jarId: ID;
  t: number;
  minutes: number;
  bubbles: number;
  volumeMl: number;
}

export interface HydrometerReading {
  id: ID;
  jarId: ID;
  t: number;
  sg: number;
  tempC?: number;
  note?: string;
}

export interface BrewRecord {
  id: ID;
  date: number;
  name: string;
  styleName: string;
  yeastName: string;
  og: number;
  fg: number;
  abv: number;
  volumeL: number;
  note: string;
  jarId?: ID;
}

export type AlertLevel = 'info' | 'warning' | 'critical';
export type AlertType = 'stuck' | 'temp_high' | 'spike' | 'primary_done' | 'calibration';

export interface AlertItem {
  id: ID;
  jarId?: ID;
  t: number;
  level: AlertLevel;
  type: AlertType;
  message: string;
  acknowledged: boolean;
}

export interface MonitoringSettings {
  sensitivity: number;
  rejectNoise: boolean;
  autoAssignOnlyTrained: boolean;
  demoRatePerMinute: number;
  wakeLock: boolean;
}

export interface AppState {
  version: 1;
  seeded: boolean;
  jars: Jar[];
  styles: BeerStyle[];
  readings: HydrometerReading[];
  buckets: GasBucket[];
  records: BrewRecord[];
  alerts: AlertItem[];
  settings: MonitoringSettings;
}

export interface GravityEstimate {
  sg: number;
  plato: number;
  abv: number;
  co2MassG: number;
  ethanolMassG: number;
  sugarMassG: number;
  gasVolumeL: number;
  calibrated: boolean;
}

export interface ReadingComparison {
  reading: HydrometerReading;
  estimatedSg: number;
  residual: number;
  absResidual: number;
}

export interface AccuracyReport {
  comparisons: ReadingComparison[];
  maxAbs: number;
  rmse: number;
  bias: number;
  withinTolerance: boolean;
  tolerance: number;
}

export interface PeakPrediction {
  tempC: number;
  peakHours: number;
  peakDate?: Date;
  speed: number;
}
