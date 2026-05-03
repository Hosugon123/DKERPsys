/**
 * 雲端 bundle 同步（VITE_STORAGE_MODE=remote）：啟動拉取、寫入後推送、狀態廣播。
 */
import {
  DONGSHAN_EXPORT_STORAGE_KEYS,
  buildDongshanDataBundle,
  importDongshanDataBundle,
  parseBundleJson,
  serializeDongshanDataBundle,
  type DongshanDataBundleV1,
} from '../lib/appDataBundle';
import { getApiBaseUrl, getApiSyncToken, getAsyncStorageDelayMs, getStorageMode } from './storageMode';

export const REMOTE_SYNC_STATUS_EVENT = 'dongshanRemoteSyncStatus';

export type RemoteSyncStatus = 'idle' | 'ok' | 'offline' | 'auth_error' | 'error';

let lastStatus: RemoteSyncStatus = 'idle';

export function getRemoteSyncStatus(): RemoteSyncStatus {
  return lastStatus;
}

function dispatchStatus(s: RemoteSyncStatus): void {
  lastStatus = s;
  window.dispatchEvent(new CustomEvent(REMOTE_SYNC_STATUS_EVENT, { detail: s }));
}

function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function isNetworkishError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('network request failed')
  );
}

function statusFromResponse(res: Response): RemoteSyncStatus {
  if (res.status === 401 || res.status === 403) return 'auth_error';
  return 'error';
}

/** 雲端回傳的 bundle 是否視為「尚無有效資料」（可改以本地一次性上傳）。 */
export function isRemoteBundleEffectivelyEmpty(bundle: DongshanDataBundleV1 | null | undefined): boolean {
  if (bundle == null) return true;
  const keys = bundle.keys;
  if (keys == null || typeof keys !== 'object' || Array.isArray(keys)) return true;
  const entries = Object.entries(keys);
  if (entries.length === 0) return true;
  for (const [, v] of entries) {
    if (v != null && String(v).length > 0) return false;
  }
  return true;
}

/** 本地是否有納入同步之任一鍵有內容。 */
export function localExportStorageHasData(): boolean {
  for (const k of DONGSHAN_EXPORT_STORAGE_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null && v !== '') return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

async function storageTick(): Promise<void> {
  const ms = getAsyncStorageDelayMs();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export async function fetchRemoteBundle(): Promise<DongshanDataBundleV1> {
  const token = getApiSyncToken();
  if (!token) {
    throw new Error('遠端同步缺少 VITE_API_SYNC_TOKEN。');
  }
  const res = await fetch(buildApiUrl('/sync-bundle'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`GET ${res.status}`), { syncStatus: statusFromResponse(res) });
  }
  const body = (await res.json()) as { ok?: boolean; bundle?: DongshanDataBundleV1 };
  if (!body?.ok || !body.bundle) {
    throw new Error('遠端同步回應格式錯誤。');
  }
  return body.bundle;
}

export async function pushRemoteBundle(bundleText?: string): Promise<void> {
  const token = getApiSyncToken();
  if (!token) {
    throw new Error('遠端同步缺少 VITE_API_SYNC_TOKEN。');
  }
  const raw = bundleText ?? serializeDongshanDataBundle();
  const bundle = parseBundleJson(raw) as DongshanDataBundleV1;
  const res = await fetch(buildApiUrl('/sync-bundle'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ bundle }),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`PUT ${res.status}`), { syncStatus: statusFromResponse(res) });
  }
}

function applySyncFailureFromUnknown(e: unknown): void {
  if (e && typeof e === 'object' && 'syncStatus' in e) {
    const s = (e as { syncStatus?: RemoteSyncStatus }).syncStatus;
    if (s === 'auth_error' || s === 'error') {
      dispatchStatus(s);
      return;
    }
  }
  if (isNetworkishError(e)) dispatchStatus('offline');
  else dispatchStatus('error');
}

/**
 * 應用程式啟動／重新整理時呼叫一次：先 GET；雲端有資料則覆蓋本地；雲端空且本地有資料則 PUT 上傳。
 */
export async function initRemoteSyncOnAppLoad(): Promise<void> {
  if (getStorageMode() !== 'remote') {
    dispatchStatus('idle');
    return;
  }

  dispatchStatus('idle');

  try {
    const bundle = await fetchRemoteBundle();

    if (!isRemoteBundleEffectivelyEmpty(bundle)) {
      const result = importDongshanDataBundle(bundle);
      if (!result.ok) {
        dispatchStatus('error');
        return;
      }
    } else if (localExportStorageHasData()) {
      await pushRemoteBundle();
    }

    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

/**
 * ensureAuthBootstrap 等啟動步驟若改變了 localStorage，於 remote 模式下補一次 PUT。
 */
export async function pushRemoteIfLocalBundleChangedSince(snapshot: string): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  const now = serializeDongshanDataBundle();
  if (now === snapshot) return;
  try {
    await pushRemoteBundle(now);
    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

/**
 * 略過 apiService、已直接寫入 *Storage 時，補送目前整包至雲端。
 */
export async function syncRemoteAfterDirectLocalMutation(): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  try {
    await pushRemoteBundle();
    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

export async function withRemoteStorageRead<T>(fn: () => T | Promise<T>): Promise<T> {
  await storageTick();
  return await Promise.resolve(fn());
}

export async function withRemoteStorageWrite<T>(fn: () => T | Promise<T>): Promise<T> {
  await storageTick();
  if (getStorageMode() !== 'remote') {
    return await Promise.resolve(fn());
  }

  const before = serializeDongshanDataBundle();
  const out = await Promise.resolve(fn());
  const after = serializeDongshanDataBundle();

  if (after === before) {
    return out;
  }

  try {
    await pushRemoteBundle(after);
    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }

  return out;
}
