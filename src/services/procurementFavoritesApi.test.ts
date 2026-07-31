import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_SCOPE = 'scope:franchisee:dk002-test';

vi.mock('./storageMode', () => ({
  getStorageMode: () => 'remote',
  getApiBaseUrl: () => '/api',
  getApiSyncToken: () => 'test-token',
  getAsyncStorageDelayMs: () => 0,
}));

vi.mock('../lib/dataScope', async () => {
  const actual = await vi.importActual<typeof import('../lib/dataScope')>('../lib/dataScope');
  return {
    ...actual,
    getDataScopeContext: () => ({
      isAdmin: false,
      scopeId: TEST_SCOPE,
      userId: 'dk002-test',
      role: 'franchisee',
    }),
    resolveAccountingLedgerScopeId: () => TEST_SCOPE,
    resolveFranchiseeRetailOwnerUserId: () => 'dk002-test',
  };
});

function emptyCloudBundle() {
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    exportedAt: '2026-07-31T00:00:00.000Z',
    updatedAt: 0,
    format: 'dongshan-localStorage-snapshot-v1',
    keys: {},
  };
}

describe('procurementFavorites api', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    localStorage.clear();
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ ok: true, bundle: emptyCloudBundle() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes saved favorite orders to the remote bundle before resolving', async () => {
    const { procurementFavorites } = await import('./apiService');
    const { getAllSupplyItems } = await import('../lib/supplyCatalog');
    const firstItem = getAllSupplyItems()[0];
    expect(firstItem).toBeTruthy();

    const result = await procurementFavorites.add('DK002 常用測試', { [firstItem.id]: 5 });

    expect(result.ok).toBe(true);
    expect(await procurementFavorites.list()).toHaveLength(1);

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      bundle?: { keys?: Record<string, string | null> };
      partialKeys?: string[];
    };
    expect(body.partialKeys).toEqual(['dongshan_procurement_favorites_v1']);
    const rawFavorites = body.bundle?.keys?.dongshan_procurement_favorites_v1;
    expect(rawFavorites).toBeTruthy();
    const parsed = JSON.parse(String(rawFavorites)) as {
      byScope?: Record<string, Array<{ name: string; quantities: Record<string, number> }>>;
    };
    expect(parsed.byScope?.[TEST_SCOPE]?.[0]?.name).toBe('DK002 常用測試');
    expect(parsed.byScope?.[TEST_SCOPE]?.[0]?.quantities[firstItem.id]).toBe(5);
  });

  it('rejects saving a favorite order when the remote PUT fails', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { procurementFavorites } = await import('./apiService');
    const { getAllSupplyItems } = await import('../lib/supplyCatalog');
    const firstItem = getAllSupplyItems()[0];
    expect(firstItem).toBeTruthy();

    await expect(
      procurementFavorites.add('不應假成功', { [firstItem.id]: 5 }),
    ).rejects.toThrow('PUT 500');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
  });
});
