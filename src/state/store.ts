import type { AppState, GasBucket, ID } from '../types';
import { BEER_STYLES } from '../domain/yeast';
import { DAY_MS } from '../domain/fermentation';
import { generateReferenceBatch } from '../domain/demo';

const STORAGE_KEY = 'airlock-brew-studio-v1';

export function uid(prefix = 'id'): ID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function seedState(): AppState {
  const now = Date.now();
  const ipa = generateReferenceBatch({
    id: 'jar-ipa',
    name: '1 号气塞罐',
    beerName: '周末美式 IPA',
    style: BEER_STYLES[0],
    yeastId: 'us05-like',
    startedAt: now - 8 * DAY_MS,
    days: 8,
    peakHour: 52,
    seed: 20261125,
    signatureHz: 560,
    durationMs: 128,
    status: 'primary-done',
  });

  const hefe = generateReferenceBatch({
    id: 'jar-hefe',
    name: '2 号小麦罐',
    beerName: '云雾小麦',
    style: BEER_STYLES[2],
    yeastId: 'hefe-like',
    startedAt: now - 4 * DAY_MS,
    days: 4,
    peakHour: 34,
    seed: 7717,
    signatureHz: 910,
    durationMs: 72,
    status: 'active',
  });

  const stout = generateReferenceBatch({
    id: 'jar-stout',
    name: '3 号世涛罐',
    beerName: '烘烤燕麦世涛',
    style: BEER_STYLES[1],
    yeastId: 's04-like',
    startedAt: now - 18 * DAY_MS,
    days: 16,
    peakHour: 62,
    seed: 991,
    signatureHz: 360,
    durationMs: 190,
    status: 'conditioning',
  });

  return {
    version: 1,
    seeded: true,
    jars: [ipa.jar, hefe.jar, stout.jar],
    styles: BEER_STYLES.map((s) => ({ ...s })),
    readings: [...ipa.readings, ...hefe.readings, ...stout.readings],
    buckets: [...ipa.buckets, ...hefe.buckets, ...stout.buckets],
    records: [
      {
        id: 'record-stout-2026',
        date: now - 4 * DAY_MS,
        name: '烘烤燕麦世涛',
        styleName: '世涛 / 波特',
        yeastName: '英式艾尔酵母（S-04 型走势）',
        og: 1.052,
        fg: 1.014,
        abv: 5.0,
        volumeL: 19,
        note: '声纹低沉，360 Hz；主发酵第 8 天结束。瓶装二发加入 6 g/L 葡萄糖。',
        jarId: 'jar-stout',
      },
    ],
    alerts: [],
    settings: {
      sensitivity: 0.62,
      rejectNoise: true,
      autoAssignOnlyTrained: false,
      demoRatePerMinute: 24,
      wakeLock: true,
    },
  };
}

function defaultState(): AppState {
  return {
    version: 1,
    seeded: false,
    jars: [],
    styles: BEER_STYLES.map((s) => ({ ...s })),
    readings: [],
    buckets: [],
    records: [],
    alerts: [],
    settings: {
      sensitivity: 0.62,
      rejectNoise: true,
      autoAssignOnlyTrained: false,
      demoRatePerMinute: 24,
      wakeLock: true,
    },
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seedState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      styles: parsed.styles?.length ? parsed.styles : base.styles,
    } as AppState;
  } catch {
    return seedState();
  }
}

type Listener = () => void;

class Store {
  state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = loadState();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('无法写入 localStorage', error);
    }
  }

  update(mutator: (state: AppState) => void, options: { silent?: boolean } = {}) {
    mutator(this.state);
    if (!options.silent) this.emit();
    this.save();
  }

  resetDemo() {
    this.state = seedState();
    this.save();
    this.emit();
  }

  clearAll() {
    this.state = defaultState();
    this.save();
    this.emit();
  }

  upsertBucket(bucket: GasBucket) {
    this.update((s) => {
      const idx = s.buckets.findIndex(
        (b) => b.jarId === bucket.jarId && b.t === bucket.t,
      );
      if (idx >= 0) s.buckets[idx] = bucket;
      else s.buckets.push(bucket);
      // Keep at most ~14 days of one-minute buckets plus historical coarser data.
      if (s.buckets.length > 12000) {
        s.buckets.splice(0, s.buckets.length - 12000);
      }
    });
  }
}

export const store = new Store();
