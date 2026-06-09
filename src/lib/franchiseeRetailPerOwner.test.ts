import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadFranchiseeRetailByItemId,
  mergeFranchiseeRetailStoreJson,
  setFranchiseeRetailPieceForItem,
} from './franchiseeRetailState';

const OWNER_A = 'franchisee-a';
const OWNER_B = 'franchisee-b';

describe('franchisee retail per owner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('兩位加盟主可設定不同零售價', () => {
    setFranchiseeRetailPieceForItem(OWNER_A, 's01', 50);
    setFranchiseeRetailPieceForItem(OWNER_B, 's01', 99);
    expect(loadFranchiseeRetailByItemId(OWNER_A).s01).toBe(50);
    expect(loadFranchiseeRetailByItemId(OWNER_B).s01).toBe(99);
  });

  it('雲端合併保留兩套加盟主價格', () => {
    const local = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_A]: { byId: { s01: 50 }, updatedAt: '2026-06-01T10:00:00.000Z' },
      },
    });
    const cloud = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_B]: { byId: { s01: 99 }, updatedAt: '2026-06-01T11:00:00.000Z' },
      },
    });
    const merged = JSON.parse(mergeFranchiseeRetailStoreJson(local, cloud)) as {
      byOwnerId: Record<string, { byId: Record<string, number> }>;
    };
    expect(merged.byOwnerId[OWNER_A]?.byId.s01).toBe(50);
    expect(merged.byOwnerId[OWNER_B]?.byId.s01).toBe(99);
  });

  it('同一加盟主多機修改不同品項時逐品項合併', () => {
    const local = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_A]: {
          byId: { s01: 50, s02: 20 },
          updatedAt: '2026-06-01T11:00:00.000Z',
          updatedAtByItem: {
            s01: '2026-06-01T11:00:00.000Z',
            s02: '2026-06-01T10:00:00.000Z',
          },
        },
      },
    });
    const cloud = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_A]: {
          byId: { s01: 45, s02: 30 },
          updatedAt: '2026-06-01T11:05:00.000Z',
          updatedAtByItem: {
            s01: '2026-06-01T10:00:00.000Z',
            s02: '2026-06-01T11:05:00.000Z',
          },
        },
      },
    });
    const merged = JSON.parse(mergeFranchiseeRetailStoreJson(local, cloud)) as {
      byOwnerId: Record<string, { byId: Record<string, number> }>;
    };
    expect(merged.byOwnerId[OWNER_A]?.byId.s01).toBe(50);
    expect(merged.byOwnerId[OWNER_A]?.byId.s02).toBe(30);
  });

  it('較新的清除操作不會被舊零售價同步復活', () => {
    const local = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_A]: {
          byId: {},
          updatedAt: '2026-06-01T11:00:00.000Z',
          deletedAtByItem: { s01: '2026-06-01T11:00:00.000Z' },
        },
      },
    });
    const cloud = JSON.stringify({
      version: 2,
      byOwnerId: {
        [OWNER_A]: {
          byId: { s01: 45 },
          updatedAt: '2026-06-01T10:00:00.000Z',
          updatedAtByItem: { s01: '2026-06-01T10:00:00.000Z' },
        },
      },
    });
    const merged = JSON.parse(mergeFranchiseeRetailStoreJson(local, cloud)) as {
      byOwnerId: Record<string, { byId: Record<string, number>; deletedAtByItem?: Record<string, string> }>;
    };
    expect(merged.byOwnerId[OWNER_A]?.byId.s01).toBeUndefined();
    expect(merged.byOwnerId[OWNER_A]?.deletedAtByItem?.s01).toBe('2026-06-01T11:00:00.000Z');
  });
});
