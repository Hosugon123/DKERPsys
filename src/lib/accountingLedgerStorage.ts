/**
 * 非訂單類流水帳（本機 localStorage）
 */
import { getDataScopeContext } from './dataScope';

const STORAGE_KEY = 'dongshan_accounting_ledger_v1';
export const ACCOUNTING_LEDGER_UPDATED_EVENT = 'accountingLedgerUpdated';

export const ACCOUNTING_CATEGORIES = [
  '房租',
  '水電',
  '薪資',
  '雜項',
  '滷料',
  '食材支出',
  '總店營業支出',
  '店外收入',
] as const;

export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];
export type AccountingFlowType = 'income' | 'expense';

/** 主食材進貨 → 加總為 Total_COGS（銷貨成本） */
export const MAIN_INGREDIENT_SUBS = ['鴨貨類', '加工食品', '雞肉類', '豬肉類', '蔬菜類'] as const;
export type MainIngredientSub = (typeof MAIN_INGREDIENT_SUBS)[number];

/** 滷料（頂層類別）之子類：加總為 Total_Seasoning（滷汁成本） */
export const SEASONING_SUBS = ['糖', '味精', '醬油', '中草藥(八角/桂皮等)', '其他調味'] as const;
export type SeasoningSub = (typeof SEASONING_SUBS)[number];

/** 僅「食材支出」可選之子類（主食材進貨／COGS） */
export const INGREDIENT_SUBCATEGORIES = [...MAIN_INGREDIENT_SUBS] as const;
export type IngredientSubCategory = (typeof INGREDIENT_SUBCATEGORIES)[number];

export const MARINADE_EXPENSE_CATEGORY = '滷料' as const satisfies AccountingCategory;

/** 舊版子類別（資料相容；建議編輯時改選新分類） */
export const LEGACY_SEASONING_SUBS = ['八角', '桂皮', '甘草'] as const;
export const LEGACY_OTHER_SUB = '其他' as const;

export const FOOD_EXPENSE_CATEGORY = '食材支出' as const satisfies AccountingCategory;

export const MARINADE_GROUP_LABEL = '滷料' as const;

/**
 * SQL 遷移用領域：對應未來 `ledger_entries.expense_domain` 或外鍵至 `expense_categories.domain`。
 * - general：一般收支（房租、薪資等）
 * - ingredient_cogs：食材支出（主食材進貨 → Total_COGS）
 * - marinade：滷料大項（滷汁配料 → Total_Seasoning）
 */
export type AccountingLedgerExpenseDomain = 'general' | 'ingredient_cogs' | 'marinade';

export type AccountingLedgerEntry = {
  id: string;
  dateYmd: string;
  flowType: AccountingFlowType;
  category: AccountingCategory;
  /** 「食材支出」＝主食材子類；「滷料」＝滷料配料子類 */
  subCategory?: string;
  /**
   * SQL：`sub_category_key`／關聯子類表；由 subCategory 正規化後寫入，便於 JOIN 主食材／滷料子類維度表。
   */
  normalizedSubKey?: string;
  /** SQL：與 category 冗餘之領域欄位，便於報表與 CHECK 約束 */
  expenseDomain?: AccountingLedgerExpenseDomain;
  note: string;
  amount: number;
  createdAt: string;
  /** ISO 最後更新（舊資料由 createdAt 補齊） */
  updatedAt: string;
};

type StoreV1 = {
  version: 1;
  entries: AccountingLedgerEntry[];
};
type StoreV2 = {
  version: 2;
  byScope: Record<string, AccountingLedgerEntry[]>;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeSubCategoryOnSave(category: AccountingCategory, sub: string | undefined | null): string | undefined {
  if (category !== FOOD_EXPENSE_CATEGORY && category !== MARINADE_EXPENSE_CATEGORY) return undefined;
  const t = (sub ?? '').trim();
  return t || undefined;
}

/** 由大類＋子類文字派生 SQL 友善之領域與子類鍵（與 MAIN_INGREDIENT_SUBS／SEASONING_SUBS 或 legacy 對齊） */
export function deriveLedgerSqlFields(
  category: AccountingCategory,
  subCategory: string | undefined,
): { expenseDomain: AccountingLedgerExpenseDomain; normalizedSubKey?: string } {
  if (category === FOOD_EXPENSE_CATEGORY) {
    const main = normalizeSubToMainBucket(subCategory);
    return {
      expenseDomain: 'ingredient_cogs',
      normalizedSubKey: main ?? (subCategory?.trim() || undefined),
    };
  }
  if (category === MARINADE_EXPENSE_CATEGORY) {
    const sea = normalizeSubToSeasoningBucket(subCategory);
    return {
      expenseDomain: 'marinade',
      normalizedSubKey: sea ?? (subCategory?.trim() || undefined),
    };
  }
  return { expenseDomain: 'general', normalizedSubKey: undefined };
}

function coerceEntry(e: AccountingLedgerEntry & { updatedAt?: string }): AccountingLedgerEntry {
  const needsSub =
    (e.category === FOOD_EXPENSE_CATEGORY || e.category === MARINADE_EXPENSE_CATEGORY) &&
    e.subCategory &&
    String(e.subCategory).trim();
  const sub = needsSub ? String(e.subCategory).trim() : undefined;
  const createdAt = e.createdAt;
  const { expenseDomain, normalizedSubKey } = deriveLedgerSqlFields(e.category, sub);
  return {
    ...e,
    subCategory: sub,
    expenseDomain,
    normalizedSubKey,
    updatedAt: e.updatedAt ?? createdAt,
  };
}

function loadStore(): StoreV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 2, byScope: {} };
    const p = JSON.parse(raw) as StoreV1 | StoreV2;
    if (!p || typeof p !== 'object') return { version: 2, byScope: {} };
    if ('version' in p && p.version === 2 && 'byScope' in p && p.byScope && typeof p.byScope === 'object') {
      const byScope: Record<string, AccountingLedgerEntry[]> = {};
      for (const [scopeId, rows] of Object.entries(p.byScope)) {
        byScope[scopeId] = Array.isArray(rows)
          ? (rows as AccountingLedgerEntry[]).map((row) => coerceEntry(row as AccountingLedgerEntry))
          : [];
      }
      return { version: 2, byScope };
    }
    // v1 migration: 舊資料歸屬目前登入範圍
    const scopeId = getDataScopeContext().scopeId;
    const legacyRows = Array.isArray((p as StoreV1).entries)
      ? (p as StoreV1).entries.map((row) => coerceEntry(row as AccountingLedgerEntry))
      : [];
    return { version: 2, byScope: { [scopeId]: legacyRows } };
  } catch {
    return { version: 2, byScope: {} };
  }
}

function saveStore(s: StoreV2) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(ACCOUNTING_LEDGER_UPDATED_EVENT));
}

function sortEntries(entries: AccountingLedgerEntry[]): AccountingLedgerEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = b.dateYmd.localeCompare(a.dateYmd);
    if (byDate !== 0) return byDate;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** 新選單：食材支出可選子類 */
export function isCurrentIngredientSubOption(s: string | undefined): s is IngredientSubCategory {
  return s !== undefined && (INGREDIENT_SUBCATEGORIES as readonly string[]).includes(s);
}

/** 新增「食材支出」：僅主食材子類 */
export function isValidIngredientSubForEntry(s: string | undefined): boolean {
  if (!s || !String(s).trim()) return false;
  const t = String(s).trim();
  return (MAIN_INGREDIENT_SUBS as readonly string[]).includes(t);
}

/** 編輯「食材支出」：可保留本筆原有非主食材字串（例如誤列之滷料子項），方便改列為「滷料」 */
export function canSaveIngredientSubWhenEditing(
  next: string | undefined,
  previous: string | undefined
): boolean {
  if (!next?.trim()) return false;
  if (isValidIngredientSubForEntry(next)) return true;
  return previous !== undefined && next.trim() === String(previous).trim();
}

/** 新選單：滷料可選子類 */
export function isCurrentMarinadeSubOption(s: string | undefined): boolean {
  return s !== undefined && (SEASONING_SUBS as readonly string[]).includes(s);
}

/** 新增「滷料」支出：滷料配料或已知舊版字串 */
export function isValidMarinadeSubForEntry(s: string | undefined): boolean {
  if (!s || !String(s).trim()) return false;
  const t = String(s).trim();
  if ((SEASONING_SUBS as readonly string[]).includes(t)) return true;
  if ((LEGACY_SEASONING_SUBS as readonly string[]).includes(t)) return true;
  if (t === LEGACY_OTHER_SUB) return true;
  return false;
}

/** 編輯「滷料」：可保留無子類之歷史整筆，或未知字串 */
export function canSaveMarinadeSubWhenEditing(
  next: string | undefined,
  previous: string | undefined
): boolean {
  const nt = next?.trim() ?? '';
  const pt = previous?.trim() ?? '';
  if (!nt) return pt === '';
  if (isValidMarinadeSubForEntry(next)) return true;
  return nt === pt;
}

/** 統計用：主食材子類正規化 */
export function normalizeSubToMainBucket(sub: string | undefined): MainIngredientSub | null {
  if (!sub) return null;
  const t = sub.trim();
  if ((MAIN_INGREDIENT_SUBS as readonly string[]).includes(t)) return t as MainIngredientSub;
  return null;
}

/** 統計用：滷料配料子類正規化（合併舊八角/桂皮/甘草/其他） */
export function normalizeSubToSeasoningBucket(sub: string | undefined): SeasoningSub | null {
  if (!sub) return null;
  const t = sub.trim();
  if ((SEASONING_SUBS as readonly string[]).includes(t)) return t as SeasoningSub;
  if ((LEGACY_SEASONING_SUBS as readonly string[]).includes(t)) return '中草藥(八角/桂皮等)';
  if (t === LEGACY_OTHER_SUB) return '其他調味';
  return null;
}

/** 單筆食材支出：是否計入 COGS */
export function ledgerEntryContributesToCOGS(e: AccountingLedgerEntry): boolean {
  return e.flowType === 'expense' && e.category === FOOD_EXPENSE_CATEGORY && normalizeSubToMainBucket(e.subCategory) !== null;
}

/** 單筆：是否計入滷汁成本（僅頂層「滷料」類別） */
export function ledgerEntryContributesToSeasoning(e: AccountingLedgerEntry): boolean {
  return e.flowType === 'expense' && e.category === MARINADE_EXPENSE_CATEGORY;
}

/** UI：滷料大項 */
export function ledgerEntryHasMarinadeTag(e: AccountingLedgerEntry): boolean {
  return e.flowType === 'expense' && e.category === MARINADE_EXPENSE_CATEGORY;
}

/** 舊資料：滷料子項誤列在「食材支出」 */
export function ledgerEntryHasMisplacedSeasoningUnderFood(e: AccountingLedgerEntry): boolean {
  return (
    e.flowType === 'expense' &&
    e.category === FOOD_EXPENSE_CATEGORY &&
    normalizeSubToSeasoningBucket(e.subCategory) !== null
  );
}

export function ledgerMarinadeGroupLabel(e: AccountingLedgerEntry): typeof MARINADE_GROUP_LABEL | null {
  return ledgerEntryHasMarinadeTag(e) ? MARINADE_GROUP_LABEL : null;
}

export type MarinadeExpenseAnalysis = {
  totalMarinadeExpense: number;
  bySeasoningSub: Record<SeasoningSub, number>;
  legacyCategoryLump: number;
  spanDays: number;
  avgDailyMarinade: number;
  pieRows: { name: string; value: number }[];
};

function daysInclusiveBetween(startYmd: string, endYmd: string): number {
  const [y0, m0, d0] = startYmd.split('-').map(Number);
  const [y1, m1, d1] = endYmd.split('-').map(Number);
  const a = new Date(y0, m0 - 1, d0);
  const b = new Date(y1, m1 - 1, d1);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, Math.floor((b.getTime() - a.getTime()) / 86400000) + 1);
}

/**
 * 滷料支出分析（區間內）：僅 category「滷料」；無法對應子類者併入 legacy 塊。
 */
export function computeMarinadeExpenseAnalysis(
  entries: AccountingLedgerEntry[],
  rangeLo: string,
  rangeHi: string
): MarinadeExpenseAnalysis {
  const lo = rangeLo <= rangeHi ? rangeLo : rangeHi;
  const hi = rangeLo <= rangeHi ? rangeHi : rangeLo;
  const inRange = entries.filter((e) => e.dateYmd >= lo && e.dateYmd <= hi && e.flowType === 'expense');

  const bySeasoningSub = Object.fromEntries(SEASONING_SUBS.map((s) => [s, 0])) as Record<SeasoningSub, number>;
  let legacyCategoryLump = 0;

  for (const e of inRange) {
    if (e.category !== MARINADE_EXPENSE_CATEGORY) continue;
    const bucket = normalizeSubToSeasoningBucket(e.subCategory);
    if (bucket) bySeasoningSub[bucket] += e.amount;
    else legacyCategoryLump += e.amount;
  }

  const seasoningCoreTotal = SEASONING_SUBS.reduce((sum, k) => sum + bySeasoningSub[k], 0);
  const totalMarinadeExpense = seasoningCoreTotal + legacyCategoryLump;
  const spanDays = daysInclusiveBetween(lo, hi);
  const avgDailyMarinade = totalMarinadeExpense / spanDays;

  const pieRows: { name: string; value: number }[] = [];
  for (const sub of SEASONING_SUBS) {
    if (bySeasoningSub[sub] > 0) pieRows.push({ name: sub, value: bySeasoningSub[sub] });
  }
  if (legacyCategoryLump > 0) {
    pieRows.push({ name: '未指定子類／其他', value: legacyCategoryLump });
  }

  return {
    totalMarinadeExpense,
    bySeasoningSub,
    legacyCategoryLump,
    spanDays,
    avgDailyMarinade,
    pieRows,
  };
}

/**
 * 本月：Total_COGS＝「食材支出」且為主食材子類；Total_Seasoning＝頂層「滷料」類別（整筆）。
 */
export function sumFoodExpenseCOGSAndSeasoningForMonth(ym: string): {
  totalCOGS: number;
  totalSeasoning: number;
} {
  const rows = listAccountingLedgerEntriesForMonth(ym).filter((e) => e.flowType === 'expense');
  let totalCOGS = 0;
  let totalSeasoning = 0;
  for (const e of rows) {
    if (e.category === MARINADE_EXPENSE_CATEGORY) {
      totalSeasoning += e.amount;
      continue;
    }
    if (e.category === FOOD_EXPENSE_CATEGORY && normalizeSubToMainBucket(e.subCategory)) {
      totalCOGS += e.amount;
    }
  }
  return { totalCOGS, totalSeasoning };
}

/** 「食材支出」進貨明細用標籤（不含滷料子項；滷料請見大項「滷料」） */
export function canonicalIngredientSpendLabel(sub: string | undefined): string | null {
  const m = normalizeSubToMainBucket(sub);
  if (m) return m;
  return null;
}

export type IngredientDetailRow = { name: string; value: number; pctOfIngredient: number };

/**
 * 本月「食材支出」各子項金額與占食材支出％（供進貨明細分析）。
 */
export function ingredientSubSpendBreakdownForMonth(ym: string): {
  rows: IngredientDetailRow[];
  totalIngredientExpense: number;
} {
  const prefix = ym.length === 7 ? ym : ym.slice(0, 7);
  const rowsIn = listAccountingLedgerEntries().filter(
    (e) => e.flowType === 'expense' && e.category === FOOD_EXPENSE_CATEGORY && e.dateYmd.startsWith(prefix)
  );
  const MISPLACED = '滷汁配料（請改列「滷料」大項）';
  const byLabel = new Map<string, number>();
  for (const e of rowsIn) {
    const main = canonicalIngredientSpendLabel(e.subCategory);
    if (main) {
      byLabel.set(main, (byLabel.get(main) ?? 0) + e.amount);
      continue;
    }
    if (normalizeSubToSeasoningBucket(e.subCategory)) {
      byLabel.set(MISPLACED, (byLabel.get(MISPLACED) ?? 0) + e.amount);
      continue;
    }
    const fallback = e.subCategory?.trim() ? e.subCategory.trim() : '未分類子項';
    byLabel.set(fallback, (byLabel.get(fallback) ?? 0) + e.amount);
  }
  const totalIngredientExpense = rowsIn.reduce((s, e) => s + e.amount, 0);
  const rows: IngredientDetailRow[] = Array.from(byLabel.entries())
    .map(([name, value]) => ({
      name,
      value,
      pctOfIngredient: totalIngredientExpense > 0 ? (value / totalIngredientExpense) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
  return { rows, totalIngredientExpense };
}

/** 所有紀錄（新→舊） */
export function listAccountingLedgerEntries(): AccountingLedgerEntry[] {
  const { isAdmin, scopeId } = getDataScopeContext();
  const s = loadStore();
  if (isAdmin) {
    const all = Object.values(s.byScope).flat();
    return sortEntries(all);
  }
  return sortEntries(s.byScope[scopeId] ?? []);
}

/** 依 YYYY-MM 篩選 */
export function listAccountingLedgerEntriesForMonth(ym: string): AccountingLedgerEntry[] {
  const prefix = ym.length === 7 ? ym : ym.slice(0, 7);
  return listAccountingLedgerEntries().filter((e) => e.dateYmd.startsWith(prefix));
}

export type NewAccountingLedgerInput = {
  dateYmd: string;
  flowType: AccountingFlowType;
  category: AccountingCategory;
  subCategory?: string | null;
  note: string;
  amount: number;
};

export function appendAccountingLedgerEntry(input: NewAccountingLedgerInput): AccountingLedgerEntry {
  const s = loadStore();
  const scopeId = getDataScopeContext().scopeId;
  const rows = s.byScope[scopeId] ?? [];
  const now = new Date().toISOString();
  const entry: AccountingLedgerEntry = {
    id: newId(),
    dateYmd: input.dateYmd,
    flowType: input.flowType,
    category: input.category,
    subCategory: normalizeSubCategoryOnSave(input.category, input.subCategory),
    note: input.note.trim(),
    amount: input.amount,
    createdAt: now,
    updatedAt: now,
  };
  const finalized = coerceEntry(entry);
  rows.push(finalized);
  s.byScope[scopeId] = rows;
  saveStore(s);
  return finalized;
}

export function removeAccountingLedgerEntry(id: string): boolean {
  const s = loadStore();
  const { isAdmin, scopeId } = getDataScopeContext();
  if (isAdmin) {
    let changed = false;
    for (const k of Object.keys(s.byScope)) {
      const prev = s.byScope[k] ?? [];
      const next = prev.filter((e) => e.id !== id);
      if (next.length !== prev.length) {
        s.byScope[k] = next;
        changed = true;
      }
    }
    if (!changed) return false;
    saveStore(s);
    return true;
  }
  const prev = s.byScope[scopeId] ?? [];
  const next = prev.filter((e) => e.id !== id);
  if (next.length === prev.length) return false;
  s.byScope[scopeId] = next;
  saveStore(s);
  return true;
}

export type AccountingLedgerUpdate = {
  dateYmd: string;
  flowType: AccountingFlowType;
  category: AccountingCategory;
  subCategory?: string | null;
  note: string;
  amount: number;
};

export function updateAccountingLedgerEntry(id: string, patch: AccountingLedgerUpdate): boolean {
  const s = loadStore();
  const { isAdmin, scopeId } = getDataScopeContext();
  const buckets = isAdmin ? Object.keys(s.byScope) : [scopeId];
  let foundBucket = '';
  let i = -1;
  for (const b of buckets) {
    i = (s.byScope[b] ?? []).findIndex((e) => e.id === id);
    if (i >= 0) {
      foundBucket = b;
      break;
    }
  }
  if (!foundBucket || i < 0) return false;
  const prev = s.byScope[foundBucket]![i];
  const now = new Date().toISOString();
  s.byScope[foundBucket]![i] = coerceEntry({
    ...prev,
    dateYmd: patch.dateYmd,
    flowType: patch.flowType,
    category: patch.category,
    subCategory: normalizeSubCategoryOnSave(patch.category, patch.subCategory),
    note: patch.note.trim(),
    amount: patch.amount,
    updatedAt: now,
  });
  saveStore(s);
  return true;
}

export function listAccountingLedgerEntriesInDateRange(startYmd: string, endYmd: string): AccountingLedgerEntry[] {
  const a = startYmd <= endYmd ? startYmd : endYmd;
  const b = startYmd <= endYmd ? endYmd : startYmd;
  return listAccountingLedgerEntries().filter((e) => e.dateYmd >= a && e.dateYmd <= b);
}

export function sumAccountingLedgerForMonth(ym: string, flow: AccountingFlowType): number {
  return listAccountingLedgerEntriesForMonth(ym)
    .filter((e) => e.flowType === flow)
    .reduce((acc, e) => acc + e.amount, 0);
}
