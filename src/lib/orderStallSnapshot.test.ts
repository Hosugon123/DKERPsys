import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readMergedOrderByIdFromStores,
  stallCountSnapshotPersistedMatches,
  updateStallCountSnapshotByOrderId,
} from './orderHistoryStorage';
import type { SalesRecordDaySnapshot } from './salesRecordStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

const ORDER_ID = 'stall-snap-order-1';
const BASIS_YMD = '2026-06-02';

function baseOrder(extra: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    createdAt: '2026-06-03T08:00:00.000Z',
    orderDateYmd: '2026-06-03',
    updatedAt: '2026-06-03T08:00:00.000Z',
    source: 'procurement',
    status: '已完成',
    totalAmount: 1000,
    payableAmount: 1000,
    itemCount: 1,
    lines: [{ productId: 'p1', name: '品項A', unitPrice: 100, qty: 5, unit: '隻' }],
    storeLabel: '直營店',
    scopeId: 'scope:hq',
    stallCountBasisYmd: BASIS_YMD,
    stallCountCompletedAt: '2026-06-03T09:00:00.000Z',
    stallCountSnapshot: {
      lines: { p1: { out: '5', remain: '1' } },
      actualRevenue: '1000',
      updatedAt: '2026-06-03T09:00:00.000Z',
    },
    ...extra,
  };
}

describe('updateStallCountSnapshotByOrderId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('寫入後合併讀回含登錄實收與落差欄位', () => {
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([{ ...baseOrder(), actorRole: 'employee' }]));
    const next: SalesRecordDaySnapshot = {
      lines: { p1: { out: '5', remain: '0' } },
      actualRevenue: '8888',
      revenueGapAmount: '12',
      revenueGapReason: '零錢',
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    expect(updateStallCountSnapshotByOrderId(ORDER_ID, next).ok).toBe(true);
    const snap = readMergedOrderByIdFromStores(ORDER_ID)?.stallCountSnapshot;
    expect(stallCountSnapshotPersistedMatches(snap, next)).toBe(true);
    expect(String(snap?.actualRevenue).trim()).toBe('8888');
  });

  it('雙庫同單：僅歷史庫有盤點押記時，訂單管理庫亦寫入快照', () => {
    const mgmt = baseOrder({ stallCountCompletedAt: undefined, stallCountSnapshot: undefined });
    const hist = { ...baseOrder(), actorRole: 'employee' as const };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([mgmt]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([hist]));

    const next: SalesRecordDaySnapshot = {
      lines: { p1: { out: '5', remain: '2' } },
      actualRevenue: '7777',
      updatedAt: '2026-06-03T12:30:00.000Z',
    };
    expect(updateStallCountSnapshotByOrderId(ORDER_ID, next).ok).toBe(true);

    const mgmtRows = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as { stallCountSnapshot?: SalesRecordDaySnapshot }[];
    expect(stallCountSnapshotPersistedMatches(mgmtRows[0]?.stallCountSnapshot, next)).toBe(true);
  });
});
