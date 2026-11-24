import { store, uid } from '../state/store';
import { h, selectInput, textInput } from '../lib/dom';
import type { PageHandle } from './page';
import { chartLegend, renderTimeChart, type ChartSeries } from '../components/chart';
import {
  DAY_MS,
  HOUR_MS,
  compareReadings,
  estimateGravity,
  fitProductionFactor,
  detectPrimaryEnd,
} from '../domain/fermentation';
import { getStyle, getYeast, peakAdvanceForWarming, predictedPeak, speedAtTemperature } from '../domain/yeast';
import { formatAbv, formatDateTime, formatNumber, formatSg } from '../lib/format';
import type { Jar } from '../types';

type RangeId = '7' | '14' | 'all';

function exportCsv(jar: Jar) {
  const rows = ['time,estimated_sg,abv,bubbles_per_hour,ml_per_hour'];
  const sorted = store.state.buckets.filter((b) => b.jarId === jar.id).sort((a, b) => a.t - b.t);
  let cumulative = 0;
  for (const b of sorted) {
    cumulative += b.volumeMl;
    const est = estimateGravity({
      og: jar.og,
      volumeL: jar.volumeL,
      cumulativeGasMl: cumulative,
      tempC: jar.tempC,
      pressureKPa: jar.pressureKPa,
      productionFactor: jar.productionFactor,
    });
    const hours = b.minutes / 60;
    rows.push([
      new Date(b.t).toISOString(),
      est.sg.toFixed(4),
      est.abv.toFixed(3),
      (b.bubbles / hours).toFixed(1),
      (b.volumeMl / hours).toFixed(1),
    ].join(','));
  }
  const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${jar.name}-fermentation.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function renderCurvesPage(params: URLSearchParams): PageHandle {
  const root = h('section', { class: 'page curves-page' });
  let range: RangeId = '14';

  function currentJar(): Jar | undefined {
    const id = params.get('jar') ?? store.state.jars[0]?.id;
    return store.state.jars.find((j) => j.id === id) ?? store.state.jars[0];
  }

  function addReadingForm(jar: Jar): HTMLElement {
    const sgInput = textInput('', { type: 'number', step: '0.001', min: '0.990', placeholder: '例如 1.014' });
    const tempInput = textInput(jar.tempC.toFixed(1), { type: 'number', step: '0.5' });
    return h('form', {
      class: 'inline-add-form',
      on: {
        submit: ((e: SubmitEvent) => {
          e.preventDefault();
          const sg = Number(sgInput.value);
          if (!sg || sg < 0.98 || sg > 1.13) return;
          store.update((s) => {
            s.readings.push({
              id: uid('reading'),
              jarId: jar.id,
              t: Date.now(),
              sg,
              tempC: Number(tempInput.value) || jar.tempC,
            });
          });
          sgInput.value = '';
        }) as EventListener,
      },
    },
      sgInput,
      tempInput,
      h('button', { class: 'btn small primary', type: 'submit', text: '加入比重读数' }),
    );
  }

  function render() {
    const jar = currentJar();
    root.replaceChildren();
    if (!jar) {
      root.append(
        h('div', { class: 'page-head' }, h('h2', { text: '发酵曲线' })),
        h('div', { class: 'card empty-state' }, h('h3', { text: '暂无罐子' }), h('p', { text: '请先新增或载入示范发酵罐。' })),
      );
      return;
    }

    const style = getStyle(jar.styleId, store.state.styles);
    const yeast = getYeast(jar.yeastId);
    const jarSelect = selectInput(
      jar.id,
      store.state.jars.map((j) => ({ value: j.id, label: j.name })),
      (id) => {
        params.set('jar', id);
        location.hash = `#/curves?jar=${id}`;
      },
    );
    const rangeButtons = (['7', '14', 'all'] as RangeId[]).map((id) =>
      h('button', {
        class: `btn tiny ${range === id ? 'primary' : 'ghost'}`,
        text: id === 'all' ? '全程' : `前 ${id} 天`,
        on: { click: () => { range = id; render(); } },
      }),
    );

    const allBuckets = store.state.buckets
      .filter((b) => b.jarId === jar.id)
      .sort((a, b) => a.t - b.t);
    const rangeDays = range === 'all' ? 60 : Number(range);
    const start = jar.startedAt;
    const end = start + rangeDays * DAY_MS;
    const visibleBuckets = allBuckets.filter((b) => b.t < end);

    let cumulative = 0;
    const gravityPoints: Array<{ t: number; y: number }> = [{ t: start, y: jar.og }];
    const abvPoints: Array<{ t: number; y: number }> = [{ t: start, y: 0 }];
    const ratePoints: Array<{ t: number; y: number }> = [];
    for (const b of visibleBuckets) {
      cumulative += b.volumeMl;
      const est = estimateGravity({
        og: jar.og,
        volumeL: jar.volumeL,
        cumulativeGasMl: cumulative,
        tempC: jar.tempC,
        pressureKPa: jar.pressureKPa,
        productionFactor: jar.productionFactor,
      });
      const tEnd = b.t + b.minutes * 60_000;
      gravityPoints.push({ t: tEnd, y: est.sg });
      abvPoints.push({ t: tEnd, y: est.abv });
      ratePoints.push({ t: b.t + b.minutes * 30_000, y: b.bubbles / (b.minutes / 60) });
    }

    const readings = store.state.readings
      .filter((r) => r.jarId === jar.id && r.t >= start && r.t <= end)
      .sort((a, b) => a.t - b.t);
    const readingPoints = readings.map((r) => ({ t: r.t, y: r.sg, label: `比重计 ${r.sg.toFixed(3)}` }));

    const report = compareReadings(jar, store.state.buckets, store.state.readings);
    const endInfo = detectPrimaryEnd(jar, store.state.buckets, store.state.readings);
    const peak = predictedPeak(yeast, jar.tempC, style.peakHourFactor, jar.startedAt);
    const latest = gravityPoints[gravityPoints.length - 1];
    const latestEstimate = estimateGravity({
      og: jar.og,
      volumeL: jar.volumeL,
      cumulativeGasMl: cumulativeGasAll(jar.id),
      tempC: jar.tempC,
      pressureKPa: jar.pressureKPa,
      productionFactor: jar.productionFactor,
    });

    const sgValues = [jar.og, jar.targetFg, ...gravityPoints.map((p) => p.y), ...readingPoints.map((p) => p.y)];
    const sgMin = Math.min(...sgValues) - 0.003;
    const sgMax = Math.max(...sgValues) + 0.002;
    const rateMax = Math.max(10, ...ratePoints.map((p) => p.y));

    const series: ChartSeries[] = [
      { name: '冒泡速率（声/小时）', color: '#38bdf8', points: ratePoints, axis: 'right', type: 'bars' },
      { name: '累计产气推算 SG', color: '#f59e0b', points: gravityPoints, axis: 'left', type: 'line', width: 3 },
      { name: '比重计实测', color: '#34d399', points: readingPoints, axis: 'left', type: 'dots' },
    ];
    const markers = [];
    if (endInfo.endAt) markers.push({ t: endInfo.endAt, label: '主发酵结束', color: '#34d399' });
    if (peak.peakDate) markers.push({ t: peak.peakDate.getTime(), label: '酵母表预测峰期', color: '#a78bfa' });

    const chart = renderTimeChart({
      start,
      end: Math.min(end, Math.max(Date.now(), ...allBuckets.map((b) => b.t + HOUR_MS), start + 2 * DAY_MS)),
      leftDomain: [sgMin, sgMax],
      rightDomain: [0, rateMax * 1.25],
      leftLabel: '比重 SG',
      rightLabel: '声/小时',
      markers,
      series,
    });

    const jarAlerts = store.state.alerts.filter((a) => a.jarId === jar.id && !a.acknowledged);

    root.append(
      h('div', { class: 'page-head curves-head' },
        h('div', {}, h('h2', { text: '发酵曲线' }), h('p', { text: '累计气泡体积 → CO₂ 摩尔数 → 糖/酒精化学计量 → ABV → 当前 SG。' })),
        h('div', { class: 'head-actions' }, jarSelect, ...rangeButtons, h('button', { class: 'btn ghost', text: '导出 CSV', on: { click: () => exportCsv(jar) } })),
      ),
      ...(jarAlerts.length
        ? [h('div', { class: 'alert-stack' }, ...jarAlerts.map((a) =>
            h('div', { class: `alert-banner ${a.level}` },
              h('span', { text: a.type === 'stuck' ? '⏸️' : a.type === 'temp_high' ? '🌡️' : '⚡' }),
              h('span', { text: a.message }),
              h('button', { class: 'btn tiny ghost', text: '知道了', on: { click: () => store.update((s) => { const x = s.alerts.find((z) => z.id === a.id); if (x) x.acknowledged = true; }) } }),
            ),
          ))]
        : []),
      h('div', { class: 'metric-grid curve-metrics card' },
        metric('推算比重', formatSg(latest?.y ?? jar.og), report.comparisons.length ? `最近偏差 ${report.comparisons[report.comparisons.length - 1].residual >= 0 ? '+' : ''}${report.comparisons[report.comparisons.length - 1].residual.toFixed(3)}` : '等待比重计校准'),
        metric('推算酒精度', formatAbv(latestEstimate.abv), `乙醇 ${latestEstimate.ethanolMassG.toFixed(0)} g`),
        metric('累计 CO₂', `${latestEstimate.co2MassG.toFixed(0)} g`, `${latestEstimate.gasVolumeL.toFixed(1)} L 气塞气体`),
        metric('主发酵结束', endInfo.endDay ? `第 ${endInfo.endDay} 天` : '判定中', endInfo.reason),
      ),
      h('div', { class: 'card chart-card' },
        chartLegend([
          { name: '推算 SG', color: '#f59e0b' },
          { name: '比重计读数', color: '#34d399' },
          { name: '冒泡速率', color: '#38bdf8' },
        ]),
        chart,
      ),
      h('div', { class: 'two-col' },
        h('section', { class: 'card' },
          h('h3', { text: '比重计校准与 ≤0.003 偏差' }),
          h('p', { class: 'muted', text: '输入每日取样读数。系统用 Hall/PLATO 关系反推该读数对应的 CO₂，以稳健中位数拟合单参数产气量修正。' }),
          addReadingForm(jar),
          report.comparisons.length
            ? h('div', { class: `accuracy-summary ${report.withinTolerance ? 'pass' : 'fail'}` },
                h('strong', { text: report.withinTolerance ? `✓ 最大偏差 ${report.maxAbs.toFixed(3)}，未超过 0.003` : `当前最大偏差 ${report.maxAbs.toFixed(3)}，建议校准` }),
                h('span', { text: `RMSE ${report.rmse.toFixed(4)} SG · 系统偏差 ${report.bias >= 0 ? '+' : ''}${report.bias.toFixed(4)} · ${report.comparisons.length} 个读数` }),
                h('button', {
                  class: 'btn small primary',
                  text: '用全部读数校准产气量',
                  on: { click: () => {
                    const factor = fitProductionFactor(jar, store.state.buckets, store.state.readings);
                    store.update((s) => { const j = s.jars.find((x) => x.id === jar.id); if (j) j.productionFactor = factor; });
                  } },
                }),
              )
            : h('p', { class: 'muted', text: '尚无读数。' }),
          h('div', { class: 'reading-table-wrap' },
            h('table', { class: 'data-table' },
              h('thead', {}, h('tr', {}, h('th', { text: '时间' }), h('th', { text: '实测 SG' }), h('th', { text: '推算 SG' }), h('th', { text: '偏差' }))),
              h('tbody', {}, ...report.comparisons.slice().reverse().map((c) =>
                h('tr', {},
                  h('td', { text: formatDateTime(c.reading.t) }),
                  h('td', { text: formatSg(c.reading.sg) }),
                  h('td', { text: formatSg(c.estimatedSg) }),
                  h('td', { class: c.absResidual <= 0.003 ? 'ok-text' : 'warn-text', text: `${c.residual >= 0 ? '+' : ''}${c.residual.toFixed(3)}` }),
                ),
              )),
            ),
          ),
        ),
        h('section', { class: 'card' },
          h('h3', { text: `温度每 +2 °C，峰期提前多少？` }),
          h('p', { class: 'muted', text: `${yeast.name}；${style.name}峰期系数 ${style.peakHourFactor}。表中速度和提前量由厂商温度-速度表线性插值。` }),
          h('div', { class: 'peak-now' },
            h('strong', { text: `${jar.tempC.toFixed(1)}°C → ${peak.peakHours.toFixed(1)} h` }),
            h('span', { text: peak.peakDate ? `最密时段约 ${formatDateTime(peak.peakDate.getTime())}` : '' }),
          ),
          h('table', { class: 'data-table peak-table' },
            h('thead', {}, h('tr', {}, h('th', { text: '温度' }), h('th', { text: '速度' }), h('th', { text: '峰期' }), h('th', { text: '+2°C 提前' }))),
            h('tbody', {}, ...yeast.table.map((point) => {
              const shift = peakAdvanceForWarming(yeast, point.tempC, 2, style.peakHourFactor);
              return h('tr', { class: Math.abs(point.tempC - jar.tempC) < 1 ? 'current-row' : '' },
                h('td', { text: `${point.tempC}°C` }),
                h('td', { text: `${speedAtTemperature(yeast, point.tempC).toFixed(2)}×` }),
                h('td', { text: `${(shift.fromHours / 24).toFixed(1)} 天` }),
                h('td', { class: 'ok-text', text: point.tempC + 2 <= yeast.maxC ? `${shift.advanceHours.toFixed(1)} h` : '高温警戒' }),
              );
            })),
          ),
          h('div', { class: 'style-process' },
            h('h4', { text: '风格发酵过程设定' }),
            h('p', { text: style.processNote }),
            h('small', { text: `OG ${style.defaultOg.toFixed(3)} / FG ${style.defaultFg.toFixed(3)} · 预期主发酵 ${style.expectedPrimaryDays} 天 · 发酵度 ${formatNumber(style.attenuation * 100, 0)}%` }),
          ),
        ),
      ),
    );
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { el: root, destroy: unsubscribe };
}

function cumulativeGasAll(jarId: string): number {
  return store.state.buckets.filter((b) => b.jarId === jarId).reduce((sum, b) => sum + b.volumeMl, 0);
}

function metric(label: string, value: string, hint?: string) {
  return h('div', { class: 'metric' },
    h('span', { class: 'metric-label', text: label }),
    h('strong', { text: value }),
    hint ? h('small', { text: hint }) : null,
  );
}
