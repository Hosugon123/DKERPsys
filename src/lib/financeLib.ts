/**
 * 財務與營運指標計算（純函式，不依賴 React／畫面）。
 * 供儀表板、匯出報表或未來 AI／API 串接使用。
 */
import { toLocalYmdDashed } from './dateDisplay';
import { loadFranchiseManagementOrders, loadOrderHistory } from './orderHistoryStorage';
import { effectiveOrderDateYmd, type OrderHistoryEntry } from './orderHistoryStorage';
import { getStallDisplaySoldAtRetail } from './orderStallDisplayRevenue';
import type { SupplyRetailView } from './supplyCatalog';
import {
  listAccountingLedgerEntriesForMonth,
  ingredientSubSpendBreakdownForMonth,
  sumFoodExpenseCOGSAndSeasoningForMonth,
} from './accountingLedgerStorage';

/** 總部儀表板盤點營收／KPI 使用之零售檢視（與超管預設一致） */
const HQ_STALL_RETAIL_VIEW: SupplyRetailView = 'headquarter';

/**
 * 盤點營收歸屬月：優先 `stallCountBasisYmd` 之 YYYY-MM；無則以盤點完成時間之本機曆法年月。
 */
export function stallCountAttributeYmKey(
  o: Pick<OrderHistoryEntry, 'stallCountBasisYmd' | 'stallCountCompletedAt'>,
): string | null {
  const b = o.stallCountBasisYmd?.trim();
  if (b && /^\d{4}-\d{2}-\d{2}$/.test(b)) return b.slice(0, 7);
  const iso = o.stallCountCompletedAt;
  if (!iso) return null;
  const ymd = toLocalYmdDashed(iso);
  return ymd ? ymd.slice(0, 7) : null;
}

/** 歸屬日 YYYY-MM-DD（區間摘要用）；無盤點日則以完成時間之本機日期。 */
export function stallCountAttributeYmd(
  o: Pick<OrderHistoryEntry, 'stallCountBasisYmd' | 'stallCountCompletedAt'>,
): string | null {
  const b = o.stallCountBasisYmd?.trim();
  if (b && /^\d{4}-\d{2}-\d{2}$/.test(b)) return b;
  const iso = o.stallCountCompletedAt;
  if (!iso) return null;
  return toLocalYmdDashed(iso) || null;
}

function mergeOrdersForAdminFinance(): OrderHistoryEntry[] {
  const mgmt = loadFranchiseManagementOrders().map<OrderHistoryEntry>((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    orderDateYmd: m.orderDateYmd,
    updatedAt: m.updatedAt ?? m.createdAt,
    source: m.source,
    totalAmount: m.totalAmount,
    payableAmount: m.payableAmount ?? m.totalAmount,
    itemCount: m.itemCount,
    lines: m.lines,
    actorRole: 'admin',
    storeLabel: m.storeLabel,
    status: m.status,
    stallCountBasisYmd: m.stallCountBasisYmd,
    stallCountCompletedAt: m.stallCountCompletedAt,
    stallCountSnapshot: m.stallCountSnapshot,
    scopeId: m.scopeId,
    actorUserId: m.actorUserId,
    createdByName: m.createdByName,
    stallCountCompletedByName: m.stallCountCompletedByName,
    stallCountCompletedByUserId: m.stallCountCompletedByUserId,
    lastUpdatedByName: m.lastUpdatedByName,
  }));
  const hist = loadOrderHistory();
  const byId = new Map<string, OrderHistoryEntry>();
  for (const e of mgmt) {
    byId.set(e.id, e);
  }
  for (const e of hist) {
    byId.set(e.id, e);
  }
  return Array.from(byId.values());
}

/** 本機曆法目前年月 YYYY-MM */
export function currentYmLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function orderBookkeepingYmdStartsWithYm(o: OrderHistoryEntry, ym: string): boolean {
  const ymd0 = effectiveOrderDateYmd(o);
  return ymd0.length >= 7 && ymd0.slice(0, 7) === ym.slice(0, 7);
}

export type ExpenseBreakdownRow = {
  name: string;
  value: number;
  pctOfExpense: number;
};

export type AdminDashboardFinance = {
  ym: string;
  /** 本月盤點歸屬之直營／總部單：零售參考 × 售出量（與銷售紀錄「盤點金額」一致） */
  directStoreStallRetailTotal: number;
  /** 本月已完成之加盟主叫貨合計 */
  franchiseeOrderTotal: number;
  /** 本月流水帳「收入」合計（營收總計以外另列） */
  ledgerIncomeTotal: number;
  /** 營收總計 = 直營店盤點營收 + 加盟主批貨 */
  revenueTotal: number;
  /** 本月直營進貨成本（改以流水帳支出認列；不再由叫貨/帶出推估） */
  procurementCostTotal: number;
  /** 本月流水帳「支出」合計 */
  ledgerExpenseTotal: number;
  /** 支出總計 = 進貨成本 + 流水帳支出 */
  expenseTotal: number;
  netProfit: number;
  /** 僅含金額 &gt; 0 之支出項，供圖表用 */
  expenseBreakdown: ExpenseBreakdownRow[];
};

const PROCUREMENT_LABEL = '進貨成本（直營／總部叫貨）';

/**
 * 超級管理員儀表板：本月曆法。
 * 營收：直營＝盤點日歸屬月內之零售×售出；加盟＝建單於本月且已完成叫貨。
 * 支出：本月已完成直營叫貨小計＋流水帳支出（與原邏輯相同）。
 */
export function computeAdminDashboardFinance(ym: string): AdminDashboardFinance {
  const ymKey = ym.slice(0, 7);
  const merged = mergeOrdersForAdminFinance();

  let directStoreStallRetailTotal = 0;
  let franchiseeOrderTotal = 0;
  const procurementCostTotal = 0;

  for (const o of merged) {
    if (o.actorRole === 'franchisee' && o.status === '已完成' && orderBookkeepingYmdStartsWithYm(o, ymKey)) {
      const selfSupplied =
        o.selfSuppliedCostAmount ?? Math.max(0, o.totalAmount - (o.payableAmount ?? o.totalAmount));
      franchiseeOrderTotal += Math.max(0, o.totalAmount - selfSupplied);
    }
    if (
      (o.actorRole === 'admin' || o.actorRole === 'employee') &&
      o.stallCountCompletedAt &&
      stallCountAttributeYmKey(o) === ymKey
    ) {
      const stallRev = getStallDisplaySoldAtRetail(o, HQ_STALL_RETAIL_VIEW);
      if (stallRev != null) directStoreStallRetailTotal += stallRev;
    }
  }

  const ledgerRows = listAccountingLedgerEntriesForMonth(ymKey);
  let ledgerIncomeTotal = 0;
  let ledgerExpenseTotal = 0;
  const ledgerExpenseByCategory = new Map<string, number>();

  for (const e of ledgerRows) {
    if (e.flowType === 'income') {
      ledgerIncomeTotal += e.amount;
    } else {
      ledgerExpenseTotal += e.amount;
      ledgerExpenseByCategory.set(e.category, (ledgerExpenseByCategory.get(e.category) ?? 0) + e.amount);
    }
  }

  const revenueTotal = directStoreStallRetailTotal + franchiseeOrderTotal;
  const expenseTotal = ledgerExpenseTotal;
  const netProfit = revenueTotal - expenseTotal;

  const breakdown: { name: string; value: number }[] = [];
  for (const [name, value] of ledgerExpenseByCategory) {
    if (value > 0) breakdown.push({ name, value });
  }
  breakdown.sort((a, b) => b.value - a.value);

  const expenseBreakdown: ExpenseBreakdownRow[] =
    expenseTotal > 0
      ? breakdown.map((row) => ({
          name: row.name,
          value: row.value,
          pctOfExpense: (row.value / expenseTotal) * 100,
        }))
      : [];

  return {
    ym: ymKey,
    directStoreStallRetailTotal,
    franchiseeOrderTotal,
    ledgerIncomeTotal,
    revenueTotal,
    procurementCostTotal,
    ledgerExpenseTotal,
    expenseTotal,
    netProfit,
    expenseBreakdown,
  };
}

export type IngredientMonthDashboard = {
  ym: string;
  /** 主食材進貨合計（Total_COGS） */
  totalCOGS: number;
  /** 流水帳「滷料」大項合計（Total_Seasoning，與食材支出分開） */
  totalSeasoning: number;
  /** 圓餅圖：主食材（食材支出）vs 滷料大項 */
  cogsVsSeasoningPie: { name: string; value: number }[];
  /** 進貨明細（子項金額由高到低） */
  ingredientDetailRows: { name: string; value: number; pctOfIngredient: number }[];
  /** 本月「食材支出」總額 */
  totalIngredientExpense: number;
};

/**
 * 管理員儀表板：本月食材支出結構（COGS / 滷汁成本、子項排行）。
 */
export function computeIngredientMonthDashboard(ym: string): IngredientMonthDashboard {
  const ymKey = ym.slice(0, 7);
  const { totalCOGS, totalSeasoning } = sumFoodExpenseCOGSAndSeasoningForMonth(ymKey);
  const { rows, totalIngredientExpense } = ingredientSubSpendBreakdownForMonth(ymKey);
  const combined = totalCOGS + totalSeasoning;
  const cogsVsSeasoningPie: { name: string; value: number }[] = [];
  if (combined > 0) {
    if (totalCOGS > 0) {
      cogsVsSeasoningPie.push({ name: '主食材進貨（銷貨成本）', value: totalCOGS });
    }
    if (totalSeasoning > 0) {
      cogsVsSeasoningPie.push({ name: '滷料大項（滷汁成本）', value: totalSeasoning });
    }
  }
  return {
    ym: ymKey,
    totalCOGS,
    totalSeasoning,
    cogsVsSeasoningPie,
    ingredientDetailRows: rows,
    totalIngredientExpense,
  };
}
