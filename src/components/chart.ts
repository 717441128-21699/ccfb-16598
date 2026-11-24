import { DAY_MS } from '../domain/fermentation';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ChartPoint {
  t: number;
  y: number | null;
  label?: string;
}

export interface ChartSeries {
  name: string;
  color: string;
  points: ChartPoint[];
  axis?: 'left' | 'right';
  type?: 'line' | 'dots' | 'bars' | 'area';
  width?: number;
  dashed?: boolean;
}

export interface ChartMarker {
  t: number;
  label: string;
  color?: string;
}

export interface TimeChartOptions {
  start: number;
  end: number;
  height?: number;
  leftDomain?: [number, number];
  rightDomain?: [number, number];
  leftLabel?: string;
  rightLabel?: string;
  xTickDayInterval?: number;
  markers?: ChartMarker[];
  series: ChartSeries[];
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(key, value === true ? '' : String(value));
  }
  return el;
}

function niceDomain(min: number, max: number, pad = 0.08): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min - 1, max + 1];
  }
  const span = max - min;
  return [min - span * pad, max + span * pad];
}

function ticks(domain: [number, number], count = 5): number[] {
  const [min, max] = domain;
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

function shortDay(t: number, start: number): string {
  const day = Math.floor((t - start) / DAY_MS) + 1;
  return `D${Math.max(1, day)}`;
}

export function renderTimeChart(options: TimeChartOptions): SVGSVGElement {
  const width = 760;
  const height = options.height ?? 340;
  const margin = { top: 22, right: 54, bottom: 42, left: 58 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const allLeft = options.series
    .filter((s) => (s.axis ?? 'left') === 'left')
    .flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y !== null));
  const allRight = options.series
    .filter((s) => s.axis === 'right')
    .flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y !== null && Number.isFinite(y)));

  const leftDomain = options.leftDomain ?? niceDomain(Math.min(...allLeft, 0), Math.max(...allLeft, 1));
  const rightDomain = options.rightDomain ?? niceDomain(0, Math.max(1, ...allRight));

  const x = (t: number) => margin.left + ((t - options.start) / Math.max(1, options.end - options.start)) * plotW;
  const yLeft = (v: number) => margin.top + plotH - ((v - leftDomain[0]) / (leftDomain[1] - leftDomain[0])) * plotH;
  const yRight = (v: number) => margin.top + plotH - ((v - rightDomain[0]) / (rightDomain[1] - rightDomain[0])) * plotH;
  const yFor = (s: ChartSeries) => (s.axis === 'right' ? yRight : yLeft);

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'time-chart',
    role: 'img',
    'aria-label': '发酵时间序列图',
    preserveAspectRatio: 'xMidYMid meet',
  });

  // Plot background.
  root.append(svg('rect', {
    x: margin.left,
    y: margin.top,
    width: plotW,
    height: plotH,
    rx: 12,
    class: 'chart-plot-bg',
  }));

  // Horizontal grid and left labels.
  ticks(leftDomain, 5).forEach((tick) => {
    const yy = yLeft(tick);
    root.append(svg('line', { x1: margin.left, x2: margin.left + plotW, y1: yy, y2: yy, class: 'chart-grid' }));
    const label = svg('text', { x: margin.left - 9, y: yy + 4, 'text-anchor': 'end', class: 'chart-axis-text' });
    label.textContent = tick.toFixed(tick < 1.1 ? 3 : 1);
    root.append(label);
  });

  if (allRight.length > 0) {
    ticks(rightDomain, 4).forEach((tick) => {
      const yy = yRight(tick);
      const label = svg('text', { x: margin.left + plotW + 9, y: yy + 4, 'text-anchor': 'start', class: 'chart-axis-text chart-axis-right' });
      label.textContent = tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick.toFixed(0);
      root.append(label);
    });
    const rightTitle = svg('text', {
      x: width - 8,
      y: 14,
      'text-anchor': 'end',
      class: 'chart-axis-title chart-axis-right',
    });
    rightTitle.textContent = options.rightLabel ?? '';
    root.append(rightTitle);
  }

  const leftTitle = svg('text', { x: 10, y: 14, class: 'chart-axis-title' });
  leftTitle.textContent = options.leftLabel ?? '';
  root.append(leftTitle);

  // X ticks approximately every day or requested interval.
  const spanDays = (options.end - options.start) / DAY_MS;
  const intervalDays = options.xTickDayInterval ?? (spanDays > 10 ? 2 : 1);
  const firstTick = Math.ceil(options.start / DAY_MS) * DAY_MS;
  for (let t = firstTick; t <= options.end; t += intervalDays * DAY_MS) {
    if (t < options.start) continue;
    const xx = x(t);
    root.append(svg('line', { x1: xx, x2: xx, y1: margin.top + plotH, y2: margin.top + plotH + 5, class: 'chart-tick' }));
    const text = svg('text', { x: xx, y: height - 14, 'text-anchor': 'middle', class: 'chart-axis-text' });
    text.textContent = shortDay(t, options.start);
    root.append(text);
  }

  // Markers behind data.
  for (const marker of options.markers ?? []) {
    if (marker.t < options.start || marker.t > options.end) continue;
    const xx = x(marker.t);
    root.append(svg('line', {
      x1: xx, x2: xx, y1: margin.top, y2: margin.top + plotH,
      class: 'chart-marker-line',
      stroke: marker.color ?? '#34d399',
    }));
    const label = svg('text', {
      x: xx + 5,
      y: margin.top + 14,
      class: 'chart-marker-text',
      fill: marker.color ?? '#34d399',
    });
    label.textContent = marker.label;
    root.append(label);
  }

  for (const series of options.series) {
    const yMap = yFor(series);
    const pts = series.points
      .filter((p): p is ChartPoint & { y: number } => p.y !== null && Number.isFinite(p.y))
      .filter((p) => p.t >= options.start - DAY_MS && p.t <= options.end + DAY_MS);
    if (pts.length === 0) continue;

    if (series.type === 'bars') {
      const barWidth = Math.max(2, (plotW / Math.max(24, spanDays * 24)) * 0.7);
      for (const p of pts) {
        const xx = x(p.t);
        const yy = yMap(p.y);
        root.append(svg('rect', {
          x: xx - barWidth / 2,
          y: yy,
          width: barWidth,
          height: Math.max(0, margin.top + plotH - yy),
          fill: series.color,
          opacity: 0.28,
          rx: 2,
        }));
      }
      continue;
    }

    if (series.type === 'dots') {
      for (const p of pts) {
        const circle = svg('circle', {
          cx: x(p.t),
          cy: yMap(p.y),
          r: 4.5,
          fill: series.color,
          stroke: '#fff',
          'stroke-width': 1.5,
        });
        const title = svg('title');
        title.textContent = p.label ?? `${p.y.toFixed(3)}`;
        circle.append(title);
        root.append(circle);
      }
      continue;
    }

    const d = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${yMap(p.y).toFixed(1)}`)
      .join(' ');

    if (series.type === 'area') {
      const areaD = `${d} L ${x(pts[pts.length - 1].t).toFixed(1)} ${margin.top + plotH} L ${x(pts[0].t).toFixed(1)} ${margin.top + plotH} Z`;
      root.append(svg('path', { d: areaD, fill: series.color, opacity: 0.12, stroke: 'none' }));
    }

    root.append(svg('path', {
      d,
      fill: 'none',
      stroke: series.color,
      'stroke-width': series.width ?? 2.5,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'stroke-dasharray': series.dashed ? '6 5' : undefined,
    }));

    if (pts.length <= 40) {
      pts.forEach((p) => {
        const c = svg('circle', { cx: x(p.t), cy: yMap(p.y), r: 2.8, fill: series.color });
        root.append(c);
      });
    }
  }

  // Axes.
  root.append(svg('line', { x1: margin.left, x2: margin.left + plotW, y1: margin.top + plotH, y2: margin.top + plotH, class: 'chart-axis' }));
  root.append(svg('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotH, class: 'chart-axis' }));

  return root;
}

export function chartLegend(series: Array<{ name: string; color: string; dashed?: boolean }>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chart-legend';
  for (const s of series) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('i');
    swatch.style.background = s.dashed
      ? `repeating-linear-gradient(90deg, ${s.color} 0 5px, transparent 5px 9px)`
      : s.color;
    item.append(swatch, document.createTextNode(s.name));
    el.append(item);
  }
  return el;
}
