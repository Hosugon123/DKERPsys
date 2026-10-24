// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeSyncRequest, decodeSyncResponse, SYNC_ENCODING } from '../lib/syncTransport';
import handler from '../../api/sync-bundle.js';

const db = vi.hoisted(() => ({ value: null as string | null, writes: 0 }));
vi.mock('redis', () => ({
  createClient: () => ({
    isOpen: true,
    on: vi.fn(),
    connect: vi.fn(),
    get: async () => db.value,
    set: async (_key: string, value: string) => { db.value = value; db.writes++; },
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
    expect((await request('PUT', wire)).statusCode).toBe(200);
    expect(JSON.parse(db.value!)).toEqual(value);
    const response = await request('GET', undefined, { 'x-dongshan-sync-encoding': SYNC_ENCODING });
    expect((response.body as { encoding: string }).encoding).toBe(SYNC_ENCODING);
    expect(await decodeSyncResponse(response.body)).toEqual({ ok: true, bundle: value });
  });

  it('still accepts legacy uncompressed requests and returns legacy responses', async () => {
    const value = bundle({ orders: '[]' });
    expect((await request('PUT', { bundle: value })).statusCode).toBe(200);
    expect((await request('GET')).body).toEqual({ ok: true, bundle: value });
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
