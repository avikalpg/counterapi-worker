#!/usr/bin/env node

const DEFAULT_WAIT_MS = 130_000;

function usage() {
  console.error(`Usage:
  COUNTER_BASE_URL=https://counter.example.workers.dev npm run test:production-durability

Optional env:
  COUNTER_NAMESPACE  namespace to use, default: production-test.local
  COUNTER_KEY        key to use, default: durability-<timestamp>-<random>
  COUNTER_WAIT_MS    wait before final readOnly check, default: ${DEFAULT_WAIT_MS}
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got status ${res.status}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Request failed for ${url}: ${res.status} ${JSON.stringify(body)}`);
  }

  return body;
}

const baseUrl = process.env.COUNTER_BASE_URL?.replace(/\/+$/, '');
if (!baseUrl) {
  usage();
  process.exit(2);
}

const namespace = process.env.COUNTER_NAMESPACE || 'production-test.local';
const key = process.env.COUNTER_KEY || `durability-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const waitMs = Number(process.env.COUNTER_WAIT_MS || DEFAULT_WAIT_MS);

if (!Number.isFinite(waitMs) || waitMs < 0) {
  throw new Error(`COUNTER_WAIT_MS must be a non-negative number, got ${process.env.COUNTER_WAIT_MS}`);
}

const path = `/api/${encodeURIComponent(namespace)}/views/${encodeURIComponent(key)}`;
const incrementUrl = `${baseUrl}${path}`;
const readOnlyUrl = `${baseUrl}${path}?readOnly=true`;

console.log(`Incrementing ${incrementUrl}`);
const increment = await fetchJson(incrementUrl);

if (increment.value !== 1) {
  throw new Error(`Expected first increment to return 1, got ${increment.value}`);
}

const immediateRead = await fetchJson(readOnlyUrl);
if (immediateRead.value < increment.value) {
  throw new Error(`Immediate readOnly value regressed from ${increment.value} to ${immediateRead.value}`);
}

console.log(`Waiting ${waitMs}ms before durability read...`);
await sleep(waitMs);

const durableRead = await fetchJson(readOnlyUrl);
if (durableRead.value < increment.value) {
  throw new Error(
    `Durability check failed: increment returned ${increment.value}, final readOnly returned ${durableRead.value}`
  );
}

console.log(JSON.stringify({
  ok: true,
  namespace,
  key,
  incrementValue: increment.value,
  immediateReadValue: immediateRead.value,
  durableReadValue: durableRead.value,
}, null, 2));
