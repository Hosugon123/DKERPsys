import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAdminDashboardFinanceForYmdRange } from './financeLib';
import type { OrderHistoryLine } from './orderHistoryStorage';

vi.mock('./orderHistoryStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./orderHistoryStorage')>();
  return {
    ...actual,
    loadFranchiseManagementOrders: () => [],
    loadOrderHistory: () => [
      {
        id: 'fr-order-mixed',
        createdAt: '2026-06-03T08:00:00.000Z',
        orderDateYmd: '2026-06-03',
        updatedAt: '2026-06-03T10:00:00.000Z',
        source: 'procurement' as const,
        status: '已完成' as const,
        totalAmount: 1060,
        payableAmount: 1060,
        itemCount: 11,
        lines: [
          {
            productId: 's17',
            name: '鴨頭',
            unitPrice: 100,
            qty: 10,
            unit: '隻',
          },
          {
            productId: 's26',
            name: '竹籤',
            unitPrice: 60,
            qty: 1,
            unit: '包',
          },
        ] as OrderHistoryLine[],
        actorRole: 'franchisee' as const,
        storeLabel: '加盟A',
        scopeId: 'scope:franchisee:fr-1',
      },
    ],
  };
});

vi.mock('./accountingLedgerStorage', () => ({
  listAccountingLedgerEntriesForScopeId: () => [],
  listAccountingLedgerEntriesForMonth: () => [],
  ingredientSubSpendBreakdownForMonth: () => ({ rows: [], totalIngredientExpense: 0 }),
  sumFoodExpenseCOGSAndSeasoningForMonth: () => ({ totalCOGS: 0, totalSeasoning: 0 }),
  isHeadquartersOperatingLedgerExpense: () => false,
  normalizeLedgerCategory: (c: string) => c,
}));

vi.mock('./directStoreOperatingExpense', () => ({
  computeDirectStoreOperatingExpense: () => ({
    procurementTotal: 0,
    ledgerExpenseTotal: 0,
    total: 0,
  }),
}));

vi.mock('./salesRecordStorage', () => ({
  getSalesRecord: () => null,
  mergeSalesRecordWithCatalog: (s: unknown) => s,
}));

describe('computeAdminDashboardFinanceForYmdRange consumable split', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('加盟批貨營收排除消耗品，消耗品貨款獨立加總', () => {
    const fin = computeAdminDashboardFinanceForYmdRange('2026-06-01', '2026-06-30');
    expect(fin.franchiseeOrderTotal).toBe(1000);
    expect(fin.franchiseeConsumableGoodsTotal).toBe(60);
    expect(fin.revenueTotal).toBe(fin.directStoreActualRevenueTotal + 1000);
  });
});
