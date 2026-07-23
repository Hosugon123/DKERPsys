import { franchiseeOwnerUserIdFromScopeId, getDataScopeContext } from './dataScope';
import { addDaysYmd, parseYmd, ymd } from './stallInventoryStorage';
import { stallSalesBoardRowYmd } from './financeLib';
import { orderCountsTowardStallEconomics, orderMatchesProcurementSoldReferenceScope, resolveOrderDataScopeId, type OrderHistoryEntry } from './orderHistoryStorage';
import {
  getSalesRecord,
  listSalesRecordMeta,
  mergeSalesRecordWithCatalog,
  type SalesRecordDaySnapshot,
} from './salesRecordStorage';
import { getAllSupplyItems, isConsumableItem, type SupplyRetailView } from './supplyCatalog';
import { computeLine } from './stallMath';

function resolveStallSnapshotFromOrder(o: OrderHistoryEntry): SalesRecordDaySnapshot | null {
  if (o.stallCountSnapshot) return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  const basis = o.stallCountBasisYmd?.trim();
  if (!basis) return null;
  const day = getSalesRecord(basis, resolveOrderDataScopeId(o));
  return day ? mergeSalesRecordWithCatalog(day) : null;
}

function franchiseeOwnerForRetail(): string | undefined {
  return franchiseeOwnerUserIdFromScopeId(getDataScopeContext().scopeId) ?? undefined;
}

function accumulateSoldQtyByProductFromSnapshot(
  soldMap: Map<string, number>,
  outMap: Map<string, number>,
  snap: SalesRecordDaySnapshot,
  retailView: SupplyRetailView,
) {
  const ownerId = franchiseeOwnerForRetail();
  const merged = mergeSalesRecordWithCatalog(snap);
  for (const it of getAllSupplyItems(retailView, ownerId)) {
    if (isConsumableItem(it)) continue;
    const line = merged.lines[it.id] ?? { out: '', remain: '' };
    const c = computeLine(line.out, line.remain, it, { unitBasis: 'retail' });
    if (c.out > 0) outMap.set(it.id, c.out);
    if (c.remainUnfilled || c.sold <= 0) continue;
    soldMap.set(it.id, c.sold);
  }
}

function parseActualRevenue(raw: string | undefined): number | null {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function estimateRetailRevenueFromSnapshot(
  snap: SalesRecordDaySnapshot,
  retailView: SupplyRetailView,
): number {
  const ownerId = franchiseeOwnerForRetail();
  const merged = mergeSalesRecordWithCatalog(snap);
  let total = 0;
  for (const it of getAllSupplyItems(retailView, ownerId)) {
    if (isConsumableItem(it)) continue;
    const line = merged.lines[it.id] ?? { out: '', remain: '' };
    const c = computeLine(line.out, line.remain, it, { unitBasis: 'retail' });
    if (c.remainUnfilled) continue;
    total += c.soldRevenue;
  }
  return Math.round(total * 100) / 100;
}

function revenueForSnapshot(
  snap: SalesRecordDaySnapshot,
  retailView: SupplyRetailView,
): number {
  return parseActualRevenue(snap.actualRevenue) ?? estimateRetailRevenueFromSnapshot(snap, retailView);
}

function pickLatestStallOrderForYmd(
  ymdDash: string,
  orders: OrderHistoryEntry[],
  scopeId: string,
): OrderHistoryEntry | null {
  let best: OrderHistoryEntry | null = null;
  for (const o of orders) {
    if (!orderCountsTowardStallEconomics(o)) continue;
    if (stallSalesBoardRowYmd(o) !== ymdDash) continue;
    if (resolveOrderDataScopeId(o) !== scopeId) continue;
    const snap = resolveStallSnapshotFromOrder(o);
    if (!snap) continue;
    if (
      !best ||
      String(o.stallCountCompletedAt ?? '').localeCompare(String(best.stallCountCompletedAt ?? '')) > 0
    ) {
      best = o;
    }
  }
  return best;
}

export type ProcurementLastWeekSameDayRef = {
  /** 訂單歸屬日 − 7 天（或統計參考日） */
  referenceYmd: string;
  soldByProductId: ReadonlyMap<string, number>;
  outByProductId: ReadonlyMap<string, number>;
  /** 該日是否有已完成盤點訂單或銷售紀錄 */
  hasCompletedStallDay: boolean;
};

export type ProcurementReferenceMode = 'max' | 'avg' | 'lastWeek' | 'min';

export const PROCUREMENT_REFERENCE_MODE_OPTIONS: ReadonlyArray<{
  value: ProcurementReferenceMode;
  label: string;
}> = [
  { value: 'max', label: '最高' },
  { value: 'avg', label: '平均' },
  { value: 'lastWeek', label: '上週' },
  { value: 'min', label: '最低' },
];

export type ProcurementWeekdaySoldRef = ProcurementLastWeekSameDayRef & {
  mode: ProcurementReferenceMode;
  /** 納入統計之曆日數（上週模式為 0 或 1） */
  sampleDayCount: number;
};

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

/** 批貨底部「參考」列是否顯示資料曆日；最高／最低／平均是跨日品項統計，不對應單一天 */
export function shouldShowProcurementReferenceDate(mode: ProcurementReferenceMode): boolean {
  return mode === 'lastWeek';
}

export function procurementReferenceSoldRowLabel(
  mode: ProcurementReferenceMode,
  weekdayIdx: number,
): string {
  const wd = PROCUREMENT_WEEKDAY_LABELS[weekdayIdx]?.slice(1) ?? '';
  if (mode === 'lastWeek') return `上周${wd}`;
  const modeLabel = PROCUREMENT_REFERENCE_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? '';
  return `${wd}${modeLabel}`;
}

function ordersForProcurementSoldReference(orders: OrderHistoryEntry[]): OrderHistoryEntry[] {
  return orders.filter((o) => orderMatchesProcurementSoldReferenceScope(o));
}

function soldMapForYmd(
  ymdDash: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
): { soldMap: Map<string, number>; outMap: Map<string, number>; hasData: boolean; revenue: number } {
  const scopeId = getDataScopeContext().scopeId;
  const soldByProductId = new Map<string, number>();
  const outByProductId = new Map<string, number>();

  const salesRaw = getSalesRecord(ymdDash, scopeId);
  if (salesRaw) {
    accumulateSoldQtyByProductFromSnapshot(
      soldByProductId,
      outByProductId,
      salesRaw,
      retailView,
    );
    return { soldMap: soldByProductId, outMap: outByProductId, hasData: true, revenue: revenueForSnapshot(salesRaw, retailView) };
  }

  const matched = pickLatestStallOrderForYmd(ymdDash, orders, scopeId);
  if (matched) {
    const snap = resolveStallSnapshotFromOrder(matched);
    if (snap) {
      accumulateSoldQtyByProductFromSnapshot(soldByProductId, outByProductId, snap, retailView);
      return { soldMap: soldByProductId, outMap: outByProductId, hasData: true, revenue: revenueForSnapshot(snap, retailView) };
    }
  }

  return { soldMap: soldByProductId, outMap: outByProductId, hasData: false, revenue: 0 };
}

function listSameWeekdayYmdsBefore(
  orderDateYmd: string,
  orders: OrderHistoryEntry[],
  targetWd: number,
): string[] {
  const ymdSet = new Set<string>();

  for (const o of orders) {
    if (!orderCountsTowardStallEconomics(o)) continue;
    const rowYmd = stallSalesBoardRowYmd(o);
    if (!rowYmd || rowYmd >= orderDateYmd) continue;
    if (weekdayIdxMon0FromYmd(rowYmd) !== targetWd) continue;
    ymdSet.add(rowYmd);
  }

  for (const { ymd: recordYmd } of listSalesRecordMeta(getDataScopeContext().scopeId)) {
    if (recordYmd >= orderDateYmd) continue;
    if (weekdayIdxMon0FromYmd(recordYmd) !== targetWd) continue;
    ymdSet.add(recordYmd);
  }

  return Array.from(ymdSet).sort();
}

/** 依訂單歸屬日固定取上週同日（−7 天）各品項售出量，與儀表板銷售數據歸屬日一致。 */
export function computeProcurementLastWeekSameDaySold(
  orderDateYmd: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
): ProcurementLastWeekSameDayRef {
  const scopedOrders = ordersForProcurementSoldReference(orders);
  const referenceYmd = addDaysYmd(orderDateYmd, -7);
  const { soldMap, outMap, hasData } = soldMapForYmd(referenceYmd, scopedOrders, retailView);
  return { referenceYmd, soldByProductId: soldMap, outByProductId: outMap, hasCompletedStallDay: hasData };
}

/**
 * 依對照星期與參考模式（最高／平均／上週／最低）計算各品項售出參考量。
 * 僅納入目前登入店別（orders 應已經 orderMatchesProcurementSoldReferenceScope 篩過）。
 * 最高／最低：先選出同星期幾中營業額最高／最低的那一天，再取該日各品項售出量。
 * 平均：同星期幾歷史資料逐品項平均。
 * 上週：訂單歸屬日 −7 天。
 */
export function computeProcurementWeekdaySoldReference(
  orderDateYmd: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
  mode: ProcurementReferenceMode = 'lastWeek',
  targetWeekdayIdx?: number,
): ProcurementWeekdaySoldRef {
  const scopedOrders = ordersForProcurementSoldReference(orders);
  const targetWd = targetWeekdayIdx ?? weekdayIdxMon0FromYmd(orderDateYmd);
  if (mode === 'lastWeek') {
    const base = computeProcurementLastWeekSameDaySold(orderDateYmd, scopedOrders, retailView);
    return {
      ...base,
      mode,
      sampleDayCount: base.hasCompletedStallDay ? 1 : 0,
    };
  }

  const qualifyingYmds = listSameWeekdayYmdsBefore(orderDateYmd, scopedOrders, targetWd);
  const soldPerDay = new Map<string, Map<string, number>>();
  const outPerDay = new Map<string, Map<string, number>>();
  const revenueByYmd = new Map<string, number>();
  const activeYmds: string[] = [];

  for (const ymdDash of qualifyingYmds) {
    const { soldMap, outMap, hasData, revenue } = soldMapForYmd(ymdDash, scopedOrders, retailView);
    if (!hasData) continue;
    soldPerDay.set(ymdDash, soldMap);
    outPerDay.set(ymdDash, outMap);
    revenueByYmd.set(ymdDash, revenue);
    activeYmds.push(ymdDash);
  }

  const fallbackYmd = activeYmds[activeYmds.length - 1] ?? addDaysYmd(orderDateYmd, -7);

  if (mode === 'max' || mode === 'min') {
    const pickedYmd = activeYmds.reduce<string | null>((best, ymdDash) => {
      if (!best) return ymdDash;
      const current = revenueByYmd.get(ymdDash) ?? 0;
      const previous = revenueByYmd.get(best) ?? 0;
      if (mode === 'max') return current > previous ? ymdDash : best;
      return current < previous ? ymdDash : best;
    }, null);
    return {
      referenceYmd: pickedYmd ?? fallbackYmd,
      soldByProductId: new Map(soldPerDay.get(pickedYmd ?? '') ?? []),
      outByProductId: new Map(outPerDay.get(pickedYmd ?? '') ?? []),
      hasCompletedStallDay: activeYmds.length > 0,
      mode,
      sampleDayCount: activeYmds.length,
    };
  }

  const allIds = new Set<string>();
  for (const dayMap of soldPerDay.values()) {
    for (const id of dayMap.keys()) allIds.add(id);
  }
  for (const dayMap of outPerDay.values()) {
    for (const id of dayMap.keys()) allIds.add(id);
  }

  const soldByProductId = new Map<string, number>();
  const outByProductId = new Map<string, number>();
  for (const id of allIds) {
    const soldSeries = activeYmds.map((ymdDash) => soldPerDay.get(ymdDash)?.get(id) ?? 0);
    const outSeries = activeYmds.map((ymdDash) => outPerDay.get(ymdDash)?.get(id) ?? 0);
    if (soldSeries.some((v) => v > 0)) {
      const value = soldSeries.reduce((s, v) => s + v, 0) / soldSeries.length;
      soldByProductId.set(id, Math.round(value * 1000) / 1000);
    }
    if (outSeries.some((v) => v > 0)) {
      const value = outSeries.reduce((s, v) => s + v, 0) / outSeries.length;
      outByProductId.set(id, Math.round(value * 1000) / 1000);
    }
  }

  return {
    referenceYmd: fallbackYmd,
    soldByProductId,
    outByProductId,
    hasCompletedStallDay: activeYmds.length > 0,
    mode,
    sampleDayCount: activeYmds.length,
  };
}

export function referenceWeekdayShortLabel(ymdDash: string): string {
  return parseYmd(ymdDash).toLocaleDateString('zh-TW', { weekday: 'short' });
}

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
