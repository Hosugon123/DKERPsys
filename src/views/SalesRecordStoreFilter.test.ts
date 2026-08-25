import { describe, expect, it } from 'vitest';
import { buildSalesRecordStoreFilterOptions } from './SalesRecord';
import type { OrderHistoryEntry } from '../lib/orderHistoryStorage';

function order(input: {
  id: string;
  storeLabel: string;
  actorRole: OrderHistoryEntry['actorRole'];
  scopeId?: string;
}): OrderHistoryEntry {
  return {
    id: input.id,
    createdAt: '2026-08-24T08:00:00.000Z',
    orderDateYmd: '2026-08-24',
    updatedAt: '2026-08-24T08:10:00.000Z',
    source: 'procurement',
    totalAmount: 100,
    payableAmount: 100,
    itemCount: 1,
    lines: [{ productId: 'p1', name: '黑輪', unitPrice: 4, qty: 1, unit: '片' }],
    actorRole: input.actorRole,
    storeLabel: input.storeLabel,
    status: '已完成',
    stallCountCompletedAt: '2026-08-24T20:00:00.000Z',
    scopeId: input.scopeId,
  };
}

describe('sales record store filter options', () => {
  it('依門市類型列出可篩選門市並統計筆數', () => {
    const rows = [
      order({ id: 'hq-1', storeLabel: '直營店', actorRole: 'employee', scopeId: 'scope:hq' }),
      order({ id: 'hq-2', storeLabel: '直營店', actorRole: 'admin', scopeId: 'scope:hq' }),
      order({ id: 'hq-legacy', storeLabel: '直營店', actorRole: 'employee' }),
      order({
        id: 'fr-1',
        storeLabel: '屏東高樹',
        actorRole: 'franchisee',
        scopeId: 'scope:franchisee:dk002',
      }),
    ];

    const directOptions = buildSalesRecordStoreFilterOptions(rows, 'direct');
    expect(directOptions).toHaveLength(1);
    expect(directOptions).toMatchObject([{ label: '直營店', count: 3 }]);
    expect(buildSalesRecordStoreFilterOptions(rows, 'franchise')).toMatchObject([
      { label: '屏東高樹', count: 1 },
    ]);
    expect(buildSalesRecordStoreFilterOptions(rows, 'all').map((x) => x.label)).toEqual([
      '直營店',
      '屏東高樹',
    ]);
  });
});
