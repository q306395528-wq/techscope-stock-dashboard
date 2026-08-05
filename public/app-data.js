function normalizeTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker) ? ticker : '';
}

function setRange(range, shouldLoad) {
  state.range = range;
  const end = new Date();
  const start = new Date(end);
  if (range === '1M') start.setMonth(start.getMonth() - 1);
  if (range === '3M') start.setMonth(start.getMonth() - 3);
  if (range === '6M') start.setMonth(start.getMonth() - 6);
  if (range === '1Y') start.setFullYear(start.getFullYear() - 1);
  if (range === '3Y') start.setFullYear(start.getFullYear() - 3);
  if (range === '5Y') start.setFullYear(start.getFullYear() - 5);
  if (range === '10Y') start.setFullYear(start.getFullYear() - 10);
  if (range === 'MAX') {
    const earliest = state.meta?.startDate ? new Date(`${String(state.meta.startDate).slice(0, 10)}T00:00:00`) : null;
    if (earliest && Number.isFinite(earliest.getTime())) start.setTime(earliest.getTime());
    else start.setFullYear(1960, 0, 1);
  }
  els.startDate.value = toDateInput(start);
  els.endDate.value = toDateInput(end);
  [...els.rangeGroup.querySelectorAll('button')].forEach((button) => button.classList.toggle('active', button.dataset.range === range));
  if (shouldLoad) loadSymbol(state.symbol);
}

function setCustomRangeState() {
  state.range = 'CUSTOM';
  [...els.rangeGroup.querySelectorAll('button')].forEach((button) => button.classList.remove('active'));
}

async function loadSymbol(symbol, options = {}) {
  symbol = normalizeTicker(symbol);
  if (!symbol) return;
  if (!state.cloudConfig?.ready) { showEmptyState(); openApiModal(); return; }
  if (!els.startDate.value || !els.endDate.value) setRange('5Y', false);

  state.symbol = symbol;
  state.pointerIndex = null;
  state.meta = null;
  renderTickerList();
  els.symbolTitle.textContent = symbol;
  els.companyName.textContent = '正在读取公司信息…';
  els.exchangeName.textContent = '—';
  setLoading(els.chartLoading, true);
  els.queryButton.disabled = true;
  showDashboard();
  resetComparison();

  try {
    const metaPromise = apiFetch(`/api/meta?symbol=${encodeURIComponent(symbol)}`).catch(() => null);
    let meta = null;
    if (state.range === 'MAX') {
      meta = await metaPromise;
      const start = String(meta?.startDate || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) els.startDate.value = start;
    }
    const pricePayload = await apiFetch(`/api/prices?symbol=${encodeURIComponent(symbol)}&startDate=${els.startDate.value}&endDate=${els.endDate.value}${options.force ? '&force=1' : ''}`);
    if (!meta) meta = await metaPromise;
    const prices = normalizePrices(pricePayload.prices || []);
    if (prices.length < 2) throw new Error('该时间范围内没有足够的历史价格数据。');

    state.prices = prices;
    state.meta = meta;
    state.storage = pricePayload._storage || null;
    if (meta?.name) {
      state.nameCache[symbol] = meta.name;
      localStorage.setItem(NAME_CACHE_KEY, JSON.stringify(state.nameCache));
      renderTickerList();
    }
    updateHeader();
    updateMetrics();
    renderAnnualReturns();
    drawAllCharts();
    updateStorageStatus();
    if (state.storage?.apiRequests > 0) {
      const added = state.storage.addedRows || 0;
      showToast(added > 0 ? `从 Tiingo 补充 ${added} 个交易日，已写入 R2。` : '已检查 Tiingo，目前没有新增交易日。', 'success');
    }
  } catch (error) {
    state.prices = [];
    clearDashboardValues();
    if (error.status !== 401) showToast(error.message, 'error');
  } finally {
    setLoading(els.chartLoading, false);
    els.queryButton.disabled = false;
  }
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (accessToken) headers.set('x-techscope-key', accessToken);
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(apiErrorMessage(data, response.status));
    error.status = response.status;
    if (response.status === 401) {
      localStorage.removeItem(ACCESS_KEY);
      openAccessModal();
    }
    if (response.status === 503) {
      state.cloudConfig = { ...(state.cloudConfig || {}), ready: false };
      updateApiState();
      openApiModal();
    }
    throw error;
  }
  return data;
}

function updateStorageStatus() {
  const info = state.storage;
  if (!info) {
    els.localStoreStatus.textContent = 'R2 云端仓库：暂无信息';
    return;
  }
  const range = info.storedFirst && info.storedLast ? `${info.storedFirst} 至 ${info.storedLast}` : '暂无数据';
  els.localStoreStatus.textContent = `R2 ${state.symbol}：${Number(info.totalStoredRows || 0).toLocaleString()}条 · ${range}`;
  const fromApi = Number(info.apiRequests || 0) > 0;
  setBadge(els.sourceBadge, fromApi ? 'R2 + Tiingo增量' : '直接读取 R2', fromApi ? 'warn' : 'good');
  setBadge(els.apiBadge, `本次 API ${info.apiRequests || 0}次`, fromApi ? 'warn' : 'good');
  setBadge(els.rowsBadge, `本地 ${Number(info.totalStoredRows || 0).toLocaleString()}条`, '');
  setBadge(els.updatedBadge, info.lastSyncAt ? `同步 ${formatDateTime(info.lastSyncAt)}` : '尚未同步', '');
}

function setBadge(element, text, tone) {
  element.textContent = text;
  element.className = `status-pill ${tone || ''}`;
}

function apiErrorMessage(data, status) {
  const raw = data?.error || data?.detail || data?.message || (Array.isArray(data) ? data[0]?.message : '');
  if (status === 401) return '需要正确的访问口令。';
  if (status === 403) return '当前访问没有权限。';
  if (status === 404) return 'Tiingo 中未找到这个股票代码。';
  if (status === 429) return '请求过于频繁，已触发 Tiingo 限流，请稍后再试。';
  if (status === 503) return typeof raw === 'string' && raw ? raw : 'Cloudflare 尚未配置 Tiingo Secret 或 R2。';
  if (typeof raw === 'string' && raw) return raw;
  return `请求失败（HTTP ${status}）。`;
}

function normalizePrices(rows) {
  return rows.map((row) => ({
    date: String(row.date).slice(0, 10),
    open: numberOr(row.adjOpen, row.open), high: numberOr(row.adjHigh, row.high), low: numberOr(row.adjLow, row.low), close: numberOr(row.adjClose, row.close),
    rawClose: Number(row.close), volume: numberOr(row.adjVolume, row.volume), dividend: Number(row.divCash || 0), split: Number(row.splitFactor || 1)
  })).filter((row) => row.date && Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
}
function numberOr(primary, fallback) { const first = Number(primary); return Number.isFinite(first) ? first : Number(fallback); }

function updateHeader() {
  const first = state.prices[0];
  const last = state.prices.at(-1);
  const change = last.close / first.close - 1;
  els.companyName.textContent = state.meta?.name || state.nameCache[state.symbol] || STOCK_NAMES[state.symbol] || state.symbol;
  els.exchangeName.textContent = state.meta?.exchangeCode || 'US';
  els.latestPrice.textContent = currency(last.close);
  els.periodChange.textContent = `${formatPercent(change)} · ${first.date} 至 ${last.date}`;
  setValueTone(els.periodChange, change);
  const sourceText = state.storage?.apiRequests > 0 ? `Tiingo API ${state.storage.apiRequests}次` : 'R2本地命中';
  els.chartCaption.textContent = `复权日线 · ${state.prices.length.toLocaleString()}个交易日 · ${sourceText}`;
  updateWatchToggle();
}

function calculateMetrics() {
  const prices = state.prices;
  const first = prices[0];
  const last = prices.at(-1);
  const totalReturn = last.close / first.close - 1;
  const years = Math.max((new Date(last.date) - new Date(first.date)) / (365.25 * 86400000), 1 / 365.25);
  const cagr = Math.pow(last.close / first.close, 1 / years) - 1;
  const returns = [];
  let peak = first.close;
  let maxDrawdown = 0;
  let maxDdStart = first.date;
  let maxDdEnd = first.date;
  let currentPeakDate = first.date;
  let high = first;
  let low = first;
  const drawdowns = [];

  prices.forEach((row, index) => {
    if (row.close > peak) { peak = row.close; currentPeakDate = row.date; }
    const drawdown = row.close / peak - 1;
    drawdowns.push({ date: row.date, value: drawdown });
    if (drawdown < maxDrawdown) { maxDrawdown = drawdown; maxDdStart = currentPeakDate; maxDdEnd = row.date; }
    if (row.high > high.high) high = row;
    if (row.low < low.low) low = row;
    if (index > 0) returns.push(row.close / prices[index - 1].close - 1);
  });

  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(returns.length - 1, 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  const currentDrawdown = drawdowns.at(-1)?.value || 0;
  const week52Rows = prices.slice(-252);
  const week52High = week52Rows.reduce((best, row) => row.high > best.high ? row : best, week52Rows[0]);
  const distance52 = last.close / week52High.high - 1;
  return { totalReturn, cagr, maxDrawdown, maxDdStart, maxDdEnd, currentDrawdown, volatility, high, low, drawdowns, week52High, distance52 };
}

function updateMetrics() {
  const m = calculateMetrics();
  els.metricReturn.textContent = formatPercent(m.totalReturn);
  els.metricReturnSub.textContent = `${state.prices[0].date} → ${state.prices.at(-1).date}`;
  els.metricCagr.textContent = formatPercent(m.cagr);
  els.metricDrawdown.textContent = formatPercent(m.maxDrawdown);
  els.metricDrawdownSub.textContent = `${m.maxDdStart} → ${m.maxDdEnd}`;
  els.metricCurrentDrawdown.textContent = formatPercent(m.currentDrawdown);
  els.metricVolatility.textContent = formatPercent(m.volatility);
  els.metric52Week.textContent = formatPercent(m.distance52);
  els.metric52WeekSub.textContent = `高点 ${currency(m.week52High.high)}`;
  els.metricHigh.textContent = currency(m.high.high);
  els.metricHighSub.textContent = m.high.date;
  els.metricLow.textContent = currency(m.low.low);
  els.metricLowSub.textContent = m.low.date;
  setValueTone(els.metricReturn, m.totalReturn);
  setValueTone(els.metricCagr, m.cagr);
  setValueTone(els.metricDrawdown, m.maxDrawdown);
  setValueTone(els.metricCurrentDrawdown, m.currentDrawdown);
  setValueTone(els.metric52Week, m.distance52);
}

function annualReturnData() {
  const yearEnds = [];
  let currentYear = '';
  state.prices.forEach((row) => {
    const year = row.date.slice(0, 4);
    if (year !== currentYear) { currentYear = year; yearEnds.push({ year, first: row.close, last: row.close }); }
    else yearEnds.at(-1).last = row.close;
  });
  return yearEnds.map((item, index) => ({
    year: item.year,
    value: index === 0 ? item.last / item.first - 1 : item.last / yearEnds[index - 1].last - 1
  })).reverse();
}

function renderAnnualReturns() {
  const data = annualReturnData();
  const maxAbs = Math.max(...data.map((item) => Math.abs(item.value)), .01);
  els.annualReturns.innerHTML = data.map((item) => {
    const width = Math.max(2, Math.abs(item.value) / maxAbs * 100);
    return `<div class="annual-row"><span class="year">${item.year}</span><div class="return-track"><div class="return-bar ${item.value >= 0 ? 'positive-bar' : 'negative-bar'}" style="width:${width}%"></div></div><span class="annual-value ${item.value >= 0 ? 'positive' : 'negative'}">${formatPercent(item.value)}</span></div>`;
  }).join('');
}

function setChartMode(mode) {
  state.chartMode = mode;
  els.lineMode.classList.toggle('active', mode === 'line');
  els.candleMode.classList.toggle('active', mode === 'candle');
  drawPriceChart();
}

function setupCanvas(canvas, drawFn) {
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height; canvas._ratio = ratio; drawFn();
    }
  });
  observer.observe(canvas);
}

function canvasContext(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = canvas._ratio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: canvas.width / ratio, height: canvas.height / ratio };
}

function drawAllCharts() { drawPriceChart(); drawDrawdownChart(); drawCompareChart(); }
