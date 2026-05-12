/**
 * 財務與營運指標計算（純函式，不依賴 React／畫面）。
 * 供儀表板、匯出報表或未來 AI／API 串接使用。
 */
import { toLocalYmdDashed } from './dateDisplay';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  effectiveOrderDateYmd,
  orderIsFranchiseBusinessScoped,
  orderIsHeadquartersDirectScoped,
  type OrderHistoryEntry,
} from './orderHistoryStorage';
import { getStallDisplaySoldAtRetail } from './orderStallDisplayRevenue';
import type { SupplyRetailView } from './supplyCatalog';
import { getSalesRecord, mergeSalesRecordWithCatalog } from './salesRecordStorage';
import { num } from './stallMath';
import { resolveOrderStoreLabel } from './orderStoreLabel';
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

export type StallGapDetailRow = {
  orderId: string;
  storeLabel: string;
  stallYmd: string;
  loggedGapAmount: number;
  reason: string;
  /** max(0, 盤點零售 − 登錄實收) */
  bookShortfall: number;
};

export type StallGapReasonAgg = {
  reason: string;
  orderCount: number;
  loggedAmountSum: number;
};

export type StallGapSummary = {
  /** Σ 登記落差金額（代數和；負值多為短少／未入帳之登記） */
  loggedGapSum: number;
  /** Σ max(0, 盤點零售營收 − 登錄實收) */
  bookShortfallSum: number;
  /**
   * 推估呆帳：帳面短收合計 − |登記落差加總|（不低於 0）。
   * 登記落差不論正負，皆以絕對值視為已說明／已登錄之沖減幅度，避免僅負值才扣抵造成正登記無效。
   */
  badDebtEstimate: number;
  reasonBreakdown: StallGapReasonAgg[];
  rows: StallGapDetailRow[];
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
  /** 支出總計＝流水帳支出（不含叫貨／批貨進貨成本） */
  expenseTotal: number;
  netProfit: number;
  /** 僅含金額 &gt; 0 之支出項，供圖表用 */
  expenseBreakdown: ExpenseBreakdownRow[];
  /** 本月盤點落差／呆帳推估（依盤點日歸屬月） */
  stallGap: StallGapSummary;
};

const PROCUREMENT_LABEL = '進貨成本（直營／總部叫貨）';

function resolveStallSnapshotForGap(o: OrderHistoryEntry) {
  if (o.stallCountSnapshot) return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  if (o.stallCountBasisYmd) {
    const day = getSalesRecord(o.stallCountBasisYmd);
    return day ? mergeSalesRecordWithCatalog(day) : null;
  }
  return null;
}

/**
 * 彙總盤點登錄實收與帳面零售之差異、登記落差與推估呆帳。
 * @param range 以盤點歸屬日（stallCountBasisYmd 或完成時間）落在區間內之單據為準。
 */
export function computeStallGapSummary(
  orders: OrderHistoryEntry[],
  range: { type: 'ym'; ymKey: string } | { type: 'ymd'; startYmd: string; endYmd: string },
): StallGapSummary {
  const ymKey = range.type === 'ym' ? range.ymKey.slice(0, 7) : null;
  const startYmd = range.type === 'ymd' ? range.startYmd : '';
  const endYmd = range.type === 'ymd' ? range.endYmd : '';

  let loggedGapSum = 0;
  let bookShortfallSum = 0;
  const rows: StallGapDetailRow[] = [];

  for (const o of orders) {
    if (!o.stallCountCompletedAt) continue;
    const stallYmd = stallCountAttributeYmd(o);
    if (!stallYmd) continue;
    if (ymKey != null) {
      if (stallCountAttributeYmKey(o) !== ymKey) continue;
    } else if (stallYmd < startYmd || stallYmd > endYmd) {
      continue;
    }

    const snap = resolveStallSnapshotForGap(o);
    if (!snap) continue;

    const retailSold = getStallDisplaySoldAtRetail(o, HQ_STALL_RETAIL_VIEW);
    const actualRev = num(snap.actualRevenue);
    const bookShortfall =
      retailSold != null ? Math.max(0, retailSold - actualRev) : 0;
    const gapN = num(snap.revenueGapAmount ?? '');
    const reason = (snap.revenueGapReason ?? '').trim();

    loggedGapSum += gapN;
    bookShortfallSum += bookShortfall;

    if (gapN !== 0 || reason || bookShortfall > 0) {
      rows.push({
        orderId: o.id,
        storeLabel: resolveOrderStoreLabel({
          storeLabel: o.storeLabel,
          actorRole: o.actorRole,
          actorUserId: o.actorUserId,
          scopeId: o.scopeId,
        }),
        stallYmd,
        loggedGapAmount: gapN,
        reason: reason || '—',
        bookShortfall,
      });
    }
  }

  const badDebtEstimate = Math.max(0, bookShortfallSum - Math.abs(loggedGapSum));

  const reasonMap = new Map<string, { count: number; sum: number }>();
  for (const r of rows) {
    if (!r.reason || r.reason === '—') continue;
    const prev = reasonMap.get(r.reason) ?? { count: 0, sum: 0 };
    prev.count += 1;
    prev.sum += r.loggedGapAmount;
    reasonMap.set(r.reason, prev);
  }
  const reasonBreakdown = Array.from(reasonMap.entries())
    .map(([reason, { count, sum }]) => ({
      reason,
      orderCount: count,
      loggedAmountSum: sum,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.loggedAmountSum) - Math.abs(a.loggedAmountSum) || b.orderCount - a.orderCount,
    );

  rows.sort((a, b) => b.stallYmd.localeCompare(a.stallYmd) || b.orderId.localeCompare(a.orderId));

  return { loggedGapSum, bookShortfallSum, badDebtEstimate, reasonBreakdown, rows };
}

/**
 * 超級管理員儀表板：本月曆法。
 * 營收：直營＝盤點日歸屬月內之零售×售出；加盟＝建單於本月且已完成叫貨。
 * 支出：僅本月流水帳支出（不含叫貨／批貨進貨成本）。
 */
export function computeAdminDashboardFinance(ym: string): AdminDashboardFinance {
  const ymKey = ym.slice(0, 7);
  const merged = mergeOrdersForAdminFinance();
  /** 總部營運卡：僅直營／總部視角之盤點落差（不含加盟門市單） */
  const stallGapOrders = merged.filter((o) => orderIsHeadquartersDirectScoped(o));
  const stallGap = computeStallGapSummary(stallGapOrders, { type: 'ym', ymKey });

  let directStoreStallRetailTotal = 0;
  let franchiseeOrderTotal = 0;
  const procurementCostTotal = 0;

  for (const o of merged) {
    if (
      orderIsFranchiseBusinessScoped(o) &&
      o.status === '已完成' &&
      orderBookkeepingYmdStartsWithYm(o, ymKey)
    ) {
      const selfSupplied =
        o.selfSuppliedCostAmount ?? Math.max(0, o.totalAmount - (o.payableAmount ?? o.totalAmount));
      franchiseeOrderTotal += Math.max(0, o.totalAmount - selfSupplied);
    }
    if (
      orderIsHeadquartersDirectScoped(o) &&
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
    stallGap,
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
