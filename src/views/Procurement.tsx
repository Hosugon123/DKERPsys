import {
  ShoppingBasket,
  Minus,
  Plus,
  ListOrdered,
  CheckCircle2,
  Bookmark,
  Trash2,
  CalendarDays,
  BarChart2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { UserRole } from './Orders';
import { AUTH_SESSION_CHANGED_EVENT } from '../lib/authSession';
import { orders as ordersApi } from '../services/apiService';
import {
  displayOrderCreatedByLabel,
  effectiveOrderDateYmd,
  resolveOrderDataScopeId,
  type OrderHistoryLine,
  type OrderHistoryEntry,
} from '../lib/orderHistoryStorage';
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
  isFranchiseeSelfSuppliedItem,
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
  ymd,
} from '../lib/stallInventoryStorage';
import { computeLine, aggregateStallKpis, roundProcurementQty, PROCUREMENT_QTY_MAX } from '../lib/stallMath';
import {
  formatSlashDateTimeFromIso,
  formatSlashYmdWithWeekdayFromYmd,
} from '../lib/dateDisplay';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import { getDataScopeContext } from '../lib/dataScope';
import ItemCatalogSettings from './ItemCatalogSettings';

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
  /** 管理員不顯示批貨成本；加盟主／門市員工維持原顯示邏輯 */
  const showProcurementCost = userRole !== 'admin';
  const [view, setView] = useState<'order' | 'catalog' | 'retail'>('order');
  const supplyRetailView = useMemo(() => userRoleToSupplyRetailView(userRole), [userRole]);
  const catalogItems = useSupplyCatalogItems(userRole);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [activeCategory, setActiveCategory] = useState<'all' | ItemCategory>('all');
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [stallTick, setStallTick] = useState(0);
  const [basisOrdersList, setBasisOrdersList] = useState<OrderHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteOrder[]>([]);
  const [newFavoriteName, setNewFavoriteName] = useState('');
  const [favoriteError, setFavoriteError] = useState('');
  /** 手動購物車「扣除盤點剩餘」流程之錯誤提示（不依賴常用訂單） */
  const [manualBasisDeduceError, setManualBasisDeduceError] = useState('');
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
  /** 常用訂單區塊：預設收合節省版面 */
  const [favoritesPanelOpen, setFavoritesPanelOpen] = useState(false);
  /** 送出訂單前須在彈層內再按一次「確定送出」 */
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  /** 訂單歸屬日（可預先下單）；下單時間為送出當下之 createdAt */
  const [newOrderDateYmd, setNewOrderDateYmd] = useState(() => ymd(new Date()));

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
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, h);
    return () => {
      window.removeEventListener('stallInventoryUpdated', h);
      window.removeEventListener('supplyCatalogUpdated', h);
      window.removeEventListener('orderHistoryUpdated', h);
      window.removeEventListener('franchiseManagementOrdersUpdated', h);
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, h);
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
      const ctx = getDataScopeContext();
      const scoped = all.filter((o) => {
        const scope = resolveOrderDataScopeId(o);
        return Boolean(scope && scope === ctx.scopeId);
      });
      setBasisOrdersList(scoped);
    })();
  }, [stallTick]);

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

  const stallDayKpi = useMemo(() => {
    const snap = loadDayForProcurementFromOrder(stallBasisOrderId);
    return aggregateStallKpis(
      catalogItems.map((i) => i.id),
      (id) => snap.lines[id] ?? { out: '', remain: '' },
      (id) => getSupplyItem(id, supplyRetailView)
    ).retail;
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
      if (!it || isConsumableItem(it)) continue;
      const line = snap.lines[item.id] ?? { out: '', remain: '' };
      const c = computeLine(line.out, line.remain, it);
      if (c.sold > 0 || c.out > 0 || c.remain > 0) {
        rows.push({ item: it, c });
      }
    }
    return rows.sort((a, b) => b.c.sold - a.c.sold);
  }, [stallTick, catalogItems, stallBasisOrderId, supplyRetailView]);

  const carryoverRemainByItem = useMemo(() => {
    const snap = loadDayForProcurementFromOrder(stallBasisOrderId);
    const m: Record<string, number> = {};
    for (const item of catalogItems) {
      const line = snap.lines[item.id] ?? { out: '', remain: '' };
      m[item.id] = Math.max(0, roundProcurementQty(Number(line.remain) || 0));
    }
    return m;
  }, [stallBasisOrderId, catalogItems, stallTick]);

  const visibleItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      return true;
    });
  }, [activeCategory, catalogItems]);

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

  /** 與常用訂單「扣盤點剩再帶入」相同：以目前購物車為基準量，扣除所選單據之剩餘後覆寫購物車 */
  const applyManualCartDeductStallBasisRemain = () => {
    setManualBasisDeduceError('');
    if (!stallBasisOrderId.trim()) {
      setManualBasisDeduceError('請先在下拉選單選擇「欲扣除餘貨的訂單」。');
      return;
    }
    if (totalCount <= 0) {
      setManualBasisDeduceError('請先在下方品項輸入叫貨量（當作尚未扣除剩餘前的基準）。');
      return;
    }
    const next = cartFromFavorite(cartAfterDeductingStallRemainFromOrder(cart, stallBasisOrderId));
    if (Object.keys(next).length === 0) {
      setManualBasisDeduceError('扣除剩餘後暫無需補貨。');
      return;
    }
    setCart(next);
    setQtyInputDraft({});
  };

  const totalPrice = Object.entries(cart).reduce((total, [id, n]) => {
    const item = getSupplyItem(id, supplyRetailView);
    const q = Number(n);
    return total + (item && q > 0 ? pricePerPackage(item) * q : 0);
  }, 0);
  const totalPayablePrice = totalPrice;
  const totalSelfSuppliedCost = Object.entries(cart).reduce((total, [id, n]) => {
    const item = getSupplyItem(id, supplyRetailView);
    const q = Number(n);
    if (!item || q <= 0) return total;
    if (userRole === 'franchisee' && isFranchiseeSelfSuppliedItem(item)) return total + pricePerPackage(item) * q;
    return total;
  }, 0);
  const payableTitle = userRole === 'franchisee' ? '貨款總額' : '批貨成本';
  const selfSuppliedDeduction = Math.round(totalSelfSuppliedCost * 100) / 100;
  const franchiseeNetPayable = Math.max(0, Math.round((totalPrice - selfSuppliedDeduction) * 100) / 100);
  const totalRetailEstimate = Object.entries(cart).reduce((total, [id, n]) => {
    const item = getSupplyItem(id, supplyRetailView);
    const q = Number(n);
    return total + (item && q > 0 ? estimatedRetailPerPackage(item) * q : 0);
  }, 0);

  /** 手機鍵盤／數量欄聚焦時：底部結帳列改單列精簡，並用 visualViewport 貼在鍵盤上方 */
  const checkoutDockRef = useRef<HTMLDivElement | null>(null);
  const [checkoutBarCompact, setCheckoutBarCompact] = useState(false);
  const syncCheckoutDock = useCallback(() => {
    const el = checkoutDockRef.current;
    const vv = window.visualViewport;
    const inset =
      vv != null ? Math.max(0, window.innerHeight - vv.offsetTop - vv.height) : 0;
    if (el) el.style.bottom = `${inset}px`;

    const mobile = window.matchMedia('(max-width:639px)').matches;
    const ae = document.activeElement as HTMLElement | null;
    const qtyFieldFocused =
      ae?.tagName === 'INPUT' && (ae.getAttribute('name')?.startsWith('qty-') ?? false);
    const keyboardLikely = inset > 96;
    setCheckoutBarCompact(mobile && (qtyFieldFocused || keyboardLikely));
  }, []);

  useEffect(() => {
    syncCheckoutDock();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncCheckoutDock);
    vv?.addEventListener('scroll', syncCheckoutDock);
    window.addEventListener('resize', syncCheckoutDock);
    document.addEventListener('focusin', syncCheckoutDock);
    document.addEventListener('focusout', syncCheckoutDock);
    return () => {
      vv?.removeEventListener('resize', syncCheckoutDock);
      vv?.removeEventListener('scroll', syncCheckoutDock);
      window.removeEventListener('resize', syncCheckoutDock);
      document.removeEventListener('focusin', syncCheckoutDock);
      document.removeEventListener('focusout', syncCheckoutDock);
    };
  }, [syncCheckoutDock]);

  useEffect(() => {
    if (totalCount > 0) syncCheckoutDock();
  }, [totalCount, syncCheckoutDock]);

  const compactPayableHint =
    userRole === 'franchisee' && (selfSuppliedDeduction > 0 || totalSelfSuppliedCost > 0)
      ? `貨款總額 $${totalPayablePrice.toLocaleString()}` +
        (selfSuppliedDeduction > 0
          ? `・實際應付 $${franchiseeNetPayable.toLocaleString()}（已扣自備 $${Math.round(selfSuppliedDeduction).toLocaleString()}）`
          : '') +
        (totalSelfSuppliedCost > 0
          ? `・自備成本 $${Math.round(totalSelfSuppliedCost).toLocaleString()}`
          : '')
      : undefined;

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
    setNewOrderDateYmd(ymd(new Date()));
    setSubmitModalOpen(true);
  };

  const executeCheckout = useCallback(() => {
    const lines = buildLinesFromCart();
    if (lines.length === 0) {
      setSubmitModalOpen(false);
      return;
    }
    const amount = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const payableAmount = amount;
    const selfSuppliedCostAmount = lines.reduce((s, l) => {
      const item = getSupplyItem(l.productId, supplyRetailView);
      if (userRole === 'franchisee' && isFranchiseeSelfSuppliedItem(item)) return s + l.unitPrice * l.qty;
      return s;
    }, 0);
    setSubmitModalOpen(false);

    const toDeduct: Record<string, number> = {};
    for (const l of lines) toDeduct[l.productId] = l.qty;
    const basisYmd = getOrderStallCountBasisYmdForDeduction(stallBasisOrderId);
    if (basisYmd) {
      applyOrderDeductionToDayRemain(basisYmd, toDeduct);
    }

    void (async () => {
      await ordersApi.appendProcurementOrderEntry({
        lines,
        totalAmount: amount,
        payableAmount,
        selfSuppliedCostAmount,
        actorRole: userRole,
        orderDateYmd: newOrderDateYmd,
        procurementDeductionBasisOrderId: stallBasisOrderId,
      });
      setOrderSuccess(true);
      setCart({});
      setQtyInputDraft({});
      setNewOrderDateYmd(ymd(new Date()));
      setTimeout(() => setOrderSuccess(false), 3000);
    })();
  }, [buildLinesFromCart, newOrderDateYmd, stallBasisOrderId, supplyRetailView, userRole]);

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
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBasket className="text-amber-500 shrink-0" size={26} />
            批貨與下單
          </h2>
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
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBasket className="text-amber-500 shrink-0" size={26} />
            批貨與下單
          </h2>
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
    <div
      className={cn(
        'space-y-3 max-w-3xl mx-auto lg:max-w-none',
        checkoutBarCompact ? 'pb-28' : 'pb-36'
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBasket className="text-amber-500 shrink-0" size={26} />
            批貨與下單
          </h2>
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

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="shrink-0 text-amber-400" size={20} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200">欲扣除餘貨的訂單</p>
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
                className="w-full min-h-11 rounded-xl border-2 border-zinc-700 bg-zinc-900/90 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {basisOrders.length === 0 ? (
                  <option value="">尚無可選單</option>
                ) : (
                  <>
                    <option value="">（不指定，下單不扣盤點剩餘）</option>
                    {basisOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(o))} ·
                        建單 {displayOrderCreatedByLabel(o)} ·
                        {resolveOrderStoreLabel(o)} ·
                        單號 {o.id} ·
                        {o.status === '已完成' ? '已出貨' : o.status}／{o.stallCountCompletedAt ? '已盤點' : '未盤點'}
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
              className="shrink-0 min-h-11 px-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm font-medium hover:border-amber-600/50 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              清空
            </button>
          </div>
        </div>
        {basisOrders.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={applyManualCartDeductStallBasisRemain}
              disabled={!stallBasisOrderId.trim() || totalCount <= 0}
              className="w-full sm:w-auto min-h-10 px-4 rounded-xl border border-amber-600/60 bg-amber-600/10 text-amber-200 text-sm font-semibold hover:bg-amber-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              以目前購物車扣除盤點剩餘
            </button>
            {manualBasisDeduceError ? (
              <p className="text-xs text-rose-400/90" role="status">
                {manualBasisDeduceError}
              </p>
            ) : null}
          </div>
        )}
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
                    <span className="min-w-0 font-medium text-rose-200/90">{item.name}</span>
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
                      <span className="text-zinc-400">
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

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 overflow-hidden">
        <button
          type="button"
          onClick={() => setFavoritesPanelOpen((o) => !o)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
          aria-expanded={favoritesPanelOpen}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Bookmark size={18} className="shrink-0 text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-200/90 min-w-0">常用訂單</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="sr-only">{favoritesPanelOpen ? '收合' : '展開'}</span>
            {favoritesPanelOpen ? (
              <ChevronUp className="text-zinc-500" size={20} />
            ) : (
              <ChevronDown className="text-zinc-500" size={20} />
            )}
          </div>
        </button>
        {favoritesPanelOpen && (
          <div className="border-t border-zinc-800 px-4 py-3 space-y-3 bg-zinc-900/50">
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
                      if (userRole === 'franchisee' && isFranchiseeSelfSuppliedItem(item)) return sum;
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
                              {payableTitle} ${' '}
                              {(Math.round(favoriteLineTotal * 100) / 100).toLocaleString('zh-TW', {
                                maximumFractionDigits: 2,
                                minimumFractionDigits: 0,
                              })}
                            </p>
                          )}
                          <p
                            className={cn(
                              'font-medium',
                              showProcurementCost ? 'text-emerald-400/90' : 'text-emerald-400'
                            )}
                          >
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
              <p className="text-xs text-zinc-500">
                尚無儲存。把購物車湊好後按「儲存目前訂單」即可在這裡重複使用。
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-2 bg-[#0d0d0d]/95 backdrop-blur-sm border-b border-zinc-800/80 sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:pb-0 sm:pt-0">
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
        <p className="text-center text-zinc-500 py-10 text-sm">此分類沒有品項。</p>
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
                    ? 'border-amber-900/50 bg-amber-950/20'
                    : 'border-zinc-800/90 bg-zinc-900/40'
              )}
            >
              <div className="flex items-start justify-between gap-1.5 gap-y-0">
                <h3 className="text-[0.95rem] sm:text-base font-semibold text-zinc-100 leading-snug line-clamp-2 min-w-0 flex-1 pr-0.5">
                  {item.name}
                </h3>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {isConsumableItem(item) && (
                    <span className="text-[0.5rem] sm:text-[0.5625rem] font-bold bg-amber-800/50 text-amber-200 border border-amber-600/50 px-1 py-0.5 rounded leading-none">
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
              <div className="mt-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2 py-1.5 text-[0.6875rem] sm:text-[0.72rem] text-zinc-400 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span>昨日剩貨</span>
                  <span className="tabular-nums text-zinc-300">
                    {(carryoverRemainByItem[item.id] ?? 0).toLocaleString()} {item.pieceUnit}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>建議叫貨</span>
                  <span className="tabular-nums text-amber-300">
                    {q.toLocaleString()} {item.pieceUnit}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>明日預計帶出</span>
                  <span className="tabular-nums text-emerald-300">
                    {roundProcurementQty((carryoverRemainByItem[item.id] ?? 0) + q).toLocaleString()} {item.pieceUnit}
                  </span>
                </div>
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
                    enterKeyHint="done"
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
        <div
          ref={checkoutDockRef}
          className={cn(
            'fixed left-0 right-0 lg:left-64 z-40 pointer-events-none bg-gradient-to-t from-[#0a0a0a] to-transparent',
            checkoutBarCompact
              ? 'px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1'
              : 'px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2'
          )}
        >
          <div
            className={cn(
              'max-w-3xl mx-auto pointer-events-auto border border-zinc-700/90 bg-zinc-950/95 backdrop-blur-md shadow-2xl',
              checkoutBarCompact
                ? 'rounded-xl p-2 flex flex-row flex-nowrap items-stretch gap-2'
                : 'rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'
            )}
          >
            {checkoutBarCompact ? (
              <>
                <ShoppingBasket className="text-amber-500 shrink-0 self-center" size={22} aria-hidden />
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  {showProcurementCost ? (
                    <div
                      className="flex flex-wrap items-baseline gap-x-1 gap-y-0 text-[11px] leading-snug tabular-nums"
                      aria-label="訂單金額摘要"
                    >
                      <span className="text-zinc-500 shrink-0">{payableTitle}</span>
                      <span
                        className="font-semibold text-amber-400 shrink-0"
                        title={compactPayableHint}
                      >
                        $ {totalPayablePrice.toLocaleString()}
                      </span>
                      <span className="text-zinc-600 shrink-0" aria-hidden>
                        ·
                      </span>
                      <span className="text-zinc-500 shrink-0">零售估</span>
                      <span className="font-semibold text-emerald-400">
                        $ {totalRetailEstimate.toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] leading-snug tabular-nums flex flex-wrap items-baseline gap-x-1 gap-y-0">
                      <span className="text-zinc-500 shrink-0">零售預估</span>
                      <span className="font-semibold text-emerald-400">
                        $ {totalRetailEstimate.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5 items-stretch">
                  <button
                    type="button"
                    onClick={() => {
                      setCart({});
                      setQtyInputDraft({});
                      setSubmitModalOpen(false);
                    }}
                    className="min-w-0 min-h-0 h-10 px-3 rounded-lg border-2 border-zinc-600 bg-zinc-900/80 text-zinc-200 text-sm font-semibold hover:bg-zinc-800 active:scale-[0.98]"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    onClick={openSubmitConfirm}
                    className="min-w-0 min-h-0 h-10 px-3.5 rounded-lg bg-amber-500 text-zinc-950 text-sm font-bold active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                    aria-label="送出訂單"
                  >
                    <ListOrdered size={17} className="shrink-0" aria-hidden />
                    送出
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <ShoppingBasket className="text-amber-500" size={28} />
                  </div>
                  <div className="min-w-0">
                    {showProcurementCost ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5 min-w-[15rem] sm:min-w-[26rem]">
                        <div className="min-w-0 sm:pr-2">
                          <p className="text-xs text-zinc-500">{payableTitle}</p>
                          <p className="text-lg sm:text-xl font-semibold text-amber-400 tabular-nums">
                            $ {totalPayablePrice.toLocaleString()}
                          </p>
                          {userRole === 'franchisee' && selfSuppliedDeduction > 0 && (
                            <p className="text-[11px] text-zinc-500 mt-0.5">
                              扣除自備品項 $ {Math.round(selfSuppliedDeduction).toLocaleString()} 後，實際應付 $
                              {Math.round(franchiseeNetPayable).toLocaleString()}
                            </p>
                          )}
                          {userRole === 'franchisee' && totalSelfSuppliedCost > 0 && (
                            <p className="text-[11px] text-zinc-500">
                              自備成本（計入支出）$ {Math.round(totalSelfSuppliedCost).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0 sm:pl-2 sm:border-l sm:border-zinc-800/70">
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
              </>
            )}
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
                      {payableTitle}{' '}
                      <span className="text-amber-400 font-semibold tabular-nums">
                        $ {totalPayablePrice.toLocaleString()}
                      </span>
                      {userRole === 'franchisee' && selfSuppliedDeduction > 0 && (
                        <>
                          {' '}・ 扣除自備{' '}
                          <span className="text-zinc-300 font-semibold tabular-nums">
                            $ {Math.round(selfSuppliedDeduction).toLocaleString()}
                          </span>
                          {' '}・ 實際應付{' '}
                          <span className="text-amber-300 font-semibold tabular-nums">
                            $ {Math.round(franchiseeNetPayable).toLocaleString()}
                          </span>
                        </>
                      )}
                      {userRole === 'franchisee' && totalSelfSuppliedCost > 0 && (
                        <>
                          {' '}・ 自備成本{' '}
                          <span className="text-zinc-300 font-semibold tabular-nums">
                            $ {Math.round(totalSelfSuppliedCost).toLocaleString()}
                          </span>
                        </>
                      )}
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
            <div className="mt-4 space-y-2">
              <label
                htmlFor="new-order-date-ymd"
                className="block cursor-pointer rounded-xl border-2 border-zinc-700/90 bg-zinc-950/80 p-3 transition-colors hover:border-zinc-600 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/25"
              >
                <span className="block text-xs font-medium text-zinc-400 mb-2">訂單日期（點此區選擇）</span>
                <div className="relative">
                  <input
                    id="new-order-date-ymd"
                    type="date"
                    value={newOrderDateYmd}
                    onChange={(e) => setNewOrderDateYmd(e.target.value)}
                    className="w-full min-h-12 cursor-pointer rounded-lg border border-zinc-600/80 bg-zinc-900/90 pl-3 pr-11 py-2.5 text-base text-zinc-100 [color-scheme:dark] focus:outline-none sm:text-sm"
                  />
                  <CalendarDays
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-500/80"
                    size={20}
                    aria-hidden
                  />
                </div>
              </label>
              <p className="text-[0.6875rem] text-zinc-500 leading-relaxed">
                可選未來日期作為預先叫貨之歸屬日。實際下單時間以按下「確定送出」時之系統時間為準。
              </p>
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
