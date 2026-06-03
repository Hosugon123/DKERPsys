import { describe, expect, it } from 'vitest';
import { orderLineQtyMapsEqual, type OrderHistoryLine } from './orderHistoryStorage';

const line = (productId: string, qty: number): OrderHistoryLine => ({
  productId,
  name: '品',
  unitPrice: 10,
  qty,
  unit: '隻',
});

describe('orderLineQtyMapsEqual', () => {
  it('ignores zero-qty rows and merges duplicate productId', () => {
    expect(
      orderLineQtyMapsEqual(
        [line('a', 3), line('a', 0), line('b', 0)],
        [line('a', 3)],
      ),
    ).toBe(true);
  });

  it('detects qty changes', () => {
    expect(orderLineQtyMapsEqual([line('a', 3)], [line('a', 5)])).toBe(false);
  });
});
