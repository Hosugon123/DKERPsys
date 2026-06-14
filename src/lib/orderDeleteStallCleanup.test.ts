import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteOrderByIdFromAnyStore } from './orderHistoryStorage';
import { getSalesRecord } from './salesRecordStorage';
import { loadDayForProcurement } from './stallInventoryStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

const ORDER_ID = 'cleanup-order-1';
const BASIS_YMD = '2026-06-03';
const DUCK_ID = 's20';

describe('deleteOrder stall/sales cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    const order = {
      id: ORDER_ID,
      createdAt: '2026-06-03T08:00:00.000Z',
      orderDateYmd: BASIS_YMD,
      updatedAt: '2026-06-03T09:00:00.000Z',
      source: 'procurement',
      status: '已完成',
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 1,
      lines: [{ productId: DUCK_ID, name: '鴨頭', unitPrice: 50, qty: 20, unit: '份' }],
      storeLabel: '直營店',
      scopeId: 'scope:hq',
      actorRole: 'admin',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: '2026-06-03T18:00:00.000Z',
      stallCountSnapshot: {
        lines: { [DUCK_ID]: { out: '20', remain: '2' } },
        actualRevenue: '9000',
        updatedAt: '2026-06-03T18:00:00.000Z',
      },
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([order]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
    localStorage.setItem(
      'dongshan_stall_inventory_v1',
      JSON.stringify({
        version: 1,
        byDate: {
          [`scope:hq|${BASIS_YMD}`]: {
            lines: { [DUCK_ID]: { out: '20', remain: '2' } },
            actualRevenue: '9000',
            updatedAt: '2026-06-03T18:00:00.000Z',
          },
        },
      }),
    );
    localStorage.setItem(
      'dongshan_sales_records_v1',
      JSON.stringify({
        version: 1,
        byDate: {
          [`scope:hq|${BASIS_YMD}`]: {
            completedAt: '2026-06-03T18:00:00.000Z',
            snapshot: {
              lines: { [DUCK_ID]: { out: '20', remain: '2' } },
              actualRevenue: '9000',
              updatedAt: '2026-06-03T18:00:00.000Z',
            },
          },
        },
      }),
    );
  });

  it('刪除最後一筆盤點單時清除攤上與銷售日庫', () => {
    expect(deleteOrderByIdFromAnyStore(ORDER_ID)).toBe(true);
    expect(getSalesRecord(BASIS_YMD)).toBeNull();
    expect(Number(loadDayForProcurement(BASIS_YMD).lines[DUCK_ID]?.remain) || 0).toBe(0);
  });
});
