/**
 * 全站本機資料匯出／匯入（標準 JSON），供備份與 AI 工具分析。
 * 內容為 localStorage 鍵值快照，不經過畫面層。
 */
import {
  filterOrderArrayJsonByTombstones,
  isMultiDeviceRecordMergeKey,
  mergeDeletedOrderIdsStore,
  mergeStorageKeyRecords,
} from './bundleRecordMerge';

export const DONGSHAN_DATA_BUNDLE_VERSION = 1;
export const DONGSHAN_APP_ID = 'dongshan-ya-to';

/** 納入備份之 localStorage 鍵（與各 *Storage 模組一致） */
export const DONGSHAN_EXPORT_STORAGE_KEYS = [
  'dongshan_accounting_ledger_v1',
  'dongshan_order_history_v1',
  'dongshan_franchise_mgmt_orders_v1',
  'dongshan_deleted_order_ids_v1',
  'dongshan_stall_inventory_v1',
  'dongshan_store_code_v1',
  'dongshan_user_catalog_v2',
  'dongshan_sales_records_v1',
  'dongshan_order_seq_v1',
  'dongshan_franchisee_retail_v1',
  'dongshan_procurement_favorites_v1',
  'dongshan_procurement_stall_basis_ymd',
  'dongshan_procurement_stall_basis_order_id',
  'dongshan_dashboard_revenue_notes_v1',
  'dongshan_sidebar_main_nav_order_v1_admin',
  'dongshan_sidebar_main_nav_order_v1_franchisee',
  'dongshan_sidebar_main_nav_order_v1_employee',
  'dongshan_sidebar_main_nav_order_v1_other',
  'dongshan_cost_structure_v1',
  'dongshan_system_users_v1',
  'dongshan_login_credentials_v1',
  'dongshan_pw_reset_pending_v1',
  'dongshan_pwa_icon_v1',
] as const;

export type DongshanStorageKey = (typeof DONGSHAN_EXPORT_STORAGE_KEYS)[number];

export type DongshanDataBundleV1 = {
  bundleVersion: typeof DONGSHAN_DATA_BUNDLE_VERSION;
  app: typeof DONGSHAN_APP_ID;
  exportedAt: string;
  /** 毫秒時間戳：雲端 bundle 最後寫入時間（PUT 前由前端更新） */
  updatedAt?: number;
  /** 固定格式識別，便於 AI／腳本辨識 */
  format: 'dongshan-localStorage-snapshot-v1';
  /** localStorage key → 原始字串（JSON 字串化後之內容）；null 表示該鍵目前無資料 */
  keys: Partial<Record<DongshanStorageKey, string | null>>;
};

export const DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT = 'dongshanDataBundleImported';

/** 匯入 bundle 或本機下拉重新整理後，通知各畫面重讀 localStorage */
export function dispatchDongshanStorageSyncEvents(): void {
  const events = [
    'accountingLedgerUpdated',
    'orderHistoryUpdated',
    'franchiseManagementOrdersUpdated',
    'stallInventoryUpdated',
    'storeCodeUpdated',
    'salesRecordUpdated',
    'supplyCatalogUpdated',
    'procurementFavoritesUpdated',
    'costStructureUpdated',
    'systemUsersUpdated',
  ];
  for (const type of events) {
    window.dispatchEvent(new Event(type));
  }
  window.dispatchEvent(new Event(DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT));
}

function dispatchPostImportSync() {
  dispatchDongshanStorageSyncEvents();
}

/** 產生可下載之 bundle 物件 */
export function buildDongshanDataBundle(options?: { updatedAt?: number }): DongshanDataBundleV1 {
  const keys: Partial<Record<DongshanStorageKey, string | null>> = {};
  for (const k of DONGSHAN_EXPORT_STORAGE_KEYS) {
    try {
      keys[k] = localStorage.getItem(k);
    } catch {
      keys[k] = null;
    }
  }
  const bundle: DongshanDataBundleV1 = {
    bundleVersion: DONGSHAN_DATA_BUNDLE_VERSION,
    app: DONGSHAN_APP_ID,
    exportedAt: new Date().toISOString(),
    format: 'dongshan-localStorage-snapshot-v1',
    keys,
  };
  if (options?.updatedAt != null) {
    bundle.updatedAt = options.updatedAt;
  }
  return bundle;
}

/** 準備推送雲端：寫入 updatedAt 為目前毫秒時間戳 */
export function buildDongshanDataBundleForPush(): DongshanDataBundleV1 {
  return buildDongshanDataBundle({ updatedAt: Date.now() });
}

export function serializeDongshanDataBundle(): string {
  return JSON.stringify(buildDongshanDataBundle(), null, 2);
}

export type ImportBundleResult =
  | { ok: true; importedKeyCount: number }
  | { ok: false; error: string };

/**
 * 將 bundle 寫回 localStorage。僅處理 `keys` 內出現的鍵；值為 null 則 removeItem。
 */
export function importDongshanDataBundle(raw: unknown): ImportBundleResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: '檔案不是有效的 JSON 物件。' };
  }
  const o = raw as Record<string, unknown>;
  const keyBag = o.keys;
  if (keyBag === null || typeof keyBag !== 'object' || Array.isArray(keyBag)) {
    return { ok: false, error: '缺少或無效的 keys 欄位。' };
  }

  const allowed = new Set<string>(DONGSHAN_EXPORT_STORAGE_KEYS as unknown as string[]);
  let importedKeyCount = 0;
  for (const [storageKey, value] of Object.entries(keyBag)) {
    if (!allowed.has(storageKey)) continue;
    if (value === null) {
      localStorage.removeItem(storageKey);
      importedKeyCount += 1;
      continue;
    }
    if (typeof value !== 'string') {
      return { ok: false, error: `鍵 ${storageKey} 的值必須為字串或 null。` };
    }
    localStorage.setItem(storageKey, value);
    importedKeyCount += 1;
  }

  dispatchPostImportSync();
  return { ok: true, importedKeyCount };
}

export function parseBundleJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** 比對兩次序列化快照，找出有變更的 localStorage 鍵（供雲端衝突合併時保留本機剛改欄位）。 */
export function storageKeysChangedBetweenBundleTexts(
  beforeText: string,
  afterText: string,
): DongshanStorageKey[] {
  try {
    const b1 = parseBundleJson(beforeText) as DongshanDataBundleV1;
    const b2 = parseBundleJson(afterText) as DongshanDataBundleV1;
    const changed: DongshanStorageKey[] = [];
    for (const k of DONGSHAN_EXPORT_STORAGE_KEYS) {
      if ((b1.keys?.[k] ?? null) !== (b2.keys?.[k] ?? null)) changed.push(k);
    }
    return changed;
  } catch {
    return [...DONGSHAN_EXPORT_STORAGE_KEYS];
  }
}

/**
 * 雲端與本機合併：訂單／流水帳等依 id union（較新 updatedAt 優先），避免多機整包覆蓋丟單；
 * 其餘鍵：本輪 dirty 以本機為準，否則以雲端為準並補本機獨有鍵。
 */
export function mergeDongshanBundlesLocalWinsDirty(
  local: DongshanDataBundleV1,
  cloud: DongshanDataBundleV1,
  dirtyStorageKeys: Iterable<DongshanStorageKey>,
): DongshanDataBundleV1 {
  const dirty = new Set(dirtyStorageKeys);
  const keys: Partial<Record<DongshanStorageKey, string | null>> = {
    ...(cloud.keys ?? {}),
  };
  const mergedTombstones = mergeDeletedOrderIdsStore(
    local.keys?.dongshan_deleted_order_ids_v1,
    cloud.keys?.dongshan_deleted_order_ids_v1,
  );
  keys.dongshan_deleted_order_ids_v1 = mergedTombstones;

  for (const k of DONGSHAN_EXPORT_STORAGE_KEYS) {
    if (k === 'dongshan_deleted_order_ids_v1') continue;
    if (isMultiDeviceRecordMergeKey(k)) {
      let merged = mergeStorageKeyRecords(k, local.keys?.[k], cloud.keys?.[k]);
      if (
        merged != null &&
        (k === 'dongshan_order_history_v1' || k === 'dongshan_franchise_mgmt_orders_v1')
      ) {
        merged = filterOrderArrayJsonByTombstones(merged, mergedTombstones);
      }
      if (merged != null) keys[k] = merged;
      continue;
    }
    if (dirty.has(k)) {
      if (local.keys?.[k] !== undefined) keys[k] = local.keys[k] ?? null;
    } else if ((keys[k] == null || keys[k] === '') && local.keys?.[k] != null) {
      keys[k] = local.keys[k] ?? null;
    }
  }
  return {
    bundleVersion: DONGSHAN_DATA_BUNDLE_VERSION,
    app: DONGSHAN_APP_ID,
    format: 'dongshan-localStorage-snapshot-v1',
    exportedAt: new Date().toISOString(),
    updatedAt: Date.now(),
    keys,
  };
}
