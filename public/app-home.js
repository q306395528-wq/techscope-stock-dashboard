'use strict';

function installHomeMarkup() {
  if (!document.querySelector('link[href="/home.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/home.css';
    document.head.appendChild(link);
  }

  const apiButton = document.getElementById('apiButton');
  if (apiButton && !document.getElementById('homeNav')) {
    apiButton.insertAdjacentHTML('afterend', `<nav class="view-nav" aria-label="页面导航">
      <button id="homeNav" class="active">首页看板</button>
      <button id="stockNav">个股分析</button>
    </nav>`);
  }

  const mobileHeader = document.querySelector('.mobile-header');
  if (mobileHeader && !document.getElementById('mobileHomeNav')) {
    mobileHeader.insertAdjacentHTML('afterend', `<nav class="mobile-view-tabs" aria-label="移动端页面导航">
      <button id="mobileHomeNav" class="active">首页看板</button>
      <button id="mobileStockNav">个股分析</button>
    </nav>`);
  }

  const main = document.querySelector('.main-content');
  const topbar = document.querySelector('.topbar');
  const dashboard = document.getElementById('dashboard');
  const emptyState = document.getElementById('emptyState');
  if (!main || !topbar || !dashboard || document.getElementById('homeView')) return;

  const home = document.createElement('section');
  home.id = 'homeView';
  home.className = 'home-view';
  home.innerHTML = `
    <header class="home-hero">
      <div><div class="eyebrow">我的科技股自选</div><h1>首页看板</h1><p>统一查看最新交易日、近1月表现和数据状态；这里只读取 R2，不主动调用 Tiingo。</p></div>
      <div class="home-hero-actions"><span id="homeGeneratedAt">等待读取 R2</span><button class="ghost-button" id="homeRefreshButton">刷新看板</button></div>
    </header>
    <div class="home-summary-grid">
      <article class="home-summary-card"><span>已有历史数据</span><strong id="homeInitialized">—</strong><small>—</small></article>
      <article class="home-summary-card"><span>涨跌家数</span><strong id="homeAdvancers">—</strong><small>上涨 / 下跌</small></article>
      <article class="home-summary-card"><span>平均日涨跌</span><strong id="homeAverageDay">—</strong><small>最新交易日平均</small></article>
      <article class="home-summary-card"><span>平均近1月</span><strong id="homeAverageMonth">—</strong><small>近30天平均</small></article>
      <article class="home-summary-card"><span>今日最强</span><strong id="homeLeader">—</strong><small>暂无数据</small></article>
      <article class="home-summary-card"><span>今日最弱</span><strong id="homeLaggard">—</strong><small>暂无数据</small></article>
    </div>
    <div class="home-layout">
      <section class="panel home-performance-panel">
        <div class="panel-header"><div><h2>自选股表现</h2><p>复权收盘价 · 点击任意股票进入详细分析</p></div><span class="status-pill good">首页 API 0次</span></div>
        <div id="homeStockGrid" class="home-stock-grid"></div>
        <div class="home-loading hidden" id="homeLoading"><div class="spinner"></div><span>正在读取 R2 看板…</span></div>
      </section>
      <div class="home-side-stack">
        <section class="panel"><div class="panel-header"><div><h2>近1月强弱排行</h2><p>按30天复权收益排序</p></div></div><div id="homeRanking" class="home-ranking"></div></section>
        <section class="panel"><div class="panel-header"><div><h2>数据状态</h2><p>首页不会触发 Tiingo 下载</p></div></div><div id="homeDataHealth" class="home-health"></div></section>
      </div>
    </div>`;

  const stock = document.createElement('div');
  stock.id = 'stockView';
  stock.className = 'stock-view hidden';
  main.insertBefore(home, topbar);
  main.insertBefore(stock, topbar);
  stock.appendChild(topbar);
  stock.appendChild(dashboard);
  if (emptyState) main.insertBefore(emptyState, stock);
}

installHomeMarkup();

state.view = 'home';
state.overview = null;
state.overviewLoading = false;

Object.assign(els, {
  homeView: $('homeView'), stockView: $('stockView'),
  homeNav: $('homeNav'), stockNav: $('stockNav'), mobileHomeNav: $('mobileHomeNav'), mobileStockNav: $('mobileStockNav'),
  homeRefreshButton: $('homeRefreshButton'), homeGeneratedAt: $('homeGeneratedAt'), homeStockGrid: $('homeStockGrid'), homeRanking: $('homeRanking'), homeDataHealth: $('homeDataHealth'), homeLoading: $('homeLoading'),
  homeInitialized: $('homeInitialized'), homeAdvancers: $('homeAdvancers'), homeAverageDay: $('homeAverageDay'), homeAverageMonth: $('homeAverageMonth'), homeLeader: $('homeLeader'), homeLaggard: $('homeLaggard')
});

const baseInit = init;
const baseLoadSymbol = loadSymbol;
const baseRenderTickerList = renderTickerList;
const basePersistWatchlist = persistWatchlist;

init = async function initWithHome() {
  bindHomeEvents();
  await baseInit();
};

renderTickerList = function renderTickerListWithHomeState() {
  baseRenderTickerList();
  if (state.view === 'home') {
    els.tickerList.querySelectorAll('.ticker-item.active').forEach((item) => item.classList.remove('active'));
  }
};

persistWatchlist = async function persistWatchlistAndRefreshHome() {
  await basePersistWatchlist();
  if (state.view === 'home') await loadOverview({ quiet: true });
};

loadSymbol = async function loadSymbolFromAnyView(symbol, options = {}) {
  switchView('stock', { load: false });
  return baseLoadSymbol(symbol, options);
};

showEmptyState = function showEmptyStateForViews() {
  els.homeView.classList.add('hidden');
  els.stockView.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
};

showDashboard = function showConnectedView() {
  els.emptyState.classList.add('hidden');
  applyViewVisibility();
};

checkCloudConfig = async function checkCloudConfigForHome(loadAfter = false) {
  els.testCloudButton.disabled = true;
  els.testCloudButton.textContent = '检查中…';
  try {
    const data = await apiFetch('/api/config');
    state.cloudConfig = data;
    updateApiState();
    if (data.ready) {
      closeAccessModal();
      if (loadAfter) {
        await loadWatchlist();
        state.view = 'home';
        showDashboard();
        await loadOverview();
      } else {
        showDashboard();
        showToast('Cloudflare、R2 与 Tiingo 连接正常。', 'success');
      }
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
};

function bindHomeEvents() {
  [els.homeNav, els.mobileHomeNav].forEach((button) => button?.addEventListener('click', () => switchView('home')));
  [els.stockNav, els.mobileStockNav].forEach((button) => button?.addEventListener('click', () => {
    if (state.prices.length) switchView('stock', { load: false });
    else loadSymbol(state.symbol || state.watchlist[0] || 'TSLA');
  }));
  els.homeRefreshButton?.addEventListener('click', () => loadOverview());
  els.homeStockGrid?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-home-symbol]');
    if (card) loadSymbol(card.dataset.homeSymbol);
  });
  els.homeRanking?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-home-symbol]');
    if (row) loadSymbol(row.dataset.homeSymbol);
  });
  els.mobileRefresh?.addEventListener('click', (event) => {
    if (state.view !== 'home') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadOverview();
  }, true);
}

function switchView(view, options = {}) {
  state.view = view === 'stock' ? 'stock' : 'home';
  if (!state.cloudConfig?.ready) return showEmptyState();
  showDashboard();
  renderTickerList();
  if (state.view === 'home' && options.load !== false) loadOverview({ quiet: Boolean(options.quiet) });
}

function applyViewVisibility() {
  const home = state.view === 'home';
  els.homeView.classList.toggle('hidden', !home);
  els.stockView.classList.toggle('hidden', home);
  [els.homeNav, els.mobileHomeNav].forEach((button) => button?.classList.toggle('active', home));
  [els.stockNav, els.mobileStockNav].forEach((button) => button?.classList.toggle('active', !home));
}

async function loadOverview(options = {}) {
  if (!state.cloudConfig?.ready || state.overviewLoading) return;
  state.overviewLoading = true;
  setLoading(els.homeLoading, true);
  els.homeRefreshButton.disabled = true;
  els.homeRefreshButton.textContent = '读取中…';
  try {
    const data = await apiFetch('/api/overview');
    state.overview = data;
    renderHomeOverview();
    if (!options.quiet) showToast('首页看板已从 R2 更新，Tiingo API 0次。', 'success');
  } catch (error) {
    if (error.status !== 401) showToast(`看板读取失败：${error.message}`, 'error');
  } finally {
    state.overviewLoading = false;
    setLoading(els.homeLoading, false);
    els.homeRefreshButton.disabled = false;
    els.homeRefreshButton.textContent = '刷新看板';
  }
}

function renderHomeOverview() {
  const data = state.overview || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const summary = data.summary || {};
  els.homeGeneratedAt.textContent = data.generatedAt ? `R2 数据 · ${formatDateTime(data.generatedAt)}` : 'R2 数据';
  els.homeInitialized.textContent = `${summary.initialized || 0}/${summary.total || state.watchlist.length}`;
  els.homeInitialized.nextElementSibling.textContent = `${summary.pending || 0}只尚未初始化`;
  els.homeAdvancers.textContent = `${summary.advancers || 0} / ${summary.decliners || 0}`;
  els.homeAdvancers.nextElementSibling.textContent = '上涨 / 下跌';
  setHomeMetric(els.homeAverageDay, summary.averageDay, '最新交易日平均');
  setHomeMetric(els.homeAverageMonth, summary.averageMonth, '近30天平均');
  renderHomeMover(els.homeLeader, summary.leader, true);
  renderHomeMover(els.homeLaggard, summary.laggard, false);
  renderHomeStockGrid(items);
  renderHomeRanking(items);
  renderHomeDataHealth(data, items);
}

function setHomeMetric(element, value, subtitle) {
  element.textContent = Number.isFinite(value) ? formatPercent(value) : '—';
  element.nextElementSibling.textContent = subtitle;
  element.classList.remove('positive', 'negative');
  if (Number.isFinite(value)) setValueTone(element, value);
}

function renderHomeMover(element, mover, positiveExpected) {
  if (!mover?.symbol || !Number.isFinite(mover.change)) {
    element.textContent = '—';
    element.nextElementSibling.textContent = '暂无数据';
    element.classList.remove('positive', 'negative');
    return;
  }
  element.textContent = mover.symbol;
  element.nextElementSibling.textContent = formatPercent(mover.change);
  element.classList.remove('positive', 'negative');
  element.classList.add(positiveExpected ? 'positive' : 'negative');
}

function renderHomeStockGrid(items) {
  els.homeStockGrid.innerHTML = items.map((item) => {
    const symbol = escapeHtml(item.symbol);
    const name = escapeHtml(item.name || state.nameCache[item.symbol] || STOCK_NAMES[item.symbol] || '美股');
    if (!item.initialized) {
      return `<button class="home-stock-card pending" data-home-symbol="${symbol}">
        <div class="home-stock-head"><span class="ticker-logo">${symbol.slice(0, 2)}</span><span><strong>${symbol}</strong><small>${name}</small></span><em>未初始化</em></div>
        <div class="home-pending-copy">点击下载首次历史数据</div>
        <div class="home-card-foot"><span>Tiingo 首次请求</span><b>打开分析 →</b></div>
      </button>`;
    }
    const dayClass = item.change1d >= 0 ? 'positive' : 'negative';
    const monthClass = item.change1m >= 0 ? 'positive' : 'negative';
    return `<button class="home-stock-card" data-home-symbol="${symbol}">
      <div class="home-stock-head"><span class="ticker-logo">${symbol.slice(0, 2)}</span><span><strong>${symbol}</strong><small>${name}</small></span><em>${escapeHtml(item.lastDate || '')}</em></div>
      <div class="home-price-row"><strong>${currency(item.latest)}</strong><span class="${dayClass}">${formatPercent(item.change1d)}</span></div>
      ${sparklineSvg(item.spark || [], item.change1m)}
      <div class="home-change-row"><span>近1月 <b class="${monthClass}">${formatPercent(item.change1m)}</b></span><span>距52周高点 <b>${formatPercent(item.distance52)}</b></span></div>
    </button>`;
  }).join('');
}

function sparklineSvg(values, change) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '<div class="home-sparkline empty"></div>';
  const min = Math.min(...nums); const max = Math.max(...nums); const span = Math.max(max - min, 0.0001);
  const points = nums.map((value, index) => `${(index / (nums.length - 1) * 100).toFixed(2)},${(34 - (value - min) / span * 30).toFixed(2)}`).join(' ');
  const tone = Number(change) >= 0 ? 'positive-line' : 'negative-line';
  return `<svg class="home-sparkline ${tone}" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function renderHomeRanking(items) {
  const valid = items.filter((item) => item.initialized && Number.isFinite(item.change1m)).sort((a, b) => b.change1m - a.change1m);
  if (!valid.length) {
    els.homeRanking.innerHTML = '<div class="home-placeholder">打开几只股票完成首次历史数据初始化后，这里会显示强弱排行。</div>';
    return;
  }
  const maxAbs = Math.max(...valid.map((item) => Math.abs(item.change1m)), 0.01);
  els.homeRanking.innerHTML = valid.slice(0, 10).map((item, index) => {
    const width = Math.max(4, Math.abs(item.change1m) / maxAbs * 100);
    return `<button class="home-ranking-row" data-home-symbol="${escapeHtml(item.symbol)}"><span>${index + 1}</span><strong>${escapeHtml(item.symbol)}</strong><div><i class="${item.change1m >= 0 ? 'up' : 'down'}" style="width:${width}%"></i></div><em class="${item.change1m >= 0 ? 'positive' : 'negative'}">${formatPercent(item.change1m)}</em></button>`;
  }).join('');
}

function renderHomeDataHealth(data, items) {
  const initialized = items.filter((item) => item.initialized);
  const latestDate = initialized.map((item) => item.lastDate).filter(Boolean).sort().at(-1) || '—';
  const oldestDate = initialized.map((item) => item.lastDate).filter(Boolean).sort()[0] || '—';
  els.homeDataHealth.innerHTML = `
    <div><span>本次 Tiingo 请求</span><strong class="positive">0次</strong></div>
    <div><span>已初始化股票</span><strong>${initialized.length}只</strong></div>
    <div><span>最新数据日期</span><strong>${latestDate}</strong></div>
    <div><span>最旧更新日期</span><strong>${oldestDate}</strong></div>
    <div><span>读取方式</span><strong>Cloudflare R2</strong></div>
    <p>首页只读取已经保存的数据，不会主动调用 Tiingo。点击未初始化股票后，才会下载其历史价格。</p>`;
}
