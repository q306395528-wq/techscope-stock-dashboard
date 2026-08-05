import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { mergeRows, safeDate, safeTicker } from '../src/worker.js';

class MemoryR2 {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key);
    return {
      async json() {
        return JSON.parse(value);
      }
    };
  }

  async put(key, value) {
    this.map.set(key, typeof value === 'string' ? value : await new Response(value).text());
  }
}

function createEnv() {
  return {
    TIINGO_API_TOKEN: 'test-token',
    STOCK_DATA: new MemoryR2(),
    PRICE_SYNC_HOURS: '6',
    META_TTL_DAYS: '7',
    MAX_CRON_STOCKS: '20',
    ASSETS: { fetch: async () => new Response('asset') }
  };
}

async function callApi(env, path, options = {}) {
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
  const response = await worker.fetch(new Request(`https://example.com${path}`, options), env, ctx);
  await Promise.all(pending);
  return { response, data: await response.json() };
}

test('ticker and date validation', () => {
  assert.equal(safeTicker(' tsla '), 'TSLA');
  assert.equal(safeTicker('../TSLA'), null);
  assert.equal(safeDate('2026-08-05'), '2026-08-05');
  assert.equal(safeDate('2026-02-30'), null);
});

test('mergeRows replaces duplicate dates and sorts ascending', () => {
  const result = mergeRows(
    [{ date: '2025-01-03T00:00:00Z', close: 1 }, { date: '2025-01-02T00:00:00Z', close: 1 }],
    [{ date: '2025-01-03T00:00:00Z', close: 2 }]
  );
  assert.deepEqual(result.map((row) => [row.date.slice(0, 10), row.close]), [
    ['2025-01-02', 1],
    ['2025-01-03', 2]
  ]);
});

test('R2 cache downloads only missing history ranges', async (t) => {
  const env = createEnv();
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push({ start: url.searchParams.get('startDate'), end: url.searchParams.get('endDate') });
    const start = url.searchParams.get('startDate');
    const end = url.searchParams.get('endDate');
    const rows = [];
    if (start <= '2016-01-04' && end >= '2016-01-04') rows.push({ date: '2016-01-04T00:00:00.000Z', open: 10, high: 11, low: 9, close: 10, volume: 100 });
    if (start <= '2024-12-31' && end >= '2024-12-31') rows.push({ date: '2024-12-31T00:00:00.000Z', open: 20, high: 21, low: 19, close: 20, volume: 200 });
    if (start <= '2025-01-02' && end >= '2025-01-02') rows.push({ date: '2025-01-02T00:00:00.000Z', open: 21, high: 22, low: 20, close: 21, volume: 210 });
    if (start <= '2025-12-30' && end >= '2025-12-30') rows.push({ date: '2025-12-30T00:00:00.000Z', open: 30, high: 31, low: 29, close: 30, volume: 300 });
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  t.after(() => { globalThis.fetch = originalFetch; });

  const first = await callApi(env, '/api/prices?symbol=TSLA&startDate=2025-01-01&endDate=2025-12-31');
  assert.equal(first.response.status, 200);
  assert.equal(first.data._storage.apiRequests, 1);
  assert.equal(first.data._storage.addedRows, 2);
  assert.equal(calls.length, 1);

  const repeated = await callApi(env, '/api/prices?symbol=TSLA&startDate=2025-01-01&endDate=2025-12-31');
  assert.equal(repeated.data._storage.apiRequests, 0);
  assert.equal(calls.length, 1);

  const longer = await callApi(env, '/api/prices?symbol=TSLA&startDate=2016-01-01&endDate=2025-12-31');
  assert.equal(longer.data._storage.apiRequests, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { start: '2016-01-01', end: '2024-12-31' });
  assert.equal(longer.data.prices.length, 4);

  const longerAgain = await callApi(env, '/api/prices?symbol=TSLA&startDate=2016-01-01&endDate=2025-12-31');
  assert.equal(longerAgain.data._storage.apiRequests, 0);
  assert.equal(calls.length, 2);

  assert.ok(env.STOCK_DATA.map.has('prices/TSLA/manifest.json'));
  assert.ok(env.STOCK_DATA.map.has('prices/TSLA/2016.json'));
  assert.ok(env.STOCK_DATA.map.has('prices/TSLA/2025.json'));
});

test('config reports secret and R2 readiness without exposing secret', async () => {
  const env = createEnv();
  const { data } = await callApi(env, '/api/config');
  assert.equal(data.ready, true);
  assert.equal(data.tiingoConfigured, true);
  assert.equal(data.r2Configured, true);
  assert.equal(data.version, '4.0.0');
  assert.equal(data.accessProtected, false);
  assert.equal(JSON.stringify(data).includes('test-token'), false);
});

test('optional access token protects API without exposing the secret', async () => {
  const env = createEnv();
  env.APP_ACCESS_TOKEN = 'private-code';

  const blocked = await callApi(env, '/api/config');
  assert.equal(blocked.response.status, 401);

  const allowed = await callApi(env, '/api/config', { headers: { 'x-techscope-key': 'private-code' } });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.data.accessProtected, true);
  assert.equal(JSON.stringify(allowed.data).includes('private-code'), false);
});

test('watchlist can be explicitly updated and price queries do not auto-add symbols', async (t) => {
  const env = createEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { date: '2026-01-02T00:00:00.000Z', open: 10, high: 11, low: 9, close: 10, volume: 100 },
    { date: '2026-01-05T00:00:00.000Z', open: 11, high: 12, low: 10, close: 11, volume: 110 }
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { globalThis.fetch = originalFetch; });

  await callApi(env, '/api/prices?symbol=IONQ&startDate=2026-01-01&endDate=2026-01-10');
  const initial = await callApi(env, '/api/watchlist');
  assert.equal(initial.data.symbols.includes('IONQ'), false);

  const updated = await callApi(env, '/api/watchlist', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbols: ['TSLA', 'IONQ'] })
  });
  assert.deepEqual(updated.data.symbols, ['TSLA', 'IONQ']);
});
