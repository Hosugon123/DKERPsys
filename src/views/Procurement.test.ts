import { describe, expect, it } from 'vitest';
import {
  buildAppliedDeductionQtyByBasisOrderId,
  buildEffectiveProcurementCart,
  resolveProcurementCheckoutCart,
} from './Procurement';

const DUCK_HEAD_ID = 's20';

describe('procurement effective cart', () => {
  it('uses focused input drafts when submitting before blur', () => {
    expect(buildEffectiveProcurementCart({ [DUCK_HEAD_ID]: 13 }, { [DUCK_HEAD_ID]: '18' })).toEqual({
      [DUCK_HEAD_ID]: 18,
    });
  });

  it('removes a cart item when the active input is cleared', () => {
    expect(buildEffectiveProcurementCart({ [DUCK_HEAD_ID]: 13, s02: 5 }, { [DUCK_HEAD_ID]: '' })).toEqual({
      s02: 5,
    });
  });
});

describe('procurement checkout deduction guard', () => {
  it('auto deducts a selected basis when the cart was not deducted yet', () => {
    const resolved = resolveProcurementCheckoutCart(
      { [DUCK_HEAD_ID]: 18 },
      'basis-1',
      '',
      (cart) => ({ [DUCK_HEAD_ID]: Math.max(0, (cart[DUCK_HEAD_ID] ?? 0) - 6) }),
    );

    expect(resolved).toEqual({
      cart: { [DUCK_HEAD_ID]: 12 },
      autoDeducted: true,
      basisOrderId: 'basis-1',
    });
  });

  it('does not deduct again when the cart already matches the selected basis', () => {
    const resolved = resolveProcurementCheckoutCart(
      { [DUCK_HEAD_ID]: 12 },
      'basis-1',
      'basis-1',
      () => ({ [DUCK_HEAD_ID]: 6 }),
    );

    expect(resolved).toEqual({
      cart: { [DUCK_HEAD_ID]: 12 },
      autoDeducted: false,
      basisOrderId: 'basis-1',
    });
  });
});

describe('procurement deduction cart helpers', () => {
  it('records deducted carry from the original cart even when carry is greater than final order quantity', () => {
    expect(
      buildAppliedDeductionQtyByBasisOrderId(
        { p1: 10, p2: 5 },
        { p1: 4, p2: 5 },
        'basis-1',
      ),
    ).toEqual({
      'basis-1': { p1: 6 },
    });
  });
});
