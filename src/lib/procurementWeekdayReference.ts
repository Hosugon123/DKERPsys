import { addDaysYmd, parseYmd, ymd } from './stallInventoryStorage';
import { stallSalesBoardRowYmd } from './financeLib';
import type { OrderHistoryEntry } from './orderHistoryStorage';
import {
  getSalesRecord,
  mergeSalesRecordWithCatalog,
  type SalesRecordDaySnapshot,
} from './salesRecordStorage';
import { getSupplyItem, isConsumableItem, type SupplyRetailView } from './supplyCatalog';
import { computeLine } from './stallMath';

function resolveStallSnapshotFromOrder(o: OrderHistoryEntry): SalesRecordDaySnapshot | null {
  if (o.stallCountSnapshot) return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  const basis = o.stallCountBasisYmd?.trim();
  if (!basis) return null;
  const day = getSalesRecord(basis);
  return day ? mergeSalesRecordWithCatalog(day) : null;
}

function accumulateSoldQtyByProductFromSnapshot(
  dayMap: Map<string, number>,
  snap: SalesRecordDaySnapshot,
  retailView: SupplyRetailView,
) {
  for (const id of Object.keys(snap.lines)) {
    const item = getSupplyItem(id, retailView);
    if (!item || isConsumableItem(item)) continue;
    const line = snap.lines[id] ?? { out: '', remain: '' };
    const c = computeLine(line.out, line.remain, item, { unitBasis: 'retail' });
    if (c.remainUnfilled) continue;
    dayMap.set(id, (dayMap.get(id) ?? 0) + c.sold);
  }
}

export type ProcurementLastWeekSameDayRef = {
  /** 訂單歸屬日 − 7 天 */
  referenceYmd: string;
  soldByProductId: ReadonlyMap<string, number>;
  /** 該日是否有已完成盤點訂單或銷售紀錄 */
  hasCompletedStallDay: boolean;
};

/** 依訂單歸屬日固定取上週同日（−7 天）各品項售出量，與儀表板銷售數據歸屬日一致。 */
export function computeProcurementLastWeekSameDaySold(
  orderDateYmd: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
): ProcurementLastWeekSameDayRef {
  const referenceYmd = addDaysYmd(orderDateYmd, -7);
  const soldByProductId = new Map<string, number>();
  let fromOrders = false;

  for (const o of orders) {
    if (!o.stallCountCompletedAt) continue;
    const rowYmd = stallSalesBoardRowYmd(o);
    if (rowYmd !== referenceYmd) continue;
    const snap = resolveStallSnapshotFromOrder(o);
    if (!snap) continue;
    fromOrders = true;
    accumulateSoldQtyByProductFromSnapshot(soldByProductId, snap, retailView);
  }

  if (!fromOrders) {
    const raw = getSalesRecord(referenceYmd);
    if (raw) {
      accumulateSoldQtyByProductFromSnapshot(
        soldByProductId,
        mergeSalesRecordWithCatalog(raw),
        retailView,
      );
    }
  }

  const hasCompletedStallDay = fromOrders || getSalesRecord(referenceYmd) !== null;

  return { referenceYmd, soldByProductId, hasCompletedStallDay };
}

export function referenceWeekdayShortLabel(ymdDash: string): string {
  return parseYmd(ymdDash).toLocaleDateString('zh-TW', { weekday: 'short' });
}

/** 週一＝0 … 週日＝6（與儀表板同名星期對照一致） */
export const PROCUREMENT_WEEKDAY_LABELS = [
  '週一',
  '週二',
  '週三',
  '週四',
  '週五',
  '週六',
  '週日',
] as const;

export function weekdayIdxMon0FromYmd(ymdDash: string): number {
  return (parseYmd(ymdDash).getDay() + 6) % 7;
}

/** 自 base 日（含）起，第一個落在該星期的日期（用於預計叫貨歸屬日） */
export function ymdOnOrAfterWeekday(baseYmd: string, weekdayIdx: number): string {
  const baseIdx = weekdayIdxMon0FromYmd(baseYmd);
  const delta = (weekdayIdx - baseIdx + 7) % 7;
  return addDaysYmd(baseYmd, delta);
}

/** 預設：明天是星期幾，就選星期幾（常見「今天叫明天貨」） */
export function defaultProcurementReferenceWeekdayIdx(): number {
  return weekdayIdxMon0FromYmd(addDaysYmd(ymd(new Date()), 1));
}

export function defaultProcurementOrderDateYmd(): string {
  return addDaysYmd(ymd(new Date()), 1);
}
