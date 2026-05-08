/**
 * 全站本機資料匯出／匯入（標準 JSON），供備份與 AI 工具分析。
 * 內容為 localStorage 鍵值快照，不經過畫面層。
 */

export const DONGSHAN_DATA_BUNDLE_VERSION = 1;
export const DONGSHAN_APP_ID = 'dongshan-ya-to';

/** 納入備份之 localStorage 鍵（與各 *Storage 模組一致） */
export const DONGSHAN_EXPORT_STORAGE_KEYS = [
  'dongshan_accounting_ledger_v1',
  'dongshan_order_history_v1',
  'dongshan_franchise_mgmt_orders_v1',
  'dongshan_stall_inventory_v1',
  'dongshan_store_code_v1',
  'dongshan_user_catalog_v2',
  'dongshan_sales_records_v1',
  'dongshan_order_seq_v1',
  'dongshan_franchisee_retail_v1',
  'dongshan_procurement_favorites_v1',
  'dongshan_procurement_stall_basis_ymd',
  'dongshan_procurement_stall_basis_order_id',
  'dongshan_sidebar_main_nav_order_v1_admin',
  'dongshan_sidebar_main_nav_order_v1_franchisee',
  'dongshan_sidebar_main_nav_order_v1_employee',
  'dongshan_sidebar_main_nav_order_v1_other',
  'dongshan_cost_structure_v1',
  'dongshan_system_users_v1',
  'dongshan_login_credentials_v1',
  'dongshan_pw_reset_pending_v1',
] as const;

export type DongshanStorageKey = (typeof DONGSHAN_EXPORT_STORAGE_KEYS)[number];

export type DongshanDataBundleV1 = {
  bundleVersion: typeof DONGSHAN_DATA_BUNDLE_VERSION;
  app: typeof DONGSHAN_APP_ID;
  exportedAt: string;
  /** 固定格式識別，便於 AI／腳本辨識 */
  format: 'dongshan-localStorage-snapshot-v1';
  /** localStorage key → 原始字串（JSON 字串化後之內容）；null 表示該鍵目前無資料 */
  keys: Partial<Record<DongshanStorageKey, string | null>>;
};

export const DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT = 'dongshanDataBundleImported';

function dispatchPostImportSync() {
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

/** 產生可下載之 bundle 物件 */
export function buildDongshanDataBundle(): DongshanDataBundleV1 {
  const keys: Partial<Record<DongshanStorageKey, string | null>> = {};
  for (const k of DONGSHAN_EXPORT_STORAGE_KEYS) {
    try {
      keys[k] = localStorage.getItem(k);
    } catch {
      keys[k] = null;
    }
  }
  return {
    bundleVersion: DONGSHAN_DATA_BUNDLE_VERSION,
    app: DONGSHAN_APP_ID,
    exportedAt: new Date().toISOString(),
    format: 'dongshan-localStorage-snapshot-v1',
    keys,
  };
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
