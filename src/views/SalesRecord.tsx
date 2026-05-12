import { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Search, Package, ChevronDown, ChevronUp, Store, Minus, Plus } from 'lucide-react';
import type { UserRole } from './Orders';
import {
  estimatedRetailPerPackage,
  getSupplyItem,
  isConsumableItem,
  userRoleToSupplyRetailView,
} from '../lib/supplyCatalog';
import {
  getStallDisplayRetailEstAndRemain,
  getStallDisplayShouldRevenue,
  getStallDisplaySoldAtRetail,
} from '../lib/orderStallDisplayRevenue';
import { useSupplyCatalogItems } from '../hooks/useSupplyCatalogItems';
import {
  num,
  aggregateStallKpis,
  computeLine,
  isStallRemainEntryValid,
  roundProcurementQty,
} from '../lib/stallMath';
import { getSalesRecord, mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { orders as ordersApi } from '../services/apiService';
import type { OrderHistoryEntry, UpdateStallSnapshotResult } from '../lib/orderHistoryStorage';
import {
  displayOrderCreatedByLabel,
  displayOrderStallCountCompletedByLabel,
  effectiveOrderDateYmd,
} from '../lib/orderHistoryStorage';
import {
  formatSlashDateTimeWithWeekdayFromIso,
  formatSlashYmdWithWeekdayFromYmd,
  orderDateQueryMatches,
  orderMatchesActiveWeekdaysFromYmd,
} from '../lib/dateDisplay';
import { OrderWeekdayFilter } from '../components/OrderWeekdayFilter';
import { cn } from '../lib/utils';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';

function money(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
}

function fmtLineQty(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

function procurementStatusDisplay(s: '待出貨' | '已完成' | '已取消') {
  return s === '已完成' ? '已出貨' : s;
}

/** 加盟主下單 → 加盟；總部／直營店員下單 → 直營 */
function orderSalesOutletChannel(o: OrderHistoryEntry): 'franchise' | 'direct' {
  return o.actorRole === 'franchisee' ? 'franchise' : 'direct';
}

type OutletFilter = 'all' | 'direct' | 'franchise';
const STALL_MAX_Q = 99_999;
const SALES_RECORD_MAX_VISIBLE = 5;

/** 輸入欄僅保留數字與單一小數點，小數至多三位（與叫貨量 roundProcurementQty 一致）；允許打字中末尾「.」。 */
function sanitizeStallQtyTyping(raw: string): string {
  const cleaned = String(raw).replace(/,/g, '').replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned.slice(0, 14);

  const intPart = cleaned.slice(0, firstDot).replace(/\./g, '');
  let fracPart = cleaned.slice(firstDot + 1).replace(/\./g, '');
  fracPart = fracPart.slice(0, 3);

  const rawNoComma = String(raw).replace(/,/g, '');
  const wantsTrailingDot = rawNoComma.endsWith('.') && fracPart === '';

  if (firstDot === 0 && intPart === '') {
    return fracPart ? `.${fracPart}` : wantsTrailingDot ? '.' : '';
  }
  if (wantsTrailingDot) return `${intPart}.`;
  return fracPart !== '' ? `${intPart}.${fracPart}` : intPart;
}

/** ±1／上下限判定用：已四捨五入至三位小數並夹在 0～STALL_MAX_Q */
function stallQtyEffectiveNum(s: string | undefined): number {
  const n = roundProcurementQty(num(String(s ?? '')));
  return Math.min(STALL_MAX_Q, Math.max(0, n));
}

/** ±1 後寫入字串（與 StallInventory bump 格式化一致） */
function formatStallBumpedQty(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  const rounded = Math.min(STALL_MAX_Q, roundProcurementQty(n));
  if (Number.isInteger(rounded)) return String(rounded);
  const t = rounded.toFixed(4).replace(/\.?0+$/, '');
  return t === '' ? '0' : t;
}

function resolveRecordSnapshot(order: OrderHistoryEntry) {
  if (order.stallCountSnapshot) {
    return mergeSalesRecordWithCatalog(order.stallCountSnapshot);
  }
  if (order.stallCountBasisYmd) {
    const day = getSalesRecord(order.stallCountBasisYmd);
    return day ? mergeSalesRecordWithCatalog(day) : null;
  }
  return null;
}

export default function SalesRecord({ userRole }: { userRole: UserRole }) {
  const isSuperAdmin = userRole === 'admin';
  const supplyItems = useSupplyCatalogItems(userRole);
  const supplyRetailView = userRoleToSupplyRetailView(userRole);
  const [orders, setOrders] = useState<OrderHistoryEntry[]>([]);
  const [outletFilter, setOutletFilter] = useState<OutletFilter>(userRole === 'admin' ? 'direct' : 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeWeekdays, setActiveWeekdays] = useState<number[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stallEditId, setStallEditId] = useState<string | null>(null);
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);
  const [stallEditDraft, setStallEditDraft] = useState<SalesRecordDaySnapshot | null>(null);
  const [stallEditError, setStallEditError] = useState<string | null>(null);

  const refreshOrders = useCallback(() => {
    void ordersApi.listOrdersWithStallCountCompleted().then(setOrders);
  }, []);

  useEffect(() => {
    // 首次進入頁面時先載入一次，避免僅靠事件導致列表為空。
    refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    window.addEventListener('orderHistoryUpdated', refreshOrders);
    window.addEventListener('franchiseManagementOrdersUpdated', refreshOrders);
    window.addEventListener('salesRecordUpdated', refreshOrders);
    return () => {
      window.removeEventListener('orderHistoryUpdated', refreshOrders);
      window.removeEventListener('franchiseManagementOrdersUpdated', refreshOrders);
      window.removeEventListener('salesRecordUpdated', refreshOrders);
    };
  }, [refreshOrders]);

  const exitStallEdit = useCallback(() => {
    setStallEditId(null);
    setStallEditDraft(null);
    setStallEditError(null);
  }, []);

  useEffect(() => {
    if (stallEditId && expandedId !== stallEditId) {
      exitStallEdit();
    }
  }, [expandedId, stallEditId, exitStallEdit]);

  useEffect(() => {
    if (!stallEditId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitStallEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stallEditId, exitStallEdit]);

  useEffect(() => {
    if (!deleteModalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeleteModalId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteModalId]);

  const filtered = useMemo(() => {
    const byWeek = orders.filter((o) =>
      orderMatchesActiveWeekdaysFromYmd(effectiveOrderDateYmd(o), activeWeekdays)
    );
    let byOutlet = byWeek;
    if (isSuperAdmin) {
      if (outletFilter === 'direct') {
        byOutlet = byWeek.filter((o) => orderSalesOutletChannel(o) === 'direct');
      } else if (outletFilter === 'franchise') {
        byOutlet = byWeek.filter((o) => orderSalesOutletChannel(o) === 'franchise');
      }
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byOutlet;
    return byOutlet.filter((o) => {
      if (o.id.toLowerCase().includes(q)) return true;
      if (resolveOrderStoreLabel(o).toLowerCase().includes(q)) return true;
      if (o.stallCountBasisYmd?.toLowerCase().includes(q)) return true;
      if (
        orderDateQueryMatches(o.createdAt, {
          stallCountBasisYmd: o.stallCountBasisYmd,
          stallCountCompletedAt: o.stallCountCompletedAt,
          orderDateYmd: o.orderDateYmd,
        }, searchQuery.trim())
      ) {
        return true;
      }
      return o.lines.some(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          String(l.qty).includes(q) ||
          String(l.unitPrice).includes(q)
      );
    });
  }, [orders, searchQuery, activeWeekdays, isSuperAdmin, outletFilter]);
  const visibleOrders = useMemo(
    () => filtered.slice(0, SALES_RECORD_MAX_VISIBLE),
    [filtered]
  );

  /** 與攤上盤點一致：消耗品不納入帳上明細與帶出彙總 */
  const stallDisplayItems = useMemo(
    () => supplyItems.filter((i) => !isConsumableItem(i)),
    [supplyItems]
  );
  const stallIds = useMemo(() => stallDisplayItems.map((i) => i.id), [stallDisplayItems]);

  const startStallEdit = (order: OrderHistoryEntry) => {
    const snap = resolveRecordSnapshot(order);
    if (!snap) return;
    setStallEditError(null);
    setStallEditId(order.id);
    setStallEditDraft(
      mergeSalesRecordWithCatalog(JSON.parse(JSON.stringify(snap)) as SalesRecordDaySnapshot)
    );
  };

  const saveStallEdit = (orderId: string) => {
    if (!stallEditDraft) return;
    const missing: string[] = [];
    for (const item of stallDisplayItems) {
      const raw = stallEditDraft.lines[item.id]?.remain;
      if (!isStallRemainEntryValid(raw)) missing.push(item.name);
    }
    if (missing.length > 0) {
      setStallEditError(
        `「剩餘貨量」尚有未正確填寫：${
          missing.length <= 6 ? missing.join('、') : `${missing.slice(0, 6).join('、')} 等共 ${missing.length} 項`
        }。已售完可帶 0。`
      );
      return;
    }
    setStallEditError(null);
    const next: SalesRecordDaySnapshot = {
      ...stallEditDraft,
      revenueGapAmount: (stallEditDraft.revenueGapAmount ?? '').trim(),
      revenueGapReason: (stallEditDraft.revenueGapReason ?? '').trim(),
      updatedAt: new Date().toISOString(),
    };
    void (async () => {
      const res: UpdateStallSnapshotResult = await ordersApi.updateStallCountSnapshotByOrderId(orderId, next);
      switch (res.ok) {
        case true:
          exitStallEdit();
          refreshOrders();
          break;
        case false:
          if (res.reason === 'not_found') setStallEditError('找不到此訂單。');
          else setStallEditError('此單無盤點押記，無法儲存。');
          break;
      }
    })();
  };

  const bumpStallLineValue = (itemId: string, field: 'out' | 'remain', delta: number) => {
    setStallEditDraft((prev) => {
      if (!prev) return prev;
      const current = stallQtyEffectiveNum(prev.lines[itemId]?.[field]);
      const next = formatStallBumpedQty(current + delta);
      return {
        ...prev,
        lines: {
          ...prev.lines,
          [itemId]: {
            ...prev.lines[itemId],
            out: prev.lines[itemId]?.out ?? '',
            remain: prev.lines[itemId]?.remain ?? '',
            [field]: next,
          },
        },
      };
    });
  };

  const setStallLineQtyInput = (itemId: string, field: 'out' | 'remain', raw: string) => {
    const next = sanitizeStallQtyTyping(raw);
    setStallEditDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: {
          ...prev.lines,
          [itemId]: {
            ...prev.lines[itemId],
            out: prev.lines[itemId]?.out ?? '',
            remain: prev.lines[itemId]?.remain ?? '',
            [field]: next,
          },
        },
      };
    });
  };

  return (
    <div className="space-y-6 pb-24 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="text-amber-500 shrink-0" size={28} />
            銷售紀錄
          </h2>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋單號、盤點日、品項、門市、日期（例 2026/4/25）"
            className="pl-10 pr-4 py-2 border border-zinc-700 bg-zinc-900 rounded-lg focus:outline-none focus:border-amber-500 transition-colors text-sm text-zinc-300 w-full"
          />
        </div>
      </div>

      {isSuperAdmin && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5 text-zinc-500 min-w-0">
              <Store size={16} className="text-amber-500/80 shrink-0" />
              <span className="text-xs sm:text-sm whitespace-nowrap">門市類型</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all' as const, label: '全部' },
                  { key: 'direct' as const, label: '直營店' },
                  { key: 'franchise' as const, label: '加盟店' },
                ] as const
              ).map(({ key, label }) => {
                const on = outletFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOutletFilter(key)}
                    aria-pressed={on}
                    className={cn(
                      'px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border transition-colors',
                      on
                        ? 'bg-amber-600/20 border-amber-500/50 text-amber-100'
                        : 'bg-zinc-950/50 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <OrderWeekdayFilter value={activeWeekdays} onChange={setActiveWeekdays} />

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-14 text-center text-sm text-zinc-500">
          {orders.length === 0
            ? '尚無紀錄。'
            : isSuperAdmin
              ? '沒有符合條件之資料。可調整「門市類型」、建單星期或搜尋關鍵字。'
              : '沒有符合條件之資料。'}
        </div>
      )}

      <div className="space-y-3">
        {visibleOrders.map((order) => {
          const listStallRetail = getStallDisplaySoldAtRetail(order, supplyRetailView);
          const listAmount =
            listStallRetail != null
              ? listStallRetail
              : order.actorRole === 'franchisee'
                ? (order.payableAmount ?? order.totalAmount)
                : order.totalAmount;
          const listAmountLabel = listStallRetail != null ? '盤點金額' : '叫貨金額';
          const open = expandedId === order.id;
          const snapshot = resolveRecordSnapshot(order);
          const isStallEditThis = stallEditId === order.id && stallEditDraft !== null;
          const displaySnap =
            isStallEditThis && stallEditDraft ? stallEditDraft : snapshot;
          const retailKpi = displaySnap
            ? aggregateStallKpis(
                stallIds,
                (id) => displaySnap.lines[id] ?? { out: '', remain: '' },
                (id) => getSupplyItem(id, supplyRetailView),
                { unitBasis: 'retail' }
              ).retail
            : { estTotal: 0, remGoodsValue: 0, shouldRevenue: 0, soldAtRetail: 0 };
          const wholesaleKpi = displaySnap
            ? aggregateStallKpis(
                stallIds,
                (id) => displaySnap.lines[id] ?? { out: '', remain: '' },
                (id) => getSupplyItem(id, supplyRetailView),
                { unitBasis: 'wholesale' }
              ).retail
            : { estTotal: 0, remGoodsValue: 0, shouldRevenue: 0, soldAtRetail: 0 };
          const frozenRetailSummary = getStallDisplayRetailEstAndRemain(order, supplyRetailView);
          const displayRetailEstTotal = frozenRetailSummary?.estTotal ?? retailKpi.estTotal;
          const displayRetailRemainValue = frozenRetailSummary?.remGoodsValue ?? retailKpi.remGoodsValue;
          const displayRetailSold = getStallDisplaySoldAtRetail(order, supplyRetailView) ?? retailKpi.soldAtRetail;
          const displayWholesaleSold =
            getStallDisplayShouldRevenue(order, supplyRetailView) ?? wholesaleKpi.shouldRevenue;
          const actualRev = displaySnap ? num(displaySnap.actualRevenue) : 0;
          const refLedgerGap = actualRev - displayRetailSold;
          const tableRows = displaySnap
            ? stallDisplayItems
                .map((item) => {
                  const line = displaySnap.lines[item.id] ?? { out: '', remain: '' };
                  let c = computeLine(line.out, line.remain, item, { unitBasis: 'retail' });
                  const frozenR = Number(displaySnap.frozenRetailUnitPriceByItem?.[item.id]);
                  if (Number.isFinite(frozenR)) {
                    c = {
                      ...c,
                      estPrice: c.out * frozenR,
                      remValue: c.remain * frozenR,
                      soldRevenue: c.sold * frozenR,
                    };
                  }
                  const unitRetail = Number.isFinite(frozenR) ? frozenR : estimatedRetailPerPackage(item);
                  const outN = num(line.out);
                  const remN = num(line.remain);
                  const sold = c.remainUnfilled ? 0 : Math.max(0, outN - remN);
                  return { item, line, c, outN, remN, sold, unitRetail };
                })
                .filter((r) => r.outN > 0 || r.remN > 0 || r.sold > 0)
            : [];

          return (
            <div
              key={order.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              <div className="relative min-w-0 w-full flex flex-col lg:flex-row">
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : order.id)}
                  className="min-w-0 flex-1 p-4 sm:p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 sm:gap-4 text-left hover:bg-zinc-900/80 transition-colors"
                >
                <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                  <div className="hidden sm:flex w-12 h-12 rounded-full bg-zinc-800 items-center justify-center border border-zinc-700 flex-shrink-0">
                    <Package size={24} className="text-amber-500/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h3 className="text-lg font-bold text-[#f5f2ed] break-words">
                        {resolveOrderStoreLabel(order)}
                      </h3>
                      <span
                        className={cn(
                          'px-2.5 py-0.5 rounded text-xs font-medium border shrink-0',
                          order.status === '待出貨'
                            ? 'bg-amber-600/10 text-amber-500 border-amber-600/20'
                            : order.status === '已取消'
                              ? 'bg-rose-600/10 text-rose-400 border-rose-600/20'
                              : 'bg-emerald-600/10 text-emerald-400 border-emerald-600/20'
                        )}
                      >
                        {procurementStatusDisplay(order.status)}
                      </span>
                      <StallCountOrderBadge
                        createdAtIso={order.createdAt}
                        stallCountCompletedAt={order.stallCountCompletedAt}
                      />
                    </div>
                    <p
                      className="text-xs sm:text-sm text-[#f5f2ed] mb-2 leading-snug break-all"
                      title={order.id}
                    >
                      訂單編號 <span className="font-mono">{order.id}</span>
                    </p>
                    <div className="min-w-0 max-w-full space-y-2">
                      <p className="text-base sm:text-lg text-[#f5f2ed] leading-tight break-keep [overflow-wrap:anywhere]">
                        訂單日期{' '}
                        {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(order))}
                      </p>
                      <p className="text-sm sm:text-base text-zinc-400 leading-snug break-keep [overflow-wrap:anywhere]">
                        下單時間 {formatSlashDateTimeWithWeekdayFromIso(order.createdAt)}
                      </p>
                      <div className="grid grid-cols-1 min-[430px]:grid-cols-2 gap-y-1 gap-x-3 text-sm text-zinc-600">
                        <p className="break-words [overflow-wrap:anywhere]">
                          下單者：{displayOrderCreatedByLabel(order)}
                        </p>
                        <p className="break-words [overflow-wrap:anywhere]">
                          盤點者：
                          {order.stallCountCompletedAt
                            ? displayOrderStallCountCompletedByLabel(order)
                            : '—'}
                        </p>
                      </div>
                    </div>
                    {order.lastUpdatedByName && order.lastUpdatedByName !== order.createdByName && (
                      <p className="text-[0.6875rem] text-zinc-600 mt-1.5 leading-relaxed">
                        最後異動：{order.lastUpdatedByName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-1.5 sm:gap-2 flex-shrink-0 self-stretch lg:self-center">
                  <div className="text-left sm:text-right min-w-0 sm:max-w-none">
                    <p className="text-xs text-zinc-500">{listAmountLabel}</p>
                    <p className="text-base sm:text-lg font-light text-amber-500 tabular-nums whitespace-nowrap">
                      $ {listAmount.toLocaleString()}
                    </p>
                    {snapshot && (
                      <>
                        <p className="text-xs text-zinc-500 mt-1.5">登錄實收</p>
                        <p className="text-base sm:text-lg font-light text-amber-500 tabular-nums whitespace-nowrap">
                          $ {money(num(displaySnap.actualRevenue))}
                        </p>
                      </>
                    )}
                  </div>
                  {open ? <ChevronUp className="text-zinc-500 shrink-0" size={20} /> : <ChevronDown className="text-zinc-500 shrink-0" size={20} />}
                </div>
              </button>
              </div>
              {open && (
                <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 sm:px-5 py-4 space-y-4">
                  {!snapshot && <p className="text-sm text-zinc-500">無資料。</p>}
                  {snapshot && (
                    <>
                      <div className="rounded-2xl border border-amber-900/50 bg-amber-950/15 p-4 text-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                          <div
                            className={cn(
                              'grid gap-x-4 gap-y-5 min-w-0 flex-1',
                              userRole === 'employee'
                                ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
                                : 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-5'
                            )}
                          >
                            <div>
                              <p className="text-xs text-zinc-500">盤點金額</p>
                              <p className="text-lg font-semibold text-amber-400 tabular-nums">$ {money(displayRetailSold)}</p>
                              <p className="text-[0.625rem] text-zinc-600 mt-0.5">零售價 × 售出量</p>
                            </div>
                            {userRole !== 'employee' && (
                              <div>
                                <p className="text-xs text-zinc-500">成本金額</p>
                                <p className="text-lg font-semibold text-zinc-300 tabular-nums">$ {money(displayWholesaleSold)}</p>
                                <p className="text-[0.625rem] text-zinc-600 mt-0.5">批價 × 帶出量</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-zinc-500">預估金額</p>
                              <p className="text-lg font-semibold text-emerald-400 tabular-nums">$ {money(displayRetailEstTotal)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-zinc-500">剩餘貨品金額</p>
                              <p className="text-lg font-semibold text-emerald-400/90 tabular-nums">$ {money(displayRetailRemainValue)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-zinc-500">登錄實收</p>
                              {isStallEditThis && stallEditDraft ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={stallEditDraft.actualRevenue}
                                  onChange={(e) =>
                                    setStallEditDraft((p) =>
                                      p ? { ...p, actualRevenue: e.target.value } : p
                                    )
                                  }
                                  className="mt-1 w-full max-w-[12rem] min-h-10 rounded-lg border-2 border-zinc-600 bg-zinc-900 px-3 text-amber-200 font-mono tabular-nums text-lg font-semibold"
                                  placeholder="0"
                                />
                              ) : (
                                <p className="text-lg font-semibold text-amber-300/90 tabular-nums">$ {money(actualRev)}</p>
                              )}
                            </div>
                          </div>
                          {!isStallEditThis && (
                            <button
                              type="button"
                              onClick={() => startStallEdit(order)}
                              className="shrink-0 self-end w-full sm:w-auto py-2 px-3 rounded-lg bg-amber-600/90 text-zinc-950 text-sm font-medium hover:bg-amber-500"
                            >
                              調整盤點
                            </button>
                          )}
                        </div>
                        <div className="mt-4 pt-4 border-t border-amber-900/40 space-y-3">
                          <p className="text-xs font-medium text-zinc-500">營收落差登記</p>
                          <p className="text-[0.6875rem] text-zinc-600 leading-relaxed">
                            參考差額（登錄實收 − 盤點金額）：
                            <span
                              className={cn(
                                'tabular-nums font-medium ml-1',
                                refLedgerGap < 0
                                  ? 'text-rose-400/90'
                                  : refLedgerGap > 0
                                    ? 'text-emerald-300/90'
                                    : 'text-zinc-300',
                              )}
                            >
                              {refLedgerGap === 0
                                ? '$0'
                                : `${refLedgerGap < 0 ? '−' : '+'}$${money(Math.abs(refLedgerGap))}`}
                            </span>
                          </p>
                          {isStallEditThis && stallEditDraft ? (
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs text-zinc-500 block">落差金額（自填，可與參考差額不同）</label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={stallEditDraft.revenueGapAmount ?? ''}
                                  onChange={(e) =>
                                    setStallEditDraft((p) =>
                                      p ? { ...p, revenueGapAmount: e.target.value } : p
                                    )
                                  }
                                  className="mt-1 w-full max-w-xs min-h-10 rounded-lg border-2 border-zinc-600 bg-zinc-900 px-3 text-amber-100 font-mono text-sm"
                                  placeholder="例：500 或 -200"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-zinc-500 block">落差原因</label>
                                <textarea
                                  value={stallEditDraft.revenueGapReason ?? ''}
                                  onChange={(e) =>
                                    setStallEditDraft((p) =>
                                      p ? { ...p, revenueGapReason: e.target.value } : p
                                    )
                                  }
                                  rows={2}
                                  className="mt-1 w-full rounded-lg border-2 border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y min-h-[4rem]"
                                  placeholder="例：請客、食材耗損、收銀短溢…"
                                />
                              </div>
                            </div>
                          ) : (displaySnap.revenueGapAmount?.trim() || displaySnap.revenueGapReason?.trim()) ? (
                            <div className="space-y-1.5 text-sm">
                              {displaySnap.revenueGapAmount?.trim() ? (
                                <p className="text-zinc-300">
                                  <span className="text-zinc-500">落差金額：</span>
                                  <span className="tabular-nums text-amber-200/90 font-medium">
                                    $ {money(num(displaySnap.revenueGapAmount))}
                                  </span>
                                </p>
                              ) : null}
                              {displaySnap.revenueGapReason?.trim() ? (
                                <p className="text-zinc-300">
                                  <span className="text-zinc-500">原因：</span>
                                  {displaySnap.revenueGapReason.trim()}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-600">
                              尚未登記落差。點「調整盤點」可填寫金額與原因（亦可在攤上盤點完成當日填寫）。
                            </p>
                          )}
                        </div>
                      </div>
                      {isStallEditThis && stallEditDraft && (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-500/90 font-medium">
                            編輯盤點：可用＋/－或直接輸入；每列 0～{STALL_MAX_Q.toLocaleString()}
                            （至多三位小數）。
                          </p>
                          {stallEditError && (
                            <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
                              {stallEditError}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => saveStallEdit(order.id)}
                              className="py-2 px-4 rounded-lg bg-amber-600 text-zinc-950 text-sm font-semibold hover:bg-amber-500"
                            >
                              儲存盤點
                            </button>
                            <button
                              type="button"
                              onClick={exitStallEdit}
                              className="py-2 px-4 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800"
                            >
                              放棄
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="rounded-2xl border border-zinc-800 overflow-hidden">
                        <div className="px-3 py-2 bg-zinc-900/80 border-b border-zinc-800 text-xs text-zinc-500">
                          盤點明細
                        </div>
                        <div className="overflow-x-auto">
                          {isStallEditThis && stallEditDraft ? (
                            <table className="w-full text-[11px] sm:text-sm min-w-[56rem]">
                              <thead>
                                <tr className="text-left text-zinc-500 border-b border-zinc-800 text-[10px] sm:text-xs uppercase">
                                  <th className="px-2 sm:px-3 py-2 font-medium sticky left-0 bg-zinc-900 z-[2] shadow-[8px_0_10px_-10px_rgba(0,0,0,0.85)]">
                                    品項
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    帶出數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    售出數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    剩餘數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    預估金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    售出金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    剩餘金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    單價
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    餘貨率
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {stallDisplayItems.map((item) => {
                                  const line = stallEditDraft.lines[item.id] ?? { out: '', remain: '' };
                                  let c = computeLine(line.out, line.remain, item, { unitBasis: 'retail' });
                                  const frozenR = Number(stallEditDraft.frozenRetailUnitPriceByItem?.[item.id]);
                                  if (Number.isFinite(frozenR)) {
                                    c = {
                                      ...c,
                                      estPrice: c.out * frozenR,
                                      remValue: c.remain * frozenR,
                                      soldRevenue: c.sold * frozenR,
                                    };
                                  }
                                  const unitRetail = Number.isFinite(frozenR)
                                    ? frozenR
                                    : estimatedRetailPerPackage(item);
                                  return (
                                    <tr key={item.id} className="border-b border-zinc-800/60">
                                      <td className="px-2 sm:px-3 py-2 text-zinc-200 whitespace-nowrap sticky left-0 bg-zinc-900 z-[2] shadow-[8px_0_10px_-10px_rgba(0,0,0,0.85)]">
                                        {item.name}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 p-0">
                                        <div className="flex items-center justify-center gap-0.5 max-w-[9rem] mx-auto">
                                          <button
                                            type="button"
                                            onClick={() => bumpStallLineValue(item.id, 'out', -1)}
                                            disabled={stallQtyEffectiveNum(line.out) <= 0}
                                            className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                            aria-label={`${item.name} 帶出減一`}
                                          >
                                            <Minus size={16} />
                                          </button>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={line.out}
                                            onChange={(e) => setStallLineQtyInput(item.id, 'out', e.target.value)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-12 min-w-0 text-center text-base font-bold tabular-nums text-amber-200 bg-zinc-900/80 border border-zinc-600 rounded py-1"
                                            aria-label={`${item.name} 帶出數量，0～${STALL_MAX_Q.toLocaleString()}`}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => bumpStallLineValue(item.id, 'out', 1)}
                                            disabled={stallQtyEffectiveNum(line.out) >= STALL_MAX_Q}
                                            className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                            aria-label={`${item.name} 帶出加一`}
                                          >
                                            <Plus size={16} />
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-zinc-300">
                                        {c.remainUnfilled ? '—' : fmtLineQty(c.sold)}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 p-0">
                                        <div className="flex items-center justify-center gap-0.5 max-w-[9rem] mx-auto">
                                          <button
                                            type="button"
                                            onClick={() => bumpStallLineValue(item.id, 'remain', -1)}
                                            disabled={stallQtyEffectiveNum(line.remain) <= 0}
                                            className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                            aria-label={`${item.name} 剩餘減一`}
                                          >
                                            <Minus size={16} />
                                          </button>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={line.remain}
                                            onChange={(e) =>
                                              setStallLineQtyInput(item.id, 'remain', e.target.value)
                                            }
                                            onFocus={(e) => e.target.select()}
                                            className={cn(
                                              'w-12 min-w-0 text-center text-base font-bold tabular-nums bg-zinc-900/80 border rounded py-1',
                                              c.remainUnfilled
                                                ? 'border-amber-800/50 border-dashed text-zinc-400'
                                                : c.remain > 0
                                                  ? 'border-rose-800/60 text-rose-300'
                                                  : 'border-zinc-600 text-zinc-300'
                                            )}
                                            aria-label={`${item.name} 剩餘數量，0～${STALL_MAX_Q.toLocaleString()}`}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => bumpStallLineValue(item.id, 'remain', 1)}
                                            disabled={stallQtyEffectiveNum(line.remain) >= STALL_MAX_Q}
                                            className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                            aria-label={`${item.name} 剩餘加一`}
                                          >
                                            <Plus size={16} />
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                        $ {Math.round(c.estPrice).toLocaleString()}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                        {c.remainUnfilled
                                          ? '—'
                                          : `$ ${Math.round(c.soldRevenue).toLocaleString()}`}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                        {c.remainUnfilled
                                          ? '—'
                                          : `$ ${Math.round(c.remValue).toLocaleString()}`}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-amber-200/85 whitespace-nowrap">
                                        {unitRetail.toLocaleString()}
                                      </td>
                                      <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-amber-200/70 whitespace-nowrap">
                                        {c.remainUnfilled || c.out <= 0
                                          ? '—'
                                          : `${c.leftRatePct.toFixed(2)}%`}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <table className="w-full text-[11px] sm:text-sm min-w-[56rem]">
                              <thead>
                                <tr className="text-left text-zinc-500 border-b border-zinc-800 text-[10px] sm:text-xs uppercase">
                                  <th className="px-2 sm:px-3 py-2 font-medium sticky left-0 bg-zinc-900 z-[2] shadow-[8px_0_10px_-10px_rgba(0,0,0,0.85)]">
                                    品項
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    帶出數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    售出數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    剩餘數量
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    預估金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    售出金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-right whitespace-nowrap">
                                    剩餘金額
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    單價
                                  </th>
                                  <th className="px-1.5 sm:px-2 py-2 font-medium text-center whitespace-nowrap">
                                    餘貨率
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableRows.map(({ item, c, unitRetail }) => (
                                  <tr key={item.id} className="border-b border-zinc-800/60">
                                    <td className="px-2 sm:px-3 py-2 text-zinc-200 sticky left-0 bg-zinc-900 z-[2] shadow-[8px_0_10px_-10px_rgba(0,0,0,0.85)]">
                                      {item.name}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-zinc-300">
                                      {fmtLineQty(c.out)}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-zinc-300">
                                      {c.remainUnfilled ? '—' : fmtLineQty(c.sold)}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-zinc-300">
                                      {c.remainUnfilled ? '—' : fmtLineQty(c.remain)}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                      $ {Math.round(c.estPrice).toLocaleString()}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                      {c.remainUnfilled
                                        ? '—'
                                        : `$ ${Math.round(c.soldRevenue).toLocaleString()}`}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                                      {c.remainUnfilled
                                        ? '—'
                                        : `$ ${Math.round(c.remValue).toLocaleString()}`}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-amber-200/85 whitespace-nowrap">
                                      {unitRetail.toLocaleString()}
                                    </td>
                                    <td className="px-1.5 sm:px-2 py-2 text-center tabular-nums text-amber-200/70 whitespace-nowrap">
                                      {c.remainUnfilled || c.out <= 0
                                        ? '—'
                                        : `${c.leftRatePct.toFixed(2)}%`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {!isStallEditThis && tableRows.length === 0 && (
                            <p className="p-4 text-sm text-zinc-500">無明細。</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {filtered.length > SALES_RECORD_MAX_VISIBLE && (
        <p className="text-xs text-zinc-500">
          僅顯示最新 {SALES_RECORD_MAX_VISIBLE} 筆已盤點訂單（目前符合條件共 {filtered.length} 筆）。
        </p>
      )}

      {deleteModalId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sales-record-delete-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteModalId(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="sales-record-delete-title" className="text-lg font-semibold text-[#f5f2ed]">
              永久刪除本筆訂單
            </h3>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              將從本機完全移除單號{' '}
              <span className="font-mono text-zinc-300">{deleteModalId}</span>
              （歷史訂單、訂單管理內之同一筆一併刪除）。盤點日若仍有其他關聯，銷售紀錄內之日期資料可能單獨保留。此操作無法還原。是否確定？
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalId(null)}
                className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = deleteModalId;
                  if (!id) return;
                  void (async () => {
                    if (await ordersApi.deleteOrderByIdFromAnyStore(id)) {
                      if (stallEditId === id) exitStallEdit();
                      if (expandedId === id) setExpandedId(null);
                      setDeleteModalId(null);
                      refreshOrders();
                    }
                  })();
                }}
                className="px-4 py-2.5 rounded-lg bg-rose-600/90 text-white text-sm font-medium hover:bg-rose-500"
              >
                永久刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
