import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { REMOTE_SYNC_VERSION_CONFLICT_EVENT } from '../services/remoteSyncHub';
import { getStorageMode } from '../services/storageMode';

export default function RemoteSyncVersionConflictModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (getStorageMode() !== 'remote') return;

    const show = () => setOpen(true);
    window.addEventListener(REMOTE_SYNC_VERSION_CONFLICT_EVENT, show);
    return () => window.removeEventListener(REMOTE_SYNC_VERSION_CONFLICT_EVENT, show);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remote-sync-conflict-title"
    >
      <div className="w-full max-w-lg rounded-2xl border-2 border-red-600/80 bg-zinc-950 p-6 shadow-[0_0_40px_rgba(220,38,38,0.35)]">
        <div className="flex items-start gap-4">
          <span className="relative mt-0.5 inline-flex h-10 w-10 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75 [animation-duration:0.9s]" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-600 ring-4 ring-red-900/40">
              <AlertTriangle className="h-5 w-5 text-white" aria-hidden />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="remote-sync-conflict-title"
              className="text-lg font-semibold text-red-400 sm:text-xl"
            >
              同步失敗！
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-200 sm:text-base">
              其他裝置（例如攤位盤點）已在不久前更新了最新數據。為了防止資料被覆蓋，本機已被鎖定。請立刻重新整理網頁，取得最新資料後再行操作。
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            onClick={() => window.location.reload()}
          >
            立刻重新整理
          </button>
        </div>
      </div>
    </div>
  );
}
