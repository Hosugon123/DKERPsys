import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeDongshanBundlesLocalWinsDirty, type DongshanDataBundleV1 } from './appDataBundle';
import { deleteOrderByIdFromAnyStore, DELETED_ORDER_IDS_KEY } from './orderHistoryStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

const ORDER_ID = 'del-test-order-1';

function orderRow() {
  return {
    id: ORDER_ID,
    createdAt: '2026-06-03T08:00:00.000Z',
    orderDateYmd: '2026-06-03',
    updatedAt: '2026-06-03T08:00:00.000Z',
    source: 'procurement' as const,
    status: '待出貨' as const,
    totalAmount: 500,
    payableAmount: 500,
    itemCount: 5,
    lines: [{ productId: 'p1', name: '品項', unitPrice: 100, qty: 5, unit: '隻' }],
    storeLabel: '直營店',
    scopeId: 'scope:hq',
    actorRole: 'employee' as const,
  };
}

function baseBundle(): DongshanDataBundleV1 {
  return {
    bundleVersion: 1,
    app: 'dongshan-ya-to',
    format: 'dongshan-localStorage-snapshot-v1',
    exportedAt: new Date().toISOString(),
    keys: {},
  };
}

describe('deleteOrderByIdFromAnyStore', () => {
  beforeEach(() => {
    localStorage.clear();
    const row = orderRow();
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([row]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([row]));
  });

  it('雙庫同單號時兩庫皆刪除並寫入墓碑', () => {
    expect(deleteOrderByIdFromAnyStore(ORDER_ID)).toBe(true);
    const mgmt = JSON.parse(localStorage.getItem('dongshan_franchise_mgmt_orders_v1') ?? '[]') as {
      id: string;
    }[];
    const hist = JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]') as {
      id: string;
    }[];
    expect(mgmt).toHaveLength(0);
    expect(hist).toHaveLength(0);
    const tomb = JSON.parse(localStorage.getItem(DELETED_ORDER_IDS_KEY) ?? '{}') as {
      byId: Record<string, string>;
    };
    expect(tomb.byId[ORDER_ID]).toBeTruthy();
  });
});

describe('雲端合併尊重刪除墓碑', () => {
  it('本機已刪除、雲端仍有該單 → 合併後不再出現', () => {
    const row = orderRow();
    const local = baseBundle();
    local.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([]);
    local.keys.dongshan_order_history_v1 = JSON.stringify([]);
    local.keys.dongshan_deleted_order_ids_v1 = JSON.stringify({
      version: 1,
      byId: { [ORDER_ID]: '2026-06-03T12:00:00.000Z' },
    });

    const cloud = baseBundle();
    cloud.keys.dongshan_franchise_mgmt_orders_v1 = JSON.stringify([row]);
    cloud.keys.dongshan_order_history_v1 = JSON.stringify([row]);

    const merged = mergeDongshanBundlesLocalWinsDirty(local, cloud, [
      'dongshan_franchise_mgmt_orders_v1',
      'dongshan_order_history_v1',
      'dongshan_deleted_order_ids_v1',
    ]);

    const mgmt = JSON.parse(merged.keys.dongshan_franchise_mgmt_orders_v1 ?? '[]') as {
      id: string;
    }[];
    const hist = JSON.parse(merged.keys.dongshan_order_history_v1 ?? '[]') as { id: string }[];
    expect(mgmt.some((x) => x.id === ORDER_ID)).toBe(false);
    expect(hist.some((x) => x.id === ORDER_ID)).toBe(false);
    expect(merged.keys.dongshan_deleted_order_ids_v1).toContain(ORDER_ID);
  });
});
