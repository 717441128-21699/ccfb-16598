export function formatSg(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

export function formatAbv(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatDateTime(t?: number | Date): string {
  if (!t) return '—';
  const d = t instanceof Date ? t : new Date(t);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(t?: number | Date): string {
  if (!t) return '—';
  const d = t instanceof Date ? t : new Date(t);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatHourClock(t?: number): string {
  if (!t) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(t);
}

export function formatRelative(t?: number, now = Date.now()): string {
  if (!t) return '从未';
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 60) return `${diffSec} 秒前`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function dayLabel(startedAt: number, t: number): string {
  const day = Math.floor((t - startedAt) / 86_400_000) + 1;
  return day > 0 ? `第 ${day} 天` : '未开始';
}

export function toDatetimeLocalValue(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Date.now();
}
