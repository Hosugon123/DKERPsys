import {
  ShoppingBasket,
  Minus,
  Plus,
  ListOrdered,
  CheckCircle2,
  Search,
  Bookmark,
  Trash2,
  CalendarDays,
  BarChart2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import type { UserRole } from './Orders';
import { orders as ordersApi } from '../services/apiService';
import type { OrderHistoryLine, OrderHistoryEntry } from '../lib/orderHistoryStorage';
import {
  listProcurementFavorites,
  addProcurementFavorite,
  removeProcurementFavorite,
  cartFromFavorite,
  type FavoriteOrder,
} from '../lib/procurementFavoritesStorage';
import {
  pricePerPackage,
  estimatedRetailPerPackage,
  CATEGORY_CHIPS,
  getSupplyItem,
  isConsumableItem,
  userRoleToSupplyRetailView,
  type ItemCategory,
} from '../lib/supplyCatalog';
import { useSupplyCatalogItems } from '../hooks/useSupplyCatalogItems';
import { cn } from '../lib/utils';
import {
  loadDayForProcurementFromOrder,
  applyOrderDeductionToDayRemain,
  cartAfterDeductingStallRemainFromOrder,
  getPreferredProcurementBasisOrderId,
  setPreferredProcurementBasisOrderId,
  getOrderStallCountBasisYmdForDeduction,
  formatYmdWithWeekday,
} from '../lib/stallInventoryStorage';
import { computeLine, aggregateStallKpis, roundProcurementQty, PROCUREMENT_QTY_MAX } from '../lib/stallMath';
import { formatSlashDateTimeFromIso } from '../lib/dateDisplay';
import ItemCatalogSettings from './ItemCatalogSettings';

function normalizeQ(s: string) {
  return s.trim().toLowerCase();
}

function parseQtyInput(raw: string): number {
  const t = String(raw)
    .trim()
    .replace(/[^\d.]/g, '');
  if (t === '' || t === '.') return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return roundProcurementQty(n);
}

export default function Procurement({ userRole }: { userRole: UserRole }) {
  /** 僅超級管理員可編輯品項、批價、零售；加盟主可編輯本店零售參考價。 */
  const isSuperAdmin = userRole === 'admin';
  const isFranchisee = userRole === 'franchisee';
  /** 直營店員工不顯示批貨成本，僅顯示零售預估參考 */
  const showProcurementCost = userRole !== 'employee';
  const [view, setView] = useState<'order' | 'catalog' | 'retail'>('order');
  const supplyRetailView = useMemo(() => userRoleToSupplyRetailView(userRole), [userRole]);
  const catalogItems = useSupplyCatalogItems(userRole);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [activeCategory, setActiveCategory] = useState<'all' | ItemCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [stallTick, setStallTick] = useState(0);
  const [basisOrdersList, setBasisOrdersList] = useState<OrderHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteOrder[]>([]);
  const [newFavoriteName, setNewFavoriteName] = useState('');
  const [favoriteError, setFavoriteError] = useState('');
  /** 第一次點刪除後記錄 id，需再點同列刪除才執行；幾秒後自動取消。 */
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  /** 手動輸入份數時的草稿（key 存在表示該欄以輸入字串為準） */
  const [qtyInputDraft, setQtyInputDraft] = useState<Record<string, string>>({});
  /** 欲扣除之帳上剩餘所依據的「已盤點完成」叫貨單（非僅依曆法日） */
  const [stallBasisOrderId, setStallBasisOrderId] = useState(() =>
    getPreferredProcurementBasisOrderId()
  );
  /** 盤點日當天售出一覽：伸縮（同歷史訂單邏輯，預設收合） */
  const [stallDaySalesOpen, setStallDaySalesOpen] = useState(false);
  /** 送出訂單前須在彈層內再按一次「確定送出」 */
  const [submitModalOpen, setSubmitModalOpen] = useState(false);

  const syncFavorites = useCallback(() => {
    setFavorites(listProcurementFavorites());
  }, []);

  useEffect(() => {
    syncFavorites();
    const h = () => syncFavorites();
    window.addEventListener('procurementFavoritesUpdated', h);
    return () => window.removeEventListener('procurementFavoritesUpdated', h);
  }, [syncFavorites]);

  useEffect(() => {
    const h = () => setStallTick((t) => t + 1);
    window.addEventListener('stallInventoryUpdated', h);
    window.addEventListener('supplyCatalogUpdated', h);
    window.addEventListener('orderHistoryUpdated', h);
    window.addEventListener('franchiseManagementOrdersUpdated', h);
    return () => {
      window.removeEventListener('stallInventoryUpdated', h);
      window.removeEventListener('supplyCatalogUpdated', h);
      window.removeEventListener('orderHistoryUpdated', h);
      window.removeEventListener('franchiseManagementOrdersUpdated', h);
    };
  }, []);

  useEffect(() => {
    if (!deleteArmedId) return;
    const t = window.setTimeout(() => setDeleteArmedId(null), 8_000);
    return () => clearTimeout(t);
  }, [deleteArmedId]);

  useEffect(() => {
    if (view === 'catalog' && !isSuperAdmin) setView('order');
    if (view === 'retail' && !isFranchisee) setView('order');
  }, [isSuperAdmin, isFranchisee, view]);

  useEffect(() => {
    void (async () => {
      const all = await ordersApi.listOrdersWithStallCountCompleted();
      setBasisOrdersList(
        userRole === 'employee'
          ? all.filter((o) => o.actorRole === 'admin' || o.actorRole === 'employee')
          : all,
      );
    })();
  }, [stallTick, userRole]);

  useEffect(() => {
    setStallBasisOrderId((prev) => {
      const orders = basisOrdersList;
      if (orders.length === 0) return '';
      if (prev && orders.some((o) => o.id === prev)) return prev;
      if (prev === '') return '';
      const fromPref = getPreferredProcurementBasisOrderId();
      if (fromPref && orders.some((o) => o.id === fromPref)) return fromPref;
      return orders[0]!.id;
    });
  }, [basisOrdersList]);

  const basisOrders = basisOrdersList;
  const selectedBasisOrder = useMemo(
    () => basisOrders.find((o) => o.id === stallBasisOrderId) ?? null,
    [basisOrders, stallBasisOrderId]
  );

  const { retail: stallDayKpi, consumable: stallConsKpi } = useMemo(() => {
    const snap = loadDayForProcurementFromOrder(stallBasisOrderId);
    return aggregateStallKpis(
      catalogItems.map((i) => i.id),
      (id) => snap.lines[id] ?? { out: '', remain: '' },
      (id) => getSupplyItem(id, supplyRetailView)
    );
  }, [stallTick, catalogItems, stallBasisOrderId, supplyRetailView]);

  const stallDayRetailSold = useMemo(() => {
    const snap = loadDayForProcurementFromOrder(stallBasisOrderId);
    let n = 0;
    for (const item of catalogItems) {
      const it = getSupplyItem(item.id, supplyRetailView);
      if (!it || isConsumableItem(it)) continue;
      const line = snap.lines[item.id] ?? { out: '', remain: '' };
      n += computeLine(line.out, line.remain, it).sold;
    }
    return n;
  }, [stallTick, catalogItems, stallBasisOrderId, supplyRetailView]);

  const stallDaySalesRows = useMemo(() => {
    const snap = loadDayForProcurementFromOrder(stallBasisOrderId);
    const rows: { item: (typeof catalogItems)[number]; c: ReturnType<typeof computeLine> }[] = [];
    for (const item of catalogItems) {
      const it = getSupplyItem(item.id, supplyRetailView);
      if (!it) continue;
      const line = snap.lines[item.id] ?? { out: '', remain: '' };
      const c = computeLine(line.out, line.remain, it);
      if (c.sold > 0 || c.out > 0 || c.remain > 0) {
        rows.push({ item: it, c });
      }
    }
    return rows.sort((a, b) => b.c.sold - a.c.sold);
  }, [stallTick, catalogItems, stallBasisOrderId, supplyRetailView]);

  const visibleItems = useMemo(() => {
    const q = normalizeQ(searchQuery);
    return catalogItems.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (!q) return true;
      return normalizeQ(item.name).includes(q) || item.name.includes(searchQuery.trim());
    });
  }, [activeCategory, searchQuery, catalogItems]);

  const clearQtyDraft = (id: string) => {
    setQtyInputDraft((p) => {
      if (!(id in p)) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  const setItemQty = (id: string, nextRaw: number) => {
    const next = roundProcurementQty(nextRaw);
    setCart((prev) => {
      if (next === 0) {
        if (!(id in prev)) return prev;
        const c = { ...prev };
        delete c[id];
        return c;
      }
      return { ...prev, [id]: next };
    });
  };

  /**
   * ＋/－ 微調；若中間欄有正在輸入、尚未失焦的數字，以輸入值為基礎加減，不會丟失。
   */
  const bumpQty = (id: string, delta: number) => {
    const fromDraft = id in qtyInputDraft ? parseQtyInput(qtyInputDraft[id] ?? '') : null;
    const current = fromDraft !== null ? fromDraft : (cart[id] || 0);
    clearQtyDraft(id);
    setItemQty(id, current + delta);
  };

  const totalCount = roundProcurementQty(
    (Object.values(cart) as number[]).reduce((a, b) => a + b, 0)
  );
  const totalCountDisplay = totalCount.toLocaleString('zh-TW', {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  });
  const totalPrice = Object.entries(cart).reduce((total, [id, n]) => {
    const item = getSupplyItem(id, supplyRetailView);
    const q = Number(n);
    return total + (item && q > 0 ? pricePerPackage(item) * q : 0);
  }, 0);
  const totalRetailEstimate = Object.entries(cart).reduce((total, [id, n]) => {
    const item = getSupplyItem(id, supplyRetailView);
    const q = Number(n);
    return total + (item && q > 0 ? estimatedRetailPerPackage(item) * q : 0);
  }, 0);

  const buildLinesFromCart = useCallback((): OrderHistoryLine[] => {
    return Object.entries(cart)
      .map(([id, qty]) => {
        const item = getSupplyItem(id, supplyRetailView);
        const q = roundProcurementQty(Number(qty) || 0);
        if (!item || q <= 0) return null;
        return {
          productId: id,
          name: item.name,
          unitPrice: pricePerPackage(item),
          qty: q,
          unit: item.pieceUnit,
        };
      })
      .filter(Boolean) as OrderHistoryLine[];
  }, [cart, supplyRetailView]);

  const openSubmitConfirm = () => {
    if (buildLinesFromCart().length === 0) return;
    setSubmitModalOpen(true);
  };

  const executeCheckout = useCallback(() => {
    const lines = buildLinesFromCart();
    if (lines.length === 0) {
      setSubmitModalOpen(false);
      return;
    }
    const amount = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    setSubmitModalOpen(false);

    const toDeduct: Record<string, number> = {};
    for (const l of lines) toDeduct[l.productId] = l.qty;
    const basisYmd = getOrderStallCountBasisYmdForDeduction(stallBasisOrderId);
    if (basisYmd) {
      applyOrderDeductionToDayRemain(basisYmd, toDeduct);
    }

    void (async () => {
      await ordersApi.appendProcurementOrderEntry({ lines, totalAmount: amount, actorRole: userRole });
      setOrderSuccess(true);
      setCart({});
      setQtyInputDraft({});
      setTimeout(() => setOrderSuccess(false), 3000);
    })();
  }, [buildLinesFromCart, stallBasisOrderId, userRole]);

  const applyFavoriteReplace = (f: FavoriteOrder) => {
    setFavoriteError('');
    setCart(cartFromFavorite(f.quantities));
    setQtyInputDraft({});
  };

  const applyFavoriteDeductStallBasisRemain = (f: FavoriteOrder) => {
    setDeleteArmedId(null);
    setFavoriteError('');
    const next = cartFromFavorite(
      cartAfterDeductingStallRemainFromOrder(f.quantities, stallBasisOrderId)
    );
    if (Object.keys(next).length === 0) {
      setFavoriteError('扣減後暫無需補貨。');
      return;
    }
    setCart(next);
    setQtyInputDraft({});
  };

  const onDeleteFavoriteClick = (f: FavoriteOrder) => {
    setFavoriteError('');
    if (deleteArmedId !== f.id) {
      setDeleteArmedId(f.id);
      return;
    }
    removeProcurementFavorite(f.id);
    setDeleteArmedId(null);
  };

  const saveAsFavorite = () => {
    if (totalCount === 0) return;
    setFavoriteError('');
    const r = addProcurementFavorite(
      newFavoriteName || `常用 ${new Date().toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}`,
      cart
    );
    if (r.ok) {
      setNewFavoriteName('');
    } else if (r.reason === 'limit') {
      setFavoriteError('常用訂單已達上限，請刪除一筆再儲存。');
    } else {
      setFavoriteError('目前購物車沒有有效品項。');
    }
  };

  if (isSuperAdmin && view === 'catalog') {
    return (
      <div className="space-y-3 pb-36 max-w-3xl mx-auto lg:max-w-none">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">批貨與下單</h2>
          <div className="flex rounded-xl border border-zinc-700 bg-zinc-900/80 p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setView('order')}
              className={cn(
                'flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium',
                'text-zinc-400'
              )}
            >
              叫貨
            </button>
            <button
              type="button"
              className="flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium bg-amber-600/25 text-amber-200"
            >
              品項與單價
            </button>
          </div>
        </div>
        <ItemCatalogSettings embedded />
      </div>
    );
  }

  if (isFranchisee && view === 'retail') {
    return (
      <div className="space-y-3 pb-36 max-w-3xl mx-auto lg:max-w-none">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">批貨與下單</h2>
          <div className="flex rounded-xl border border-zinc-700 bg-zinc-900/80 p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setView('order')}
              className="flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200"
            >
              叫貨
            </button>
            <button
              type="button"
              className="flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium bg-amber-600/25 text-amber-200"
            >
              本店零售價
            </button>
          </div>
        </div>
        <ItemCatalogSettings embedded retailOnly />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-36 max-w-3xl mx-auto lg:max-w-none">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">批貨與下單</h2>
          {!showProcurementCost && (
            <p className="text-sm text-zinc-500 mt-1.5 max-w-xl leading-relaxed">
              品項與合計僅顯示<strong className="text-zinc-400">零售預估</strong>（依單價推估售完面額），不顯示進貨成本；實際售價以門市為準。
            </p>
          )}
        </div>
        {isSuperAdmin ? (
          <div className="flex rounded-xl border border-zinc-700 bg-zinc-900/80 p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setView('order')}
              className={cn(
                'flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium',
                view === 'order' ? 'bg-amber-600/25 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              叫貨
            </button>
            <button
              type="button"
              onClick={() => setView('catalog')}
              className={cn(
                'flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium',
                view === 'catalog' ? 'bg-amber-600/25 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              品項與單價
            </button>
          </div>
        ) : isFranchisee ? (
          <div className="flex rounded-xl border border-zinc-700 bg-zinc-900/80 p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setView('order')}
              className={cn(
                'flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium',
                view === 'order' ? 'bg-amber-600/25 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              叫貨
            </button>
            <button
              type="button"
              onClick={() => setView('retail')}
              className={cn(
                'flex-1 sm:flex-none min-h-10 px-4 rounded-lg text-sm font-medium',
                view === 'retail' ? 'bg-amber-600/25 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              本店零售價
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-violet-900/50 bg-violet-950/20 px-4 py-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="shrink-0 text-violet-400" size={20} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-violet-200/95">欲扣除餘貨的訂單</p>
              <p className="text-[0.6875rem] text-violet-300/50 mt-0.5 leading-snug">
                以該筆已盤點單的帳上剩餘推算補貨，扣庫寫入該單之盤點日（同攤上盤點完成押記），非單看日期。
              </p>
            </div>
          </div>
          <div className="w-full sm:max-w-md shrink-0 flex flex-col sm:flex-row sm:items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="stall-basis-order" className="sr-only">
                欲扣除餘貨的訂單
              </label>
              <select
                id="stall-basis-order"
                value={stallBasisOrderId}
                onChange={(e) => {
                  const v = e.target.value;
                  setStallBasisOrderId(v);
                  setPreferredProcurementBasisOrderId(v);
                }}
                disabled={basisOrders.length === 0}
                className="w-full min-h-11 rounded-xl border-2 border-violet-800/60 bg-zinc-900/90 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {basisOrders.length === 0 ? (
                  <option value="">尚無可選單</option>
                ) : (
                  <>
                    <option value="">（不指定，下單不扣盤點剩餘）</option>
                    {basisOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        建單 {formatSlashDateTimeFromIso(o.createdAt) ?? o.createdAt} · {o.storeLabel} · {o.id.slice(0, 12)}…
                        {o.stallCountBasisYmd
                          ? ` · 盤點 ${formatYmdWithWeekday(o.stallCountBasisYmd)}`
                          : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setStallBasisOrderId('');
                setPreferredProcurementBasisOrderId('');
              }}
              disabled={basisOrders.length === 0 || !stallBasisOrderId}
              className="shrink-0 min-h-11 px-3 rounded-xl border border-violet-600/50 bg-violet-950/40 text-violet-200 text-sm font-medium hover:bg-violet-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              清空
            </button>
          </div>
        </div>
        {basisOrders.length === 0 && (
          <p className="text-xs text-amber-200/80 border border-amber-800/50 rounded-lg px-2.5 py-2 bg-amber-950/30">
            尚無「已完成盤點」的叫貨單。請在「攤上盤點」完成一筆後，此處才會出現可扣餘貨的訂單。
          </p>
        )}
      </div>

      {orderSuccess && (
        <div className="bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 px-4 py-3 rounded-xl flex items-center gap-3 text-sm sm:text-base">
          <CheckCircle2 size={20} className="shrink-0" />
          <p className="font-medium">訂單已送出。</p>
        </div>
      )}

      <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setStallDaySalesOpen((o) => !o)}
          className="w-full p-4 sm:p-5 flex items-start sm:items-center justify-between gap-4 text-left hover:bg-white/[0.02] transition-colors"
          aria-expanded={stallDaySalesOpen}
        >
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 flex-shrink-0">
              <BarChart2 size={22} className="text-amber-500/80" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#f5f2ed]">
                {selectedBasisOrder
                  ? `所選盤點單帳上售出${
                      selectedBasisOrder.stallCountBasisYmd
                        ? `（${formatYmdWithWeekday(selectedBasisOrder.stallCountBasisYmd)}）`
                        : '（盤點日未押）'
                    }`
                  : '所選盤點單帳上售出（—）'}
              </p>
              {selectedBasisOrder && (
                <p className="text-[0.6875rem] text-zinc-500 mt-0.5 font-mono truncate" title={selectedBasisOrder.id}>
                  單號 {selectedBasisOrder.id} ·{' '}
                  {selectedBasisOrder.status === '已完成' ? '已出貨' : selectedBasisOrder.status}
                </p>
              )}
              <p className="text-xs text-zinc-600 mt-1.5">
                販售品 售出 {stallDayRetailSold.toLocaleString()} 單位 · 應有營收 ${' '}
                {Math.round(stallDayKpi.shouldRevenue).toLocaleString()} · 帶出 ${' '}
                {Math.round(stallDayKpi.estTotal).toLocaleString()}
                {(stallConsKpi.soldVolume > 0 || stallConsKpi.estTotal > 0) && (
                  <span className="text-violet-400/80"> · 耗材 售出 {stallConsKpi.soldVolume} 單位</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="sr-only">{stallDaySalesOpen ? '收合' : '展開'}</span>
            {stallDaySalesOpen ? <ChevronUp className="text-zinc-500" size={20} /> : <ChevronDown className="text-zinc-500" size={20} />}
          </div>
        </button>
        {stallDaySalesOpen && (
          <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 sm:px-5 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">品項彙整</p>
            {stallDaySalesRows.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {stallDaySalesRows.map(({ item, c }) => (
                  <li
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 text-zinc-300 border-b border-zinc-800/60 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="min-w-0 font-medium text-rose-200/90 inline-flex items-center gap-1.5 flex-wrap">
                      {item.name}
                      {isConsumableItem(item) && (
                        <span className="text-[0.5625rem] font-semibold text-violet-300/90 border border-violet-800/50 rounded px-1">
                          消耗品
                        </span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs sm:text-sm text-zinc-500 tabular-nums">
                      <span>
                        帶出 <span className="text-zinc-300">{c.out.toLocaleString()}</span> {item.pieceUnit}
                      </span>
                      <span>
                        剩餘 <span className="text-zinc-300">{c.remain.toLocaleString()}</span> {item.pieceUnit}
                      </span>
                      <span>
                        售出 <span className="text-amber-300/90 font-medium">{c.sold.toLocaleString()}</span> {item.pieceUnit}
                      </span>
                      <span className={cn('text-zinc-400', isConsumableItem(item) && 'text-violet-400/80')}>
                        {`售出面額 $ ${Math.round(c.soldRevenue).toLocaleString()}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">此日尚無資料。</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-amber-900/40 bg-amber-950/15 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 text-amber-200/90">
          <Bookmark size={18} className="shrink-0 text-amber-500" />
          <h3 className="text-sm font-semibold">常用訂單</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="sr-only" htmlFor="favorite-name">
              新常用訂單名稱
            </label>
            <input
              id="favorite-name"
              type="text"
              value={newFavoriteName}
              onChange={(e) => setNewFavoriteName(e.target.value)}
              placeholder="名稱（例：週一固定、週五加量、明日預訂）"
              className="w-full h-11 rounded-xl border-2 border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            type="button"
            onClick={saveAsFavorite}
            disabled={totalCount === 0}
            className="shrink-0 h-11 px-4 rounded-xl border-2 border-amber-600/50 bg-amber-600/20 text-amber-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed active:bg-amber-600/30"
          >
            儲存目前訂單
          </button>
        </div>
        {favoriteError && (
          <p className="text-xs text-rose-400/90" role="status">
            {favoriteError}
          </p>
        )}
        {favorites.length > 0 ? (
          <ul className="space-y-2">
            {favorites.map((f) => {
              const favoriteLineTotal = Object.entries(f.quantities).reduce(
                (sum, [id, qty]) => {
                  const item = getSupplyItem(id, supplyRetailView);
                  const q = Number(qty) || 0;
                  if (!item || q <= 0) return sum;
                  return sum + pricePerPackage(item) * q;
                },
                0
              );
              const favoriteRetailTotal = Object.entries(f.quantities).reduce(
                (sum, [id, qty]) => {
                  const item = getSupplyItem(id, supplyRetailView);
                  const q = Number(qty) || 0;
                  if (!item || q <= 0) return sum;
                  return sum + estimatedRetailPerPackage(item) * q;
                },
                0
              );
              return (
                <li
                  key={f.id}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors',
                    deleteArmedId === f.id
                      ? 'border-rose-500/50 bg-rose-950/25 ring-1 ring-rose-500/20'
                      : 'border-zinc-800 bg-zinc-900/50'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-200 truncate">{f.name}</p>
                    <div className="mt-1 space-y-0.5 text-xs tabular-nums">
                      {showProcurementCost && (
                        <p className="text-amber-400/90 font-medium">
                          批貨成本 ${' '}
                          {(Math.round(favoriteLineTotal * 100) / 100).toLocaleString('zh-TW', {
                            maximumFractionDigits: 2,
                            minimumFractionDigits: 0,
                          })}
                        </p>
                      )}
                      <p className={cn('font-medium', showProcurementCost ? 'text-emerald-400/90' : 'text-emerald-400')}>
                        零售預估 ${' '}
                        {(Math.round(favoriteRetailTotal * 100) / 100).toLocaleString('zh-TW', {
                          maximumFractionDigits: 2,
                          minimumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                    {deleteArmedId === f.id && (
                      <p className="text-[0.6875rem] text-rose-300/90 mt-1">
                        再按一次垃圾桶，才會刪除此常用訂單。
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteArmedId(null);
                        applyFavoriteReplace(f);
                      }}
                      className="min-h-9 px-3 rounded-lg bg-amber-600 text-zinc-950 text-xs font-bold"
                    >
                      套用
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFavoriteDeductStallBasisRemain(f)}
                      className="min-h-9 px-3 rounded-lg border border-amber-600/60 bg-amber-600/10 text-amber-200 text-xs font-semibold hover:bg-amber-600/20"
                      title="扣盤點剩再帶入"
                    >
                      扣盤點剩再帶入
                    </button>
                    {deleteArmedId === f.id && (
                      <button
                        type="button"
                        onClick={() => setDeleteArmedId(null)}
                        className="min-h-9 px-2 text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        取消
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteFavoriteClick(f)}
                      className={cn(
                        'min-h-9 min-w-9 p-0 rounded-lg border flex items-center justify-center',
                        deleteArmedId === f.id
                          ? 'border-rose-500/70 bg-rose-600/20 text-rose-300 hover:bg-rose-600/30'
                          : 'border-zinc-700 text-zinc-500 hover:text-rose-400 hover:border-rose-800'
                      )}
                      title={deleteArmedId === f.id ? '再按以確認刪除' : '刪除（需再按一次確認）'}
                      aria-label={
                        deleteArmedId === f.id
                          ? `確認刪除 ${f.name}`
                          : `刪除 ${f.name}，需再按一次`
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">尚無儲存。把購物車湊好後按「儲存目前訂單」即可在這裡重複使用。</p>
        )}
      </div>

      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-2 bg-[#0d0d0d]/95 backdrop-blur-sm border-b border-zinc-800/80 space-y-3 sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:pb-0 sm:pt-0">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={20} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋品名（例：鴨頭、豆干）"
            enterKeyHint="search"
            className="w-full h-12 sm:h-11 pl-11 pr-4 rounded-2xl border-2 border-zinc-700 bg-zinc-900/80 text-zinc-100 text-base placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none touch-pan-x">
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id as 'all' | ItemCategory)}
              className={cn(
                'flex-shrink-0 min-h-[44px] min-w-[2.75rem] px-4 rounded-full text-sm sm:text-sm font-medium border-2 transition-colors',
                activeCategory === c.id
                  ? 'bg-amber-600/20 text-amber-400 border-amber-600/50'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-400 active:bg-zinc-800'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {visibleItems.length === 0 && (
        <p className="text-center text-zinc-500 py-10 text-sm">沒有符合的品項，請改搜尋或分類。</p>
      )}

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-2.5">
        {visibleItems.map((item) => {
          const q = cart[item.id] || 0;
          return (
            <li
              key={item.id}
              className={cn(
                'flex flex-col rounded-xl border p-2.5 sm:p-3',
                q > 0
                  ? 'border-amber-500/50 bg-amber-600/10 ring-1 ring-amber-600/20'
                  : isConsumableItem(item)
                    ? 'border-violet-900/50 bg-violet-950/20'
                    : 'border-zinc-800/90 bg-zinc-900/40'
              )}
            >
              <div className="flex items-start justify-between gap-1.5 gap-y-0">
                <h3 className="text-[0.95rem] sm:text-base font-semibold text-zinc-100 leading-snug line-clamp-2 min-w-0 flex-1 pr-0.5">
                  {item.name}
                </h3>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {isConsumableItem(item) && (
                    <span className="text-[0.5rem] sm:text-[0.5625rem] font-bold bg-violet-800/50 text-violet-200 border border-violet-600/50 px-1 py-0.5 rounded leading-none">
                      消耗品
                    </span>
                  )}
                  {item.tag && (
                    <span className="text-[0.5625rem] sm:text-[0.625rem] font-bold bg-amber-600 text-zinc-950 px-1.5 py-0.5 rounded leading-none">
                      {item.tag}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-col items-end gap-0.5 text-xs leading-snug">
                {showProcurementCost ? (
                  <>
                    <span className="text-amber-400 font-semibold tabular-nums text-[0.8125rem] sm:text-sm">
                      批貨 ${pricePerPackage(item).toLocaleString()}
                      <span className="text-zinc-500 font-normal">／{item.pieceUnit}</span>
                    </span>
                    <span className="text-emerald-400/95 font-semibold tabular-nums text-[0.75rem] sm:text-[0.8125rem]">
                      零售預估 ${estimatedRetailPerPackage(item).toLocaleString()}
                      <span className="text-zinc-500 font-normal">／{item.pieceUnit}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-emerald-400 font-semibold tabular-nums text-[0.8125rem] sm:text-sm text-right max-w-full">
                    零售預估 ${estimatedRetailPerPackage(item).toLocaleString()}
                    <span className="text-zinc-500 font-normal">／{item.pieceUnit}</span>
                  </span>
                )}
              </div>

              <div className="mt-2.5 flex items-stretch rounded-lg border border-zinc-700/80 bg-zinc-950/60 overflow-hidden min-h-[2.75rem] sm:min-h-12">
                <button
                  type="button"
                  aria-label={`${item.name} 減一`}
                  onClick={() => bumpQty(item.id, -1)}
                  className="w-9 min-w-9 sm:w-10 min-h-[2.75rem] sm:min-h-12 flex items-center justify-center text-zinc-400 active:bg-zinc-800/90 sm:active:bg-zinc-800/80"
                >
                  <Minus size={20} strokeWidth={2.5} />
                </button>
                <div className="flex-1 min-w-[2.5rem] flex flex-col items-stretch justify-center border-x border-zinc-800/80 px-0.5 py-0.5">
                  <input
                    type="text"
                    name={`qty-${item.id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    id={`proc-qty-${item.id}`}
                    value={
                      item.id in qtyInputDraft
                        ? qtyInputDraft[item.id]
                        : q > 0
                          ? String(roundProcurementQty(q))
                          : ''
                    }
                    onChange={(e) => {
                      let t = e.target.value.replace(/[^\d.]/g, '');
                      const firstDot = t.indexOf('.');
                      if (firstDot !== -1) {
                        t =
                          t.slice(0, firstDot + 1) +
                          t.slice(firstDot + 1).replace(/\./g, '');
                      }
                      const segs = t.split('.');
                      if (segs[1] && segs[1].length > 3) {
                        t = `${segs[0]}.${segs[1].slice(0, 3)}`;
                      }
                      if (t.length > 20) t = t.slice(0, 20);
                      setQtyInputDraft((p) => ({ ...p, [item.id]: t }));
                    }}
                    onFocus={(e) => {
                      setQtyInputDraft((p) => {
                        if (p[item.id] !== undefined) return p;
                        return {
                          ...p,
                          [item.id]: q > 0 ? String(roundProcurementQty(q)) : '',
                        };
                      });
                      e.currentTarget.select();
                    }}
                    onBlur={() => {
                      const cur = qtyInputDraft[item.id];
                      if (cur === undefined) return;
                      const n = parseQtyInput(cur);
                      setItemQty(item.id, n);
                      clearQtyDraft(item.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="0"
                    className="w-full min-h-0 flex-1 bg-zinc-900/30 text-center text-base sm:text-lg font-bold tabular-nums text-amber-400 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-inset rounded-sm"
                    aria-label={`${item.name} 數量（單位：${item.pieceUnit}），可小數、最多三位小數，0–${PROCUREMENT_QTY_MAX.toLocaleString()}`}
                  />
                  <span className="text-[0.5625rem] sm:text-[0.625rem] text-zinc-500 text-center leading-none pb-0.5 pointer-events-none truncate max-w-full px-0.5">
                    {item.pieceUnit}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`${item.name} 加一`}
                  onClick={() => bumpQty(item.id, 1)}
                  className="w-9 min-w-9 sm:w-10 min-h-[2.75rem] sm:min-h-12 flex items-center justify-center text-amber-500 active:bg-amber-600/20"
                >
                  <Plus size={20} strokeWidth={2.5} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {totalCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-40 pointer-events-none px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 bg-gradient-to-t from-[#0a0a0a] to-transparent">
          <div className="max-w-3xl mx-auto pointer-events-auto rounded-2xl border border-zinc-700/90 bg-zinc-950/95 backdrop-blur-md shadow-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <ShoppingBasket className="text-amber-500" size={28} />
                <span className="absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center bg-amber-600 text-[0.625rem] font-bold text-zinc-900 rounded-full px-0.5">
                  {totalCountDisplay}
                </span>
              </div>
              <div className="min-w-0">
                {showProcurementCost ? (
                  <div className="flex flex-row flex-wrap items-end gap-5 sm:gap-7">
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-500">批貨成本</p>
                      <p className="text-lg sm:text-xl font-semibold text-amber-400 tabular-nums">
                        $ {totalPrice.toLocaleString()}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-500">零售預估（售完參考）</p>
                      <p className="text-lg sm:text-xl font-semibold text-emerald-400 tabular-nums">
                        $ {totalRetailEstimate.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-zinc-500">零售預估合計（售完參考）</p>
                    <p className="text-xl font-semibold text-emerald-400 tabular-nums">
                      $ {totalRetailEstimate.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-row flex-wrap gap-2 w-full sm:w-auto sm:shrink-0 sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setCart({});
                  setQtyInputDraft({});
                  setSubmitModalOpen(false);
                }}
                className="flex-1 sm:flex-initial min-w-0 min-h-[48px] px-4 sm:px-5 rounded-xl border-2 border-zinc-600 bg-zinc-900/80 text-zinc-200 text-base font-semibold hover:bg-zinc-800 active:scale-[0.98]"
              >
                清空
              </button>
              <button
                type="button"
                onClick={openSubmitConfirm}
                className="flex-1 sm:flex-initial min-w-0 min-h-[48px] px-4 sm:px-6 rounded-xl bg-amber-500 text-zinc-950 text-base font-bold active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <ListOrdered size={20} />
                送出訂單
              </button>
            </div>
          </div>
        </div>
      )}

      {submitModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-order-confirm-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 sm:p-6 animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="submit-order-confirm-title" className="text-lg font-bold text-[#f5f2ed]">
                  確認送出訂單？
                </h3>
                <p className="text-sm text-zinc-500 mt-2">
                  {showProcurementCost ? (
                    <>
                      批貨成本{' '}
                      <span className="text-amber-400 font-semibold tabular-nums">
                        $ {totalPrice.toLocaleString()}
                      </span>
                      ・ 零售預估{' '}
                      <span className="text-emerald-400 font-semibold tabular-nums">
                        $ {totalRetailEstimate.toLocaleString()}
                      </span>
                    </>
                  ) : (
                    <>
                      零售預估合計（參考）{' '}
                      <span className="text-emerald-400 font-semibold tabular-nums">
                        $ {totalRetailEstimate.toLocaleString()}
                      </span>
                    </>
                  )}
                  ・ 共 {totalCountDisplay} 數量
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubmitModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 shrink-0"
                aria-label="關閉"
              >
                <X size={22} />
              </button>
            </div>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setSubmitModalOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-zinc-600 text-zinc-300 text-sm font-medium hover:bg-zinc-800/80"
              >
                返回修改
              </button>
              <button
                type="button"
                onClick={executeCheckout}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-amber-500 text-zinc-950 text-sm font-bold hover:bg-amber-400"
              >
                確定送出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
