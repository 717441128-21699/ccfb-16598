import { store } from '../state/store';
import { h, selectInput } from '../lib/dom';
import type { PageHandle } from './page';
import { listeningSession } from '../audio/session';
import { formatRelative } from '../lib/format';
import type { RejectReason } from '../types';

const REJECT_LABEL: Record<RejectReason, string> = {
  too_short: '过短瞬态',
  too_long_sustained: '持续过长',
  low_frequency_hum: '低频轰鸣/压缩机',
  broadband_noise: '宽带噪声/狗叫',
  speech_modulation: '说话调制',
  no_narrow_resonance: '无窄带共鸣',
  below_threshold: '低于阈值',
};

async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
    return (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    return null;
  }
}

function lastMinuteRate(jarId: string): number {
  const since = Date.now() - 60_000;
  return listeningSession.events.filter(
    (e) => e.accepted && e.matchedJarId === jarId && e.t >= since,
  ).length;
}

export function renderListenPage(params: URLSearchParams): PageHandle {
  const requestedTrain = params.get('train');
  if (requestedTrain && store.state.jars.some((j) => j.id === requestedTrain)) {
    listeningSession.startTraining(requestedTrain);
  }

  const root = h('section', { class: 'page listen-page' });

  const micBtn = h('button', { class: 'btn primary big', type: 'button', text: '🎙️ 开始整夜麦克风监听' }) as HTMLButtonElement;
  const demoBtn = h('button', { class: 'btn big', type: 'button', text: '▶️ 运行多罐演示声源' }) as HTMLButtonElement;
  const stopDemoBtn = h('button', { class: 'btn ghost big', type: 'button', text: '停止演示', attrs: { hidden: true } }) as HTMLButtonElement;
  const stateLine = h('span', { class: 'monitor-state', text: '麦克风未开启' });

  const sensitivityValue = h('strong', { text: `${Math.round(store.state.settings.sensitivity * 100)}%` });
  const sensitivity = h('input', {
    attrs: { type: 'range', min: '0.35', max: '0.9', step: '0.01', value: String(store.state.settings.sensitivity) },
  }) as HTMLInputElement;
  sensitivity.addEventListener('input', () => {
    const value = Number(sensitivity.value);
    sensitivityValue.textContent = `${Math.round(value * 100)}%`;
    store.update((s) => void (s.settings.sensitivity = value), { silent: true });
    store.state.settings.sensitivity = value;
    store.save();
    listeningSession.updateAudioSettings();
  });

  const rejectToggle = h('input', {
    attrs: { type: 'checkbox', checked: store.state.settings.rejectNoise ? true : false },
  }) as HTMLInputElement;
  rejectToggle.checked = store.state.settings.rejectNoise;
  rejectToggle.addEventListener('change', () => {
    store.state.settings.rejectNoise = rejectToggle.checked;
    store.save();
    listeningSession.updateAudioSettings();
  });

  const meterFill = h('i', { class: 'meter-fill' });
  const meterPeak = h('i', { class: 'meter-peak' });
  const meterText = h('span', { class: 'meter-text', text: '等待音频帧…' });
  const meter = h('div', { class: 'meter' }, h('div', { class: 'meter-track' }, meterFill, meterPeak), meterText);

  const trainingBox = h('div', { class: 'training-box', attrs: { hidden: true } });
  const jarGrid = h('div', { class: 'listen-jar-grid' });
  const rejectGrid = h('div', { class: 'reject-grid' });
  const eventList = h('div', { class: 'event-list' });

  const trainSelect = selectInput(
    listeningSession.trainingJarId ?? store.state.jars[0]?.id ?? '',
    store.state.jars.map((j) => ({ value: j.id, label: j.name })),
  );
  const trainBtn = h('button', { class: 'btn small primary', type: 'button', text: '开始学习 10 声' });
  trainBtn.addEventListener('click', () => {
    if (trainSelect.value) listeningSession.startTraining(trainSelect.value);
  });

  micBtn.addEventListener('click', async () => {
    try {
      await listeningSession.startMic();
      if (store.state.settings.wakeLock) void requestWakeLock();
    } catch {
      window.alert('无法打开麦克风。请在浏览器地址栏允许麦克风权限，并使用 https 或 localhost。');
    }
  });

  demoBtn.addEventListener('click', () => {
    listeningSession.startDemo();
    if (store.state.settings.wakeLock) void requestWakeLock();
  });
  stopDemoBtn.addEventListener('click', () => listeningSession.stopDemo());

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h2', { text: '夜间监听' }), h('p', { text: 'Web Audio 采集 → AudioWorklet 按 1024 样本帧判定咕嘟 → TS 声纹分类与产气累计。' })),
    ),
    h('div', { class: 'card monitor-card' },
      h('div', { class: 'monitor-controls' }, micBtn, demoBtn, stopDemoBtn, stateLine),
      meter,
      h('div', { class: 'audio-settings' },
        h('label', { class: 'range-field' }, h('span', {}, '检测灵敏度 ', sensitivityValue), sensitivity),
        h('label', { class: 'check-field' }, rejectToggle, h('span', { text: '排除压缩机、空调、说话和狗叫' })),
      ),
      h('p', { class: 'privacy-note', text: '音频只在本机实时分析；默认不保存录音，只保存气泡计数、估算体积和声纹特征。整夜运行请接电源并保持页面前台。' }),
    ),
    trainingBox,
    h('div', { class: 'section-head' }, h('h3', { text: '各气塞实时状态' }), h('div', { class: 'inline-actions' }, trainSelect, trainBtn)),
    jarGrid,
    h('div', { class: 'listen-bottom-grid' },
      h('section', { class: 'card' }, h('h3', { text: '噪声排除计数' }), rejectGrid),
      h('section', { class: 'card events-card' },
        h('div', { class: 'section-head compact' }, h('h3', { text: '实时判定流' }), h('button', { class: 'btn tiny ghost', text: '清空', on: { click: () => listeningSession.clearLog() } })),
        eventList,
      ),
    ),
  );

  function updateMeter() {
    const m = listeningSession.meter;
    const pct = Math.min(100, Math.max(0, (20 * Math.log10(m.rms + 1e-5) + 60) * 2.2));
    const thresholdPct = Math.min(100, Math.max(0, (20 * Math.log10(m.noiseRms + 1e-5) + 60) * 2.2));
    meterFill.style.width = `${pct}%`;
    meterPeak.style.left = `${thresholdPct}%`;
    meterFill.classList.toggle('active', m.active);
    meterText.textContent = `RMS ${m.rms.toFixed(4)} · 噪声底 ${m.noiseRms.toFixed(4)} · 峰值 ${m.peakHz ? `${Math.round(m.peakHz)} Hz` : '—'}`;
  }

  function updateTraining() {
    const id = listeningSession.trainingJarId;
    if (!id) {
      trainingBox.hidden = true;
      trainingBox.replaceChildren();
      return;
    }
    const jar = store.state.jars.find((j) => j.id === id);
    const count = listeningSession.trainingFeatures.length;
    trainingBox.hidden = false;
    trainingBox.className = 'training-box card warning-card';
    trainingBox.replaceChildren(
      h('strong', { text: `正在学习「${jar?.name ?? '发酵罐'}」的气塞声纹：${count}/${listeningSession.trainingTarget}` }),
      h('div', { class: 'progress' }, h('i', { props: { style: `width:${(count / listeningSession.trainingTarget) * 100}%` } })),
      h('span', { text: count < 3 ? '请等待真实咕嘟或运行演示声源；至少 3 声，建议 10 声。' : '已达到训练数量，正在生成主频、衰减和频段模板…' }),
      h('button', { class: 'btn tiny ghost', text: '取消学习', on: { click: () => listeningSession.cancelTraining() } }),
    );
  }

  function updateControls() {
    const running = listeningSession.micState === 'running';
    micBtn.disabled = listeningSession.micState === 'requesting';
    micBtn.textContent = running ? '🟢 麦克风监听中（点击停止）' : '🎙️ 开始整夜麦克风监听';
    if (running) micBtn.classList.add('running');
    else micBtn.classList.remove('running');
    micBtn.onclick = running
      ? () => listeningSession.stopMic()
      : async () => {
          try {
            await listeningSession.startMic();
            if (store.state.settings.wakeLock) void requestWakeLock();
          } catch {
            window.alert('无法打开麦克风。请检查权限，或先用演示声源体验。');
          }
        };

    demoBtn.hidden = listeningSession.demoRunning;
    stopDemoBtn.hidden = !listeningSession.demoRunning;
    stateLine.textContent = running
      ? 'AudioWorklet 正在按帧判定；切换页面也会继续监听。'
      : listeningSession.micState === 'requesting'
        ? '正在请求麦克风权限…'
        : listeningSession.micState === 'denied'
          ? '麦克风权限被拒绝，可使用演示声源。'
          : listeningSession.demoRunning
            ? '演示声源运行中，包含其他罐声纹和噪声。'
            : '麦克风未开启';
    stateLine.className = `monitor-state state-${listeningSession.micState}${listeningSession.demoRunning ? ' demo' : ''}`;
  }

  function updateJars() {
    jarGrid.replaceChildren();
    if (store.state.jars.length === 0) {
      jarGrid.append(h('div', { class: 'card empty-inline', text: '请先到罐子管理页新增发酵罐。' }));
      return;
    }
    for (const jar of store.state.jars) {
      const stat = listeningSession.jarStats[jar.id];
      const bpm = lastMinuteRate(jar.id);
      jarGrid.append(
        h('article', { class: 'card live-jar-card', attrs: { style: `--jar:${jar.color}` } },
          h('header', {},
            h('span', { class: 'jar-color' }),
            h('div', {}, h('h4', { text: jar.name }), h('small', { text: jar.beerName || jar.styleId })),
            h('span', { class: `live-dot ${bpm > 0 ? 'on' : ''}` }),
          ),
          h('div', { class: 'live-number' },
            h('strong', { text: String(bpm) }),
            h('span', { text: '声/分钟' }),
          ),
          h('dl', { class: 'live-stats' },
            h('div', {}, h('dt', { text: '本轮声数' }), h('dd', { text: String(stat?.bubbles ?? 0) })),
            h('div', {}, h('dt', { text: '累计气体' }), h('dd', { text: `${(stat?.volumeMl ?? 0).toFixed(1)} mL` })),
            h('div', {}, h('dt', { text: '单泡均值' }), h('dd', { text: `${jar.bubbleVolumeMl.toFixed(2)} mL` })),
            h('div', {}, h('dt', { text: '分类置信' }), h('dd', { text: stat?.avgConfidence ? `${Math.round(stat.avgConfidence * 100)}%` : '—' })),
          ),
          h('footer', {},
            h('span', { text: `上次：${formatRelative(stat?.lastT)}` }),
            h('span', { text: jar.signature ? `${Math.round(jar.signature.centerHz)}Hz · ${Math.round(jar.signature.durationMs)}ms` : '未训练声纹' }),
          ),
        ),
      );
      const colorDot = jarGrid.lastElementChild?.querySelector('.jar-color') as HTMLElement | null;
      if (colorDot) colorDot.style.background = jar.color;
    }
  }

  function updateRejectAndEvents() {
    rejectGrid.replaceChildren();
    const entries = Object.entries(listeningSession.rejectCounts) as Array<[RejectReason, number]>;
    if (entries.length === 0) {
      rejectGrid.append(h('p', { class: 'muted', text: '尚未排除噪声。冰箱压缩机、空调低频、说话和狗叫会显示在这里。' }));
    }
    for (const [reason, count] of entries.sort((a, b) => b[1] - a[1])) {
      rejectGrid.append(h('div', { class: 'reject-chip' }, h('strong', { text: String(count) }), h('span', { text: REJECT_LABEL[reason] })));
    }

    eventList.replaceChildren();
    if (listeningSession.events.length === 0) {
      eventList.append(h('p', { class: 'muted', text: '还没有判定事件。开始麦克风或演示声源后，这里会显示每一帧状态机确认的声音。' }));
      return;
    }
    for (const e of listeningSession.events.slice(0, 30)) {
      const jar = e.matchedJarId ? store.state.jars.find((j) => j.id === e.matchedJarId) : undefined;
      eventList.append(
        h('div', { class: `event-row ${e.accepted ? 'bubble' : 'reject'}` },
          h('span', { class: 'event-icon', text: e.accepted ? '🫧' : '🚫' }),
          h('div', { class: 'event-main' },
            h('strong', {
              text: e.accepted
                ? jar
                  ? `${jar.name} · ${(e.volumeMl ?? 0).toFixed(2)} mL`
                  : '咕嘟声 · 未匹配声纹'
                : REJECT_LABEL[e.rejectReason ?? 'no_narrow_resonance'],
            }),
            h('small', {
              text: `${new Date(e.t).toLocaleTimeString('zh-CN')} · ${Math.round(e.features.peakHz)}Hz · ${Math.round(e.features.durationMs)}ms · 共振 ${e.features.tonalConfidence.toFixed(2)}${e.accepted && e.confidence ? ` · 置信 ${Math.round(e.confidence * 100)}%` : ''}`,
            }),
          ),
          h('span', { class: `source-tag ${e.source}`, text: e.source === 'mic' ? '麦' : '演' }),
        ),
      );
    }
  }

  function updateAll() {
    updateControls();
    updateTraining();
    updateJars();
    updateRejectAndEvents();
  }

  const unsubSession = listeningSession.subscribe(updateAll);
  const unsubMeter = listeningSession.onMeter(updateMeter);
  updateAll();
  updateMeter();

  return {
    el: root,
    destroy: () => {
      unsubSession();
      unsubMeter();
      // Intentionally do not stop the session: overnight monitoring survives tab switches.
    },
  };
}
