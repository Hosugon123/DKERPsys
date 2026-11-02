import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Orders from './Orders';

const { history, refresh } = vi.hoisted(() => ({
  history: vi.fn(), refresh: vi.fn(async () => false),
}));

vi.mock('../services/apiService', () => ({
  refreshRemoteBundleNow: refresh,
  orders: {
    loadFranchiseManagementOrders: vi.fn(async () => []),
    loadOrderHistory: history,
    listOrdersWithStallCountCompleted: vi.fn(async () => []),
  },
}));

const roots: Root[] = [];
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  return { host, root };
}

async function choose(host: HTMLElement, selector: string, value: string) {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>(selector)!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function button(host: HTMLElement, text: string) {
  return Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 23));
  localStorage.clear();
  sessionStorage.clear();
  history.mockResolvedValue(['屏東高樹', '高雄三民'].map((storeLabel, index) => ({
    id: `fixture-${index}`, storeLabel,
    createdAt: new Date(2026, 10, 1, 2, 58).toISOString(),
    updatedAt: new Date(2026, 10, 1, 2, 58).toISOString(),
    orderDateYmd: '2026-11-02', status: '待出貨', source: 'procurement',
    actorRole: 'franchisee', totalAmount: 40, itemCount: 10,
    lines: [{ productId: 'test-product', name: '黑輪', unit: '片', unitPrice: 4, qty: 10 }],
  })));
});

afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('order filters are transient and isolated', () => {
  it('shows tomorrow orders by default and does not publish filtering to another view or storage', async () => {
    const a = mount();
    const b = mount();
    await act(async () => {
      a.root.render(createElement(Orders, { userRole: 'admin' }));
      b.root.render(createElement(Orders, { userRole: 'admin' }));
    });
    expect(a.host.textContent).toContain('fixture-0');
    expect(a.host.textContent).toContain('fixture-1');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const refreshCount = refresh.mock.calls.length;

    await choose(a.host, '#orders-store-filter', '屏東高樹');
    expect(a.host.textContent).toContain('fixture-0');
    expect(a.host.textContent).not.toContain('fixture-1');
    expect(b.host.textContent).toContain('fixture-0');
    expect(b.host.textContent).toContain('fixture-1');
    await choose(a.host, '[aria-label="建單星期篩選"]', '7');
    expect(a.host.textContent).not.toContain('fixture-0');
    expect(b.host.textContent).toContain('fixture-0');
    expect(refresh.mock.calls.length).toBe(refreshCount);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('resets store, weekday, status and custom dates on remount, like page refresh', async () => {
    const { host, root } = mount();
    await act(async () => root.render(createElement(Orders, { userRole: 'admin' })));
    await choose(host, '#orders-store-filter', '屏東高樹');
    await choose(host, '[aria-label="建單星期篩選"]', '7');
    await act(async () => button(host, '自訂時間').click());
    await act(async () => {
      // Native setter exercises React's controlled date inputs.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const label of ['起始日', '結束日']) {
        const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
        setter.call(input, '2026-10-01');
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await act(async () => {
      const confirm = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '確定')!;
      confirm.click();
    });
    await act(async () => button(host, '已盤點').click());
    expect(button(host, '自訂時間').getAttribute('aria-pressed')).toBe('true');
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Orders, { userRole: 'admin' })));
    expect((host.querySelector('#orders-store-filter') as HTMLSelectElement).value).toBe('all');
    expect((host.querySelector('[aria-label="建單星期篩選"]') as HTMLSelectElement).value).toBe('');
    expect(button(host, '本月').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('未完成訂單');
    expect(host.textContent).toContain('fixture-0');
    expect(host.textContent).toContain('fixture-1');
  });
});
