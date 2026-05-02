/**
 * 財務與營運指標計算（純函式，不依賴 React／畫面）。
 * 供儀表板、匯出報表或未來 AI／API 串接使用。
 */
import { loadCompletedOrderHistoryList } from './orderHistoryStorage';
import {
  listAccountingLedgerEntriesForMonth,
  ingredientSubSpendBreakdownForMonth,
  sumFoodExpenseCOGSAndSeasoningForMonth,
} from './accountingLedgerStorage';

/** 本機曆法目前年月 YYYY-MM */
export function currentYmLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function orderCreatedInYm(iso: string, ym: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return prefix === ym.slice(0, 7);
}

export type ExpenseBreakdownRow = {
  name: string;
  value: number;
  pctOfExpense: number;
};

export type AdminDashboardFinance = {
  ym: string;
  /** 本月已完成之加盟主叫貨合計 */
  franchiseeOrderTotal: number;
  /** 本月流水帳「收入」合計 */
  ledgerIncomeTotal: number;
  /** 營收總計 = 加盟主訂單 + 流水帳收入 */
  revenueTotal: number;
  /** 本月已完成之總部／直營叫貨合計（admin + employee） */
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
 * 超級管理員儀表板：以「本月」曆法、僅統計狀態「已完成」叫貨單。
 */
export function computeAdminDashboardFinance(ym: string): AdminDashboardFinance {
  const ymKey = ym.slice(0, 7);
  const orders = loadCompletedOrderHistoryList().filter((o) => orderCreatedInYm(o.createdAt, ymKey));

  let franchiseeOrderTotal = 0;
  let procurementCostTotal = 0;
  for (const o of orders) {
    if (o.actorRole === 'franchisee') {
      franchiseeOrderTotal += o.totalAmount;
    } else if (o.actorRole === 'admin' || o.actorRole === 'employee') {
      procurementCostTotal += o.totalAmount;
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

  const revenueTotal = franchiseeOrderTotal + ledgerIncomeTotal;
  const expenseTotal = procurementCostTotal + ledgerExpenseTotal;
  const netProfit = revenueTotal - expenseTotal;

  const breakdown: { name: string; value: number }[] = [];
  if (procurementCostTotal > 0) {
    breakdown.push({ name: PROCUREMENT_LABEL, value: procurementCostTotal });
  }
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
