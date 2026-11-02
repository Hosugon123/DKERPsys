import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDashboardPeriodYmd, ymdRangeForCalendarMonth } from './DashboardPeriodPicker';

afterEach(() => vi.useRealTimers());

describe('order month range versus reporting month range', () => {
  it('includes future orders in the whole month without changing reporting defaults', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 23));
    expect(resolveDashboardPeriodYmd({ kind: 'month' }, true)).toEqual({
      startYmd: '2026-11-01', endYmd: '2026-11-30',
    });
    expect(resolveDashboardPeriodYmd({ kind: 'month' })).toEqual({
      startYmd: '2026-11-01', endYmd: '2026-11-01',
    });
    expect(ymdRangeForCalendarMonth(2026, 11, true).endYmd).toBe('2026-11-30');
    expect(ymdRangeForCalendarMonth(2026, 11).endYmd).toBe('2026-11-01');
  });

  it('keeps explicit custom dates and handles year-end and leap-year month ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 1));
    expect(resolveDashboardPeriodYmd({ kind: 'month' }, true).endYmd).toBe('2026-12-31');
    expect(ymdRangeForCalendarMonth(2028, 2, true).endYmd).toBe('2028-02-29');
    expect(resolveDashboardPeriodYmd({
      kind: 'custom', startYmd: '2026-11-02', endYmd: '2026-11-01',
    }, true)).toEqual({ startYmd: '2026-11-01', endYmd: '2026-11-02' });
  });
});
