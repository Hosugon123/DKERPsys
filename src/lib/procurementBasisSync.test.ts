/**
 * 次日批貨「扣參考單剩餘」與訂單調整後資料同步 — 回歸測試
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cartAfterDeductingStallRemainFromOrder,
  computeStallOutImportBreakdown,
  loadDay,
  loadDayForProcurement,
  loadDayForProcurementFromOrder,
  loadStallSalesDisplayFromBasisOrder,
  loadBasisOrderRemainForProcurementDeduction,
  recomputeStallOutForStallYmdAndOrder,
  buildProcurementRemainDeductionsFromLines,
  ensureBasisDayFromOrderSnapshot,
  saveDay,
  applyOrderDeductionToDayRemain,
  getOrderStallCountBasisYmdForDeduction,
  syncBasisDayFromOrderSnapshot,
} from './stallInventoryStorage';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import {
  appendProcurementOrderEntry,
  readMergedOrderByIdFromStores,
} from './orderHistoryStorage';
import { resolveOrderStallStorageScopeId } from './scopedStallDateKey';

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

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

let orderSeq = 0;
vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => `PROC-TEST-${++orderSeq}`,
}));

const ORDER_ID = 'order-basis-test-1';
const BASIS_YMD = '2026-05-20';

/** 模擬 apiService.appendProcurementOrderEntry 之扣庫＋建單 */
function simulateProcurementCheckout(params: {
  lines: { productId: string; name: string; unitPrice: number; qty: number; unit: string }[];
  totalAmount: number;
  orderDateYmd: string;
  procurementDeductionBasisOrderId?: string;
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
    ...params,
    payableAmount: params.totalAmount,
    actorRole: 'admin',
  });
}

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
    orderSeq = 0;
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

  it('叫貨扣庫後 loadDayForProcurementFromOrder 讀即時剩餘，非凍結快照', () => {
    seedCompletedOrderWithSnapshot(10);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '5' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    const snap = loadDayForProcurementFromOrder(ORDER_ID);
    expect(Number(snap.lines[PRODUCT_ID]?.remain)).toBe(5);
  });

  it('帳上售出顯示用 loadStallSalesDisplayFromBasisOrder 仍讀凍結快照 remain', () => {
    seedCompletedOrderWithSnapshot(10);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '0' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T19:00:00.000Z`,
    });
    expect(Number(loadDayForProcurementFromOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(0);
    expect(Number(loadStallSalesDisplayFromBasisOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(10);
  });

  it('扣盤點剩：即時 remain 未填時退回凍結快照', () => {
    seedCompletedOrderWithSnapshot(7);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T19:00:00.000Z`,
    });
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(7);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 10 }, ORDER_ID)[PRODUCT_ID]).toBe(3);
  });

  it('扣盤點剩：即時 remain 為 0（已透過叫貨單扣庫）時池子用盡', () => {
    seedCompletedOrderWithSnapshot(10);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '10' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '10' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    simulateProcurementCheckout({
      lines: [{ productId: PRODUCT_ID, name: '測試品項', unitPrice: 100, qty: 10, unit: '隻' }],
      totalAmount: 1000,
      orderDateYmd: '2026-06-15',
      procurementDeductionBasisOrderId: ORDER_ID,
    });
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 10 }, ORDER_ID)[PRODUCT_ID]).toBe(10);
  });

  it('扣盤點剩：即時 remain 為 0 但凍結快照仍有餘且尚無叫貨扣庫（黑輪情境）', () => {
    seedCompletedOrderWithSnapshot(11);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '150', remain: '0' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '150', remain: '0' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, ORDER_ID)[PRODUCT_ID]).toBe(189);
  });

  it('扣盤點剩：銷售紀錄為 0 但攤上日庫仍有餘時可扣減', () => {
    seedCompletedOrderWithSnapshot(57);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '250', remain: '0' } },
      actualRevenue: '7558',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '250', remain: '57' } },
      actualRevenue: '7558',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 250 }, ORDER_ID)[PRODUCT_ID]).toBe(193);
  });

  it('植入帶出：扣庫後參考剩餘＋叫貨，不重複加凍結快照', () => {
    const BASIS_ORDER = 'basis-order-1';
    const NEW_ORDER = 'new-order-1';
    const NEXT_YMD = '2026-05-21';
    const basis = {
      id: BASIS_ORDER,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 10,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 10, unitPrice: 100, unit: '隻' }],
      actorRole: 'employee' as const,
      scopeId: 'scope:hq',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: { [PRODUCT_ID]: { out: '20', remain: '10' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([basis]));
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '10' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    const newOrder = {
      id: NEW_ORDER,
      createdAt: `${NEXT_YMD}T08:00:00.000Z`,
      orderDateYmd: NEXT_YMD,
      updatedAt: `${NEXT_YMD}T08:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 500,
      payableAmount: 500,
      itemCount: 5,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 5, unitPrice: 100, unit: '隻' }],
      actorRole: 'employee' as const,
      scopeId: 'scope:hq',
      procurementDeductionBasisOrderId: BASIS_ORDER,
    };
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([basis, newOrder]),
    );
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '5' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T19:00:00.000Z`,
    });
    recomputeStallOutForStallYmdAndOrder(NEXT_YMD, NEW_ORDER, undefined, { clearRemain: true });
    expect(Number(loadDay(NEXT_YMD).lines[PRODUCT_ID]?.out)).toBe(10);
  });

  it('完整流程：批貨扣庫後植入帶出＝即時參考剩餘＋本單叫貨', () => {
    const BASIS_ORDER = 'basis-order-e2e';
    const NEW_ORDER = 'new-order-e2e';
    const NEXT_YMD = '2026-05-22';
    const basis = {
      id: BASIS_ORDER,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 10,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 10, unitPrice: 100, unit: '隻' }],
      actorRole: 'employee' as const,
      scopeId: 'scope:hq',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: { [PRODUCT_ID]: { out: '20', remain: '8' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([basis]));
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '20', remain: '8' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });

    const newOrder = {
      id: NEW_ORDER,
      createdAt: `${NEXT_YMD}T08:00:00.000Z`,
      orderDateYmd: NEXT_YMD,
      updatedAt: `${NEXT_YMD}T08:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 500,
      payableAmount: 500,
      itemCount: 5,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 5, unitPrice: 100, unit: '隻' }],
      actorRole: 'employee' as const,
      scopeId: 'scope:hq',
      procurementDeductionBasisOrderId: BASIS_ORDER,
    };
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([basis, newOrder]),
    );

    applyOrderDeductionToDayRemain(BASIS_YMD, { [PRODUCT_ID]: 5 }, 'scope:hq');

    expect(Number(loadDayForProcurementFromOrder(BASIS_ORDER).lines[PRODUCT_ID]?.remain)).toBe(3);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 10 }, BASIS_ORDER)[PRODUCT_ID]).toBe(7);

    const breakdown = computeStallOutImportBreakdown(NEXT_YMD, NEW_ORDER);
    const row = breakdown?.rows.find((r) => r.productId === PRODUCT_ID);
    expect(breakdown?.chainsPriorStallRemain).toBe(true);
    expect(breakdown?.carrySource).toEqual({ kind: 'basis_order', orderId: BASIS_ORDER });
    expect(row?.prevRemain).toBe(3);
    expect(row?.orderQty).toBe(5);
    expect(row?.suggestedOut).toBe(8);

    const implanted = recomputeStallOutForStallYmdAndOrder(NEXT_YMD, NEW_ORDER, undefined, {
      clearRemain: true,
      persist: false,
    });
    expect(Number(implanted.lines[PRODUCT_ID]?.out)).toBe(8);
  });

  it('完整流程（回歸）：銷售紀錄 remain 未填→常用扣餘→送單扣庫→植入帶出', () => {
    const NEXT_YMD = '2026-06-15';
    const FAVORITE_QTY = 250;
    const SNAPSHOT_REMAIN = 57;
    const EXPECTED_CART = FAVORITE_QTY - SNAPSHOT_REMAIN;

    seedCompletedOrderWithSnapshot(SNAPSHOT_REMAIN);

    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '250', remain: '' } },
      actualRevenue: '7558',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });

    expect(Number(loadStallSalesDisplayFromBasisOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(
      SNAPSHOT_REMAIN,
    );
    expect(Number(loadDayForProcurementFromOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(0);
    expect(
      Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain),
    ).toBe(SNAPSHOT_REMAIN);

    const favoriteCart = cartAfterDeductingStallRemainFromOrder(
      { [PRODUCT_ID]: FAVORITE_QTY },
      ORDER_ID,
    );
    expect(favoriteCart[PRODUCT_ID]).toBe(EXPECTED_CART);

    const manualCart = cartAfterDeductingStallRemainFromOrder(
      { [PRODUCT_ID]: FAVORITE_QTY },
      ORDER_ID,
    );
    expect(manualCart[PRODUCT_ID]).toBe(EXPECTED_CART);

    const newOrderId = simulateProcurementCheckout({
      lines: [
        {
          productId: PRODUCT_ID,
          name: '測試品項',
          unitPrice: 100,
          qty: EXPECTED_CART,
          unit: '隻',
        },
      ],
      totalAmount: EXPECTED_CART * 100,
      orderDateYmd: NEXT_YMD,
      procurementDeductionBasisOrderId: ORDER_ID,
    });

    expect(Number(loadDayForProcurementFromOrder(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(0);
    expect(Number(getSalesRecord(BASIS_YMD)?.lines[PRODUCT_ID]?.remain)).toBe(0);
    expect(Number(readMergedOrderByIdFromStores(ORDER_ID)?.stallCountSnapshot?.lines[PRODUCT_ID]?.remain)).toBe(
      SNAPSHOT_REMAIN,
    );

    const breakdown = computeStallOutImportBreakdown(NEXT_YMD, newOrderId);
    const row = breakdown?.rows.find((r) => r.productId === PRODUCT_ID);
    expect(breakdown?.chainsPriorStallRemain).toBe(true);
    expect(breakdown?.carrySource).toEqual({ kind: 'basis_order', orderId: ORDER_ID });
    expect(row?.prevRemain).toBe(SNAPSHOT_REMAIN);
    expect(row?.orderQty).toBe(EXPECTED_CART);
    expect(row?.suggestedOut).toBe(FAVORITE_QTY);

    const implanted = recomputeStallOutForStallYmdAndOrder(NEXT_YMD, newOrderId, undefined, {
      clearRemain: true,
      persist: false,
    });
    expect(Number(implanted.lines[PRODUCT_ID]?.out)).toBe(FAVORITE_QTY);
  });

  it('扣盤點剩：快照以品名為 key 時仍可扣減', () => {
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
        lines: { '測試品項': { out: '150', remain: '11' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    const without = orders.filter((o) => o.id !== ORDER_ID);
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([...without, base]));
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT_ID]: { out: '150', remain: '0' } },
      actualRevenue: '5000',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    });
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, ORDER_ID)[PRODUCT_ID]).toBe(189);
  });

  it('扣盤點剩：加盟 scope 快照 id 列 remain=0 但品名 key 仍有餘', () => {
    const FRANCHISE_SCOPE = 'scope:franchisee:fr-basis-1';
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
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'fr-basis-1',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: {
          [PRODUCT_ID]: { out: '', remain: '0' },
          '測試品項': { out: '150', remain: '11' },
        },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([base]));
    saveSalesRecord(
      BASIS_YMD,
      {
        lines: { [PRODUCT_ID]: { out: '150', remain: '0' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
      FRANCHISE_SCOPE,
    );
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, ORDER_ID)[PRODUCT_ID]).toBe(189);
  });

  it('扣盤點剩：id 列有帶出但 remain=0 時改讀品名 remain（dk002 類資料）', () => {
    const FRANCHISE_SCOPE = 'scope:franchisee:fr-dk002-like';
    const base = {
      id: '002202606041',
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 8000,
      payableAmount: 8000,
      itemCount: 80,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 80, unitPrice: 100, unit: '隻' }],
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'fr-dk002-like',
      storeLabel: '高雄三民',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: {
          [PRODUCT_ID]: { out: '150', remain: '0' },
          '測試品項': { out: '150', remain: '11' },
        },
        actualRevenue: '7143',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([base]));
    expect(Number(loadStallSalesDisplayFromBasisOrder('002202606041').lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(Number(loadStallSalesDisplayFromBasisOrder('002202606041').lines[PRODUCT_ID]?.out)).toBe(150);
    expect(Number(loadBasisOrderRemainForProcurementDeduction('002202606041').lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, '002202606041')[PRODUCT_ID]).toBe(189);
    ensureBasisDayFromOrderSnapshot('002202606041');
    applyOrderDeductionToDayRemain(BASIS_YMD, { [PRODUCT_ID]: 5 }, FRANCHISE_SCOPE);
    expect(Number(loadDayForProcurementFromOrder('002202606041').lines[PRODUCT_ID]?.remain)).toBe(6);
    expect(Number(getSalesRecord(BASIS_YMD, FRANCHISE_SCOPE)?.lines[PRODUCT_ID]?.remain)).toBe(6);
  });

  it('deducts by productId when the frozen snapshot uses the order line legacy name', () => {
    const ORDER_ALIAS = 'order-alias-name-1';
    const LEGACY_NAME = 'legacy duck alias';
    const base = {
      id: ORDER_ALIAS,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 1,
      lines: [{ productId: PRODUCT_ID, name: LEGACY_NAME, qty: 10, unitPrice: 100, unit: 'unit' }],
      actorRole: 'franchisee' as const,
      scopeId: 'scope:franchisee:alias-1',
      actorUserId: 'alias-1',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: {
          [PRODUCT_ID]: { out: '150', remain: '0' },
          [LEGACY_NAME]: { out: '150', remain: '9' },
        },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([base]));

    expect(Number(loadStallSalesDisplayFromBasisOrder(ORDER_ALIAS).lines[PRODUCT_ID]?.remain)).toBe(9);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 20 }, ORDER_ALIAS)[PRODUCT_ID]).toBe(11);

    const toDeduct = buildProcurementRemainDeductionsFromLines(ORDER_ALIAS, [
      { productId: PRODUCT_ID, name: LEGACY_NAME, qty: 6 },
    ]);
    expect(toDeduct[PRODUCT_ID]).toBe(6);
  });

  it('扣盤點剩：僅扣同 scope 已送單之扣庫量，不含總部單', () => {
    const FRANCHISE_SCOPE = 'scope:franchisee:fr-basis-2';
    const franchiseBasis = {
      id: ORDER_ID,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 1,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 10, unitPrice: 100, unit: '隻' }],
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'fr-basis-2',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: { [PRODUCT_ID]: { out: '20', remain: '11' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    const hqChild = {
      id: 'hq-child-against-franchise-basis',
      createdAt: `${BASIS_YMD}T22:00:00.000Z`,
      orderDateYmd: '2026-06-16',
      updatedAt: `${BASIS_YMD}T22:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 500,
      payableAmount: 500,
      itemCount: 11,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 11, unitPrice: 100, unit: '隻' }],
      actorRole: 'admin' as const,
      scopeId: 'scope:hq',
      procurementDeductionBasisOrderId: ORDER_ID,
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([franchiseBasis, hqChild]));
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, ORDER_ID)[PRODUCT_ID]).toBe(189);
  });

  it('扣盤點剩：盤點完成前送出的子單不佔用可扣池', () => {
    const FRANCHISE_SCOPE = 'scope:franchisee:fr-basis-early-child';
    const franchiseBasis = {
      id: ORDER_ID,
      createdAt: `${BASIS_YMD}T10:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T12:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 1000,
      payableAmount: 1000,
      itemCount: 1,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 10, unitPrice: 100, unit: '隻' }],
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'fr-basis-early-child',
      stallCountBasisYmd: BASIS_YMD,
      stallCountCompletedAt: `${BASIS_YMD}T18:00:00.000Z`,
      stallCountSnapshot: {
        lines: { [PRODUCT_ID]: { out: '20', remain: '11' } },
        actualRevenue: '5000',
        updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
      },
    };
    const earlyChild = {
      id: 'child-before-stall-count',
      createdAt: `${BASIS_YMD}T17:00:00.000Z`,
      orderDateYmd: BASIS_YMD,
      updatedAt: `${BASIS_YMD}T17:00:00.000Z`,
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 500,
      payableAmount: 500,
      itemCount: 11,
      lines: [{ productId: PRODUCT_ID, name: '測試品項', qty: 11, unitPrice: 100, unit: '隻' }],
      actorRole: 'franchisee' as const,
      scopeId: FRANCHISE_SCOPE,
      actorUserId: 'fr-basis-early-child',
      procurementDeductionBasisOrderId: ORDER_ID,
    };
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([franchiseBasis, earlyChild]));
    expect(Number(loadBasisOrderRemainForProcurementDeduction(ORDER_ID).lines[PRODUCT_ID]?.remain)).toBe(11);
    expect(cartAfterDeductingStallRemainFromOrder({ [PRODUCT_ID]: 200 }, ORDER_ID)[PRODUCT_ID]).toBe(189);
  });
});
