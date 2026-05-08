/**
 * 加盟主專用：每單位零售參考價，與總部 userCatalog 的 retailPerPiece 分開儲存。
 */
const KEY = 'dongshan_franchisee_retail_v1';

type Store = {
  version: 1;
  byId: Record<string, number>;
};

function notify() {
  window.dispatchEvent(new Event('supplyCatalogUpdated'));
}

function loadStore(): Store {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return { version: 1, byId: {} };
    return JSON.parse(r) as Store;
  } catch {
    return { version: 1, byId: {} };
  }
}

function save(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
  notify();
}

/** 供叫貨／品項讀取加盟主自訂零售用 */
export function loadFranchiseeRetailByItemId(): Readonly<Record<string, number>> {
  return loadStore().byId;
}

/**
 * 設為 null 可清除、改回依批價推估。
 */
export function setFranchiseeRetailPieceForItem(id: string, value: number | null) {
  const s = loadStore();
  const byId = { ...s.byId };
  if (value == null) {
    delete byId[id];
  } else {
    const n = Math.min(1_000_000, Math.round(value * 100) / 100);
    if (n < 0) return;
    byId[id] = n;
  }
  s.byId = byId;
  save(s);
}
