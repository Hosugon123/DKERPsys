/**
 * 產品與成本庫存：成本結構表（彈性欄位 + 可選漲縮率）
 *
 * 設計重點：
 * - 欄位（columns）由使用者自由定義（label + kind）；初次載入會種入常見欄位作為起手式。
 * - 品項（items）的數值以「columnId → 字串」儲存，最大保留輸入彈性；
 *   顯示時依欄位 kind 套上 $ / % 等格式提示。
 * - 漲縮補充：主表欄位標題含「漲縮／脹縮」者視為漲縮率欄；該欄有填寫時，列首可展開「未滷／成品成本」
 *   補充紀錄（不做全站統計）。舊版 hasShrinkage 仍於載入時相容。
 *
 * 對外契約：寫入後皆 dispatch COST_STRUCTURE_UPDATED_EVENT；
 * 同 key 一併納入 appDataBundle 匯出白名單（見 appDataBundle.ts）。
 */

const STORAGE_KEY = 'dongshan_cost_structure_v1';
export const COST_STRUCTURE_UPDATED_EVENT = 'costStructureUpdated';

export type CostFieldKind = 'currency' | 'number' | 'percent' | 'text';

export const COST_FIELD_KIND_LABELS: Record<CostFieldKind, string> = {
  currency: '金額（$）',
  number: '數量',
  percent: '百分比（%）',
  text: '文字',
};

export type CostColumn = {
  id: string;
  label: string;
  kind: CostFieldKind;
  /** 顯示順序：愈小愈左 */
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type CostItem = {
  id: string;
  name: string;
  unit: string;
  category?: string;
  /** columnId → 使用者原始輸入（純字串，最大彈性） */
  values: Record<string, string>;
  /** 是否追蹤滷製漲縮（未滷 → 成品） */
  hasShrinkage: boolean;
  /** 未滷成本（每單位）原始輸入 */
  shrinkageRaw?: string;
  /** 成品成本（每單位）原始輸入 */
  shrinkageCooked?: string;
  /** 漲縮率手動覆寫（若未填則自動計算） */
  shrinkagePctOverride?: string;
  note?: string;
  /** 顯示順序（新增後會落在最大值＋1，列表預設由大到小顯示＝最新在前） */
  order: number;
  createdAt: string;
  updatedAt: string;
};

type StoreV1 = {
  version: 1;
  columns: CostColumn[];
  items: CostItem[];
  storeUpdatedAt?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultColumns(): CostColumn[] {
  const now = nowIso();
  const seed: { label: string; kind: CostFieldKind }[] = [
    { label: '成本', kind: 'currency' },
    { label: '週均消耗量', kind: 'number' },
    { label: '批發價', kind: 'currency' },
    { label: '零售價', kind: 'currency' },
    { label: '漲縮率', kind: 'percent' },
    { label: '批發毛利率', kind: 'percent' },
    { label: '批發毛利', kind: 'currency' },
    { label: '零售毛利率', kind: 'percent' },
    { label: '零售毛利', kind: 'currency' },
    { label: '浮動成本', kind: 'text' },
  ];
  return seed.map((s, i) => ({
    id: newId('col'),
    label: s.label,
    kind: s.kind,
    order: i,
    createdAt: now,
    updatedAt: now,
  }));
}

function emptyStore(): StoreV1 {
  return {
    version: 1,
    columns: defaultColumns(),
    items: [],
    storeUpdatedAt: nowIso(),
  };
}

function notify(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COST_STRUCTURE_UPDATED_EVENT));
}

function loadStore(): StoreV1 {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<StoreV1> | null;
    if (!parsed || parsed.version !== 1) return emptyStore();
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.items)) return emptyStore();
    const columns = parsed.columns
      .filter((c): c is CostColumn => !!c && typeof c.id === 'string' && typeof c.label === 'string')
      .map<CostColumn>((c, i) => ({
        id: c.id,
        label: c.label,
        kind: (['currency', 'number', 'percent', 'text'] as CostFieldKind[]).includes(c.kind)
          ? c.kind
          : 'text',
        order: typeof c.order === 'number' ? c.order : i,
        createdAt: c.createdAt || nowIso(),
        updatedAt: c.updatedAt || c.createdAt || nowIso(),
      }));
    const items = parsed.items
      .filter((it): it is CostItem => !!it && typeof it.id === 'string')
      .map<CostItem>((it, i) => ({
        id: it.id,
        name: typeof it.name === 'string' ? it.name : '未命名',
        unit: typeof it.unit === 'string' ? it.unit : '',
        category: typeof it.category === 'string' && it.category.trim() ? it.category : undefined,
        values: it.values && typeof it.values === 'object' ? { ...it.values } : {},
        hasShrinkage: !!it.hasShrinkage,
        shrinkageRaw: typeof it.shrinkageRaw === 'string' ? it.shrinkageRaw : undefined,
        shrinkageCooked: typeof it.shrinkageCooked === 'string' ? it.shrinkageCooked : undefined,
        shrinkagePctOverride:
          typeof it.shrinkagePctOverride === 'string' ? it.shrinkagePctOverride : undefined,
        note: typeof it.note === 'string' && it.note.trim() ? it.note : undefined,
        order: typeof it.order === 'number' ? it.order : i,
        createdAt: it.createdAt || nowIso(),
        updatedAt: it.updatedAt || it.createdAt || nowIso(),
      }));
    return { version: 1, columns, items, storeUpdatedAt: parsed.storeUpdatedAt };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: StoreV1): void {
  if (typeof window === 'undefined') return;
  store.storeUpdatedAt = nowIso();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* localStorage 滿載或停用：靜默失敗，避免崩畫面 */
  }
  notify();
}

/** 取得目前快照（columns 由小到大、items 由大到小＝最新在前） */
export function getCostStructureSnapshot(): { columns: CostColumn[]; items: CostItem[] } {
  const s = loadStore();
  const columns = [...s.columns].sort((a, b) => a.order - b.order);
  const items = [...s.items].sort((a, b) => b.order - a.order);
  return { columns, items };
}

export function listCostCategories(): string[] {
  const s = loadStore();
  const set = new Set<string>();
  for (const it of s.items) {
    if (it.category && it.category.trim()) set.add(it.category.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

/* ----- 欄位（columns） ----- */

export function addCostColumn(label: string, kind: CostFieldKind = 'text'): CostColumn {
  const s = loadStore();
  const now = nowIso();
  const col: CostColumn = {
    id: newId('col'),
    label: label.trim() || '新欄位',
    kind,
    order: s.columns.reduce((m, c) => Math.max(m, c.order), -1) + 1,
    createdAt: now,
    updatedAt: now,
  };
  s.columns.push(col);
  saveStore(s);
  return col;
}

export function updateCostColumn(
  id: string,
  patch: Partial<Pick<CostColumn, 'label' | 'kind'>>,
): boolean {
  const s = loadStore();
  const i = s.columns.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const cur = s.columns[i];
  s.columns[i] = {
    ...cur,
    label: patch.label !== undefined ? patch.label.trim() || cur.label : cur.label,
    kind: patch.kind ?? cur.kind,
    updatedAt: nowIso(),
  };
  saveStore(s);
  return true;
}

export function moveCostColumn(id: string, delta: -1 | 1): boolean {
  const s = loadStore();
  const sorted = [...s.columns].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const j = i + delta;
  if (j < 0 || j >= sorted.length) return false;
  const a = sorted[i];
  const b = sorted[j];
  const nowI = nowIso();
  s.columns = s.columns.map((c) => {
    if (c.id === a.id) return { ...c, order: b.order, updatedAt: nowI };
    if (c.id === b.id) return { ...c, order: a.order, updatedAt: nowI };
    return c;
  });
  saveStore(s);
  return true;
}

export function removeCostColumn(id: string): boolean {
  const s = loadStore();
  if (!s.columns.some((c) => c.id === id)) return false;
  s.columns = s.columns.filter((c) => c.id !== id);
  const now = nowIso();
  s.items = s.items.map((it) => {
    if (!(id in it.values)) return it;
    const v = { ...it.values };
    delete v[id];
    return { ...it, values: v, updatedAt: now };
  });
  saveStore(s);
  return true;
}

/* ----- 品項（items） ----- */

export type AddCostItemInput = {
  name: string;
  unit?: string;
  category?: string;
  note?: string;
};

export function addCostItem(input: AddCostItemInput): CostItem {
  const s = loadStore();
  const now = nowIso();
  const item: CostItem = {
    id: newId('itm'),
    name: input.name.trim() || '新品項',
    unit: (input.unit ?? '').trim(),
    category: input.category?.trim() || undefined,
    note: input.note?.trim() || undefined,
    values: {},
    hasShrinkage: false,
    order: s.items.reduce((m, it) => Math.max(m, it.order), -1) + 1,
    createdAt: now,
    updatedAt: now,
  };
  s.items.push(item);
  saveStore(s);
  return item;
}

export type UpdateCostItemPatch = Partial<{
  name: string;
  unit: string;
  category: string | null;
  note: string | null;
  hasShrinkage: boolean;
  shrinkageRaw: string | null;
  shrinkageCooked: string | null;
  shrinkagePctOverride: string | null;
}>;

export function updateCostItem(id: string, patch: UpdateCostItemPatch): boolean {
  const s = loadStore();
  const i = s.items.findIndex((it) => it.id === id);
  if (i < 0) return false;
  const cur = s.items[i];
  const next: CostItem = { ...cur, updatedAt: nowIso() };
  if (patch.name !== undefined) next.name = patch.name.trim() || cur.name;
  if (patch.unit !== undefined) next.unit = patch.unit;
  if (patch.category !== undefined) {
    const v = patch.category?.trim();
    next.category = v ? v : undefined;
  }
  if (patch.note !== undefined) {
    const v = patch.note?.trim();
    next.note = v ? v : undefined;
  }
  if (patch.hasShrinkage !== undefined) next.hasShrinkage = patch.hasShrinkage;
  if (patch.shrinkageRaw !== undefined) {
    const v = patch.shrinkageRaw?.trim();
    next.shrinkageRaw = v ? v : undefined;
  }
  if (patch.shrinkageCooked !== undefined) {
    const v = patch.shrinkageCooked?.trim();
    next.shrinkageCooked = v ? v : undefined;
  }
  if (patch.shrinkagePctOverride !== undefined) {
    const v = patch.shrinkagePctOverride?.trim();
    next.shrinkagePctOverride = v ? v : undefined;
  }
  s.items[i] = next;
  saveStore(s);
  return true;
}

export function setCostItemValue(itemId: string, columnId: string, raw: string): boolean {
  const s = loadStore();
  const i = s.items.findIndex((it) => it.id === itemId);
  if (i < 0) return false;
  const cur = s.items[i];
  const v = { ...cur.values };
  if (raw === '' || raw === undefined) {
    delete v[columnId];
  } else {
    v[columnId] = raw;
  }
  s.items[i] = { ...cur, values: v, updatedAt: nowIso() };
  saveStore(s);
  return true;
}

export function removeCostItem(id: string): boolean {
  const s = loadStore();
  const next = s.items.filter((it) => it.id !== id);
  if (next.length === s.items.length) return false;
  s.items = next;
  saveStore(s);
  return true;
}

/* ----- 計算工具 ----- */

/** 由未滷／成品成本字串計算漲縮率（%）。raw 為 0 或解析失敗回傳 null。 */
export function computeShrinkagePct(rawStr?: string, cookedStr?: string): number | null {
  const raw = parseFloat(String(rawStr ?? '').replace(/[^\d.\-]/g, ''));
  const cooked = parseFloat(String(cookedStr ?? '').replace(/[^\d.\-]/g, ''));
  if (!Number.isFinite(raw) || !Number.isFinite(cooked) || raw === 0) return null;
  return ((cooked - raw) / raw) * 100;
}

/** 主表「漲縮率／脹縮率」欄：依欄位標題辨識（去空白後包含關鍵字即可） */
export function findShrinkageRateColumnId(columns: CostColumn[]): string | null {
  for (const c of columns) {
    const n = c.label.replace(/\s/g, '');
    if (n.includes('漲縮') || n.includes('脹縮')) return c.id;
  }
  return null;
}

/** 主表漲縮欄是否已有填寫（任意非空白字元即視為有紀錄） */
export function itemHasShrinkageRateInGrid(item: CostItem, shrinkColId: string | null): boolean {
  if (!shrinkColId) return false;
  return String(item.values[shrinkColId] ?? '').trim().length > 0;
}

/**
 * 是否顯示「未滷／成品成本」補充列：
 * - 主表漲縮率欄有值；或
 * - 表上無法辨識漲縮欄時（舊匯入），保留 hasShrinkage 且有未滷／成品紀錄者
 *
 * 若已能辨識漲縮欄但該欄空白，即使有補充紀錄也不展開（須先填主表漲縮率）。
 */
export function itemShouldShowShrinkageDetail(item: CostItem, shrinkColId: string | null): boolean {
  if (itemHasShrinkageRateInGrid(item, shrinkColId)) return true;
  if (!shrinkColId && item.hasShrinkage && (item.shrinkageRaw || item.shrinkageCooked)) return true;
  return false;
}

/** 取得某品項由未滷／成品推算的漲縮率（僅供補充列內部顯示；主表以欄位為準） */
export function effectiveShrinkagePct(item: CostItem): number | null {
  return computeShrinkagePct(item.shrinkageRaw, item.shrinkageCooked);
}
