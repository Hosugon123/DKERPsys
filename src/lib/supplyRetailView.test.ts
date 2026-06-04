import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFranchiseeRetailPieceForItem } from './franchiseeRetailState';
import {
  getSupplyItem,
  resolveSupplyRetailViewForSession,
  userRoleToSupplyRetailView,
} from './supplyCatalog';

let mockScopeId = 'scope:hq';

vi.mock('./dataScope', () => ({
  HQ_SCOPE_ID: 'scope:hq',
  getDataScopeContext: () => ({
    isAdmin: false,
    scopeId: mockScopeId,
    userId: 'u1',
    role: 'employee' as const,
  }),
  franchiseeOwnerUserIdFromScopeId: (scopeId: string) => {
    const m = /^scope:franchisee:(.+)$/.exec(scopeId);
    return m?.[1]?.trim() || null;
  },
  resolveFranchiseeRetailOwnerUserId: (explicit?: string) => {
    if (explicit?.trim()) return explicit.trim();
    const m = /^scope:franchisee:(.+)$/.exec(mockScopeId);
    return m?.[1]?.trim() || null;
  },
}));

describe('supply retail view for franchise staff', () => {
  beforeEach(() => {
    localStorage.clear();
    mockScopeId = 'scope:franchisee:boss-1';
    setFranchiseeRetailPieceForItem('boss-1', 's01', 88);
  });

  it('加盟店員使用加盟主零售視角，而非直營', () => {
    expect(resolveSupplyRetailViewForSession()).toBe('franchisee');
    expect(userRoleToSupplyRetailView('employee')).toBe('franchisee');
  });

  it('加盟視角讀取該加盟主專庫零售價', () => {
    const item = getSupplyItem('s01', 'franchisee', 'boss-1');
    expect(item?.retailPerPiece).toBe(88);
  });

  it('直營店員仍使用總部零售視角', () => {
    mockScopeId = 'scope:hq';
    expect(userRoleToSupplyRetailView('employee')).toBe('headquarter');
  });
});
