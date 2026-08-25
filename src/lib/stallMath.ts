import type { SupplyItem } from './supplyCatalog';
import { pricePerPackage, isConsumableItem, estimatedRetailPerPackage } from './supplyCatalog';

/** 攤上單列金額計價基準：批價（進貨）或零售參考。 */
export type StallLineUnitBasis = 'wholesale' | 'retail';

function unitPricePerPackage(item: SupplyItem, basis: StallLineUnitBasis): number {
  return basis === 'retail' ? estimatedRetailPerPackage(item) : pricePerPackage(item);
}

export function num(s: string | undefined) {
  const n = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * 實收欄位用於「帳面落差」顯示：空白或無效時回傳 null，避免輸入中途（如先打 89）算出誤導性大落差。
 */
export function parseMoneyInputForLedgerGap(raw: string | undefined): number | null {
  const t = String(raw ?? '').replace(/,/g, '').trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
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
  item: SupplyItem,
  opts?: { unitBasis?: StallLineUnitBasis }
): LineComputed {
  const basis = opts?.unitBasis ?? 'wholesale';
  const out = num(outS);
  const remainUnfilled = String(remainS ?? '').trim() === '';
  const remain = remainUnfilled ? 0 : num(remainS);
  const unit = unitPricePerPackage(item, basis);
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
  /**
   * 售出量 × 單價；單價依 {@link aggregateStallKpis} 的 unitBasis：
   * 預設為批價，攤上盤點頁改為零售參考時即為應有營業額（與實收對帳）。
   */
  shouldRevenue: number;
  /** 依本機零售參考 × 售出量；unitBasis 為 retail 時與 shouldRevenue 相同。 */
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
  getItem: (id: string) => SupplyItem | undefined,
  opts?: { unitBasis?: StallLineUnitBasis }
): StallKpiSplit {
  const basis = opts?.unitBasis ?? 'wholesale';
  const retail: DayKpis = { estTotal: 0, remGoodsValue: 0, shouldRevenue: 0, soldAtRetail: 0 };
  const cons = { estTotal: 0, remGoodsValue: 0, soldVolume: 0 };
  for (const id of itemIds) {
    const it = getItem(id);
    if (!it) continue;
    const { out, remain } = getOutRemain(id);
    const c = computeLine(out, remain, it, { unitBasis: basis });
    if (isConsumableItem(it)) {
      cons.estTotal += Math.round(c.estPrice);
      cons.remGoodsValue += c.remValue;
      cons.soldVolume += c.sold;
    } else {
      retail.estTotal += Math.round(c.estPrice);
      retail.remGoodsValue += c.remValue;
      retail.shouldRevenue += c.soldRevenue;
      if (basis === 'retail') {
        retail.soldAtRetail += c.soldRevenue;
      } else {
        retail.soldAtRetail += c.sold * estimatedRetailPerPackage(it);
      }
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

function formatEstimatedStallQty(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * 雨天／特殊狀況快速盤點：用實收營業額占「全部帶出可售金額」的比例，反推各品項售出量並回填剩餘。
 * 這只負責填表估算，不改變盤點完成、銷售紀錄、訂單押記的既有儲存流程。
 */
export function estimateStallRemainLinesFromRevenue(
  itemIds: string[],
  getOutRemain: (id: string) => { out: string; remain: string },
  getItem: (id: string) => SupplyItem | undefined,
  actualRevenue: number,
  opts?: { unitBasis?: StallLineUnitBasis }
): Record<string, string> {
  const basis = opts?.unitBasis ?? 'retail';
  const rows = itemIds
    .map((id) => {
      const item = getItem(id);
      if (!item) return null;
      const out = Math.max(0, num(getOutRemain(id).out));
      const unit = unitPricePerPackage(item, basis);
      return { id, out, possibleRevenue: out * unit };
    })
    .filter((row): row is { id: string; out: number; possibleRevenue: number } => row !== null);

  const totalPossibleRevenue = rows.reduce((sum, row) => sum + row.possibleRevenue, 0);
  if (totalPossibleRevenue <= 0) {
    return Object.fromEntries(rows.map((row) => [row.id, '0']));
  }

  const soldRatio = Math.max(0, Math.min(1, actualRevenue / totalPossibleRevenue));
  return Object.fromEntries(
    rows.map((row) => [row.id, formatEstimatedStallQty(row.out * (1 - soldRatio))])
  );
}

/** 叫貨（斤、份等）可輸入小數；與庫存扣減一併用三位小數內。 */
export const PROCUREMENT_QTY_MAX = 99_999;

export function roundProcurementQty(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(PROCUREMENT_QTY_MAX, Math.round(n * 1000) / 1000);
}
