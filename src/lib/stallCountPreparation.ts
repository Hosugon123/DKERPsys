import type { DaySnapshot } from './stallInventoryStorage';
import type { SupplyItem } from './supplyCatalog';
import { estimateStallRemainLinesFromRevenue, parseMoneyInputForLedgerGap } from './stallMath';
import { normalizeStallLineAliases } from './stallLineAliases';

export function clearEstimatedStallRemains(snapshot: DaySnapshot): DaySnapshot {
  return {
    ...snapshot,
    lines: Object.fromEntries(Object.entries(snapshot.lines).map(([id, line]) => [
      id, line.remainSource === 'estimated' ? { ...line, remain: '', remainSource: undefined } : line,
    ])),
  };
}

export function prepareStallCountSnapshot(
  snapshot: DaySnapshot,
  itemIds: string[],
  getItem: (id: string) => SupplyItem | undefined,
  allowRevenueEstimation: boolean,
): { ok: true; snapshot: DaySnapshot } | { ok: false; error: string } {
  snapshot = { ...snapshot, lines: normalizeStallLineAliases(snapshot.lines,
    itemIds.map(id => getItem(id)).filter((item): item is SupplyItem => Boolean(item))) };
  if (!allowRevenueEstimation) {
    if (itemIds.some(id => snapshot.lines[id]?.remainSource === 'estimated')) {
      return { ok: false, error: '含有先前估算的剩餘量。請重新填寫實盤數量，或勾選「以實收估算未盤點品項」。' };
    }
    return { ok: true, snapshot };
  }
  const revenue = parseMoneyInputForLedgerGap(snapshot.actualRevenue);
  if (revenue === null || revenue < 0) {
    return { ok: false, error: '估算模式須先填寫有效的實收金額。' };
  }
  const estimates = estimateStallRemainLinesFromRevenue(
    itemIds, id => snapshot.lines[id] ?? { out: '', remain: '' }, getItem, revenue,
    { unitBasis: 'retail' },
  );
  const lines = { ...snapshot.lines };
  for (const [id, remain] of Object.entries(estimates)) {
    lines[id] = { ...lines[id], out: lines[id]?.out ?? '', remain, remainSource: 'estimated' };
  }
  return { ok: true, snapshot: { ...snapshot, lines } };
}
