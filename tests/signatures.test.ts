import { describe, expect, it } from 'vitest';
import type { BubbleFeatures, Jar } from '../src/types';
import { classifyBubble, trainSignature } from '../src/audio/signatures';
import { makeSignatureTemplate } from '../src/domain/demo';

function features(partial: Partial<BubbleFeatures>): BubbleFeatures {
  return {
    rms: 0.1,
    peakHz: 600,
    centroidHz: 670,
    bandwidthHz: 190,
    flatness: 0.14,
    lowRatio: 0.25,
    midRatio: 0.57,
    highRatio: 0.18,
    zcr: 0.1,
    durationMs: 120,
    attackMs: 14,
    decayMs: 85,
    tonalConfidence: 0.7,
    minnaertVolumeMl: 0.6,
    ...partial,
  };
}

describe('multi-fermenter acoustic separation', () => {
  const jars = [
    { id: 'low', signature: makeSignatureTemplate('low', 360, 190) },
    { id: 'mid', signature: makeSignatureTemplate('mid', 560, 128) },
    { id: 'high', signature: makeSignatureTemplate('high', 910, 72) },
  ] as Jar[];

  it('classifies each airlock by its acoustic signature', () => {
    const low = classifyBubble(features({
      peakHz: 370, centroidHz: 410, bandwidthHz: 130, durationMs: 185,
      lowRatio: 0.5, midRatio: 0.42, highRatio: 0.08,
    }), jars);
    const mid = classifyBubble(features({ peakHz: 548, centroidHz: 620, durationMs: 132 }), jars);
    const high = classifyBubble(features({
      peakHz: 930, centroidHz: 1010, bandwidthHz: 300, durationMs: 76,
      lowRatio: 0.15, midRatio: 0.56, highRatio: 0.29,
    }), jars);

    expect(low.jarId).toBe('low');
    expect(mid.jarId).toBe('mid');
    expect(high.jarId).toBe('high');
    expect(mid.confidence).toBeGreaterThan(0.5);
  });

  it('rejects a sound far from every trained airlock instead of forcing assignment', () => {
    const weird = classifyBubble(features({
      peakHz: 2400,
      centroidHz: 3100,
      bandwidthHz: 1400,
      durationMs: 420,
      lowRatio: 0.04,
      midRatio: 0.2,
      highRatio: 0.76,
      flatness: 0.7,
    }), jars);
    expect(weird.jarId).toBeNull();
  });

  it('trains a signature from at least three labelled bubbles', () => {
    const samples = [500, 520, 510, 495, 505].map((peakHz, i) =>
      features({ peakHz, centroidHz: peakHz * 1.1, durationMs: 118 + i * 3 }),
    );
    const sig = trainSignature('x', samples, 123);
    expect(sig).not.toBeNull();
    expect(sig?.jarId).toBe('x');
    expect(sig?.centerHz).toBeCloseTo(505, 0);
    expect(sig?.sampleCount).toBe(5);
    expect(trainSignature('x', samples.slice(0, 2))).toBeNull();
  });
});
