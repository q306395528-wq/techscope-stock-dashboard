'use strict';

(function installSidebarQuotes() {
  if (!document.querySelector('link[href="/sidebar-quotes.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/sidebar-quotes.css';
    document.head.appendChild(link);
  }

  const sectionHeading = document.querySelector('.watchlist-section .section-heading');
  if (sectionHeading && !document.getElementById('tickerColumnHead')) {
    sectionHeading.insertAdjacentHTML('afterend', '<div id="tickerColumnHead" class="ticker-column-head"><span>股票</span><span>走势</span><span>价格 / 涨跌</span></div>');
  }
})();

function sidebarQuoteItem(symbol) {
  const items = Array.isArray(state.overview?.items) ? state.overview.items : [];
  return items.find((item) => item.symbol === symbol) || null;
}

function sidebarCompactPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number >= 10000) return `$${(number / 1000).toFixed(1)}K`;
  if (number >= 1000) return `$${number.toFixed(0)}`;
  return `$${number.toFixed(2)}`;
}

function sidebarSparkline(values, change) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '<span class="ticker-mini-chart empty" aria-hidden="true"></span>';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(max - min, 0.0001);
  const points = nums.map((value, index) => {
    const x = index / (nums.length - 1) * 54;
    const y = 21 - (value - min) / span * 18;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const tone = Number(change) >= 0 ? 'up' : 'down';
  return `<svg class="ticker-mini-chart ${tone}" viewBox="0 0 54 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

renderTickerList = function renderTickerListWithQuotes() {
  els.watchlistCount.textContent = String(state.watchlist.length);
  els.tickerList.innerHTML = state.watchlist.map((symbol) => {
    const item = sidebarQuoteItem(symbol);
    const name = item?.name || state.nameCache[symbol] || STOCK_NAMES[symbol] || '美股';
    const active = state.view !== 'home' && symbol === state.symbol;
    const initialized = Boolean(item?.initialized && Number.isFinite(Number(item.latest)));
    const change = Number(item?.change1d);
    const changeClass = Number.isFinite(change) ? (change >= 0 ? 'positive' : 'negative') : 'muted';
    const changeText = Number.isFinite(change) ? formatPercent(change) : (item && !item.initialized ? '未加载' : '—');
    return `<div class="ticker-item ${active ? 'active' : ''}">
      <button class="ticker-main" data-symbol="${escapeHtml(symbol)}" title="${escapeHtml(name)}">
        <span class="ticker-logo">${escapeHtml(symbol.slice(0, 2))}</span>
        <span class="ticker-copy"><strong>${escapeHtml(symbol)}</strong><span>${escapeHtml(name)}</span></span>
        ${sidebarSparkline(item?.spark || [], item?.change1d)}
        <span class="ticker-quote"><strong>${initialized ? sidebarCompactPrice(item.latest) : '—'}</strong><span class="${changeClass}">${changeText}</span></span>
      </button>
      <button class="ticker-remove" data-remove="${escapeHtml(symbol)}" title="移出自选" aria-label="移出 ${escapeHtml(symbol)}">×</button>
    </div>`;
  }).join('');
  updateWatchToggle();
};

const sidebarBaseLoadOverview = loadOverview;
loadOverview = async function loadOverviewAndSidebar(options = {}) {
  const result = await sidebarBaseLoadOverview(options);
  renderTickerList();
  return result;
};

function updateOverviewFromCurrentSymbol() {
  if (!state.prices?.length || !state.symbol) return;
  const prices = state.prices;
  const last = prices.at(-1);
  const previous = prices.at(-2);
  if (!last || !Number.isFinite(last.close)) return;
  const target = new Date(`${last.date}T00:00:00`);
  target.setDate(target.getDate() - 30);
  const targetDate = toDateInput(target);
  let monthBase = prices[0];
  for (let index = prices.length - 1; index >= 0; index -= 1) {
    if (prices[index].date <= targetDate) { monthBase = prices[index]; break; }
  }
  const week52 = prices.slice(-252);
  const week52High = Math.max(...week52.map((row) => Number(row.high || row.close)).filter(Number.isFinite));
  const item = {
    symbol: state.symbol,
    name: state.meta?.name || state.nameCache[state.symbol] || STOCK_NAMES[state.symbol] || state.symbol,
    initialized: true,
    latest: last.close,
    change1d: previous?.close ? last.close / previous.close - 1 : null,
    change1m: monthBase?.close ? last.close / monthBase.close - 1 : null,
    distance52: week52High ? last.close / week52High - 1 : null,
    lastDate: last.date,
    lastSyncAt: state.storage?.lastSyncAt || null,
    rows: state.storage?.totalStoredRows || prices.length,
    spark: prices.slice(-44).map((row) => row.close).filter(Number.isFinite)
  };
  if (!state.overview) state.overview = { items: [], summary: {} };
  if (!Array.isArray(state.overview.items)) state.overview.items = [];
  const index = state.overview.items.findIndex((entry) => entry.symbol === state.symbol);
  if (index >= 0) state.overview.items[index] = { ...state.overview.items[index], ...item };
  else state.overview.items.push(item);
}

const sidebarBaseLoadSymbol = loadSymbol;
loadSymbol = async function loadSymbolAndRefreshSidebar(symbol, options = {}) {
  const result = await sidebarBaseLoadSymbol(symbol, options);
  updateOverviewFromCurrentSymbol();
  renderTickerList();
  return result;
};
