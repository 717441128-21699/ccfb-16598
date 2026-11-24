import type { BrewRecord } from '../types';
import { store, uid } from '../state/store';
import { h, modal, textInput } from '../lib/dom';
import type { PageHandle } from './page';
import { compareReadings } from '../domain/fermentation';
import { formatAbv, formatDate, formatDateTime, formatSg } from '../lib/format';

function recordEditor(existing?: BrewRecord) {
  const draft: BrewRecord = existing
    ? structuredClone(existing)
    : {
        id: uid('record'),
        date: Date.now(),
        name: '',
        styleName: store.state.styles[0]?.name ?? '啤酒',
        yeastName: '',
        og: store.state.styles[0]?.defaultOg ?? 1.05,
        fg: store.state.styles[0]?.defaultFg ?? 1.012,
        abv: 0,
        volumeL: store.state.styles[0]?.volumeL ?? 19,
        note: '',
      };
  if (!existing) draft.abv = (draft.og - draft.fg) * 131.25;

  const name = textInput(draft.name, { placeholder: '例如：冬日世涛', oninput: (v) => (draft.name = v) });
  const style = textInput(draft.styleName, { oninput: (v) => (draft.styleName = v) });
  const yeast = textInput(draft.yeastName, { oninput: (v) => (draft.yeastName = v) });
  const og = textInput(draft.og.toFixed(3), { type: 'number', step: '0.001', oninput: (v) => { draft.og = Number(v) || 1; draft.abv = (draft.og - draft.fg) * 131.25; abv.value = draft.abv.toFixed(1); } });
  const fg = textInput(draft.fg.toFixed(3), { type: 'number', step: '0.001', oninput: (v) => { draft.fg = Number(v) || 1; draft.abv = (draft.og - draft.fg) * 131.25; abv.value = draft.abv.toFixed(1); } });
  const abv = textInput(draft.abv.toFixed(1), { type: 'number', step: '0.1', oninput: (v) => (draft.abv = Number(v) || 0) });
  const volume = textInput(String(draft.volumeL), { type: 'number', step: '0.5', oninput: (v) => (draft.volumeL = Number(v) || 0) });
  const date = textInput(formatDateInput(draft.date), { type: 'date', oninput: (v) => (draft.date = new Date(`${v}T12:00:00`).getTime()) });
  const note = h('textarea', { class: 'input', attrs: { rows: '4', placeholder: '配方、温度记录、装瓶、口感、下次改进…' } }) as HTMLTextAreaElement;
  note.value = draft.note;
  note.addEventListener('input', () => (draft.note = note.value));

  const body = h('div', { class: 'form-grid' },
    labeled('酒名', name), labeled('酿造日期', date),
    labeled('风格', style), labeled('酵母', yeast),
    labeled('OG', og), labeled('FG', fg),
    labeled('ABV %', abv), labeled('体积 L', volume),
    h('label', { class: 'field field-full' }, h('span', { class: 'field-label', text: '酿造笔记' }), note),
  );
  const dlg = modal(existing ? '编辑酿造记录' : '新增酿造记录', body, [
    h('button', { class: 'btn ghost', value: 'cancel', text: '取消' }),
    h('button', {
      class: 'btn primary', text: '保存', value: 'save',
      on: { click: (e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        store.update((s) => {
          const idx = s.records.findIndex((r) => r.id === draft.id);
          if (idx >= 0) s.records[idx] = draft;
          else s.records.unshift(draft);
        });
        dlg.close('save');
      } },
    }),
  ]);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
}

function formatDateInput(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function labeled(label: string, input: HTMLElement) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `airlock-brew-studio-${formatDate(Date.now()).replaceAll('/', '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function renderRecordsPage(): PageHandle {
  const root = h('section', { class: 'page records-page' });

  function render() {
    const allReadings = [...store.state.readings].sort((a, b) => b.t - a.t);
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {}, h('h2', { text: '酿造记录' }), h('p', { text: '历史批次、比重计取样、校准偏差和酿造笔记都保存在本机浏览器。' })),
        h('div', { class: 'head-actions' },
          h('button', { class: 'btn primary', text: '＋ 新增记录', on: { click: () => recordEditor() } }),
          h('button', { class: 'btn ghost', text: '导出 JSON', on: { click: exportJson } }),
        ),
      ),
      h('div', { class: 'card validation-card' },
        h('h3', { text: '比重推算验收面板' }),
        h('div', { class: 'validation-grid' }, ...store.state.jars.map((jar) => {
          const report = compareReadings(jar, store.state.buckets, store.state.readings);
          return h('div', { class: `validation-item ${report.withinTolerance ? 'pass' : report.comparisons.length ? 'fail' : ''}` },
            h('strong', { text: jar.name }),
            h('span', { text: report.comparisons.length ? `${report.comparisons.length} 个读数 · 最大偏差 ${report.maxAbs.toFixed(3)}` : '暂无比重读数' }),
            h('b', { class: report.withinTolerance ? 'ok-text' : 'muted', text: report.withinTolerance ? '✓ ≤0.003' : '待校准' }),
          );
        })),
      ),
      h('div', { class: 'records-layout' },
        h('section', {},
          h('h3', { class: 'section-title', text: '历史批次' }),
          store.state.records.length === 0
            ? h('div', { class: 'card muted', text: '还没有酿造记录。' })
            : h('div', { class: 'record-grid' }, ...store.state.records.map((record) =>
                h('article', { class: 'card record-card' },
                  h('header', {}, h('div', {}, h('h4', { text: record.name }), h('small', { text: `${formatDate(record.date)} · ${record.styleName}` })),
                    h('span', { class: 'abv-badge', text: formatAbv(record.abv) })),
                  h('div', { class: 'record-gravity' },
                    h('span', {}, h('small', { text: 'OG' }), h('strong', { text: formatSg(record.og) })),
                    h('span', {}, h('small', { text: 'FG' }), h('strong', { text: formatSg(record.fg) })),
                    h('span', {}, h('small', { text: '体积' }), h('strong', { text: `${record.volumeL}L` })),
                  ),
                  h('p', { class: 'muted', text: record.yeastName }),
                  h('p', { class: 'record-note', text: record.note }),
                  h('footer', { class: 'card-actions' },
                    record.jarId ? h('a', { class: 'btn small', attrs: { href: `#/curves?jar=${record.jarId}` }, text: '查看曲线' }) : null,
                    h('button', { class: 'btn small ghost', text: '编辑', on: { click: () => recordEditor(record) } }),
                    h('button', { class: 'btn small danger-ghost', text: '删除', on: { click: () => {
                      if (window.confirm('删除这条酿造记录？')) {
                        store.update((s) => { s.records = s.records.filter((r) => r.id !== record.id); });
                      }
                    } } }),
                  ),
                ),
              )),
        ),
        h('section', { class: 'card readings-ledger' },
          h('h3', { text: '比重计取样台账' }),
          allReadings.length === 0
            ? h('p', { class: 'muted', text: '暂无读数。' })
            : h('div', { class: 'reading-table-wrap' },
                h('table', { class: 'data-table' },
                  h('thead', {}, h('tr', {}, h('th', { text: '时间' }), h('th', { text: '罐子' }), h('th', { text: 'SG' }), h('th', { text: '温度' }), h('th', { text: '' }))),
                  h('tbody', {}, ...allReadings.slice(0, 80).map((r) => {
                    const jar = store.state.jars.find((j) => j.id === r.jarId);
                    return h('tr', {},
                      h('td', { text: formatDateTime(r.t) }),
                      h('td', { text: jar?.name ?? '已删除罐' }),
                      h('td', { text: formatSg(r.sg) }),
                      h('td', { text: r.tempC ? `${r.tempC.toFixed(1)}°C` : '—' }),
                      h('td', {}, h('button', { class: 'btn tiny danger-ghost', text: '删', on: { click: () => store.update((s) => { s.readings = s.readings.filter((x) => x.id !== r.id); }) } })),
                    );
                  })),
                ),
              ),
          h('div', { class: 'danger-zone' },
            h('button', { class: 'btn ghost small', text: '重新载入示范数据', on: { click: () => { if (window.confirm('覆盖当前本机数据并恢复示范？')) store.resetDemo(); } } }),
            h('button', { class: 'btn danger-ghost small', text: '清空全部数据', on: { click: () => { if (window.confirm('确定清空所有罐子、曲线和记录？')) store.clearAll(); } } }),
          ),
        ),
      ),
    );
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { el: root, destroy: unsubscribe };
}
