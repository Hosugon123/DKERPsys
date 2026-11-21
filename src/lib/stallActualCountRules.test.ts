import { beforeEach, expect, it } from 'vitest';
import { getSupplyItem } from './supplyCatalog';
import { prepareStallCountSnapshot } from './stallCountPreparation';
import { commitStallInventoryComplete, type DaySnapshot } from './stallInventoryStorage';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import { readMergedOrderByIdFromStores } from './orderHistoryStorage';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([{
    id: 'physical-test', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
    orderDateYmd: '2026-11-20', scopeId: 'scope:hq', actorRole: 'admin', source: 'procurement',
    status: '已完成', lines: [{ productId: 's01', name: '黑輪', qty: 100, unitPrice: 4, unit: '片' }],
    totalAmount: 400, itemCount: 100,
  }]));
});

function input(): DaySnapshot {
  return { lines: {
    s01: { out: '100', remain: '20', remainSource: 'counted', updatedAt: '2026-11-20T10:00:00Z' },
    黑輪: { out: '100', remain: '50', remainSource: 'estimated', updatedAt: '2026-11-20T10:00:00Z' },
  }, actualRevenue: '1', updatedAt: '2026-11-20T10:00:00Z' };
}

it('does not allow an old estimated product-name alias to replace an explicit physical count on save', () => {
  saveSalesRecord('2026-11-20', input(), 'scope:hq');
  expect(getSalesRecord('2026-11-20', 'scope:hq')!.lines.s01).toMatchObject({ remain: '20', remainSource: 'counted' });
});

it('prepares and commits real counts without requiring estimation because of a hidden legacy alias', () => {
  const prepared = prepareStallCountSnapshot(input(), ['s01'], getSupplyItem, false);
  if (prepared.ok === false) throw new Error(prepared.error);
  expect(prepared.snapshot.lines.黑輪).toBeUndefined();
  expect(commitStallInventoryComplete({ orderId: 'physical-test', basisYmd: '2026-11-20',
    completedAt: '2026-11-20T12:00:00Z', recordSnap: prepared.snapshot, stallDaySnap: prepared.snapshot,
    scopeId: 'scope:hq' })).toEqual({ ok: true });
  expect(readMergedOrderByIdFromStores('physical-test')!.stallCountSnapshot!.lines.s01).toMatchObject({ remain: '20', remainSource: 'counted' });
  expect(getSalesRecord('2026-11-20', 'scope:hq')!.countSubmission).toMatchObject({
    policyVersion: 2, estimationApproved: false, estimatedProductIds: [],
  });
});

it('preserves a physical count even with an older timestamp than an estimated alias and consent enabled', () => {
  const snap = input();
  snap.lines.黑輪.updatedAt = '2026-11-20T11:00:00Z';
  const prepared = prepareStallCountSnapshot(snap, ['s01'], getSupplyItem, true);
  if (prepared.ok === false) throw new Error(prepared.error);
  saveSalesRecord('2026-11-20', prepared.snapshot, 'scope:hq');
  expect(getSalesRecord('2026-11-20', 'scope:hq')!.lines.s01).toMatchObject({ remain: '20', remainSource: 'counted' });
});

it('does not refill a manually cleared field from a hidden estimated alias', () => {
  const snap = input();
  snap.lines.s01.remain = '';
  snap.lines.黑輪.updatedAt = '2026-11-20T11:00:00Z';
  const prepared = prepareStallCountSnapshot(snap, ['s01'], getSupplyItem, false);
  if (prepared.ok === false) throw new Error(prepared.error);
  expect(prepared.snapshot.lines.s01).toMatchObject({ remain: '', remainSource: 'counted' });
  expect(prepared.snapshot.lines.黑輪).toBeUndefined();
});

it('records explicit estimation consent and affected product IDs without relabeling manual counts', () => {
  const snap = input();
  delete snap.lines.黑輪;
  snap.lines.s02 = { out: '100', remain: '30', remainSource: 'estimated' };
  expect(commitStallInventoryComplete({ orderId: 'physical-test', basisYmd: '2026-11-20',
    completedAt: '2026-11-20T12:00:00Z', recordSnap: snap, stallDaySnap: snap,
    scopeId: 'scope:hq', allowRevenueEstimation: true })).toEqual({ ok: true });
  const saved = getSalesRecord('2026-11-20', 'scope:hq')!;
  expect(saved.countSubmission).toEqual({ policyVersion: 2, submittedAt: '2026-11-20T12:00:00Z',
    estimationApproved: true, estimatedProductIds: ['s02'] });
  expect(saved.lines.s01.remainSource).toBe('counted');
  expect(snap.countSubmission).toBeUndefined();
});
