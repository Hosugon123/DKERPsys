import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrderStorageRevisionMs,
  readMergedOrderByIdFromStores,
  updateOrderStatusInEitherStore,
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

const ORDER_ID = 'dual-write-order-1';
const line = (qty: number): OrderHistoryLine => ({
  productId: 'p1',
  name: '品項A',
  unitPrice: 100,
  qty,
  unit: '隻',
});

describe('order dual-store writes', () => {
  beforeEach(() => {
    localStorage.clear();
    const row = {
      id: ORDER_ID,
      createdAt: '2026-06-03T08:00:00.000Z',
      orderDateYmd: '2026-06-03',
      updatedAt: '2026-06-03T08:00:00.000Z',
      source: 'procurement' as const,
      status: '待出貨' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 10,
      lines: [line(10)],
      storeLabel: '直營店',
      scopeId: 'scope:hq',
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([row]));
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([{ ...row, actorRole: 'employee' as const }]),
    );
  });

  it('updateOrderStatusInEitherStore 同步兩庫狀態', () => {
    updateOrderStatusInEitherStore(ORDER_ID, '已完成');
    const mgmt = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as { status: string }[];
    const hist = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]') as {
      status: string;
    }[];
    expect(mgmt[0]?.status).toBe('已完成');
    expect(hist[0]?.status).toBe('已完成');
  });

  it('readMergedOrderByIdFromStores 合併兩庫：已出貨優先於待出貨', () => {
    const mgmt = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as Record<string, unknown>[];
    mgmt[0] = {
      ...mgmt[0],
      status: '已完成',
      lines: [line(6)],
      updatedAt: '2026-06-03T10:00:00.000Z',
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify(mgmt));
    const hist = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]') as Record<
      string,
      unknown
    >[];
    hist[0] = {
      ...hist[0],
      status: '待出貨',
      lines: [line(10)],
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify(hist));

    const merged = readMergedOrderByIdFromStores(ORDER_ID);
    expect(merged?.status).toBe('已完成');
    expect(merged?.lines[0]?.qty).toBe(6);
  });

  it('updateEditableOrderLinesById 仍寫入兩庫', () => {
    const res = updateEditableOrderLinesById(ORDER_ID, [line(4)]);
    expect(res.ok).toBe(true);
    const merged = readMergedOrderByIdFromStores(ORDER_ID);
    expect(merged?.lines[0]?.qty).toBe(4);
    expect(getOrderStorageRevisionMs(ORDER_ID)).toBeGreaterThan(0);
  });
});
