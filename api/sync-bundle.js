import { createClient } from 'redis';

const KV_KEY = 'dongshan:data-bundle:v1';
const REDIS_ENV_KEY = 'REDIS_URL';

/** @type {import('redis').RedisClientType | null} */
let redisClient = null;
let redisConnecting = null;

function hrMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function perfEnabled() {
  return String(process.env.PERFORMANCE_DEBUG || '').toLowerCase() === 'true';
}

function slowThresholdMs() {
  const n = Number(process.env.PERFORMANCE_SLOW_MS || 1000);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

function makePerfTrace(req) {
  const started = process.hrtime.bigint();
  const items = [];
  let finished = false;
  return {
    mark(name, durationMs, detail) {
      items.push({ name, durationMs, detail });
    },
    async time(name, fn, detail) {
      const s = process.hrtime.bigint();
      try {
        return await fn();
      } finally {
        items.push({ name, durationMs: hrMs(s), detail });
      }
    },
    attach(res) {
      const finishBeforeSend = () => {
        if (!finished) this.finish(res, res.statusCode || 200);
      };
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        finishBeforeSend();
        return originalJson(body);
      };
      const originalSend = res.send?.bind(res);
      if (originalSend) {
        res.send = (body) => {
          finishBeforeSend();
          return originalSend(body);
        };
      }
      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        finishBeforeSend();
        return originalEnd(...args);
      };
    },
    finish(res, statusCode) {
      if (finished) return;
      finished = true;
      const totalMs = hrMs(started);
      const serverTiming = [
        `total;dur=${totalMs.toFixed(1)}`,
        ...items.map((item) => `${item.name.replace(/[^a-zA-Z0-9_-]/g, '_')};dur=${item.durationMs.toFixed(1)}`),
      ].join(', ');
      if (!res.headersSent) res.setHeader('Server-Timing', serverTiming);
      if (perfEnabled() || totalMs >= slowThresholdMs()) {
        console.info('[perf][sync-bundle]', {
          method: req.method,
          statusCode,
          totalMs: Math.round(totalMs),
          items: items.map((item) => ({
            ...item,
            durationMs: Math.round(item.durationMs),
          })),
        });
      }
    },
  };
}

async function getRedis(perf) {
  if (redisClient && redisClient.isOpen) return redisClient;
  if (redisConnecting) return redisConnecting;

  const url = String(process.env[REDIS_ENV_KEY] || '').trim();
  if (!url) {
    throw new Error(`Missing required environment variable ${REDIS_ENV_KEY}`);
  }

  const client = createClient({ url });
  client.on('error', () => {
    /* 交由呼叫端統一回傳錯誤 */
  });

  redisConnecting = perf.time('redis_connect', async () => {
    await client.connect();
    redisClient = client;
    return client;
  });

  try {
    return await redisConnecting;
  } finally {
    redisConnecting = null;
  }
}

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

function forbidden(res) {
  return res.status(403).json({ ok: false, error: 'forbidden origin' });
}

function readBearer(req) {
  const raw = String(req.headers.authorization || '');
  if (!raw.startsWith('Bearer ')) return '';
  return raw.slice('Bearer '.length).trim();
}

function allowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromVercel = process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [];
  return new Set([...configured, ...fromVercel, 'https://dksys.vercel.app']);
}

function originAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function emptyBundle() {
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    exportedAt: new Date().toISOString(),
    updatedAt: 0,
    format: 'dongshan-localStorage-snapshot-v1',
    keys: {},
  };
}

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function internalError(res, e) {
  const message = e instanceof Error ? e.message : 'unknown error';
  return res.status(500).json({ ok: false, error: 'sync bundle failed', message });
}

function versionConflict(res) {
  return res.status(409).json({
    ok: false,
    error: 'VERSION_CONFLICT',
    message: '雲端已有更新的資料',
  });
}

function parseJsonBodyMaybe(body) {
  if (body == null) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && !Array.isArray(body)) return body;
  return null;
}

function stringifyJsonMeasured(perf, name, value) {
  const s = process.hrtime.bigint();
  try {
    return JSON.stringify(value);
  } finally {
    perf.mark(name, hrMs(s));
  }
}

function readUpdatedAt(bundle) {
  const ts = bundle?.updatedAt;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
}

function isCloudBundleEmpty(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return true;
  const keys = bundle.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return true;
  for (const value of Object.values(keys)) {
    if (value != null && String(value).length > 0) return false;
  }
  return true;
}

export default async function handler(req, res) {
  const perf = makePerfTrace(req);
  perf.attach(res);
  let statusCode = 500;
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!originAllowed(req)) {
      statusCode = 403;
      return forbidden(res);
    }

    const redis = await perf.time('redis_ready', () => getRedis(perf));
    const expected = String(process.env.API_SYNC_TOKEN || '').trim();
    const got = readBearer(req);
    if (!expected || !got || got !== expected) {
      statusCode = 401;
      return unauthorized(res);
    }

    if (req.method === 'GET') {
      const raw = await perf.time('redis_get', () => redis.get(KV_KEY));
      perf.mark('redis_get_bytes', 0, { chars: typeof raw === 'string' ? raw.length : 0 });
      const stored = await perf.time('json_parse', async () => parseJsonBodyMaybe(raw));
      if (stored && typeof stored === 'object') {
        statusCode = 200;
        return res.status(200).json({ ok: true, bundle: stored });
      }
      statusCode = 200;
      return res.status(200).json({ ok: true, bundle: emptyBundle() });
    }

    if (req.method === 'PUT') {
      const body = await perf.time('body_parse', async () => parseJsonBodyMaybe(req.body), {
        bodyType: typeof req.body,
        chars: typeof req.body === 'string' ? req.body.length : undefined,
      });
      if (!body) {
        statusCode = 400;
        return badRequest(res, 'invalid json body');
      }

      const bundle = body.bundle;
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        statusCode = 400;
        return badRequest(res, 'invalid bundle');
      }

      const incomingUpdatedAt = readUpdatedAt(bundle);
      const syncedFromUpdatedAt =
        typeof body.syncedFromUpdatedAt === 'number' && Number.isFinite(body.syncedFromUpdatedAt)
          ? body.syncedFromUpdatedAt
          : incomingUpdatedAt;

      const rawCloud = await perf.time('redis_get_before_put', () => redis.get(KV_KEY));
      perf.mark('redis_get_before_put_bytes', 0, { chars: typeof rawCloud === 'string' ? rawCloud.length : 0 });
      const cloudBundle = await perf.time('json_parse_cloud', async () => parseJsonBodyMaybe(rawCloud));
      const cloudUpdatedAt =
        cloudBundle && typeof cloudBundle === 'object' && !isCloudBundleEmpty(cloudBundle)
          ? readUpdatedAt(cloudBundle)
          : 0;

      if (cloudUpdatedAt > 0) {
        if (syncedFromUpdatedAt < cloudUpdatedAt || incomingUpdatedAt < cloudUpdatedAt) {
          return versionConflict(res);
        }
      }

      const storedBundle = {
        ...bundle,
        updatedAt: incomingUpdatedAt > 0 ? incomingUpdatedAt : Date.now(),
      };

      const storedText = stringifyJsonMeasured(perf, 'json_stringify_store', storedBundle);
      perf.mark('redis_set_bytes', 0, { chars: storedText.length });
      await perf.time('redis_set', () => redis.set(KV_KEY, storedText));
      statusCode = 200;
      return res.status(200).json({ ok: true });
    }

    statusCode = 405;
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    statusCode = 500;
    return internalError(res, e);
  } finally {
    if (!res.headersSent) perf.finish(res, statusCode);
  }
}
