/**
 * 帶出貨量行為：舊單不併前日、批貨預設不指定、完成盤點保留手動帶出
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitStallInventoryComplete,
  computeStallOutImportBreakdown,
  getPreferredProcurementBasisOrderId,
  loadDay,
  recomputeStallOutForStallYmdAndOrder,
  saveDay,
} from './stallInventoryStorage';
import { saveSalesRecord } from './salesRecordStorage';

const PRODUCT_ID = 'duck-bringout-1';
const ORDER_LEGACY = 'legacy-order-1';
const ORDER_NEW = 'new-order-2';
const STALL_YMD = '2026-06-15';
const PREV_YMD = '2026-06-14';

vi.mock('./supplyCatalog', () => ({
  getAllSupplyItems: () => [
    {
      id: PRODUCT_ID,
      name: '測試鴨',
      category: '鴨貨類',
      pieceUnit: '隻',
      pricePerPiece: 100,
    },
  ],
  getSupplyItem: (id: string) =>
    id === PRODUCT_ID
      ? {
          id: PRODUCT_ID,
          name: '測試鴨',
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

function seedLegacyOrderWithoutBasisField() {
  localStorage.setItem(
    'dongshan_franchise_mgmt_orders_v1',
    JSON.stringify([
      {
        id: ORDER_LEGACY,
        createdAt: `${STALL_YMD}T08:00:00.000Z`,
        orderDateYmd: STALL_YMD,
        updatedAt: `${STALL_YMD}T08:00:00.000Z`,
        source: 'procurement',
        status: '已完成',
        totalAmount: 500,
        payableAmount: 500,
        itemCount: 5,
        lines: [{ productId: PRODUCT_ID, name: '測試鴨', qty: 5, unitPrice: 100, unit: '隻' }],
        scopeId: 'scope:hq',
      },
    ]),
  );
}

describe('stall bring-out edge cases', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
  });

  it('舊單無 procurementDeductionBasisOrderId：植入帶出不併前一日剩餘', () => {
    seedLegacyOrderWithoutBasisField();
    saveDay(PREV_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '8' } },
      actualRevenue: '',
      updatedAt: 't',
    });
    saveSalesRecord(PREV_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '8' } },
      actualRevenue: '1000',
      updatedAt: 't',
    });

    recomputeStallOutForStallYmdAndOrder(STALL_YMD, ORDER_LEGACY, undefined, { clearRemain: true });

    expect(Number(loadDay(STALL_YMD).lines[PRODUCT_ID]?.out)).toBe(5);
    const breakdown = computeStallOutImportBreakdown(STALL_YMD, ORDER_LEGACY);
    expect(breakdown?.chainsPriorStallRemain).toBe(false);
    expect(breakdown?.rows.find((r) => r.productId === PRODUCT_ID)?.prevRemain).toBe(0);
  });

  it('getPreferredProcurementBasisOrderId 首次進入預設不指定', () => {
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([
        {
          id: 'counted-1',
          createdAt: '2026-06-01T08:00:00.000Z',
          orderDateYmd: '2026-06-01',
          updatedAt: '2026-06-01T09:00:00.000Z',
          source: 'procurement',
          status: '已完成',
          totalAmount: 100,
          payableAmount: 100,
          itemCount: 1,
          lines: [],
          scopeId: 'scope:hq',
          stallCountBasisYmd: '2026-06-01',
          stallCountCompletedAt: '2026-06-01T18:00:00.000Z',
          stallCountSnapshot: { lines: {}, actualRevenue: '100', updatedAt: 't' },
        },
      ]),
    );
    expect(getPreferredProcurementBasisOrderId()).toBe('');
  });

  it('getPreferredProcurementBasisOrderId 還原使用者曾選的扣庫單', () => {
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([
        {
          id: 'counted-a',
          createdAt: '2026-06-01T08:00:00.000Z',
          orderDateYmd: '2026-06-01',
          updatedAt: '2026-06-01T09:00:00.000Z',
          source: 'procurement',
          status: '已完成',
          totalAmount: 100,
          payableAmount: 100,
          itemCount: 1,
          lines: [],
          scopeId: 'scope:hq',
          stallCountBasisYmd: '2026-06-01',
          stallCountCompletedAt: '2026-06-01T18:00:00.000Z',
          stallCountSnapshot: { lines: {}, actualRevenue: '100', updatedAt: 't' },
        },
      ]),
    );
    localStorage.setItem('dongshan_procurement_stall_basis_order_id', 'counted-a');
    expect(getPreferredProcurementBasisOrderId()).toBe('counted-a');
  });

  it('commitStallInventoryComplete 寫入手動帶出，不再被公式重算覆蓋', () => {
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([
        {
          id: ORDER_NEW,
          createdAt: `${STALL_YMD}T08:00:00.000Z`,
          orderDateYmd: STALL_YMD,
          updatedAt: `${STALL_YMD}T08:00:00.000Z`,
          source: 'procurement',
          status: '已完成',
          totalAmount: 500,
          payableAmount: 500,
          itemCount: 5,
          lines: [{ productId: PRODUCT_ID, name: '測試鴨', qty: 5, unitPrice: 100, unit: '隻' }],
          scopeId: 'scope:hq',
          procurementDeductionBasisOrderId: '',
        },
      ]),
    );
    const manualOut = '99';
    const manualRemain = '2';
    const res = commitStallInventoryComplete({
      orderId: ORDER_NEW,
      basisYmd: STALL_YMD,
      completedAt: `${STALL_YMD}T20:00:00.000Z`,
      recordSnap: {
        lines: { [PRODUCT_ID]: { out: manualOut, remain: manualRemain } },
        actualRevenue: '5000',
        updatedAt: `${STALL_YMD}T20:00:00.000Z`,
      },
      stallDaySnap: {
        lines: { [PRODUCT_ID]: { out: manualOut, remain: manualRemain } },
        actualRevenue: '5000',
        updatedAt: `${STALL_YMD}T20:00:00.000Z`,
      },
    });
    expect(res.ok).toBe(true);
    expect(loadDay(STALL_YMD).lines[PRODUCT_ID]?.out).toBe(manualOut);
    const orders = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as { stallCountSnapshot?: { lines?: Record<string, { out?: string }> } }[];
    expect(orders[0]?.stallCountSnapshot?.lines?.[PRODUCT_ID]?.out).toBe(manualOut);
  });
});
