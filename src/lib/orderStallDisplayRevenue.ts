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

function stallSnapshotKpis(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
) {
  const snap = resolveStallSnapshotForOrder(o);
  if (!snap) return null;
  const itemIds = getAllSupplyItems(retailView)
    .filter((i) => !isConsumableItem(i))
    .map((i) => i.id);
  const getLine = (id: string) => snap.lines[id] ?? { out: '', remain: '' };
  const getItem = (id: string) => getSupplyItem(id, retailView) ?? undefined;
  const wholesale = aggregateStallKpis(itemIds, getLine, getItem, { unitBasis: 'wholesale' }).retail;
  const retailK = aggregateStallKpis(itemIds, getLine, getItem, { unitBasis: 'retail' }).retail;
  return { wholesaleShouldRevenue: wholesale.shouldRevenue, retailSoldRevenue: retailK.soldAtRetail };
}

/**
 * 已盤點且可讀到快照時：批价 × 售出量（帳上成本參考）。否則 null。
 */
export function getStallDisplayShouldRevenue(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
): number | null {
  const k = stallSnapshotKpis(o, retailView);
  return k != null ? k.wholesaleShouldRevenue : null;
}

/**
 * 已盤點且可讀到快照時：零售參考 × 售出量（盤點金額）。否則 null。
 */
export function getStallDisplaySoldAtRetail(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
): number | null {
  const k = stallSnapshotKpis(o, retailView);
  return k != null ? k.retailSoldRevenue : null;
}
