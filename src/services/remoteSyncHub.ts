/**
 * 雲端 bundle 同步（VITE_STORAGE_MODE=remote）：啟動拉取、寫入後推送、狀態廣播。
 *
 * 多裝置策略：推送前／拉回時依單號 union 合併訂單等紀錄；去抖動推送 + 409 自動合併重試；不彈同步警報。
 */
import {
  DONGSHAN_EXPORT_STORAGE_KEYS,
  buildDongshanDataBundle,
  buildDongshanDataBundleForPush,
  importDongshanDataBundle,
  isRemoteBundleEffectivelyEmpty,
  mergeDongshanBundlesLocalWinsDirty,
  parseBundleJson,
  serializeDongshanDataBundle,
  storageKeysChangedBetweenBundleTexts,
  type DongshanDataBundleV1,
  type DongshanStorageKey,
} from '../lib/appDataBundle';
import {
  applyConflictRecoveryAfterRemoteImport,
  stashLocalBundleForConflictRecovery,
} from '../lib/conflictRecoveryStorage';
import { getApiBaseUrl, getApiSyncToken, getAsyncStorageDelayMs, getStorageMode } from './storageMode';

export const REMOTE_SYNC_STATUS_EVENT = 'dongshanRemoteSyncStatus';
/** 保留事件名稱供舊版相容；衝突改為靜默合併，不再彈出全螢幕警報 */
export const REMOTE_SYNC_VERSION_CONFLICT_EVENT = 'dongshanRemoteSyncVersionConflict';

export type RemoteSyncStatus =
  | 'idle'
  | 'ok'
  | 'offline'
  | 'auth_error'
  | 'error'
  | 'version_conflict';

export class RemoteVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;

  constructor(message = '雲端已有更新的資料') {
    super(message);
    this.name = 'RemoteVersionConflictError';
  }
}

/** 連續寫入合併推送的等待時間（毫秒） */
const PUSH_DEBOUNCE_MS = 900;
/** 409 後自動合併重試次數 */
const MAX_CONFLICT_MERGE_RETRIES = 2;

let lastStatus: RemoteSyncStatus = 'idle';
/** 本機最後一次成功套用之雲端 bundle.updatedAt（用於 PUT 防撞） */
let lastRemoteUpdatedAt = 0;
let remoteSyncLocked = false;

let pushChain: Promise<void> = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAfterText: string | null = null;
const pendingDirtyKeys = new Set<DongshanStorageKey>();

export function getRemoteSyncStatus(): RemoteSyncStatus {
  return lastStatus;
}

export function isRemoteSyncLocked(): boolean {
  return remoteSyncLocked;
}

function noteRemoteBundleUpdatedAt(bundle: DongshanDataBundleV1 | null | undefined): void {
  const ts = bundle?.updatedAt;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts >= 0) {
    lastRemoteUpdatedAt = ts;
  }
}

function dispatchStatus(s: RemoteSyncStatus): void {
  lastStatus = s;
  window.dispatchEvent(new CustomEvent(REMOTE_SYNC_STATUS_EVENT, { detail: s }));
}

function isVersionConflictError(e: unknown): boolean {
  return e instanceof RemoteVersionConflictError;
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

function prepareBundleForPush(bundleText?: string): DongshanDataBundleV1 {
  if (bundleText) {
    const bundle = parseBundleJson(bundleText) as DongshanDataBundleV1;
    bundle.updatedAt = Date.now();
    return bundle;
  }
  return buildDongshanDataBundleForPush();
}

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
  noteRemoteBundleUpdatedAt(body.bundle);
  return body.bundle;
}

export async function pushRemoteBundle(bundleText?: string): Promise<void> {
  const token = getApiSyncToken();
  if (!token) {
    throw new Error('遠端同步缺少 VITE_API_SYNC_TOKEN。');
  }

  const bundle = prepareBundleForPush(bundleText);
  const res = await fetch(buildApiUrl('/sync-bundle'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      bundle,
      syncedFromUpdatedAt: lastRemoteUpdatedAt,
    }),
  });

  if (res.status === 409) {
    throw new RemoteVersionConflictError();
  }

  if (!res.ok) {
    throw Object.assign(new Error(`PUT ${res.status}`), { syncStatus: statusFromResponse(res) });
  }

  noteRemoteBundleUpdatedAt(bundle);
}

async function mergeCloudWithLocalDirty(
  localBundleText: string,
  dirtyKeys: readonly DongshanStorageKey[],
): Promise<string> {
  const cloud = await fetchRemoteBundle();
  const local = parseBundleJson(localBundleText) as DongshanDataBundleV1;
  const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, dirtyKeys);
  const result = importDongshanDataBundle(merged);
  if (!result.ok) {
    throw new Error(result.error);
  }
  noteRemoteBundleUpdatedAt(cloud);
  return JSON.stringify(merged);
}

async function reconcileLocalBundleWithCloudBeforePush(
  bundleText: string,
  dirtyKeys: readonly DongshanStorageKey[],
): Promise<string> {
  const cloud = await fetchRemoteBundle();
  if (isRemoteBundleEffectivelyEmpty(cloud)) return bundleText;
  const local = parseBundleJson(bundleText) as DongshanDataBundleV1;
  const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, dirtyKeys);
  const result = importDongshanDataBundle(merged);
  if (!result.ok) throw new Error(result.error);
  noteRemoteBundleUpdatedAt(cloud);
  return JSON.stringify(merged);
}

async function pushBundleTextWithAutoMerge(
  bundleText: string,
  dirtyKeys: readonly DongshanStorageKey[],
): Promise<void> {
  remoteSyncLocked = false;
  const dirty = dirtyKeys.length > 0 ? dirtyKeys : [...DONGSHAN_EXPORT_STORAGE_KEYS];
  let text = bundleText;

  try {
    text = await reconcileLocalBundleWithCloudBeforePush(text, dirty);
  } catch (e) {
    if (!isNetworkishError(e)) throw e;
  }

  for (let attempt = 0; attempt <= MAX_CONFLICT_MERGE_RETRIES; attempt++) {
    try {
      await pushRemoteBundle(text);
      dispatchStatus('ok');
      return;
    } catch (e) {
      if (!isVersionConflictError(e)) {
        throw e;
      }
      if (attempt >= MAX_CONFLICT_MERGE_RETRIES) {
        stashLocalBundleForConflictRecovery();
        dispatchStatus('ok');
        return;
      }
      text = await mergeCloudWithLocalDirty(text, dirty);
    }
  }
}

function scheduleDebouncedPush(beforeText: string, afterText: string): void {
  for (const k of storageKeysChangedBetweenBundleTexts(beforeText, afterText)) {
    pendingDirtyKeys.add(k);
  }
  pendingAfterText = afterText;

  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const text = pendingAfterText;
    const dirty = [...pendingDirtyKeys];
    pendingDirtyKeys.clear();
    pendingAfterText = null;
    if (!text) return;
    pushChain = pushChain.then(() => flushDebouncedPush(text, dirty));
  }, PUSH_DEBOUNCE_MS);
}

async function flushDebouncedPush(bundleText: string, dirtyKeys: DongshanStorageKey[]): Promise<void> {
  try {
    await pushBundleTextWithAutoMerge(bundleText, dirtyKeys);
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

function applySyncFailureFromUnknown(e: unknown): void {
  if (isVersionConflictError(e)) return;
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
 * 分頁重新可見時更新雲端版本戳記，降低下一筆 PUT 誤判 409 的機率。
 */
export async function refreshRemoteBundleVersionIfStale(): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  try {
    const cloud = await fetchRemoteBundle();
    if (isRemoteBundleEffectivelyEmpty(cloud)) {
      dispatchStatus('ok');
      return;
    }
    const local = buildDongshanDataBundle();
    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, []);
    const result = importDongshanDataBundle(merged);
    if (!result.ok) throw new Error(result.error);
    noteRemoteBundleUpdatedAt(cloud);
    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

export async function initRemoteSyncOnAppLoad(): Promise<void> {
  if (getStorageMode() !== 'remote') {
    dispatchStatus('idle');
    return;
  }

  remoteSyncLocked = false;
  dispatchStatus('idle');

  try {
    const bundle = await fetchRemoteBundle();

    if (!isRemoteBundleEffectivelyEmpty(bundle)) {
      const local = buildDongshanDataBundle();
      const merged = mergeDongshanBundlesLocalWinsDirty(local, bundle, []);
      const result = importDongshanDataBundle(merged);
      if (!result.ok) {
        dispatchStatus('error');
        return;
      }
      noteRemoteBundleUpdatedAt(bundle);
    } else if (localExportStorageHasData()) {
      await pushBundleTextWithAutoMerge(
        serializeDongshanDataBundle(),
        [...DONGSHAN_EXPORT_STORAGE_KEYS],
      );
    }

    if (applyConflictRecoveryAfterRemoteImport()) {
      await pushBundleTextWithAutoMerge(
        serializeDongshanDataBundle(),
        [...DONGSHAN_EXPORT_STORAGE_KEYS],
      );
    }

    dispatchStatus('ok');
  } catch (e) {
    applySyncFailureFromUnknown(e);
  }
}

export async function pushRemoteIfLocalBundleChangedSince(snapshot: string): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  const now = serializeDongshanDataBundle();
  if (now === snapshot) return;
  scheduleDebouncedPush(snapshot, now);
  await pushChain;
}

export async function syncRemoteAfterDirectLocalMutation(): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  const before = serializeDongshanDataBundle();
  const after = serializeDongshanDataBundle();
  if (after === before) return;
  scheduleDebouncedPush(before, after);
  await pushChain;
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

  if (after !== before) {
    scheduleDebouncedPush(before, after);
  }

  return out;
}
