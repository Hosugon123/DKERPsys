import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ status: 'ok', pending: false, locked: false, mode: 'remote' }));
vi.mock('../services/storageMode', () => ({ getStorageMode: () => state.mode }));
vi.mock('../services/remoteSyncHub', () => ({
  getRemoteSyncStatus: () => state.status, hasPendingRemotePush: () => state.pending,
  isRemoteSyncLocked: () => state.locked, REMOTE_SYNC_STATUS_EVENT: 'sync-test', retryPendingRemotePush: vi.fn(),
}));
import RemoteSyncIndicator from './RemoteSyncIndicator';
describe('global sync status visibility', () => {
  it('shows pending, failure and blocked states without hiding an upload failure', () => {
    state.pending = true; state.status = 'idle';
    expect(renderToStaticMarkup(createElement(RemoteSyncIndicator))).toContain('資料同步中');
    state.status = 'offline';
    const offline = renderToStaticMarkup(createElement(RemoteSyncIndicator));
    expect(offline).toContain('請勿重複打單');
    expect(offline).toContain('重試同步');
    state.locked = true;
    expect(renderToStaticMarkup(createElement(RemoteSyncIndicator))).toContain('已暫停寫入');
    state.locked = false; state.pending = false; state.status = 'ok';
    expect(renderToStaticMarkup(createElement(RemoteSyncIndicator))).toBe('');
  });
});
