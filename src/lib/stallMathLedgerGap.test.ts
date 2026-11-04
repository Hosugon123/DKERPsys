import { describe, expect, it } from 'vitest';
import { estimateStallRemainLinesFromRevenue, parseMoneyInputForLedgerGap } from './stallMath';
import type { SupplyItem } from './supplyCatalog';

const item = (id: string, price: number): SupplyItem => ({
  id,
  name: id,
  pricePerPiece: price,
  retailPerPiece: price,
  pieceUnit: '份',
  orderUnit: '份',
  piecesPerPackage: 1,
  status: '庫存充足',
  category: 'duck',
});

describe('parseMoneyInputForLedgerGap', () => {
  it('空白不計算落差', () => {
    expect(parseMoneyInputForLedgerGap('')).toBeNull();
    expect(parseMoneyInputForLedgerGap('  ')).toBeNull();
  });

  it('完整數字可計算', () => {
    expect(parseMoneyInputForLedgerGap('8945')).toBe(8945);
    expect(parseMoneyInputForLedgerGap('8,945')).toBe(8945);
  });

  it('輸入中途的短數字仍為有效數字（由 UI 去抖動延後顯示落差）', () => {
    expect(parseMoneyInputForLedgerGap('89')).toBe(89);
  });
});

describe('estimateStallRemainLinesFromRevenue', () => {
  it('依實收占帶出總零售額比例估算剩餘', () => {
    const items = new Map([
      ['duck', item('duck', 10)],
      ['tofu', item('tofu', 20)],
    ]);
    const lines = {
      duck: { out: '100', remain: '' },
      tofu: { out: '50', remain: '' },
    };

    expect(
      estimateStallRemainLinesFromRevenue(
        ['duck', 'tofu'],
        (id) => lines[id as keyof typeof lines],
        (id) => items.get(id),
        1000,
        { unitBasis: 'retail' }
      )
    ).toEqual({ duck: '50', tofu: '25' });
  });

  it('實收大於帶出可售金額時視為售完', () => {
    const items = new Map([['duck', item('duck', 10)]]);

    expect(
      estimateStallRemainLinesFromRevenue(
        ['duck'],
        () => ({ out: '100', remain: '' }),
        (id) => items.get(id),
        2000,
        { unitBasis: 'retail' }
      )
    ).toEqual({ duck: '0' });
  });

  it('does not overwrite counted remaining quantities, including sold-out zero', () => {
    const lines = { a: { out: '100', remain: '20' }, b: { out: '50', remain: '0' } };
    expect(estimateStallRemainLinesFromRevenue(
      ['a', 'b'], id => lines[id as keyof typeof lines], id => item(id, 10), 300,
    )).toEqual({});
  });

  it('subtracts known sales before estimating uncounted items and rounds count units only', () => {
    const lines = {
      counted: { out: '100', remain: '20' },
      count: { out: '10', remain: '' },
      weight: { out: '10', remain: '' },
    };
    expect(estimateStallRemainLinesFromRevenue(
      Object.keys(lines), id => lines[id as keyof typeof lines],
      id => ({ ...item(id, 10), pieceUnit: id === 'weight' ? '兩' : '支' }),
      933,
    )).toEqual({ count: '3', weight: '3.35' });
  });

  it('allows recalculating explicitly estimated values but leaves measured values alone', () => {
    expect(estimateStallRemainLinesFromRevenue(
      ['duck'], () => ({ out: '10', remain: '7', remainSource: 'estimated' }),
      id => item(id, 10), 50,
    )).toEqual({ duck: '5' });
  });

  it('does not invent sales when items have no usable unit price', () => {
    expect(estimateStallRemainLinesFromRevenue(
      ['duck'], () => ({ out: '10', remain: '' }), id => item(id, 0), 500,
    )).toEqual({ duck: '10' });
  });
});
