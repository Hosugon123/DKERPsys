import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listOrdersWithStallCountCompleted,
  orderMatchesProcurementSoldReferenceScope,
} from './orderHistoryStorage';
import { getPreferredProcurementBasisOrderId } from './stallInventoryStorage';

const FRANCHISEE_USER = 'franchisee-basis-1';
const HQ_EMPLOYEE = 'hq-employee-basis-1';
const HQ_ORDER_ID = 'basis-hq-completed-1';
const FRANCHISE_ORDER_ID = 'basis-franchise-completed-1';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'employee',
    userId: HQ_EMPLOYEE,
    scopeId: 'scope:hq',
    isAdmin: false,
  }),
  franchiseeOwnerUserIdFromScopeId: () => null,
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '',
  resolveUserDisplayNameById: () => '',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

describe('procurement basis visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([
        {
          id: FRANCHISE_ORDER_ID,
          createdAt: '2026-06-03T18:00:00.000Z',
          orderDateYmd: '2026-06-03',
          updatedAt: '2026-06-03T18:00:00.000Z',
          source: 'procurement',
          status: '已完成',
          totalAmount: 500,
          payableAmount: 500,
          itemCount: 5,
          lines: [{ productId: 'p1', name: '測試品項', unitPrice: 100, qty: 5, unit: '份' }],
          actorRole: 'franchisee',
          storeLabel: '加盟測試店',
          scopeId: `scope:franchisee:${FRANCHISEE_USER}`,
          actorUserId: FRANCHISEE_USER,
          stallCountBasisYmd: '2026-06-03',
          stallCountCompletedAt: '2026-06-03T21:00:00.000Z',
          stallCountSnapshot: {
            lines: { p1: { out: '10', remain: '3' } },
            actualRevenue: '700',
            updatedAt: '2026-06-03T21:00:00.000Z',
          },
        },
        {
          id: HQ_ORDER_ID,
          createdAt: '2026-06-04T18:00:00.000Z',
          orderDateYmd: '2026-06-04',
          updatedAt: '2026-06-04T18:00:00.000Z',
          source: 'procurement',
          status: '已完成',
          totalAmount: 300,
          payableAmount: 300,
          itemCount: 3,
          lines: [{ productId: 'p1', name: '測試品項', unitPrice: 100, qty: 3, unit: '份' }],
          actorRole: 'employee',
          storeLabel: '直營',
          scopeId: 'scope:hq',
          actorUserId: HQ_EMPLOYEE,
          stallCountBasisYmd: '2026-06-04',
          stallCountCompletedAt: '2026-06-04T21:00:00.000Z',
          stallCountSnapshot: {
            lines: { p1: { out: '8', remain: '2' } },
            actualRevenue: '600',
            updatedAt: '2026-06-04T21:00:00.000Z',
          },
        },
      ]),
    );
  });

  it('直營員工訂單管理仍可見加盟單，但批貨扣餘僅能選直營盤點單', () => {
    const all = listOrdersWithStallCountCompleted();
    const scoped = all.filter((o) => orderMatchesProcurementSoldReferenceScope(o));

    expect(all.some((o) => o.id === FRANCHISE_ORDER_ID)).toBe(true);
    expect(scoped.some((o) => o.id === FRANCHISE_ORDER_ID)).toBe(false);
    expect(scoped.some((o) => o.id === HQ_ORDER_ID)).toBe(true);
  });

  it('getPreferredProcurementBasisOrderId 不還原加盟單給直營帳號', () => {
    localStorage.setItem('dongshan_procurement_stall_basis_order_id', FRANCHISE_ORDER_ID);
    expect(getPreferredProcurementBasisOrderId()).toBe('');

    localStorage.setItem('dongshan_procurement_stall_basis_order_id', HQ_ORDER_ID);
    expect(getPreferredProcurementBasisOrderId()).toBe(HQ_ORDER_ID);
  });
});
