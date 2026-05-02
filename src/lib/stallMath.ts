import type { SupplyItem } from './supplyCatalog';
import { pricePerPackage, isConsumableItem, estimatedRetailPerPackage } from './supplyCatalog';

export function num(s: string | undefined) {
  const n = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function soldFromRow(out: number, remain: number) {
  return Math.max(0, out - remain);
}

/** 剩餘量 ÷ 帶出量，0%～100% */
export function leftoverRate(out: number, remain: number) {
  if (out <= 0) return 0;
  return (remain / out) * 100;
}

export type LineComputed = {
  out: number;
  remain: number;
  sold: number;
  estPrice: number;
  remValue: number;
  soldRevenue: number;
  leftRatePct: number;
  /** 剩餘欄位為空白（未填）— 不應以 0 推算售出，帳上該列售出／應有營收不計入 */
  remainUnfilled: boolean;
};

/**
 * 攤上「剩餘貨量」欄：已填且為 ≥0 之有效數字（含 0 表示售完）即為通過，空白則未填。
 */
export function isStallRemainEntryValid(remainS: string | undefined): boolean {
  const t = String(remainS ?? '').trim();
  if (t === '') return false;
  const n = Number(String(t).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0;
}

export function computeLine(
  outS: string,
  remainS: string,
  item: SupplyItem
): LineComputed {
  const out = num(outS);
  const remainUnfilled = String(remainS ?? '').trim() === '';
  const remain = remainUnfilled ? 0 : num(remainS);
  const unit = pricePerPackage(item);
  const sold = remainUnfilled ? 0 : soldFromRow(out, remain);
  return {
    out,
    remain,
    sold,
    estPrice: out * unit,
    remValue: remain * unit,
    soldRevenue: sold * unit,
    leftRatePct: remainUnfilled || out <= 0 ? 0 : leftoverRate(out, remain),
    remainUnfilled,
  };
}

export type DayKpis = {
  estTotal: number;
  remGoodsValue: number;
  /** 批价 × 售出量（帳上成本／與帶出同單价基準） */
  shouldRevenue: number;
  /** 依本機零售參考 × 售出量（盤點金額） */
  soldAtRetail: number;
};

/** 攤上彙總：販售品與耗材分欄。耗材不計入 retail（與帳上營收對帳用）。 */
export type StallKpiSplit = {
  /** 分類非「消耗品」之加總，供 應有營業額／帳面落差 使用 */
  retail: DayKpis;
  /** 僅參考：耗材帶出／收攤之庫值，不併入上列應有營收 */
  consumable: { estTotal: number; remGoodsValue: number; soldVolume: number };
};

export function aggregateStallKpis(
  itemIds: string[],
  getOutRemain: (id: string) => { out: string; remain: string },
  getItem: (id: string) => SupplyItem | undefined
): StallKpiSplit {
  const retail: DayKpis = { estTotal: 0, remGoodsValue: 0, shouldRevenue: 0, soldAtRetail: 0 };
  const cons = { estTotal: 0, remGoodsValue: 0, soldVolume: 0 };
  for (const id of itemIds) {
    const it = getItem(id);
    if (!it) continue;
    const { out, remain } = getOutRemain(id);
    const c = computeLine(out, remain, it);
    if (isConsumableItem(it)) {
      cons.estTotal += c.estPrice;
      cons.remGoodsValue += c.remValue;
      cons.soldVolume += c.sold;
    } else {
      retail.estTotal += c.estPrice;
      retail.remGoodsValue += c.remValue;
      retail.shouldRevenue += c.soldRevenue;
      retail.soldAtRetail += c.sold * estimatedRetailPerPackage(it);
    }
  }
  retail.soldAtRetail = Math.round(retail.soldAtRetail * 100) / 100;
  return { retail, consumable: cons };
}

/**
 * 已等同 {@link aggregateStallKpis} 的 **販售品** 加總（不含分類「消耗品」之金額）；
 * 用於歷程相容與僅需單一 DayKpis 的呼叫端。
 */
export function aggregateDayKpis(
  itemIds: string[],
  getOutRemain: (id: string) => { out: string; remain: string },
  getItem: (id: string) => SupplyItem | undefined
): DayKpis {
  return aggregateStallKpis(itemIds, getOutRemain, getItem).retail;
}

/** 叫貨（斤、份等）可輸入小數；與庫存扣減一併用三位小數內。 */
export const PROCUREMENT_QTY_MAX = 99_999;

export function roundProcurementQty(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(PROCUREMENT_QTY_MAX, Math.round(n * 1000) / 1000);
}
