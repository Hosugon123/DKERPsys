/**
 * 跨模組資料一致性整合測試：
 * 叫貨 → 盤點完成 → 銷售紀錄 → 儀表板財務 → 流水帳
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  deleteOrderByIdFromAnyStore,
  loadOrderHistory,
  listOrdersWithStallCountCompleted,
  readMergedOrderByIdFromStores,
  setOrderStallCountStamp,
  stallCountSnapshotPersistedMatches,
  updateOrderStatusInEitherStore,
  type OrderHistoryLine,
} from './orderHistoryStorage';
import {
  appendAccountingLedgerEntry,
  listAccountingLedgerEntriesForScopeId,
} from './accountingLedgerStorage';
import {
  computeAdminDashboardFinanceForYmdRange,
  computeStallGapSummary,
} from './financeLib';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import { loadDay, loadDayForProcurement, saveDay } from './stallInventoryStorage';
import { HQ_SCOPE_ID } from './dataScope';
import type { SalesRecordDaySnapshot } from './salesRecordStorage';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'admin',
    userId: 'admin-1',
    scopeId: 'scope:hq',
    isAdmin: true,
  }),
  HQ_SCOPE_ID: 'scope:hq',
  resolveAccountingLedgerScopeId: () => 'scope:hq',
  resolveFranchiseeRetailOwnerUserId: () => null,
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試管理員',
  resolveUserDisplayNameById: () => '測試管理員',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => 'ORD-20260603-001',
}));

const DUCK_HEAD_ID = 's20';
const BASIS_YMD = '2026-06-03';
const ORDER_LINES: OrderHistoryLine[] = [
  { productId: DUCK_HEAD_ID, name: '鴨頭', unitPrice: 50, qty: 20, unit: '份' },
];

function seedEmptyStores() {
  localStorage.clear();
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem(
    'dongshan_accounting_ledger_v1',
    JSON.stringify({ version: 2, byScope: {} }),
  );
  localStorage.setItem('dongshan_deleted_order_ids_v1', JSON.stringify({ version: 1, byId: {} }));
}

function makeSnapshot(overrides: Partial<SalesRecordDaySnapshot> = {}): SalesRecordDaySnapshot {
  return {
    lines: { [DUCK_HEAD_ID]: { out: '20', remain: '2' } },
    actualRevenue: '9000',
    revenueGapAmount: '100',
    revenueGapReason: '零錢短少',
    updatedAt: '2026-06-03T18:00:00.000Z',
    ...overrides,
  };
}

describe('跨模組資料一致性', () => {
  beforeEach(() => {
    seedEmptyStores();
  });

  describe('叫貨 → 盤點 → 三份資料同步', () => {
    it('盤點完成後：訂單押記、攤上日庫、銷售日庫三者一致', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');

      const snap = makeSnapshot();
      const completedAt = '2026-06-03T18:00:00.000Z';

      expect(
        setOrderStallCountStamp('ORD-20260603-001', {
          basisYmd: BASIS_YMD,
          completedAt,
          snapshot: snap,
        }),
      ).toBe(true);

      saveDay(BASIS_YMD, { lines: snap.lines, actualRevenue: snap.actualRevenue, updatedAt: completedAt });
      saveSalesRecord(BASIS_YMD, snap);

      const orderSnap = readMergedOrderByIdFromStores('ORD-20260603-001')?.stallCountSnapshot;
      const stallDay = loadDay(BASIS_YMD);
      const salesDay = getSalesRecord(BASIS_YMD);

      expect(stallCountSnapshotPersistedMatches(orderSnap, snap)).toBe(true);
      expect(String(stallDay.actualRevenue).trim()).toBe('9000');
      expect(String(salesDay?.actualRevenue).trim()).toBe('9000');
      expect(Number(stallDay.lines[DUCK_HEAD_ID]?.remain)).toBe(2);
      expect(Number(salesDay?.lines[DUCK_HEAD_ID]?.remain)).toBe(2);
    });
  });

  describe('叫貨與流水帳脫鉤', () => {
    it('叫貨完成不會自動產生流水帳分錄', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');

      const ledgerBefore = listAccountingLedgerEntriesForScopeId(HQ_SCOPE_ID);
      expect(ledgerBefore).toHaveLength(0);

      const fin = computeAdminDashboardFinanceForYmdRange('2026-06-01', '2026-06-30');
      expect(fin.procurementCostTotal).toBe(0);
      expect(fin.directStoreProcurementTotal).toBeGreaterThan(0);
    });

    it('手動登記食材支出後，COGS 與叫貨金額可各自獨立', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');

      appendAccountingLedgerEntry({
        dateYmd: BASIS_YMD,
        flowType: 'expense',
        category: '食材支出',
        subCategory: '鴨貨類',
        note: '手動進貨',
        amount: 800,
      });

      const ledger = listAccountingLedgerEntriesForScopeId(HQ_SCOPE_ID);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].amount).toBe(800);
      expect(ledger[0].expenseDomain).toBe('ingredient_cogs');

      const fin = computeAdminDashboardFinanceForYmdRange('2026-06-01', '2026-06-30');
      expect(fin.procurementCostTotal).toBe(0);
      expect(fin.ledgerExpenseTotal).toBe(800);
    });
  });

  describe('儀表板淨利公式', () => {
    it('淨利 = 直營實收 + 加盟批貨 − 流水帳總支出', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');
      setOrderStallCountStamp('ORD-20260603-001', {
        basisYmd: BASIS_YMD,
        completedAt: '2026-06-03T18:00:00.000Z',
        snapshot: makeSnapshot({ actualRevenue: '9000' }),
      });

      appendAccountingLedgerEntry({
        dateYmd: BASIS_YMD,
        flowType: 'expense',
        category: '房租',
        note: '月租',
        amount: 5000,
      });

      const fin = computeAdminDashboardFinanceForYmdRange('2026-06-01', '2026-06-30');
      expect(fin.directStoreActualRevenueTotal).toBe(9000);
      expect(fin.ledgerExpenseTotal).toBe(5000);
      expect(fin.revenueTotal).toBe(fin.directStoreActualRevenueTotal + fin.franchiseeOrderTotal);
      expect(fin.netProfit).toBe(fin.revenueTotal - fin.expenseTotal);
    });
  });

  describe('盤點落差計算', () => {
    it('帳面短收與登記落差正確彙總，呆帳推估不低於 0', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');
      setOrderStallCountStamp('ORD-20260603-001', {
        basisYmd: BASIS_YMD,
        completedAt: '2026-06-03T18:00:00.000Z',
        snapshot: makeSnapshot({
          actualRevenue: '8500',
          revenueGapAmount: '200',
          revenueGapReason: '零錢短少',
        }),
      });

      const orders = listOrdersWithStallCountCompleted();
      expect(orders.length).toBeGreaterThan(0);
      const gap = computeStallGapSummary(orders, { type: 'ymd', startYmd: '2026-06-01', endYmd: '2026-06-30' });

      expect(gap.loggedGapSum).toBe(200);
      expect(gap.bookShortfallSum).toBeGreaterThanOrEqual(0);
      expect(gap.badDebtEstimate).toBeGreaterThanOrEqual(0);
      expect(gap.badDebtEstimate).toBe(
        Math.max(0, gap.bookShortfallSum - Math.abs(gap.loggedGapSum)),
      );
      expect(gap.rows.length).toBeGreaterThan(0);
    });
  });

  describe('刪單連動清理', () => {
    it('刪除訂單後，若該盤點日無其他完成單，清除 stall/sales 日庫', () => {
      appendProcurementOrderEntry({
        lines: ORDER_LINES,
        totalAmount: 1000,
        actorRole: 'admin',
        orderDateYmd: BASIS_YMD,
      });
      updateOrderStatusInEitherStore('ORD-20260603-001', '已完成');
      const snap = makeSnapshot();
      setOrderStallCountStamp('ORD-20260603-001', {
        basisYmd: BASIS_YMD,
        completedAt: '2026-06-03T18:00:00.000Z',
        snapshot: snap,
      });
      saveDay(BASIS_YMD, { lines: snap.lines, actualRevenue: snap.actualRevenue, updatedAt: snap.updatedAt });
      saveSalesRecord(BASIS_YMD, snap);

      expect(deleteOrderByIdFromAnyStore('ORD-20260603-001')).toBe(true);
      expect(readMergedOrderByIdFromStores('ORD-20260603-001')).toBeNull();

      expect(loadDayForProcurement(BASIS_YMD).lines[DUCK_HEAD_ID]?.remain).toBeFalsy();
      expect(getSalesRecord(BASIS_YMD)?.lines[DUCK_HEAD_ID]?.remain).toBeFalsy();
    });
  });
});
