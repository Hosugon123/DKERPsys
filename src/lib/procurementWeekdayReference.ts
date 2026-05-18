import { addDaysYmd, parseYmd } from './stallInventoryStorage';
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
