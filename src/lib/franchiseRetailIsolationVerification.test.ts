/**
 * 加盟主 A / B 零售價隔離 + A 店員盤點預估售價 — 自動驗證並輸出報告用數字。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataScopeContext } from './dataScope';
import {
  estimatedRetailPerPackage,
  getAllSupplyItems,
  getSupplyItem,
  resolveSupplyRetailViewForSession,
  userRoleToSupplyRetailView,
} from './supplyCatalog';
import {
  loadFranchiseeRetailByItemId,
  setFranchiseeRetailPieceForItem,
} from './franchiseeRetailState';
import { aggregateStallKpis } from './stallMath';

const ITEM_ID = 's01';
const ITEM_NAME = '黑輪';

const FRANCHISEE_A = 'franchisee-owner-a';
const FRANCHISEE_B = 'franchisee-owner-b';
const EMPLOYEE_A = 'franchisee-emp-a';
const SCOPE_A = `scope:franchisee:${FRANCHISEE_A}`;

const PRICE_A = 42;
const PRICE_B = 77;

/** 模擬盤點：帶出 10、剩餘 3 → 售出 7 */
const STALL_OUT = '10';
const STALL_REMAIN = '3';

let mockScopeId = SCOPE_A;
let mockUserId = EMPLOYEE_A;
let mockRole: 'admin' | 'franchisee' | 'employee' = 'employee';

vi.mock('./dataScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dataScope')>();
  return {
    ...actual,
    getDataScopeContext: vi.fn(() => ({
      isAdmin: mockRole === 'admin',
      scopeId: mockScopeId,
      userId: mockUserId,
      role: mockRole,
    })),
  };
});

export type FranchiseRetailVerificationReport = {
  generatedAt: string;
  itemId: string;
  itemName: string;
  stallScenario: { out: string; remain: string; sold: number };
  pricesSet: { franchiseeA: number; franchiseeB: number };
  retailPerPackageByActor: {
    franchiseeA: number;
    franchiseeB: number;
    employeeUnderA: number;
    hqEmployee: number;
  };
  stallEstRetailTotalByActor: {
    franchiseeA: number;
    franchiseeB: number;
    employeeUnderA: number;
  };
  checks: { name: string; pass: boolean; detail: string }[];
  allPass: boolean;
};

function stallEstRetailTotal(ownerId: string): number {
  const item = getSupplyItem(ITEM_ID, 'franchisee', ownerId);
  if (!item) return 0;
  const k = aggregateStallKpis(
    [ITEM_ID],
    (id) => (id === ITEM_ID ? { out: STALL_OUT, remain: STALL_REMAIN } : { out: '', remain: '' }),
    (id) => getSupplyItem(id, 'franchisee', ownerId),
    { unitBasis: 'retail' },
  );
  return k.retail.estTotal;
}

function retailPkg(ownerId: string): number {
  const item = getSupplyItem(ITEM_ID, 'franchisee', ownerId);
  return item ? estimatedRetailPerPackage(item) : 0;
}

function buildReport(): FranchiseRetailVerificationReport {
  const checks: FranchiseRetailVerificationReport['checks'] = [];

  const pkgA = retailPkg(FRANCHISEE_A);
  const pkgB = retailPkg(FRANCHISEE_B);

  mockScopeId = SCOPE_A;
  mockUserId = EMPLOYEE_A;
  mockRole = 'employee';
  const viewEmp = resolveSupplyRetailViewForSession();
  const pkgEmp = retailPkg(FRANCHISEE_A);

  mockScopeId = 'scope:hq';
  mockUserId = 'hq-emp';
  mockRole = 'employee';
  const viewHq = userRoleToSupplyRetailView('employee');
  const hqItem = getSupplyItem(ITEM_ID, 'headquarter');
  const pkgHq = hqItem ? estimatedRetailPerPackage(hqItem) : 0;

  mockScopeId = SCOPE_A;
  mockUserId = FRANCHISEE_A;
  mockRole = 'franchisee';

  const estA = stallEstRetailTotal(FRANCHISEE_A);
  const estB = stallEstRetailTotal(FRANCHISEE_B);

  mockScopeId = SCOPE_A;
  mockUserId = EMPLOYEE_A;
  mockRole = 'employee';
  const estEmp = stallEstRetailTotal(FRANCHISEE_A);

  const sold = 10 - 3;

  checks.push({
    name: 'A、B 零售單價已分開儲存',
    pass: loadFranchiseeRetailByItemId(FRANCHISEE_A)[ITEM_ID] === PRICE_A && loadFranchiseeRetailByItemId(FRANCHISEE_B)[ITEM_ID] === PRICE_B,
    detail: `A=${loadFranchiseeRetailByItemId(FRANCHISEE_A)[ITEM_ID]} B=${loadFranchiseeRetailByItemId(FRANCHISEE_B)[ITEM_ID]}`,
  });
  checks.push({
    name: '加盟主 A 讀取零售價',
    pass: pkgA === PRICE_A,
    detail: `預期 ${PRICE_A}，實際 ${pkgA}`,
  });
  checks.push({
    name: '加盟主 B 讀取零售價',
    pass: pkgB === PRICE_B,
    detail: `預期 ${PRICE_B}，實際 ${pkgB}`,
  });
  checks.push({
    name: 'A 店員視角為 franchisee（非 headquarter）',
    pass: viewEmp === 'franchisee',
    detail: `視角=${viewEmp}`,
  });
  checks.push({
    name: 'A 店員零售單價與 A 相同',
    pass: pkgEmp === pkgA && pkgEmp !== pkgB,
    detail: `店員=${pkgEmp} A=${pkgA} B=${pkgB}`,
  });
  checks.push({
    name: 'A 店員盤點預估售價與 A 相同',
    pass: estEmp === estA && estEmp !== estB,
    detail: `店員預估=${estEmp} A=${estA} B=${estB}`,
  });
  checks.push({
    name: '預估售價公式（帶出×零售）',
    pass: estA === Math.round(Number(STALL_OUT) * PRICE_A),
    detail: `${STALL_OUT}×${PRICE_A}=${Number(STALL_OUT) * PRICE_A} → 四捨五入 ${estA}`,
  });
  checks.push({
    name: '直營店員不讀加盟專庫',
    pass: viewHq === 'headquarter' && pkgHq !== PRICE_A && pkgHq !== PRICE_B,
    detail: `直營視角=${viewHq} 零售=${pkgHq}`,
  });

  const allPass = checks.every((c) => c.pass);

  return {
    generatedAt: new Date().toISOString(),
    itemId: ITEM_ID,
    itemName: ITEM_NAME,
    stallScenario: { out: STALL_OUT, remain: STALL_REMAIN, sold },
    pricesSet: { franchiseeA: PRICE_A, franchiseeB: PRICE_B },
    retailPerPackageByActor: {
      franchiseeA: pkgA,
      franchiseeB: pkgB,
      employeeUnderA: pkgEmp,
      hqEmployee: pkgHq,
    },
    stallEstRetailTotalByActor: {
      franchiseeA: estA,
      franchiseeB: estB,
      employeeUnderA: estEmp,
    },
    checks,
    allPass,
  };
}

describe('加盟零售價隔離 — 自動驗證報告', () => {
  beforeEach(() => {
    localStorage.clear();
    setFranchiseeRetailPieceForItem(FRANCHISEE_A, ITEM_ID, PRICE_A);
    setFranchiseeRetailPieceForItem(FRANCHISEE_B, ITEM_ID, PRICE_B);
    mockScopeId = SCOPE_A;
    mockUserId = EMPLOYEE_A;
    mockRole = 'employee';
  });

  it('產出視覺化報告用數字且全部通過', () => {
    const report = buildReport();
    (globalThis as { __FRANCHISE_RETAIL_REPORT__?: FranchiseRetailVerificationReport }).__FRANCHISE_RETAIL_REPORT__ =
      report;

    expect(report.allPass, JSON.stringify(report.checks.filter((c) => !c.pass), null, 2)).toBe(true);
    expect(report.retailPerPackageByActor.employeeUnderA).toBe(PRICE_A);
    expect(report.retailPerPackageByActor.franchiseeB).toBe(PRICE_B);
    expect(report.stallEstRetailTotalByActor.employeeUnderA).toBe(report.stallEstRetailTotalByActor.franchiseeA);
    expect(report.stallEstRetailTotalByActor.franchiseeB).toBe(Math.round(10 * PRICE_B));
  });
});
