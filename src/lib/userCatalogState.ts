import type { ItemCategory, SupplyItem } from './supplyCatalog';

const KEY_V1 = 'dongshan_supply_catalog_overrides_v1';
const KEY = 'dongshan_user_catalog_v2';

export type ItemOverride = {
  name?: string;
  pricePerPiece?: number;
  /**
   * 僅**總部／超級管理員**寫入之每單位零售參考（`dongshan_user_catalog_v2`）；
   * 加盟主零售見 `franchiseeRetailState`，與此欄不同步。`null` 表示清除覆寫。
   */
  retailPerPiece?: number | null;
  status?: '庫存充足' | '庫存緊張';
  tag?: string | null;
  /** 顯示用計價單位，例：兩、條、份 */
  pieceUnit?: string;
  category?: ItemCategory;
  /** 加盟主自備：下單時不計入應付貨款，但仍可列入盤點營業額。 */
  franchiseeSelfSuppliedForPayable?: boolean | null;
};

type StoreV2 = {
  version: 2;
  /** 整份使用者品項庫最後寫入時間（ISO），供匯出／AI 分析 */
  storeUpdatedAt?: string;
  /** 內建品 (s01…) 與內建基準的差異 */
  overrides: Record<string, ItemOverride>;
  /** 內建品從清單隱藏（不顯示於叫貨） */
  hiddenBaseIds: string[];
  /** 自訂品項 (id 以 c 開頭) */
  customItems: SupplyItem[];
};

function notify() {
  window.dispatchEvent(new Event('supplyCatalogUpdated'));
}

type LegacyV1 = { version: 1; byId: Record<string, ItemOverride> };

function readRaw(): StoreV2 | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoreV2;
  } catch {
    return null;
  }
}

function migrateV1ToV2(): StoreV2 | null {
  try {
    const raw = localStorage.getItem(KEY_V1);
    if (!raw) return null;
    const p = JSON.parse(raw) as LegacyV1;
    if (p?.version !== 1 || !p.byId) return null;
    const st: StoreV2 = {
      version: 2,
      overrides: p.byId,
      hiddenBaseIds: [],
      customItems: [],
    };
    localStorage.setItem(KEY, JSON.stringify(st));
    localStorage.removeItem(KEY_V1);
    return st;
  } catch {
    return null;
  }
}

function loadStore(): StoreV2 {
  const a = readRaw();
  if (a?.version === 2) {
    const norm = normalizeLoadedStore(a);
    if (JSON.stringify(norm.customItems) !== JSON.stringify(a.customItems)) {
      saveStore(norm);
      return norm;
    }
    return norm;
  }
  const m = migrateV1ToV2();
  if (m) return normalizeLoadedStore(m);
  return { version: 2, overrides: {}, hiddenBaseIds: [], customItems: [] };
}

function touchStoreMeta(s: StoreV2) {
  s.storeUpdatedAt = new Date().toISOString();
}

function saveStore(s: StoreV2) {
  touchStoreMeta(s);
  localStorage.setItem(KEY, JSON.stringify(s));
  notify();
}

function ensureCustomItemTimestamps(item: SupplyItem): SupplyItem {
  const now = new Date().toISOString();
  if (item.createdAt && item.updatedAt) return item;
  let guess = now;
  if (item.id.startsWith('c')) {
    const n = Number.parseInt(item.id.slice(1), 10);
    if (Number.isFinite(n) && n > 0) {
      guess = new Date(n).toISOString();
    }
  }
  return {
    ...item,
    createdAt: item.createdAt ?? guess,
    updatedAt: item.updatedAt ?? item.createdAt ?? guess,
  };
}

function normalizeLoadedStore(s: StoreV2): StoreV2 {
  return {
    ...s,
    customItems: s.customItems.map(ensureCustomItemTimestamps),
  };
}

/* ----- 讀取（供 supplyCatalog 合併） ----- */
export function loadUserCatalogState(): StoreV2 {
  return loadStore();
}

export function loadSupplyOverrides(): Record<string, ItemOverride> {
  return loadStore().overrides;
}

/* ----- 覆寫內建品（合併寫入，避免只改零售時洗掉品名／批價） ----- */
export function setSupplyItemOverride(id: string, patch: ItemOverride) {
  if (Object.keys(patch).length === 0) {
    clearSupplyItemOverride(id);
    return;
  }
  const s = loadStore();
  const prev: ItemOverride = { ...(s.overrides[id] || {}) };
  (Object.keys(patch) as (keyof ItemOverride)[]).forEach((key) => {
    const v = patch[key];
    if (v === undefined) return;
    if (key === 'retailPerPiece' && v === null) {
      delete prev.retailPerPiece;
    } else {
      (prev as Record<string, unknown>)[key as string] = v;
    }
  });
  if (Object.keys(prev).length === 0) {
    const o = { ...s.overrides };
    delete o[id];
    s.overrides = o;
  } else {
    s.overrides = { ...s.overrides, [id]: prev };
  }
  saveStore(s);
}

export function clearSupplyItemOverride(id: string) {
  const s = loadStore();
  if (!s.overrides[id]) return;
  const o = { ...s.overrides };
  delete o[id];
  s.overrides = o;
  saveStore(s);
}

/* ----- 隱藏內建品（從叫貨移除） ----- */
export function hideBaseItem(id: string) {
  const s = loadStore();
  if (s.hiddenBaseIds.includes(id)) return;
  s.hiddenBaseIds = [...s.hiddenBaseIds, id];
  saveStore(s);
}

export function unhideBaseItem(id: string) {
  const s = loadStore();
  s.hiddenBaseIds = s.hiddenBaseIds.filter((x) => x !== id);
  saveStore(s);
}

/* ----- 自訂品 ----- */
export function addCustomItem(
  init?: Partial<Pick<SupplyItem, 'name' | 'pricePerPiece' | 'pieceUnit' | 'category' | 'tag'>>
) {
  const s = loadStore();
  const id = `c${Date.now()}`;
  const now = new Date().toISOString();
  const item: SupplyItem = {
    id,
    name: (init?.name ?? '新品項').trim() || '新品項',
    pricePerPiece: Math.max(0, init?.pricePerPiece ?? 0),
    pieceUnit: (init?.pieceUnit ?? '份').trim() || '份',
    orderUnit: '份',
    piecesPerPackage: 1,
    status: '庫存充足',
    category: init?.category ?? 'tofu',
    tag: init?.tag,
    createdAt: now,
    updatedAt: now,
  };
  s.customItems = [item, ...s.customItems];
  saveStore(s);
  return id;
}

export function updateCustomItem(
  id: string,
  next: Partial<SupplyItem> & { retailPerPiece?: number | null }
) {
  const s = loadStore();
  const i = s.customItems.findIndex((x) => x.id === id);
  if (i < 0) return;
  const cur = s.customItems[i];
  const now = new Date().toISOString();
  s.customItems = s.customItems.map((x) => {
    if (x.id !== id) return x;
    const merged: SupplyItem = {
      ...cur,
      ...next,
      id: cur.id,
      orderUnit: '份',
      piecesPerPackage: 1,
      createdAt: cur.createdAt ?? now,
      updatedAt: now,
    };
    if (Object.prototype.hasOwnProperty.call(next, 'retailPerPiece') && next.retailPerPiece == null) {
      delete merged.retailPerPiece;
    }
    return merged;
  });
  saveStore(s);
}

export function removeCustomItem(id: string) {
  const s = loadStore();
  s.customItems = s.customItems.filter((x) => x.id !== id);
  saveStore(s);
}

export function getCustomItem(id: string): SupplyItem | undefined {
  return loadStore().customItems.find((x) => x.id === id);
}

export function clearAllUserCatalog() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(KEY_V1);
  notify();
}

export function isCustomItemId(id: string) {
  return id.startsWith('c');
}
