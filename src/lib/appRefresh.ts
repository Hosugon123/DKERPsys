/**
 * 全頁下拉重新整理：遠端模式拉取 sync-bundle；本機模式廣播各模組更新事件。
 */
import { getStorageMode } from '../services/storageMode';
import { fetchRemoteBundle } from '../services/remoteSyncHub';
import { dispatchDongshanStorageSyncEvents, importDongshanDataBundle } from './appDataBundle';

export const APP_PAGE_REFRESH_EVENT = 'appPageRefresh';

export async function refreshAppPageData(): Promise<void> {
  if (getStorageMode() === 'remote') {
    const bundle = await fetchRemoteBundle();
    const result = importDongshanDataBundle(bundle);
    if (!result.ok) {
      throw new Error(result.error);
    }
  } else {
    dispatchDongshanStorageSyncEvents();
  }
  window.dispatchEvent(new Event(APP_PAGE_REFRESH_EVENT));
}
