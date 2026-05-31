import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { writeBuffer, FLUSH_INTERVAL_MS } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 'test-secret-token';
const NS = 'test.example.com';

/** Unique counter key per call to avoid cross-test buffer pollution */
let _seq = 0;
const uid = () => `key-${++_seq}`;

function createKV() {
  const store = new Map();
  let writeCalls = 0;
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => { store.set(key, value); writeCalls++; },
    list: async () => ({ keys: [...store.keys()].map(name => ({ name })) }),
    getWriteCalls: () => writeCalls,
    getStore: () => store,
  };
}

function makeEnv(kv) {
  return { COUNTERS: kv, SEED_TOKEN: TOKEN };
}

function makeCtx() {
  return { waitUntil: () => {} };
}

async function fetch(path, { method = 'GET', env, ctx } = {}) {
  const req = new Request(`https://counter.example.com${path}`, { method });
  return worker.fetch(req, env, ctx ?? makeCtx());
}

async function json(path, opts) {
  const res = await fetch(path, opts);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe('CORS preflight', () => {
  it('returns 204 with CORS headers for OPTIONS', async () => {
    const kv = createKV();
    const res = await fetch('/api/ns/views/key', { method: 'OPTIONS', env: makeEnv(kv) });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('includes CORS headers on normal responses', async () => {
    const kv = createKV();
    const res = await fetch('/health', { env: makeEnv(kv) });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns ok:true and worker name', async () => {
    const kv = createKV();
    const { status, body } = await json('/health', { env: makeEnv(kv) });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.worker).toBe('counter');
    expect(typeof body.ts).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe('unknown paths', () => {
  it('returns 404 for unrecognised routes', async () => {
    const kv = createKV();
    const { status } = await json('/not-a-real-path', { env: makeEnv(kv) });
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// View counter — basic increment & readOnly
// ---------------------------------------------------------------------------

describe('GET /api/:ns/views/:key', () => {
  it('starts at 0 and increments on each request', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    const r1 = await json(`/api/${NS}/views/${key}`, { env });
    expect(r1.body.value).toBe(1);

    const r2 = await json(`/api/${NS}/views/${key}`, { env });
    expect(r2.body.value).toBe(2);

    const r3 = await json(`/api/${NS}/views/${key}`, { env });
    expect(r3.body.value).toBe(3);
  });

  it('returns the eye SVG', async () => {
    const kv = createKV();
    const { body } = await json(`/api/${NS}/views/${uid()}`, { env: makeEnv(kv) });
    expect(body.iconSvg).toContain('<svg');
    expect(body.iconSvg).toContain('512');   // viewBox
    expect(body.iconSvg).toContain('circle'); // eye has a circle pupil
  });

  it('readOnly=true returns current value without incrementing', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    // First, make a real view to set a value
    await json(`/api/${NS}/views/${key}`, { env });
    const before = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });

    // readOnly multiple times — count should not grow
    const r2 = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    const r3 = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });

    expect(r2.body.value).toBe(before.body.value);
    expect(r3.body.value).toBe(before.body.value);
  });

  it('returns an embeddable SVG badge when format=svg', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    const res = await fetch(`/api/${NS}/views/${key}?format=svg&label=repo%20views`, { env });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(body).toContain('<svg');
    expect(body).toContain('repo views');
    expect(body).toContain('1');

    const current = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    expect(current.body.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Like counter — icons and readOnly
// ---------------------------------------------------------------------------

describe('GET /api/:ns/vote/:key', () => {
  it('returns outline heart SVG when readOnly=true', async () => {
    const kv = createKV();
    const { body } = await json(`/api/${NS}/vote/${uid()}?readOnly=true`, { env: makeEnv(kv) });
    // Outline heart: uses stroke and fill='none'
    expect(body.iconSvg).toContain('stroke');
    expect(body.iconSvg).toContain("fill='none'");
  });

  it('returns filled heart SVG when voting (no readOnly)', async () => {
    const kv = createKV();
    const { body } = await json(`/api/${NS}/vote/${uid()}`, { env: makeEnv(kv) });
    expect(body.iconSvg).not.toContain("fill='none'");
    expect(body.iconSvg).toContain('<svg');
  });

  it('increments on vote, not on readOnly', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    // Two readOnly fetches — value stays 0
    const r1 = await json(`/api/${NS}/vote/${key}?readOnly=true`, { env });
    const r2 = await json(`/api/${NS}/vote/${key}?readOnly=true`, { env });
    expect(r1.body.value).toBe(0);
    expect(r2.body.value).toBe(0);

    // Vote — increments to 1
    const r3 = await json(`/api/${NS}/vote/${key}`, { env });
    expect(r3.body.value).toBe(1);

    // Another readOnly — still 1
    const r4 = await json(`/api/${NS}/vote/${key}?readOnly=true`, { env });
    expect(r4.body.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Write buffer — KV writes are batched
// ---------------------------------------------------------------------------

describe('write buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeBuffer.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    writeBuffer.clear();
  });

  it('only writes to KV once within a 2-minute window regardless of view count', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();
    const path = `/api/${NS}/views/${key}`;

    // Fire many requests within the same 2-minute window
    for (let i = 0; i < 50; i++) {
      await json(path, { env });
    }

    // Only the first request (which initialises the buffer with lastFlush=now)
    // triggers a flush. Subsequent requests within the window skip the write.
    // KV writes should be 1 (the initial flush that bootstraps the buffer entry).
    expect(kv.getWriteCalls()).toBeLessThanOrEqual(1);

    // Display value should still be accurate
    const { body } = await json(`${path}?readOnly=true`, { env });
    expect(body.value).toBe(50);
  });

  it('flushes to KV after the 2-minute interval elapses', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();
    const path = `/api/${NS}/views/${key}`;

    // First request — initialises buffer (lastFlush = now)
    await json(path, { env });
    const writesBefore = kv.getWriteCalls();

    // Advance time past the flush interval
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS + 1);

    // Next request crosses the threshold — should flush
    await json(path, { env });
    expect(kv.getWriteCalls()).toBeGreaterThan(writesBefore);
  });

  it('no requests in any time window produces zero KV writes', async () => {
    const kv = createKV();
    writeBuffer.clear();

    // Advance well past the flush interval without making any requests
    vi.advanceTimersByTime(10 * FLUSH_INTERVAL_MS); // 20 minutes

    expect(kv.getWriteCalls()).toBe(0);
  });

  it('50 requests in 3rd-4th minute: timer flushes once by minute 5 and counter still shows 50', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();
    writeBuffer.clear();

    // --- Minutes 1-2: silence ---
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(kv.getWriteCalls()).toBe(0); // idle = no writes

    // --- Start of 3rd minute (t = 2min) ---
    vi.advanceTimersByTime(60 * 1000); // t = 3min

    // 50 view requests arrive in the 3rd-4th minute window.
    // The first request starts one 2-minute flush timer.
    // All 50 land before the timer fires → no flush yet, 0 KV writes.
    for (let i = 0; i < 50; i++) {
      await json(`/api/${NS}/views/${key}`, { env });
    }

    // --- End of 4th minute (t = 4min) ---
    vi.advanceTimersByTime(60 * 1000); // t = 4min

    // readOnly check shows full 50 (stored=0 + pending=50).
    // Still 0 KV writes — the timer has not fired yet.
    const atMin4 = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    expect(atMin4.body.value).toBe(50);
    expect(kv.getWriteCalls()).toBe(0);

    // --- 5th minute (t = 5min, i.e. 2 min since the burst started) ---
    vi.advanceTimersByTime(60 * 1000 + 1); // t = 5min+1ms — past the flush threshold

    // The one-shot timer has fired by the 5th minute, so the full batch is durable.
    // readOnly still shows 50, now from KV rather than from pending memory.
    const atMin5readOnly = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    expect(atMin5readOnly.body.value).toBe(50);
    expect(kv.getWriteCalls()).toBe(1); // 50 requests → 1 write, not 50
  });

  it('display value includes in-flight pending even before a flush', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();
    const path = `/api/${NS}/views/${key}`;

    // Accumulate without flushing
    for (let i = 0; i < 10; i++) {
      await json(path, { env });
    }

    // readOnly should reflect the full pending count
    const { body } = await json(`${path}?readOnly=true`, { env });
    expect(body.value).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Seed endpoint
// ---------------------------------------------------------------------------

describe('POST /seed/:ns/:type/:key', () => {
  it('sets counter to the given value', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    const r = await json(`/seed/${NS}/views/${key}?value=500&token=${TOKEN}`, {
      method: 'POST', env,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.value).toBe(500);

    // Subsequent read returns seeded value
    const { body } = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    expect(body.value).toBe(500);
  });

  it('returns 403 without a valid token', async () => {
    const kv = createKV();
    const { status } = await json(`/seed/${NS}/views/${uid()}?value=100&token=wrong`, {
      method: 'POST', env: makeEnv(kv),
    });
    expect(status).toBe(403);
  });

  it('clears any in-memory pending for the seeded key', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();
    writeBuffer.clear();

    // Accumulate some pending views
    for (let i = 0; i < 5; i++) {
      await json(`/api/${NS}/views/${key}`, { env });
    }

    // Seed overrides everything
    await json(`/seed/${NS}/views/${key}?value=999&token=${TOKEN}`, { method: 'POST', env });

    const { body } = await json(`/api/${NS}/views/${key}?readOnly=true`, { env });
    expect(body.value).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Debug endpoint
// ---------------------------------------------------------------------------

describe('GET /debug/:ns/:type/:key', () => {
  beforeEach(() => { writeBuffer.clear(); });
  afterEach(() => { writeBuffer.clear(); });

  it('returns stored and pending values separately', async () => {
    const kv = createKV();
    const env = makeEnv(kv);
    const key = uid();

    vi.useFakeTimers();

    // Accumulate 3 views without a flush
    for (let i = 0; i < 3; i++) {
      await json(`/api/${NS}/views/${key}`, { env });
    }

    const { body } = await json(`/debug/${NS}/views/${key}?token=${TOKEN}`, { env });
    expect(body.displayValue).toBe(3);
    expect(typeof body.stored).toBe('number');
    expect(typeof body.pending).toBe('number');
    expect(body.stored + body.pending).toBe(3);

    vi.useRealTimers();
  });

  it('returns 403 without a valid token', async () => {
    const kv = createKV();
    const { status } = await json(`/debug/${NS}/views/${uid()}?token=bad`, {
      env: makeEnv(kv),
    });
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Export endpoint
// ---------------------------------------------------------------------------

describe('GET /export', () => {
  it('returns all counters as a flat object', async () => {
    const kv = createKV();
    const env = makeEnv(kv);

    // Seed two known values directly into KV
    await kv.put('views:test.example.com:page-a', '42');
    await kv.put('vote:test.example.com:page-a', '7');

    const { status, body } = await json(`/export?token=${TOKEN}`, { env });
    expect(status).toBe(200);
    expect(body.exported['views:test.example.com:page-a']).toBe(42);
    expect(body.exported['vote:test.example.com:page-a']).toBe(7);
    expect(body.count).toBeGreaterThanOrEqual(2);
  });

  it('returns 403 without a valid token', async () => {
    const kv = createKV();
    const { status } = await json('/export?token=wrong', { env: makeEnv(kv) });
    expect(status).toBe(403);
  });
});
