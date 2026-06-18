import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  loadFranchiseManagementOrders,
  loadOrderHistory,
  orderMatchesListDateRange,
} from './orderHistoryStorage';

const ADMIN_USER = 'admin-user-1';
const HQ_EMPLOYEE = 'hq-employee-1';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'admin',
    userId: ADMIN_USER,
    scopeId: 'scope:hq',
    isAdmin: true,
  }),
  franchiseeOwnerUserIdFromScopeId: () => null,
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試管理員',
  resolveUserDisplayNameById: () => '測試管理員',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

let orderSeq = 0;
vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => `PROC-MGMT-${++orderSeq}`,
}));

const LINE = {
  productId: 's01',
  name: '黑輪',
  unitPrice: 28,
  qty: 10,
  unit: '份',
};

describe('procurement order appears in order management', () => {
  beforeEach(() => {
    orderSeq = 0;
    localStorage.clear();
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  });

  it('admin 叫貨寫入訂單管理專用儲存', () => {
    const orderId = appendProcurementOrderEntry({
      lines: [LINE],
      totalAmount: 280,
      actorRole: 'admin',
      orderDateYmd: '2026-06-18',
    });

    expect(loadFranchiseManagementOrders().some((o) => o.id === orderId)).toBe(true);
    expect(loadOrderHistory().some((o) => o.id === orderId)).toBe(false);
  });

  it('直營員工叫貨亦寫入訂單管理專用儲存', async () => {
    const dataScope = await import('./dataScope');
    vi.spyOn(dataScope, 'getDataScopeContext').mockReturnValue({
      role: 'employee',
      userId: HQ_EMPLOYEE,
      scopeId: 'scope:hq',
      isAdmin: false,
    });

    const orderId = appendProcurementOrderEntry({
      lines: [LINE],
      totalAmount: 280,
      actorRole: 'employee',
      orderDateYmd: '2026-06-18',
    });

    expect(loadFranchiseManagementOrders().some((o) => o.id === orderId)).toBe(true);
    expect(loadOrderHistory().some((o) => o.id === orderId)).toBe(false);
  });

  it('待出貨單歸屬日在區間外時，仍以建單日納入本月列表', () => {
    const createdAt = '2026-06-18T10:00:00.000Z';
    const inRange = orderMatchesListDateRange(
      {
        status: '待出貨',
        createdAt,
        orderDateYmd: '2026-05-07',
      },
      '2026-06-01',
      '2026-06-30',
    );
    expect(inRange).toBe(true);
  });
});
