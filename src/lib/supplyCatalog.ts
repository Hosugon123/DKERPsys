/**
 * 攤上叫貨品項；單位與自訂品見 userCatalogState。
 */
import { loadFranchiseeRetailByItemId } from './franchiseeRetailState';
import { loadUserCatalogState, isCustomItemId, type ItemOverride } from './userCatalogState';

export type ItemCategory = 'duck' | 'pork' | 'tofu' | 'veg' | 'consumable';

export type SupplyItem = {
  id: string;
  name: string;
  /** 自訂品項建立時間（ISO）；內建品無此欄 */
  createdAt?: string;
  /** 自訂品項最後更新（ISO） */
  updatedAt?: string;
  pricePerPiece: number;
  /**
   * 自訂每單位零售參考（依目前身分視角）：總部見 userCatalog 覆寫，加盟主見專用儲存。
   * 未設則依批價 × 倍率推估。
   */
  retailPerPiece?: number;
  pieceUnit: string;
  orderUnit: '份';
  piecesPerPackage: 1;
  status: '庫存充足' | '庫存緊張';
  tag?: string;
  category: ItemCategory;
  /** 加盟主自備：不計入加盟主叫貨貨款，但盤點可列營業額。 */
  franchiseeSelfSuppliedForPayable?: boolean;
};

export const CATEGORY_CHIPS: { id: 'all' | ItemCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  /** 攤上盤點不計入「應有營業額」等販售帳面；仍會列盤、叫貨可扣庫 */
  { id: 'consumable', label: '消耗品' },
  { id: 'veg', label: '菜' },
  { id: 'duck', label: '鴨貨' },
  { id: 'pork', label: '豬、雞' },
  { id: 'tofu', label: '加工品' },
];

const rows: { name: string; category: ItemCategory; price: number; status?: '庫存緊張'; tag?: string }[] = [
  { name: '黑輪', category: 'tofu', price: 28 },
  { name: '米血', category: 'tofu', price: 25 },
  { name: '豆皮', category: 'tofu', price: 32 },
  { name: '雞皮', category: 'pork', price: 35 },
  { name: '樓梯', category: 'tofu', price: 30 },
  { name: '海帶', category: 'veg', price: 22 },
  { name: '鴨脆腸', category: 'duck', price: 45 },
  { name: '鴨皮', category: 'duck', price: 38 },
  { name: '大腸', category: 'pork', price: 42 },
  { name: '鳥蛋', category: 'tofu', price: 20 },
  { name: '腳輪', category: 'tofu', price: 30 },
  { name: '鴨胗', category: 'duck', price: 40 },
  { name: '豬頭皮', category: 'pork', price: 40 },
  { name: '豬耳朵', category: 'pork', price: 42 },
  { name: '屁股', category: 'pork', price: 35 },
  { name: '豆包', category: 'tofu', price: 28 },
  { name: '鴨肉丸', category: 'duck', price: 38 },
  { name: '鴨心', category: 'duck', price: 32 },
  { name: '鴨脖子', category: 'duck', price: 48, tag: '熱銷' },
  { name: '鴨頭', category: 'duck', price: 50, tag: '熱銷' },
  { name: '頭殼', category: 'duck', price: 45 },
  { name: '豆干', category: 'tofu', price: 26 },
  { name: '鴨翅', category: 'duck', price: 40 },
  { name: '鴨舌', category: 'duck', price: 55, status: '庫存緊張' },
  { name: '百頁', category: 'tofu', price: 30 },
  { name: '熱狗', category: 'tofu', price: 28 },
  { name: '芋粿', category: 'tofu', price: 32 },
  { name: '玉米筍', category: 'veg', price: 25 },
  { name: '四季豆', category: 'veg', price: 28 },
  { name: '節瓜', category: 'veg', price: 30 },
  { name: '胡椒', category: 'consumable', price: 600 },
  { name: '辣椒', category: 'consumable', price: 80 },
  { name: '竹籤', category: 'consumable', price: 60 },
  { name: '四兩紙袋', category: 'consumable', price: 35 },
  { name: '八兩紙袋', category: 'consumable', price: 40 },
  { name: '一斤紙袋', category: 'consumable', price: 45 },
  { name: '串串辣', category: 'consumable', price: 700 },
  { name: '洗碗精', category: 'consumable', price: 165 },
];

function idForIndex(i: number) {
  return `s${String(i + 1).padStart(2, '0')}`;
}

/** 內建叫貨目錄（程式更新時會一併更新） */
export const BASE_SUPPLY_ITEMS: readonly SupplyItem[] = rows.map((r, i) => ({
  id: idForIndex(i),
  name: r.name,
  pricePerPiece: r.price,
  pieceUnit: '份',
  orderUnit: '份' as const,
  piecesPerPackage: 1 as const,
  status: r.status ?? '庫存充足',
  tag: r.tag,
  category: r.category,
}));

/** @deprecated 請用 getAllSupplyItems() 以讀到本機覆寫的品名／單價 */
export const supplyItems = BASE_SUPPLY_ITEMS;

const CAT_SET: Record<ItemCategory, true> = {
  duck: true,
  pork: true,
  tofu: true,
  veg: true,
  consumable: true,
};

/** 舊版分類代碼 `misc`（其他）併入加工品；其餘未知值則用 fallback */
export function normalizeItemCategory(
  c: string | undefined | null,
  fallback: ItemCategory
): ItemCategory {
  if (c == null || c === '') return fallback;
  if (c in CAT_SET) return c as ItemCategory;
  if (c === 'misc') return 'tofu';
  return fallback;
}

function mergeWithOverrides(base: SupplyItem, o?: ItemOverride | null): SupplyItem {
  if (!o) return base;
  let tag = base.tag;
  if (Object.prototype.hasOwnProperty.call(o, 'tag')) {
    if (o.tag == null || o.tag === '') tag = undefined;
    else tag = o.tag;
  }
  return {
    ...base,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : base.name,
    pricePerPiece:
      typeof o.pricePerPiece === 'number' &&
      Number.isFinite(o.pricePerPiece) &&
      o.pricePerPiece >= 0
        ? Math.min(1_000_000, Math.round(o.pricePerPiece * 100) / 100)
        : base.pricePerPiece,
    status:
      o.status === '庫存充足' || o.status === '庫存緊張' ? o.status : base.status,
    tag,
    pieceUnit:
      o.pieceUnit != null && String(o.pieceUnit).trim() !== ''
        ? String(o.pieceUnit).trim()
        : base.pieceUnit,
    category: normalizeItemCategory(o.category as string | undefined, base.category),
    franchiseeSelfSuppliedForPayable:
      o.franchiseeSelfSuppliedForPayable != null
        ? !!o.franchiseeSelfSuppliedForPayable
        : base.franchiseeSelfSuppliedForPayable,
  };
}

export function getBaseSupplyItem(id: string): SupplyItem | undefined {
  return BASE_SUPPLY_ITEMS.find((i) => i.id === id);
}

/**
 * 零售參考以誰的視角讀取：總部（含自訂覆寫）與加盟主（專庫）分開。
 * 未傳參則用 App 內之目前身分所設的 {@link getActiveSupplyRetailView}。
 */
export type SupplyRetailView = 'headquarter' | 'franchisee';

let activeSupplyRetailView: SupplyRetailView = 'headquarter';

export function setSupplyCatalogRetailView(v: SupplyRetailView) {
  activeSupplyRetailView = v;
}

export function getActiveSupplyRetailView(): SupplyRetailView {
  return activeSupplyRetailView;
}

export function userRoleToSupplyRetailView(
  r: 'admin' | 'franchisee' | 'employee'
): SupplyRetailView {
  return r === 'franchisee' ? 'franchisee' : 'headquarter';
}

function applyRetailToItem(
  item: SupplyItem,
  id: string,
  st: ReturnType<typeof loadUserCatalogState>,
  view: SupplyRetailView
): SupplyItem {
  if (view === 'franchisee') {
    const m = loadFranchiseeRetailByItemId() as Record<string, number>;
    const v = m[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return { ...item, retailPerPiece: Math.min(1_000_000, Math.round(v * 100) / 100) };
    }
    return { ...item, retailPerPiece: undefined };
  }
  if (isCustomItemId(id)) {
    return item;
  }
  const o = st.overrides[id];
  if (
    o?.retailPerPiece != null &&
    typeof o.retailPerPiece === 'number' &&
    Number.isFinite(o.retailPerPiece) &&
    o.retailPerPiece >= 0
  ) {
    return { ...item, retailPerPiece: Math.min(1_000_000, Math.round(o.retailPerPiece * 100) / 100) };
  }
  return { ...item, retailPerPiece: undefined };
}

/** 含本機覆寫、隱藏、自訂品；叫貨／盤點用此。 */
export function getSupplyItem(
  id: string,
  view: SupplyRetailView = activeSupplyRetailView
): SupplyItem | undefined {
  const st = loadUserCatalogState();
  if (isCustomItemId(id)) {
    const it = st.customItems.find((x) => x.id === id);
    if (!it) return undefined;
    const n = { ...it, category: normalizeItemCategory(String(it.category), 'tofu') };
    return applyRetailToItem(n, id, st, view);
  }
  const b = getBaseSupplyItem(id);
  if (!b) return undefined;
  if (st.hiddenBaseIds.includes(id)) return undefined;
  const merged = mergeWithOverrides(b, st.overrides[id]);
  return applyRetailToItem(merged, id, st, view);
}

export function getAllSupplyItems(view: SupplyRetailView = activeSupplyRetailView): SupplyItem[] {
  const st = loadUserCatalogState();
  const list: SupplyItem[] = [];
  for (const b of BASE_SUPPLY_ITEMS) {
    if (st.hiddenBaseIds.includes(b.id)) continue;
    const merged = mergeWithOverrides(b, st.overrides[b.id]);
    list.push(applyRetailToItem(merged, b.id, st, view));
  }
  list.push(
    ...st.customItems.map((c) => {
      const cN = { ...c, category: normalizeItemCategory(String(c.category), 'tofu') };
      return applyRetailToItem(cN, c.id, st, view);
    })
  );
  return list;
}

/** 每條品項的單價（1 份） */
export function pricePerPackage(item: SupplyItem) {
  return item.pricePerPiece * item.piecesPerPackage;
}

/**
 * 以批貨單價推估之終端售價（叫貨頁「零售」標示用）。
 * 實際門市訂價以現場為準，此倍率可再改或改成品項級設定。
 */
export const PROCUREMENT_RETAIL_ESTIMATE_MULTIPLIER = 1.45;

function roundProcurementMoney(n: number) {
  return Math.round(n * 100) / 100;
}

/** 未自訂零售時，依目前批價推估之每單位零售參考 */
export function defaultRetailPerPieceFromWholesale(item: SupplyItem) {
  return roundProcurementMoney(item.pricePerPiece * PROCUREMENT_RETAIL_ESTIMATE_MULTIPLIER);
}

export function estimatedRetailPerPackage(item: SupplyItem) {
  if (
    item.retailPerPiece != null &&
    Number.isFinite(item.retailPerPiece) &&
    item.retailPerPiece >= 0
  ) {
    return roundProcurementMoney(item.retailPerPiece * item.piecesPerPackage);
  }
  return roundProcurementMoney(pricePerPackage(item) * PROCUREMENT_RETAIL_ESTIMATE_MULTIPLIER);
}

export function orderPackageSpecText(item: SupplyItem) {
  if (item.orderUnit === '份' && item.piecesPerPackage === 1) {
    return '單份計價';
  }
  return `${item.orderUnit} ${item.piecesPerPackage} ${item.pieceUnit}`;
}

export function totalPiecesInPackages(item: SupplyItem, packages: number) {
  return Math.round(packages * item.piecesPerPackage);
}

/**
 * 攤上帳面「營收／應有營業額」只加總分類非消耗品之列。
 * 內建品在 BASE 即為「消耗品」者始終算消耗品，避免在品項覆寫中改分類而誤列入盤點帳面。
 * 自訂品僅依其分類欄位判斷。
 */
export function isConsumableItem(item: SupplyItem | undefined): boolean {
  if (item == null) return false;
  if (item.category === 'consumable') return true;
  if (isCustomItemId(item.id)) return false;
  const base = getBaseSupplyItem(item.id);
  return base != null && base.category === 'consumable';
}

/** 加盟主自備：叫貨貨款排除（不影響盤點營業額計算）。 */
export function isFranchiseeSelfSuppliedItem(item: SupplyItem | undefined): boolean {
  return !!item?.franchiseeSelfSuppliedForPayable;
}
