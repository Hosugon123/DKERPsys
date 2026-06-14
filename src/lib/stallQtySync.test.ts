/**
 * 送單／訂單改貨量／盤點／銷售調整 — 帶出與 scope 同步回歸
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeStorageKeyRecords } from './bundleRecordMerge';
import { scopedStallDateKey } from './scopedStallDateKey';
import { loadDay, recomputeStallOutForStallYmdAndOrder, syncStallOutAfterOrderLinesChanged } from './stallInventoryStorage';

const HQ_SCOPE = 'scope:hq';

const PRODUCT_ID = 'duck-sync-1';
const FRANCHISE_SCOPE = 'scope:franchisee:fr-sync';
const ORDER_ID = 'order-qty-sync-1';
const STALL_YMD = '2026-06-14';

vi.mock('./supplyCatalog', () => ({
  getAllSupplyItems: () => [
    {
      id: PRODUCT_ID,
      name: '同步測試品',
      category: '鴨貨類',
      pieceUnit: '隻',
      pricePerPiece: 100,
    },
  ],
  getSupplyItem: (id: string) =>
    id === PRODUCT_ID
      ? {
          id: PRODUCT_ID,
          name: '同步測試品',
          category: '鴨貨類',
          pieceUnit: '隻',
          pricePerPiece: 100,
        }
      : undefined,
  isConsumableItem: () => false,
}));

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({ role: 'admin', userId: 'admin-1', scopeId: 'scope:hq', isAdmin: true }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: () => '測試員',
}));

function seedFranchiseOrder(qty: number) {
  const order = {
    id: ORDER_ID,
    createdAt: '2026-06-03T08:00:00.000Z',
    orderDateYmd: STALL_YMD,
    updatedAt: '2026-06-03T08:00:00.000Z',
    source: 'procurement',
    status: '已完成',
    totalAmount: qty * 100,
    payableAmount: qty * 100,
    itemCount: qty,
    lines: [{ productId: PRODUCT_ID, name: '同步測試品', unitPrice: 100, qty, unit: '隻' }],
    storeLabel: '加盟測試店',
    scopeId: FRANCHISE_SCOPE,
    actorRole: 'franchisee',
    actorUserId: 'fr-sync',
  };
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([order]));
  return order;
}

describe('stall qty sync across order → inventory', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  });

  it('訂單改貨量後 syncStallOut 寫入加盟 scope 桶，不污染 HQ 裸鍵', () => {
    seedFranchiseOrder(5);
    recomputeStallOutForStallYmdAndOrder(STALL_YMD, ORDER_ID, undefined, { clearRemain: true });
    expect(Number(loadDay(STALL_YMD, FRANCHISE_SCOPE).lines[PRODUCT_ID]?.out)).toBe(5);
    expect(loadDay(STALL_YMD, HQ_SCOPE).lines[PRODUCT_ID]?.out ?? '').toBe('');

    localStorage.setItem(
      'dongshan_order_history_v1',
      JSON.stringify([
        {
          ...JSON.parse(localStorage.getItem('dongshan_order_history_v1') ?? '[]')[0],
          lines: [{ productId: PRODUCT_ID, name: '同步測試品', unitPrice: 100, qty: 8, unit: '隻' }],
        },
      ]),
    );
    syncStallOutAfterOrderLinesChanged(ORDER_ID);
    expect(Number(loadDay(STALL_YMD, FRANCHISE_SCOPE).lines[PRODUCT_ID]?.out)).toBe(8);
    expect(loadDay(STALL_YMD, HQ_SCOPE).lines[PRODUCT_ID]?.out ?? '').toBe('');
  });

  it('雲端合併：裸鍵 YYYY-MM-DD 與 scoped 鍵合併為單一桶', () => {
    const ymd = '2026-06-03';
    const scoped = scopedStallDateKey(HQ_SCOPE, ymd);
    const local = JSON.stringify({
      version: 1,
      byDate: {
        [ymd]: { lines: { [PRODUCT_ID]: { out: '1', remain: '0' } }, updatedAt: 't-local' },
      },
    });
    const cloud = JSON.stringify({
      version: 1,
      byDate: {
        [scoped]: { lines: { [PRODUCT_ID]: { out: '2', remain: '1' } }, updatedAt: 't-cloud' },
      },
    });
    const merged = JSON.parse(
      mergeStorageKeyRecords('dongshan_stall_inventory_v1', local, cloud) ?? '{}',
    ) as { byDate: Record<string, { lines: Record<string, { out: string }> }> };
    expect(Object.keys(merged.byDate)).toEqual([scoped]);
    expect(Number(merged.byDate[scoped]?.lines[PRODUCT_ID]?.out)).toBe(2);
  });
});
