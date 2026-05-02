import { getAllSupplyItems } from './supplyCatalog';
import { roundProcurementQty } from './stallMath';

const KEY = 'dongshan_procurement_favorites_v1';
const MAX_TEMPLATES = 30;

export type FavoriteOrder = {
  id: string;
  name: string;
  createdAt: string;
  /** ISO 最後更新（舊資料由 createdAt 補齊） */
  updatedAt: string;
  /** productId → 份數（可小數，與叫貨一致） */
  quantities: Record<string, number>;
};

type StoreV1 = { version: 1; items: FavoriteOrder[] };

function genId() {
  return `F${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeFavorite(f: FavoriteOrder & { updatedAt?: string }): FavoriteOrder {
  return { ...f, updatedAt: f.updatedAt ?? f.createdAt };
}

function loadStore(): StoreV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, items: [] };
    const p = JSON.parse(raw) as StoreV1;
    if (!p || !Array.isArray(p.items)) return { version: 1, items: [] };
    return {
      ...p,
      items: (p.items as (FavoriteOrder & { updatedAt?: string })[]).map(normalizeFavorite),
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function saveStore(s: StoreV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('procurementFavoritesUpdated'));
}

/** 僅保留目錄仍存在的品項 */
function sanitizeQ(q: Record<string, number>): Record<string, number> {
  const valid = new Set(getAllSupplyItems().map((i) => i.id));
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(q)) {
    if (!valid.has(id)) continue;
    const v = roundProcurementQty(Number(n) || 0);
    if (v <= 0) continue;
    out[id] = v;
  }
  return out;
}

export function listProcurementFavorites(): FavoriteOrder[] {
  return loadStore().items
    .map((f) => ({ ...f, quantities: sanitizeQ(f.quantities) }))
    .filter((f) => Object.keys(f.quantities).length > 0);
}

export function addProcurementFavorite(name: string, cart: Record<string, number>) {
  const quantities = sanitizeQ(cart);
  if (Object.keys(quantities).length === 0) return { ok: false as const, reason: 'empty' };

  const trimmed = name.trim() || '未命名常用單';
  const s = loadStore();
  if (s.items.length >= MAX_TEMPLATES) {
    return { ok: false as const, reason: 'limit' };
  }
  const now = new Date().toISOString();
  s.items = [
    {
      id: genId(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      quantities: { ...quantities },
    },
    ...s.items,
  ];
  saveStore(s);
  return { ok: true as const };
}

export function removeProcurementFavorite(id: string) {
  const s = loadStore();
  s.items = s.items.filter((x) => x.id !== id);
  saveStore(s);
}

/** 以常用單內容覆蓋購物車（品項不存在的欄位會被略過） */
export function cartFromFavorite(quantities: Record<string, number>): Record<string, number> {
  return { ...sanitizeQ(quantities) };
}
