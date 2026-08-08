import { describe, expect, it } from 'vitest';
import { buildTodayStoreOrderSummaries } from './Orders';
import type { OrderHistoryEntry } from '../lib/orderHistoryStorage';

function order(input: {
  id: string;
  ymd: string;
  storeLabel: string;
  status?: OrderHistoryEntry['status'];
  lines: OrderHistoryEntry['lines'];
}): OrderHistoryEntry {
  return {
    id: input.id,
    createdAt: `${input.ymd}T08:00:00.000Z`,
    orderDateYmd: input.ymd,
    updatedAt: `${input.ymd}T08:10:00.000Z`,
    source: 'procurement',
    totalAmount: input.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0),
    payableAmount: input.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0),
    itemCount: input.lines.reduce((sum, line) => sum + line.qty, 0),
    lines: input.lines,
    actorRole: 'franchisee',
    storeLabel: input.storeLabel,
    status: input.status ?? '待出貨',
  };
}

describe('today store order summaries', () => {
  it('groups only today non-canceled orders by store and product', () => {
    const summaries = buildTodayStoreOrderSummaries(
      [
        order({
          id: 'today-a',
          ymd: '2026-08-08',
          storeLabel: '高雄三民',
          lines: [
            { productId: 'black', name: '黑輪', unitPrice: 4, qty: 10, unit: '片' },
            { productId: 'rice', name: '米血', unitPrice: 6, qty: 5, unit: '片' },
          ],
        }),
        order({
          id: 'today-b',
          ymd: '2026-08-08',
          storeLabel: '高雄三民',
          lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 3, unit: '片' }],
        }),
        order({
          id: 'today-canceled',
          ymd: '2026-08-08',
          storeLabel: '高雄三民',
          status: '已取消',
          lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 99, unit: '片' }],
        }),
        order({
          id: 'other-day',
          ymd: '2026-08-07',
          storeLabel: '高雄三民',
          lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 88, unit: '片' }],
        }),
        order({
          id: 'today-other-store',
          ymd: '2026-08-08',
          storeLabel: '屏東高樹',
          lines: [{ productId: 'rice', name: '米血', unitPrice: 6, qty: 2, unit: '片' }],
        }),
      ],
      '2026-08-08',
    );

    expect(summaries).toHaveLength(2);
    const sanmin = summaries.find((s) => s.storeLabel === '高雄三民');
    expect(sanmin?.orderCount).toBe(2);
    expect(sanmin?.procurementAmount).toBe(82);
    expect(sanmin?.lines.find((line) => line.productId === 'black')?.qty).toBe(13);
    expect(sanmin?.lines.find((line) => line.productId === 'black')?.amount).toBe(52);
    expect(sanmin?.lines.find((line) => line.productId === 'rice')?.qty).toBe(5);

    const gaoshu = summaries.find((s) => s.storeLabel === '屏東高樹');
    expect(gaoshu?.orderCount).toBe(1);
    expect(gaoshu?.procurementAmount).toBe(12);
  });
});
