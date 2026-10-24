/**
 * 舊版衝突快照：與最新資料合併復原，確認上傳成功後才移除備份。
 */
import {
  importDongshanDataBundle,
  parseBundleJson,
  serializeDongshanDataBundle,
  buildDongshanDataBundle,
  mergeDongshanBundlesLocalWinsDirty,
  type DongshanDataBundleV1,
} from './appDataBundle';
import { setLocalStorageItemWithQuotaRecovery } from './localStorageGuard';

const RECOVERY_KEY = 'dongshan_conflict_recovery_bundle_v1';

export function stashLocalBundleForConflictRecovery(): void {
  try {
    setLocalStorageItemWithQuotaRecovery(RECOVERY_KEY, serializeDongshanDataBundle());
  } catch {
    /* quota / private mode */
  }
}

export function hasConflictRecoveryBundle(): boolean {
  try {
    return localStorage.getItem(RECOVERY_KEY) != null;
  } catch {
    return false;
  }
}

export function clearConflictRecoveryBundle(): void {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}

/** 保留到雲端確認成功，避免復原／上傳失敗時連備份也遺失。 */
function readConflictRecoveryRaw(): string | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    return raw;
  } catch {
    return null;
  }
}

/**
 * 於已匯入遠端 bundle 之後呼叫：還原衝突前的本機快照並觸發 storage 同步事件。
 * @returns 是否成功還原
 */
export function applyConflictRecoveryAfterRemoteImport(): boolean {
  const raw = readConflictRecoveryRaw();
  if (!raw?.trim()) return false;
  try {
    const parsed = parseBundleJson(raw) as DongshanDataBundleV1;
    if (!parsed?.keys || typeof parsed.keys !== 'object') return false;
    const merged = mergeDongshanBundlesLocalWinsDirty(parsed, buildDongshanDataBundle(), []);
    const result = importDongshanDataBundle(merged);
    return result.ok;
  } catch {
    return false;
  }
}
