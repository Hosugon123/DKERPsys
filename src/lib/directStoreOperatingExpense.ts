/**
 * 直營店營運支出：僅認列收支「直營店營業支出」（與可選「直營店薪資」），不含叫貨批貨金額。
 */
import { HQ_SCOPE_ID } from './dataScope';
import {
  isDirectStoreOperatingLedgerExpense,
  isDirectStorePayrollLedgerExpense,
  listAccountingLedgerEntriesForScopeId,
} from './accountingLedgerStorage';
import {
  effectiveOrderDateYmd,
  orderIsHeadquartersDirectScoped,
  type OrderHistoryEntry,
} from './orderHistoryStorage';

export type DirectStoreOperatingExpenseBreakdown = {
  /** 區間內直營已完成叫貨 totalAmount 合計（依建單日；僅供參考，不計入 total） */
  procurementTotal: number;
  /** 與 total 相同：「直營店營業支出」類別合計 */
  ledgerExpenseTotal: number;
  /** 區間內「直營店營業支出」類別合計 */
  ledgerOperatingExpenseTotal: number;
  /** 區間內「直營店薪資」類別合計（不計入 total） */
  ledgerPayrollTotal: number;
  /** 計入 KPI：僅「直營店營業支出」類別（不含批貨、不含薪資） */
  total: number;
};

/** @deprecated 薪資與批貨皆不計入直營店營運 KPI；保留參數以相容舊呼叫 */
export type DirectStoreLedgerExpenseSumOpts = {
  includePayroll?: boolean;
};

function normalizeYmdRange(startYmd: string, endYmd: string): { startYmd: string; endYmd: string } {
  return startYmd <= endYmd ? { startYmd, endYmd } : { startYmd: endYmd, endYmd: startYmd };
}

/** 直營店批貨支出（叫貨單，不含收支紀錄其他類別） */
export function sumDirectStoreProcurementInDateRange(
  orders: OrderHistoryEntry[],
  startYmd: string,
  endYmd: string,
): number {
  const { startYmd: a, endYmd: b } = normalizeYmdRange(startYmd, endYmd);
  let sum = 0;
  for (const o of orders) {
    if (!orderIsHeadquartersDirectScoped(o) || o.status !== '已完成') continue;
    const bookYmd = effectiveOrderDateYmd(o);
    if (bookYmd >= a && bookYmd <= b) sum += o.totalAmount;
  }
  return sum;
}

/** 直營店營業支出／薪資類別之收支紀錄 */
export function sumDirectStoreLedgerExpenseInDateRange(
  startYmd: string,
  endYmd: string,
  scopeId: string = HQ_SCOPE_ID,
  opts?: DirectStoreLedgerExpenseSumOpts,
): number {
  const includePayroll = opts?.includePayroll !== false;
  const { startYmd: a, endYmd: b } = normalizeYmdRange(startYmd, endYmd);
  let sum = 0;
  for (const e of listAccountingLedgerEntriesForScopeId(scopeId)) {
    if (e.dateYmd < a || e.dateYmd > b) continue;
    if (isDirectStorePayrollLedgerExpense(e)) {
      if (includePayroll) sum += e.amount;
      continue;
    }
    if (isDirectStoreOperatingLedgerExpense(e)) sum += e.amount;
  }
  return sum;
}

export function sumDirectStoreLedgerExpensePartsInDateRange(
  startYmd: string,
  endYmd: string,
  scopeId: string = HQ_SCOPE_ID,
): { operating: number; payroll: number; total: number } {
  const { startYmd: a, endYmd: b } = normalizeYmdRange(startYmd, endYmd);
  let operating = 0;
  let payroll = 0;
  for (const e of listAccountingLedgerEntriesForScopeId(scopeId)) {
    if (e.dateYmd < a || e.dateYmd > b) continue;
    if (isDirectStorePayrollLedgerExpense(e)) payroll += e.amount;
    else if (isDirectStoreOperatingLedgerExpense(e)) operating += e.amount;
  }
  return { operating, payroll, total: operating + payroll };
}

export function computeDirectStoreOperatingExpense(
  orders: OrderHistoryEntry[],
  startYmd: string,
  endYmd: string,
  ledgerScopeId: string = HQ_SCOPE_ID,
  opts?: DirectStoreLedgerExpenseSumOpts,
): DirectStoreOperatingExpenseBreakdown {
  const procurementTotal = sumDirectStoreProcurementInDateRange(orders, startYmd, endYmd);
  const parts = sumDirectStoreLedgerExpensePartsInDateRange(startYmd, endYmd, ledgerScopeId);
  const ledgerOperatingExpenseTotal = parts.operating;
  const ledgerPayrollTotal = parts.payroll;
  return {
    procurementTotal,
    ledgerExpenseTotal: ledgerOperatingExpenseTotal,
    ledgerOperatingExpenseTotal,
    ledgerPayrollTotal,
    total: ledgerOperatingExpenseTotal,
  };
}
