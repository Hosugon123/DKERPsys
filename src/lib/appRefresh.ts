/**
 * 全頁下拉重新整理：遠端模式拉取 sync-bundle；本機模式廣播各模組更新事件。
 * 手機下拉另可觸發整頁重新載入，以取得最新部署的 JS/CSS（等同瀏覽器重新整理）。
 */
import { getStorageMode } from '../services/storageMode';
import {
  fetchRemoteBundle,
  hasPendingRemotePush,
} from '../services/remoteSyncHub';
import {
  buildDongshanDataBundle,
  DONGSHAN_EXPORT_STORAGE_KEYS,
  dispatchDongshanStorageSyncEvents,
  importDongshanDataBundle,
  mergeDongshanBundlesLocalWinsDirty,
} from './appDataBundle';
import { canReloadAppShell, hasUnsavedWork } from './unsavedWorkGuard';

export const APP_PAGE_REFRESH_EVENT = 'appPageRefresh';

/** 下拉重整用於略過 CDN／瀏覽器快取的查詢參數（載入後會由 App 清除） */
export const PULL_RELOAD_QUERY_KEY = '_ptr';

export type RefreshAppPageOptions = {
  /**
   * 同步資料後重新載入整頁（僅 production 建置）。
   * 開發模式仍只重掛元件，避免中斷 Vite HMR。
   */
  reloadShell?: boolean;
};

/** 強制重新載入頁面（帶快取破除參數，載入後由 App 還原網址） */
export function reloadAppShell(): void {
  if (!canReloadAppShell()) return;
  const url = new URL(window.location.href);
  url.searchParams.delete(PULL_RELOAD_QUERY_KEY);
  url.searchParams.set(PULL_RELOAD_QUERY_KEY, String(Date.now()));
  window.location.replace(url.toString());
}

export async function refreshAppPageData(options?: RefreshAppPageOptions): Promise<void> {
  if (getStorageMode() === 'remote') {
    const cloud = await fetchRemoteBundle();
    const local = buildDongshanDataBundle();
    const dirty =
      hasUnsavedWork() || hasPendingRemotePush() ? [...DONGSHAN_EXPORT_STORAGE_KEYS] : [];
    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, dirty);
    const result = importDongshanDataBundle(merged);
    if (result.ok === false) {
      throw new Error(result.error);
    }
  } else {
    dispatchDongshanStorageSyncEvents();
  }

  if (options?.reloadShell && import.meta.env.PROD) {
    if (canReloadAppShell()) {
      reloadAppShell();
      return;
    }
  }

  window.dispatchEvent(new Event(APP_PAGE_REFRESH_EVENT));
}
