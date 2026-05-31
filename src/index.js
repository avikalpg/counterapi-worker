// Eye SVG — exact Ionicon from archived CounterAPI responses, sized with 1em
const EYE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 512 512'><circle cx='256' cy='256' r='64'/><path d='M490.84 238.6c-26.46-40.92-60.79-75.68-99.27-100.53C349 110.55 302 96 255.66 96c-42.52 0-84.33 12.15-124.27 36.11-40.73 24.43-77.63 60.12-109.68 106.07a31.92 31.92 0 00-.64 35.54c26.41 41.33 60.4 76.14 98.28 100.65C162 402 207.9 416 255.66 416c46.71 0 93.81-14.43 136.2-41.72 38.46-24.77 72.72-59.66 99.08-100.92a32.2 32.2 0 00-.1-34.76zM256 352a96 96 0 1196-96 96.11 96.11 0 01-96 96z'/></svg>`;

// Filled heart — exact Ionicon from archived CounterAPI responses (shown after liking)
const HEART_FILLED_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 512 512'><path d='M256 448a32 32 0 01-18-5.57c-78.59-53.35-112.62-89.93-131.39-112.8-40-48.75-59.15-98.8-58.61-153C48.63 114.52 98.46 64 159.08 64c44.08 0 74.61 24.83 92.39 45.51a6 6 0 009.06 0C278.31 88.81 308.84 64 352.92 64c60.62 0 110.45 50.52 111.08 112.64.54 54.21-18.63 104.26-58.61 153-18.77 22.87-52.8 59.45-131.39 112.8a32 32 0 01-18 5.56z'/></svg>`;

// Outline heart — Ionicon heart-outline style (shown before liking)
const HEART_OUTLINE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 512 512'><path d='M352.92 80C288 80 256 144 256 144s-32-64-96.92-64c-52.76 0-94.54 44.14-95.08 96.81-1.1 109.33 86.73 187.08 190 252.39a32 32 0 0036 0C394.27 363.89 482.1 286.14 481 176.81c-.54-52.67-42.32-96.81-95.08-96.81z' fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='32'/></svg>`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check: GET /health
    if (path === '/health') {
      return new Response(
        JSON.stringify({ ok: true, ts: Date.now(), worker: 'counter' }),
        { headers: CORS_HEADERS }
      );
    }

    // Export all counter data: GET /export?token=...
    if (path === '/export') {
      if (url.searchParams.get('token') !== env.SEED_TOKEN) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS_HEADERS });
      }
      const list = await env.COUNTERS.list();
      const data = {};
      for (const key of list.keys) {
        data[key.name] = parseInt(await env.COUNTERS.get(key.name) || '0', 10);
      }
      return new Response(JSON.stringify({ exported: data, count: list.keys.length }), { headers: CORS_HEADERS });
    }

    // Seed endpoint: POST /seed/{namespace}/{type}/{key}?value=N&token=...
    const seedMatch = path.match(/^\/seed\/([^\/]+)\/(views|vote)\/(.+)$/);
    if (seedMatch && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.SEED_TOKEN) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS_HEADERS });
      }
      const [, namespace, type, key] = seedMatch;
      const value = parseInt(url.searchParams.get('value') || '0', 10);
      const kvKey = `${type}:${namespace}:${key}`;
      await env.COUNTERS.put(kvKey, value.toString());
      return new Response(JSON.stringify({ ok: true, kvKey, value }), { headers: CORS_HEADERS });
    }

    // Debug endpoint: GET /debug/{namespace}/{type}/{key}?token=...
    const debugMatch = path.match(/^\/debug\/([^\/]+)\/(views|vote)\/(.+)$/);
    if (debugMatch) {
      if (url.searchParams.get('token') !== env.SEED_TOKEN) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS_HEADERS });
      }
      const [, namespace, type, key] = debugMatch;
      const kvKey = `${type}:${namespace}:${key}`;
      const stored = await env.COUNTERS.get(kvKey);
      return new Response(JSON.stringify({ kvKey, value: stored ? parseInt(stored, 10) : 0 }), { headers: CORS_HEADERS });
    }

    // Main counter endpoint: GET /api/{namespace}/{type}/{key}
    const match = path.match(/^\/api\/([^\/]+)\/(views|vote)\/(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Not found', path }), { status: 404, headers: CORS_HEADERS });
    }

    const [, namespace, type, key] = match;
    const isReadOnly = url.searchParams.get('readOnly') === 'true';
    const kvKey = `${type}:${namespace}:${key}`;

    const stored = await env.COUNTERS.get(kvKey);
    const current = stored ? parseInt(stored, 10) : 0;
    let value;

    if (isReadOnly) {
      value = current;
    } else {
      value = current + 1;
      try {
        await env.COUNTERS.put(kvKey, value.toString());
      } catch (e) {
        // KV write failed (e.g. daily free-tier limit exceeded).
        // Return the optimistic incremented value anyway so the UI shows
        // a sensible number — the count just won't persist for this request.
        console.error('KV write failed:', e.message);
      }
    }

    // Heart: outline for initial readOnly load, filled after vote click
    let iconSvg;
    if (type === 'vote') {
      iconSvg = isReadOnly ? HEART_OUTLINE_SVG : HEART_FILLED_SVG;
    } else {
      iconSvg = EYE_SVG;
    }

    return new Response(
      JSON.stringify({ value, iconSvg }),
      { headers: CORS_HEADERS }
    );
  }
};
