import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useLocalCalendarDay } from './useLocalCalendarDay';
import { resolveDashboardPeriodYmd } from '../components/DashboardPeriodPicker';

it('rolls a mounted month into the new year, refreshes on wake, and cleans up its timer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 30));
  const host = document.createElement('div');
  const root = createRoot(host);
  function Probe() {
    const day = useLocalCalendarDay();
    return createElement('div', null, `${day}|${resolveDashboardPeriodYmd({ kind: 'month' }, true).startYmd}`);
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(host.textContent).toBe('2026-12-31|2026-12-01');
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(host.textContent).toBe('2027-01-01|2027-01-01');
    vi.setSystemTime(new Date(2027, 1, 3, 8));
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host.textContent).toBe('2027-02-03|2027-02-01');
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
