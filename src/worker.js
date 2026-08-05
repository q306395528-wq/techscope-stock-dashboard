'use strict';

const PRICE_SCHEMA_VERSION = 3;
const APP_VERSION = '4.0.0';
const WATCHLIST_KEY = 'config/watchlist.json';
const CRON_STATUS_KEY = 'config/cron-status.json';
const DEFAULT_WATCHLIST = [
  'TSLA', 'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AVGO',
  'AMD', 'ORCL', 'PLTR', 'NFLX', 'TSM', 'ASML', 'MU', 'CRDO', 'ALAB'
];

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function safeTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker) ? ticker : null;
}

function safeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function shiftDate(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function manifestKey(symbol) {
  return `prices/${symbol}/manifest.json`;
}

function yearKey(symbol, year) {
  return `prices/${symbol}/${year}.json`;
}

function metaKey(symbol) {
  return `meta/${symbol}.json`;
}

function blankManifest(symbol) {
  return {
    schemaVersion: PRICE_SCHEMA_VERSION,
    symbol,
    years: {},
    createdAt: null,
    updatedAt: null,
    lastSyncAt: null,
    lastRequestedEnd: null,
    coveredStart: null,
    coveredEnd: null
  };
}

async function readJson(bucket, key, fallback = null) {
  const object = await bucket.get(key);
  if (!object) return fallback;
  try {
    return await object.json();
  } catch {
    return fallback;
  }
}

async function writeJson(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
}

async function readManifest(env, symbol) {
  const stored = await readJson(env.STOCK_DATA, manifestKey(symbol), null);
  if (!stored || stored.schemaVersion !== PRICE_SCHEMA_VERSION || stored.symbol !== symbol || typeof stored.years !== 'object') {
    return blankManifest(symbol);
  }
  return { ...blankManifest(symbol), ...stored, years: stored.years || {} };
}

function sortedYearNames(manifest) {
  return Object.keys(manifest.years || {}).filter((year) => /^\d{4}$/.test(year)).sort();
}

function manifestTotals(manifest) {
  const years = sortedYearNames(manifest);
  let rows = 0;
  let firstDate = null;
  let lastDate = null;
  for (const year of years) {
    const info = manifest.years[year] || {};
    rows += Number(info.rows || 0);
    if (info.firstDate && (!firstDate || info.firstDate < firstDate)) firstDate = info.firstDate;
    if (info.lastDate && (!lastDate || info.lastDate > lastDate)) lastDate = info.lastDate;
  }
  return { rows, firstDate, lastDate };
}

function mergeRows(existing, incoming) {
  const byDate = new Map();
  for (const row of existing || []) {
    const day = dateOnly(row?.date);
    if (safeDate(day)) byDate.set(day, row);
  }
  for (const row of incoming || []) {
    const day = dateOnly(row?.date);
    if (safeDate(day)) byDate.set(day, row);
  }
  return [...byDate.values()].sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)));
}

function groupRowsByYear(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const day = dateOnly(row?.date);
    if (!safeDate(day)) continue;
    const year = day.slice(0, 4);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(row);
  }
  return grouped;
}

async function mergeRowsIntoStore(env, symbol, manifest, incomingRows) {
  const grouped = groupRowsByYear(incomingRows);
  let addedRows = 0;

  for (const [year, rows] of grouped.entries()) {
    const key = yearKey(symbol, year);
    const existing = await readJson(env.STOCK_DATA, key, []);
    const merged = mergeRows(Array.isArray(existing) ? existing : [], rows);
    addedRows += Math.max(0, merged.length - (Array.isArray(existing) ? existing.length : 0));
    await writeJson(env.STOCK_DATA, key, merged);
    manifest.years[year] = {
      rows: merged.length,
      firstDate: merged.length ? dateOnly(merged[0].date) : null,
      lastDate: merged.length ? dateOnly(merged[merged.length - 1].date) : null,
      updatedAt: new Date().toISOString()
    };
  }

  return addedRows;
}

function yearsBetween(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const years = [];
  for (let year = startYear; year <= endYear; year += 1) years.push(String(year));
  return years;
}

async function loadRangeRows(env, symbol, startDate, endDate) {
  const yearNames = yearsBetween(startDate, endDate);
  const chunks = await Promise.all(yearNames.map((year) => readJson(env.STOCK_DATA, yearKey(symbol, year), [])));
  return chunks
    .flatMap((rows) => Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const day = dateOnly(row?.date);
      return day >= startDate && day <= endDate;
    })
    .sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)));
}

async function requestTiingo(env, apiPath) {
  if (!env.TIINGO_API_TOKEN) {
    const error = new Error('Cloudflare Worker 尚未配置 TIINGO_API_TOKEN。');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://api.tiingo.com${apiPath}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Token ${env.TIINGO_API_TOKEN}`,
      'user-agent': 'TechScope-Cloudflare/4.0'
    }
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { detail: await response.text().catch(() => 'Tiingo 返回了非 JSON 响应。') };
  }

  if (!response.ok) {
    const error = new Error('Tiingo 请求失败。');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function fetchPriceRange(env, symbol, startDate, endDate) {
  const path = `/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&endDate=${endDate}&resampleFreq=daily`;
  const data = await requestTiingo(env, path);
  if (!Array.isArray(data)) {
    const error = new Error('Tiingo 历史价格响应格式不正确。');
    error.status = 502;
    error.payload = data;
    throw error;
  }
  return data;
}

async function readWatchlist(env) {
  const stored = await readJson(env.STOCK_DATA, WATCHLIST_KEY, null);
  const symbols = Array.isArray(stored?.symbols) ? stored.symbols.map(safeTicker).filter(Boolean) : [];
  return {
    symbols: symbols.length ? [...new Set(symbols)] : DEFAULT_WATCHLIST.slice(),
    updatedAt: stored?.updatedAt || null
  };
}

async function ensureWatched(env, symbol) {
  const watchlist = await readWatchlist(env);
  if (watchlist.symbols.includes(symbol)) return watchlist;
  const symbols = [...watchlist.symbols, symbol].slice(0, 60);
  const next = { symbols, updatedAt: new Date().toISOString() };
  await writeJson(env.STOCK_DATA, WATCHLIST_KEY, next);
  return next;
}

function tiingoErrorResponse(error) {
  if (error?.status) {
    return json(error.payload || { error: error.message }, error.status);
  }
  return json({ error: `连接 Tiingo 失败：${error?.message || String(error)}` }, 502);
}

async function handleConfig(env) {
  const cronStatus = env.STOCK_DATA ? await readJson(env.STOCK_DATA, CRON_STATUS_KEY, null) : null;
  return json({
    ready: Boolean(env.TIINGO_API_TOKEN && env.STOCK_DATA),
    tiingoConfigured: Boolean(env.TIINGO_API_TOKEN),
    r2Configured: Boolean(env.STOCK_DATA),
    mode: 'cloudflare-r2',
    syncHours: toPositiveNumber(env.PRICE_SYNC_HOURS, 6),
    metaTtlDays: toPositiveNumber(env.META_TTL_DAYS, 7),
    maxCronStocks: Math.min(40, Math.floor(toPositiveNumber(env.MAX_CRON_STOCKS, 20))),
    version: APP_VERSION,
    accessProtected: Boolean(env.APP_ACCESS_TOKEN),
    cronStatus
  });
}

async function handlePrices(request, env, ctx, url) {
  const symbol = safeTicker(url.searchParams.get('symbol'));
  const startDate = safeDate(url.searchParams.get('startDate'));
  const endDate = safeDate(url.searchParams.get('endDate'));
  const forceRefresh = url.searchParams.get('force') === '1';

  if (!env.STOCK_DATA) return json({ error: 'Cloudflare R2 绑定 STOCK_DATA 尚未配置。' }, 503);
  if (!symbol || !startDate || !endDate) return json({ error: '股票代码或日期格式不正确。' }, 400);
  if (startDate > endDate) return json({ error: '开始日期不能晚于结束日期。' }, 400);

  const manifest = await readManifest(env, symbol);
  const before = manifestTotals(manifest);
  const hasCoverage = Boolean(manifest.coveredStart && manifest.coveredEnd);
  const ranges = [];

  if (!hasCoverage) {
    ranges.push({ start: startDate, end: endDate, reason: 'initial' });
  } else {
    if (startDate < manifest.coveredStart) {
      const oldEnd = shiftDate(manifest.coveredStart, -1);
      if (startDate <= oldEnd) ranges.push({ start: startDate, end: oldEnd, reason: 'older' });
    }

    const syncIntervalMs = toPositiveNumber(env.PRICE_SYNC_HOURS, 6) * 60 * 60 * 1000;
    const syncAge = manifest.lastSyncAt ? Date.now() - new Date(manifest.lastSyncAt).getTime() : Infinity;
    const requestedNewerEnd = endDate > manifest.coveredEnd;
    const recentThreshold = shiftDate(todayUtc(), -7);
    const endIsRecent = endDate >= recentThreshold;
    const lastStored = before.lastDate;

    if (lastStored) {
      const shouldCheckLatest = endDate > lastStored && (
        forceRefresh || requestedNewerEnd || (endIsRecent && syncAge >= syncIntervalMs)
      );
      if (shouldCheckLatest) {
        const newStart = shiftDate(lastStored, 1);
        if (newStart <= endDate) ranges.push({ start: newStart, end: endDate, reason: 'newer' });
      } else if (forceRefresh && endDate >= lastStored) {
        ranges.push({ start: lastStored, end: endDate, reason: 'refresh' });
      }
    } else if (requestedNewerEnd || forceRefresh) {
      ranges.push({ start: startDate, end: endDate, reason: 'initial' });
    }
  }

  let apiRequests = 0;
  let fetchedRows = 0;
  let addedRows = 0;

  try {
    for (const range of ranges) {
      const rows = await fetchPriceRange(env, symbol, range.start, range.end);
      apiRequests += 1;
      fetchedRows += rows.length;
      addedRows += await mergeRowsIntoStore(env, symbol, manifest, rows);
    }
  } catch (error) {
    return tiingoErrorResponse(error);
  }

  const now = new Date().toISOString();
  if (!manifest.createdAt) manifest.createdAt = now;
  manifest.updatedAt = apiRequests > 0 ? now : (manifest.updatedAt || now);
  if (apiRequests > 0) {
    manifest.lastSyncAt = now;
    manifest.lastRequestedEnd = endDate;
  }
  if (ranges.some((range) => range.reason === 'initial' || range.reason === 'older')) {
    manifest.coveredStart = manifest.coveredStart ? (startDate < manifest.coveredStart ? startDate : manifest.coveredStart) : startDate;
  }
  if (ranges.some((range) => ['initial', 'newer', 'refresh'].includes(range.reason))) {
    manifest.coveredEnd = manifest.coveredEnd ? (endDate > manifest.coveredEnd ? endDate : manifest.coveredEnd) : endDate;
  }

  if (apiRequests > 0 || !hasCoverage) await writeJson(env.STOCK_DATA, manifestKey(symbol), manifest);
  const rows = await loadRangeRows(env, symbol, startDate, endDate);
  const after = manifestTotals(manifest);

  return json({
    symbol,
    prices: rows,
    fetchedAt: now,
    _storage: {
      source: apiRequests > 0 ? 'r2+api' : 'r2',
      apiRequests,
      fetchedRows,
      addedRows,
      totalStoredRows: after.rows,
      storedFirst: after.firstDate,
      storedLast: after.lastDate,
      coveredStart: manifest.coveredStart,
      coveredEnd: manifest.coveredEnd,
      lastSyncAt: manifest.lastSyncAt,
      storage: 'Cloudflare R2',
      objectPrefix: `prices/${symbol}/`
    }
  });
}

async function handleMeta(env, url) {
  const symbol = safeTicker(url.searchParams.get('symbol'));
  if (!env.STOCK_DATA) return json({ error: 'Cloudflare R2 绑定 STOCK_DATA 尚未配置。' }, 503);
  if (!symbol) return json({ error: '股票代码格式不正确。' }, 400);

  const key = metaKey(symbol);
  const cached = await readJson(env.STOCK_DATA, key, null);
  const ttlMs = toPositiveNumber(env.META_TTL_DAYS, 7) * 24 * 60 * 60 * 1000;
  const fresh = cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < ttlMs;
  if (cached?.data && fresh) return json(cached.data);

  try {
    const data = await requestTiingo(env, `/tiingo/daily/${encodeURIComponent(symbol)}`);
    await writeJson(env.STOCK_DATA, key, { symbol, fetchedAt: new Date().toISOString(), data });
    return json(data);
  } catch (error) {
    if (cached?.data) return json(cached.data, 200, { 'x-techscope-stale': '1' });
    return tiingoErrorResponse(error);
  }
}

async function handleWatchlist(request, env) {
  if (!env.STOCK_DATA) return json({ error: 'Cloudflare R2 绑定 STOCK_DATA 尚未配置。' }, 503);
  if (request.method === 'GET') return json(await readWatchlist(env));
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, PUT' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求体必须是 JSON。' }, 400);
  }
  const symbols = Array.isArray(body?.symbols)
    ? [...new Set(body.symbols.map(safeTicker).filter(Boolean))].slice(0, 60)
    : [];
  if (!symbols.length) return json({ error: '自选股至少保留一只。' }, 400);
  const next = { symbols, updatedAt: new Date().toISOString() };
  await writeJson(env.STOCK_DATA, WATCHLIST_KEY, next);
  return json(next);
}

async function handleTest(env) {
  try {
    const data = await requestTiingo(env, '/api/test/');
    return json({ ok: true, tiingo: data });
  } catch (error) {
    return tiingoErrorResponse(error);
  }
}

async function syncLatestSymbol(env, symbol, endDate) {
  const manifest = await readManifest(env, symbol);
  const totals = manifestTotals(manifest);
  if (!totals.lastDate) return { symbol, skipped: true, reason: 'not_initialized' };

  try {
    const rows = await fetchPriceRange(env, symbol, totals.lastDate, endDate);
    const addedRows = await mergeRowsIntoStore(env, symbol, manifest, rows);
    const now = new Date().toISOString();
    manifest.updatedAt = now;
    manifest.lastSyncAt = now;
    manifest.lastRequestedEnd = endDate;
    manifest.coveredEnd = manifest.coveredEnd ? (endDate > manifest.coveredEnd ? endDate : manifest.coveredEnd) : endDate;
    await writeJson(env.STOCK_DATA, manifestKey(symbol), manifest);
    return { symbol, ok: true, fetchedRows: rows.length, addedRows };
  } catch (error) {
    return {
      symbol,
      ok: false,
      status: error?.status || 502,
      error: error?.payload?.detail || error?.payload?.error || error?.message || String(error)
    };
  }
}

async function runScheduledSync(env) {
  if (!env.STOCK_DATA || !env.TIINGO_API_TOKEN) return;
  const watchlist = await readWatchlist(env);
  const max = Math.min(40, Math.floor(toPositiveNumber(env.MAX_CRON_STOCKS, 20)));
  const symbols = watchlist.symbols.slice(0, max);
  const endDate = todayUtc();
  const results = [];

  for (let index = 0; index < symbols.length; index += 3) {
    const batch = symbols.slice(index, index + 3);
    results.push(...await Promise.all(batch.map((symbol) => syncLatestSymbol(env, symbol, endDate))));
  }

  const status = {
    ranAt: new Date().toISOString(),
    endDate,
    attempted: symbols.length,
    updated: results.filter((item) => item.ok).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => item.ok === false).length,
    results
  };
  await writeJson(env.STOCK_DATA, CRON_STATUS_KEY, status);
}

async function handleApi(request, env, ctx, url) {
  if (url.pathname === '/api/config' && request.method === 'GET') return handleConfig(env);
  if (url.pathname === '/api/test' && request.method === 'GET') return handleTest(env);
  if (url.pathname === '/api/prices' && request.method === 'GET') return handlePrices(request, env, ctx, url);
  if (url.pathname === '/api/meta' && request.method === 'GET') return handleMeta(env, url);
  if (url.pathname === '/api/watchlist') return handleWatchlist(request, env);
  return json({ error: 'API endpoint not found.' }, 404);
}

function timingSafeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function apiAuthorized(request, env) {
  if (!env.APP_ACCESS_TOKEN) return true;
  return timingSafeEqual(request.headers.get('x-techscope-key'), env.APP_ACCESS_TOKEN);
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=300');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!apiAuthorized(request, env)) return json({ error: '需要正确的 TechScope 访问口令。' }, 401);
      return handleApi(request, env, ctx, url);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledSync(env));
  }
};

export {
  blankManifest,
  dateOnly,
  manifestTotals,
  mergeRows,
  runScheduledSync,
  safeDate,
  safeTicker,
  shiftDate
};
