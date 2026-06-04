import { describe, expect, it } from 'vitest';
import {
  mergeDongshanBundlesLocalWinsDirty,
  storageKeysChangedBetweenBundleTexts,
  type DongshanDataBundleV1,
} from './appDataBundle';

const base = (): DongshanDataBundleV1 => ({
  bundleVersion: 1,
  app: 'dongshan-ya-to',
  exportedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: 1,
  format: 'dongshan-localStorage-snapshot-v1',
  keys: {},
});

describe('mergeDongshanBundlesLocalWinsDirty', () => {
  it('dirty 非紀錄鍵以本機為準；訂單鍵仍 union 合併', () => {
    const local = base();
    local.keys = {
      dongshan_store_code_v1: '"001"',
      dongshan_order_history_v1: JSON.stringify([
        {
          id: 'o-local',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T12:00:00.000Z',
          source: 'procurement',
          status: '待出貨',
          totalAmount: 1,
          itemCount: 1,
          lines: [],
          actorRole: 'employee',
          storeLabel: 'x',
        },
      ]),
    };
    const cloud = base();
    cloud.updatedAt = 99;
    cloud.keys = {
      dongshan_order_history_v1: JSON.stringify([
        {
          id: 'o-cloud',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T10:00:00.000Z',
          source: 'procurement',
          status: '待出貨',
          totalAmount: 1,
          itemCount: 1,
          lines: [],
          actorRole: 'employee',
          storeLabel: 'x',
        },
      ]),
      dongshan_stall_inventory_v1: '{"version":1,"byDate":{}}',
    };
    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, ['dongshan_store_code_v1']);
    const orders = JSON.parse(merged.keys.dongshan_order_history_v1 ?? '[]') as { id: string }[];
    expect(orders.map((o) => o.id).sort()).toEqual(['o-cloud', 'o-local']);
    expect(merged.keys.dongshan_store_code_v1).toBe('"001"');
    expect(merged.keys.dongshan_stall_inventory_v1).toContain('byDate');
  });

  it('detects changed storage keys between snapshots', () => {
    const before = JSON.stringify(
      base(),
    );
    const afterObj = base();
    afterObj.keys.dongshan_order_history_v1 = 'x';
    const after = JSON.stringify(afterObj);
    expect(storageKeysChangedBetweenBundleTexts(before, after)).toContain(
      'dongshan_order_history_v1',
    );
  });
});
