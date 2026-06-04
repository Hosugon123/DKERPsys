import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeArraysById,
  mergeOrderLikeRecord,
  mergeStorageKeyRecords,
  recordUpdatedAtMs,
} from './bundleRecordMerge';
import {
  buildDongshanDataBundle,
  importDongshanDataBundle,
  mergeDongshanBundlesLocalWinsDirty,
  type DongshanDataBundleV1,
} from './appDataBundle';

const baseBundle = (): DongshanDataBundleV1 => ({
  bundleVersion: 1,
  app: 'dongshan-ya-to',
  exportedAt: '2026-06-01T00:00:00.000Z',
  updatedAt: 1,
  format: 'dongshan-localStorage-snapshot-v1',
  keys: {},
});

function orderRow(id: string, qty: number, updatedAt: string) {
  return {
    id,
    createdAt: '2026-06-03T08:00:00.000Z',
    orderDateYmd: '2026-06-03',
    updatedAt,
    source: 'procurement' as const,
    status: '待出貨' as const,
    totalAmount: qty * 100,
    payableAmount: qty * 100,
    itemCount: qty,
    lines: [
      {
        productId: 'p1',
        name: '測試',
        unitPrice: 100,
        qty,
        unit: '隻',
      },
    ],
    storeLabel: '直營店',
    scopeId: 'scope:hq',
  };
}

describe('mergeArraysById', () => {
  it('保留兩端不同單號的訂單（模擬兩台同時下批貨）', () => {
    const a = orderRow('0012026060301', 5, '2026-06-03T09:00:00.000Z');
    const b = orderRow('0012026060302', 3, '2026-06-03T09:01:00.000Z');
    const merged = mergeArraysById([a], [b]);
    expect(merged.map((o) => o.id).sort()).toEqual(['0012026060301', '0012026060302']);
  });

  it('盤點快照依 snapshot.updatedAt 合併，訂單 updatedAt 較新也不會蓋掉剛儲存的調整', () => {
    const stamp = '2026-06-03T08:00:00.000Z';
    const withNewSnap = {
      ...orderRow('0012026060301', 1, '2026-06-03T14:00:00.000Z'),
      stallCountCompletedAt: stamp,
      stallCountBasisYmd: '2026-06-03',
      stallCountSnapshot: {
        actualRevenue: '8945',
        updatedAt: '2026-06-03T14:00:00.000Z',
        lines: {},
      },
    };
    const withOldSnap = {
      ...orderRow('0012026060301', 1, '2026-06-03T16:00:00.000Z'),
      stallCountCompletedAt: stamp,
      stallCountBasisYmd: '2026-06-03',
      stallCountSnapshot: {
        actualRevenue: '100',
        updatedAt: '2026-06-03T09:00:00.000Z',
        lines: {},
      },
    };
    const merged = mergeOrderLikeRecord(withOldSnap, withNewSnap);
    expect((merged.stallCountSnapshot as { actualRevenue?: string }).actualRevenue).toBe('8945');
  });

  it('已出貨＋新數量優先於僅時間戳較新的待出貨舊數量（電腦誤寫回防護）', () => {
    const shippedNew = orderRow('0012026060301', 7, '2026-06-03T10:00:00.000Z');
    shippedNew.status = '已完成';
    const stalePending = orderRow('0012026060301', 10, '2026-06-03T12:00:00.000Z');
    stalePending.status = '待出貨';
    const merged = mergeOrderLikeRecord(shippedNew, stalePending);
    expect(merged.status).toBe('已完成');
    expect(merged.lines[0]!.qty).toBe(7);
  });

  it('同單號以較新 updatedAt 為準（揀貨調整不會被舊雲端蓋回）', () => {
    const oldCloud = orderRow('0012026060301', 10, '2026-06-03T10:00:00.000Z');
    const newLocal = orderRow('0012026060301', 7, '2026-06-03T11:30:00.000Z');
    const merged = mergeArraysById([newLocal], [oldCloud]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.lines[0]!.qty).toBe(7);
    expect(recordUpdatedAtMs(merged[0]!)).toBe(recordUpdatedAtMs(newLocal));
  });
});

describe('mergeStorageKeyRecords (franchise mgmt orders)', () => {
  it('合併後兩筆訂單皆存在', () => {
    const local = JSON.stringify([orderRow('0012026060301', 2, '2026-06-03T09:00:00.000Z')]);
    const cloud = JSON.stringify([orderRow('0012026060302', 4, '2026-06-03T09:05:00.000Z')]);
    const out = mergeStorageKeyRecords('dongshan_franchise_mgmt_orders_v1', local, cloud);
    const arr = JSON.parse(out ?? '[]') as { id: string }[];
    expect(arr.map((x) => x.id).sort()).toEqual(['0012026060301', '0012026060302']);
  });
});

describe('mergeDongshanBundlesLocalWinsDirty (multi-device)', () => {
  it('本機新批貨單 + 雲端另一筆單 → bundle 內兩筆皆保留', () => {
    const local = baseBundle();
    local.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([
      orderRow('0012026060301', 1, '2026-06-03T12:00:00.000Z'),
    ]);
    const cloud = baseBundle();
    cloud.updatedAt = 50;
    cloud.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([
      orderRow('0012026060302', 2, '2026-06-03T12:05:00.000Z'),
    ]);
    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, []);
    const arr = JSON.parse(
      merged.keys.dongshan_franchise_mgmt_orders_v1 ?? '[]',
    ) as { id: string }[];
    expect(arr.map((x) => x.id).sort()).toEqual(['0012026060301', '0012026060302']);
  });

  it('匯入合併結果後 localStorage 可讀到兩筆（模擬分頁拉回雲端）', () => {
    localStorage.clear();
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([orderRow('0012026060301', 1, '2026-06-03T12:00:00.000Z')]),
    );
    const cloud = baseBundle();
    cloud.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([
      orderRow('0012026060302', 2, '2026-06-03T12:05:00.000Z'),
    ]);
    const local = buildDongshanDataBundle();
    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, []);
    const imp = importDongshanDataBundle(merged);
    expect(imp.ok).toBe(true);
    const stored = JSON.parse(
      localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]',
    ) as { id: string }[];
    expect(stored.map((x) => x.id).sort()).toEqual(['0012026060301', '0012026060302']);
  });

  it('模擬：A 機送出批貨後 B 機舊快照推送 — 合併後 A 的單仍在', () => {
    const machineAOrder = orderRow('0012026060303', 6, '2026-06-03T14:00:00.000Z');
    const cloud = baseBundle();
    cloud.updatedAt = 100;
    cloud.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([machineAOrder]);

    const machineBStale = baseBundle();
    machineBStale.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([]);
    machineBStale.keys.dongshan_store_code_v1 = JSON.stringify('002');

    const merged = mergeDongshanBundlesLocalWinsDirty(machineBStale, cloud, [
      'dongshan_store_code_v1',
    ]);
    const arr = JSON.parse(
      merged.keys.dongshan_franchise_mgmt_orders_v1 ?? '[]',
    ) as { id: string }[];
    expect(arr.some((x) => x.id === '0012026060303')).toBe(true);
    expect(merged.keys.dongshan_store_code_v1).toContain('002');
  });
});

describe('order history + franchise mgmt 雙庫', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('合併時歷史訂單庫與訂單管理庫各自 union，互不覆蓋', () => {
    const histLocal = JSON.stringify([
      { ...orderRow('H001', 1, '2026-06-03T10:00:00.000Z'), actorRole: 'employee' },
    ]);
    const histCloud = JSON.stringify([
      { ...orderRow('H002', 2, '2026-06-03T10:05:00.000Z'), actorRole: 'franchisee' },
    ]);
    const mergedHist = mergeStorageKeyRecords(
      'dongshan_order_history_v1',
      histLocal,
      histCloud,
    );
    const ids = (JSON.parse(mergedHist ?? '[]') as { id: string }[]).map((x) => x.id).sort();
    expect(ids).toEqual(['H001', 'H002']);
  });
});

describe('accounting ledger byScope merge', () => {
  it('不同 scope 與同 scope 不同 id 皆保留', () => {
    const local = JSON.stringify({
      version: 2,
      byScope: {
        'scope:hq': [
          {
            id: 'e1',
            dateYmd: '2026-06-03',
            flowType: 'expense',
            category: '雜項',
            note: '本機',
            amount: 10,
            createdAt: '2026-06-03T08:00:00.000Z',
            updatedAt: '2026-06-03T08:00:00.000Z',
            scopeId: 'scope:hq',
          },
        ],
      },
    });
    const cloud = JSON.stringify({
      version: 2,
      byScope: {
        'scope:franchisee:u1': [
          {
            id: 'e2',
            dateYmd: '2026-06-03',
            flowType: 'income',
            category: '店外收入',
            note: '雲端',
            amount: 20,
            createdAt: '2026-06-03T09:00:00.000Z',
            updatedAt: '2026-06-03T09:00:00.000Z',
            scopeId: 'scope:franchisee:u1',
          },
        ],
      },
    });
    const out = mergeStorageKeyRecords('dongshan_accounting_ledger_v1', local, cloud);
    const store = JSON.parse(out ?? '{}') as {
      byScope: Record<string, { id: string }[]>;
    };
    expect(store.byScope['scope:hq']?.map((x) => x.id)).toEqual(['e1']);
    expect(store.byScope['scope:franchisee:u1']?.map((x) => x.id)).toEqual(['e2']);
  });
});
