import type { FranchiseManagementOrder, OrderHistoryEntry } from './orderHistoryStorage';
import { getAllSupplyItems, getSupplyItem, isConsumableItem, type SupplyRetailView } from './supplyCatalog';
import { aggregateStallKpis } from './stallMath';
import { getSalesRecord, mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from './salesRecordStorage';

type StallFields = Pick<
  FranchiseManagementOrder,
  'stallCountSnapshot' | 'stallCountBasisYmd' | 'stallCountCompletedAt'
>;

function resolveStallSnapshotForOrder(o: StallFields): SalesRecordDaySnapshot | null {
  if (!o.stallCountCompletedAt) return null;
  if (o.stallCountSnapshot) {
    return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  }
  if (o.stallCountBasisYmd) {
    const day = getSalesRecord(o.stallCountBasisYmd);
    return day ? mergeSalesRecordWithCatalog(day) : null;
  }
  return null;
}

function kpiFromOrderSnapshot(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView
) {
  const snap = resolveStallSnapshotForOrder(o);
  if (!snap) return null;
  const itemIds = getAllSupplyItems(retailView)
    .filter((i) => !isConsumableItem(i))
    .map((i) => i.id);
  return aggregateStallKpis(
    itemIds,
    (id) => snap.lines[id] ?? { out: '', remain: '' },
    (id) => getSupplyItem(id, retailView) ?? undefined
  ).retail;
}

/**
 * 已盤點且可讀到快照時：批价 × 售出量（帳上成本參考）。否則 null。
 */
export function getStallDisplayShouldRevenue(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView
): number | null {
  const k = kpiFromOrderSnapshot(o, retailView);
  return k != null ? k.shouldRevenue : null;
}

/**
 * 已盤點且可讀到快照時：零售參考 × 售出量（盤點金額）。否則 null。
 */
export function getStallDisplaySoldAtRetail(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView
): number | null {
  const k = kpiFromOrderSnapshot(o, retailView);
  return k != null ? k.soldAtRetail : null;
}
