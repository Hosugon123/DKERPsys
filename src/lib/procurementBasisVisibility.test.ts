import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listOrdersWithStallCountCompleted } from './orderHistoryStorage';
import { cartAfterDeductingStallRemainFromOrder } from './stallInventoryStorage';

const FRANCHISEE_USER = 'franchisee-basis-1';
const HQ_EMPLOYEE = 'hq-employee-basis-1';
const ORDER_ID = 'basis-franchise-completed-1';

vi.mock('./authSession', () => ({
  readSession: () => ({ userId: HQ_EMPLOYEE, role: 'employee' }),
}));

vi.mock('./systemUsersStorage', () => ({
  listSystemUsers: () => [
    {
      id: FRANCHISEE_USER,
      name: '加盟測試店',
      role: 'franchisee',
      storeLabel: '加盟測試店',
    },
    {
      id: HQ_EMPLOYEE,
      name: '總部員工',
      role: 'employee',
      employeeOrgType: 'hq',
    },
  ],
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
          id: ORDER_ID,
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
      ]),
    );
  });

  it('allows an HQ employee to use a franchise completed stall count as procurement remain basis', () => {
    const basisOrders = listOrdersWithStallCountCompleted();

    expect(basisOrders.some((o) => o.id === ORDER_ID)).toBe(true);
    expect(cartAfterDeductingStallRemainFromOrder({ p1: 10 }, ORDER_ID).p1).toBe(7);
  });
});
