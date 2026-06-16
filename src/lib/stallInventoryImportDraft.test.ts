import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadDay,
  recomputeStallOutForStallYmdAndOrder,
  type DaySnapshot,
} from './stallInventoryStorage';

const PRODUCT_ID = 'draft-duck-1';
const ORDER_ID = 'draft-import-order-1';
const YMD = '2026-06-17';

vi.mock('./supplyCatalog', () => ({
  getAllSupplyItems: () => [
    {
      id: PRODUCT_ID,
      name: 'Draft Duck',
      category: 'food',
      pieceUnit: 'box',
      pricePerPiece: 100,
    },
  ],
  getSupplyItem: (id: string) =>
    id === PRODUCT_ID
      ? {
          id: PRODUCT_ID,
          name: 'Draft Duck',
          category: 'food',
          pieceUnit: 'box',
          pricePerPiece: 100,
        }
      : undefined,
  isConsumableItem: () => false,
}));

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'admin',
    userId: 'admin-1',
    scopeId: 'scope:hq',
    isAdmin: true,
  }),
  HQ_SCOPE_ID: 'scope:hq',
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => 'Admin',
  resolveUserDisplayNameById: () => 'Admin',
}));

function seedOrder(qty: number) {
  const row = {
    id: ORDER_ID,
    createdAt: `${YMD}T10:00:00.000Z`,
    orderDateYmd: YMD,
    updatedAt: `${YMD}T10:00:00.000Z`,
    source: 'procurement' as const,
    status: 'pending',
    totalAmount: qty * 100,
    payableAmount: qty * 100,
    itemCount: qty,
    lines: [
      {
        productId: PRODUCT_ID,
        name: 'Draft Duck',
        qty,
        unitPrice: 100,
        unit: 'box',
      },
    ],
    actorRole: 'admin' as const,
    storeLabel: 'HQ',
    scopeId: 'scope:hq',
  };
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([row]));
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([row]));
}

describe('stall inventory order import draft mode', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
  });

  it('computes imported out quantities without saving the day when persist is false', () => {
    seedOrder(4);
    const beforeRaw = localStorage.getItem('dongshan_stall_inventory_v1');
    const editorSnap: DaySnapshot = {
      ...loadDay(YMD),
      lines: { [PRODUCT_ID]: { out: '', remain: '2' } },
    };

    const next = recomputeStallOutForStallYmdAndOrder(YMD, ORDER_ID, editorSnap, {
      clearRemain: true,
      persist: false,
    });

    expect(next.lines[PRODUCT_ID]?.out).toBe('4');
    expect(next.lines[PRODUCT_ID]?.remain).toBe('');
    expect(localStorage.getItem('dongshan_stall_inventory_v1')).toBe(beforeRaw);
  });
});
