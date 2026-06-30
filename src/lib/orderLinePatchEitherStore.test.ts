import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  orderLineQtyMapsEqual,
  readOrderLinesByIdFromStores,
  updateEditableOrderLinesById,
  type OrderHistoryLine,
} from './orderHistoryStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

const ORDER_ID = 'dual-store-order-1';
const line = (qty: number): OrderHistoryLine => ({
  productId: 'p1',
  name: '品項A',
  unitPrice: 100,
  qty,
  unit: '隻',
});

describe('updateEditableOrderLinesById (dual store)', () => {
  beforeEach(() => {
    const row = {
      id: ORDER_ID,
      createdAt: '2026-05-14T10:00:00.000Z',
      orderDateYmd: '2026-05-14',
      updatedAt: '2026-05-14T10:00:00.000Z',
      source: 'procurement' as const,
      status: '待出貨' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 10,
      lines: [line(10)],
      storeLabel: '直營店',
      actorRole: 'admin' as const,
      scopeId: 'scope:hq',
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([row]));
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([{ ...row, actorRole: 'employee' as const }]),
    );
  });

  it('writes the same qty to both stores when the same id exists in mgmt and history', () => {
    const res = updateEditableOrderLinesById(ORDER_ID, [line(7)]);
    expect(res.ok).toBe(true);

    const mgmt = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as { lines: OrderHistoryLine[] }[];
    const hist = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]') as {
      lines: OrderHistoryLine[];
    }[];

    expect(mgmt[0]?.lines[0]?.qty).toBe(7);
    expect(hist[0]?.lines[0]?.qty).toBe(7);
    expect(orderLineQtyMapsEqual(readOrderLinesByIdFromStores(ORDER_ID) ?? [], [line(7)])).toBe(true);
  });

  it('allows order management to save an unshipped order with all quantities set to zero', () => {
    const res = updateEditableOrderLinesById(ORDER_ID, [line(0)]);
    expect(res.ok).toBe(true);

    const mgmt = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as Array<{
      lines: OrderHistoryLine[];
      itemCount: number;
      totalAmount: number;
      payableAmount: number;
    }>;
    const hist = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]') as Array<{
      lines: OrderHistoryLine[];
      itemCount: number;
      totalAmount: number;
      payableAmount: number;
    }>;

    for (const row of [mgmt[0], hist[0]]) {
      expect(row?.lines).toEqual([]);
      expect(row?.itemCount).toBe(0);
      expect(row?.totalAmount).toBe(0);
      expect(row?.payableAmount).toBe(0);
    }
    expect(orderLineQtyMapsEqual(readOrderLinesByIdFromStores(ORDER_ID) ?? [], [line(0)])).toBe(true);
  });
});
