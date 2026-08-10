import { describe, expect, it } from 'vitest';
import {
  buildOpenStoreOrderSummaries,
  buildOrderPrintSlipHtml,
  buildOrderPrintSlipLines,
  buildOrderPrintSlipText,
  formatOrderPrintSlipQty,
  formatOrderPrintSlipTableQty,
  formatOrderPrintSlipUnit,
} from './Orders';
import type { OrderHistoryEntry } from '../lib/orderHistoryStorage';

function order(input: {
  id: string;
  ymd: string;
  storeLabel: string;
  status?: OrderHistoryEntry['status'];
  stallCountCompletedAt?: string;
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
    stallCountCompletedAt: input.stallCountCompletedAt,
  };
}

describe('open store order summaries', () => {
  it('totals only unshipped and uncounted orders across stores and follows catalog order', () => {
    const summary = buildOpenStoreOrderSummaries([
      order({
        id: 'open-today-a',
        ymd: '2026-08-08',
        storeLabel: '高雄三民',
        lines: [
          { productId: 'black', name: '黑輪', unitPrice: 4, qty: 10, unit: '片' },
          { productId: 'rice', name: '米血', unitPrice: 6, qty: 5, unit: '片' },
        ],
      }),
      order({
        id: 'open-today-b',
        ymd: '2026-08-08',
        storeLabel: '高雄三民',
        lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 3, unit: '片' }],
      }),
      order({
        id: 'canceled',
        ymd: '2026-08-08',
        storeLabel: '高雄三民',
        status: '已取消',
        lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 99, unit: '片' }],
      }),
      order({
        id: 'shipped',
        ymd: '2026-08-08',
        storeLabel: '高雄三民',
        status: '已完成',
        lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 88, unit: '片' }],
      }),
      order({
        id: 'counted',
        ymd: '2026-08-08',
        storeLabel: '高雄三民',
        stallCountCompletedAt: '2026-08-08T19:00:00.000Z',
        lines: [{ productId: 'black', name: '黑輪', unitPrice: 4, qty: 77, unit: '片' }],
      }),
      order({
        id: 'open-other-day',
        ymd: '2026-08-07',
        storeLabel: '屏東高樹',
        lines: [{ productId: 'rice', name: '米血', unitPrice: 6, qty: 2, unit: '片' }],
      }),
    ], [{ id: 'rice' }, { id: 'black' }]);

    expect(summary.storeCount).toBe(2);
    expect(summary.orderCount).toBe(3);
    expect(summary.procurementAmount).toBe(94);
    expect(summary.lines.map((line) => line.productId)).toEqual(['rice', 'black']);
    expect(summary.lines.find((line) => line.productId === 'black')?.qty).toBe(13);
    expect(summary.lines.find((line) => line.productId === 'black')?.amount).toBe(52);
    expect(summary.lines.find((line) => line.productId === 'rice')?.qty).toBe(7);
    expect(summary.lines.find((line) => line.productId === 'rice')?.amount).toBe(42);
  });
});

describe('order print slip', () => {
  it('prints store item names and bring-out quantities only', () => {
    const lines = buildOrderPrintSlipLines(
      [
        { productId: 'black', name: '黑輪', unitPrice: 4, qty: 10, unit: '片' },
        { productId: 'pork', name: '大腸', unitPrice: 15, qty: 24, unit: '兩' },
        { productId: 'rice', name: '米血', unitPrice: 6, qty: 0, unit: '片' },
      ],
      null,
      {
        actualRevenue: '0',
        updatedAt: '2026-08-08T10:00:00.000Z',
        lines: {
          black: { out: '', remain: '2' },
          pork: { out: '', remain: '0' },
          rice: { out: '', remain: '0' },
        },
      },
      'headquarter',
    );

    expect(lines).toEqual([
      { productId: 'black', name: '黑輪', unit: '片', qty: 12 },
      { productId: 'pork', name: '大腸', unit: '兩', qty: 24 },
    ]);
    expect(formatOrderPrintSlipQty(lines[1])).toBe('24 兩（1.5 斤）');
    expect(formatOrderPrintSlipTableQty(lines[1])).toBe('24（1.5）');
    expect(formatOrderPrintSlipUnit(lines[1])).toBe('兩（斤）');
    expect(buildOrderPrintSlipText('高雄三民', lines)).toBe('高雄三民\n黑輪 12 片\n大腸 24 兩（1.5 斤）');
  });

  it('includes a mobile-friendly close action in the print window', () => {
    const html = buildOrderPrintSlipHtml('直營店', [
      { productId: 'black', name: '黑輪', unit: '片', qty: 12 },
    ]);

    expect(html).toContain('onclick="closeSlip()"');
    expect(html).toContain('function closeSlip()');
    expect(html).toContain('關閉');
    expect(html).toContain('position: sticky');
  });
});
