/**
 * 次日批貨「扣參考單剩餘」與訂單調整後資料同步 — 回歸測試
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cartAfterDeductingStallRemainFromOrder,
  loadDayForProcurement,
  loadDayForProcurementFromOrder,
  syncBasisDayFromOrderSnapshot,
} from './stallInventoryStorage';
import { saveSalesRecord } from './salesRecordStorage';

const PRODUCT_ID = 'test-duck-1';

vi.mock('./supplyCatalog', () => ({
  getAllSupplyItems: () => [
    {
      id: PRODUCT_ID,
      name: '測試品項',
      category: '鴨貨類',
      pieceUnit: '隻',
      pricePerPiece: 100,
    },
  ],
  getSupplyItem: (id: string) =>
    id === PRODUCT_ID
      ? {
          id: PRODUCT_ID,
          name: '測試品項',
          category: '鴨貨類',
          pieceUnit: '隻',
          pricePerPiece: 100,
        }
      : undefined,
  isConsumableItem: () => false,
}));

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

const ORDER_ID = 'order-basis-test-1';
const BASIS_YMD = '2026-05-20';

function seedCompletedOrderWithSnapshot(remain: number) {
  const raw = localStorage.getItem('dongshan_franchise_mgmt_orders_v1');
  const orders = raw ? (JSON.parse(raw) as { id: string }[]) : [];
  const base = {
    id: ORDER_ID,
    createdAt: `${BASIS_YMD}T10:00:00.000Z`,
    orderDateYmd: BASIS_YMD,
    updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
    source: 'procurement' as const,
    status: '已完成' as const,
    totalAmount: 1000,
    payableAmount: 1000,
    itemCount: 1,
    lines: [
      {
        productId: PRODUCT_ID,
        name: '測試品項',
        qty: 10,
        unitPrice: 100,
        unit: '隻',
      },
    ],
    actorRole: 'employee' as const,
    scopeId: 'scope:hq',
    stallCountBasisYmd: BASIS_YMD,
    stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
    stallCountSnapshot: {
      lines: { [PRODUCT_ID]: { out: '20', remain: String(remain) } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    },
  };
  const without = orders.filter((o) => o.id !== ORDER_ID);
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([...without, base]));
}

describe('procurement basis after order adjustment', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify({ version: 1, entries: [] }));
  });

  it('loadDayForProcurementFromOrder 讀訂單內嵌快照之 remain', () => {
    seedCompletedOrderWithSnapshot(3);
    const snap = loadDayForProcurementFromOrder(ORDER_ID);
    expect(Number(snap.lines[PRODUCT_ID]?.remain)).toBe(3);
  });

  it('syncBasisDayFromOrderSnapshot 後，依 basis 日讀取與快照一致', () => {
    seedCompletedOrderWithSnapshot(2);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '99', remain: '8' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    expect(Number(loadDayForProcurement(BASIS_YMD).lines[PRODUCT_ID]?.remain)).toBe(8);

    seedCompletedOrderWithSnapshot(2);

    syncBasisDayFromOrderSnapshot(ORDER_ID);

    expect(Number(loadDayForProcurement(BASIS_YMD).lines[PRODUCT_ID]?.remain)).toBe(2);
    expect(Number(loadDayForProcurementFromOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(2);
  });

  it('cartAfterDeductingStallRemainFromOrder 使用調整後 remain', () => {
    seedCompletedOrderWithSnapshot(2);
    const cart = cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 10 }, ORDER_ID);
    expect(cart[PRODUCT_ID]).toBe(8);
  });
});
