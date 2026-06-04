import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrderHistory } from './orderHistoryStorage';

const FRANCHISEE_USER = 'franchisee-1';
const HQ_EMPLOYEE = 'hq-emp-1';

vi.mock('./authSession', () => ({
  readSession: () => ({ userId: HQ_EMPLOYEE, role: 'employee' }),
}));

vi.mock('./systemUsersStorage', () => ({
  listSystemUsers: () => [
    {
      id: FRANCHISEE_USER,
      name: '加盟主甲',
      role: 'franchisee',
      storeLabel: '測試加盟店',
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

describe('loadOrderHistory for HQ employee', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([
        {
          id: '0012026060301',
          createdAt: '2026-06-02T22:00:00.000Z',
          orderDateYmd: '2026-06-03',
          updatedAt: '2026-06-02T22:00:00.000Z',
          source: 'procurement',
          status: '待出貨',
          totalAmount: 500,
          payableAmount: 500,
          itemCount: 5,
          lines: [
            {
              productId: 'p1',
              name: '測試',
              unitPrice: 100,
              qty: 5,
              unit: '隻',
            },
          ],
          actorRole: 'franchisee',
          storeLabel: '測試加盟店',
          scopeId: `scope:franchisee:${FRANCHISEE_USER}`,
          actorUserId: FRANCHISEE_USER,
        },
        {
          id: '0012026060302',
          createdAt: '2026-06-03T08:00:00.000Z',
          orderDateYmd: '2026-06-03',
          updatedAt: '2026-06-03T08:00:00.000Z',
          source: 'procurement',
          status: '待出貨',
          totalAmount: 300,
          payableAmount: 300,
          itemCount: 3,
          lines: [
            {
              productId: 'p1',
              name: '測試',
              unitPrice: 100,
              qty: 3,
              unit: '隻',
            },
          ],
          actorRole: 'employee',
          storeLabel: '直營店',
          scopeId: 'scope:hq',
          actorUserId: HQ_EMPLOYEE,
        },
      ]),
    );
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  });

  it('總部直營員工可看見加盟主昨晚送出之待出貨單', () => {
    const list = loadOrderHistory();
    expect(list.some((o) => o.id === '0012026060301')).toBe(true);
    expect(list.some((o) => o.id === '0012026060302')).toBe(true);
  });
});
