import type { FranchiseManagementOrder, OrderHistoryEntry } from './orderHistoryStorage';
import { getAllSupplyItems, getSupplyItem, isConsumableItem, type SupplyRetailView } from './supplyCatalog';
import { aggregateStallKpis, num } from './stallMath';
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

type StallFrozenFinancials = {
  retailEstTotal: number;
  retailRemainValue: number;
  retailSoldRevenue: number;
  wholesaleSoldCost: number;
};

function frozenFinancialsFromSnapshot(snap: SalesRecordDaySnapshot): StallFrozenFinancials | null {
  const retailMap = snap.frozenRetailUnitPriceByItem;
  const wholesaleMap = snap.frozenWholesaleUnitPriceByItem;
  if (!retailMap || !wholesaleMap) return null;

  let retailEstTotal = 0;
  let retailRemainValue = 0;
  let retailSoldRevenue = 0;
  let wholesaleSoldCost = 0;

  for (const [id, line] of Object.entries(snap.lines)) {
    const rUnit = Number(retailMap[id]);
    const wUnit = Number(wholesaleMap[id]);
    if (!Number.isFinite(rUnit) || !Number.isFinite(wUnit)) continue;

    const out = num(line.out);
    const remain = num(line.remain);
    const sold = Math.max(0, out - remain);
    /** 與畫面明細一致：各列先四捨五入到整數再加總（避免彙總與手加明細不符） */
    retailEstTotal += Math.round(out * rUnit);
    retailRemainValue += remain * rUnit;
    retailSoldRevenue += sold * rUnit;
    wholesaleSoldCost += sold * wUnit;
  }

  return { retailEstTotal, retailRemainValue, retailSoldRevenue, wholesaleSoldCost };
}

/**
 * 僅依銷售紀錄／盤點快照推算：預估帶出金額（各列金額先四捨五入至整數再加總）、餘貨金額、應有營業額（零售×售出量）。
 * 供無對應訂單但仍存有銷售紀錄之日補齊 Dashboard。
 */
export function computeRetailEconomicsFromMergedSnapshot(
  snap: SalesRecordDaySnapshot,
  retailView: SupplyRetailView,
): { estTotal: number; remainValue: number; expectedRetail: number } | null {
  const merged = mergeSalesRecordWithCatalog(snap);
  const frozen = frozenFinancialsFromSnapshot(merged);
  if (frozen) {
    return {
      estTotal: frozen.retailEstTotal,
      remainValue: frozen.retailRemainValue,
      expectedRetail: frozen.retailSoldRevenue,
    };
  }
  const itemIds = getAllSupplyItems(retailView)
    .filter((i) => !isConsumableItem(i))
    .map((i) => i.id);
  const getLine = (id: string) => merged.lines[id] ?? { out: '', remain: '' };
  const getItem = (id: string) => getSupplyItem(id, retailView) ?? undefined;
  const retailK = aggregateStallKpis(itemIds, getLine, getItem, { unitBasis: 'retail' }).retail;
  return {
    estTotal: retailK.estTotal,
    remainValue: retailK.remGoodsValue,
    expectedRetail: retailK.soldAtRetail,
  };
}

function stallSnapshotKpis(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
) {
  const snap = resolveStallSnapshotForOrder(o);
  if (!snap) return null;
  const frozen = frozenFinancialsFromSnapshot(snap);
  if (frozen) return frozen;
  const itemIds = getAllSupplyItems(retailView)
    .filter((i) => !isConsumableItem(i))
    .map((i) => i.id);
  const getLine = (id: string) => snap.lines[id] ?? { out: '', remain: '' };
  const getItem = (id: string) => getSupplyItem(id, retailView) ?? undefined;
  const wholesale = aggregateStallKpis(itemIds, getLine, getItem, { unitBasis: 'wholesale' }).retail;
  const retailK = aggregateStallKpis(itemIds, getLine, getItem, { unitBasis: 'retail' }).retail;
  return {
    wholesaleSoldCost: wholesale.shouldRevenue,
    retailSoldRevenue: retailK.soldAtRetail,
    retailEstTotal: retailK.estTotal,
    retailRemainValue: retailK.remGoodsValue,
  };
}

/**
 * 已盤點且可讀到快照時：批价 × 售出量（帳上成本參考）。否則 null。
 */
export function getStallDisplayShouldRevenue(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
): number | null {
  const k = stallSnapshotKpis(o, retailView);
  return k != null ? k.wholesaleSoldCost : null;
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

export function getStallDisplayRetailEstAndRemain(
  o: FranchiseManagementOrder | OrderHistoryEntry,
  retailView: SupplyRetailView,
): { estTotal: number; remGoodsValue: number } | null {
  const k = stallSnapshotKpis(o, retailView);
  if (!k) return null;
  return { estTotal: k.retailEstTotal, remGoodsValue: k.retailRemainValue };
}

/**
 * 已盤點且可讀到快照時：盤點頁填寫的「實際收入金額」。否則 null。
 */
export function getStallDisplayActualRevenue(
  o: FranchiseManagementOrder | OrderHistoryEntry,
): number | null {
  const snap = resolveStallSnapshotForOrder(o);
  if (!snap) return null;
  return num(snap.actualRevenue);
}
