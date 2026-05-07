import { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Search, Package, ChevronDown, ChevronUp, ClipboardList, Trash2, Store } from 'lucide-react';
import type { UserRole } from './Orders';
import { getSupplyItem, isConsumableItem, userRoleToSupplyRetailView } from '../lib/supplyCatalog';
import { getStallDisplaySoldAtRetail } from '../lib/orderStallDisplayRevenue';
import { useSupplyCatalogItems } from '../hooks/useSupplyCatalogItems';
import { num, aggregateStallKpis, computeLine, isStallRemainEntryValid } from '../lib/stallMath';
import { getSalesRecord, mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { formatYmdWithWeekday } from '../lib/stallInventoryStorage';
import { orders as ordersApi } from '../services/apiService';
import type { OrderHistoryEntry, UpdateStallSnapshotResult } from '../lib/orderHistoryStorage';
import { formatSlashDateTimeFromIso, orderDateQueryMatches, orderMatchesActiveWeekdays } from '../lib/dateDisplay';
import { OrderWeekdayFilter } from '../components/OrderWeekdayFilter';
import { cn } from '../lib/utils';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';

function money(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
}

function procurementStatusDisplay(s: '待出貨' | '已完成' | '已取消') {
  return s === '已完成' ? '已出貨' : s;
}

/** 加盟主下單 → 加盟；總部／直營店員下單 → 直營 */
function orderSalesOutletChannel(o: OrderHistoryEntry): 'franchise' | 'direct' {
  return o.actorRole === 'franchisee' ? 'franchise' : 'direct';
}

type OutletFilter = 'all' | 'direct' | 'franchise';

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
    const byWeek = orders.filter((o) => orderMatchesActiveWeekdays(o.createdAt, activeWeekdays));
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
      if (o.storeLabel.toLowerCase().includes(q)) return true;
      if (o.stallCountBasisYmd?.toLowerCase().includes(q)) return true;
      if (
        orderDateQueryMatches(o.createdAt, {
          stallCountBasisYmd: o.stallCountBasisYmd,
          stallCountCompletedAt: o.stallCountCompletedAt,
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

  return (
    <div className="space-y-6 pb-24 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-500/90 mb-1">
            <Receipt size={22} className="shrink-0" />
            <span className="text-sm font-medium tracking-wide">已完成盤點訂單</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">銷售紀錄</h2>
          {isSuperAdmin && (
            <p className="mt-1.5 text-sm text-zinc-500 max-w-2xl">
              可檢視全店盤點之銷售資料（含總部直營、直營門市與加盟送單）。下方可篩選僅看直營或加盟。
            </p>
          )}
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
        {filtered.map((order) => {
          const listStallRetail = getStallDisplaySoldAtRetail(order, supplyRetailView);
          const listAmount = listStallRetail != null ? listStallRetail : order.totalAmount;
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
          const actualRev = displaySnap ? num(displaySnap.actualRevenue) : 0;
          const tableRows = displaySnap
            ? stallDisplayItems
                .map((item) => {
                  const line = displaySnap.lines[item.id] ?? { out: '', remain: '' };
                  const outN = num(line.out);
                  const remN = num(line.remain);
                  return { item, outN, remN, sold: Math.max(0, outN - remN) };
                })
                .filter((r) => r.outN > 0 || r.remN > 0 || r.sold > 0)
            : [];

          return (
            <div
              key={order.id}
              className="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              <div className="flex min-w-0 w-full">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : order.id)}
                className="min-w-0 flex-1 p-4 sm:p-5 flex items-start sm:items-center justify-between gap-3 sm:gap-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 flex-shrink-0">
                    <Package size={22} className="text-amber-500/80" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-500 font-mono truncate">{order.id}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <p className="text-base font-semibold text-[#f5f2ed]">{order.storeLabel}</p>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[0.625rem] font-medium border',
                          order.status === '待出貨'
                            ? 'bg-sky-600/10 text-sky-400 border-sky-600/25'
                            : 'bg-emerald-600/10 text-emerald-400 border-emerald-600/25'
                        )}
                      >
                        {procurementStatusDisplay(order.status)}
                      </span>
                      <StallCountOrderBadge
                        createdAtIso={order.createdAt}
                        stallCountCompletedAt={order.stallCountCompletedAt}
                      />
                      {isSuperAdmin && (
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-[0.625rem] font-medium border',
                            orderSalesOutletChannel(order) === 'franchise'
                              ? 'bg-violet-600/10 text-violet-300 border-violet-600/30'
                              : 'bg-sky-600/10 text-sky-300 border-sky-600/25'
                          )}
                        >
                          {orderSalesOutletChannel(order) === 'franchise' ? '加盟' : '直營'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500 mt-1">建單 {formatSlashDateTimeFromIso(order.createdAt)}</p>
                    {order.stallCountBasisYmd && order.stallCountCompletedAt && (
                      <p className="text-xs text-amber-200/75 mt-1">
                        盤點 {formatYmdWithWeekday(order.stallCountBasisYmd)} · 完成 {formatSlashDateTimeFromIso(order.stallCountCompletedAt)}
                      </p>
                    )}
                    <p className="text-xs text-zinc-600 mt-1">
                      身分：
                      {order.actorRole === 'admin' ? '超級管理員' : order.actorRole === 'franchisee' ? '加盟主' : '店員'}
                      ・共 {order.itemCount} 件
                    </p>
                  </div>
                </div>
                <div className="flex items-center sm:items-end justify-end gap-1.5 sm:gap-2 flex-shrink-0 self-start sm:self-center">
                  <div className="text-right min-w-0 max-w-[9rem] sm:max-w-none">
                    <p className="text-xs text-zinc-500">{listAmountLabel}</p>
                    <p className="text-base sm:text-lg font-light text-amber-500 tabular-nums break-all">
                      $ {listAmount.toLocaleString()}
                    </p>
                  </div>
                  {open ? <ChevronUp className="text-zinc-500 shrink-0" size={20} /> : <ChevronDown className="text-zinc-500 shrink-0" size={20} />}
                </div>
              </button>
              {isSuperAdmin && (
                <div className="flex items-stretch border-l border-zinc-800/80 bg-zinc-900/30">
                  <button
                    type="button"
                    onClick={() => setDeleteModalId(order.id)}
                    className="flex w-12 sm:w-12 flex-col items-center justify-center gap-0.5 text-rose-400/85 hover:text-rose-200 hover:bg-rose-950/40 active:bg-rose-950/55 transition-colors"
                    title="刪除本筆訂單（不須展開明細）"
                    aria-label="刪除本筆訂單"
                  >
                    <Trash2 className="size-[1.1rem] sm:size-5" strokeWidth={2} />
                    <span className="text-[0.5625rem] sm:text-[0.625rem] font-medium text-zinc-500 leading-tight">刪除</span>
                  </button>
                </div>
              )}
              </div>
              {open && (
                <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 sm:px-5 py-4 space-y-4">
                  {!snapshot && <p className="text-sm text-zinc-500">無資料。</p>}
                  {snapshot && (
                    <>
                      <div className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-4">
                        <div
                          className={cn(
                            'grid gap-4 text-sm',
                            userRole === 'employee' ? 'grid-cols-1' : 'sm:grid-cols-2'
                          )}
                        >
                          <div>
                            <p className="text-xs text-zinc-500">盤點金額</p>
                            <p className="text-lg font-semibold text-amber-400 tabular-nums">$ {money(retailKpi.soldAtRetail)}</p>
                            <p className="text-[0.625rem] text-zinc-600 mt-0.5">依本機零售參考 × 售出量</p>
                          </div>
                          {userRole !== 'employee' && (
                            <div>
                              <p className="text-xs text-zinc-500">成本金額</p>
                              <p className="text-lg font-semibold text-zinc-300 tabular-nums">$ {money(wholesaleKpi.shouldRevenue)}</p>
                              <p className="text-[0.625rem] text-zinc-600 mt-0.5">批價 × 售出量</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-sky-900/50 bg-sky-950/15 p-4 grid sm:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-zinc-500">預估金額</p>
                          <p className="text-lg font-semibold text-emerald-400 tabular-nums">$ {money(retailKpi.estTotal)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500">剩餘貨品金額</p>
                          <p className="text-lg font-semibold text-emerald-400/90 tabular-nums">$ {money(retailKpi.remGoodsValue)}</p>
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
                      {snapshot && !isStallEditThis && (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-950/25 px-3 py-2.5 text-sm text-sky-100/95">
                          <div className="flex items-start gap-2 min-w-0">
                            <ClipboardList className="shrink-0 mt-0.5 text-sky-400" size={18} aria-hidden />
                            <span className="leading-snug">
                              盤點數字有誤或收攤後仍有銷售？可在此修改帶出／剩餘與登錄實收（與訂單管理「調整貨量」相同：先進入編輯再儲存）。
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => startStallEdit(order)}
                            className="shrink-0 self-start sm:self-center py-2 px-3 rounded-lg bg-sky-600/90 text-white text-sm font-medium hover:bg-sky-500"
                          >
                            調整盤點
                          </button>
                        </div>
                      )}
                      {isStallEditThis && stallEditDraft && (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-500/90 font-medium">
                            編輯盤點：每列剩餘須為 ≥0 之數字（可小數）；已售完請填 0。
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
                      <div>
                        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">叫貨品項</p>
                        <ul className="space-y-2 text-sm">
                          {order.lines.map((line) => (
                            <li
                              key={line.productId + line.name + line.qty}
                              className="flex justify-between gap-2 text-zinc-300"
                            >
                              <span className="min-w-0">
                                {line.name}{' '}
                                <span className="text-zinc-500">× {line.qty} {line.unit}</span>
                              </span>
                              <span className="tabular-nums text-zinc-400 shrink-0">
                                $ {(line.unitPrice * line.qty).toLocaleString()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-2xl border border-zinc-800 overflow-hidden">
                        <div className="px-3 py-2 bg-zinc-900/80 border-b border-zinc-800 text-xs text-zinc-500">
                          盤點明細
                        </div>
                        <div className="overflow-x-auto">
                          {isStallEditThis && stallEditDraft ? (
                            <table className="w-full text-sm min-w-[720px]">
                              <thead>
                                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                                  <th className="px-3 py-2">品項</th>
                                  <th className="px-2 py-2 tabular-nums">帶出</th>
                                  <th className="px-2 py-2 tabular-nums">剩餘</th>
                                  <th className="px-2 py-2 tabular-nums">售出</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stallDisplayItems.map((item) => {
                                  const line = stallEditDraft.lines[item.id] ?? { out: '', remain: '' };
                                  const c = computeLine(line.out, line.remain, item);
                                  return (
                                    <tr key={item.id} className="border-b border-zinc-800/60">
                                      <td className="px-3 py-2 text-zinc-200 whitespace-nowrap">{item.name}</td>
                                      <td className="px-2 py-2 p-0">
                                        <input
                                          value={line.out}
                                          onChange={(e) =>
                                            setStallEditDraft((p) => {
                                              if (!p) return p;
                                              const lines = {
                                                ...p.lines,
                                                [item.id]: {
                                                  ...p.lines[item.id],
                                                  out: e.target.value,
                                                  remain: p.lines[item.id]?.remain ?? '',
                                                },
                                              };
                                              return { ...p, lines };
                                            })
                                          }
                                          className="w-24 min-h-9 bg-zinc-900/80 border border-zinc-700 rounded px-1.5 text-amber-100 font-mono text-sm"
                                          inputMode="decimal"
                                          aria-label={`${item.name} 帶出`}
                                        />
                                      </td>
                                      <td className="px-2 py-2 p-0">
                                        <div className="flex items-center gap-1 flex-nowrap min-w-0">
                                          <input
                                            value={line.remain}
                                            onChange={(e) =>
                                              setStallEditDraft((p) => {
                                                if (!p) return p;
                                                const lines = {
                                                  ...p.lines,
                                                  [item.id]: {
                                                    ...p.lines[item.id],
                                                    out: p.lines[item.id]?.out ?? '',
                                                    remain: e.target.value,
                                                  },
                                                };
                                                return { ...p, lines };
                                              })
                                            }
                                            placeholder="必填"
                                            className={cn(
                                              'w-[4.5rem] min-w-0 min-h-9 bg-zinc-900/80 border rounded px-1.5 font-mono text-sm',
                                              c.remainUnfilled
                                                ? 'border-amber-800/50 border-dashed text-zinc-400 placeholder:text-zinc-600'
                                                : c.remain > 0
                                                  ? 'border-rose-800/60 text-rose-300'
                                                  : 'border-zinc-700 text-zinc-300'
                                            )}
                                            inputMode="decimal"
                                            aria-label={`${item.name} 剩餘`}
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setStallEditDraft((p) => {
                                                if (!p) return p;
                                                const lines = {
                                                  ...p.lines,
                                                  [item.id]: {
                                                    ...p.lines[item.id],
                                                    out: p.lines[item.id]?.out ?? '',
                                                    remain: '0',
                                                  },
                                                };
                                                return { ...p, lines };
                                              })
                                            }
                                            className="shrink-0 rounded border border-zinc-600 bg-zinc-800/60 px-1.5 py-1 text-[0.625rem] sm:text-xs text-zinc-400 hover:border-amber-600/50 hover:text-amber-200/90"
                                          >
                                            已售完
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-2 py-2 font-mono tabular-nums text-zinc-400">
                                        {c.remainUnfilled ? '—' : money(c.sold)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <table className="w-full text-sm min-w-[640px]">
                              <thead>
                                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                                  <th className="px-3 py-2">品項</th>
                                  <th className="px-2 py-2 tabular-nums">帶出</th>
                                  <th className="px-2 py-2 tabular-nums">剩餘</th>
                                  <th className="px-2 py-2 tabular-nums">售出</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableRows.map(({ item, outN, remN, sold }) => (
                                  <tr key={item.id} className="border-b border-zinc-800/60">
                                    <td className="px-3 py-2 text-zinc-200">{item.name}</td>
                                    <td className="px-2 py-2 tabular-nums text-zinc-300">{outN}</td>
                                    <td className="px-2 py-2 tabular-nums text-zinc-300">{remN}</td>
                                    <td className="px-2 py-2 tabular-nums text-zinc-400">{sold}</td>
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
