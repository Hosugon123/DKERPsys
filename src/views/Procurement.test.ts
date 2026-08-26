import { describe, expect, it } from 'vitest';
import { buildEffectiveProcurementCart } from './Procurement';

describe('procurement effective cart', () => {
  it('uses focused input drafts when submitting before blur', () => {
    expect(buildEffectiveProcurementCart({ duckHead: 13 }, { duckHead: '18' })).toEqual({
      duckHead: 18,
    });
  });

  it('removes a cart item when the active input is cleared', () => {
    expect(buildEffectiveProcurementCart({ duckHead: 13, rice: 5 }, { duckHead: '' })).toEqual({
      rice: 5,
    });
  });
});
