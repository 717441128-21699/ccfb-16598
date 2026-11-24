import type { BubbleFeatures, ID, Jar, SoundSignature } from '../types';
import { clamp, median } from '../domain/fermentation';

/**
 * Minnaert resonance approximation.
 * f(Hz) * r(m) ≈ 3.26, therefore r(mm) ≈ 3260 / f.
 * Returns bubble volume in mL (= cm³). Airlock geometry makes this a prior,
 * not an absolute measurement; each jar has a calibration multiplier.
 */
export function minnaertRadiusMm(peakHz: number): number {
  if (!Number.isFinite(peakHz) || peakHz <= 0) return 0;
  return 3260 / peakHz;
}

export function minnaertVolumeMlFromHz(peakHz: number): number {
  const radiusCm = minnaertRadiusMm(peakHz) / 10;
  if (radiusCm <= 0) return 0;
  return (4 / 3) * Math.PI * radiusCm ** 3;
}

function std(values: number[], fallback: number): number {
  if (values.length < 2) return fallback;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Train a nearest-centroid acoustic signature from labelled bubbles. */
export function trainSignature(
  jarId: string,
  samples: BubbleFeatures[],
  trainedAt = Date.now(),
): SoundSignature | null {
  if (samples.length < 3) return null;
  const centerHz = median(samples.map((f) => f.peakHz));
  const centroidHz = median(samples.map((f) => f.centroidHz));
  const bandwidthHz = median(samples.map((f) => f.bandwidthHz));
  const durationMs = median(samples.map((f) => f.durationMs));
  const decayMs = median(samples.map((f) => f.decayMs));
  const lowRatio = median(samples.map((f) => f.lowRatio));
  const midRatio = median(samples.map((f) => f.midRatio));
  const highRatio = median(samples.map((f) => f.highRatio));

  return {
    jarId,
    trainedAt,
    sampleCount: samples.length,
    centerHz,
    centroidHz,
    bandwidthHz,
    durationMs,
    decayMs,
    lowRatio,
    midRatio,
    highRatio,
    spread: {
      logHz: clamp(std(samples.map((f) => Math.log(f.peakHz)), 0.08), 0.025, 0.35),
      duration: clamp(std(samples.map((f) => f.durationMs), 18), 8, 90),
      centroid: clamp(std(samples.map((f) => f.centroidHz), 120), 40, 500),
      bandwidth: clamp(std(samples.map((f) => f.bandwidthHz), 100), 40, 500),
      band: 0.09,
    },
  };
}

export function signatureDistance(sig: SoundSignature, f: BubbleFeatures): number {
  const zHz =
    (Math.log(Math.max(40, f.peakHz)) - Math.log(Math.max(40, sig.centerHz))) /
    Math.max(0.045, sig.spread.logHz);
  const zDuration =
    (f.durationMs - sig.durationMs) / Math.max(12, sig.spread.duration);
  const zCentroid =
    (f.centroidHz - sig.centroidHz) / Math.max(60, sig.spread.centroid);
  const zBandwidth =
    (f.bandwidthHz - sig.bandwidthHz) / Math.max(60, sig.spread.bandwidth);
  const bandError =
    Math.abs(f.lowRatio - sig.lowRatio) +
    Math.abs(f.midRatio - sig.midRatio) +
    Math.abs(f.highRatio - sig.highRatio);
  const zBand = bandError / Math.max(0.08, sig.spread.band);

  // Root mean square standardized mismatch.
  return Math.sqrt(
    (zHz * zHz +
      0.7 * zDuration * zDuration +
      0.45 * zCentroid * zCentroid +
      0.3 * zBandwidth * zBandwidth +
      0.55 * zBand * zBand) /
      3.0,
  );
}

export interface ClassificationResult {
  jarId: ID | null;
  confidence: number;
  distances: Array<{ jarId: ID; distance: number; confidence: number }>;
}

/**
 * Assign a detected bubble to the nearest trained airlock.
 * Distances beyond the rejection radius stay unassigned rather than forcing a jar.
 */
export function classifyBubble(
  features: BubbleFeatures,
  jars: Jar[],
  rejectionRadius = 2.35,
): ClassificationResult {
  const trained = jars
    .filter((j) => j.signature)
    .map((j) => ({ jarId: j.id, distance: signatureDistance(j.signature!, features) }));

  if (trained.length === 0) {
    return { jarId: null, confidence: 0, distances: [] };
  }

  const withConfidence = trained.map((d) => ({
    ...d,
    confidence: Math.exp(-(d.distance * d.distance) / 2.2),
  }));
  withConfidence.sort((a, b) => a.distance - b.distance);

  const best = withConfidence[0];
  const second = withConfidence[1];
  const margin = second ? clamp((second.distance - best.distance) / 2, 0, 0.35) : 0.15;
  const confidence = clamp(best.confidence * (0.75 + margin), 0, 0.99);

  if (best.distance > rejectionRadius) {
    return { jarId: null, confidence, distances: withConfidence };
  }
  return { jarId: best.jarId, confidence, distances: withConfidence };
}

/**
 * Individual volume estimate. Minnaert gives relative per-bubble size; the
 * jar's user-calibrated mean bubbleVolumeMl anchors the absolute scale.
 */
export function estimateEventVolumeMl(jar: Jar, features: BubbleFeatures): number {
  const raw = features.minnaertVolumeMl || minnaertVolumeMlFromHz(features.peakHz);
  const referenceHz = jar.signature?.centerHz ?? features.peakHz;
  const referenceRaw = minnaertVolumeMlFromHz(referenceHz) || raw || 0.3;
  const relative = clamp(raw / referenceRaw, 0.25, 4);
  return jar.bubbleVolumeMl * Math.sqrt(relative);
}
