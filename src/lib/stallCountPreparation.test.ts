import { beforeEach, describe, expect, it } from 'vitest';
import { clearEstimatedStallRemains, prepareStallCountSnapshot } from './stallCountPreparation';
import { commitStallInventoryComplete, loadDay, type DaySnapshot } from './stallInventoryStorage';
import {
  getSalesRecord, getSalesRecordForStatistics, saveSalesRecord,
  listSalesRecordSnapshots,
  applySalesRecordOrderDeduction, restoreSalesRecordOrderDeduction, patchSalesRecordRevenueGapReason,
} from './salesRecordStorage';
import { computeProcurementLastWeekSameDaySold } from './procurementWeekdayReference';
import type { SupplyItem } from './supplyCatalog';

const item = (id: string): SupplyItem => ({
  id, name: id, pricePerPiece: 10, retailPerPiece: 10, pieceUnit: '支', orderUnit: '份',
  piecesPerPackage: 1, status: '庫存充足', category: 'duck',
});
const snapshot = (remain = '20', source?: 'counted' | 'estimated'): DaySnapshot => ({
  lines: { s01: { out: '100', remain, ...(source ? { remainSource: source } : {}) } },
  actualRevenue: '500', updatedAt: '2026-11-13T14:00:00Z',
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([{
    id: 'test-count', createdAt: '2026-11-13T00:00:00Z', orderDateYmd: '2026-11-13',
    updatedAt: '2026-11-13T00:00:00Z', source: 'procurement', status: '已完成',
    actorRole: 'admin', scopeId: 'scope:hq', totalAmount: 1000, payableAmount: 1000, itemCount: 100,
    lines: [{ productId: 's01', name: '黑輪', qty: 100, unitPrice: 10, unit: '片' }],
  }]));
});

describe('physical count is the default, revenue estimates require consent', () => {
  it.each(['1', '99999'])('leaves counted quantities unchanged with revenue=%s, including in sales and last-week references', revenue => {
    const input = { ...snapshot('20', 'counted'), actualRevenue: revenue };
    const result = prepareStallCountSnapshot(input, ['s01'], item, false);
    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.error);
    expect(result.snapshot.lines.s01).toEqual(input.lines.s01);
    const saved = commitStallInventoryComplete({
      orderId: 'test-count', basisYmd: '2026-11-13', completedAt: '2026-11-13T15:00:00Z',
      recordSnap: result.snapshot, stallDaySnap: result.snapshot, scopeId: 'scope:hq',
    });
    expect(saved).toEqual({ ok: true });
    expect(getSalesRecord('2026-11-13', 'scope:hq')!.lines.s01).toMatchObject({ out: '100', remain: '20' });
    expect(loadDay('2026-11-13', 'scope:hq').lines.s01).toMatchObject({ out: '100', remain: '20' });
    const ref = computeProcurementLastWeekSameDaySold('2026-11-20', [], 'headquarter');
    expect(ref.outByProductId.get('s01')).toBe(100);
    expect(ref.soldByProductId.get('s01')).toBe(80);
    expect(ref.estimatedProductIds.size).toBe(0);
  });

  it('does not fill blank counts merely because revenue is present', () => {
    const result = prepareStallCountSnapshot(snapshot(''), ['s01'], item, false);
    expect(result).toEqual({ ok: true, snapshot: snapshot('') });
  });

  it('does not count next-day carryover deductions or their restoration as sales', () => {
    saveSalesRecord('2026-11-13', snapshot('20', 'counted'), 'scope:hq');
    applySalesRecordOrderDeduction('2026-11-13', { s01: 15 }, 'scope:hq');
    expect(getSalesRecord('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('5');
    expect(getSalesRecordForStatistics('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('20');
    expect(listSalesRecordSnapshots('scope:hq')[0].snapshot.lines.s01.remain).toBe('20');
    const ref = computeProcurementLastWeekSameDaySold('2026-11-20', [], 'headquarter');
    expect(ref.outByProductId.get('s01')).toBe(100);
    expect(ref.soldByProductId.get('s01')).toBe(80);
    patchSalesRecordRevenueGapReason('2026-11-13', 'test note', 'scope:hq');
    expect(getSalesRecordForStatistics('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('20');
    restoreSalesRecordOrderDeduction('2026-11-13', { s01: 15 }, 'scope:hq');
    expect(getSalesRecord('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('20');
    expect(getSalesRecordForStatistics('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('20');
    saveSalesRecord('2026-11-13', snapshot('25', 'counted'), 'scope:hq');
    expect(getSalesRecordForStatistics('2026-11-13', 'scope:hq')!.lines.s01.remain).toBe('25');
    expect(computeProcurementLastWeekSameDaySold('2026-11-20', [], 'headquarter').soldByProductId.get('s01')).toBe(75);
  });

  it('blocks estimated drafts in both preparation and storage without explicit consent', () => {
    const input = snapshot('50', 'estimated');
    expect(prepareStallCountSnapshot(input, ['s01'], item, false).ok).toBe(false);
    const before = localStorage.getItem('dongshan_franchise_mgmt_orders_v1');
    expect(commitStallInventoryComplete({
      orderId: 'test-count', basisYmd: '2026-11-13', completedAt: '2026-11-13T15:00:00Z',
      recordSnap: input, stallDaySnap: input, scopeId: 'scope:hq',
    })).toEqual({ ok: false, reason: 'estimate_not_authorized' });
    expect(getSalesRecord('2026-11-13', 'scope:hq')).toBeNull();
    expect(localStorage.getItem('dongshan_franchise_mgmt_orders_v1')).toBe(before);
  });

  it('recalculates opted-in estimates from current revenue and preserves them as estimates in last-week data', () => {
    const preview = prepareStallCountSnapshot(snapshot(''), ['s01'], item, true);
    if (preview.ok === false) throw new Error(preview.error);
    expect(preview.snapshot.lines.s01.remain).toBe('50');
    const changed = { ...preview.snapshot, actualRevenue: '700' };
    const result = prepareStallCountSnapshot(changed, ['s01'], item, true);
    if (result.ok === false) throw new Error(result.error);
    expect(result.snapshot.lines.s01).toMatchObject({ out: '100', remain: '30', remainSource: 'estimated' });
    expect(commitStallInventoryComplete({
      orderId: 'test-count', basisYmd: '2026-11-13', completedAt: '2026-11-13T15:00:00Z',
      recordSnap: result.snapshot, stallDaySnap: result.snapshot, scopeId: 'scope:hq', allowRevenueEstimation: true,
    })).toEqual({ ok: true });
    const ref = computeProcurementLastWeekSameDaySold('2026-11-20', [], 'headquarter');
    expect(ref.soldByProductId.get('s01')).toBe(70);
    expect(ref.estimatedProductIds.has('s01')).toBe(true);
  });

  it('clears only estimated counts when opting out and refuses missing revenue when opting in', () => {
    const input = snapshot('50', 'estimated');
    input.lines.manual = { out: '100', remain: '0', remainSource: 'counted' };
    const cleared = clearEstimatedStallRemains(input);
    expect(cleared.lines.s01.remain).toBe('');
    expect(cleared.lines.manual).toEqual(input.lines.manual);
    expect(input.lines.s01.remain).toBe('50');
    expect(prepareStallCountSnapshot({ ...input, actualRevenue: '' }, ['s01'], item, true).ok).toBe(false);
  });
});
