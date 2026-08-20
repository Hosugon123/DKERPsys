const RECOVERABLE_LOCAL_STORAGE_KEYS = [
  'dongshan_conflict_recovery_bundle_v1',
  'dongshan_pwa_icon_v1',
  'dongshan_performance_debug_v1',
] as const;

export class LocalStorageQuotaError extends Error {
  readonly key: string;
  readonly attemptedChars: number;
  readonly recoveredKeys: string[];
  readonly cause?: unknown;

  constructor(params: {
    key: string;
    attemptedChars: number;
    recoveredKeys?: readonly string[];
    cause?: unknown;
  }) {
    super(
      `瀏覽器儲存空間已滿，無法寫入 ${params.key}。` +
        `請先關閉其他分頁後重試；若仍失敗，請聯絡管理員清理本機暫存或進行資料歸檔。`,
    );
    this.name = 'LocalStorageQuotaError';
    this.key = params.key;
    this.attemptedChars = params.attemptedChars;
    this.recoveredKeys = [...(params.recoveredKeys ?? [])];
    this.cause = params.cause;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name.toLowerCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    name === 'quotaexceedederror' ||
    name === 'ns_error_dom_quota_reached' ||
    e.code === 22 ||
    e.code === 1014 ||
    message.includes('quota') ||
    message.includes('exceeded')
  );
}

function removeRecoverableStorageKeys(skipKey: string): string[] {
  const removed: string[] = [];
  for (const key of RECOVERABLE_LOCAL_STORAGE_KEYS) {
    if (key === skipKey) continue;
    try {
      if (localStorage.getItem(key) == null) continue;
      localStorage.removeItem(key);
      removed.push(key);
    } catch {
      /* ignore cleanup failures */
    }
  }
  return removed;
}

export function setLocalStorageItemWithQuotaRecovery(key: string, value: string): string[] {
  try {
    localStorage.setItem(key, value);
    return [];
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    const recoveredKeys = removeRecoverableStorageKeys(key);
    if (recoveredKeys.length > 0) {
      try {
        localStorage.setItem(key, value);
        return recoveredKeys;
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) throw retryError;
        throw new LocalStorageQuotaError({
          key,
          attemptedChars: value.length,
          recoveredKeys,
          cause: retryError,
        });
      }
    }
    throw new LocalStorageQuotaError({
      key,
      attemptedChars: value.length,
      recoveredKeys,
      cause: error,
    });
  }
}
