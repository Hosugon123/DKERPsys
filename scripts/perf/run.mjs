import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_URL = 'https://dksys.vercel.app';
const REPORT_DIR = resolve('reports/performance');
const mode = process.argv[2] ?? 'report';
const baseUrl = normalizeBaseUrl(process.env.PERF_BASE_URL || DEFAULT_BASE_URL);
const iterations = positiveInt(process.env.PERF_ITERATIONS, mode === 'report' ? 5 : 3);
const loadIterations = positiveInt(process.env.PERF_LOAD_ITERATIONS, 10);
const apiToken = process.env.PERF_API_TOKEN || process.env.VITE_API_SYNC_TOKEN || readEnvToken();

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readEnvToken() {
  const names = ['.env.local', '.env.production.local', '.env'];
  for (const name of names) {
    if (!existsSync(name)) continue;
    try {
      const text = awaitableReadFileSync(name);
      const line = text.split(/\r?\n/).find((row) => row.startsWith('VITE_API_SYNC_TOKEN='));
      if (line) return line.slice('VITE_API_SYNC_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
    } catch {
      // ignore local env parse failures
    }
  }
  return '';
}

function awaitableReadFileSync(path) {
  return readFileSync(path, 'utf8');
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(samples) {
  const durations = samples.map((s) => s.durationMs).filter(Number.isFinite);
  const bytes = samples.map((s) => s.bytes ?? 0);
  return {
    count: samples.length,
    minMs: Math.round(Math.min(...durations)),
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    p99Ms: Math.round(percentile(durations, 99)),
    maxMs: Math.round(Math.max(...durations)),
    avgBytes: Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length)),
  };
}

async function measureFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const started = performance.now();
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    cache: 'no-store',
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const ended = performance.now();
  return {
    url,
    path: url.replace(baseUrl, '') || '/',
    status: res.status,
    ok: res.ok,
    durationMs: ended - started,
    bytes: buffer.length,
    cacheControl: res.headers.get('cache-control'),
    contentType: res.headers.get('content-type'),
    serverTiming: res.headers.get('server-timing'),
    bodyText: options.keepBody ? buffer.toString('utf8') : undefined,
  };
}

async function repeated(path, count, options = {}) {
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    samples.push(await measureFetch(path, options));
  }
  return { path, samples, summary: summarize(samples) };
}

async function inspectHtmlAssets() {
  const home = await measureFetch('/', { keepBody: true });
  const assets = [...home.bodyText.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const measured = [];
  for (const asset of assets) {
    measured.push(await measureFetch(asset));
  }
  return { home: stripBody(home), assets: measured.map(stripBody) };
}

async function inspectPwa() {
  const manifestRes = await measureFetch('/manifest.webmanifest', { keepBody: true });
  let manifest = null;
  try {
    manifest = JSON.parse(manifestRes.bodyText);
  } catch {
    manifest = { parseError: true };
  }
  const serviceWorkerCandidates = ['/sw.js', '/service-worker.js', '/serviceWorker.js', '/ngsw-worker.js', '/workbox-sw.js'];
  const serviceWorkers = [];
  for (const candidate of serviceWorkerCandidates) {
    serviceWorkers.push(stripBody(await measureFetch(candidate)));
  }
  return {
    manifest: {
      response: stripBody(manifestRes),
      display: manifest?.display,
      startUrl: manifest?.start_url,
      scope: manifest?.scope,
      iconCount: Array.isArray(manifest?.icons) ? manifest.icons.length : 0,
    },
    serviceWorkers,
    conclusion:
      serviceWorkers.every((r) => r.status === 404)
        ? 'No common service worker file is present on production. Current PWA slowness is unlikely to be caused by an active app service worker in a fresh install.'
        : 'A service worker candidate exists. Inspect cache strategy before changing business logic.',
  };
}

async function inspectApiBundle() {
  const headers = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = await measureFetch('/api/sync-bundle', { headers, keepBody: true });
    const parseStarted = performance.now();
    let parsed = null;
    try {
      parsed = JSON.parse(sample.bodyText);
    } catch {
      parsed = null;
    }
    const parseMs = performance.now() - parseStarted;
    samples.push({
      ...stripBody(sample),
      jsonParseMs: Math.round(parseMs),
      authorized: Boolean(apiToken),
      bundleStats: parsed?.bundle ? bundleStats(parsed.bundle) : undefined,
    });
  }
  return {
    authorized: Boolean(apiToken),
    note: apiToken
      ? 'Authorized bundle read measured. No write was performed.'
      : 'No PERF_API_TOKEN/VITE_API_SYNC_TOKEN found. Only unauthorized API latency and headers were measured.',
    samples,
    summary: summarize(samples),
  };
}

function bundleStats(bundle) {
  const keys = bundle?.keys && typeof bundle.keys === 'object' ? bundle.keys : {};
  const byKey = Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [key, String(value ?? '').length]),
  );
  return {
    updatedAt: bundle.updatedAt,
    keyCount: Object.keys(keys).length,
    approxChars: JSON.stringify(bundle).length,
    largestKeys: Object.entries(byKey)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, chars]) => ({ key, chars })),
  };
}

function stripBody(sample) {
  const { bodyText, ...rest } = sample;
  return {
    ...rest,
    durationMs: Math.round(rest.durationMs),
  };
}

function buildSyntheticBundle(dayCount, orderCountPerDay) {
  const orders = [];
  const salesByDate = {};
  const stallByDate = {};
  const itemIds = Array.from({ length: 40 }, (_, i) => `item-${String(i + 1).padStart(2, '0')}`);
  for (let d = 0; d < dayCount; d += 1) {
    const ymd = `2026-06-${String((d % 28) + 1).padStart(2, '0')}`;
    for (let o = 0; o < orderCountPerDay; o += 1) {
      orders.push({
        id: `perf-${d}-${o}`,
        orderDateYmd: ymd,
        updatedAt: new Date(2026, 5, d + 1, 8, o).toISOString(),
        totalAmount: 12000,
        lines: itemIds.map((id) => ({ productId: id, name: id, qty: 1000, subtotal: 1000 })),
        status: 'shipped',
        scopeId: o % 2 === 0 ? 'scope:hq' : 'scope:franchisee:perf',
      });
    }
    const lines = Object.fromEntries(itemIds.map((id) => [id, { out: 1000, remain: 500, sold: 500 }]));
    salesByDate[`scope:hq::${ymd}`] = { ymd, scopeId: 'scope:hq', lines };
    stallByDate[`scope:hq::${ymd}`] = { ymd, scopeId: 'scope:hq', lines };
  }
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    exportedAt: new Date().toISOString(),
    updatedAt: Date.now(),
    format: 'dongshan-localStorage-snapshot-v1',
    keys: {
      dongshan_order_history_v1: JSON.stringify(orders),
      dongshan_franchise_mgmt_orders_v1: JSON.stringify([]),
      dongshan_stall_inventory_v1: JSON.stringify({ version: 1, byDate: stallByDate }),
      dongshan_sales_records_v1: JSON.stringify({ version: 1, byDate: salesByDate }),
      dongshan_accounting_ledger_v1: JSON.stringify({ version: 1, entries: [] }),
    },
  };
}

function measureSyntheticBundle(dayCount, orderCountPerDay) {
  const buildStart = performance.now();
  const bundle = buildSyntheticBundle(dayCount, orderCountPerDay);
  const buildMs = performance.now() - buildStart;
  const stringifyStart = performance.now();
  const text = JSON.stringify(bundle);
  const stringifyMs = performance.now() - stringifyStart;
  const parseStart = performance.now();
  JSON.parse(text);
  const parseMs = performance.now() - parseStart;
  return {
    dayCount,
    orderCountPerDay,
    orderCount: dayCount * orderCountPerDay,
    approxChars: text.length,
    buildMs: Math.round(buildMs),
    stringifyMs: Math.round(stringifyMs),
    parseMs: Math.round(parseMs),
  };
}

async function runLoadProbe() {
  const api = await repeated('/api/sync-bundle', loadIterations, {
    headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined,
  });
  const home = await repeated('/', loadIterations);
  return {
    iterations: loadIterations,
    authorizedApi: Boolean(apiToken),
    api: {
      summary: api.summary,
      statuses: api.samples.map((s) => s.status),
      serverTiming: api.samples.map((s) => s.serverTiming).filter(Boolean).slice(0, 3),
    },
    home: {
      summary: home.summary,
      statuses: home.samples.map((s) => s.status),
    },
  };
}

async function collect() {
  const startedAt = new Date().toISOString();
  const [assets, pwa, api, home, manifest, buildVersion, load] = await Promise.all([
    inspectHtmlAssets(),
    inspectPwa(),
    inspectApiBundle(),
    repeated('/', iterations),
    repeated('/manifest.webmanifest', iterations),
    repeated('/build-version.json', iterations),
    mode === 'report' || mode === 'test' ? runLoadProbe() : Promise.resolve(null),
  ]);
  const synthetic10 = measureSyntheticBundle(10, 3);
  const synthetic50 = measureSyntheticBundle(50, 3);
  return {
    mode,
    baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    config: {
      iterations,
      loadIterations,
      authorizedApi: Boolean(apiToken),
      note: 'This probe is read-only. It does not PUT to production and does not mutate Redis.',
    },
    pwa,
    staticResources: assets,
    endpoints: {
      home: { summary: home.summary, samples: home.samples.map(stripBody) },
      manifest: { summary: manifest.summary, samples: manifest.samples.map(stripBody) },
      buildVersion: { summary: buildVersion.summary, samples: buildVersion.samples.map(stripBody) },
      syncBundle: api,
    },
    syntheticBundle: {
      tenDay: synthetic10,
      fiftyDay: synthetic50,
    },
    load,
    manualIphoneChecklist: [
      'Open https://dksys.vercel.app/?perf=1 in Safari and log in.',
      'Open the installed Home Screen PWA with ?perf=1 after reinstalling the icon.',
      'Compare remote.fetch-bundle.request, remote.fetch-bundle.json, remote.init.import-bundle, dashboard.reload-primary, dashboard.reload-sales-records.snapshots.',
      'Any metric above 800ms or longtask above 50ms should be copied into the report.',
    ],
  };
}

function markdown(report) {
  const api = report.endpoints.syncBundle;
  const assetRows = report.staticResources.assets
    .map((a) => `| ${a.path} | ${a.status} | ${a.durationMs} | ${a.bytes} | ${a.cacheControl ?? ''} |`)
    .join('\n');
  return `# DKERPsys Performance Report

Generated: ${report.finishedAt}
Base URL: ${report.baseUrl}
Mode: ${report.mode}

## Summary

- Home p95: ${report.endpoints.home.summary.p95Ms} ms
- Manifest p95: ${report.endpoints.manifest.summary.p95Ms} ms
- Sync bundle p95: ${api.summary.p95Ms} ms (${api.authorized ? 'authorized' : 'unauthorized only'})
- PWA manifest display: ${report.pwa.manifest.display ?? 'unknown'}
- Service worker check: ${report.pwa.conclusion}
- Synthetic 10-day bundle parse: ${report.syntheticBundle.tenDay.parseMs} ms, size ${report.syntheticBundle.tenDay.approxChars} chars
- Synthetic 50-day bundle parse: ${report.syntheticBundle.fiftyDay.parseMs} ms, size ${report.syntheticBundle.fiftyDay.approxChars} chars

## Static Assets

| Asset | Status | ms | bytes | cache-control |
| --- | ---: | ---: | ---: | --- |
${assetRows || '| none | | | | |'}

## API

- Authorized API measured: ${api.authorized}
- Note: ${api.note}
- Statuses: ${api.samples.map((s) => s.status).join(', ')}
- Server-Timing samples: ${api.samples.map((s) => s.serverTiming).filter(Boolean).slice(0, 3).join(' / ') || 'none'}

## iPhone PWA Manual Comparison

1. Safari browser: open ${report.baseUrl}/?perf=1, log in, open Dashboard.
2. Home Screen PWA: reinstall the icon, open the same URL, log in, open Dashboard.
3. Compare console metrics:
   - remote.fetch-bundle.request
   - remote.fetch-bundle.json
   - remote.init.import-bundle
   - dashboard.reload-primary
   - dashboard.reload-sales-records.snapshots
   - longtask

## Non-Mutating Guarantee

This report used GET requests and local synthetic JSON only. It did not write Redis or production business data.
`;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const report = await collect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = resolve(REPORT_DIR, `${stamp}-${mode}.json`);
  const mdPath = resolve(REPORT_DIR, `${stamp}-${mode}.md`);
  const latestJson = resolve(REPORT_DIR, 'latest.json');
  const latestMd = resolve(REPORT_DIR, 'latest.md');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, markdown(report), 'utf8');
  await writeFile(latestJson, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(latestMd, markdown(report), 'utf8');
  console.log(`Performance report written:\n${jsonPath}\n${mdPath}`);
  console.log(markdown(report));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
