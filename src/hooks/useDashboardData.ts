import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ledger, orders, salesRecords } from '../services/apiService';
import {
  ACCOUNTING_LEDGER_UPDATED_EVENT,
  type AccountingLedgerEntry,
} from '../lib/accountingLedgerStorage';
import {
  effectiveOrderDateYmd,
  orderMatchesSessionScope,
  type OrderHistoryEntry,
  type FranchiseManagementOrder,
} from '../lib/orderHistoryStorage';
import { HQ_SCOPE_ID } from '../lib/dataScope';
import type { SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { scopedStallDateKey } from '../lib/scopedStallDateKey';
import { reportPerfMetric, timeAsync } from '../lib/performanceDebug';

export type DashboardOrder = OrderHistoryEntry;
export type DashboardOrderDateRange = { startYmd: string; endYmd: string };

function orderStallYmdForRange(o: Pick<DashboardOrder, 'stallCountBasisYmd' | 'stallCountCompletedAt'>): string {
  const basis = o.stallCountBasisYmd?.trim();
  if (basis && /^\d{4}-\d{2}-\d{2}$/.test(basis)) return basis;
  const completed = o.stallCountCompletedAt?.trim();
  if (completed) return completed.slice(0, 10);
  return '';
}

function ymdInRange(ymd: string, range: DashboardOrderDateRange): boolean {
  return ymd >= range.startYmd && ymd <= range.endYmd;
}

function orderMatchesDashboardDateRanges(
  order: DashboardOrder,
  ranges: readonly DashboardOrderDateRange[] | undefined,
): boolean {
  if (!ranges || ranges.length === 0) return true;
  const bookYmd = effectiveOrderDateYmd(order);
  const stallYmd = orderStallYmdForRange(order);
  return ranges.some((range) => ymdInRange(bookYmd, range) || Boolean(stallYmd && ymdInRange(stallYmd, range)));
}

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
export function useDashboardData(
  viewAsFranchiseeUserId: string | null,
  orderDateRanges?: readonly DashboardOrderDateRange[],
) {
  const [orderTick, setOrderTick] = useState(0);
  const [financeTick, setFinanceTick] = useState(0);
  const [salesRecordTick, setSalesRecordTick] = useState(0);
  const [dashboardOrders, setDashboardOrders] = useState<DashboardOrder[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<AccountingLedgerEntry[]>([]);
  const [salesRecordMap, setSalesRecordMap] = useState<Record<string, SalesRecordDaySnapshot>>({});
  const [salesRecordsReady, setSalesRecordsReady] = useState(false);
  const orderTickFrameRef = useRef<number | null>(null);
  const financeTickFrameRef = useRef<number | null>(null);
  const salesRecordTickFrameRef = useRef<number | null>(null);

  const bumpOrderTick = useCallback(() => {
    if (orderTickFrameRef.current != null) return;
    orderTickFrameRef.current = window.requestAnimationFrame(() => {
      orderTickFrameRef.current = null;
      setOrderTick((t) => t + 1);
    });
  }, []);

  const bumpFinanceTick = useCallback(() => {
    if (financeTickFrameRef.current != null) return;
    financeTickFrameRef.current = window.requestAnimationFrame(() => {
      financeTickFrameRef.current = null;
      setFinanceTick((t) => t + 1);
    });
  }, []);

  const bumpSalesRecordTick = useCallback(() => {
    if (salesRecordTickFrameRef.current != null) return;
    salesRecordTickFrameRef.current = window.requestAnimationFrame(() => {
      salesRecordTickFrameRef.current = null;
      setSalesRecordTick((t) => t + 1);
    });
  }, []);

  const reloadOrders = useCallback(async () => {
    const [mgmt, history] = await timeAsync('dashboard.reload-orders.read', () =>
      Promise.all([
        orders.loadFranchiseManagementOrders(),
        orders.loadOrderHistory(),
      ]),
    );
    const all = [...mgmt.map(mapMgmtToDashboardOrder), ...history].filter((o) =>
      orderMatchesSessionScope(o) && orderMatchesDashboardDateRanges(o, orderDateRanges),
    );
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    reportPerfMetric({
      name: 'dashboard.reload-orders.count',
      details: { managementOrders: mgmt.length, historyOrders: history.length, visibleOrders: all.length },
    });
    setDashboardOrders(all);
  }, [orderDateRanges]);

  const reloadLedger = useCallback(async () => {
    if (viewAsFranchiseeUserId) {
      setLedgerEntries(
        await timeAsync('dashboard.reload-ledger.read-scoped', () =>
          ledger.listForScopeId(`scope:franchisee:${viewAsFranchiseeUserId}`),
        ),
      );
      return;
    }
    setLedgerEntries(await timeAsync('dashboard.reload-ledger.read-all', () => ledger.listEntries()));
  }, [viewAsFranchiseeUserId]);

  const reloadSalesRecords = useCallback(async () => {
    setSalesRecordsReady(false);
    const scopeFilter = viewAsFranchiseeUserId ? `scope:franchisee:${viewAsFranchiseeUserId}` : undefined;
    const entries = await timeAsync(
      'dashboard.reload-sales-records.snapshots',
      () => salesRecords.listSnapshots(scopeFilter, orderDateRanges),
      { scopeFilter, rangeCount: orderDateRanges?.length ?? 0 },
    );
    const next: Record<string, SalesRecordDaySnapshot> = {};
    for (const row of entries) {
      next[salesRecordCacheKey(row.ymd, row.scopeId)] = row.snapshot;
    }
    reportPerfMetric({
      name: 'dashboard.reload-sales-records.count',
      details: { snapshotCount: Object.keys(next).length, scopeFilter },
    });
    setSalesRecordMap(next);
    setSalesRecordsReady(true);
  }, [viewAsFranchiseeUserId, orderDateRanges]);

  const reloadPrimary = useCallback(async () => {
    await timeAsync('dashboard.reload-primary', () => Promise.all([reloadOrders(), reloadLedger()]).then(() => undefined));
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
    window.addEventListener('orderHistoryUpdated', bumpOrderTick);
    window.addEventListener('franchiseManagementOrdersUpdated', bumpOrderTick);
    window.addEventListener('salesRecordUpdated', bumpSalesRecordTick);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bumpOrderTick);
      window.removeEventListener('franchiseManagementOrdersUpdated', bumpOrderTick);
      window.removeEventListener('salesRecordUpdated', bumpSalesRecordTick);
      if (orderTickFrameRef.current != null) window.cancelAnimationFrame(orderTickFrameRef.current);
      if (salesRecordTickFrameRef.current != null) window.cancelAnimationFrame(salesRecordTickFrameRef.current);
    };
  }, [bumpOrderTick, bumpSalesRecordTick]);

  useEffect(() => {
    window.addEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bumpFinanceTick);
    return () => {
      window.removeEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bumpFinanceTick);
      if (financeTickFrameRef.current != null) window.cancelAnimationFrame(financeTickFrameRef.current);
    };
  }, [bumpFinanceTick]);

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
