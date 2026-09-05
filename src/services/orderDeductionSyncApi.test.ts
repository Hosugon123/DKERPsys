import { beforeEach, describe, expect, it, vi } from 'vitest';

const PRODUCT_ID = 'test-sync-duck';
const BASIS_ORDER_ID = 'basis-sync-order';
const BASIS_ORDER_ID_2 = 'basis-sync-order-2';
const CHILD_ORDER_ID = 'child-sync-order';
const BASIS_YMD = '2026-08-13';
const BASIS_YMD_2 = '2026-08-12';
const CHILD_YMD = '2026-08-14';

vi.mock('./storageMode', () => ({
  getStorageMode: () => 'local',
  getApiBaseUrl: () => '',
  getApiSyncToken: () => '',
  getAsyncStorageDelayMs: () => 0,
}));

vi.mock('../lib/supplyCatalog', () => ({
  getAllSupplyItems: () => [
    {
      id: PRODUCT_ID,
      name: '測試品項',
      category: '鴨貨類',
      pieceUnit: '份',
      pricePerPiece: 100,
    },
  ],
  getSupplyItem: (id: string) =>
    id === PRODUCT_ID
      ? {
          id: PRODUCT_ID,
          name: '測試品項',
          category: '鴨貨類',
          pieceUnit: '份',
          pricePerPiece: 100,
        }
      : undefined,
  isConsumableItem: () => false,
}));

vi.mock('../lib/dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('../lib/sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

function seedOrders() {
  localStorage.setItem(
    'dongshan_franchise_mgmt_orders_v1',
    JSON.stringify([
      {
        id: BASIS_ORDER_ID,
        createdAt: `${BASIS_YMD}T10:00:00.000Z`,
        orderDateYmd: BASIS_YMD,
        updatedAt: `${BASIS_YMD}T20:00:00.000Z`,
        source: 'procurement',
        status: '已完成',
        totalAmount: 10000,
        payableAmount: 10000,
        itemCount: 100,
        lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 100, unitPrice: 100, unit: '份' }],
        scopeId: 'scope:hq',
        stallCountBasisYmd: BASIS_YMD,
        stallCountCompletedAt: `${BASIS_YMD}T20:00:00.000Z`,
        stallCountSnapshot: {
          lines: { [PRODUCT_ID]: { out: '100', remain: '20' } },
          actualRevenue: '8000',
          updatedAt: `${BASIS_YMD}T20:00:00.000Z`,
        },
      },
      {
        id: CHILD_ORDER_ID,
        createdAt: `${CHILD_YMD}T08:00:00.000Z`,
        orderDateYmd: CHILD_YMD,
        updatedAt: `${CHILD_YMD}T08:00:00.000Z`,
        source: 'procurement',
        status: '待出貨',
        totalAmount: 10000,
        payableAmount: 10000,
        itemCount: 100,
        lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 100, unitPrice: 100, unit: '份' }],
        scopeId: 'scope:hq',
      },
    ]),
  );
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
}

describe('order deduction API stall out sync', () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
    seedOrders();
  });

  it('recomputes stall bring-out after applying and removing a deduction basis', async () => {
    const { orders } = await import('./apiService');
    const { loadDay } = await import('../lib/stallInventoryStorage');
    const { readMergedOrderByIdFromStores } = await import('../lib/orderHistoryStorage');

    const applied = await orders.applyProcurementDeductionBasisAfterSubmit({
      orderId: CHILD_ORDER_ID,
      basisOrderId: BASIS_ORDER_ID,
    });

    expect(applied).toEqual({ ok: true });
    expect(readMergedOrderByIdFromStores(CHILD_ORDER_ID)?.lines[0]?.qty).toBe(80);
    expect(Number(loadDay(CHILD_YMD, 'scope:hq').lines[PRODUCT_ID]?.out)).toBe(100);

    const removed = await orders.removeProcurementDeductionBasisFromOrder({
      orderId: CHILD_ORDER_ID,
      basisOrderId: BASIS_ORDER_ID,
    });

    expect(removed.ok).toBe(true);
    expect(readMergedOrderByIdFromStores(CHILD_ORDER_ID)?.lines[0]?.qty).toBe(100);
    expect(Number(loadDay(CHILD_YMD, 'scope:hq').lines[PRODUCT_ID]?.out)).toBe(100);
  });

  it('limits append-time deductions across multiple basis orders to the submitted quantity', async () => {
    const { orders } = await import('./apiService');
    const { loadDay } = await import('../lib/stallInventoryStorage');
    const { readMergedOrderByIdFromStores } = await import('../lib/orderHistoryStorage');

    const basis = (id: string, ymd: string) => ({
      id,
      createdAt: `${ymd}T10:00:00.000Z`,
      orderDateYmd: ymd,
      updatedAt: `${ymd}T20:00:00.000Z`,
      source: 'procurement',
      status: '已完成',
      totalAmount: 10000,
      payableAmount: 10000,
      itemCount: 100,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 100, unitPrice: 100, unit: '份' }],
      storeLabel: '直營店',
      actorRole: 'admin',
      scopeId: 'scope:hq',
      stallCountBasisYmd: ymd,
      stallCountCompletedAt: `${ymd}T20:00:00.000Z`,
      stallCountSnapshot: {
        lines: { [PRODUCT_ID]: { out: '100', remain: '8' } },
        actualRevenue: '8000',
        updatedAt: `${ymd}T20:00:00.000Z`,
      },
    });
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([basis(BASIS_ORDER_ID, BASIS_YMD), basis(BASIS_ORDER_ID_2, BASIS_YMD_2)]),
    );

    const orderId = await orders.appendProcurementOrderEntry({
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 10, unitPrice: 100, unit: '份' }],
      totalAmount: 1000,
      actorRole: 'admin',
      orderDateYmd: CHILD_YMD,
      procurementDeductionBasisOrderIds: [BASIS_ORDER_ID, BASIS_ORDER_ID_2],
    });
    const child = readMergedOrderByIdFromStores(orderId);

    expect(child?.procurementDeductionAppliedQtyByBasisOrderId).toEqual({
      [BASIS_ORDER_ID]: { [PRODUCT_ID]: 8 },
      [BASIS_ORDER_ID_2]: { [PRODUCT_ID]: 2 },
    });
    expect(Number(loadDay(BASIS_YMD, 'scope:hq').lines[PRODUCT_ID]?.remain)).toBe(0);
    expect(Number(loadDay(BASIS_YMD_2, 'scope:hq').lines[PRODUCT_ID]?.remain)).toBe(6);
  });

  it('append-time deduction can persist carry greater than the deducted order quantity when frontend supplies it', async () => {
    const { orders } = await import('./apiService');
    const {
      loadDay,
      loadRemainSnapshotForOrderManagementDisplay,
      recomputeStallOutForStallYmdAndOrder,
    } = await import('../lib/stallInventoryStorage');
    const { readMergedOrderByIdFromStores } = await import('../lib/orderHistoryStorage');

    const orderId = await orders.appendProcurementOrderEntry({
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 4, unitPrice: 100, unit: '份' }],
      totalAmount: 400,
      actorRole: 'admin',
      orderDateYmd: CHILD_YMD,
      procurementDeductionBasisOrderId: BASIS_ORDER_ID,
      procurementDeductionAppliedQtyByBasisOrderId: {
        [BASIS_ORDER_ID]: { [PRODUCT_ID]: 6 },
      },
    });
    const child = readMergedOrderByIdFromStores(orderId);

    expect(child?.lines[0]?.qty).toBe(4);
    expect(child?.procurementDeductionAppliedQtyByBasisOrderId).toEqual({
      [BASIS_ORDER_ID]: { [PRODUCT_ID]: 6 },
    });
    expect(Number(loadDay(BASIS_YMD, 'scope:hq').lines[PRODUCT_ID]?.remain)).toBe(14);
    expect(Number(loadRemainSnapshotForOrderManagementDisplay(child!).lines[PRODUCT_ID]?.remain)).toBe(6);

    const implanted = recomputeStallOutForStallYmdAndOrder(CHILD_YMD, orderId, undefined, {
      clearRemain: true,
      persist: false,
    });
    expect(Number(implanted.lines[PRODUCT_ID]?.out)).toBe(10);
  });
});
