import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HQ_SCOPE_ID } from './dataScope';
import { getStallDisplayActualRevenue } from './orderStallDisplayRevenue';
import { saveSalesRecord, getSalesRecord } from './salesRecordStorage';
import { syncBasisDayFromOrderSnapshot } from './stallInventoryStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
}));

const FRANCHISE_SCOPE = 'scope:franchisee:fr-1';
const ORDER_DIRECT = 'order-direct-1';
const ORDER_FRANCHISE = 'order-franchise-1';
const BASIS_YMD = '2026-06-02';

function seedOrder(
  id: string,
  scopeId: string,
  actorRole: 'admin' | 'franchisee' | 'employee',
  snapshot?: { actualRevenue: string },
) {
  const base = {
    id,
    createdAt: '2026-06-03T08:00:00.000Z',
    orderDateYmd: '2026-06-03',
    updatedAt: '2026-06-03T08:00:00.000Z',
    source: 'procurement',
    status: '已完成',
    totalAmount: 1000,
    payableAmount: 1000,
    itemCount: 1,
    lines: [{ productId: 'p1', name: '品項A', unitPrice: 100, qty: 5, unit: '隻' }],
    storeLabel: '測試店',
    scopeId,
    stallCountBasisYmd: BASIS_YMD,
    stallCountCompletedAt: '2026-06-03T09:00:00.000Z',
    stallCountSnapshot: {
      lines: { p1: { out: '5', remain: '1' } },
      actualRevenue: snapshot?.actualRevenue ?? '1000',
      updatedAt: '2026-06-03T09:00:00.000Z',
    },
  };
  localStorage.setItem(
    'dongshan_order_history_v1',
    JSON.stringify([
      {
        ...base,
        actorRole,
        actorUserId: actorRole === 'franchisee' ? 'fr-1' : 'admin-1',
      },
    ]),
  );
}

describe('stall sales record scope isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  });

  it('直營調整盤點同步不覆寫加盟同日銷售紀錄', () => {
    saveSalesRecord(BASIS_YMD, { lines: { p1: { out: '1', remain: '0' } }, actualRevenue: '1111', updatedAt: 't1' }, FRANCHISE_SCOPE);
    seedOrder(ORDER_DIRECT, HQ_SCOPE_ID, 'admin', { actualRevenue: '8888' });

    syncBasisDayFromOrderSnapshot(ORDER_DIRECT);

    expect(getSalesRecord(BASIS_YMD, FRANCHISE_SCOPE)?.actualRevenue).toBe('1111');
    expect(getSalesRecord(BASIS_YMD, HQ_SCOPE_ID)?.actualRevenue).toBe('8888');
  });

  it('加盟訂單不讀直營同日全域銷售紀錄（無內嵌快照時）', () => {
    saveSalesRecord(BASIS_YMD, { lines: { p1: { out: '9', remain: '0' } }, actualRevenue: '9999', updatedAt: 't2' }, HQ_SCOPE_ID);
    const franchiseOrder = {
      id: ORDER_FRANCHISE,
      createdAt: '2026-06-03T08:00:00.000Z',
      orderDateYmd: '2026-06-03',
      updatedAt: '2026-06-03T08:00:00.000Z',
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 1,
      lines: [{ productId: 'p1', name: '品項A', unitPrice: 100, qty: 5, unit: '隻' }],
      storeLabel: '加盟店',
      scopeId: FRANCHISE_SCOPE,
      actorRole: 'franchisee' as const,
      actorUserId: 'fr-1',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: '2026-06-03T09:00:00.000Z',
    };
    expect(getStallDisplayActualRevenue(franchiseOrder)).toBeNull();
  });
});
