import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  listOrdersWithStallCountCompleted,
  loadOrderHistory,
  readMergedOrderByIdFromStores,
  type OrderHistoryEntry,
} from './orderHistoryStorage';
import { computeProcurementWeekdaySoldReference } from './procurementWeekdayReference';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import {
  applyOrderDeductionToDayRemain,
  cartAfterDeductingStallRemainFromOrder,
  loadDay,
  saveDay,
} from './stallInventoryStorage';
import { scopedStallDateKey } from './scopedStallDateKey';

const mockScope = vi.hoisted(() => ({
  role: 'franchisee' as 'admin' | 'franchisee' | 'employee' | 'unknown',
  userId: 'fr-a',
  scopeId: 'scope:franchisee:fr-a',
  isAdmin: false,
}));

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ ...mockScope }),
  HQ_SCOPE_ID: 'scope:hq',
  resolveAccountingLedgerScopeId: () => mockScope.scopeId,
  resolveFranchiseeRetailOwnerUserId: () =>
    mockScope.scopeId.startsWith('scope:franchisee:') ? mockScope.userId : null,
  franchiseeOwnerUserIdFromScopeId: (scopeId: string | undefined) => {
    const m = /^scope:franchisee:(.+)$/.exec(String(scopeId ?? ''));
    return m?.[1] ?? null;
  },
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => 'audit-user',
  resolveUserDisplayNameById: (id: string | undefined) => id ?? '',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '002',
  normalizeStoreCode3Digits: (s: string) => s.padStart(3, '0').slice(-3),
}));

let orderSeq = 0;
vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => `AUDIT-${++orderSeq}`,
}));

const PRODUCT = 's01';
const PRODUCT_B = 's02';
const SCOPE_A = 'scope:franchisee:fr-a';
const SCOPE_B = 'scope:franchisee:fr-b';
const HQ_SCOPE = 'scope:hq';
const BASIS_YMD = '2026-06-18';

function setCtx(scopeId: string, userId: string, role: typeof mockScope.role = 'franchisee') {
  mockScope.scopeId = scopeId;
  mockScope.userId = userId;
  mockScope.role = role;
  mockScope.isAdmin = role === 'admin';
}

function completedOrder(input: {
  id: string;
  scopeId: string;
  actorUserId: string;
  ymd: string;
  productId?: string;
  out: string;
  remain: string;
  qty?: number;
  unitPrice?: number;
  completedAt?: string;
}): OrderHistoryEntry {
  const productId = input.productId ?? PRODUCT;
  const qty = input.qty ?? Number(input.out);
  const unitPrice = input.unitPrice ?? 28;
  const completedAt = input.completedAt ?? `${input.ymd}T18:00:00.000Z`;
  return {
    id: input.id,
    createdAt: `${input.ymd}T10:00:00.000Z`,
    orderDateYmd: input.ymd,
    updatedAt: completedAt,
    source: 'procurement',
    totalAmount: qty * unitPrice,
    payableAmount: qty * unitPrice,
    itemCount: qty,
    lines: [{ productId, name: productId, unitPrice, qty, unit: 'unit' }],
    actorRole: 'franchisee',
    storeLabel: input.actorUserId,
    status: 'completed' as OrderHistoryEntry['status'],
    statusUpdatedAt: completedAt,
    scopeId: input.scopeId,
    actorUserId: input.actorUserId,
    stallCountBasisYmd: input.ymd,
    stallCountCompletedAt: completedAt,
    stallCountSnapshot: {
      lines: { [productId]: { out: input.out, remain: input.remain } },
      actualRevenue: String((Number(input.out) - Number(input.remain)) * 40),
      updatedAt: completedAt,
    },
  };
}

function seedEmptyStorage() {
  orderSeq = 0;
  localStorage.clear();
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem('dongshan_accounting_ledger_v1', JSON.stringify({ version: 2, byScope: {} }));
  localStorage.setItem('dongshan_deleted_order_ids_v1', JSON.stringify({ version: 1, byId: {} }));
  setCtx(SCOPE_A, 'fr-a');
}

describe('data integrity audit', () => {
  beforeEach(seedEmptyStorage);

  it('isolates order ownership by login scope', () => {
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([
        completedOrder({ id: 'order-a', scopeId: SCOPE_A, actorUserId: 'fr-a', ymd: BASIS_YMD, out: '20', remain: '2' }),
        completedOrder({ id: 'order-b', scopeId: SCOPE_B, actorUserId: 'fr-b', ymd: BASIS_YMD, out: '30', remain: '3' }),
        completedOrder({ id: 'order-hq', scopeId: HQ_SCOPE, actorUserId: 'admin', ymd: BASIS_YMD, out: '40', remain: '4' }),
      ]),
    );

    setCtx(SCOPE_A, 'fr-a');
    expect(loadOrderHistory().map((o) => o.id)).toEqual(['order-a']);
    expect(listOrdersWithStallCountCompleted().map((o) => o.id)).toEqual(['order-a']);

    setCtx(SCOPE_B, 'fr-b');
    expect(loadOrderHistory().map((o) => o.id)).toEqual(['order-b']);
    expect(listOrdersWithStallCountCompleted().map((o) => o.id)).toEqual(['order-b']);

    setCtx(HQ_SCOPE, 'admin', 'admin');
    expect(loadOrderHistory().map((o) => o.id).sort()).toEqual(['order-a', 'order-b', 'order-hq']);
  });

  it('deducts post-order carryover only from the selected store scope', () => {
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '50', remain: '12' } },
      actualRevenue: '1520',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_A);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '50', remain: '12' } },
      actualRevenue: '1520',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_A);
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '60', remain: '20' } },
      actualRevenue: '1600',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_B);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '60', remain: '20' } },
      actualRevenue: '1600',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_B);

    applyOrderDeductionToDayRemain(BASIS_YMD, { [PRODUCT]: 5 }, SCOPE_A);

    expect(Number(loadDay(BASIS_YMD, SCOPE_A).lines[PRODUCT]?.remain)).toBe(7);
    expect(Number(getSalesRecord(BASIS_YMD, SCOPE_A)?.lines[PRODUCT]?.remain)).toBe(7);
    expect(Number(loadDay(BASIS_YMD, SCOPE_B).lines[PRODUCT]?.remain)).toBe(20);
    expect(Number(getSalesRecord(BASIS_YMD, SCOPE_B)?.lines[PRODUCT]?.remain)).toBe(20);
  });

  it('keeps procurement quantity and payable amount based on carryover-deducted quantities', () => {
    const basis = completedOrder({
      id: 'basis-a',
      scopeId: SCOPE_A,
      actorUserId: 'fr-a',
      ymd: BASIS_YMD,
      out: '50',
      remain: '12',
      qty: 50,
      unitPrice: 28,
    });
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([basis]));

    setCtx(SCOPE_A, 'fr-a');
    const nextCart = cartAfterDeductingStallRemainFromOrder({ [PRODUCT]: 50 }, 'basis-a');
    expect(nextCart[PRODUCT]).toBe(38);

    const orderId = appendProcurementOrderEntry({
      lines: [{ productId: PRODUCT, name: PRODUCT, unitPrice: 28, qty: nextCart[PRODUCT]!, unit: 'unit' }],
      totalAmount: nextCart[PRODUCT]! * 28,
      payableAmount: nextCart[PRODUCT]! * 28,
      actorRole: 'franchisee',
      orderDateYmd: '2026-06-19',
      procurementDeductionBasisOrderId: 'basis-a',
    });
    const order = readMergedOrderByIdFromStores(orderId);

    expect(order?.scopeId).toBe(SCOPE_A);
    expect(order?.lines.find((l) => l.productId === PRODUCT)?.qty).toBe(38);
    expect(order?.totalAmount).toBe(1064);
    expect(order?.payableAmount).toBe(1064);
  });

  it('uses sales-record data as the single source for max avg min procurement references', () => {
    const thursdayA = '2026-06-18';
    const thursdayB = '2026-06-25';
    const orderDate = '2026-07-02';
    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([
        completedOrder({ id: 'wrong-a', scopeId: SCOPE_A, actorUserId: 'fr-a', ymd: thursdayA, out: '999', remain: '0' }),
        completedOrder({ id: 'wrong-b', scopeId: SCOPE_A, actorUserId: 'fr-a', ymd: thursdayB, out: '1', remain: '0' }),
      ]),
    );
    saveSalesRecord(thursdayA, {
      lines: {
        [PRODUCT]: { out: '197', remain: '0' },
        [PRODUCT_B]: { out: '20', remain: '5' },
      },
      actualRevenue: '8000',
      updatedAt: `${thursdayA}T18:00:00.000Z`,
    }, SCOPE_A);
    saveSalesRecord(thursdayB, {
      lines: {
        [PRODUCT]: { out: '150', remain: '10' },
        [PRODUCT_B]: { out: '60', remain: '0' },
      },
      actualRevenue: '9000',
      updatedAt: `${thursdayB}T18:00:00.000Z`,
    }, SCOPE_A);

    setCtx(SCOPE_A, 'fr-a');
    const orders = loadOrderHistory();
    const max = computeProcurementWeekdaySoldReference(orderDate, orders, 'headquarter', 'max', 3);
    const avg = computeProcurementWeekdaySoldReference(orderDate, orders, 'headquarter', 'avg', 3);
    const min = computeProcurementWeekdaySoldReference(orderDate, orders, 'headquarter', 'min', 3);

    expect(max.sampleDayCount).toBe(2);
    expect(max.soldByProductId.get(PRODUCT)).toBe(197);
    expect(max.soldByProductId.get(PRODUCT_B)).toBe(60);
    expect(avg.soldByProductId.get(PRODUCT)).toBe(168.5);
    expect(avg.soldByProductId.get(PRODUCT_B)).toBe(37.5);
    expect(min.soldByProductId.get(PRODUCT)).toBe(140);
    expect(min.soldByProductId.get(PRODUCT_B)).toBe(15);
  });

  it('keeps all scoped stall and sales records present after same-day multi-store writes', () => {
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '10', remain: '1' } },
      actualRevenue: '360',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_A);
    saveDay(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '20', remain: '2' } },
      actualRevenue: '720',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, SCOPE_B);
    saveSalesRecord(BASIS_YMD, {
      lines: { [PRODUCT]: { out: '30', remain: '3' } },
      actualRevenue: '1080',
      updatedAt: `${BASIS_YMD}T18:00:00.000Z`,
    }, HQ_SCOPE);

    const stallRaw = JSON.parse(localStorage.getItem('dongshan_stall_inventory_v1') ?? '{}') as {
      byDate?: Record<string, unknown>;
    };
    const salesRaw = JSON.parse(localStorage.getItem('dongshan_sales_records_v1') ?? '{}') as {
      byDate?: Record<string, unknown>;
    };

    expect(Object.keys(stallRaw.byDate ?? {}).sort()).toEqual([
      scopedStallDateKey(SCOPE_A, BASIS_YMD),
      scopedStallDateKey(SCOPE_B, BASIS_YMD),
    ].sort());
    expect(Object.keys(salesRaw.byDate ?? {}).sort()).toEqual([
      scopedStallDateKey(HQ_SCOPE, BASIS_YMD),
    ]);
  });
});
