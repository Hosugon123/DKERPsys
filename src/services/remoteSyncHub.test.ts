import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('withRemoteStorageWrite waits for the debounced PUT before resolving', async () => {
    const { withRemoteStorageWrite } = await import('./remoteSyncHub');

    await withRemoteStorageWrite(() => {
      localStorage.setItem('dongshan_store_code_v1', JSON.stringify('007'));
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}')) as {
      bundle?: { keys?: Record<string, string | null> };
    };
    expect(body.bundle?.keys?.dongshan_store_code_v1).toBe('"007"');
  });

  it('syncRemoteAfterDirectLocalMutation pushes already-written local changes', async () => {
    const { syncRemoteAfterDirectLocalMutation } = await import('./remoteSyncHub');

    localStorage.setItem('dongshan_store_code_v1', JSON.stringify('008'));
    await syncRemoteAfterDirectLocalMutation();

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}')) as {
      bundle?: { keys?: Record<string, string | null> };
    };
    expect(body.bundle?.keys?.dongshan_store_code_v1).toBe('"008"');
  });
});
