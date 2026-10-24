import { useEffect, useState } from 'react';
import { CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react';
import { getStorageMode } from '../services/storageMode';
import { getRemoteSyncStatus, hasPendingRemotePush, isRemoteSyncLocked, REMOTE_SYNC_STATUS_EVENT, retryPendingRemotePush } from '../services/remoteSyncHub';

function snapshot() {
  return { status: getRemoteSyncStatus(), pending: hasPendingRemotePush(), locked: isRemoteSyncLocked() };
}

export default function RemoteSyncIndicator({ className = '' }: { className?: string }) {
  const [state, setState] = useState(snapshot);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const refresh = () => setState(snapshot());
    window.addEventListener(REMOTE_SYNC_STATUS_EVENT, refresh);
    refresh();
    return () => window.removeEventListener(REMOTE_SYNC_STATUS_EVENT, refresh);
  }, []);
  if (getStorageMode() !== 'remote') return null;
  const failed = ['offline', 'error', 'auth_error', 'version_conflict'].includes(state.status);
  if (!state.pending && !state.locked && !failed) return null;
  const message = state.locked
    ? '雲端資料尚未載入，已暫停寫入。'
    : failed && state.pending
      ? '資料尚未完成同步，請勿重複打單或清除網站資料。'
      : failed
        ? '無法取得最新雲端資料，請檢查網路後重試。'
      : '資料同步中，請暫勿關閉頁面。';
  const retry = async () => {
    setRetrying(true);
    try { await retryPendingRemotePush(); }
    finally { setRetrying(false); setState(snapshot()); }
  };
  return <div role="status" aria-live="polite" className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-100 px-3 py-2 text-sm text-amber-950 ${className}`}>
    <span className="flex min-w-0 items-center gap-2">
      {failed ? <TriangleAlert size={16} className="shrink-0" /> : <CloudUpload size={16} className="shrink-0" />}
      <span>{message}</span>
    </span>
    {(failed || state.locked || state.pending) && <button type="button" disabled={retrying} onClick={() => void retry()} className="inline-flex shrink-0 items-center gap-1 border border-amber-700/40 px-2 py-1 disabled:opacity-50">
      <RefreshCw size={14} />{retrying ? '重試中' : failed || state.locked ? '重試同步' : '立即同步'}
    </button>}
  </div>;
}
