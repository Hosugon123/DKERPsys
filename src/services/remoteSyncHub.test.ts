import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./storageMode', () => ({
  getStorageMode: () => 'remote',
  getApiBaseUrl: () => '/api',
  getApiSyncToken: () => 'test-token',
  getAsyncStorageDelayMs: () => 0,
}));

function emptyCloudBundle() {
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    exportedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: 0,
    format: 'dongshan-localStorage-snapshot-v1',
    keys: {},
  };
}

describe('remote sync write flushing', () => {
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
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('withRemoteStorageWrite waits for the debounced PUT before resolving', async () => {
    const { withRemoteStorageWrite } = await import('./remoteSyncHub');

    await withRemoteStorageWrite(() => {
      localStorage.setItem('dongshan_store_code_v1', JSON.stringify('007'));
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      bundle?: { keys?: Record<string, string | null> };
      partialKeys?: string[];
    };
    expect(body.bundle?.keys?.dongshan_store_code_v1).toBe('"007"');
    expect(body.partialKeys).toEqual(['dongshan_store_code_v1']);
    expect(Object.keys(body.bundle?.keys ?? {})).toEqual(['dongshan_store_code_v1']);
  });

  it('withRemoteStorageWriteDeferPush resolves before the debounced PUT completes', async () => {
    vi.useFakeTimers();
    const { withRemoteStorageWriteDeferPush, awaitRemotePushIdle } = await import('./remoteSyncHub');

    await withRemoteStorageWriteDeferPush(() => {
      localStorage.setItem('dongshan_store_code_v1', JSON.stringify('010'));
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).not.toHaveBeenCalled();

    const flushPromise = awaitRemotePushIdle();
    await vi.runAllTimersAsync();
    await flushPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
  });

  it('keeps a failed deferred push queued so it can retry', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { withRemoteStorageWriteDeferPush, awaitRemotePushIdle } = await import('./remoteSyncHub');

    await withRemoteStorageWriteDeferPush(() => {
      localStorage.setItem('dongshan_store_code_v1', JSON.stringify('011'));
    });

    const firstFlush = awaitRemotePushIdle();
    await vi.runOnlyPendingTimersAsync();
    await firstFlush;

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
  });

  it('syncRemoteAfterDirectLocalMutation pushes already-written local changes', async () => {
    const { syncRemoteAfterDirectLocalMutation } = await import('./remoteSyncHub');

    localStorage.setItem('dongshan_store_code_v1', JSON.stringify('008'));
    await syncRemoteAfterDirectLocalMutation();

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      bundle?: { keys?: Record<string, string | null> };
      partialKeys?: string[];
    };
    expect(body.bundle?.keys?.dongshan_store_code_v1).toBe('"008"');
    expect(body.partialKeys).toBeUndefined();
    expect(Object.keys(body.bundle?.keys ?? {}).length).toBeGreaterThan(1);
  });

  it('refreshRemoteBundleNow imports the latest cloud bundle without waiting for the visibility throttle', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          bundle: {
            ...emptyCloudBundle(),
            updatedAt: 123,
            keys: {
              dongshan_store_code_v1: JSON.stringify('cloud-store'),
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const { refreshRemoteBundleNow } = await import('./remoteSyncHub');

    localStorage.setItem('dongshan_store_code_v1', JSON.stringify('stale-local'));
    const refreshed = await refreshRemoteBundleNow('測試讀取最新雲端資料');

    expect(refreshed).toBe(true);
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe(JSON.stringify('cloud-store'));
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('fetches and merges the cloud bundle only after a version conflict', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'VERSION_CONFLICT' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, bundle: emptyCloudBundle() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { withRemoteStorageWrite } = await import('./remoteSyncHub');

    await withRemoteStorageWrite(() => {
      localStorage.setItem('dongshan_store_code_v1', JSON.stringify('009'));
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PUT');
  });

  it('retains an immediate failed order and retries the same id without creating a second order', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 413 }))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([{
      id: 'previous', source: 'procurement', status: '已完成',
      createdAt: '2026-10-23T10:00:00.000Z', updatedAt: '2026-10-23T20:00:00.000Z',
      orderDateYmd: '2026-10-23', scopeId: 'scope:hq', totalAmount: 150, payableAmount: 150,
      itemCount: 10, lines: [{ productId: 'duck', name: '鴨頭', qty: 10, unitPrice: 15, unit: '支' }],
      stallCountBasisYmd: '2026-10-23', stallCountCompletedAt: '2026-10-23T20:00:00.000Z',
      stallCountSnapshot: { lines: { duck: { out: '10', remain: '5' } },
        actualRevenue: '75', updatedAt: '2026-10-23T20:00:00.000Z' },
    }]));
    const { orders } = await import('./apiService');
    const { RemoteWritePendingError } = await import('../lib/remoteWritePendingError');
    const { awaitRemotePushIdle, hasPendingRemotePush } = await import('./remoteSyncHub');
    const error = await orders.appendProcurementOrderEntry({
      lines: [{ productId: 'duck', name: '鴨頭', qty: 13, unitPrice: 15, unit: '支' }],
      totalAmount: 195, actorRole: 'admin', orderDateYmd: '2026-10-24',
      procurementDeductionBasisOrderId: 'previous',
      procurementDeductionAppliedQtyByBasisOrderId: { previous: { duck: 5 } },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteWritePendingError);
    const id = (error as InstanceType<typeof RemoteWritePendingError>).localResult;
    expect(typeof id).toBe('string');
    expect(hasPendingRemotePush()).toBe(true);
    const inventoryBeforeRetry = localStorage.getItem('dongshan_stall_inventory_v1');
    await awaitRemotePushIdle();
    expect(hasPendingRemotePush()).toBe(false);
    const rows = JSON.parse(localStorage.getItem('dongshan_franchise_mgmt_orders_v1')!);
    expect(rows).toHaveLength(2);
    const order = rows.find((row: { id: string }) => row.id === id);
    expect(order.lines[0].qty).toBe(13);
    expect(order.procurementDeductionAppliedQtyByBasisOrderId).toEqual({ previous: { duck: 5 } });
    expect(localStorage.getItem('dongshan_stall_inventory_v1')).toBe(inventoryBeforeRetry);
    expect(localStorage.getItem('dongshan_pending_sync_keys_v1')).toBeNull();
  });

  it('recovers failed immediate writes after reload without overwriting unrelated cloud keys', async () => {
    localStorage.setItem('dongshan_store_code_v1', '"007"');
    localStorage.setItem('dongshan_pending_sync_keys_v1', '["dongshan_store_code_v1"]');
    const cloud = { ...emptyCloudBundle(), updatedAt: 100, keys: {
      dongshan_store_code_v1: '"001"', dongshan_sidebar_main_nav_order_v1_admin: '["orders"]',
    } };
    globalThis.fetch = vi.fn(async (_url, init) => new Response(JSON.stringify(
      init?.method === 'GET' ? { ok: true, bundle: cloud } : { ok: true },
    ), { status: 200 }));
    const { initRemoteSyncOnAppLoad, hasPendingRemotePush } = await import('./remoteSyncHub');
    await initRemoteSyncOnAppLoad();
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"007"');
    expect(localStorage.getItem('dongshan_sidebar_main_nav_order_v1_admin')).toBe('["orders"]');
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT']);
    expect(hasPendingRemotePush()).toBe(false);
  });

  it('does not report a successful save when all version conflict retries fail', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (_url, init) => new Response(JSON.stringify(
      init?.method === 'GET' ? { ok: true, bundle: emptyCloudBundle() } : { ok: false },
    ), { status: init?.method === 'GET' ? 200 : 409 }));
    const { pushRemoteBundleWithAutoMerge, hasPendingRemotePush, getRemoteSyncStatus } = await import('./remoteSyncHub');
    localStorage.setItem('dongshan_store_code_v1', '"007"');
    const { serializeDongshanDataBundle } = await import('../lib/appDataBundle');
    await expect(pushRemoteBundleWithAutoMerge(
      serializeDongshanDataBundle(), ['dongshan_store_code_v1'],
    )).rejects.toThrow('雲端已有更新');
    expect(hasPendingRemotePush()).toBe(true);
    expect(getRemoteSyncStatus()).not.toBe('ok');
  });

  it('does not overwrite local edits made while a background refresh is fetching', async () => {
    let finishGet!: (res: Response) => void;
    globalThis.fetch = vi.fn((_url, init) => init?.method === 'GET'
      ? new Promise<Response>((resolve) => { finishGet = resolve; })
      : Promise.resolve(new Response('{"ok":true}', { status: 200 })));
    const { refreshRemoteBundleNow, withRemoteStorageWriteDeferPush, awaitRemotePushIdle } = await import('./remoteSyncHub');
    const refreshing = refreshRemoteBundleNow();
    await withRemoteStorageWriteDeferPush(() => localStorage.setItem('dongshan_store_code_v1', '"007"'));
    finishGet(new Response(JSON.stringify({ ok: true, bundle: {
      ...emptyCloudBundle(), updatedAt: 100, keys: { dongshan_store_code_v1: '"001"' },
    } }), { status: 200 }));
    expect(await refreshing).toBe(false);
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"007"');
    await awaitRemotePushIdle();
    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body)).syncedFromUpdatedAt).toBe(0);
  });

  it('does not apply an old GET snapshot that arrives after a newer local push has completed', async () => {
    let finishGet!: (res: Response) => void;
    globalThis.fetch = vi.fn((_url, init) => init?.method === 'GET'
      ? new Promise<Response>((resolve) => { finishGet = resolve; })
      : Promise.resolve(new Response('{"ok":true,"updatedAt":2000000000000}', { status: 200 })));
    const { refreshRemoteBundleNow, withRemoteStorageWrite, pushRemoteBundle } = await import('./remoteSyncHub');
    const refreshing = refreshRemoteBundleNow();
    await withRemoteStorageWrite(() => localStorage.setItem('dongshan_store_code_v1', '"007"'));
    finishGet(new Response(JSON.stringify({ ok: true, bundle: {
      ...emptyCloudBundle(), updatedAt: 100, keys: { dongshan_store_code_v1: '"001"' },
    } }), { status: 200 }));
    expect(await refreshing).toBe(false);
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"007"');
    await pushRemoteBundle();
    const last = vi.mocked(fetch).mock.calls.at(-1);
    expect(JSON.parse(String(last?.[1]?.body)).syncedFromUpdatedAt).toBe(2000000000000);
  });

  it('journals deferred edits before the debounce so a restart can recover them', async () => {
    vi.useFakeTimers();
    const { withRemoteStorageWriteDeferPush } = await import('./remoteSyncHub');
    await withRemoteStorageWriteDeferPush(() => localStorage.setItem('dongshan_store_code_v1', '"007"'));
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('dongshan_pending_sync_keys_v1')!)).toContain('dongshan_store_code_v1');
    vi.clearAllTimers();
    vi.resetModules();
    globalThis.fetch = vi.fn(async (_url, init) => new Response(JSON.stringify(
      init?.method === 'GET' ? { ok: true, bundle: {
        ...emptyCloudBundle(), updatedAt: 100, keys: { dongshan_store_code_v1: '"001"' },
      } } : { ok: true },
    ), { status: 200 }));
    const { initRemoteSyncOnAppLoad, hasPendingRemotePush } = await import('./remoteSyncHub');
    await initRemoteSyncOnAppLoad();
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"007"');
    expect(hasPendingRemotePush()).toBe(false);
  });

  it('waits for cloud acknowledgement before reporting a completed inventory and sends all three stores', async () => {
    const { orders } = await import('./apiService');
    const id = await orders.appendProcurementOrderEntry({
      lines: [{ productId: 'duck', name: '鴨頭', qty: 18, unitPrice: 15, unit: '支' }],
      totalAmount: 270, actorRole: 'admin', orderDateYmd: '2026-10-24',
    });
    let finishPut!: (res: Response) => void;
    let putStarted!: () => void;
    const started = new Promise<void>((resolve) => { putStarted = resolve; });
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { finishPut = resolve; putStarted(); }));
    const snapshot = { lines: { duck: { out: '18', remain: '5' } }, actualRevenue: '195', updatedAt: '2026-10-24T10:00:00.000Z' };
    let done = false;
    const completion = orders.commitStallInventoryComplete({
      orderId: id, basisYmd: '2026-10-24', completedAt: snapshot.updatedAt,
      recordSnap: snapshot, stallDaySnap: snapshot, scopeId: 'scope:hq',
    }).then((res) => { done = true; return res; });
    await started;
    expect(done).toBe(false);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.partialKeys).toEqual(expect.arrayContaining([
      'dongshan_franchise_mgmt_orders_v1', 'dongshan_stall_inventory_v1', 'dongshan_sales_records_v1',
    ]));
    finishPut(new Response('{"ok":true,"updatedAt":2000000000000}', { status: 200 }));
    expect(await completion).toEqual({ ok: true });
    expect(done).toBe(true);
    const { getSalesRecord } = await import('../lib/salesRecordStorage');
    const { readMergedOrderByIdFromStores } = await import('../lib/orderHistoryStorage');
    expect(getSalesRecord('2026-10-24', 'scope:hq')?.actualRevenue).toBe('195');
    expect(readMergedOrderByIdFromStores(id)?.stallCountCompletedAt).toBe(snapshot.updatedAt);
  });

  it('retains inventory completion on sync failure and retries it without rerunning the business operation', async () => {
    vi.useFakeTimers();
    const { orders } = await import('./apiService');
    const id = await orders.appendProcurementOrderEntry({
      lines: [{ productId: 'duck', name: '鴨頭', qty: 18, unitPrice: 15, unit: '支' }],
      totalAmount: 270, actorRole: 'admin', orderDateYmd: '2026-10-24',
    });
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const snapshot = { lines: { duck: { out: '18', remain: '5' } }, actualRevenue: '195', updatedAt: '2026-10-24T10:00:00.000Z' };
    const error = await orders.commitStallInventoryComplete({
      orderId: id, basisYmd: '2026-10-24', completedAt: snapshot.updatedAt,
      recordSnap: snapshot, stallDaySnap: snapshot, scopeId: 'scope:hq',
    }).catch((e: unknown) => e);
    const { RemoteWritePendingError } = await import('../lib/remoteWritePendingError');
    expect(error).toBeInstanceOf(RemoteWritePendingError);
    const beforeRetry = localStorage.getItem('dongshan_sales_records_v1');
    const { hasPendingRemotePush, awaitRemotePushIdle } = await import('./remoteSyncHub');
    expect(hasPendingRemotePush()).toBe(true);
    await awaitRemotePushIdle();
    expect(hasPendingRemotePush()).toBe(false);
    expect(localStorage.getItem('dongshan_sales_records_v1')).toBe(beforeRetry);
  });

  it('keeps new local orders made during a conflict merge and cloud-only orders in the next queued push', async () => {
    let finishGet!: (res: Response) => void;
    let getStarted!: () => void;
    const started = new Promise<void>((resolve) => { getStarted = resolve; });
    const order = (id: string) => ({ id, createdAt: '2026-10-24T00:00:00.000Z', source: 'procurement', status: '待出貨', lines: [] });
    let firstPut = true;
    globalThis.fetch = vi.fn((_url, init) => {
      if (init?.method === 'GET') return new Promise<Response>((resolve) => { finishGet = resolve; getStarted(); });
      if (firstPut) { firstPut = false; return Promise.resolve(new Response('{}', { status: 409 })); }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
    const { withRemoteStorageWriteDeferPush, awaitRemotePushIdle } = await import('./remoteSyncHub');
    await withRemoteStorageWriteDeferPush(() => localStorage.setItem('dongshan_order_history_v1', JSON.stringify([order('local-a')])));
    const first = awaitRemotePushIdle();
    await started;
    await withRemoteStorageWriteDeferPush(() => localStorage.setItem('dongshan_order_history_v1', JSON.stringify([order('local-a'), order('local-b')])));
    finishGet(new Response(JSON.stringify({ ok: true, bundle: {
      ...emptyCloudBundle(), updatedAt: 100, keys: { dongshan_order_history_v1: JSON.stringify([order('cloud-c')]) },
    } }), { status: 200 }));
    await first;
    expect(JSON.parse(localStorage.getItem('dongshan_order_history_v1')!).map((o: { id: string }) => o.id).sort())
      .toEqual(['cloud-c', 'local-a', 'local-b']);
    await awaitRemotePushIdle();
    const puts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT');
    const last = JSON.parse(String(puts.at(-1)?.[1]?.body));
    expect(JSON.parse(last.bundle.keys.dongshan_order_history_v1).map((o: { id: string }) => o.id).sort())
      .toEqual(['cloud-c', 'local-a', 'local-b']);
  });
});
