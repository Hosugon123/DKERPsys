import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSalesRecord } from './salesRecordStorage';
import { computeProcurementWeekdaySoldReference } from './procurementWeekdayReference';
import type { OrderHistoryEntry } from './orderHistoryStorage';

const FRANCHISE_SCOPE = 'scope:franchisee:dk-ref-test';
const HQ_SCOPE = 'scope:hq';
const THURSDAY_A = '2026-05-07';
const THURSDAY_B = '2026-05-14';
const ORDER_DATE = '2026-06-18';

const mockCtx = {
  role: 'franchisee' as 'franchisee' | 'employee' | 'admin' | 'unknown',
  userId: 'dk-ref-test',
  scopeId: 'scope:franchisee:dk-ref-test',
  isAdmin: false,
};

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => mockCtx,
  franchiseeOwnerUserIdFromScopeId: (scopeId: string | undefined) =>
    String(scopeId ?? '').startsWith('scope:franchisee:')
      ? String(scopeId).slice('scope:franchisee:'.length)
      : null,
  resolveFranchiseeRetailOwnerUserId: () =>
    mockCtx.scopeId === 'scope:hq' ? null : 'dk-ref-test',
  HQ_SCOPE_ID: 'scope:hq',
}));

const PRODUCT_ID = 's01';

function stallOrder(
  params: {
    id: string;
    rowYmd: string;
    completedAt: string;
    remain: string;
    out?: string;
  },
  scope: {
    actorRole: OrderHistoryEntry['actorRole'];
    scopeId: string;
    actorUserId: string;
    storeLabel: string;
  },
): OrderHistoryEntry {
  const out = params.out ?? '200';
  return {
    id: params.id,
    createdAt: `${params.rowYmd}T10:00:00.000Z`,
    orderDateYmd: params.rowYmd,
    updatedAt: `${params.rowYmd}T12:00:00.000Z`,
    source: 'procurement',
    status: '已完成',
    totalAmount: 1000,
    payableAmount: 1000,
    itemCount: 200,
    lines: [{ productId: PRODUCT_ID, name: '黑輪', qty: 200, unitPrice: 5, unit: '份' }],
    actorRole: scope.actorRole,
    storeLabel: scope.storeLabel,
    scopeId: scope.scopeId,
    actorUserId: scope.actorUserId,
    stallCountBasisYmd: params.rowYmd,
    stallCountCompletedAt: params.completedAt,
    stallCountSnapshot: {
      lines: {
        [PRODUCT_ID]: { out, remain: params.remain },
        黑輪: { out, remain: params.remain },
      },
      actualRevenue: '1000',
      updatedAt: params.completedAt,
    },
  };
}

const franchiseScope = {
  actorRole: 'franchisee' as const,
  scopeId: FRANCHISE_SCOPE,
  actorUserId: 'dk-ref-test',
  storeLabel: '加盟測試店',
};

const hqScope = {
  actorRole: 'employee' as const,
  scopeId: HQ_SCOPE,
  actorUserId: 'hq-emp-1',
  storeLabel: '直營',
};

describe('procurement weekday sold reference', () => {
  beforeEach(() => {
    mockCtx.role = 'franchisee';
    mockCtx.userId = 'dk-ref-test';
    mockCtx.scopeId = FRANCHISE_SCOPE;
    mockCtx.isAdmin = false;
    localStorage.clear();
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  });

  it('最高：同日多張盤點單不累加售出量', () => {
    const orders = [
      stallOrder(
        {
          id: 'order-thu-a-1',
          rowYmd: THURSDAY_A,
          completedAt: `${THURSDAY_A}T18:00:00.000Z`,
          remain: '20',
        },
        franchiseScope,
      ),
      stallOrder(
        {
          id: 'order-thu-a-2',
          rowYmd: THURSDAY_A,
          completedAt: `${THURSDAY_A}T19:00:00.000Z`,
          remain: '20',
        },
        franchiseScope,
      ),
      stallOrder(
        {
          id: 'order-thu-b-1',
          rowYmd: THURSDAY_B,
          completedAt: `${THURSDAY_B}T18:00:00.000Z`,
          remain: '60',
        },
        franchiseScope,
      ),
    ];

    const ref = computeProcurementWeekdaySoldReference(ORDER_DATE, orders, 'headquarter', 'max');
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(180);
    expect(ref.referenceYmd).toBe(THURSDAY_A);
  });

  it('最高：有銷售紀錄時以銷售紀錄為準，不疊加訂單快照', () => {
    saveSalesRecord(
      THURSDAY_A,
      {
        lines: { [PRODUCT_ID]: { out: '200', remain: '50' } },
        actualRevenue: '1200',
        updatedAt: `${THURSDAY_A}T18:00:00.000Z`,
      },
      FRANCHISE_SCOPE,
    );
    const orders = [
      stallOrder(
        {
          id: 'order-thu-a-old',
          rowYmd: THURSDAY_A,
          completedAt: `${THURSDAY_A}T17:00:00.000Z`,
          remain: '10',
        },
        franchiseScope,
      ),
    ];

    const ref = computeProcurementWeekdaySoldReference(ORDER_DATE, orders, 'headquarter', 'max');
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(150);
  });

  it('平均：跨多個週四取售出量平均', () => {
    const orders = [
      stallOrder(
        {
          id: 'order-thu-a',
          rowYmd: THURSDAY_A,
          completedAt: `${THURSDAY_A}T18:00:00.000Z`,
          remain: '20',
        },
        franchiseScope,
      ),
      stallOrder(
        {
          id: 'order-thu-b',
          rowYmd: THURSDAY_B,
          completedAt: `${THURSDAY_B}T18:00:00.000Z`,
          remain: '60',
        },
        franchiseScope,
      ),
    ];

    const ref = computeProcurementWeekdaySoldReference(ORDER_DATE, orders, 'headquarter', 'avg');
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(160);
    expect(ref.sampleDayCount).toBe(2);
  });

  it('最高：取營業額最高那一天的各品項售出（非跨日混算）', () => {
    const PRODUCT_B = 's02';
    const thuAHigh = stallOrder(
      {
        id: 'order-thu-a-high',
        rowYmd: THURSDAY_A,
        completedAt: `${THURSDAY_A}T18:00:00.000Z`,
        remain: '100',
        out: '200',
      },
      franchiseScope,
    );
    thuAHigh.stallCountSnapshot = {
      lines: {
        [PRODUCT_ID]: { out: '200', remain: '100' },
        [PRODUCT_B]: { out: '200', remain: '190' },
      },
      actualRevenue: '8000',
      updatedAt: `${THURSDAY_A}T18:00:00.000Z`,
    };
    const thuBLow = stallOrder(
      {
        id: 'order-thu-b-low',
        rowYmd: THURSDAY_B,
        completedAt: `${THURSDAY_B}T18:00:00.000Z`,
        remain: '10',
        out: '200',
      },
      franchiseScope,
    );
    thuBLow.stallCountSnapshot = {
      lines: {
        [PRODUCT_ID]: { out: '200', remain: '10' },
        [PRODUCT_B]: { out: '200', remain: '50' },
      },
      actualRevenue: '3000',
      updatedAt: `${THURSDAY_B}T18:00:00.000Z`,
    };

    const ref = computeProcurementWeekdaySoldReference(
      ORDER_DATE,
      [thuAHigh, thuBLow],
      'headquarter',
      'max',
    );
    expect(ref.referenceYmd).toBe(THURSDAY_A);
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(100);
    expect(ref.soldByProductId.get(PRODUCT_B)).toBe(10);
  });

  it('最高：直營帳號不納入加盟店盤點（僅該店最高）', () => {
    mockCtx.role = 'employee';
    mockCtx.userId = 'hq-emp-1';
    mockCtx.scopeId = HQ_SCOPE;

    const orders = [
      stallOrder(
        {
          id: 'franchise-thu-high',
          rowYmd: THURSDAY_A,
          completedAt: `${THURSDAY_A}T18:00:00.000Z`,
          remain: '20',
          out: '380',
        },
        franchiseScope,
      ),
      stallOrder(
        {
          id: 'hq-thu-lower',
          rowYmd: THURSDAY_B,
          completedAt: `${THURSDAY_B}T18:00:00.000Z`,
          remain: '80',
          out: '200',
        },
        hqScope,
      ),
    ];

    const ref = computeProcurementWeekdaySoldReference(ORDER_DATE, orders, 'headquarter', 'max');
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(120);
    expect(ref.referenceYmd).toBe(THURSDAY_B);
  });

  it('最高：未填實收時改用零售推估營業額，不用總售出數量排序', () => {
    const HIGH_PRICE_PRODUCT = 's20';
    const lowRevenueHighQty = stallOrder(
      {
        id: 'order-thu-a-low-revenue-high-qty',
        rowYmd: THURSDAY_A,
        completedAt: `${THURSDAY_A}T18:00:00.000Z`,
        remain: '0',
        out: '200',
      },
      franchiseScope,
    );
    lowRevenueHighQty.stallCountSnapshot = {
      lines: {
        [PRODUCT_ID]: { out: '200', remain: '0' },
      },
      actualRevenue: '',
      updatedAt: `${THURSDAY_A}T18:00:00.000Z`,
    };
    const highRevenueLowerQty = stallOrder(
      {
        id: 'order-thu-b-high-revenue-lower-qty',
        rowYmd: THURSDAY_B,
        completedAt: `${THURSDAY_B}T18:00:00.000Z`,
        remain: '0',
        out: '120',
      },
      franchiseScope,
    );
    highRevenueLowerQty.stallCountSnapshot = {
      lines: {
        [HIGH_PRICE_PRODUCT]: { out: '120', remain: '0' },
      },
      actualRevenue: '',
      updatedAt: `${THURSDAY_B}T18:00:00.000Z`,
    };

    const ref = computeProcurementWeekdaySoldReference(
      ORDER_DATE,
      [lowRevenueHighQty, highRevenueLowerQty],
      'headquarter',
      'max',
    );

    expect(ref.referenceYmd).toBe(THURSDAY_B);
    expect(ref.soldByProductId.get(HIGH_PRICE_PRODUCT)).toBe(120);
    expect(ref.soldByProductId.has(PRODUCT_ID)).toBe(false);
  });

  it('最低：未填實收時同樣以零售推估營業額選日', () => {
    const HIGH_PRICE_PRODUCT = 's20';
    const lowRevenueHighQty = stallOrder(
      {
        id: 'order-thu-a-low-revenue-high-qty',
        rowYmd: THURSDAY_A,
        completedAt: `${THURSDAY_A}T18:00:00.000Z`,
        remain: '0',
        out: '200',
      },
      franchiseScope,
    );
    lowRevenueHighQty.stallCountSnapshot = {
      lines: {
        [PRODUCT_ID]: { out: '200', remain: '0' },
      },
      actualRevenue: '',
      updatedAt: `${THURSDAY_A}T18:00:00.000Z`,
    };
    const highRevenueLowerQty = stallOrder(
      {
        id: 'order-thu-b-high-revenue-lower-qty',
        rowYmd: THURSDAY_B,
        completedAt: `${THURSDAY_B}T18:00:00.000Z`,
        remain: '0',
        out: '120',
      },
      franchiseScope,
    );
    highRevenueLowerQty.stallCountSnapshot = {
      lines: {
        [HIGH_PRICE_PRODUCT]: { out: '120', remain: '0' },
      },
      actualRevenue: '',
      updatedAt: `${THURSDAY_B}T18:00:00.000Z`,
    };

    const ref = computeProcurementWeekdaySoldReference(
      ORDER_DATE,
      [lowRevenueHighQty, highRevenueLowerQty],
      'headquarter',
      'min',
    );

    expect(ref.referenceYmd).toBe(THURSDAY_A);
    expect(ref.soldByProductId.get(PRODUCT_ID)).toBe(200);
    expect(ref.soldByProductId.has(HIGH_PRICE_PRODUCT)).toBe(false);
  });
});
