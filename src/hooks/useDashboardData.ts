import { useCallback, useEffect, useMemo, useState } from 'react';
import { ledger, orders, salesRecords } from '../services/apiService';
import {
  ACCOUNTING_LEDGER_UPDATED_EVENT,
  type AccountingLedgerEntry,
} from '../lib/accountingLedgerStorage';
import {
  orderMatchesSessionScope,
  type OrderHistoryEntry,
  type FranchiseManagementOrder,
} from '../lib/orderHistoryStorage';
import { HQ_SCOPE_ID } from '../lib/dataScope';
import type { SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { scopedStallDateKey } from '../lib/scopedStallDateKey';

export type DashboardOrder = OrderHistoryEntry;

function salesRecordCacheKey(ymd: string, scopeId: string): string {
  return scopedStallDateKey(scopeId, ymd);
}

function runWhenDashboardIdle(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const idle = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idle.requestIdleCallback === 'function') {
    const handle = idle.requestIdleCallback(fn, { timeout: 1200 });
    return () => idle.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(fn, 300);
  return () => window.clearTimeout(handle);
}

function mapMgmtToDashboardOrder(m: FranchiseManagementOrder): DashboardOrder {
  return {
    id: m.id,
    createdAt: m.createdAt,
    orderDateYmd: m.orderDateYmd,
    updatedAt: m.updatedAt,
    source: m.source,
    totalAmount: m.totalAmount,
    payableAmount: m.payableAmount ?? m.totalAmount,
    selfSuppliedCostAmount: m.selfSuppliedCostAmount ?? 0,
    itemCount: m.itemCount,
    lines: m.lines,
    actorRole: 'admin',
    storeLabel: m.storeLabel,
    status: m.status,
    stallCountBasisYmd: m.stallCountBasisYmd,
    stallCountCompletedAt: m.stallCountCompletedAt,
    stallCountSnapshot: m.stallCountSnapshot,
    scopeId: m.scopeId,
    actorUserId: m.actorUserId,
    createdByName: m.createdByName,
    stallCountCompletedByName: m.stallCountCompletedByName,
    stallCountCompletedByUserId: m.stallCountCompletedByUserId,
    lastUpdatedByName: m.lastUpdatedByName,
  };
}

/** 營運概況：經 apiService 載入訂單、流水帳、銷售紀錄，支援 remote 同步。 */
export function useDashboardData(viewAsFranchiseeUserId: string | null) {
  const [orderTick, setOrderTick] = useState(0);
  const [financeTick, setFinanceTick] = useState(0);
  const [salesRecordTick, setSalesRecordTick] = useState(0);
  const [dashboardOrders, setDashboardOrders] = useState<DashboardOrder[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<AccountingLedgerEntry[]>([]);
  const [salesRecordMap, setSalesRecordMap] = useState<Record<string, SalesRecordDaySnapshot>>({});
  const [salesRecordsReady, setSalesRecordsReady] = useState(false);

  const reloadOrders = useCallback(async () => {
    const [mgmt, history] = await Promise.all([
      orders.loadFranchiseManagementOrders(),
      orders.loadOrderHistory(),
    ]);
    const all = [...mgmt.map(mapMgmtToDashboardOrder), ...history].filter((o) =>
      orderMatchesSessionScope(o),
    );
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    setDashboardOrders(all);
  }, []);

  const reloadLedger = useCallback(async () => {
    if (viewAsFranchiseeUserId) {
      setLedgerEntries(await ledger.listForScopeId(`scope:franchisee:${viewAsFranchiseeUserId}`));
      return;
    }
    setLedgerEntries(await ledger.listEntries());
  }, [viewAsFranchiseeUserId]);

  const reloadSalesRecords = useCallback(async () => {
    setSalesRecordsReady(false);
    const scopeFilter = viewAsFranchiseeUserId ? `scope:franchisee:${viewAsFranchiseeUserId}` : undefined;
    const meta = await salesRecords.listMeta(scopeFilter);
    const entries = await Promise.all(
      meta.map(async (m) => {
        const snap = await salesRecords.get(m.ymd, m.scopeId);
        return snap ? { key: salesRecordCacheKey(m.ymd, m.scopeId), snap } : null;
      }),
    );
    const next: Record<string, SalesRecordDaySnapshot> = {};
    for (const row of entries) {
      if (row) next[row.key] = row.snap;
    }
    setSalesRecordMap(next);
    setSalesRecordsReady(true);
  }, [viewAsFranchiseeUserId]);

  const reloadPrimary = useCallback(async () => {
    await Promise.all([reloadOrders(), reloadLedger()]);
  }, [reloadOrders, reloadLedger]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reloadPrimary();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadPrimary, orderTick, financeTick]);

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = runWhenDashboardIdle(() => {
      if (cancelled) return;
      void reloadSalesRecords();
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [reloadSalesRecords, orderTick, salesRecordTick]);

  useEffect(() => {
    const bumpOrders = () => setOrderTick((t) => t + 1);
    const bumpSalesRecords = () => setSalesRecordTick((t) => t + 1);
    window.addEventListener('orderHistoryUpdated', bumpOrders);
    window.addEventListener('franchiseManagementOrdersUpdated', bumpOrders);
    window.addEventListener('salesRecordUpdated', bumpSalesRecords);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bumpOrders);
      window.removeEventListener('franchiseManagementOrdersUpdated', bumpOrders);
      window.removeEventListener('salesRecordUpdated', bumpSalesRecords);
    };
  }, []);

  useEffect(() => {
    const bumpFinance = () => setFinanceTick((t) => t + 1);
    window.addEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bumpFinance);
    return () => window.removeEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bumpFinance);
  }, []);

  const getSalesRecordCached = useCallback(
    (ymd: string, scopeId: string = HQ_SCOPE_ID): SalesRecordDaySnapshot | null => {
      return salesRecordMap[salesRecordCacheKey(ymd, scopeId)] ?? null;
    },
    [salesRecordMap],
  );

  const patchRevenueGapReason = useCallback(
    async (ymd: string, reason: string, scopeId?: string) => {
      await salesRecords.patchRevenueGapReason(ymd, reason, scopeId);
      await reloadSalesRecords();
    },
    [reloadSalesRecords],
  );

  return useMemo(
    () => ({
      dashboardOrders,
      ledgerEntries,
      getSalesRecordCached,
      patchRevenueGapReason,
      orderTick,
      financeTick,
      salesRecordsReady,
    }),
    [
      dashboardOrders,
      ledgerEntries,
      getSalesRecordCached,
      patchRevenueGapReason,
      orderTick,
      financeTick,
      salesRecordsReady,
    ],
  );
}
