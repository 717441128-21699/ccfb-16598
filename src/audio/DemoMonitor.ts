import type { Jar, RejectReason } from '../types';
import type { BubbleWorkletMessage } from './AudioMonitor';
import { minnaertVolumeMlFromHz } from './signatures';

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function jittered(sigValue: number, spread: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, sigValue + gaussian() * spread));
}

function bubbleForJar(jar: Jar): BubbleWorkletMessage {
  const sig = jar.signature;
  const peakHz = sig
    ? Math.exp(Math.log(sig.centerHz) + gaussian() * Math.max(0.04, sig.spread.logHz * 0.7))
    : jittered(620, 120, 240, 1800);
  const durationMs = sig
    ? jittered(sig.durationMs, sig.spread.duration * 0.65, 45, 360)
    : jittered(120, 35, 50, 300);
  const lowRatio = sig ? Math.min(0.75, Math.max(0.05, sig.lowRatio + gaussian() * 0.035)) : 0.25;
  const highRatio = sig ? Math.min(0.5, Math.max(0.03, sig.highRatio + gaussian() * 0.035)) : 0.18;
  const midRatio = Math.max(0.25, 1 - lowRatio - highRatio);
  const centroidHz = sig
    ? jittered(sig.centroidHz, sig.spread.centroid * 0.7, 180, 3200)
    : peakHz * 1.1;

  return {
    type: 'bubble',
    t: performance.now() / 1000,
    features: {
      rms: 0.05 + Math.random() * 0.12,
      peakHz,
      centroidHz,
      bandwidthHz: sig ? jittered(sig.bandwidthHz, 45, 60, 900) : peakHz * 0.3,
      flatness: 0.08 + Math.random() * 0.12,
      lowRatio,
      midRatio,
      highRatio,
      zcr: 0.08 + Math.random() * 0.08,
      durationMs,
      attackMs: 8 + Math.random() * 18,
      decayMs: durationMs * (0.55 + Math.random() * 0.25),
      tonalConfidence: 0.55 + Math.random() * 0.35,
      minnaertVolumeMl: minnaertVolumeMlFromHz(peakHz),
    },
  };
}

function noiseEvent(): BubbleWorkletMessage {
  const kind = Math.random();
  let reason: RejectReason;
  let peakHz: number;
  let durationMs: number;
  let lowRatio: number;
  let midRatio: number;
  let highRatio: number;
  let flatness: number;
  let tonalConfidence: number;

  if (kind < 0.3) {
    reason = 'low_frequency_hum';
    peakHz = 90 + Math.random() * 110;
    durationMs = 500 + Math.random() * 900;
    lowRatio = 0.72;
    midRatio = 0.2;
    highRatio = 0.08;
    flatness = 0.22;
    tonalConfidence = 0.35;
  } else if (kind < 0.62) {
    reason = 'broadband_noise'; // dog / impact / compressor burst
    peakHz = 500 + Math.random() * 1400;
    durationMs = 90 + Math.random() * 180;
    lowRatio = 0.28;
    midRatio = 0.34;
    highRatio = 0.38;
    flatness = 0.58;
    tonalConfidence = 0.08;
  } else {
    reason = 'speech_modulation';
    peakHz = 300 + Math.random() * 700;
    durationMs = 320 + Math.random() * 500;
    lowRatio = 0.38;
    midRatio = 0.46;
    highRatio = 0.16;
    flatness = 0.34;
    tonalConfidence = 0.2;
  }

  return {
    type: 'reject',
    reason,
    features: {
      rms: 0.04 + Math.random() * 0.08,
      peakHz,
      centroidHz: peakHz * 1.4,
      bandwidthHz: 500 + Math.random() * 900,
      flatness,
      lowRatio,
      midRatio,
      highRatio,
      zcr: 0.1 + Math.random() * 0.2,
      durationMs,
      attackMs: 20,
      decayMs: durationMs * 0.7,
      tonalConfidence,
      minnaertVolumeMl: minnaertVolumeMlFromHz(peakHz),
    },
  };
}

export class DemoMonitor {
  private timer: number | null = null;
  running = false;

  constructor(
    private getJars: () => Jar[],
    private onMessage: (message: BubbleWorkletMessage) => void,
  ) {}

  start(ratePerMinute: number) {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      const jars = this.getJars().filter((j) => j.signature);
      const roll = Math.random();
      if (jars.length > 0 && roll < 0.78) {
        const jar = jars[Math.floor(Math.random() * jars.length)];
        this.onMessage(bubbleForJar(jar));
      } else {
        this.onMessage(noiseEvent());
      }
      const baseDelay = 60000 / Math.max(4, ratePerMinute);
      const delay = baseDelay * (0.45 + Math.random() * 1.2);
      this.timer = window.setTimeout(tick, delay);
    };
    this.timer = window.setTimeout(tick, 350);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
