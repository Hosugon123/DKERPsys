/**
 * 雲端 409 衝突後，重新整理會以遠端 bundle 覆寫本機；此處暫存衝突當下的本機快照，載入後還原再嘗試推送。
 */
import {
  importDongshanDataBundle,
  parseBundleJson,
  serializeDongshanDataBundle,
} from './appDataBundle';

const RECOVERY_KEY = 'dongshan_conflict_recovery_bundle_v1';

export function stashLocalBundleForConflictRecovery(): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, serializeDongshanDataBundle());
  } catch {
    /* quota / private mode */
  }
}

export function hasConflictRecoveryBundle(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) != null;
  } catch {
    return false;
  }
}

export function clearConflictRecoveryBundle(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}

/** 讀取並清除暫存；無資料時回傳 null */
function takeConflictRecoveryRaw(): string | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    sessionStorage.removeItem(RECOVERY_KEY);
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
  const raw = takeConflictRecoveryRaw();
  if (!raw?.trim()) return false;
  try {
    const parsed = parseBundleJson(raw);
    const result = importDongshanDataBundle(parsed);
    return result.ok;
  } catch {
    return false;
  }
}
