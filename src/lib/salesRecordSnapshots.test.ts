import { beforeEach, describe, expect, it } from 'vitest';
import { HQ_SCOPE_ID } from './dataScope';
import { listSalesRecordSnapshots } from './salesRecordStorage';
import { scopedStallDateKey } from './scopedStallDateKey';

const SALES_KEY = 'dongshan_sales_records_v1';

describe('listSalesRecordSnapshots', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads scoped dashboard sales snapshots in one storage pass', () => {
    localStorage.setItem(
      SALES_KEY,
      JSON.stringify({
        version: 1,
        byDate: {
          [scopedStallDateKey(HQ_SCOPE_ID, '2026-07-01')]: {
            completedAt: '2026-07-01T12:00:00.000Z',
            snapshot: { lines: { duck: { out: '10', remain: '2' } }, actualRevenue: '100', updatedAt: '' },
          },
          [scopedStallDateKey('scope:franchisee:dk002', '2026-07-02')]: {
            completedAt: '2026-07-02T12:00:00.000Z',
            completedByName: 'DK002',
            snapshot: { lines: { duck: { out: '20', remain: '5' } }, actualRevenue: '200', updatedAt: '' },
          },
        },
      }),
    );

    const rows = listSalesRecordSnapshots('scope:franchisee:dk002');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ymd: '2026-07-02',
      scopeId: 'scope:franchisee:dk002',
      completedByName: 'DK002',
    });
    expect(rows[0]?.snapshot.actualRevenue).toBe('200');
    expect(rows[0]?.snapshot.lines.duck.out).toBe('20');
  });
});
