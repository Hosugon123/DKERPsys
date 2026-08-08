import { describe, expect, it } from 'vitest';
import { buildAllStoreStallEconomicsByYmd, weekdayMatchesSelection } from './Dashboard';
import type { OrderHistoryEntry } from '../lib/orderHistoryStorage';

function order(input: {
  id: string;
  scopeId: string;
  actorRole: OrderHistoryEntry['actorRole'];
  actorUserId?: string;
  status?: OrderHistoryEntry['status'];
  completed?: boolean;
  actualRevenue: string;
  out: string;
  remain: string;
}): OrderHistoryEntry {
  const ymd = '2026-08-08';
  const productId = 'test-product';
  return {
    id: input.id,
    createdAt: `${ymd}T08:00:00.000Z`,
    orderDateYmd: ymd,
    updatedAt: `${ymd}T08:10:00.000Z`,
    source: 'procurement',
    totalAmount: 0,
    payableAmount: 0,
    itemCount: 0,
    lines: [{ productId, name: '測試品項', unitPrice: 1, qty: Number(input.out), unit: '份' }],
    actorRole: input.actorRole,
    actorUserId: input.actorUserId,
    storeLabel: input.scopeId === 'scope:hq' ? '直營店' : '加盟店',
    status: input.status ?? '已完成',
    stallCountBasisYmd: ymd,
    stallCountCompletedAt: input.completed === false ? undefined : `${ymd}T20:00:00.000Z`,
    scopeId: input.scopeId,
    stallCountSnapshot:
      input.completed === false
        ? undefined
        : {
            lines: { [productId]: { out: input.out, remain: input.remain } },
            actualRevenue: input.actualRevenue,
            updatedAt: `${ymd}T20:00:00.000Z`,
            frozenRetailUnitPriceByItem: { [productId]: 10 },
            frozenWholesaleUnitPriceByItem: { [productId]: 4 },
          },
  };
}

describe('all-store stall sales economics', () => {
  it('sums completed direct and franchise stall orders by sales day', () => {
    const rows = buildAllStoreStallEconomicsByYmd([
      order({
        id: 'direct',
        scopeId: 'scope:hq',
        actorRole: 'admin',
        actualRevenue: '900',
        out: '100',
        remain: '10',
      }),
      order({
        id: 'franchise',
        scopeId: 'scope:franchisee:dk002',
        actorRole: 'franchisee',
        actorUserId: 'dk002',
        actualRevenue: '450',
        out: '50',
        remain: '5',
      }),
      order({
        id: 'not-counted',
        scopeId: 'scope:franchisee:dk003',
        actorRole: 'franchisee',
        actorUserId: 'dk003',
        completed: false,
        actualRevenue: '9999',
        out: '999',
        remain: '0',
      }),
    ]);

    const row = rows.get('2026-08-08');
    expect(row?.actual).toBe(1350);
    expect(row?.expectedRetail).toBe(1350);
    expect(row?.estTotal).toBe(1500);
    expect(row?.remainValue).toBe(150);
    expect(row?.gap).toBe(0);
  });
});

describe('weekday sales filters', () => {
  it('supports selecting multiple weekdays at once', () => {
    expect(weekdayMatchesSelection('2026-07-26', [6, 0])).toBe(true);
    expect(weekdayMatchesSelection('2026-07-27', [6, 0])).toBe(true);
    expect(weekdayMatchesSelection('2026-07-28', [6, 0])).toBe(false);
    expect(weekdayMatchesSelection('2026-07-28', [])).toBe(true);
  });
});
