/**
 * 叫貨完成後可選帶入流水帳之草稿輸入。
 */
import type { ItemCategory } from './supplyCatalog';
import { getSupplyItem, isConsumableItem } from './supplyCatalog';
import type { NewAccountingLedgerInput } from './accountingLedgerStorage';
import type { OrderHistoryLine } from './orderHistoryStorage';

const CATEGORY_TO_SUB: Partial<Record<ItemCategory, string>> = {
  duck: '鴨貨類',
  tofu: '加工食品',
  pork: '豬肉類',
  veg: '蔬菜類',
};

/** 依叫貨明細推斷食材支出子類（消耗品不計入）。 */
export function inferIngredientSubFromLines(lines: OrderHistoryLine[]): string {
  const weight = new Map<string, number>();
  for (const line of lines) {
    const item = getSupplyItem(line.productId);
    if (!item || isConsumableItem(item)) continue;
    const sub = CATEGORY_TO_SUB[item.category] ?? '鴨貨類';
    const amt = (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
    weight.set(sub, (weight.get(sub) ?? 0) + amt);
  }
  if (weight.size === 0) return '鴨貨類';
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export function buildProcurementLedgerDraftInput(params: {
  lines: OrderHistoryLine[];
  payableAmount: number;
  orderDateYmd: string;
  orderId: string;
}): NewAccountingLedgerInput | null {
  const amount = Math.round(params.payableAmount * 100) / 100;
  if (amount <= 0) return null;
  const subCategory = inferIngredientSubFromLines(params.lines);
  return {
    dateYmd: params.orderDateYmd,
    flowType: 'expense',
    category: '食材支出',
    subCategory,
    note: `叫貨單 ${params.orderId} 自動帶入`,
    amount,
  };
}

/**
 * 盤點落差可選同步至流水帳。
 * 正落差（短收／損耗等）→ 雜項支出；負落差（多收）→ 店外收入。
 */
export function buildStallGapLedgerDraftInput(params: {
  gapAmount: number;
  gapReason: string;
  basisYmd: string;
  orderId: string;
}): NewAccountingLedgerInput | null {
  const amount = Math.round(Math.abs(params.gapAmount) * 100) / 100;
  if (amount <= 0 || !Number.isFinite(amount)) return null;
  const reason = params.gapReason.trim() || '盤點落差';
  if (params.gapAmount < 0) {
    return {
      dateYmd: params.basisYmd,
      flowType: 'income',
      category: '店外收入',
      note: `盤點落差（多收）${params.orderId}：${reason}`,
      amount,
    };
  }
  return {
    dateYmd: params.basisYmd,
    flowType: 'expense',
    category: '雜項',
    note: `盤點落差 ${params.orderId}：${reason}`,
    amount,
  };
}
