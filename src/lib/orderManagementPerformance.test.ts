import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRemainSnapshotForOrderManagementDisplay } from './stallInventoryStorage';
import { getAllSupplyItems } from './supplyCatalog';
import { readMergedOrderByIdFromStores, type OrderHistoryEntry } from './orderHistoryStorage';

describe('order detail work scales with basis orders instead of product count', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  function seed(applied: boolean) {
    const lines = getAllSupplyItems().slice(0, 30).map(item => ({
      productId: item.id, name: item.name, qty: 10, unitPrice: 4, unit: item.pieceUnit,
    }));
    const basis: OrderHistoryEntry = {
      id: 'basis', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T18:00:00.000Z',
      source: 'procurement', actorRole: 'admin', scopeId: 'scope:hq', storeLabel: 'HQ',
      status: '已完成', totalAmount: 1200, itemCount: 300, lines,
      stallCountCompletedAt: '2026-10-01T18:00:00.000Z',
      stallCountSnapshot: { actualRevenue: '', updatedAt: '', lines: Object.fromEntries(lines.map(l => [l.productId, { out: '10', remain: '0' }])) },
    };
    const child: OrderHistoryEntry = {
      ...basis, id: 'child', createdAt: '2026-10-02T08:00:00.000Z', status: '待出貨',
      stallCountCompletedAt: undefined, stallCountSnapshot: undefined,
      procurementDeductionBasisOrderId: 'basis',
      ...(applied ? { procurementDeductionAppliedQtyByBasisOrderId: { basis: { [lines[0].productId]: 6 } } } : {}),
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([
      basis, child, ...Array.from({ length: 300 }, (_, i) => ({ ...basis, id: `old-${i}` })),
    ]));
    return { child, lines };
  }

  it('reads explicit carry without scanning historical orders or sales records', () => {
    const { child, lines } = seed(true);
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const snapshot = loadRemainSnapshotForOrderManagementDisplay(child);
    expect(snapshot.lines[lines[0].productId].remain).toBe('6');
    expect(snapshot.lines[lines[1].productId].remain).toBe('0');
    const historicalReads = reads.mock.calls.filter(([key]) => [
      'dongshan_order_history_v1', 'dongshan_franchise_mgmt_orders_v1', 'dongshan_sales_records_v1',
    ].includes(key));
    expect(historicalReads).toHaveLength(0);
  });

  it('resolves legacy carry once per basis rather than rescanning for every product', () => {
    const { child, lines } = seed(false);
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const snapshot = loadRemainSnapshotForOrderManagementDisplay(child);
    for (const line of lines) expect(snapshot.lines[line.productId].remain).toBe('0');
    const orderReads = reads.mock.calls.filter(([key]) => key === 'dongshan_order_history_v1');
    expect(orderReads.length).toBeLessThan(12);
  });

  it('single-order reads keep editable lines isolated and see storage changes immediately', () => {
    const { child } = seed(true);
    const first = readMergedOrderByIdFromStores(child.id)!;
    first.lines[0].qty = 999;
    expect(readMergedOrderByIdFromStores(child.id)!.lines[0].qty).toBe(10);

    const rows = JSON.parse(localStorage.getItem('dongshan_order_history_v1')!);
    rows.find((row: OrderHistoryEntry) => row.id === child.id).lines[0].qty = 18;
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify(rows));
    expect(readMergedOrderByIdFromStores(child.id)!.lines[0].qty).toBe(18);
    localStorage.removeItem('dongshan_order_history_v1');
    expect(readMergedOrderByIdFromStores(child.id)).toBeNull();
  });
});
