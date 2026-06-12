import { describe, expect, it } from 'vitest';
import { mergeOrderLikeRecord } from './bundleRecordMerge';
import type { FranchiseOrderStatus, OrderHistoryLine } from './orderHistoryStorage';

const line = (qty: number): OrderHistoryLine => ({
  productId: 'p1',
  name: 'item',
  unitPrice: 100,
  qty,
  unit: 'pack',
});

function order(
  status: FranchiseOrderStatus,
  qty: number,
  updatedAt: string,
  statusUpdatedAt?: string,
) {
  return {
    id: 'order-status-merge-1',
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt,
    source: 'procurement' as const,
    status,
    statusUpdatedAt,
    totalAmount: qty * 100,
    payableAmount: qty * 100,
    itemCount: qty,
    lines: [line(qty)],
    storeLabel: 'store',
    actorRole: 'franchisee' as const,
  };
}

describe('order status merge priority', () => {
  it('does not resurrect a canceled order from a stale pending copy', () => {
    const canceled = order('已取消', 7, '2026-06-03T10:00:00.000Z');
    const pending = order('待出貨', 10, '2026-06-03T12:00:00.000Z');

    const merged = mergeOrderLikeRecord(canceled, pending);

    expect(merged.status).toBe('已取消');
  });

  it('keeps the newest line edit without overwriting the newest status operation', () => {
    const shippedEarlier = {
      ...order('已完成', 10, '2026-06-03T10:00:00.000Z', '2026-06-03T10:00:00.000Z'),
      lines: [{ ...line(10), updatedAt: '2026-06-03T09:00:00.000Z' }],
    };
    const quantityEditedLater = {
      ...order('待出貨', 7, '2026-06-03T12:00:00.000Z', '2026-06-03T08:00:00.000Z'),
      lines: [{ ...line(7), updatedAt: '2026-06-03T12:00:00.000Z' }],
    };

    const merged = mergeOrderLikeRecord(shippedEarlier, quantityEditedLater);

    expect(merged.status).toBe('已完成');
    expect(merged.lines[0]?.qty).toBe(7);
  });

  it('allows a newer status operation to be the final state', () => {
    const shippedEarlier = order('已完成', 10, '2026-06-03T10:00:00.000Z', '2026-06-03T10:00:00.000Z');
    const revertedLater = order('待出貨', 10, '2026-06-03T12:00:00.000Z', '2026-06-03T12:00:00.000Z');

    const merged = mergeOrderLikeRecord(shippedEarlier, revertedLater);

    expect(merged.status).toBe('待出貨');
  });
});
