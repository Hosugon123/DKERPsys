// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeSyncRequest, decodeSyncResponse, SYNC_ENCODING } from '../lib/syncTransport';
import handler from '../../api/sync-bundle.js';

const db = vi.hoisted(() => ({ value: null as string | null, writes: 0, writeError: null as Error | null, evalCalls: 0, connections: 0, closed: 0 }));
vi.mock('redis', async (importOriginal) => ({
  ...await importOriginal<typeof import('redis')>(),
  createClient: () => ({
    isOpen: true,
    on: vi.fn(),
    connect: vi.fn(),
    get: async () => db.value,
    set: async (_key: string, value: string) => { db.value = value; db.writes++; },
    eval: async () => {
      db.evalCalls++;
      throw new Error('ERR keys and arguments would exceed Lua memory limit');
    },
    duplicate: () => {
      let watched: string | null;
      let version: number;
      const connection = {
        isOpen: false, on: vi.fn(),
        connect: async () => { connection.isOpen = true; db.connections++; },
        watch: async () => { watched = db.value; version = db.writes; },
        get: async () => db.value,
        multi: () => ({
          set: (_key: string, value: string) => ({
            exec: async () => {
              if (db.writeError) throw db.writeError;
              if (db.value !== watched || db.writes !== version) return null;
              db.value = value; db.writes++; return ['OK'];
            },
          }),
        }),
        destroy: () => { connection.isOpen = false; db.closed++; },
      };
      return connection;
    },
  }),
}));

async function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = {
    statusCode: 200, headersSent: false, body: undefined as unknown,
    setHeader: vi.fn(), end: vi.fn(),
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; this.headersSent = true; return this; },
  };
  await handler({ method, body, headers: { authorization: 'Bearer test-token', ...headers } }, res);
  return res;
}

function bundle(keys: Record<string, string | null>, updatedAt = 10) {
  return { bundleVersion: 1, updatedAt, keys };
}

describe('compressed sync API compatibility and data integrity', () => {
  beforeEach(() => {
    db.value = null;
    db.writes = 0;
    db.writeError = null;
    db.evalCalls = 0; db.connections = 0; db.closed = 0;
    vi.stubEnv('API_SYNC_TOKEN', 'test-token');
    vi.stubEnv('REDIS_URL', 'redis://test');
  });

  it('round trips a payload above the platform limit without altering quantities, prices or Unicode', async () => {
    const orders = Array.from({ length: 22000 }, (_, i) => ({
      id: `00220261024-${i}`, store: '高雄三民',
      lines: [{ productId: 'duck', name: '鴨頭', qty: 13, unitPrice: 15.63, unit: '支' },
        { productId: 'stairs', name: '樓梯', qty: 59.5, unitPrice: 8.13, unit: '兩' }],
      procurementDeductionAppliedQtyByBasisOrderId: { previous: { duck: 5, stairs: 4.5 } },
      totalAmount: 686.625,
    }));
    const value = bundle({ orders: JSON.stringify(orders), archive: '保留其他資料' });
    const raw = JSON.stringify({ bundle: value, syncedFromUpdatedAt: 0 });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(4_500_000);
    const wire = await encodeSyncRequest(raw);
    expect(JSON.parse(wire).encoding).toBe(SYNC_ENCODING);
    expect(Buffer.byteLength(wire)).toBeLessThan(4_000_000);
    const receipt = await request('PUT', wire);
    expect(receipt.statusCode).toBe(200);
    value.updatedAt = (receipt.body as { updatedAt: number }).updatedAt;
    expect(JSON.parse(db.value!)).toEqual(value);
    const response = await request('GET', undefined, { 'x-dongshan-sync-encoding': SYNC_ENCODING });
    expect((response.body as { encoding: string }).encoding).toBe(SYNC_ENCODING);
    expect(await decodeSyncResponse(response.body)).toEqual({ ok: true, bundle: value });
    expect(db.evalCalls).toBe(0);
    expect(db.closed).toBe(db.connections);
  }, 15000);

  it('still accepts legacy uncompressed requests and returns legacy responses', async () => {
    const value = bundle({ orders: '[]' });
    const receipt = await request('PUT', { bundle: value });
    expect(receipt.statusCode).toBe(200);
    value.updatedAt = (receipt.body as { updatedAt: number }).updatedAt;
    expect((await request('GET')).body).toEqual({ ok: true, bundle: value });
  });

  it('allows only one concurrent writer and preserves both stores after the conflict retry', async () => {
    db.value = JSON.stringify(bundle({ orders: '[]', sales: '{}' }, 20));
    const a = { bundle: bundle({ orders: '["三民新訂單"]' }, 30), partialKeys: ['orders'], syncedFromUpdatedAt: 20 };
    const b = { bundle: bundle({ sales: '{"三民":"已盤點"}' }, 30), partialKeys: ['sales'], syncedFromUpdatedAt: 20 };
    const results = await Promise.all([request('PUT', a), request('PUT', b)]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    const loser = results[0].statusCode === 409 ? a : b;
    loser.syncedFromUpdatedAt = JSON.parse(db.value!).updatedAt;
    expect((await request('PUT', loser)).statusCode).toBe(200);
    expect(JSON.parse(db.value!).keys).toEqual({ ...a.bundle.keys, ...b.bundle.keys });
  });

  it('rejects a sequential stale write even if two clients use the exact same millisecond timestamp', async () => {
    db.value = JSON.stringify(bundle({ orders: '[]' }, 20));
    const a = { bundle: bundle({ orders: '["第一張"]' }, 20), syncedFromUpdatedAt: 20 };
    expect((await request('PUT', a)).statusCode).toBe(200);
    const b = { bundle: bundle({ orders: '["另一台的舊資料"]' }, 20), syncedFromUpdatedAt: 20 };
    expect((await request('PUT', b)).statusCode).toBe(409);
    expect(JSON.parse(db.value!).keys.orders).toBe(a.bundle.keys.orders);
  });

  it('does not treat a future client clock as proof it read the current cloud revision', async () => {
    db.value = JSON.stringify(bundle({ orders: '["三民已盤點訂單"]' }, 20));
    expect((await request('PUT', {
      bundle: bundle({ orders: '[]' }, 9999999999999), syncedFromUpdatedAt: 9999999999999,
    })).statusCode).toBe(409);
    expect(db.writes).toBe(0);
  });

  it('logs the exact failed database stage and retains the original data when atomic write fails', async () => {
    db.value = JSON.stringify(bundle({ orders: '["original"]' }, 20));
    const before = db.value;
    db.writeError = new Error('ERR database rejected atomic operation');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request('PUT', { bundle: bundle({ orders: '["new"]' }, 30), syncedFromUpdatedAt: 20 });
      expect(res.statusCode).toBe(500);
      expect(db.value).toBe(before);
      expect(db.writes).toBe(0);
      expect(db.closed).toBe(db.connections);
      expect(errorLog).toHaveBeenCalledWith('[sync-failure]', expect.objectContaining({
        requestId: expect.any(String), stage: 'redis_compare_and_set', message: 'ERR database rejected atomic operation',
      }));
    } finally { errorLog.mockRestore(); }
  });

  it.each([undefined, ['dongshan_data_archives_v1']])('preserves cloud archives when a device sends a missing local copy: %s', async (partialKeys) => {
    db.value = JSON.stringify(bundle({ dongshan_data_archives_v1: '{"archives":["keep"]}', orders: '[]' }, 20));
    const res = await request('PUT', { bundle: bundle({ dongshan_data_archives_v1: null, orders: '[]' }, 30), syncedFromUpdatedAt: 20, partialKeys });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(db.value!).keys.dongshan_data_archives_v1).toBe('{"archives":["keep"]}');
  });

  it('preserves partial keys, null values and version conflict protection', async () => {
    db.value = JSON.stringify(bundle({ untouched: 'unchanged', orders: 'old', removed: 'old' }, 20));
    const payload = {
      bundle: bundle({ orders: '新訂單'.repeat(50000), removed: null }, 30),
      partialKeys: ['orders', 'removed'], syncedFromUpdatedAt: 10,
    };
    const conflict = await request('PUT', await encodeSyncRequest(JSON.stringify(payload)));
    expect(conflict.statusCode).toBe(409);
    expect(db.writes).toBe(0);
    payload.syncedFromUpdatedAt = 20;
    expect((await request('PUT', await encodeSyncRequest(JSON.stringify(payload)))).statusCode).toBe(200);
    expect(JSON.parse(db.value!).keys).toEqual({ untouched: 'unchanged', ...payload.bundle.keys });
  });

  it('rejects corrupt and unknown encodings without changing stored data', async () => {
    db.value = JSON.stringify(bundle({ orders: 'original' }));
    for (const body of [
      { encoding: SYNC_ENCODING, data: 'not valid!' },
      { encoding: SYNC_ENCODING, data: btoa('not gzip') },
      { encoding: 'unknown', data: '' },
    ]) expect((await request('PUT', body)).statusCode).toBe(400);
    expect(db.writes).toBe(0);
  });

  it.each(['not json', '{"updatedAt":123}', '{"keys":[]}'])(
    'does not turn invalid stored data into an empty cloud or overwrite it: %s', async (raw) => {
      db.value = raw;
      expect((await request('GET')).statusCode).toBe(500);
      expect((await request('PUT', { bundle: bundle({ orders: '[]' }) })).statusCode).toBe(500);
      expect(db.value).toBe(raw);
      expect(db.writes).toBe(0);
    },
  );

  it('bounds decompression and checks authentication before decoding', async () => {
    const body = { encoding: SYNC_ENCODING, data: gzipSync(Buffer.alloc(65 * 1024 * 1024)).toString('base64') };
    expect((await request('PUT', body, { authorization: '' })).statusCode).toBe(401);
    expect((await request('PUT', body)).statusCode).toBe(400);
    expect(db.writes).toBe(0);
  });

  it('supports small requests on older browsers and rejects oversize requests before fetching', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      expect(await encodeSyncRequest('{"bundle":{}}')).toBe('{"bundle":{}}');
      await expect(encodeSyncRequest('貨'.repeat(1_400_000))).rejects.toThrow('傳輸上限');
    } finally { vi.unstubAllGlobals(); }
  });
});
