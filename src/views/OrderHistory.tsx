import { useState, useEffect, useMemo } from 'react';
import { Search, History, Package, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import type { UserRole } from './Orders';
import { orders as ordersApi } from '../services/apiService';
import type { OrderHistoryEntry } from '../lib/orderHistoryStorage';
import {
  displayOrderCreatedByLabel,
  displayOrderStallCountCompletedByLabel,
  effectiveOrderDateYmd,
} from '../lib/orderHistoryStorage';
import {
  formatSlashDateTimeFromIso,
  formatSlashYmdWithWeekdayFromYmd,
  formatTimeHmFromIso,
  ymdDashToSlash,
  orderDateQueryMatches,
  orderMatchesActiveWeekdaysFromYmd,
} from '../lib/dateDisplay';
import { OrderWeekdayFilter } from '../components/OrderWeekdayFilter';
import { getStallDisplayShouldRevenue } from '../lib/orderStallDisplayRevenue';
import { userRoleToSupplyRetailView } from '../lib/supplyCatalog';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';

export default function OrderHistory({ userRole }: { userRole: UserRole }) {
  const isSuperAdmin = userRole === 'admin';
  const supplyRetailView = userRoleToSupplyRetailView(userRole);
  const [orders, setOrders] = useState<OrderHistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  /** 已點選之建單星期（空＝不篩選） */
  const [activeWeekdays, setActiveWeekdays] = useState<number[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      void ordersApi.loadCompletedOrderHistoryListForRole(userRole).then(setOrders);
    };
    refresh();
    window.addEventListener('orderHistoryUpdated', refresh);
    window.addEventListener('franchiseManagementOrdersUpdated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('orderHistoryUpdated', refresh);
      window.removeEventListener('franchiseManagementOrdersUpdated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [userRole]);

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
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byWeek;
    return byWeek.filter((o) => {
      if (o.id.toLowerCase().includes(q)) return true;
      if (resolveOrderStoreLabel(o).toLowerCase().includes(q)) return true;
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
  }, [orders, searchQuery, activeWeekdays]);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-500/90 mb-1">
            <History size={22} className="shrink-0" />
            <span className="text-sm font-medium tracking-wide">本機歷程</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="text-amber-500 shrink-0" size={28} />
            歷史訂單
          </h2>
          {userRole === 'employee' && (
            <p className="text-sm text-zinc-500 mt-1.5">僅顯示直營相關單據（總部＋本店帳下單），不含加盟主單。</p>
          )}
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋單號、品項、門市、日期（例 2026/4/25）"
            className="pl-10 pr-4 py-2 border border-zinc-700 bg-zinc-900 rounded-lg focus:outline-none focus:border-amber-500 transition-colors text-sm text-zinc-300 w-full"
          />
        </div>
      </div>

      <OrderWeekdayFilter value={activeWeekdays} onChange={setActiveWeekdays} />

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-14 text-center text-sm text-zinc-500">
          {orders.length === 0 ? '尚無紀錄。' : '沒有符合條件之資料。'}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((order) => {
          const listStallRev = getStallDisplayShouldRevenue(order, supplyRetailView);
          const listAmount =
            listStallRev != null
              ? listStallRev
              : order.actorRole === 'franchisee'
                ? (order.payableAmount ?? order.totalAmount)
                : order.totalAmount;
          const listAmountLabel = listStallRev != null ? '盤點營業額' : '訂單金額';
          const open = expandedId === order.id;
          return (
            <div
              key={order.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              <div className="flex min-w-0 w-full flex-col lg:flex-row">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : order.id)}
                className="min-w-0 flex-1 p-4 sm:p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 sm:gap-4 text-left hover:bg-zinc-900/80 transition-colors"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 flex-shrink-0">
                    <Package size={22} className="text-amber-500/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500 font-mono truncate">{order.id}</p>
                    <div className="mt-0.5">
                      <p className="text-base font-semibold text-[#f5f2ed] break-words leading-tight">{resolveOrderStoreLabel(order)}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[0.625rem] font-medium border bg-emerald-600/10 text-emerald-400 border-emerald-600/25">
                          已出貨
                        </span>
                        <StallCountOrderBadge
                          createdAtIso={order.createdAt}
                          stallCountCompletedAt={order.stallCountCompletedAt}
                        />
                      </div>
                    </div>
                    <p className="text-sm text-zinc-500 mt-1">
                      訂單日期 {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(order))} ・ 下單{' '}
                      {formatTimeHmFromIso(order.createdAt)}
                    </p>
                    <p className="text-[0.6875rem] text-zinc-600 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>建單者：{displayOrderCreatedByLabel(order)}</span>
                      {order.stallCountCompletedAt && (
                        <span>盤點完成者：{displayOrderStallCountCompletedByLabel(order)}</span>
                      )}
                      {order.lastUpdatedByName && order.lastUpdatedByName !== order.createdByName && (
                        <span>最後異動：{order.lastUpdatedByName}</span>
                      )}
                    </p>
                    {order.stallCountBasisYmd && order.stallCountCompletedAt && (
                      <p className="text-xs text-amber-200/75 mt-1">
                        盤點：{ymdDashToSlash(order.stallCountBasisYmd)} · {formatSlashDateTimeFromIso(order.stallCountCompletedAt)}
                      </p>
                    )}
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                      身分：{order.actorRole === 'admin' ? '超級管理員' : order.actorRole === 'franchisee' ? '加盟主' : '店員'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between lg:justify-end gap-1.5 sm:gap-2 flex-shrink-0 self-stretch lg:self-center">
                  <div className="text-left sm:text-right min-w-0 sm:max-w-none">
                    <p className="text-xs text-zinc-500">{listAmountLabel}</p>
                    <p className="text-base sm:text-lg font-light text-amber-500 tabular-nums whitespace-nowrap">
                      $ {listAmount.toLocaleString()}
                    </p>
                  </div>
                  {open ? <ChevronUp className="text-zinc-500 shrink-0" size={20} /> : <ChevronDown className="text-zinc-500 shrink-0" size={20} />}
                </div>
              </button>
              {isSuperAdmin && (
                <div className="flex items-stretch border-t lg:border-t-0 lg:border-l border-zinc-800/80 bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setDeleteModalId(order.id)}
                    className="flex w-full h-10 sm:h-auto sm:w-12 flex-row sm:flex-col items-center justify-center gap-1 sm:gap-0.5 text-rose-400/85 hover:text-rose-200 hover:bg-rose-950/40 active:bg-rose-950/55 transition-colors"
                    title="永久刪除此筆歷史訂單（不須展開明細）"
                    aria-label="刪除本筆訂單"
                  >
                    <Trash2 className="size-[1.1rem] sm:size-5" strokeWidth={2} />
                    <span className="text-[0.5625rem] sm:text-[0.625rem] font-medium text-zinc-500 leading-tight">刪除</span>
                  </button>
                </div>
              )}
              </div>
              {open && (
                <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 sm:px-5 py-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">品項明細</p>
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
          aria-labelledby="order-history-delete-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteModalId(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="order-history-delete-title" className="text-lg font-semibold text-[#f5f2ed]">
              永久刪除歷史訂單
            </h3>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              將從本機完全移除單號{' '}
              <span className="font-mono text-zinc-300">{deleteModalId}</span>
              。此操作無法還原，其他畫面（銷售紀錄、訂單管理）若出現同單也會一併從本機刪除。是否確定？
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
                      if (expandedId === id) setExpandedId(null);
                      setDeleteModalId(null);
                      setOrders(await ordersApi.loadCompletedOrderHistoryListForRole(userRole));
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
