import { addDaysYmd, parseYmd, ymd } from './stallInventoryStorage';
import { stallSalesBoardRowYmd } from './financeLib';
import type { OrderHistoryEntry } from './orderHistoryStorage';
import {
  getSalesRecord,
  listSalesRecordMeta,
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
  /** 訂單歸屬日 − 7 天（或統計參考日） */
  referenceYmd: string;
  soldByProductId: ReadonlyMap<string, number>;
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

/** 批貨底部「參考」列是否顯示資料曆日：上週／最高／最低顯示；平均不顯示 */
export function shouldShowProcurementReferenceDate(mode: ProcurementReferenceMode): boolean {
  return mode === 'lastWeek' || mode === 'max' || mode === 'min';
}

function totalSoldQtyOnDay(dayMap: Map<string, number>): number {
  let n = 0;
  for (const v of dayMap.values()) n += v;
  return n;
}

function pickReferenceYmdByDayTotalSold(
  activeYmds: string[],
  perDay: Map<string, Map<string, number>>,
  pick: 'max' | 'min',
): string | undefined {
  if (activeYmds.length === 0) return undefined;
  return activeYmds.reduce((best, ymd) => {
    const cur = totalSoldQtyOnDay(perDay.get(ymd) ?? new Map());
    const prev = totalSoldQtyOnDay(perDay.get(best) ?? new Map());
    return pick === 'max' ? (cur > prev ? ymd : best) : cur < prev ? ymd : best;
  });
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

function soldMapForYmd(
  ymdDash: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
): { map: Map<string, number>; hasData: boolean } {
  const soldByProductId = new Map<string, number>();
  let fromOrders = false;

  for (const o of orders) {
    if (!o.stallCountCompletedAt) continue;
    const rowYmd = stallSalesBoardRowYmd(o);
    if (rowYmd !== ymdDash) continue;
    const snap = resolveStallSnapshotFromOrder(o);
    if (!snap) continue;
    fromOrders = true;
    accumulateSoldQtyByProductFromSnapshot(soldByProductId, snap, retailView);
  }

  if (!fromOrders) {
    const raw = getSalesRecord(ymdDash);
    if (raw) {
      accumulateSoldQtyByProductFromSnapshot(
        soldByProductId,
        mergeSalesRecordWithCatalog(raw),
        retailView,
      );
    }
  }

  const hasData = fromOrders || getSalesRecord(ymdDash) !== null;
  return { map: soldByProductId, hasData };
}

function listSameWeekdayYmdsBefore(orderDateYmd: string, orders: OrderHistoryEntry[]): string[] {
  const targetWd = weekdayIdxMon0FromYmd(orderDateYmd);
  const ymdSet = new Set<string>();

  for (const o of orders) {
    if (!o.stallCountCompletedAt) continue;
    const rowYmd = stallSalesBoardRowYmd(o);
    if (!rowYmd || rowYmd >= orderDateYmd) continue;
    if (weekdayIdxMon0FromYmd(rowYmd) !== targetWd) continue;
    ymdSet.add(rowYmd);
  }

  for (const { ymd: recordYmd } of listSalesRecordMeta()) {
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
  const referenceYmd = addDaysYmd(orderDateYmd, -7);
  const { map, hasData } = soldMapForYmd(referenceYmd, orders, retailView);
  return { referenceYmd, soldByProductId: map, hasCompletedStallDay: hasData };
}

/**
 * 依對照星期與參考模式（最高／平均／上週／最低）計算各品項售出參考量。
 * 最高／平均／最低：與儀表板「同名星期」相同，取訂單歸屬日以前、同星期幾之歷史盤點日。
 */
export function computeProcurementWeekdaySoldReference(
  orderDateYmd: string,
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
  mode: ProcurementReferenceMode = 'lastWeek',
): ProcurementWeekdaySoldRef {
  if (mode === 'lastWeek') {
    const base = computeProcurementLastWeekSameDaySold(orderDateYmd, orders, retailView);
    return {
      ...base,
      mode,
      sampleDayCount: base.hasCompletedStallDay ? 1 : 0,
    };
  }

  const qualifyingYmds = listSameWeekdayYmdsBefore(orderDateYmd, orders);
  const perDay = new Map<string, Map<string, number>>();
  const activeYmds: string[] = [];

  for (const ymdDash of qualifyingYmds) {
    const { map, hasData } = soldMapForYmd(ymdDash, orders, retailView);
    if (!hasData) continue;
    perDay.set(ymdDash, map);
    activeYmds.push(ymdDash);
  }

  const allIds = new Set<string>();
  for (const dayMap of perDay.values()) {
    for (const id of dayMap.keys()) allIds.add(id);
  }

  const soldByProductId = new Map<string, number>();
  for (const id of allIds) {
    const series = activeYmds.map((ymdDash) => perDay.get(ymdDash)?.get(id) ?? 0);
    if (series.every((v) => v === 0)) continue;
    let value: number;
    if (mode === 'avg') {
      value = series.reduce((s, v) => s + v, 0) / series.length;
    } else if (mode === 'max') {
      value = Math.max(...series);
    } else {
      value = Math.min(...series);
    }
    soldByProductId.set(id, Math.round(value * 1000) / 1000);
  }

  const fallbackYmd = activeYmds[activeYmds.length - 1] ?? addDaysYmd(orderDateYmd, -7);
  const referenceYmd =
    mode === 'max'
      ? pickReferenceYmdByDayTotalSold(activeYmds, perDay, 'max') ?? fallbackYmd
      : mode === 'min'
        ? pickReferenceYmdByDayTotalSold(activeYmds, perDay, 'min') ?? fallbackYmd
        : fallbackYmd;

  return {
    referenceYmd,
    soldByProductId,
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
