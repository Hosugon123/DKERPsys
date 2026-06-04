import { describe, expect, it } from 'vitest';
import { parseMoneyInputForLedgerGap } from './stallMath';

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
