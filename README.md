# counterapi-worker

A self-hosted drop-in replacement for [CounterAPI](https://counterapi.com) built on [Cloudflare Workers](https://workers.cloudflare.com/) + [KV](https://developers.cloudflare.com/kv/). CounterAPI went down in May 2026 without notice; this gives you the same API surface on infrastructure you own.

## Features

- **Same URL structure as CounterAPI** — swap one hostname and your existing JS keeps working
- **Same response shape** — `{ value, iconSvg }` with matching Ionicon SVGs (eye for views, outline/filled heart for likes)
- **2-minute write buffer** — accumulates view increments in memory, flushes to KV once per 2-minute window per key. Max ~720 KV writes/day regardless of traffic, well within the free tier limit (1,000/day)
- **Health endpoint** — `/health` for uptime monitoring
- **Export endpoint** — dump all counter data as JSON for backup
- **Seed endpoint** — set initial values (useful when migrating from CounterAPI)
- **Free tier friendly** — runs entirely within Cloudflare's free plan for typical personal site traffic

## API

### View counter
```
GET /api/{namespace}/views/{key}
```
Auto-increments on each request and returns `{ value, iconSvg }`.

### Like counter (read)
```
GET /api/{namespace}/vote/{key}?readOnly=true
```
Returns current like count + outline heart SVG, no increment.

### Like counter (vote)
```
GET /api/{namespace}/vote/{key}
```
Increments like count by 1, returns filled heart SVG.

### Health check
```
GET /health
→ { ok: true, ts: <epoch ms>, worker: "counter" }
```

### Export all counters (token required)
```
GET /export?token=YOUR_SEED_TOKEN
→ { exported: { "views:ns:key": N, ... }, count: N }
```
Flushes any in-memory pending counts before exporting, so the dump is fully up-to-date.

### Seed a counter (token required)
```
POST /seed/{namespace}/{type}/{key}?value=N&token=YOUR_SEED_TOKEN
```
Sets a counter to an exact value. Use this once when migrating to set historical baselines.

### Debug a counter (token required)
```
GET /debug/{namespace}/{type}/{key}?token=YOUR_SEED_TOKEN
→ { kvKey, stored, pending, displayValue, lastFlush }
```
Shows both the KV-persisted value and the in-memory pending increment.

## Migrating from CounterAPI

Your existing JS probably calls something like:
```js
fetch(`https://counterapi.com/api/your-site.com/views/page-key`)
```

Change the hostname:
```js
fetch(`https://counter.YOUR_SUBDOMAIN.workers.dev/api/your-site.com/views/page-key`)
```

That's it. The response shape is identical.

If you were using the `c.js` embed script (`<div class="counterapi" ...>`), see the [counter.js](https://github.com/avikalpg/avikalpg.github.io/blob/master/counter.js) drop-in replacement in the companion site repo.

## Deploy your own

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Node.js](https://nodejs.org) + [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`

### Steps

**1. Clone this repo**
```bash
git clone https://github.com/avikalpg/counterapi-worker.git
cd counterapi-worker
```

**2. Create a KV namespace**
```bash
wrangler kv namespace create COUNTERS
```
Copy the `id` from the output and paste it into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "COUNTERS"
id = "YOUR_KV_NAMESPACE_ID"   # ← replace this
```

**3. Choose a seed token**

Pick any random string (e.g. `openssl rand -hex 16`). This protects your `/seed`, `/debug`, and `/export` endpoints.

**4. Deploy**
```bash
wrangler deploy --var "SEED_TOKEN:your-random-token-here"
```

Your worker is now live at `https://counter.YOUR_SUBDOMAIN.workers.dev`.

**5. Seed historical data (optional)**

If you have prior view counts you want to preserve:
```bash
curl -X POST "https://counter.YOUR_SUBDOMAIN.workers.dev/seed/your-site.com/views/page-key?value=1234&token=your-random-token-here"
```

## Write buffering

Each view request increments an in-memory counter for that key. The Worker only writes to KV when 2+ minutes have elapsed since the last flush for that key. This keeps you comfortably within the free-tier limit of 1,000 KV writes/day even during traffic spikes.

**Max writes:** 1 per 2-minute window per key × number of active keys. With one popular article: 720 writes/day max.

**Display accuracy:** the count shown to visitors is always `KV stored value + in-memory pending`, so it's accurate even between flushes.

**Edge cases:**
- If Cloudflare recycles the Worker isolate before a flush fires, that window's pending counts are lost. This is rare during active traffic.
- Under very high concurrency (multiple Worker isolates running simultaneously), each flushes independently. Unlikely for personal site traffic.

For guaranteed zero-loss counting under any traffic load, [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) are the right tool — but that requires the paid Workers plan.

## Free tier limits

| Resource | Free limit | This worker's usage |
|---|---|---|
| Worker requests | 100,000/day | 1 per page view |
| KV reads | 100,000/day | 1 per page view |
| KV writes | 1,000/day | ≤720/day with 2-min buffer |
| KV storage | 1 GB | ~bytes per counter |

## License

MIT
