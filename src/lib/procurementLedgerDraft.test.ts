import { describe, expect, it } from 'vitest';
import {
  buildProcurementLedgerDraftInput,
  buildStallGapLedgerDraftInput,
  inferIngredientSubFromLines,
} from './procurementLedgerDraft';

describe('procurementLedgerDraft', () => {
  it('依品項分類推斷食材子類', () => {
    const sub = inferIngredientSubFromLines([
      { productId: 's20', name: '鴨頭', unitPrice: 50, qty: 10, unit: '份' },
      { productId: 's33', name: '竹籤', unitPrice: 60, qty: 1, unit: '包' },
    ]);
    expect(sub).toBe('鴨貨類');
  });

  it('叫貨草稿帶入食材支出', () => {
    const draft = buildProcurementLedgerDraftInput({
      lines: [{ productId: 's20', name: '鴨頭', unitPrice: 50, qty: 10, unit: '份' }],
      payableAmount: 500,
      orderDateYmd: '2026-06-03',
      orderId: 'ORD-1',
    });
    expect(draft?.flowType).toBe('expense');
    expect(draft?.category).toBe('食材支出');
    expect(draft?.amount).toBe(500);
  });

  it('盤點正落差同步為雜項支出', () => {
    const draft = buildStallGapLedgerDraftInput({
      gapAmount: 120,
      gapReason: '零錢短少',
      basisYmd: '2026-06-03',
      orderId: 'ORD-1',
    });
    expect(draft?.flowType).toBe('expense');
    expect(draft?.category).toBe('雜項');
    expect(draft?.amount).toBe(120);
  });

  it('盤點負落差同步為店外收入', () => {
    const draft = buildStallGapLedgerDraftInput({
      gapAmount: -80,
      gapReason: '多收現金',
      basisYmd: '2026-06-03',
      orderId: 'ORD-1',
    });
    expect(draft?.flowType).toBe('income');
    expect(draft?.category).toBe('店外收入');
    expect(draft?.amount).toBe(80);
  });
});
