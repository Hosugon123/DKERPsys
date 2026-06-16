/**
 * 加盟店 A／B 與直營店帳務、庫存、銷售紀錄互不干擾 — 回歸測試
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeStorageKeyRecords } from './bundleRecordMerge';
import { appendAccountingLedgerEntry, listAccountingLedgerEntriesForScopeId } from './accountingLedgerStorage';
import { loadOrderHistory } from './orderHistoryStorage';
import { resolveOrderStoreLabel } from './orderStoreLabel';
import { scopedStallDateKey } from './scopedStallDateKey';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import { loadDay, saveDay } from './stallInventoryStorage';
import { listUncountedCompletedProcurementOrdersForSession } from './stallInventoryStorage';

const FR_A = 'franchisee-a';
const FR_B = 'franchisee-b';
const SCOPE_A = `scope:franchisee:${FR_A}`;
const SCOPE_B = `scope:franchisee:${FR_B}`;
const HQ_SCOPE = 'scope:hq';
const YMD = '2026-06-10';

const sessionRef = vi.hoisted(() => ({
  userId: 'franchisee-a',
  role: 'franchisee' as 'franchisee' | 'employee',
}));

vi.mock('./authSession', () => ({
  readSession: () => ({ userId: sessionRef.userId, role: sessionRef.role }),
}));

vi.mock('./systemUsersStorage', () => ({
  listSystemUsers: () => [
    { id: FR_A, name: '加盟甲', role: 'franchisee', storeLabel: '甲店' },
    { id: FR_B, name: '加盟乙', role: 'franchisee', storeLabel: '乙店' },
    { id: 'hq-emp', name: '直營員', role: 'employee', employeeOrgType: 'hq' },
  ],
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試員',
  resolveUserDisplayNameById: (id: string) =>
    ({ [FR_A]: '加盟甲', [FR_B]: '加盟乙', 'hq-emp': '直營員' })[id] ?? '',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

vi.mock('./supplyCatalog', () => ({
  getAllSupplyItems: () => [],
  getSupplyItem: () => undefined,
  isConsumableItem: () => false,
}));

function seedOrders() {
  const mk = (
    id: string,
    scopeId: string,
    actorUserId: string,
    actorRole: 'franchisee' | 'employee',
    storeLabel: string,
  ) => ({
    id,
    createdAt: `${YMD}T08:00:00.000Z`,
    orderDateYmd: YMD,
    updatedAt: `${YMD}T08:00:00.000Z`,
    source: 'procurement',
    status: '已完成',
    totalAmount: 100,
    payableAmount: 100,
    itemCount: 1,
    lines: [{ productId: 'p1', name: '品', unitPrice: 100, qty: 1, unit: '隻' }],
    actorRole,
    storeLabel,
    scopeId,
    actorUserId,
  });
  localStorage.setItem(
    'dongshan_order_history_v1',
    JSON.stringify([
      mk('order-a', SCOPE_A, FR_A, 'franchisee', '甲店'),
      mk('order-b', SCOPE_B, FR_B, 'franchisee', '乙店'),
      mk('order-hq', HQ_SCOPE, 'hq-emp', 'employee', '直營店'),
    ]),
  );
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
}

describe('各店帳務 scope 隔離', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionRef.userId = FR_A;
    sessionRef.role = 'franchisee';
    localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem(
      'dongshan_accounting_ledger_v1',
      JSON.stringify({ version: 2, byScope: {} }),
    );
  });

  it('加盟 A 登入僅看見自己店訂單，不含 B 店與直營', () => {
    seedOrders();
    const ids = loadOrderHistory().map((o) => o.id);
    expect(ids).toEqual(['order-a']);
    expect(resolveOrderStoreLabel(loadOrderHistory()[0]!)).toBe('甲店');
  });

  it('加盟 B 登入僅看見自己店訂單', () => {
    seedOrders();
    sessionRef.userId = FR_B;
    const ids = loadOrderHistory().map((o) => o.id);
    expect(ids).toEqual(['order-b']);
    expect(resolveOrderStoreLabel(loadOrderHistory()[0]!)).toBe('乙店');
  });

  it('盤點選單僅列出本店未盤點單（不因管理員放寬）', () => {
    seedOrders();
    const menuA = listUncountedCompletedProcurementOrdersForSession().map((o) => o.id);
    expect(menuA).toEqual(['order-a']);

    sessionRef.userId = FR_B;
    const menuB = listUncountedCompletedProcurementOrdersForSession().map((o) => o.id);
    expect(menuB).toEqual(['order-b']);
  });

  it('同日銷售紀錄：甲店、乙店、直營各寫各桶', () => {
    saveSalesRecord(YMD, { lines: {}, actualRevenue: '1111', updatedAt: 't1' }, SCOPE_A);
    saveSalesRecord(YMD, { lines: {}, actualRevenue: '2222', updatedAt: 't2' }, SCOPE_B);
    saveSalesRecord(YMD, { lines: {}, actualRevenue: '3333', updatedAt: 't3' }, HQ_SCOPE);

    expect(getSalesRecord(YMD, SCOPE_A)?.actualRevenue).toBe('1111');
    expect(getSalesRecord(YMD, SCOPE_B)?.actualRevenue).toBe('2222');
    expect(getSalesRecord(YMD, HQ_SCOPE)?.actualRevenue).toBe('3333');
    // 甲店讀不到乙店
    expect(getSalesRecord(YMD, SCOPE_A)?.actualRevenue).not.toBe('2222');
  });

  it('同日攤上日庫：各 scope 獨立', () => {
    saveDay(YMD, { lines: { p1: { out: '1', remain: '0' } }, actualRevenue: '', updatedAt: 't1' }, SCOPE_A);
    saveDay(YMD, { lines: { p1: { out: '9', remain: '5' } }, actualRevenue: '', updatedAt: 't2' }, SCOPE_B);
    expect(loadDay(YMD, SCOPE_A).lines.p1?.out).toBe('1');
    expect(loadDay(YMD, SCOPE_B).lines.p1?.out).toBe('9');
  });

  it('流水帳 byScope：各店支出分帳', () => {
    sessionRef.userId = FR_A;
    appendAccountingLedgerEntry({
      dateYmd: YMD,
      flowType: 'expense',
      category: '加盟店營業支出',
      note: '甲店水電',
      amount: 100,
    });
    sessionRef.userId = FR_B;
    appendAccountingLedgerEntry({
      dateYmd: YMD,
      flowType: 'expense',
      category: '加盟店營業支出',
      note: '乙店水電',
      amount: 200,
    });
    sessionRef.userId = 'hq-emp';
    sessionRef.role = 'employee';
    appendAccountingLedgerEntry({
      dateYmd: YMD,
      flowType: 'expense',
      category: '直營店營業支出',
      note: '直營耗材',
      amount: 300,
    });

    expect(listAccountingLedgerEntriesForScopeId(SCOPE_A).map((e) => e.note)).toEqual(['甲店水電']);
    expect(listAccountingLedgerEntriesForScopeId(SCOPE_B).map((e) => e.note)).toEqual(['乙店水電']);
    expect(listAccountingLedgerEntriesForScopeId(HQ_SCOPE).map((e) => e.note)).toEqual(['直營耗材']);
  });

  it('雲端合併：同日三店 scoped 鍵並存不互蓋', () => {
    const keyA = scopedStallDateKey(SCOPE_A, YMD);
    const keyB = scopedStallDateKey(SCOPE_B, YMD);
    const keyHq = scopedStallDateKey(HQ_SCOPE, YMD);
    const local = JSON.stringify({
      version: 1,
      byDate: { [keyA]: { lines: {}, actualRevenue: '1111', updatedAt: 'l' } },
    });
    const cloud = JSON.stringify({
      version: 1,
      byDate: {
        [keyB]: { lines: {}, actualRevenue: '2222', updatedAt: 'c1' },
        [keyHq]: { lines: {}, actualRevenue: '3333', updatedAt: 'c2' },
      },
    });
    const merged = JSON.parse(
      mergeStorageKeyRecords('dongshan_sales_records_v1', local, cloud) ?? '{}',
    ) as { byDate: Record<string, { actualRevenue: string }> };
    expect(merged.byDate[keyA]?.actualRevenue).toBe('1111');
    expect(merged.byDate[keyB]?.actualRevenue).toBe('2222');
    expect(merged.byDate[keyHq]?.actualRevenue).toBe('3333');
    expect(Object.keys(merged.byDate).sort()).toEqual([keyA, keyB, keyHq].sort());
  });
});
