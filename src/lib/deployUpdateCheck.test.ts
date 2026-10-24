import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pending: false, unsaved: false }));
vi.mock('../services/remoteSyncHub', () => ({ hasPendingRemotePush: () => state.pending }));
vi.mock('./unsavedWorkGuard', () => ({ canReloadAppShell: () => !state.unsaved }));
vi.mock('./appRefresh', () => ({ reloadAppShell: vi.fn() }));
import { applyDeployUpdateReload } from './deployUpdateCheck';
import { reloadAppShell } from './appRefresh';
describe('deployment reload safety', () => {
  beforeEach(() => { state.pending = false; state.unsaved = false; vi.clearAllMocks(); });
  it('does not reload while saved local data still needs cloud acknowledgement', () => {
    state.pending = true;
    expect(applyDeployUpdateReload()).toBe(false);
    expect(reloadAppShell).not.toHaveBeenCalled();
  });
  it('does not reload while a form has unsaved work', () => {
    state.unsaved = true;
    expect(applyDeployUpdateReload()).toBe(false);
  });
  it('can reload once both local editing and cloud synchronization are finished', () => {
    expect(applyDeployUpdateReload()).toBe(true);
    expect(reloadAppShell).toHaveBeenCalledOnce();
  });
});
