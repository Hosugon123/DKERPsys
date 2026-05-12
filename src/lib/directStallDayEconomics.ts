import { stallCountAttributeYmd } from './financeLib';
import {
  computeRetailEconomicsFromMergedSnapshot,
  getStallDisplayActualRevenue,
  getStallDisplayRetailEstAndRemain,
  getStallDisplaySoldAtRetail,
} from './orderStallDisplayRevenue';
import {
  orderIsHeadquartersDirectScoped,
  resolveOrderDataScopeId,
  type OrderHistoryEntry,
} from './orderHistoryStorage';
import { getSalesRecord, listSalesRecordMeta } from './salesRecordStorage';
import { num } from './stallMath';
import type { SupplyRetailView } from './supplyCatalog';

export type DirectStallDayEconomics = {
  ymd: string;
  /** 預估金額：帶出貨量 × 零售單價加總 */
  estTotal: number;
  /** 剩餘貨品金額 */
  remainValue: number;
  /** 應有營業額（零售推算售出） */
  expectedRetail: number;
  /** 盤點後實收；無登錄時為 null */
  actual: number | null;
  /** 實收 − 應有；無實收時為 null */
  gap: number | null;
  /** 銷售紀錄落差備註 */
  note: string;
};

type AccBucket = {
  estTotal: number;
  remainValue: number;
  expectedRetail: number;
  actualSum: number;
  actualParts: number;
};

function gapNoteFromSalesRecord(ymd: string): string {
  const snap = getSalesRecord(ymd);
  if (!snap) return '';
  const bits: string[] = [];
  if (snap.revenueGapReason?.trim()) bits.push(snap.revenueGapReason.trim());
  if (snap.revenueGapAmount?.trim()) bits.push(`落差登錄 ${snap.revenueGapAmount.trim()}`);
  return bits.join(' · ');
}

function orderMatchesFranchiseeBusiness(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
  franchiseeUserId: string,
): boolean {
  const uid = franchiseeUserId.trim();
  if (!uid) return false;
  const scope = resolveOrderDataScopeId(row);
  if (scope === `scope:franchisee:${uid}`) return true;
  return row.actorRole === 'franchisee' && row.actorUserId === uid;
}

function finalizeEconomicsRow(ymd: string, b: AccBucket): DirectStallDayEconomics {
  const actual = b.actualParts > 0 ? b.actualSum : null;
  const gap = actual !== null ? actual - b.expectedRetail : null;
  return {
    ymd,
    estTotal: b.estTotal,
    remainValue: b.remainValue,
    expectedRetail: b.expectedRetail,
    actual,
    gap,
    note: gapNoteFromSalesRecord(ymd),
  };
}

/**
 * 依「總部直營」且已完成攤上盤點之訂單，加上孤立的銷售紀錄，建 `YYYY-MM-DD` → 經濟指標。
 */
export function buildDirectStallEconomicsByYmd(
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
): Map<string, DirectStallDayEconomics> {
  const acc = new Map<string, AccBucket>();

  for (const o of orders) {
    if (!orderIsHeadquartersDirectScoped(o) || !o.stallCountCompletedAt) continue;
    const ymd = stallCountAttributeYmd(o);
    if (!ymd) continue;
    const est = getStallDisplayRetailEstAndRemain(o, retailView);
    const exp = getStallDisplaySoldAtRetail(o, retailView);
    if (!est || exp === null) continue;
    const act = getStallDisplayActualRevenue(o);
    const prev =
      acc.get(ymd) ??
      ({
        estTotal: 0,
        remainValue: 0,
        expectedRetail: 0,
        actualSum: 0,
        actualParts: 0,
      } satisfies AccBucket);
    prev.estTotal += est.estTotal;
    prev.remainValue += est.remGoodsValue;
    prev.expectedRetail += exp;
    if (act !== null && Number.isFinite(act)) {
      prev.actualSum += act;
      prev.actualParts += 1;
    }
    acc.set(ymd, prev);
  }

  const map = new Map<string, DirectStallDayEconomics>();
  for (const [ymd, bucket] of acc) {
    map.set(ymd, finalizeEconomicsRow(ymd, bucket));
  }

  for (const { ymd } of listSalesRecordMeta()) {
    if (map.has(ymd)) continue;
    const snap = getSalesRecord(ymd);
    if (!snap) continue;
    const econ = computeRetailEconomicsFromMergedSnapshot(snap, retailView);
    if (!econ) continue;
    const rawActual = num(snap.actualRevenue);
    const hasActual = String(snap.actualRevenue ?? '').trim() !== '' && Number.isFinite(rawActual);
    map.set(
      ymd,
      finalizeEconomicsRow(ymd, {
        estTotal: econ.estTotal,
        remainValue: econ.remainValue,
        expectedRetail: econ.expectedRetail,
        actualSum: hasActual ? rawActual : 0,
        actualParts: hasActual ? 1 : 0,
      }),
    );
  }

  return map;
}

/**
 * 依「指定加盟主 scope」且已完成攤上盤點之訂單，加上孤立的銷售紀錄，建 `YYYY-MM-DD` → 經濟指標。
 * `retailView` 請傳 `'franchisee'` 以套用加盟零售單價。
 */
export function buildFranchiseStallEconomicsByYmd(
  orders: OrderHistoryEntry[],
  retailView: SupplyRetailView,
  franchiseeUserId: string,
): Map<string, DirectStallDayEconomics> {
  const acc = new Map<string, AccBucket>();

  for (const o of orders) {
    if (!orderMatchesFranchiseeBusiness(o, franchiseeUserId) || !o.stallCountCompletedAt) continue;
    const ymd = stallCountAttributeYmd(o);
    if (!ymd) continue;
    const est = getStallDisplayRetailEstAndRemain(o, retailView);
    const exp = getStallDisplaySoldAtRetail(o, retailView);
    if (!est || exp === null) continue;
    const act = getStallDisplayActualRevenue(o);
    const prev =
      acc.get(ymd) ??
      ({
        estTotal: 0,
        remainValue: 0,
        expectedRetail: 0,
        actualSum: 0,
        actualParts: 0,
      } satisfies AccBucket);
    prev.estTotal += est.estTotal;
    prev.remainValue += est.remGoodsValue;
    prev.expectedRetail += exp;
    if (act !== null && Number.isFinite(act)) {
      prev.actualSum += act;
      prev.actualParts += 1;
    }
    acc.set(ymd, prev);
  }

  const map = new Map<string, DirectStallDayEconomics>();
  for (const [ymd, bucket] of acc) {
    map.set(ymd, finalizeEconomicsRow(ymd, bucket));
  }

  for (const { ymd } of listSalesRecordMeta()) {
    if (map.has(ymd)) continue;
    const snap = getSalesRecord(ymd);
    if (!snap) continue;
    const econ = computeRetailEconomicsFromMergedSnapshot(snap, retailView);
    if (!econ) continue;
    const rawActual = num(snap.actualRevenue);
    const hasActual = String(snap.actualRevenue ?? '').trim() !== '' && Number.isFinite(rawActual);
    map.set(
      ymd,
      finalizeEconomicsRow(ymd, {
        estTotal: econ.estTotal,
        remainValue: econ.remainValue,
        expectedRetail: econ.expectedRetail,
        actualSum: hasActual ? rawActual : 0,
        actualParts: hasActual ? 1 : 0,
      }),
    );
  }

  return map;
}
