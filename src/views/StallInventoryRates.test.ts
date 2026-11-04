import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import StallInventory from './StallInventory';

vi.mock('../lib/stallInventoryStorage', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/stallInventoryStorage')>();
  return {
    ...actual,
    loadDay: () => ({
      lines: {
        s01: { out: '100', remain: '20', remainSource: 'counted' },
        s02: { out: '100', remain: '' },
      },
      actualRevenue: '1000', revenueGapAmount: '0', updatedAt: '',
    }),
    listUncountedCompletedProcurementOrdersForSession: () => [],
  };
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('preserves a counted rate while visibly labeling uncounted estimates in the live form', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  sessionStorage.clear();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StallInventory, { userRole: 'admin' })));
    const remain = host.querySelector<HTMLInputElement>('[aria-label="黑輪 剩餘貨量"]')!;
    expect(remain.value).toBe('20');
    expect(remain.closest('tr')!.textContent).toContain('20.00%');
    const estimate = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('用實收估算剩餘'))!;
    await act(async () => estimate.click());
    expect(remain.value).toBe('20');
    expect(remain.closest('tr')!.textContent).toContain('20.00%');
    expect(remain.closest('tr')!.textContent).not.toContain('估算 20.00%');
    const uncounted = host.querySelector<HTMLInputElement>('[aria-label="米血 剩餘貨量"]')!;
    expect(uncounted.value).not.toBe('');
    expect(uncounted.closest('tr')!.textContent).toContain('估算 ');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
