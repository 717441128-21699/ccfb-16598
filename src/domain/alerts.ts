import type { AlertItem, AlertType, GasBucket, Jar } from '../types';
import { HOUR_MS, MINUTE_MS, estimateJarAt, jarRateSeries } from './fermentation';

export interface AlertDraft {
  jarId?: string;
  level: AlertItem['level'];
  type: AlertType;
  message: string;
}

const DAY_MS = 86_400_000;

export function checkTemperatureWithLimit(
  jar: Jar,
  maxC: number,
  warningMarginC = 1,
): AlertDraft | null {
  if (jar.tempC >= maxC + 2) {
    return {
      jarId: jar.id,
      level: 'critical',
      type: 'temp_high',
      message: `${jar.name} 温度 ${jar.tempC.toFixed(1)} °C，已超过酵母上限 ${maxC} °C 2 °C 以上，冒泡可能异常加快并产生杂醇。`,
    };
  }
  if (jar.tempC > maxC) {
    return {
      jarId: jar.id,
      level: 'warning',
      type: 'temp_high',
      message: `${jar.name} 温度 ${jar.tempC.toFixed(1)} °C，高于酵母建议上限 ${maxC} °C。`,
    };
  }
  if (jar.tempC >= maxC - warningMarginC) {
    return {
      jarId: jar.id,
      level: 'info',
      type: 'temp_high',
      message: `${jar.name} 温度 ${jar.tempC.toFixed(1)} °C，接近建议上限 ${maxC} °C。`,
    };
  }
  return null;
}

function sumWindow(buckets: GasBucket[], jarId: string, from: number, to: number) {
  let bubbles = 0;
  let volumeMl = 0;
  for (const b of buckets) {
    if (b.jarId !== jarId) continue;
    const end = b.t + b.minutes * MINUTE_MS;
    if (end <= from || b.t >= to) continue;
    bubbles += b.bubbles;
    volumeMl += b.volumeMl;
  }
  return { bubbles, volumeMl };
}

/** Spike in the latest 15 minutes versus the previous two hours. */
export function checkSuddenSpike(
  jar: Jar,
  buckets: GasBucket[],
  now: number,
): AlertDraft | null {
  const recent = sumWindow(buckets, jar.id, now - 15 * MINUTE_MS, now);
  const baselineWindow = sumWindow(buckets, jar.id, now - 135 * MINUTE_MS, now - 15 * MINUTE_MS);
  const recentPerHour = recent.bubbles * 4;
  const baselinePerHour = baselineWindow.bubbles / 2;

  if (recent.bubbles < 12) return null;
  // A measurable baseline gets the ratio-based critical alert first.
  if (baselinePerHour >= 0.5 && recentPerHour >= baselinePerHour * 2.5 && recentPerHour >= 30) {
    return {
      jarId: jar.id,
      level: 'critical',
      type: 'spike',
      message: `${jar.name} 冒泡速率在 15 分钟内升到基线的 ${(recentPerHour / baselinePerHour).toFixed(1)} 倍，可能温度过高或发酵剧烈，注意溢罐。`,
    };
  }
  if (baselinePerHour < 3 && recentPerHour >= 80) {
    return {
      jarId: jar.id,
      level: 'warning',
      type: 'spike',
      message: `${jar.name} 最近 15 分钟 ${recent.bubbles} 声（约 ${Math.round(recentPerHour)}/小时），突然进入旺盛冒泡，请检查温度和气塞。`,
    };
  }

  return null;
}

/** No airlock activity for 6 h while gravity is still well above target. */
export function checkStuck(
  jar: Jar,
  buckets: GasBucket[],
  now: number,
): AlertDraft | null {
  if (jar.status === 'archived' || jar.status === 'conditioning') return null;
  const age = now - jar.startedAt;
  if (age < DAY_MS) return null;

  const series = jarRateSeries(buckets, jar.id);
  const latest = series.reduce((max, p) => Math.max(max, p.t + p.minutes * MINUTE_MS), 0);
  const quietFor = now - latest;
  if (latest > 0 && quietFor < 6 * HOUR_MS) return null;

  // If never heard anything but batch started over 18 h ago, also warn.
  if (latest === 0 && age < 18 * HOUR_MS) return null;

  const estimate = estimateJarAt(jar, buckets, now);
  const farFromTarget = estimate.sg > jar.targetFg + 0.004;
  const expectedActiveWindow = age < 14 * DAY_MS;
  if (!farFromTarget || !expectedActiveWindow) return null;

  const hours = latest === 0 ? Math.floor(age / HOUR_MS) : Math.floor(quietFor / HOUR_MS);
  return {
    jarId: jar.id,
    level: hours >= 12 ? 'critical' : 'warning',
    type: 'stuck',
    message:
      latest === 0
        ? `${jar.name} 启动后尚未识别到冒泡；请检查麦克风位置、气塞和是否已起发。`
        : `${jar.name} 已约 ${hours} 小时没有冒泡，推算 SG=${estimate.sg.toFixed(3)} 仍高于目标 ${jar.targetFg.toFixed(3)}，有发酵停滞或漏气风险。`,
  };
}

export function sameActiveAlert(alerts: AlertItem[], draft: AlertDraft, withinMs = 4 * HOUR_MS) {
  const now = Date.now();
  return alerts.some(
    (a) =>
      !a.acknowledged &&
      a.type === draft.type &&
      a.jarId === draft.jarId &&
      now - a.t < withinMs,
  );
}
