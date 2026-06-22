import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  readMergedOrderByIdFromStores,
  setOrderStallCountStamp,
  updateProcurementDeductionBasisOrderIdInEitherStore,
} from './orderHistoryStorage';
import {
  buildProcurementRemainDeductionsFromLines,
  cartAfterDeductingStallRemainFromOrder,
  computeStallOutImportBreakdown,
  ensureBasisDayFromOrderSnapshot,
  applyOrderDeductionToDayRemain,
  getOrderStallCountBasisYmdForDeduction,
  loadBasisOrderRemainForProcurementDeduction,
  loadStallSalesDisplayFromBasisOrder,
  recomputeStallOutForStallYmdAndOrder,
} from './stallInventoryStorage';
import { resolveOrderStallStorageScopeId } from './scopedStallDateKey';
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

const FRANCHISE_SCOPE = 'scope:franchisee:dk002-test';
const BASIS_YMD = '2026-06-14';
const NEXT_YMD = '2026-06-15';

function simulateProcurementCheckout(params: {
  lines: { productId: string; name: string; unitPrice: number; qty: number; unit: string }[];
  totalAmount: number;
  orderDateYmd: string;
  procurementDeductionBasisOrderId?: string;
  createdAt?: string;
}) {
  const basisOrderId = params.procurementDeductionBasisOrderId?.trim() ?? '';
  const basisYmd = getOrderStallCountBasisYmdForDeduction(basisOrderId);
  if (basisYmd) {
    const basisOrder = basisOrderId ? readMergedOrderByIdFromStores(basisOrderId) : null;
    const scopeId = basisOrder ? resolveOrderStallStorageScopeId(basisOrder) : undefined;
    const toDeduct = buildProcurementRemainDeductionsFromLines(
      basisOrderId,
      params.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty })),
    );
    if (Object.keys(toDeduct).length > 0) {
      ensureBasisDayFromOrderSnapshot(basisOrderId);
      applyOrderDeductionToDayRemain(basisYmd, toDeduct, scopeId);
    }
  }
  return appendProcurementOrderEntry({
    lines: params.lines,
    totalAmount: params.totalAmount,
    payableAmount: params.totalAmount,
    actorRole: 'franchisee',
    orderDateYmd: params.orderDateYmd,
    procurementDeductionBasisOrderId: params.procurementDeductionBasisOrderId,
  });
}

function buildDk002LikeSnapshotLines(
  items: ReturnType<typeof getAllSupplyItems>,
  remain: number,
) {
  return Object.fromEntries(
    items.flatMap((item) => [
      [item.id, { out: '1000', remain: '0' }],
      [item.name, { out: '1000', remain: String(remain) }],
    ]),
  );
}

describe('procurement cart deduction across every catalog item', () => {
  beforeEach(() => {
    orderSeq = 0;
    localStorage.clear();
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  });

  it('deducts 500 remain from a 2000 cart for every non-consumable item (legacy name keys)', () => {
    const items = getAllSupplyItems().filter((item) => !isConsumableItem(item));
    expect(items.length).toBeGreaterThan(10);

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
      orderDateYmd: BASIS_YMD,
    });

    const snapshotLines = Object.fromEntries(
      orderLines.flatMap((line) => [
        [line.productId, { out: '1000', remain: '0' }],
        [line.name, { out: '1000', remain: '500' }],
      ]),
    );
    expect(
      setOrderStallCountStamp(orderId, {
        basisYmd: BASIS_YMD,
        completedAt: `${BASIS_YMD}T18:00:00.000Z`,
        snapshot: {
          lines: snapshotLines,
          actualRevenue: '0',
          updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
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

  it('allows a submitted order to deduct prior completed remain afterward without double-counting itself', () => {
    const item = getAllSupplyItems().find((x) => !isConsumableItem(x));
    expect(item).toBeTruthy();
    if (!item) return;

    const basisId = appendProcurementOrderEntry({
      lines: [{ productId: item.id, name: item.name, unitPrice: 1, qty: 10, unit: item.pieceUnit }],
      totalAmount: 10,
      payableAmount: 10,
      actorRole: 'franchisee',
      orderDateYmd: BASIS_YMD,
    });
    const snap = {
      lines: { [item.id]: { out: '10', remain: '4' } },
      actualRevenue: '0',
      updatedAt: '2026-06-14T21:00:00.000Z',
    };
    expect(
      setOrderStallCountStamp(basisId, {
        basisYmd: BASIS_YMD,
        completedAt: '2026-06-14T21:00:00.000Z',
        snapshot: snap,
      }),
    ).toBe(true);

    const childId = appendProcurementOrderEntry({
      lines: [{ productId: item.id, name: item.name, unitPrice: 1, qty: 3, unit: item.pieceUnit }],
      totalAmount: 3,
      payableAmount: 3,
      actorRole: 'franchisee',
      orderDateYmd: NEXT_YMD,
    });

    expect(updateProcurementDeductionBasisOrderIdInEitherStore(childId, basisId)).toEqual({
      ok: true,
    });
    const toDeduct = buildProcurementRemainDeductionsFromLines(
      basisId,
      [{ productId: item.id, name: item.name, qty: 3 }],
      { excludeOrderId: childId },
    );
    expect(toDeduct[item.id]).toBe(3);
    ensureBasisDayFromOrderSnapshot(basisId);
    applyOrderDeductionToDayRemain(BASIS_YMD, toDeduct, FRANCHISE_SCOPE);

    expect(readMergedOrderByIdFromStores(childId)?.procurementDeductionBasisOrderId).toBe(basisId);
    expect(Number(loadBasisOrderRemainForProcurementDeduction(basisId).lines[item.id]?.remain)).toBe(1);
  });

  it('deducts 500 remain when snapshot uses catalog names (dk002 id remain=0 pattern)', () => {
    const items = getAllSupplyItems().filter((item) => !isConsumableItem(item));
    const orderLines = items.map((item) => ({
      productId: item.id,
      name: item.name,
      unitPrice: 1,
      qty: 1000,
      unit: 'unit',
    }));
    const orderId = appendProcurementOrderEntry({
      lines: orderLines,
      totalAmount: orderLines.length * 1000,
      payableAmount: orderLines.length * 1000,
      actorRole: 'franchisee',
      orderDateYmd: BASIS_YMD,
    });

    expect(
      setOrderStallCountStamp(orderId, {
        basisYmd: BASIS_YMD,
        completedAt: `${BASIS_YMD}T18:00:00.000Z`,
        snapshot: {
          lines: buildDk002LikeSnapshotLines(items, 500),
          actualRevenue: '0',
          updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
        },
      }),
    ).toBe(true);

    const cart = Object.fromEntries(items.map((item) => [item.id, 2000]));
    const deducted = cartAfterDeductingStallRemainFromOrder(cart, orderId);
    const pool = loadBasisOrderRemainForProcurementDeduction(orderId);
    for (const item of items) {
      expect(Number(pool.lines[item.id]?.remain), item.name).toBe(500);
      expect(deducted[item.id], item.name).toBe(1500);
    }
  });

  it('full flow: order 1000 → count remain 500 → next day cart 2000 deducts to 1500 and checkout', () => {
    const items = getAllSupplyItems().filter((item) => !isConsumableItem(item));
    const orderLines = items.map((item) => ({
      productId: item.id,
      name: item.name,
      unitPrice: 1,
      qty: 1000,
      unit: 'unit',
    }));
    const basisOrderId = appendProcurementOrderEntry({
      lines: orderLines,
      totalAmount: orderLines.length * 1000,
      payableAmount: orderLines.length * 1000,
      actorRole: 'franchisee',
      orderDateYmd: BASIS_YMD,
    });

    setOrderStallCountStamp(basisOrderId, {
      basisYmd: BASIS_YMD,
      completedAt: `${BASIS_YMD}T18:00:00.000Z`,
      snapshot: {
        lines: buildDk002LikeSnapshotLines(items, 500),
        actualRevenue: '0',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    });

    const cart2000 = Object.fromEntries(items.map((item) => [item.id, 2000]));
    const cart1500 = cartAfterDeductingStallRemainFromOrder(cart2000, basisOrderId);
    for (const item of items) {
      expect(cart1500[item.id], item.name).toBe(1500);
    }

    const checkoutLines = items.map((item) => ({
      productId: item.id,
      name: item.name,
      unitPrice: 1,
      qty: cart1500[item.id] ?? 0,
      unit: 'unit',
    }));
    const nextOrderId = simulateProcurementCheckout({
      lines: checkoutLines,
      totalAmount: checkoutLines.reduce((s, l) => s + l.qty, 0),
      orderDateYmd: NEXT_YMD,
      procurementDeductionBasisOrderId: basisOrderId,
    });

    const breakdown = computeStallOutImportBreakdown(NEXT_YMD, nextOrderId);
    const implanted = recomputeStallOutForStallYmdAndOrder(NEXT_YMD, nextOrderId, undefined, {
      clearRemain: true,
      persist: false,
    });
    for (const item of items) {
      const row = breakdown?.rows.find((r) => r.productId === item.id);
      expect(row?.orderQty, item.name).toBe(1500);
      expect(row?.prevRemain, item.name).toBe(500);
      expect(row?.suggestedOut, item.name).toBe(2000);
      expect(Number(implanted.lines[item.id]?.out), item.name).toBe(2000);
    }

    const poolAfter = loadBasisOrderRemainForProcurementDeduction(basisOrderId);
    for (const item of items) {
      expect(Number(poolAfter.lines[item.id]?.remain), item.name).toBe(0);
    }
    expect(cartAfterDeductingStallRemainFromOrder(cart2000, basisOrderId)).toEqual(cart2000);
  }, 10_000);

  it('ignores child orders placed before stall count completed (dk002 false pool depletion)', () => {
    const items = getAllSupplyItems().filter((item) => !isConsumableItem(item));
    const sample = items.slice(0, 5);
    const orderLines = sample.map((item) => ({
      productId: item.id,
      name: item.name,
      unitPrice: 1,
      qty: 1000,
      unit: 'unit',
    }));
    const basisOrderId = '002202606041';
    const basis = {
      id: basisOrderId,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: sample.length * 1000,
      payableAmount: sample.length * 1000,
      itemCount: sample.length,
      lines: orderLines,
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'dk002-test',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: buildDk002LikeSnapshotLines(sample, 500),
        actualRevenue: '0',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    const earlyChild = {
      id: '002202606051',
      createdAt: `${BASIS_YMD}T17:29:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T17:29:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: sample.length * 80,
      payableAmount: sample.length * 80,
      itemCount: sample.length,
      lines: sample.map((item) => ({
        productId: item.id,
        name: item.name,
        qty: 80,
        unitPrice: 1,
        unit: 'unit',
      })),
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'dk002-test',
      procurementDeductionBasisOrderId: basisOrderId,
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([basis, earlyChild]));

    const cart = Object.fromEntries(sample.map((item) => [item.id, 2000]));
    const deducted = cartAfterDeductingStallRemainFromOrder(cart, basisOrderId);
    for (const item of sample) {
      expect(deducted[item.id], item.name).toBe(1500);
    }
  });
});
