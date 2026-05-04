import { kv } from '@vercel/kv';

const KV_KEY = 'dongshan:data-bundle:v1';

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

function readBearer(req) {
  const raw = String(req.headers.authorization || '');
  if (!raw.startsWith('Bearer ')) return '';
  return raw.slice('Bearer '.length).trim();
}

function emptyBundle() {
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    exportedAt: new Date().toISOString(),
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

export default async function handler(req, res) {
  try {
    const expected = String(process.env.API_SYNC_TOKEN || '').trim();
    const got = readBearer(req);
    if (!expected || !got || got !== expected) {
      return unauthorized(res);
    }

    if (req.method === 'GET') {
      const stored = await kv.get(KV_KEY);
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

      await kv.set(KV_KEY, bundle);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return internalError(res, e);
  }
}
