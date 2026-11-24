import './styles.css';
import { h } from './lib/dom';
import { store } from './state/store';
import { listeningSession } from './audio/session';
import { renderJarsPage } from './pages/jars';
import { renderListenPage } from './pages/listen';
import { renderCurvesPage } from './pages/curves';
import { renderRecordsPage } from './pages/records';
import type { PageHandle } from './pages/page';
import type { RouteId } from './types';

const pageRoot = document.querySelector<HTMLElement>('#page-root');
const globalStatus = document.querySelector<HTMLElement>('#global-status');
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.bottom-nav a'));

let currentPage: PageHandle | undefined;

function parseHash(): { route: RouteId; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, '') || '/jars';
  const [path, query = ''] = raw.split('?');
  const name = path.replace(/^\//, '') || 'jars';
  const route: RouteId = ['jars', 'listen', 'curves', 'records'].includes(name)
    ? (name as RouteId)
    : 'jars';
  return { route, params: new URLSearchParams(query) };
}

function renderRoute() {
  if (!pageRoot) return;
  currentPage?.destroy?.();
  pageRoot.replaceChildren();

  const { route, params } = parseHash();
  let page: PageHandle;
  if (route === 'listen') page = renderListenPage(params);
  else if (route === 'curves') page = renderCurvesPage(params);
  else if (route === 'records') page = renderRecordsPage();
  else page = renderJarsPage();

  currentPage = page;
  pageRoot.append(page.el);

  for (const link of navLinks) {
    const active = link.dataset.route === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  pageRoot.scrollTop = 0;
  window.scrollTo({ top: 0 });
}

function renderGlobalStatus() {
  if (!globalStatus) return;
  const critical = store.state.alerts.filter((a) => !a.acknowledged && a.level !== 'info').length;
  const listening = listeningSession.micState === 'running' || listeningSession.demoRunning;
  globalStatus.replaceChildren(
    listening
      ? h('span', { class: 'status-pill listening', text: listeningSession.micState === 'running' ? '● 麦克风监听中' : '● 演示声源中' })
      : h('span', { class: 'status-pill idle', text: '○ 未在监听' }),
    critical
      ? h('a', { class: 'status-pill alert', attrs: { href: '#/curves' }, text: `⚠ ${critical} 条待处理提醒` })
      : h('span', { class: 'status-pill ok', text: '✓ 模型已就绪' }),
  );
}

window.addEventListener('hashchange', renderRoute);
if (!window.location.hash) window.location.replace('#/jars');
renderRoute();
renderGlobalStatus();
store.subscribe(renderGlobalStatus);
listeningSession.subscribe(renderGlobalStatus);
window.setInterval(renderGlobalStatus, 30_000);
