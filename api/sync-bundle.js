import { createClient } from 'redis';

const KV_KEY = 'dongshan:data-bundle:v1';
const REDIS_ENV_KEY = 'REDIS_URL';

/** @type {import('redis').RedisClientType | null} */
let redisClient = null;
let redisConnecting = null;

async function getRedis() {
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

  redisConnecting = client.connect().then(() => {
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
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!originAllowed(req)) {
      return forbidden(res);
    }

    const redis = await getRedis();
    const expected = String(process.env.API_SYNC_TOKEN || '').trim();
    const got = readBearer(req);
    if (!expected || !got || got !== expected) {
      return unauthorized(res);
    }

    if (req.method === 'GET') {
      const raw = await redis.get(KV_KEY);
      const stored = parseJsonBodyMaybe(raw);
      if (stored && typeof stored === 'object') {
        return res.status(200).json({ ok: true, bundle: stored });
      }
      return res.status(200).json({ ok: true, bundle: emptyBundle() });
    }

    if (req.method === 'PUT') {
      const body = parseJsonBodyMaybe(req.body);
      if (!body) return badRequest(res, 'invalid json body');

      const bundle = body.bundle;
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        return badRequest(res, 'invalid bundle');
      }

      const incomingUpdatedAt = readUpdatedAt(bundle);
      const syncedFromUpdatedAt =
        typeof body.syncedFromUpdatedAt === 'number' && Number.isFinite(body.syncedFromUpdatedAt)
          ? body.syncedFromUpdatedAt
          : incomingUpdatedAt;

      const rawCloud = await redis.get(KV_KEY);
      const cloudBundle = parseJsonBodyMaybe(rawCloud);
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

      await redis.set(KV_KEY, JSON.stringify(storedBundle));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return internalError(res, e);
  }
}
