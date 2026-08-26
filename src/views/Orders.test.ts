import { describe, expect, it } from 'vitest';
import {
  buildCombinedOpenStoreOrdersPrintHtml,
  buildCombinedOpenStoreOrdersPrintText,
  buildPickingDisplayLines,
  buildPickingPersistLines,
  buildOpenStoreOrderSummaries,
  buildOpenStoreOrderSummaryPrintHtml,
  buildOpenStoreOrderSummaryPrintText,
  buildOrderPrintSlipHtml,
  buildOrderPrintSlipLines,
  buildOrderPrintSlipText,
  formatOrderPrintSlipQty,
  formatOrderPrintSlipTableQty,
  orderDetailQtyColumnLabels,
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
    expect(summary.dateLabel).toContain('2026/8/7');
    expect(summary.dateLabel).toContain('2026/8/8');
    expect(summary.procurementAmount).toBe(94);
    expect(summary.lines.map((line) => line.productId)).toEqual(['rice', 'black']);
    expect(summary.lines.find((line) => line.productId === 'black')?.qty).toBe(13);
    expect(summary.lines.find((line) => line.productId === 'black')?.amount).toBe(52);
    expect(summary.lines.find((line) => line.productId === 'rice')?.qty).toBe(7);
    expect(summary.lines.find((line) => line.productId === 'rice')?.amount).toBe(42);
  });

  it('prints the unfinished order aggregate with totals and a mobile close action', () => {
    const summary = buildOpenStoreOrderSummaries([
      order({
        id: 'open-today-a',
        ymd: '2026-08-08',
        storeLabel: '\u76f4\u71df\u5e97',
        lines: [
          { productId: 'black', name: '\u9ed1\u8f2a', unitPrice: 4, qty: 10, unit: '\u7247' },
          { productId: 'rice', name: '\u7c73\u8840', unitPrice: 6, qty: 5, unit: '\u7247' },
        ],
      }),
      order({
        id: 'open-today-b',
        ymd: '2026-08-08',
        storeLabel: 'DK002',
        lines: [{ productId: 'black', name: '\u9ed1\u8f2a', unitPrice: 4, qty: 3, unit: '\u7247' }],
      }),
      order({
        id: 'open-other-day',
        ymd: '2026-08-07',
        storeLabel: 'DK003',
        lines: [{ productId: 'rice', name: '\u7c73\u8840', unitPrice: 6, qty: 2, unit: '\u7247' }],
      }),
    ], [{ id: 'rice' }, { id: 'black' }]);

    const text = buildOpenStoreOrderSummaryPrintText(summary);
    expect(text).toContain('\u672a\u5b8c\u6210\u8a02\u55ae\u7e3d\u548c');
    expect(text).toContain('2026/8/7');
    expect(text).toContain('2026/8/8');
    expect(text).toContain('\u5171 3 \u5bb6\u5e97\u30013 \u7b46\u8a02\u55ae');
    expect(text).not.toContain('\u53eb\u8ca8\u91d1\u984d');
    expect(text).toContain('\u7c73\u8840 7 \u7247');
    expect(text).toContain('\u9ed1\u8f2a 13 \u7247');
    expect(text).not.toContain('$ 42');

    const html = buildOpenStoreOrderSummaryPrintHtml(summary);
    expect(html).toContain('onclick="closeSlip()"');
    expect(html).toContain('function closeSlip()');
    expect(html).toContain('\u672a\u5b8c\u6210\u8a02\u55ae\u7e3d\u548c');
    expect(html).toContain('2026/8/7');
    expect(html).toContain('2026/8/8');
    expect(html).toContain('\u5bb6\u5e97 /');
    expect(html).not.toContain('\u51fa\u8ca8\u524d\u5c0d\u9ede');
    expect(html).not.toContain('\u53eb\u8ca8\u91d1\u984d');
    expect(html).not.toContain('<th class="amount">\u91d1\u984d</th>');
    expect(html).toContain('position: sticky');
  });

  it('prints the aggregate and each store slip in one batch print page', () => {
    const summary = buildOpenStoreOrderSummaries([
      order({
        id: 'open-today-a',
        ymd: '2026-08-08',
        storeLabel: '\u76f4\u71df\u5e97',
        lines: [
          { productId: 'black', name: '\u9ed1\u8f2a', unitPrice: 4, qty: 10, unit: '\u7247' },
          { productId: 'rice', name: '\u7c73\u8840', unitPrice: 6, qty: 5, unit: '\u7247' },
        ],
      }),
      order({
        id: 'open-today-b',
        ymd: '2026-08-08',
        storeLabel: 'DK002',
        lines: [{ productId: 'black', name: '\u9ed1\u8f2a', unitPrice: 4, qty: 3, unit: '\u7247' }],
      }),
    ], [{ id: 'rice' }, { id: 'black' }]);
    const slips = [
      {
        orderId: 'open-today-a',
        storeLabel: '\u76f4\u71df\u5e97',
        dateLabel: '2026/8/8（週六）',
        lines: [
          { productId: 'black', name: '\u9ed1\u8f2a', unit: '\u7247', qty: 10 },
          { productId: 'rice', name: '\u7c73\u8840', unit: '\u7247', qty: 5 },
        ],
      },
      {
        orderId: 'open-today-b',
        storeLabel: 'DK002',
        dateLabel: '2026/8/8（週六）',
        lines: [{ productId: 'black', name: '\u9ed1\u8f2a', unit: '\u7247', qty: 3 }],
      },
    ];

    const text = buildCombinedOpenStoreOrdersPrintText(summary, slips);
    expect(text).toContain('\u672a\u5b8c\u6210\u8a02\u55ae\u7e3d\u548c');
    expect(text).toContain('\u76f4\u71df\u5e97');
    expect(text).toContain('DK002');
    expect(text).toContain('2026/8/8（週六）');
    expect(text).toContain('\u9ed1\u8f2a 10 \u7247');

    const html = buildCombinedOpenStoreOrdersPrintHtml(summary, slips);
    expect(html).toContain('\u672a\u5b8c\u6210\u8a02\u55ae\u7e3d\u6210\u5217\u5370');
    expect(html).toContain('2026/8/8');
    expect(html).not.toContain('open-today-a');
    expect(html).not.toContain('open-today-b');
    expect(html).toContain('<div class="meta">2026/8/8（週六）</div>');
    expect(html).toContain('\u5bb6\u5e97 /');
    expect(html).not.toContain('\u51fa\u8ca8\u524d\u5c0d\u9ede');
    expect(html).not.toContain('<th class="amount">\u91d1\u984d</th>');
    expect(html).not.toContain('page-break-before: always');
    expect(html).toContain('width: 80mm');
    expect(html).toContain('page-break-inside: avoid');
    expect(html).toContain('<body class="batch-print">');
    expect(html).toContain('.batch-print .receipt-page');
    expect(html).toContain('break-after: page');
    expect(html).toContain('page-break-after: always');
    expect(html).toContain('.batch-print .receipt-page:last-of-type');
    expect(html).toContain('\u526a\u88c1\u7dda');
    expect(html).toContain('onclick="closeSlip()"');
    expect(html).toContain('列印全部');
    expect(html).toContain('逐張列印');
    expect(html).toContain('function printCurrentReceipt()');
    expect(html).toContain('.batch-print.sequential-printing .receipt-page');
    expect(html).toContain('if (false) {');
  });
});

describe('order print slip', () => {
  it('prints store item names and order quantities only', () => {
    const lines = buildOrderPrintSlipLines([
      { productId: 'black', name: '黑輪', unitPrice: 4, qty: 10, unit: '片' },
      { productId: 'pork', name: '大腸', unitPrice: 15, qty: 24, unit: '兩' },
      { productId: 'rice', name: '米血', unitPrice: 6, qty: 0, unit: '片' },
    ]);

    expect(lines).toEqual([
      { productId: 'black', name: '黑輪', unit: '片', qty: 10 },
      { productId: 'pork', name: '大腸', unit: '兩', qty: 24 },
    ]);
    expect(formatOrderPrintSlipQty(lines[1])).toBe('24 兩（1.5 斤）');
    expect(formatOrderPrintSlipTableQty(lines[1])).toBe('24 兩（1.5 斤）');
    expect(buildOrderPrintSlipText('高雄三民', lines)).toBe('高雄三民\n黑輪 10 片\n大腸 24 兩（1.5 斤）');
    expect(buildOrderPrintSlipText('高雄三民', lines, '2026/8/16（週日）')).toBe(
      '高雄三民\n2026/8/16（週日）\n黑輪 10 片\n大腸 24 兩（1.5 斤）',
    );
  });

  it('includes a mobile-friendly close action in the print window', () => {
    const html = buildOrderPrintSlipHtml(
      '直營店',
      [{ productId: 'black', name: '黑輪', unit: '片', qty: 12 }],
      '2026/8/16（週日）',
    );

    expect(html).toContain('onclick="closeSlip()"');
    expect(html).toContain('function closeSlip()');
    expect(html).toContain('<div class="date">2026/8/16（週日）</div>');
    expect(html).toContain('關閉');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('height: auto !important');
    expect(html).toContain('<th class="qty">數量</th>');
    expect(html).not.toContain('<th class="unit">單位</th>');
    expect(html).toContain('position: sticky');
  });
});

describe('order detail quantity labels', () => {
  it('clarifies deducted orders without changing normal order labels', () => {
    expect(orderDetailQtyColumnLabels(false, false)).toEqual({
      procurementQty: '叫貨數量',
      carryRemain: '昨剩餘帶出',
      bringOut: '帶出數量',
    });

    expect(orderDetailQtyColumnLabels(true, false)).toEqual({
      procurementQty: '扣後叫貨',
      carryRemain: '已扣剩餘',
      bringOut: '原訂帶出量',
    });

    expect(orderDetailQtyColumnLabels(true, true).bringOut).toBe('盤點帶出量');
  });
});

describe('deducted order picking quantity conversion', () => {
  it('edits bring-out quantity but persists deducted procurement quantity', () => {
    const raw = order({
      id: 'deducted-order',
      ymd: '2026-08-24',
      storeLabel: '高雄三民',
      lines: [{ productId: 'duck-head', name: '鴨頭', unitPrice: 24, qty: 12, unit: '支' }],
    });
    raw.procurementDeductionBasisOrderId = 'basis-order';
    raw.procurementDeductionBasisOrderIds = ['basis-order'];
    raw.procurementDeductionAppliedQtyByBasisOrderId = {
      'basis-order': { 'duck-head': 6 },
    };

    const displayLines = buildPickingDisplayLines(raw, raw.lines);
    expect(displayLines[0].qty).toBe(18);

    const persistLines = buildPickingPersistLines(raw, displayLines);
    expect(persistLines[0].qty).toBe(12);

    const reducedDisplayLines = [{ ...displayLines[0], qty: 13 }];
    const reducedPersistLines = buildPickingPersistLines(raw, reducedDisplayLines);
    expect(reducedPersistLines[0].qty).toBe(7);
  });
});
