import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import StallInventory from './StallInventory';

const calls = vi.hoisted(() => ({ commit: vi.fn(async (_params: unknown) => ({ ok: true })) }));
vi.mock('../services/apiService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/apiService')>();
  return { ...actual, orders: { ...actual.orders, commitStallInventoryComplete: calls.commit } };
});
vi.mock('../hooks/useSupplyCatalogItems', async () => {
  const { getSupplyItem } = await import('../lib/supplyCatalog');
  const items = [getSupplyItem('s01')!, getSupplyItem('s02')!];
  return { useSupplyCatalogItems: () => items };
});
vi.mock('../lib/stallInventoryStorage', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/stallInventoryStorage')>();
  return { ...actual,
    loadDay: () => ({ lines: {
      s01: { out: '100', remain: '20', remainSource: 'counted' },
      s02: { out: '100', remain: '' },
    }, actualRevenue: '1000', revenueGapAmount: '0', updatedAt: '' }),
    listUncountedCompletedProcurementOrdersForSession: () => [{
      id: 'consent-order', createdAt: '2026-11-20T00:00:00Z', orderDateYmd: '2026-11-20',
      scopeId: 'scope:hq', status: '已完成', totalAmount: 400, itemCount: 100,
    }],
  };
});
afterEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); calls.commit.mockClear();
});

it('requires a second explicit acknowledgement before estimated quantities can be committed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StallInventory, { userRole: 'admin' })));
    const optIn = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find(input => input.closest('label')?.textContent?.includes('以實收估算未盤點品項'))!;
    await act(async () => optIn.click());
    const complete = host.querySelector<HTMLButtonElement>('button[aria-label="盤點完成"]')!;
    await act(async () => complete.click());
    let dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('估算品項：1 項');
    expect(dialog.textContent).toContain('米血');
    const submit = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === '確定以估算送出')!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(calls.commit).not.toHaveBeenCalled();
    const acknowledgement = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => acknowledgement.click());
    expect(submit.disabled).toBe(false);
    const cancel = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === '取消')!;
    await act(async () => cancel.click());
    await act(async () => complete.click());
    dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === '確定以估算送出')!.click());
    expect(calls.commit).toHaveBeenCalledTimes(1);
    const params = calls.commit.mock.calls[0][0] as unknown as { allowRevenueEstimation: boolean; recordSnap: { lines: Record<string, { remain: string; remainSource: string }> } };
    expect(params.allowRevenueEstimation).toBe(true);
    expect(params.recordSnap.lines.s01).toMatchObject({ remain: '20', remainSource: 'counted' });
    expect(params.recordSnap.lines.s02.remainSource).toBe('estimated');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
