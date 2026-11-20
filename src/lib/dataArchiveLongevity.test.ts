import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveCutoffThreeMonthsAgo, archiveDataOlderThan, listDataArchives, restoreDataArchive } from './dataArchiveStorage';

const ordersKey = 'dongshan_order_history_v1';
const salesKey = 'dongshan_sales_records_v1';
const stallKey = 'dongshan_stall_inventory_v1';
const scope = 'scope:franchisee:longevity';
function counted(id: string, date = '2026-01-10') {
  return {
    id, orderDateYmd: date, createdAt: `${date}T08:00:00Z`, updatedAt: `${date}T20:00:00Z`,
    scopeId: scope, actorRole: 'franchisee', status: '已完成',
    stallCountCompletedAt: `${date}T20:00:00Z`, stallCountBasisYmd: date, lines: [],
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('long-lived archive safety', () => {
  it.each([
    [2026, 4, 31, '2026-02-28'], [2028, 4, 31, '2028-02-29'],
    [2026, 0, 31, '2025-10-31'], [2026, 10, 20, '2026-08-20'],
  ])('clamps a three-month cutoff to a real date at %i/%i/%i', (year, month, day, expected) => {
    expect(archiveCutoffThreeMonthsAgo(new Date(year, month, day))).toBe(expected);
  });

  it('keeps old open orders and all reference chains and their scoped inventory days active', () => {
    const basis = counted('basis');
    const middle = { ...counted('middle', '2026-02-10'), procurementDeductionBasisOrderIds: ['basis'] };
    const recent = { ...counted('recent', '2026-11-20'), procurementDeductionBasisOrderId: 'middle' };
    const unshipped = { ...counted('open', '2026-01-11'), status: '待出貨', stallCountCompletedAt: '' };
    const uncounted = { ...counted('shipped', '2026-01-12'), stallCountCompletedAt: '' };
    localStorage.setItem(ordersKey, JSON.stringify([basis, middle, recent, unshipped, uncounted, counted('closed')]));
    for (const key of [salesKey, stallKey]) {
      localStorage.setItem(key, JSON.stringify({ version: 1, byDate: {
        [`${scope}|2026-01-10`]: { snapshot: { lines: {} } },
        [`${scope}|2026-02-10`]: { snapshot: { lines: {} } },
        ['scope:hq|2026-01-10']: { snapshot: { lines: {} } },
      } }));
    }
    expect(archiveDataOlderThan('2026-08-20').ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(ordersKey)!).map((row: { id: string }) => row.id))
      .toEqual(['basis', 'middle', 'recent', 'open', 'shipped']);
    for (const key of [salesKey, stallKey]) {
      expect(Object.keys(JSON.parse(localStorage.getItem(key)!).byDate)).toEqual([
        `${scope}|2026-01-10`, `${scope}|2026-02-10`,
      ]);
    }
  });

  it('does not reuse an archive ID for two runs in the same second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));
    localStorage.setItem(ordersKey, JSON.stringify([counted('first')]));
    expect(archiveDataOlderThan('2026-08-20').ok).toBe(true);
    localStorage.setItem(ordersKey, JSON.stringify([counted('second')]));
    expect(archiveDataOlderThan('2026-08-20').ok).toBe(true);
    const archives = listDataArchives();
    expect(new Set(archives.map(a => a.id)).size).toBe(2);
  });

  it('rejects impossible calendar dates before changing any data', () => {
    localStorage.setItem(ordersKey, JSON.stringify([counted('old')]));
    expect(archiveDataOlderThan('2026-02-31')).toEqual({ ok: false, reason: 'invalid_cutoff' });
    expect(listDataArchives()).toHaveLength(0);
  });

  it('preserves all records and frozen counted quantities through a 1200-order archive/restore', () => {
    const orders = Array.from({ length: 1200 }, (_, i) => counted(`history-${i}`));
    localStorage.setItem(ordersKey, JSON.stringify(orders));
    localStorage.setItem(salesKey, JSON.stringify({ version: 1, byDate: {
      [`${scope}|2026-01-10`]: {
        completedAt: '2026-01-10T20:00:00Z', snapshot: { updatedAt: '2026-01-11T20:00:00Z', lines: { s01: { out: '100', remain: '5' } } },
        countedLines: { s01: { out: '100', remain: '20', remainSource: 'counted' } },
      },
    } }));
    const result = archiveDataOlderThan('2026-08-20');
    if (result.ok === false) throw new Error(result.reason);
    expect(result.archive.counts.orderHistory).toBe(1200);
    expect(JSON.parse(localStorage.getItem(ordersKey)!)).toHaveLength(0);
    expect(restoreDataArchive(result.archive.id)).toBe(true);
    expect(new Set(JSON.parse(localStorage.getItem(ordersKey)!).map((row: { id: string }) => row.id)).size).toBe(1200);
    expect(JSON.parse(localStorage.getItem(salesKey)!).byDate[`${scope}|2026-01-10`].countedLines.s01.remain).toBe('20');
  });
});
