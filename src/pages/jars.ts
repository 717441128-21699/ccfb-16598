import type { BeerStyle, Jar, JarStatus } from '../types';
import { store, uid } from '../state/store';
import { h, modal, selectInput, textInput } from '../lib/dom';
import type { PageHandle } from './page';
import {
  compareReadings,
  detectPrimaryEnd,
  estimateJarAt,
} from '../domain/fermentation';
import { YEAST_PROFILES, getStyle, getYeast, predictedPeak } from '../domain/yeast';
import { formatAbv, formatDate, formatSg, toDatetimeLocalValue, fromDatetimeLocalValue } from '../lib/format';

const STATUS_LABEL: Record<JarStatus, string> = {
  active: '发酵中',
  'primary-done': '主发酵完成',
  conditioning: '熟成中',
  archived: '已归档',
};

function jarDraft(existing?: Jar): Jar {
  const style = existing ? getStyle(existing.styleId, store.state.styles) : store.state.styles[0];
  return (
    existing
      ? structuredClone(existing)
      : {
          id: uid('jar'),
          name: `发酵罐 ${store.state.jars.length + 1}`,
          beerName: '',
          styleId: style.id,
          yeastId: style.yeastId,
          color: style.color,
          startedAt: Date.now(),
          volumeL: style.volumeL,
          og: style.defaultOg,
          targetFg: style.defaultFg,
          tempC: style.tempC,
          pressureKPa: 101.325,
          bubbleVolumeMl: 0.65,
          productionFactor: 1,
          status: 'active',
          signature: null,
          notes: '',
        }
  );
}

function openJarEditor(existing?: Jar) {
  const draft = jarDraft(existing);
  const content = h('div', { class: 'form-grid' });

  const nameInput = textInput(draft.name, { oninput: (v) => (draft.name = v) });
  const beerInput = textInput(draft.beerName, { placeholder: '例如：周末 IPA', oninput: (v) => (draft.beerName = v) });
  const styleSelect = selectInput(
    draft.styleId,
    store.state.styles.map((s) => ({ value: s.id, label: s.name })),
    (id) => {
      draft.styleId = id;
      const style = getStyle(id, store.state.styles);
      draft.yeastId = style.yeastId;
      draft.color = style.color;
      if (!existing) {
        draft.volumeL = style.volumeL;
        draft.og = style.defaultOg;
        draft.targetFg = style.defaultFg;
        draft.tempC = style.tempC;
      }
    },
  );
  styleSelect.addEventListener('change', () => {
    styleHint.textContent = styleProcessText(draft);
  });

  const yeastSelect = selectInput(
    draft.yeastId,
    YEAST_PROFILES.map((y) => ({ value: y.id, label: y.name })),
    (v) => (draft.yeastId = v),
  );
  const startedInput = textInput(toDatetimeLocalValue(draft.startedAt), {
    type: 'datetime-local',
    oninput: (v) => (draft.startedAt = fromDatetimeLocalValue(v)),
  });
  const volumeInput = textInput(String(draft.volumeL), { type: 'number', step: '0.5', min: '1', oninput: (v) => (draft.volumeL = Number(v) || 0) });
  const ogInput = textInput(draft.og.toFixed(3), { type: 'number', step: '0.001', min: '1.000', oninput: (v) => (draft.og = Number(v) || 1) });
  const fgInput = textInput(draft.targetFg.toFixed(3), { type: 'number', step: '0.001', min: '0.990', oninput: (v) => (draft.targetFg = Number(v) || 1) });
  const tempInput = textInput(String(draft.tempC), { type: 'number', step: '0.5', oninput: (v) => (draft.tempC = Number(v) || 20) });
  const bubbleVolInput = textInput(String(draft.bubbleVolumeMl), { type: 'number', step: '0.05', min: '0.01', oninput: (v) => (draft.bubbleVolumeMl = Number(v) || 0.1) });
  const factorInput = textInput(draft.productionFactor.toFixed(3), { type: 'number', step: '0.01', min: '0.5', max: '2.5', oninput: (v) => (draft.productionFactor = Number(v) || 1) });
  const statusSelect = selectInput<JarStatus>(
    draft.status,
    (Object.keys(STATUS_LABEL) as JarStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    (v) => (draft.status = v),
  );
  const notesInput = h('textarea', {
    class: 'input',
    attrs: { rows: '3', placeholder: '备注：气塞型号、麦克风位置、校准方式…' },
    on: { input: ((e: Event) => (draft.notes = (e.target as HTMLTextAreaElement).value)) as EventListener },
  }) as HTMLTextAreaElement;
  notesInput.value = draft.notes ?? '';

  const styleHint = h('p', { class: 'form-hint', text: styleProcessText(draft) });

  content.append(
    labeled('罐子名称', nameInput),
    labeled('酒名 / 批次', beerInput),
    labeled('啤酒风格', styleSelect),
    styleHint,
    labeled('酵母温度-速度表', yeastSelect),
    labeled('开始时间', startedInput),
    labeled('批次体积 (L)', volumeInput),
    labeled('初始比重 OG', ogInput),
    labeled('目标终比重 FG', fgInput),
    labeled('发酵温度 (°C)', tempInput),
    labeled('单泡校准体积 (mL)', bubbleVolInput, '可用已知 CO₂ 总量/气泡数校准；声纹频率会估算泡大小差异。'),
    labeled('产气量修正系数', factorInput, '比重计校准会自动拟合，吸收溶存 CO₂、漏检和漏气。'),
    labeled('状态', statusSelect),
    h('label', { class: 'field field-full' }, h('span', { class: 'field-label', text: '备注' }), notesInput),
  );

  const dlg = modal(existing ? '编辑发酵罐' : '新增发酵罐', content, [
    h('button', { class: 'btn ghost', value: 'cancel', text: '取消' }),
    h('button', {
      class: 'btn primary',
      value: 'save',
      text: '保存罐子',
      on: {
        click: (e) => {
          e.preventDefault();
          if (!draft.name.trim() || draft.volumeL <= 0) return;
          store.update((s) => {
            const idx = s.jars.findIndex((j) => j.id === draft.id);
            if (idx >= 0) s.jars[idx] = draft;
            else s.jars.push(draft);
          });
          dlg.close('save');
        },
      },
    }),
  ]);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
}

function labeled(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    input,
    hint ? h('small', { class: 'field-hint', text: hint }) : null,
  );
}

function styleProcessText(draft: Jar): string {
  const style = getStyle(draft.styleId, store.state.styles);
  const yeast = getYeast(draft.yeastId);
  const peak = predictedPeak(yeast, draft.tempC, style.peakHourFactor);
  return `${style.processNote} 按 ${yeast.name} 表，${draft.tempC}°C 时峰期约 ${peak.peakHours.toFixed(0)} 小时（${(peak.peakHours / 24).toFixed(1)} 天）。`;
}

function openStyleLibrary() {
  const list = h('div', { class: 'style-list' });
  const render = () => {
    list.replaceChildren();
    for (const style of store.state.styles) {
      list.append(
        h('article', { class: 'style-row' },
          h('span', { class: 'style-dot', props: { style: `background:${style.color}` } }),
          h('div', { class: 'style-main' },
            h('strong', { text: style.name }),
            h('small', { text: `OG ${style.defaultOg.toFixed(3)} → FG ${style.defaultFg.toFixed(3)} · ${style.tempC}°C · 预期 ${style.expectedPrimaryDays} 天 · 峰期系数 ${style.peakHourFactor}` }),
            h('p', { text: style.processNote }),
          ),
          h('button', { class: 'btn small', text: '设定', on: { click: () => openStyleEditor(style.id) } }),
        ),
      );
    }
  };
  render();
  const dlg = modal('啤酒风格与发酵过程', h('div', {}, list), [
    h('button', { class: 'btn ghost', value: 'cancel', text: '关闭' }),
    h('button', { class: 'btn primary', text: '新建风格', on: { click: () => { dlg.close(); openStyleEditor(); } } }),
  ]);
  document.body.append(dlg);
  dlg.showModal();
  const unsubscribe = store.subscribe(render);
  dlg.addEventListener('close', () => {
    unsubscribe();
    dlg.remove();
  });
}

function openStyleEditor(styleId?: string) {
  const existing = styleId ? getStyle(styleId, store.state.styles) : undefined;
  const draft: BeerStyle = existing
    ? structuredClone(existing)
    : {
        id: uid('style'),
        name: '自定义风格',
        color: '#38bdf8',
        defaultOg: 1.05,
        defaultFg: 1.012,
        volumeL: 19,
        tempC: 20,
        yeastId: YEAST_PROFILES[0].id,
        peakHourFactor: 1,
        expectedPrimaryDays: 7,
        attenuation: 0.76,
        processNote: '',
        custom: true,
      };

  const name = textInput(draft.name, { oninput: (v) => (draft.name = v) });
  const color = textInput(draft.color, { type: 'color', oninput: (v) => (draft.color = v) });
  const og = textInput(draft.defaultOg.toFixed(3), { type: 'number', step: '0.001', oninput: (v) => (draft.defaultOg = Number(v) || 1.05) });
  const fg = textInput(draft.defaultFg.toFixed(3), { type: 'number', step: '0.001', oninput: (v) => (draft.defaultFg = Number(v) || 1.012) });
  const volume = textInput(String(draft.volumeL), { type: 'number', step: '0.5', oninput: (v) => (draft.volumeL = Number(v) || 19) });
  const temp = textInput(String(draft.tempC), { type: 'number', step: '0.5', oninput: (v) => (draft.tempC = Number(v) || 20) });
  const peakFactor = textInput(draft.peakHourFactor.toFixed(2), { type: 'number', step: '0.05', min: '0.6', max: '1.6', oninput: (v) => (draft.peakHourFactor = Number(v) || 1) });
  const days = textInput(String(draft.expectedPrimaryDays), { type: 'number', min: '3', max: '30', oninput: (v) => (draft.expectedPrimaryDays = Number(v) || 7) });
  const attenuation = textInput(draft.attenuation.toFixed(2), { type: 'number', step: '0.01', min: '0.5', max: '0.95', oninput: (v) => (draft.attenuation = Number(v) || 0.75) });
  const yeast = selectInput(draft.yeastId, YEAST_PROFILES.map((y) => ({ value: y.id, label: y.name })), (v) => (draft.yeastId = v));
  const note = h('textarea', { class: 'input', attrs: { rows: '3' } }) as HTMLTextAreaElement;
  note.value = draft.processNote;
  note.addEventListener('input', () => (draft.processNote = note.value));

  const body = h('div', { class: 'form-grid' },
    labeled('风格名称', name),
    labeled('颜色', color),
    labeled('默认 OG', og),
    labeled('默认 FG', fg),
    labeled('体积 L', volume),
    labeled('温度 °C', temp),
    labeled('峰期系数', peakFactor, '小于 1 比酵母表更快，大于 1 更慢。'),
    labeled('预期主发酵天数', days),
    labeled('表观发酵度', attenuation),
    labeled('酵母表', yeast),
    h('label', { class: 'field field-full' }, h('span', { class: 'field-label', text: '发酵过程设定' }), note),
  );

  const dlg = modal(existing ? '设定发酵过程' : '新建啤酒风格', body, [
    h('button', { class: 'btn ghost', text: '取消', value: 'cancel' }),
    h('button', {
      class: 'btn primary', text: '保存风格', value: 'save',
      on: { click: (e) => {
        e.preventDefault();
        store.update((s) => {
          const idx = s.styles.findIndex((x) => x.id === draft.id);
          if (idx >= 0) s.styles[idx] = draft;
          else s.styles.push(draft);
        });
        dlg.close('save');
      } },
    }),
  ]);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
}

function jarCard(jar: Jar): HTMLElement {
  const estimate = estimateJarAt(jar, store.state.buckets, Date.now());
  const end = detectPrimaryEnd(jar, store.state.buckets, store.state.readings);
  const accuracy = compareReadings(jar, store.state.buckets, store.state.readings);
  const style = getStyle(jar.styleId, store.state.styles);
  const yeast = getYeast(jar.yeastId);
  const peak = predictedPeak(yeast, jar.tempC, style.peakHourFactor, jar.startedAt);
  const readingCount = store.state.readings.filter((r) => r.jarId === jar.id).length;

  return h('article', { class: 'card jar-card', attrs: { 'data-jar-id': jar.id } },
    h('div', { class: 'jar-card-head' },
      h('span', { class: 'jar-color', props: { style: `background:${jar.color}` } }),
      h('div', { class: 'jar-title' },
        h('h3', { text: jar.name }),
        h('p', { text: `${jar.beerName || style.name} · 开始于 ${formatDate(jar.startedAt)}` }),
      ),
      h('span', { class: `badge status-${jar.status}`, text: STATUS_LABEL[jar.status] }),
    ),
    h('div', { class: 'metric-grid' },
      metric('推算 SG', formatSg(estimate.sg), `OG ${formatSg(jar.og)} / 目标 ${formatSg(jar.targetFg)}`),
      metric('酒精度', formatAbv(estimate.abv), `累计 CO₂ ${estimate.co2MassG.toFixed(0)} g`),
      metric('预测峰期', `${peak.peakHours.toFixed(0)} h`, peak.peakDate ? formatDate(peak.peakDate.getTime()) : ''),
      metric('主发酵结束', end.endDay ? `第 ${end.endDay} 天` : '判定中', end.peakDay ? `峰值第 ${end.peakDay} 天` : '等待峰值'),
    ),
    h('div', { class: 'jar-meta' },
      h('span', { text: `🌡️ ${jar.tempC}°C（上限 ${yeast.maxC}°C）` }),
      h('span', { text: `🔊 ${jar.signature ? `声纹已训练 · ${Math.round(jar.signature.centerHz)}Hz` : '未训练声纹'}` }),
      h('span', { text: `💧 ${jar.bubbleVolumeMl.toFixed(2)} mL/泡` }),
      h('span', { text: `🧪 ${readingCount} 次比重读数` }),
      accuracy.comparisons.length
        ? h('span', { class: accuracy.withinTolerance ? 'ok-text' : 'warn-text', text: `最大偏差 ${accuracy.maxAbs.toFixed(3)}` })
        : null,
    ),
    h('div', { class: 'card-actions' },
      h('a', { class: 'btn primary small', attrs: { href: `#/listen?train=${jar.id}` }, text: jar.signature ? '测试/重训声纹' : '训练声纹' }),
      h('a', { class: 'btn small', attrs: { href: `#/curves?jar=${jar.id}` }, text: '看曲线' }),
      h('button', { class: 'btn small ghost', text: '编辑', on: { click: () => openJarEditor(jar) } }),
      h('button', {
        class: 'btn small danger-ghost', text: '删除',
        on: { click: () => {
          if (!window.confirm(`删除 ${jar.name}？相关曲线和读数也会一并删除。`)) return;
          store.update((s) => {
            s.jars = s.jars.filter((j) => j.id !== jar.id);
            s.readings = s.readings.filter((r) => r.jarId !== jar.id);
            s.buckets = s.buckets.filter((b) => b.jarId !== jar.id);
            s.alerts = s.alerts.filter((a) => a.jarId !== jar.id);
          });
        } },
      }),
    ),
  );
}

function metric(label: string, value: string, hint?: string) {
  return h('div', { class: 'metric' },
    h('span', { class: 'metric-label', text: label }),
    h('strong', { text: value }),
    hint ? h('small', { text: hint }) : null,
  );
}

export function renderJarsPage(): PageHandle {
  const el = h('section', { class: 'page jars-page' });
  const render = () => {
    el.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {},
          h('h2', { text: '罐子管理' }),
          h('p', { text: '每个发酵罐绑定啤酒风格、酵母温度-速度表、单泡体积校准和气塞声纹。' }),
        ),
        h('div', { class: 'head-actions' },
          h('button', { class: 'btn ghost', text: '风格发酵设定', on: { click: openStyleLibrary } }),
          h('button', { class: 'btn primary', text: '＋ 新增罐子', on: { click: () => openJarEditor() } }),
        ),
      ),
      store.state.jars.length === 0
        ? h('div', { class: 'card empty-state' },
            h('h3', { text: '还没有发酵罐' }),
            h('p', { text: '新增一个罐子，或重新载入三罐示范数据查看完整曲线、声纹和警报。' }),
            h('button', { class: 'btn primary', text: '载入示范数据', on: { click: () => store.resetDemo() } }),
          )
        : h('div', { class: 'jar-grid' }, ...store.state.jars.map(jarCard)),
      h('div', { class: 'card info-card' },
        h('h3', { text: '多罐分离怎么做？' }),
        h('ol', {},
          h('li', { text: '把手机放在几个气塞中间，避免贴住某一个罐壁。' }),
          h('li', { text: '在夜间监听页依次为每个罐子录制 8–20 声咕嘟，得到主频、带宽、时长和频段比例。' }),
          h('li', { text: '运行时 AudioWorklet 先排除低频压缩机/空调、持续说话和宽带狗叫，再用加权最近声纹把咕嘟归到对应罐子。' }),
        ),
      ),
    );
  };
  const unsubscribe = store.subscribe(render);
  render();
  return { el, destroy: unsubscribe };
}
