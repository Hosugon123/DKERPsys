/**
 * 儲存後端模式（建置時由 Vite 注入 import.meta.env）。
 * - localStorage：現行本機實作（lib/*Storage）
 * - remote：預留 Cloud SQL／REST；尚未接線時呼叫會拋錯
 */
export type StorageMode = 'localStorage' | 'remote';

export function getStorageMode(): StorageMode {
  const raw = import.meta.env.VITE_STORAGE_MODE;
  if (raw === 'remote') return 'remote';
  return 'localStorage';
}

/** 後端 API 根路徑（僅 remote 模式使用） */
export function getApiBaseUrl(): string {
  return String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
}

/** 模擬網路延遲（毫秒），0–2000 */
export function getAsyncStorageDelayMs(): number {
  const n = Number(import.meta.env.VITE_ASYNC_STORAGE_DELAY_MS ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(2000, Math.floor(n));
}
