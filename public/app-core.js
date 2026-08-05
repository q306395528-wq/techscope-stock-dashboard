'use strict';

const DEFAULT_WATCHLIST = ['TSLA', 'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AVGO', 'AMD', 'ORCL', 'PLTR', 'NFLX', 'TSM', 'ASML', 'MU', 'CRDO', 'ALAB'];
const STOCK_NAMES = {
  TSLA: 'Tesla', NVDA: 'NVIDIA', AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', GOOG: 'Alphabet',
  AMZN: 'Amazon', META: 'Meta', AVGO: 'Broadcom', AMD: 'AMD', ORCL: 'Oracle', PLTR: 'Palantir',
  NFLX: 'Netflix', TSM: 'TSMC', ASML: 'ASML', MU: 'Micron', CRDO: 'Credo', ALAB: 'Astera Labs',
  QQQ: 'Nasdaq 100 ETF', SPY: 'S&P 500 ETF', SOXX: 'Semiconductor ETF'
};
const COLORS = ['#8b7cff', '#31d6b4', '#f7c66b', '#ff7c98', '#5eb7ff', '#c58cff'];
const ACCESS_KEY = 'techscope_access_token';
const NAME_CACHE_KEY = 'techscope_name_cache';

const state = {
  symbol: 'TSLA',
  range: '5Y',
  prices: [],
  meta: null,
  chartMode: 'line',
  pointerIndex: null,
  comparison: [],
  comparisonActive: false,
  storage: null,
  cloudConfig: null,
  watchlist: DEFAULT_WATCHLIST.slice(),
  nameCache: readLocalJson(NAME_CACHE_KEY, {}),
  installPrompt: null
};

const $ = (id) => document.getElementById(id);
const els = {
  apiButton: $('apiButton'), apiButtonText: $('apiButtonText'), apiStatusDot: $('apiStatusDot'),
  tickerList: $('tickerList'), watchlistCount: $('watchlistCount'), customTickerForm: $('customTickerForm'), customTickerInput: $('customTickerInput'),
  sidebar: $('sidebar'), sidebarOpen: $('sidebarOpen'), sidebarClose: $('sidebarClose'), sidebarBackdrop: $('sidebarBackdrop'), mobileRefresh: $('mobileRefresh'),
  symbolTitle: $('symbolTitle'), companyName: $('companyName'), exchangeName: $('exchangeName'), latestPrice: $('latestPrice'), periodChange: $('periodChange'), watchToggleButton: $('watchToggleButton'),
  rangeGroup: $('rangeGroup'), startDate: $('startDate'), endDate: $('endDate'), queryButton: $('queryButton'),
  dashboard: $('dashboard'), emptyState: $('emptyState'), emptyApiButton: $('emptyApiButton'),
  metricReturn: $('metricReturn'), metricReturnSub: $('metricReturnSub'), metricCagr: $('metricCagr'), metricDrawdown: $('metricDrawdown'), metricDrawdownSub: $('metricDrawdownSub'),
  metricCurrentDrawdown: $('metricCurrentDrawdown'), metricVolatility: $('metricVolatility'), metric52Week: $('metric52Week'), metric52WeekSub: $('metric52WeekSub'),
  metricHigh: $('metricHigh'), metricHighSub: $('metricHighSub'), metricLow: $('metricLow'), metricLowSub: $('metricLowSub'),
  chartPanel: $('chartPanel'), chartCaption: $('chartCaption'), priceChart: $('priceChart'), drawdownChart: $('drawdownChart'), compareChart: $('compareChart'),
  priceTooltip: $('priceTooltip'), chartLoading: $('chartLoading'), compareLoading: $('compareLoading'),
  volumeToggle: $('volumeToggle'), logToggle: $('logToggle'), ma50Toggle: $('ma50Toggle'), ma200Toggle: $('ma200Toggle'),
  lineMode: $('lineMode'), candleMode: $('candleMode'), fullscreenButton: $('fullscreenButton'), refreshButton: $('refreshButton'), exportButton: $('exportButton'),
  sourceBadge: $('sourceBadge'), apiBadge: $('apiBadge'), rowsBadge: $('rowsBadge'), updatedBadge: $('updatedBadge'),
  annualReturns: $('annualReturns'), compareForm: $('compareForm'), compareInput: $('compareInput'), comparisonLegend: $('comparisonLegend'), compareEmpty: $('compareEmpty'),
  apiModal: $('apiModal'), modalClose: $('modalClose'), apiMessage: $('apiMessage'), toastContainer: $('toastContainer'), localStoreStatus: $('localStoreStatus'),
  appVersionStatus: $('appVersionStatus'), tiingoSecretStatus: $('tiingoSecretStatus'), r2Status: $('r2Status'), cronStatus: $('cronStatus'), accessStatus: $('accessStatus'),
  testCloudButton: $('testCloudButton'), closeStatusButton: $('closeStatusButton'),
  accessModal: $('accessModal'), accessForm: $('accessForm'), accessTokenInput: $('accessTokenInput'), accessMessage: $('accessMessage'),
  installButton: $('installButton')
};

async function init() {
  renderTickerList();
  setRange('5Y', false);
  bindEvents();
  setupCanvas(els.priceChart, drawPriceChart);
  setupCanvas(els.drawdownChart, drawDrawdownChart);
  setupCanvas(els.compareChart, drawCompareChart);
  setupPwa();
  await checkCloudConfig(true);
}

function bindEvents() {
  els.apiButton.addEventListener('click', openApiModal);
  els.emptyApiButton.addEventListener('click', openApiModal);
  els.modalClose.addEventListener('click', closeApiModal);
  els.closeStatusButton.addEventListener('click', closeApiModal);
  els.testCloudButton.addEventListener('click', () => checkCloudConfig(false));
  els.apiModal.addEventListener('click', (event) => { if (event.target === els.apiModal) closeApiModal(); });

  els.sidebarOpen.addEventListener('click', openSidebar);
  els.sidebarClose.addEventListener('click', closeSidebar);
  els.sidebarBackdrop.addEventListener('click', closeSidebar);
  els.mobileRefresh.addEventListener('click', () => loadSymbol(state.symbol, { force: true }));

  els.tickerList.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      event.stopPropagation();
      await removeFromWatchlist(remove.dataset.remove);
      return;
    }
    const button = event.target.closest('[data-symbol]');
    if (button) {
      closeSidebar();
      await loadSymbol(button.dataset.symbol);
    }
  });

  els.customTickerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const symbol = normalizeTicker(els.customTickerInput.value);
    if (!symbol) return showToast('请输入有效的股票代码。', 'error');
    els.customTickerInput.value = '';
    await addToWatchlist(symbol);
    closeSidebar();
    await loadSymbol(symbol);
  });

  els.watchToggleButton.addEventListener('click', async () => {
    if (state.watchlist.includes(state.symbol)) await removeFromWatchlist(state.symbol);
    else await addToWatchlist(state.symbol);
  });

  els.rangeGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (button) setRange(button.dataset.range, true);
  });
  els.queryButton.addEventListener('click', () => loadSymbol(state.symbol));
  els.startDate.addEventListener('change', setCustomRangeState);
  els.endDate.addEventListener('change', setCustomRangeState);

  els.lineMode.addEventListener('click', () => setChartMode('line'));
  els.candleMode.addEventListener('click', () => setChartMode('candle'));
  [els.volumeToggle, els.logToggle, els.ma50Toggle, els.ma200Toggle].forEach((control) => control.addEventListener('change', drawPriceChart));
  els.fullscreenButton.addEventListener('click', toggleFullscreen);
  els.refreshButton.addEventListener('click', () => loadSymbol(state.symbol, { force: true }));
  els.exportButton.addEventListener('click', exportCsv);
  els.compareForm.addEventListener('submit', (event) => { event.preventDefault(); loadComparison(); });
  document.querySelector('.benchmark-row').addEventListener('click', (event) => {
    const button = event.target.closest('[data-benchmark]');
    if (!button) return;
    els.compareInput.value = button.dataset.benchmark;
    loadComparison();
  });

  els.priceChart.addEventListener('pointermove', onPricePointerMove);
  els.priceChart.addEventListener('pointerleave', clearPricePointer);
  els.priceChart.addEventListener('pointercancel', clearPricePointer);
  els.accessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = els.accessTokenInput.value.trim();
    if (!token) return;
    localStorage.setItem(ACCESS_KEY, token);
    els.accessMessage.textContent = '';
    await checkCloudConfig(true);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeApiModal(); closeSidebar(); }
  });
}

function setupPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.classList.remove('hidden');
  });
  els.installButton.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    els.installButton.classList.add('hidden');
  });
}

function openSidebar() { els.sidebar.classList.add('open'); els.sidebarBackdrop.classList.remove('hidden'); }
function closeSidebar() { els.sidebar.classList.remove('open'); els.sidebarBackdrop.classList.add('hidden'); }

function renderTickerList() {
  els.watchlistCount.textContent = String(state.watchlist.length);
  els.tickerList.innerHTML = state.watchlist.map((symbol) => {
    const name = state.nameCache[symbol] || STOCK_NAMES[symbol] || '美股';
    return `<div class="ticker-item ${symbol === state.symbol ? 'active' : ''}">
      <button class="ticker-main" data-symbol="${escapeHtml(symbol)}">
        <span class="ticker-logo">${escapeHtml(symbol.slice(0, 2))}</span>
        <span class="ticker-copy"><strong>${escapeHtml(symbol)}</strong><span>${escapeHtml(name)}</span></span>
      </button>
      <button class="ticker-remove" data-remove="${escapeHtml(symbol)}" title="移出自选" aria-label="移出 ${escapeHtml(symbol)}">×</button>
    </div>`;
  }).join('');
  updateWatchToggle();
}

function updateWatchToggle() {
  const watched = state.watchlist.includes(state.symbol);
  els.watchToggleButton.classList.toggle('active', watched);
  els.watchToggleButton.title = watched ? '移出自选' : '加入自选';
}

async function loadWatchlist() {
  try {
    const data = await apiFetch('/api/watchlist');
    const symbols = Array.isArray(data.symbols) ? data.symbols.map(normalizeTicker).filter(Boolean) : [];
    state.watchlist = symbols.length ? [...new Set(symbols)] : DEFAULT_WATCHLIST.slice();
  } catch (error) {
    if (error.status !== 401) showToast(`自选股读取失败：${error.message}`, 'error');
  }
  renderTickerList();
}

async function persistWatchlist() {
  const data = await apiFetch('/api/watchlist', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbols: state.watchlist })
  });
  state.watchlist = data.symbols;
  renderTickerList();
}

async function addToWatchlist(symbol) {
  symbol = normalizeTicker(symbol);
  if (!symbol || state.watchlist.includes(symbol)) { renderTickerList(); return; }
  const previous = state.watchlist.slice();
  state.watchlist = [...state.watchlist, symbol].slice(0, 60);
  renderTickerList();
  try {
    await persistWatchlist();
    showToast(`${symbol} 已加入自选。`, 'success');
  } catch (error) {
    state.watchlist = previous;
    renderTickerList();
    showToast(`保存自选失败：${error.message}`, 'error');
  }
}

async function removeFromWatchlist(symbol) {
  symbol = normalizeTicker(symbol);
  if (!symbol || !state.watchlist.includes(symbol)) return;
  if (state.watchlist.length <= 1) return showToast('自选股至少保留一只。', 'error');
  const previous = state.watchlist.slice();
  state.watchlist = state.watchlist.filter((item) => item !== symbol);
  renderTickerList();
  try {
    await persistWatchlist();
    showToast(`${symbol} 已移出自选。`, 'success');
    if (state.symbol === symbol) await loadSymbol(state.watchlist[0]);
  } catch (error) {
    state.watchlist = previous;
    renderTickerList();
    showToast(`保存自选失败：${error.message}`, 'error');
  }
}

function updateApiState() {
  const connected = Boolean(state.cloudConfig?.ready);
  els.apiStatusDot.classList.toggle('connected', connected);
  els.apiButtonText.textContent = connected ? 'Cloudflare 已连接' : '检查云端连接';
  els.appVersionStatus.textContent = state.cloudConfig?.version || '—';
  setStatus(els.tiingoSecretStatus, state.cloudConfig?.tiingoConfigured, '已配置', '未配置');
  setStatus(els.r2Status, state.cloudConfig?.r2Configured, '已绑定', '未绑定');
  setStatus(els.accessStatus, state.cloudConfig?.accessProtected, '已启用', '未启用');
  const cron = state.cloudConfig?.cronStatus;
  if (cron?.ranAt) {
    els.cronStatus.textContent = `${formatDateTime(cron.ranAt)} · 更新 ${cron.updated || 0}只`;
    els.cronStatus.className = cron.failed ? 'negative' : 'positive';
  } else {
    els.cronStatus.textContent = '部署后按计划运行';
    els.cronStatus.className = '';
  }
}

function setStatus(element, okay, yes, no) {
  element.textContent = okay ? yes : no;
  element.className = okay ? 'positive' : '';
}

function openApiModal() {
  updateApiState();
  els.apiMessage.textContent = state.cloudConfig?.ready
    ? '云端数据仓库工作正常。只有自选股会参与定时增量更新。'
    : '请确认 R2 绑定和 TIINGO_API_TOKEN Secret 已配置。';
  els.apiMessage.className = `modal-message ${state.cloudConfig?.ready ? 'positive' : 'negative'}`;
  els.apiModal.classList.remove('hidden');
}
function closeApiModal() { els.apiModal.classList.add('hidden'); }
function openAccessModal() { els.accessModal.classList.remove('hidden'); setTimeout(() => els.accessTokenInput.focus(), 50); }
function closeAccessModal() { els.accessModal.classList.add('hidden'); els.accessTokenInput.value = ''; els.accessMessage.textContent = ''; }

async function checkCloudConfig(loadAfter = false) {
  els.testCloudButton.disabled = true;
  els.testCloudButton.textContent = '检查中…';
  try {
    const data = await apiFetch('/api/config');
    state.cloudConfig = data;
    updateApiState();
    if (data.ready) {
      closeAccessModal();
      showDashboard();
      if (loadAfter) {
        await loadWatchlist();
        if (!state.watchlist.includes(state.symbol)) state.symbol = state.watchlist[0] || 'TSLA';
        await loadSymbol(state.symbol);
      } else showToast('Cloudflare、R2 与 Tiingo 连接正常。', 'success');
    } else {
      showEmptyState();
      if (loadAfter) openApiModal();
    }
  } catch (error) {
    if (error.status === 401) {
      state.cloudConfig = { ready: false, accessProtected: true };
      updateApiState();
      els.accessMessage.textContent = '访问口令不正确或尚未输入。';
      openAccessModal();
      return;
    }
    state.cloudConfig = { ready: false, tiingoConfigured: false, r2Configured: false };
    updateApiState();
    showEmptyState();
    els.apiMessage.textContent = error.message;
    els.apiMessage.className = 'modal-message negative';
    if (loadAfter) openApiModal();
  } finally {
    els.testCloudButton.disabled = false;
    els.testCloudButton.textContent = '重新检查';
  }
}

function showEmptyState() { els.dashboard.classList.add('hidden'); els.emptyState.classList.remove('hidden'); }
function showDashboard() { els.emptyState.classList.add('hidden'); els.dashboard.classList.remove('hidden'); }
