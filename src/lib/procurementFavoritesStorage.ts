import { getAllSupplyItems } from './supplyCatalog';
import { roundProcurementQty } from './stallMath';
import { getDataScopeContext } from './dataScope';

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
type StoreV2 = { version: 2; byScope: Record<string, FavoriteOrder[]> };

function genId() {
  return `F${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeFavorite(f: FavoriteOrder & { updatedAt?: string }): FavoriteOrder {
  return { ...f, updatedAt: f.updatedAt ?? f.createdAt };
}

function loadStore(): StoreV2 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 2, byScope: {} };
    const p = JSON.parse(raw) as StoreV1 | StoreV2;
    if (!p || typeof p !== 'object') return { version: 2, byScope: {} };
    if ('version' in p && p.version === 2 && 'byScope' in p && p.byScope && typeof p.byScope === 'object') {
      const byScope: Record<string, FavoriteOrder[]> = {};
      for (const [scopeId, arr] of Object.entries(p.byScope)) {
        byScope[scopeId] = Array.isArray(arr)
          ? (arr as (FavoriteOrder & { updatedAt?: string })[]).map(normalizeFavorite)
          : [];
      }
      return { version: 2, byScope };
    }
    // v1 migration: 將舊資料歸屬至目前登入範圍
    const scopeId = getDataScopeContext().scopeId;
    const legacy = Array.isArray((p as StoreV1).items)
      ? ((p as StoreV1).items as (FavoriteOrder & { updatedAt?: string })[]).map(normalizeFavorite)
      : [];
    return { version: 2, byScope: { [scopeId]: legacy } };
  } catch {
    return { version: 2, byScope: {} };
  }
}

function saveStore(s: StoreV2) {
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
  const scopeId = getDataScopeContext().scopeId;
  return (loadStore().byScope[scopeId] ?? [])
    .map((f) => ({ ...f, quantities: sanitizeQ(f.quantities) }))
    .filter((f) => Object.keys(f.quantities).length > 0);
}

export function addProcurementFavorite(name: string, cart: Record<string, number>) {
  const quantities = sanitizeQ(cart);
  if (Object.keys(quantities).length === 0) return { ok: false as const, reason: 'empty' };

  const trimmed = name.trim() || '未命名常用單';
  const s = loadStore();
  const scopeId = getDataScopeContext().scopeId;
  const current = s.byScope[scopeId] ?? [];
  if (current.length >= MAX_TEMPLATES) {
    return { ok: false as const, reason: 'limit' };
  }
  const now = new Date().toISOString();
  s.byScope[scopeId] = [
    {
      id: genId(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      quantities: { ...quantities },
    },
    ...current,
  ];
  saveStore(s);
  return { ok: true as const };
}

export function removeProcurementFavorite(id: string) {
  const s = loadStore();
  const scopeId = getDataScopeContext().scopeId;
  const current = s.byScope[scopeId] ?? [];
  s.byScope[scopeId] = current.filter((x) => x.id !== id);
  saveStore(s);
}

/** 以常用單內容覆蓋購物車（品項不存在的欄位會被略過） */
export function cartFromFavorite(quantities: Record<string, number>): Record<string, number> {
  return { ...sanitizeQ(quantities) };
}
