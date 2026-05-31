import { useEffect, useState } from 'react';
import {
  getRemoteSyncStatus,
  REMOTE_SYNC_STATUS_EVENT,
  REMOTE_SYNC_VERSION_CONFLICT_EVENT,
  type RemoteSyncStatus,
} from '../services/remoteSyncHub';
import { getStorageMode } from '../services/storageMode';

function statusTitle(s: RemoteSyncStatus): string {
  switch (s) {
    case 'version_conflict':
      return '同步失敗：雲端已有更新的資料，請重新整理網頁';
    case 'offline':
      return '離線模式：無法連線雲端（變更僅存在本機，恢復連線後請重新整理）';
    case 'auth_error':
      return '同步失敗：Token 錯誤或未設定（請檢查 VITE_API_SYNC_TOKEN／API_SYNC_TOKEN）';
    case 'error':
      return '同步失敗：雲端回應異常，請稍後再試';
    default:
      return '同步狀態異常';
  }
}

type RemoteSyncIndicatorProps = {
  /** 例如登入頁用 fixed 置頂；Topbar 內用 inline */
  className?: string;
};

export default function RemoteSyncIndicator({ className = '' }: RemoteSyncIndicatorProps) {
  const [status, setStatus] = useState<RemoteSyncStatus>(() => getRemoteSyncStatus());

  useEffect(() => {
    const h = () => setStatus(getRemoteSyncStatus());
    window.addEventListener(REMOTE_SYNC_STATUS_EVENT, h);
    return () => window.removeEventListener(REMOTE_SYNC_STATUS_EVENT, h);
  }, []);

  if (getStorageMode() !== 'remote') return null;
  if (status === 'idle' || status === 'ok') return null;

  const title = statusTitle(status);
  const isConflict = status === 'version_conflict';

  return (
    <span
      className={`relative inline-flex shrink-0 ${isConflict ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} ${className}`}
      title={title}
      aria-label={title}
      role="status"
    >
      <span
        className={`absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80 ${
          isConflict ? 'animate-ping [animation-duration:0.85s]' : 'animate-ping'
        }`}
      />
      <span
        className={`relative inline-flex rounded-full bg-red-600 ring-2 ring-red-900/50 ${
          isConflict ? 'h-3.5 w-3.5 animate-pulse' : 'h-2.5 w-2.5'
        }`}
      />
    </span>
  );
}
