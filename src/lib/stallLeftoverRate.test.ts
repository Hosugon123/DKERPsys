import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLine, formatStallLeftoverRate } from './stallMath';
import { getAllSupplyItems } from './supplyCatalog';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import { loadDay, saveDay, stallDaySnapshotFingerprint } from './stallInventoryStorage';
import { stallCountSnapshotPersistedMatches } from './orderHistoryStorage';

const scope = 'scope:hq';
const day = '2026-10-28';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('leftover rate and estimate provenance', () => {
  it('uses remaining divided by out, independent of prices or revenue', () => {
    const item = getAllSupplyItems()[0];
    const c = computeLine('200', '50', item);
    expect(c.leftRatePct).toBe(25);
    expect(formatStallLeftoverRate(c)).toBe('25.00%');
    expect(formatStallLeftoverRate(c, 'estimated')).toBe('估算 25.00%');
    expect(formatStallLeftoverRate(c, 'counted')).toBe('25.00%');
    expect(formatStallLeftoverRate(computeLine('200', '0', item))).toBe('0.00%');
  });

  it.each([
    ['100', ''], ['100', 'abc'], ['100', '-1'], ['100', '101'],
    ['', '0'], ['0', '0'], ['-100', '10'], ['abc', '10'], ['Infinity', '10'],
  ])('does not show a valid-looking rate for out=%s remain=%s', (out, remain) => {
    expect(formatStallLeftoverRate(computeLine(out, remain, getAllSupplyItems()[0]))).toBe('—');
  });

  it('keeps estimates marked across storage, and stamps a same-quantity manual confirmation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
    const id = getAllSupplyItems()[0].id;
    const estimated = {
      lines: { [id]: { out: '100', remain: '20', remainSource: 'estimated' as const } },
      actualRevenue: '800', updatedAt: new Date().toISOString(),
    };
    saveSalesRecord(day, estimated, scope);
    saveDay(day, estimated, scope);
    expect(getSalesRecord(day, scope)!.lines[id].remainSource).toBe('estimated');
    expect(loadDay(day, scope).lines[id].remainSource).toBe('estimated');
    const counted = { ...estimated, lines: { [id]: { ...estimated.lines[id], remainSource: 'counted' as const } } };
    expect(stallDaySnapshotFingerprint(estimated)).not.toBe(stallDaySnapshotFingerprint(counted));
    expect(stallCountSnapshotPersistedMatches(estimated, counted)).toBe(false);
    vi.setSystemTime(new Date('2026-10-28T15:01:00Z'));
    saveSalesRecord(day, counted, scope);
    saveDay(day, counted, scope);
    expect(getSalesRecord(day, scope)!.lines[id]).toMatchObject({
      remainSource: 'counted', updatedAt: '2026-10-28T15:01:00.000Z',
    });
    expect(loadDay(day, scope).lines[id]).toMatchObject({
      remainSource: 'counted', updatedAt: '2026-10-28T15:01:00.000Z',
    });
    expect(stallCountSnapshotPersistedMatches(getSalesRecord(day, scope), counted)).toBe(true);
  });

  it('does not change legacy historical numbers or infer provenance', () => {
    const id = getAllSupplyItems()[0].id;
    const old = { lines: { [id]: { out: '201', remain: '61.785' } }, actualRevenue: '14315', updatedAt: '' };
    saveSalesRecord(day, old, scope);
    const saved = getSalesRecord(day, scope)!.lines[id];
    expect(saved).toMatchObject({ out: '201', remain: '61.785' });
    expect(saved.remainSource).toBeUndefined();
  });
});
