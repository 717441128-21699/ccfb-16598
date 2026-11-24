import type {
  BubbleEvent,
  BubbleFeatures,
  GasBucket,
  ID,
  RejectReason,
} from '../types';
import { store, uid } from '../state/store';
import { AudioMonitor, type AudioMonitorState, type BubbleWorkletMessage } from './AudioMonitor';
import { DemoMonitor } from './DemoMonitor';
import { classifyBubble, estimateEventVolumeMl, trainSignature } from './signatures';
import { MINUTE_MS } from '../domain/fermentation';
import { checkStuck, checkSuddenSpike, checkTemperatureWithLimit, sameActiveAlert, type AlertDraft } from '../domain/alerts';
import { getYeast } from '../domain/yeast';

export interface MeterState {
  rms: number;
  noiseRms: number;
  active: boolean;
  peakHz: number;
  t: number;
}

export interface JarSessionStat {
  bubbles: number;
  volumeMl: number;
  lastT: number;
  avgConfidence: number;
}

class ListeningSession extends EventTarget {
  micState: AudioMonitorState = 'idle';
  demoRunning = false;
  meter: MeterState = { rms: 0, noiseRms: 0.008, active: false, peakHz: 0, t: 0 };
  events: BubbleEvent[] = [];
  acceptedCount = 0;
  rejectCounts: Partial<Record<RejectReason, number>> = {};
  jarStats: Record<ID, JarSessionStat> = {};
  trainingJarId: ID | null = null;
  trainingFeatures: BubbleFeatures[] = [];
  trainingTarget = 10;

  private monitor: AudioMonitor;
  private demo: DemoMonitor;
  private draftBuckets = new Map<string, GasBucket>();
  private flushTimer: number | null = null;
  private alertTimer: number | null = null;

  constructor() {
    super();
    this.monitor = new AudioMonitor({
      onMessage: (msg) => this.handleMessage(msg, 'mic'),
      onStateChange: (state) => {
        this.micState = state;
        this.dispatchChange();
      },
    });
    this.demo = new DemoMonitor(
      () => store.state.jars,
      (msg) => this.handleMessage(msg, 'demo'),
    );
  }

  subscribe(listener: () => void): () => void {
    this.addEventListener('change', listener);
    return () => this.removeEventListener('change', listener);
  }

  onMeter(listener: () => void): () => void {
    this.addEventListener('meter', listener);
    return () => this.removeEventListener('meter', listener);
  }

  private dispatchChange() {
    this.dispatchEvent(new Event('change'));
  }

  private dispatchMeter() {
    this.dispatchEvent(new Event('meter'));
  }

  async startMic() {
    const { sensitivity, rejectNoise } = store.state.settings;
    await this.monitor.start(sensitivity, rejectNoise);
    this.startTimers();
    this.dispatchChange();
  }

  stopMic() {
    this.monitor.stop();
    this.stopTimersIfIdle();
    this.flushBuckets();
    this.dispatchChange();
  }

  startDemo() {
    this.demo.start(store.state.settings.demoRatePerMinute);
    this.demoRunning = true;
    this.startTimers();
    this.dispatchChange();
  }

  stopDemo() {
    this.demo.stop();
    this.demoRunning = false;
    this.stopTimersIfIdle();
    this.flushBuckets();
    this.dispatchChange();
  }

  updateAudioSettings() {
    this.monitor.updateSettings(store.state.settings.sensitivity, store.state.settings.rejectNoise);
  }

  private startTimers() {
    if (this.flushTimer === null) {
      this.flushTimer = window.setInterval(() => this.flushBuckets(), 4000);
    }
    if (this.alertTimer === null) {
      this.alertTimer = window.setInterval(() => this.evaluateAlerts(), 20_000);
    }
  }

  private stopTimersIfIdle() {
    if (this.micState !== 'running' && !this.demoRunning) {
      if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
      if (this.alertTimer !== null) window.clearInterval(this.alertTimer);
      this.flushTimer = null;
      this.alertTimer = null;
    }
  }

  startTraining(jarId: ID) {
    this.trainingJarId = jarId;
    this.trainingFeatures = [];
    this.dispatchEvent(new Event('training'));
    this.dispatchChange();
  }

  cancelTraining() {
    this.trainingJarId = null;
    this.trainingFeatures = [];
    this.dispatchEvent(new Event('training'));
    this.dispatchChange();
  }

  private finishTraining() {
    if (!this.trainingJarId || this.trainingFeatures.length < 3) return;
    const signature = trainSignature(this.trainingJarId, this.trainingFeatures);
    if (signature) {
      store.update((s) => {
        const jar = s.jars.find((j) => j.id === this.trainingJarId);
        if (jar) jar.signature = signature;
      });
    }
    this.trainingJarId = null;
    this.trainingFeatures = [];
    this.dispatchEvent(new Event('training'));
    this.dispatchChange();
  }

  clearLog() {
    this.events = [];
    this.acceptedCount = 0;
    this.rejectCounts = {};
    this.jarStats = {};
    this.dispatchChange();
  }

  private handleMessage(msg: BubbleWorkletMessage, source: 'mic' | 'demo') {
    if (msg.type === 'meter' && msg.rms !== undefined) {
      this.meter = {
        rms: msg.rms,
        noiseRms: msg.noiseRms ?? this.meter.noiseRms,
        active: msg.active ?? false,
        peakHz: msg.peakHz ?? 0,
        t: Date.now(),
      };
      this.dispatchMeter();
      return;
    }

    if (!msg.features) return;
    const now = Date.now();
    const features = msg.features as BubbleFeatures;

    if (msg.type === 'reject') {
      const reason = msg.reason ?? 'no_narrow_resonance';
      this.rejectCounts[reason] = (this.rejectCounts[reason] ?? 0) + 1;
      this.prependEvent({
        id: uid('ev'),
        t: now,
        source,
        accepted: false,
        rejectReason: reason,
        confidence: 0,
        features,
      });
      this.dispatchChange();
      return;
    }

    // Training captures every accepted resonant bubble.
    if (this.trainingJarId) {
      this.trainingFeatures.push(features);
      if (this.trainingFeatures.length >= this.trainingTarget) this.finishTraining();
      this.dispatchEvent(new Event('training'));
    }

    const classification = classifyBubble(features, store.state.jars);
    let matchedJarId = classification.jarId;

    // Single-fermenter fallback when no signature has been trained yet.
    if (!matchedJarId && store.state.jars.length === 1) {
      matchedJarId = store.state.jars[0].id;
    }

    const jar = matchedJarId ? store.state.jars.find((j) => j.id === matchedJarId) : undefined;
    const volumeMl = jar ? estimateEventVolumeMl(jar, features) : features.minnaertVolumeMl * 0.6;

    const event: BubbleEvent = {
      id: uid('ev'),
      t: now,
      source,
      accepted: true,
      confidence: classification.confidence,
      matchedJarId,
      volumeMl,
      features,
    };
    this.prependEvent(event);
    this.acceptedCount += 1;

    if (jar && matchedJarId) {
      const stat = this.jarStats[matchedJarId] ?? {
        bubbles: 0,
        volumeMl: 0,
        lastT: 0,
        avgConfidence: 0,
      };
      stat.bubbles += 1;
      stat.volumeMl += volumeMl ?? 0;
      stat.lastT = now;
      stat.avgConfidence =
        (stat.avgConfidence * (stat.bubbles - 1) + classification.confidence) / stat.bubbles;
      this.jarStats[matchedJarId] = stat;
      this.addToBucket(matchedJarId, now, volumeMl ?? 0);
    }

    this.dispatchChange();
  }

  private prependEvent(event: BubbleEvent) {
    this.events.unshift(event);
    if (this.events.length > 80) this.events.length = 80;
  }

  private addToBucket(jarId: ID, t: number, volumeMl: number) {
    const start = Math.floor(t / MINUTE_MS) * MINUTE_MS;
    const key = `${jarId}:${start}`;
    let bucket = this.draftBuckets.get(key);
    if (!bucket) {
      const existing = store.state.buckets.find((b) => b.jarId === jarId && b.t === start);
      bucket = existing
        ? structuredClone(existing)
        : { jarId, t: start, minutes: 1, bubbles: 0, volumeMl: 0 };
      this.draftBuckets.set(key, bucket);
    }
    bucket.bubbles += 1;
    bucket.volumeMl += volumeMl;
  }

  flushBuckets() {
    for (const bucket of this.draftBuckets.values()) {
      store.upsertBucket({ ...bucket });
    }
    const cutoff = Date.now() - 5 * MINUTE_MS;
    for (const [key, bucket] of this.draftBuckets) {
      if (bucket.t + bucket.minutes * MINUTE_MS < cutoff) this.draftBuckets.delete(key);
    }
  }

  private evaluateAlerts() {
    const now = Date.now();
    const drafts: AlertDraft[] = [];
    for (const jar of store.state.jars) {
      const yeast = getYeast(jar.yeastId);
      const temp = checkTemperatureWithLimit(jar, yeast.maxC);
      if (temp) drafts.push(temp);
      const spike = checkSuddenSpike(jar, store.state.buckets, now);
      if (spike) drafts.push(spike);
      const stuck = checkStuck(jar, store.state.buckets, now);
      if (stuck) drafts.push(stuck);
    }
    for (const draft of drafts) {
      if (sameActiveAlert(store.state.alerts, draft)) continue;
      store.update((s) => {
        s.alerts.unshift({
          id: uid('alert'),
          t: now,
          acknowledged: false,
          ...draft,
        });
        if (s.alerts.length > 100) s.alerts.length = 100;
      });
    }
  }
}

export const listeningSession = new ListeningSession();
