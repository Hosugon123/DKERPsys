import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  setOrderStallCountStamp,
} from './orderHistoryStorage';
import {
  cartAfterDeductingStallRemainFromOrder,
  loadStallSalesDisplayFromBasisOrder,
} from './stallInventoryStorage';
import { getAllSupplyItems, isConsumableItem } from './supplyCatalog';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'franchisee',
    userId: 'dk002-test',
    scopeId: 'scope:franchisee:dk002-test',
    isAdmin: false,
  }),
  HQ_SCOPE_ID: 'scope:hq',
  franchiseeOwnerUserIdFromScopeId: (scopeId: string | undefined) =>
    String(scopeId ?? '').startsWith('scope:franchisee:')
      ? String(scopeId).slice('scope:franchisee:'.length)
      : null,
  resolveFranchiseeRetailOwnerUserId: () => 'dk002-test',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => 'DK002 Test',
  resolveUserDisplayNameById: () => 'DK002 Test',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '002',
  normalizeStoreCode3Digits: (s: string) => s,
}));

let orderSeq = 0;
vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => `ALL-ITEMS-${++orderSeq}`,
}));

describe('procurement cart deduction across every catalog item', () => {
  beforeEach(() => {
    orderSeq = 0;
    localStorage.clear();
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  });

  it('deducts 500 remain from a 2000 cart for every non-consumable item', () => {
    const items = getAllSupplyItems().filter((item) => !isConsumableItem(item));
    expect(items.length).toBeGreaterThan(10);

    const basisYmd = '2026-06-14';
    const orderLines = items.map((item) => ({
      productId: item.id,
      name: `legacy-name-${item.id}`,
      unitPrice: 1,
      qty: 1000,
      unit: 'unit',
    }));
    const orderId = appendProcurementOrderEntry({
      lines: orderLines,
      totalAmount: orderLines.length * 1000,
      payableAmount: orderLines.length * 1000,
      actorRole: 'franchisee',
      orderDateYmd: basisYmd,
    });

    const snapshotLines = Object.fromEntries(
      orderLines.flatMap((line) => [
        [line.productId, { out: '1000', remain: '0' }],
        [line.name, { out: '1000', remain: '500' }],
      ]),
    );
    expect(
      setOrderStallCountStamp(orderId, {
        basisYmd,
        completedAt: `${basisYmd}T18:00:00.000Z`,
        snapshot: {
          lines: snapshotLines,
          actualRevenue: '0',
          updatedAt: `${basisYmd}T18:00:00.000Z`,
        },
      }),
    ).toBe(true);

    const display = loadStallSalesDisplayFromBasisOrder(orderId);
    const cart = Object.fromEntries(items.map((item) => [item.id, 2000]));
    const deducted = cartAfterDeductingStallRemainFromOrder(cart, orderId);

    for (const item of items) {
      expect(Number(display.lines[item.id]?.remain), item.name).toBe(500);
      expect(deducted[item.id], item.name).toBe(1500);
    }
  });
});
