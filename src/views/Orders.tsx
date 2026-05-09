import { useState, useMemo, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { Search, Package, MapPin, Phone, User, Calendar, X, Minus, Plus, Trash2, ListOrdered, Store } from 'lucide-react';
import { cn } from '../lib/utils';
import { orderDateQueryMatches, formatSlashDateTimeWithWeekdayFromIso, orderMatchesActiveWeekdays } from '../lib/dateDisplay';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import { OrderWeekdayFilter } from '../components/OrderWeekdayFilter';
import { orders as ordersApi } from '../services/apiService';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import type {
  FranchiseManagementOrder,
  OrderHistoryEntry,
  OrderHistoryLine,
} from '../lib/orderHistoryStorage';
import {
  getStallDisplayRetailEstAndRemain,
  getStallDisplayShouldRevenue,
  getStallDisplaySoldAtRetail,
  getStallDisplayActualRevenue,
} from '../lib/orderStallDisplayRevenue';
import { userRoleToSupplyRetailView } from '../lib/supplyCatalog';

function orderTimeToYmdKey(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type UserRole = 'admin' | 'franchisee' | 'employee';

const STATUS_TABS = ['所有訂單', '待出貨', '已完成', '已取消'] as const;
type StatusFilter = (typeof STATUS_TABS)[number];

const HQ_STORE_LABEL = '直營店';
type StoreTypeFilter = 'all' | 'hq' | 'franchise';
const STORE_TYPE_TABS: { id: StoreTypeFilter; label: string }[] = [
  { id: 'all', label: '全部店家' },
  { id: 'hq', label: '直營店' },
  { id: 'franchise', label: '加盟店' },
];

type OrderRow = {
  id: string;
  franchisee: string;
  contact: string;
  phone: string;
  address: string;
  time: string;
  itemLines: { name: string; unit: string; qty: number; price: number }[];
  /** 下單／叫貨合計（明細、揀貨合計用） */
  amount: number;
  procurementAmount: number;
  selfSuppliedDeduction: number;
  netPayableAmount: number;
  estimatedAmount: number | null;
  remainAmount: number | null;
  countedRevenueAmount: number | null;
  actualIncomeAmount: number | null;
  status: '待出貨' | '已完成' | '已取消';
};

type OrderFinancialSummary = {
  procurementAmount: number;
  selfSuppliedDeduction: number;
  netPayableAmount: number;
  estimatedAmount: number | null;
  remainAmount: number | null;
  countedRevenueAmount: number | null;
  actualIncomeAmount: number | null;
};

function formatOrderWhen(iso: string) {
  return formatSlashDateTimeWithWeekdayFromIso(iso) || iso;
}

function toOrderRowFromMgmt(
  o: FranchiseManagementOrder,
  financials: OrderFinancialSummary
): OrderRow {
  return {
    id: o.id,
    franchisee: resolveOrderStoreLabel({
      storeLabel: o.storeLabel,
      actorRole: 'admin',
      actorUserId: o.actorUserId,
    }),
    contact: '—',
    phone: '—',
    address: '—',
    time: formatOrderWhen(o.createdAt),
    itemLines: o.lines.map((l) => ({
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      price: l.unitPrice * l.qty,
    })),
    amount: o.totalAmount,
    procurementAmount: financials.procurementAmount,
    selfSuppliedDeduction: financials.selfSuppliedDeduction,
    netPayableAmount: financials.netPayableAmount,
    estimatedAmount: financials.estimatedAmount,
    remainAmount: financials.remainAmount,
    countedRevenueAmount: financials.countedRevenueAmount,
    actualIncomeAmount: financials.actualIncomeAmount,
    status: o.status,
  };
}

function toOrderRowFromHistory(
  o: OrderHistoryEntry,
  financials: OrderFinancialSummary
): OrderRow {
  return {
    id: o.id,
    franchisee: resolveOrderStoreLabel(o),
    contact: '—',
    phone: '—',
    address: '—',
    time: formatOrderWhen(o.createdAt),
    itemLines: o.lines.map((l) => ({
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      price: l.unitPrice * l.qty,
    })),
    amount: o.totalAmount,
    procurementAmount: financials.procurementAmount,
    selfSuppliedDeduction: financials.selfSuppliedDeduction,
    netPayableAmount: financials.netPayableAmount,
    estimatedAmount: financials.estimatedAmount,
    remainAmount: financials.remainAmount,
    countedRevenueAmount: financials.countedRevenueAmount,
    actualIncomeAmount: financials.actualIncomeAmount,
    status: o.status,
  };
}

type RawOrder = FranchiseManagementOrder | OrderHistoryEntry;

function isOrderHistoryEntry(r: RawOrder): r is OrderHistoryEntry {
  return 'actorRole' in r;
}

function isFranchiseManagementOrder(r: RawOrder): r is FranchiseManagementOrder {
  return !isOrderHistoryEntry(r);
}

function canEditOrderInList(raw: RawOrder | undefined, role: UserRole): boolean {
  if (!raw) return false;
  if (role === 'admin') return true;
  if (role === 'franchisee') {
    return isOrderHistoryEntry(raw) && raw.actorRole === 'franchisee';
  }
  if (role === 'employee') {
    return isOrderHistoryEntry(raw) && raw.actorRole === 'employee';
  }
  return false;
}

function mergeRawOrdersForDisplay(
  mgmt: FranchiseManagementOrder[],
  history: OrderHistoryEntry[]
): RawOrder[] {
  const byId = new Map<string, RawOrder>();
  for (const o of mgmt) {
    if (!byId.has(o.id)) byId.set(o.id, o);
  }
  for (const o of history) {
    if (!byId.has(o.id)) byId.set(o.id, o);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

async function loadMgmtSliceForRole(role: UserRole): Promise<FranchiseManagementOrder[]> {
  if (role === 'admin' || role === 'employee') return ordersApi.loadFranchiseManagementOrders();
  return [];
}

async function loadHistorySliceForRole(role: UserRole): Promise<OrderHistoryEntry[]> {
  const all = await ordersApi.loadOrderHistory();
  if (role === 'admin') return all;
  if (role === 'franchisee') return all.filter((e) => e.actorRole === 'franchisee');
  if (role === 'employee') return all.filter((e) => e.actorRole === 'employee' || e.actorRole === 'admin');
  return [];
}

/** 內部儲存仍為「已完成」；列表／分頁等畫面顯示用「已出貨」 */
function orderStatusDisplayLabel(
  s: '待出貨' | '已完成' | '已取消'
): string {
  return s === '已完成' ? '已出貨' : s;
}

const PICK_MAX_Q = 99_999;

function parsePickQty(s: string) {
  return Math.max(0, Math.min(PICK_MAX_Q, Math.floor(parseInt(s.replace(/[^\d]/g, ''), 10) || 0)));
}

export default function Orders({ userRole }: { userRole: UserRole }) {
  const isHeadquarters = userRole === 'admin';

  const [mgmtOrders, setMgmtOrders] = useState<FranchiseManagementOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<OrderHistoryEntry[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('所有訂單');
  /** 店家類型篩選：全部 / 直營 / 加盟 */
  const [storeTypeFilter, setStoreTypeFilter] = useState<StoreTypeFilter>('all');
  /** 指定店家篩選；'all' 表示不指定，其他為已解析後的店名（與列表顯示一致） */
  const [storeLabelFilter, setStoreLabelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  /** 建單星期篩選（空＝不篩選） */
  const [activeWeekdays, setActiveWeekdays] = useState<number[]>([]);
  const [datePanelOpen, setDatePanelOpen] = useState(false);
  /** 已套用的訂單日期篩選（含起迄日）；null 表示不篩日期 */
  const [appliedDateRange, setAppliedDateRange] = useState<{ from: string; to: string } | null>(null);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const datePopoverRef = useRef<HTMLDivElement>(null);
  /** 出貨：兩階段確認 */
  const [shipModal, setShipModal] = useState<null | { id: string; step: 1 | 2 }>(null);
  /** 已出貨改回待出貨 */
  const [revertModal, setRevertModal] = useState<null | { id: string }>(null);
  const [cancelModal, setCancelModal] = useState<null | { id: string }>(null);
  const [deleteModal, setDeleteModal] = useState<null | { id: string }>(null);
  /** 調整貨量：一次僅編輯一單的實出數量（可增可減） */
  const [pickingOrderId, setPickingOrderId] = useState<string | null>(null);
  const [pickingLines, setPickingLines] = useState<OrderHistoryLine[]>([]);
  const [pickingOriginal, setPickingOriginal] = useState<OrderHistoryLine[]>([]);
  const [pickingError, setPickingError] = useState<string | null>(null);
  const syncOrders = useCallback(() => {
    void (async () => {
      const [mgmt, hist] = await Promise.all([
        loadMgmtSliceForRole(userRole),
        loadHistorySliceForRole(userRole),
      ]);
      setMgmtOrders(mgmt);
      setHistoryOrders(hist);
    })();
  }, [userRole]);

  useEffect(() => {
    syncOrders();
  }, [userRole, syncOrders]);

  useEffect(() => {
    const h = () => syncOrders();
    window.addEventListener('franchiseManagementOrdersUpdated', h);
    window.addEventListener('orderHistoryUpdated', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('franchiseManagementOrdersUpdated', h);
      window.removeEventListener('orderHistoryUpdated', h);
      window.removeEventListener('storage', h);
    };
  }, [syncOrders]);

  const rawList: RawOrder[] = useMemo(
    () => mergeRawOrdersForDisplay(mgmtOrders, historyOrders),
    [mgmtOrders, historyOrders]
  );

  const ordersData = useMemo(() => {
    const view = userRoleToSupplyRetailView(userRole);
    return rawList.map((r) => {
      const stallRev = getStallDisplayShouldRevenue(r, view);
      const countedRevenue = getStallDisplaySoldAtRetail(r, view);
      const actualRevenue = getStallDisplayActualRevenue(r);
      const stallRetailSummary = getStallDisplayRetailEstAndRemain(r, view);
      const payable = r.totalAmount;
      const selfSuppliedDeduction = isOrderHistoryEntry(r) && r.actorRole === 'franchisee'
        ? (r.selfSuppliedCostAmount ?? Math.max(0, r.totalAmount - (r.payableAmount ?? r.totalAmount)))
        : 0;
      const netPayableAmount = Math.max(0, payable - selfSuppliedDeduction);
      const remainAmount = stallRetailSummary?.remGoodsValue ?? null;
      const estimatedAmount = stallRetailSummary?.estTotal ?? null;
      const financials: OrderFinancialSummary = {
        procurementAmount: payable,
        selfSuppliedDeduction,
        netPayableAmount,
        estimatedAmount,
        remainAmount,
        countedRevenueAmount: countedRevenue ?? stallRev ?? null,
        actualIncomeAmount: actualRevenue,
      };
      return isFranchiseManagementOrder(r)
        ? toOrderRowFromMgmt(r, financials)
        : toOrderRowFromHistory(r, financials);
    });
  }, [rawList, userRole]);

  /**
   * 從目前可見資料抓出所有「曾經出現過」的店家，作為下拉選項。
   * 同時記錄類型（直營／加盟）以便依「店家類型」過濾。
   */
  const storeOptions = useMemo(() => {
    const map = new Map<string, { label: string; type: 'hq' | 'franchise'; count: number }>();
    for (const o of ordersData) {
      const label = o.franchisee;
      if (!label) continue;
      const type: 'hq' | 'franchise' = label === HQ_STORE_LABEL ? 'hq' : 'franchise';
      const cur = map.get(label);
      if (cur) cur.count += 1;
      else map.set(label, { label, type, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'hq' ? -1 : 1;
      return a.label.localeCompare(b.label, 'zh-Hant');
    });
  }, [ordersData]);

  /** 經店家類型過濾後的下拉選項（避免「直營」分頁下還能選到加盟店名） */
  const visibleStoreOptions = useMemo(() => {
    if (storeTypeFilter === 'all') return storeOptions;
    return storeOptions.filter((s) => s.type === storeTypeFilter);
  }, [storeOptions, storeTypeFilter]);

  /** 切換店家類型時，若已選定的店家不在類型內，重置為「全部」 */
  useEffect(() => {
    if (storeLabelFilter === 'all') return;
    const stillVisible = visibleStoreOptions.some((s) => s.label === storeLabelFilter);
    if (!stillVisible) setStoreLabelFilter('all');
  }, [storeLabelFilter, visibleStoreOptions]);

  /** 若店名已不存在於資料（例如資料異動），自動重置避免空白結果 */
  useEffect(() => {
    if (storeLabelFilter === 'all') return;
    const exists = storeOptions.some((s) => s.label === storeLabelFilter);
    if (!exists) setStoreLabelFilter('all');
  }, [storeLabelFilter, storeOptions]);

  /** 是否顯示店家篩選 UI：加盟主僅看自己一家，無意義；其他角色至少出現過 1 家以上才顯示 */
  const showStoreFilter = userRole !== 'franchisee' && storeOptions.length >= 2;

  const filteredOrders = useMemo(() => {
    const byWeekday = ordersData.filter((order) => {
      const o = rawList.find((r) => r.id === order.id);
      if (!o) return false;
      return orderMatchesActiveWeekdays(o.createdAt, activeWeekdays);
    });
    const byStoreType = byWeekday.filter((order) => {
      if (storeTypeFilter === 'all') return true;
      const isHq = order.franchisee === HQ_STORE_LABEL;
      return storeTypeFilter === 'hq' ? isHq : !isHq;
    });
    const byStoreLabel = byStoreType.filter((order) => {
      if (storeLabelFilter === 'all') return true;
      return order.franchisee === storeLabelFilter;
    });
    const byStatus = byStoreLabel.filter((order) => {
      if (statusFilter === '所有訂單') return true;
      return order.status === statusFilter;
    });
    const byDate = byStatus.filter((order) => {
      if (!appliedDateRange) return true;
      const o = rawList.find((r) => r.id === order.id);
      if (!o) return false;
      const key = orderTimeToYmdKey(o.createdAt);
      if (!key) return false;
      return key >= appliedDateRange.from && key <= appliedDateRange.to;
    });
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byDate;
    return byDate.filter((order) => {
      const phoneNorm = order.phone.replace(/\s/g, '');
      const qNorm = q.replace(/\s/g, '');
      const raw = rawList.find((r) => r.id === order.id);
      if (
        raw &&
        orderDateQueryMatches(raw.createdAt, {
          stallCountBasisYmd: raw.stallCountBasisYmd,
          stallCountCompletedAt: raw.stallCountCompletedAt,
        }, searchQuery.trim())
      ) {
        return true;
      }
      return (
        order.franchisee.toLowerCase().includes(q) ||
        order.id.toLowerCase().includes(q) ||
        order.contact.toLowerCase().includes(q) ||
        order.address.toLowerCase().includes(q) ||
        (qNorm && phoneNorm.includes(qNorm)) ||
        order.itemLines.some(
          (it) => it.name.toLowerCase().includes(q) || String(it.qty).includes(q)
        )
      );
    });
  }, [activeWeekdays, statusFilter, storeTypeFilter, storeLabelFilter, searchQuery, appliedDateRange, ordersData, rawList]);

  useEffect(() => {
    if (expandedOrderId && !filteredOrders.some((o) => o.id === expandedOrderId)) {
      setExpandedOrderId(null);
    }
  }, [expandedOrderId, filteredOrders]);

  useEffect(() => {
    if (!datePanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = datePopoverRef.current;
      if (el && !el.contains(e.target as Node)) setDatePanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDatePanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [datePanelOpen]);

  const openDatePanel = () => {
    if (appliedDateRange) {
      setDraftFrom(appliedDateRange.from);
      setDraftTo(appliedDateRange.to);
    }
    setDatePanelOpen(true);
  };

  const applyDateRange = () => {
    if (!draftFrom || !draftTo) return;
    let from = draftFrom;
    let to = draftTo;
    if (from > to) [from, to] = [to, from];
    setAppliedDateRange({ from, to });
    setDraftFrom(from);
    setDraftTo(to);
    setDatePanelOpen(false);
  };

  const clearDateRange = () => {
    setAppliedDateRange(null);
    setDraftFrom('');
    setDraftTo('');
    setActiveWeekdays([]);
    setDatePanelOpen(false);
  };

  const toggleOrder = (id: string) => {
    if (expandedOrderId === id) {
      setExpandedOrderId(null);
    } else {
      setExpandedOrderId(id);
    }
  };

  const openShipDialog = (e: MouseEvent<HTMLButtonElement>, orderId: string) => {
    e.stopPropagation();
    const r = rawList.find((o) => o.id === orderId);
    if (!r || !canEditOrderInList(r, userRole)) return;
    setShipModal({ id: orderId, step: 1 });
  };

  const setStatus = (id: string, status: '待出貨' | '已完成' | '已取消') => {
    void (async () => {
      await ordersApi.updateOrderStatusInEitherStore(id, status);
      syncOrders();
    })();
  };

  const applyShipped = () => {
    if (!shipModal) return;
    setStatus(shipModal.id, '已完成');
    setShipModal(null);
  };

  const applyRevertPending = () => {
    if (!revertModal) return;
    setStatus(revertModal.id, '待出貨');
    setRevertModal(null);
  };

  const applyCancelOrder = () => {
    if (!cancelModal) return;
    setStatus(cancelModal.id, '已取消');
    setCancelModal(null);
  };

  const exitPickingEdit = useCallback(() => {
    setPickingOrderId(null);
    setPickingLines([]);
    setPickingOriginal([]);
    setPickingError(null);
  }, []);

  const startPickingEdit = (e: MouseEvent<HTMLButtonElement>, orderId: string) => {
    e.stopPropagation();
    setPickingError(null);
    const raw = rawList.find((r) => r.id === orderId);
    if (!raw || raw.status === '已取消' || !canEditOrderInList(raw, userRole)) return;
    setPickingOrderId(orderId);
    setPickingLines(raw.lines.map((l) => ({ ...l })));
    setPickingOriginal(raw.lines.map((l) => ({ ...l })));
  };

  const savePickingEdit = (orderId: string) => {
    setPickingError(null);
    void (async () => {
      const res = await ordersApi.updateEditableOrderLinesById(orderId, pickingLines);
      if (res.ok === true) {
        exitPickingEdit();
        syncOrders();
        return;
      }
      switch (res.reason) {
        case 'empty':
          setPickingError('實出數全為 0 時，請改為【取消訂單】或至少保留 1 項。');
          break;
        case 'canceled':
          setPickingError('此單已取消，無法調整貨量。');
          break;
        default:
          setPickingError('找不到此訂單。');
      }
    })();
  };

  const bumpPickingQty = (index: number, delta: number) => {
    setPickingLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = Math.max(0, Math.min(PICK_MAX_Q, l.qty + delta));
        return { ...l, qty: next };
      })
    );
  };

  const setPickingQtyInput = (index: number, rawStr: string) => {
    const n = parsePickQty(rawStr);
    setPickingLines((prev) => prev.map((l, i) => (i === index ? { ...l, qty: n } : l)));
  };

  const applyDeleteOrder = () => {
    if (!deleteModal) return;
    const id = deleteModal.id;
    void (async () => {
      if (await ordersApi.deleteOrderByIdFromAnyStore(id)) {
        if (expandedOrderId === id) setExpandedOrderId(null);
        if (pickingOrderId === id) exitPickingEdit();
        setDeleteModal(null);
        syncOrders();
      }
    })();
  };

  useEffect(() => {
    if (pickingOrderId && expandedOrderId && expandedOrderId !== pickingOrderId) {
      exitPickingEdit();
    }
  }, [expandedOrderId, pickingOrderId, exitPickingEdit]);

  useEffect(() => {
    if (!pickingOrderId) return;
    const r = rawList.find((o) => o.id === pickingOrderId);
    if (!r || !canEditOrderInList(r, userRole)) exitPickingEdit();
  }, [pickingOrderId, rawList, userRole, exitPickingEdit]);

  useEffect(() => {
    if (!pickingOrderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitPickingEdit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickingOrderId, exitPickingEdit]);

  useEffect(() => {
    if (!shipModal && !revertModal && !cancelModal && !deleteModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShipModal(null);
        setRevertModal(null);
        setCancelModal(null);
        setDeleteModal(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shipModal, revertModal, cancelModal, deleteModal]);

  const shipModalOrder = shipModal ? rawList.find((o) => o.id === shipModal.id) ?? null : null;
  const revertModalOrder = revertModal ? rawList.find((o) => o.id === revertModal.id) ?? null : null;
  const cancelModalOrder = cancelModal ? rawList.find((o) => o.id === cancelModal.id) ?? null : null;
  const deleteModalOrder = deleteModal ? rawList.find((o) => o.id === deleteModal.id) ?? null : null;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ListOrdered className="text-amber-500 shrink-0" size={28} />
            訂單管理
          </h2>
          {userRole === 'employee' && (
            <p className="mt-1 text-sm text-zinc-500">
              可檢視總部直營之單與本店帳送出之單；總部單僅能檢視，無法變更出貨或實出。
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋訂單、加盟店、日期（例 2026/4/25）"
              className="pl-10 pr-4 py-2 border border-zinc-700 bg-zinc-900 rounded-lg focus:outline-none focus:border-amber-500 transition-colors text-sm text-zinc-300 w-full sm:w-64"
            />
          </div>
          <div className="relative" ref={datePopoverRef}>
            <button
              type="button"
              aria-expanded={datePanelOpen}
              aria-haspopup="dialog"
              onClick={() => (datePanelOpen ? setDatePanelOpen(false) : openDatePanel())}
              className={cn(
                'px-4 py-2 rounded-lg transition-colors font-medium text-sm flex gap-2 items-center border',
                appliedDateRange
                  ? 'bg-amber-600/15 border-amber-600/40 text-amber-500 hover:bg-amber-600/25'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              )}
            >
              <Calendar size={16} aria-hidden />
              篩選日期
              {appliedDateRange && (
                <span className="max-w-[10rem] truncate text-xs font-normal opacity-90">
                  {appliedDateRange.from} ~ {appliedDateRange.to}
                </span>
              )}
            </button>
            {datePanelOpen && (
              <div
                role="dialog"
                aria-label="訂單日期範圍"
                className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-2rem,20rem)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
              >
                <p className="text-xs text-zinc-500 mb-3">以訂單建立日（依列表上的日期）篩選，起迄皆含當日。</p>
                <div className="space-y-3">
                  <label className="block text-sm text-zinc-400">
                    <span className="mb-1 block">起始日</span>
                    <input
                      type="date"
                      value={draftFrom}
                      onChange={(e) => setDraftFrom(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
                    />
                  </label>
                  <label className="block text-sm text-zinc-400">
                    <span className="mb-1 block">結束日</span>
                    <input
                      type="date"
                      value={draftTo}
                      onChange={(e) => setDraftTo(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
                    />
                  </label>
                  <div>
                    <p className="mb-1 block text-sm text-zinc-400">建單星期</p>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2">
                      <OrderWeekdayFilter value={activeWeekdays} onChange={setActiveWeekdays} />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!draftFrom || !draftTo}
                    onClick={applyDateRange}
                    className="flex-1 min-w-[6rem] rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    套用
                  </button>
                  <button
                    type="button"
                    onClick={clearDateRange}
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    清除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showStoreFilter && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div
            className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none shrink-0"
            role="tablist"
            aria-label="訂單店家類型篩選"
          >
            {STORE_TYPE_TABS.map((tab) => {
              const isActive = storeTypeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setStoreTypeFilter(tab.id)}
                  className={cn(
                    'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-colors border text-xs sm:text-sm',
                    isActive
                      ? 'bg-amber-600/15 text-amber-400 border-amber-600/40'
                      : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                  )}
                >
                  {tab.id === 'hq' && <Store size={13} aria-hidden />}
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 min-w-0 sm:max-w-xs">
            <label htmlFor="orders-store-filter" className="sr-only">
              指定店家
            </label>
            <Store
              size={15}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              aria-hidden
            />
            <select
              id="orders-store-filter"
              value={storeLabelFilter}
              onChange={(e) => setStoreLabelFilter(e.target.value)}
              disabled={visibleStoreOptions.length === 0}
              className={cn(
                'w-full appearance-none pl-8 pr-3 py-1.5 rounded-lg border bg-zinc-900 text-xs sm:text-sm focus:outline-none focus:border-amber-500 transition-colors',
                storeLabelFilter !== 'all'
                  ? 'border-amber-600/50 text-amber-300'
                  : 'border-zinc-700 text-zinc-300',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <option value="all">
                {storeTypeFilter === 'all'
                  ? '所有店家'
                  : storeTypeFilter === 'hq'
                    ? '所有直營店'
                    : '所有加盟店'}
              </option>
              {visibleStoreOptions.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}（{s.count}）
                </option>
              ))}
            </select>
          </div>
          {(storeTypeFilter !== 'all' || storeLabelFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setStoreTypeFilter('all');
                setStoreLabelFilter('all');
              }}
              className="self-start sm:self-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70"
              aria-label="清除店家篩選"
            >
              <X size={12} aria-hidden />
              清除店家篩選
            </button>
          )}
        </div>
      )}

      <div className="flex space-x-3 overflow-x-auto pb-2 scrollbar-none" role="tablist" aria-label="訂單狀態篩選">
            {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab;
          return (
            <button 
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(tab)}
              className={cn(
                "flex-shrink-0 px-5 py-2 rounded-full font-medium transition-colors border text-sm",
                isActive
                  ? "bg-amber-600/20 text-amber-500 border-amber-600/30" 
                  : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
              )}
            >
              {tab === '已完成' ? '已出貨' : tab}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {filteredOrders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-12 text-center text-sm text-zinc-500">
            {searchQuery.trim()
              ? '沒有符合搜尋條件的訂單，請調整關鍵字或併用狀態／日期／建單星期篩選。'
              : '沒有符合目前篩選條件的訂單。請調整狀態分頁、建單星期、日期範圍或關鍵字搜尋。'}
          </div>
        )}
        {filteredOrders.map((order) => {
          const raw = rawList.find((r) => r.id === order.id);
          const canEdit = canEditOrderInList(raw, userRole);
          const isExpanded = expandedOrderId === order.id;
          const isPickingThis =
            canEdit && pickingOrderId === order.id && order.status !== '已取消';
          const pickKept = isPickingThis ? pickingLines.filter((l) => l.qty > 0) : [];
          const pickTotal = isPickingThis
            ? Math.round(pickKept.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100) / 100
            : 0;
          const pickCount = isPickingThis ? pickKept.reduce((s, l) => s + l.qty, 0) : 0;
          const orderLineCount = order.itemLines.reduce((s, l) => s + l.qty, 0);
          const pickingLocked = isPickingThis;

          return (
            <div
              key={order.id}
              className="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-200"
            >
              <div className="flex min-w-0 w-full">
              {/* Order Header / Summary：左側＋金額可點展開；最右刪除僅超級管理員 */}
              <div
                className="min-w-0 flex-1 p-4 sm:p-6 cursor-pointer hover:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                onClick={() => toggleOrder(order.id)}
              >
                <div className="flex items-center gap-5 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 flex-shrink-0">
                    <Package
                      size={24}
                      className={cn(
                        order.status === '待出貨' && 'text-amber-500',
                        order.status === '已完成' && 'text-emerald-500/90',
                        order.status === '已取消' && 'text-rose-500/80'
                      )}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="text-lg font-bold text-[#f5f2ed]">{order.franchisee}</h3>
                      <span className={cn(
                        "px-2.5 py-0.5 rounded text-xs font-medium border",
                        order.status === '待出貨' ? "bg-amber-600/10 text-amber-500 border-amber-600/20" :
                        order.status === '已取消' ? "bg-rose-600/10 text-rose-400 border-rose-600/20" :
                        "bg-emerald-600/10 text-emerald-400 border-emerald-600/20"
                      )}>
                        {orderStatusDisplayLabel(order.status)}
                      </span>
                      {raw && (
                        <StallCountOrderBadge
                          createdAtIso={raw.createdAt}
                          stallCountCompletedAt={raw.stallCountCompletedAt}
                        />
                      )}
                      {raw && !canEdit && userRole === 'employee' && (
                        <span className="px-2 py-0.5 rounded text-[0.625rem] font-medium border border-zinc-600 bg-zinc-800/50 text-zinc-400">
                          僅檢視
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-500 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 min-w-0">
                      <span className="font-mono text-zinc-400 break-all sm:truncate">{order.id}</span>
                      <span className="hidden sm:inline">•</span>
                      <span className="break-words">{order.time}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-end gap-2 w-full sm:w-auto border-t sm:border-t-0 border-zinc-800 pt-3 sm:pt-0 self-stretch sm:self-center min-w-0">
                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 px-3 py-2.5 w-full sm:w-auto sm:min-w-[19rem] min-w-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[0.6875rem] sm:text-xs min-w-0">
                      <span className="text-zinc-500">批貨金額</span>
                      <span className="text-zinc-200 text-right tabular-nums break-all">$ {Math.round(order.procurementAmount).toLocaleString()}</span>
                      <span className="text-zinc-500">自備扣除</span>
                      <span className="text-zinc-300 text-right tabular-nums break-all">
                        {order.selfSuppliedDeduction > 0 ? `$ ${Math.round(order.selfSuppliedDeduction).toLocaleString()}` : '—'}
                      </span>
                      <span className="text-zinc-500">實際應付/應收</span>
                      <span className="text-amber-300 text-right tabular-nums break-all">
                        $ {Math.round(order.netPayableAmount).toLocaleString()}
                      </span>
                      <span className="text-zinc-500">預估金額</span>
                      <span className="text-zinc-300 text-right tabular-nums break-all">
                        {order.estimatedAmount == null ? '—' : `$ ${Math.round(order.estimatedAmount).toLocaleString()}`}
                      </span>
                      <span className="text-zinc-500">餘貨金額</span>
                      <span className="text-zinc-300 text-right tabular-nums break-all">
                        {order.remainAmount == null ? '—' : `$ ${Math.round(order.remainAmount).toLocaleString()}`}
                      </span>
                      <span className="text-zinc-500">盤點後營業額</span>
                      <span className="text-zinc-100 text-right tabular-nums break-all">
                        {order.countedRevenueAmount == null ? '—' : `$ ${Math.round(order.countedRevenueAmount).toLocaleString()}`}
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-end justify-between gap-3">
                      <span className="text-[0.6875rem] sm:text-xs text-zinc-400">實際收入金額</span>
                      <span className="text-xl sm:text-2xl font-light text-amber-500 tabular-nums break-all text-right">
                        {order.actualIncomeAmount == null ? '—' : `$ ${Math.round(order.actualIncomeAmount).toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="self-end sm:self-auto p-2 text-zinc-500 rounded-lg hover:bg-zinc-800 hover:text-zinc-300 transition-colors shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOrder(order.id);
                    }}
                  >
                    <span className="sr-only">展開明細</span>
                    {isExpanded ? <X size={20} /> : <span className="text-sm font-medium pr-2 text-amber-500">查看明細</span>}
                  </button>
                </div>
              </div>

              {isHeadquarters && (
                <div className="flex items-stretch border-l border-zinc-800/80 bg-zinc-900/30">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!pickingLocked) setDeleteModal({ id: order.id });
                    }}
                    disabled={pickingLocked}
                    className="flex w-12 sm:w-12 flex-col items-center justify-center gap-0.5 text-rose-400/85 hover:text-rose-200 hover:bg-rose-950/40 active:bg-rose-950/55 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    title={pickingLocked ? '請先儲存或放棄「調整貨量」' : '從本機完全移除此筆訂單（不須展開明細）'}
                    aria-label="刪除本筆訂單"
                  >
                    <Trash2 className="size-[1.1rem] sm:size-5" strokeWidth={2} />
                    <span className="text-[0.5625rem] sm:text-[0.625rem] font-medium text-zinc-500 leading-tight">刪除</span>
                  </button>
                </div>
              )}
              </div>

              {/* Order Details (Expanded) */}
              {isExpanded && (
                <div className="border-t border-zinc-800 bg-zinc-900/60 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-top-2">
                  
                  {/* Info Column */}
                  <div className="lg:col-span-1 space-y-4">
                    {userRole === 'employee' && raw && isFranchiseManagementOrder(raw) ? (
                      <>
                        <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-widest mb-2">
                          總部直營訂單
                        </h4>
                        <p className="text-sm text-amber-200/85 leading-relaxed mb-3">
                          此單由超級管理員自總部下單。直營店同仁可檢視內容，但無法變更出貨狀態、取消或調整實出。
                        </p>
                        <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-800/50 space-y-3">
                          <div className="flex gap-3 text-sm">
                            <User size={18} className="text-zinc-500 flex-shrink-0" />
                            <div>
                              <p className="text-zinc-300 font-medium">聯絡人：{order.contact}</p>
                            </div>
                          </div>
                          <div className="flex gap-3 text-sm">
                            <Phone size={18} className="text-zinc-500 flex-shrink-0" />
                            <div>
                              <p className="text-zinc-300">{order.phone}</p>
                            </div>
                          </div>
                          <div className="flex gap-3 text-sm">
                            <MapPin size={18} className="text-zinc-500 flex-shrink-0" />
                            <div>
                              <p className="text-zinc-300 leading-relaxed">{order.address}</p>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div>
                        <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-widest mb-2">本店訂單</h4>
                      </div>
                    )}

                    {canEdit && (order.status === '待出貨' || order.status === '已完成') && (
                      <div className="pt-2 border-t border-zinc-800/80">
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2.5">訂單動作</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {order.status === '待出貨' ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => openShipDialog(e, order.id)}
                                disabled={pickingLocked}
                                title={pickingLocked ? '請先儲存或放棄「調整貨量」' : undefined}
                                className="min-h-[2.5rem] w-full py-2 px-3 bg-amber-600 text-zinc-950 text-sm font-semibold rounded-lg hover:bg-amber-500 transition-colors shadow-md shadow-amber-900/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                              >
                                標記出貨
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelModal({ id: order.id });
                                }}
                                disabled={pickingLocked}
                                title={pickingLocked ? '請先儲存或放棄「調整貨量」' : undefined}
                                className="min-h-[2.5rem] w-full py-2 px-3 border border-rose-500/50 bg-rose-950/40 text-rose-200 text-sm font-medium rounded-lg hover:bg-rose-950/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                取消訂單
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRevertModal({ id: order.id });
                                }}
                                className="min-h-[2.5rem] w-full py-2 px-3 border border-zinc-600 bg-zinc-800/50 text-zinc-200 text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                              >
                                改回待出貨
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelModal({ id: order.id });
                                }}
                                className="min-h-[2.5rem] w-full py-2 px-3 border border-rose-500/50 bg-rose-950/40 text-rose-200 text-sm font-medium rounded-lg hover:bg-rose-950/70 transition-colors"
                              >
                                取消訂單
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Items Column */}
                  <div className="lg:col-span-2 min-w-0">
                    <div className="mb-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/35 px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-widest">訂單品項明細</h4>
                      {(order.status === '待出貨' || order.status === '已完成') && canEdit && !isPickingThis && (
                        <button
                          type="button"
                          onClick={(e) => startPickingEdit(e, order.id)}
                          className="h-9 w-full sm:w-auto px-3 rounded-lg bg-amber-600/90 text-zinc-950 text-sm font-medium hover:bg-amber-500 shrink-0"
                        >
                          調整貨量
                        </button>
                      )}
                    </div>

                    {isPickingThis && (
                      <div className="mb-2.5 space-y-2">
                        <p className="text-xs text-amber-500/90 font-medium">
                          揀貨模式：＋/－ 或輸入數字；每列 0～{PICK_MAX_Q.toLocaleString()}，可高於下單量。
                        </p>
                        {pickingError && (
                          <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
                            {pickingError}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              savePickingEdit(order.id);
                            }}
                            className="py-2 px-4 rounded-lg bg-amber-600 text-zinc-950 text-sm font-semibold hover:bg-amber-500"
                          >
                            儲存貨量
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exitPickingEdit();
                            }}
                            className="py-2 px-4 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800"
                          >
                            放棄
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="bg-zinc-800/30 rounded-xl border border-zinc-800/50 overflow-x-auto">
                      <table className="w-full text-left min-w-[18rem]">
                        <thead className="bg-zinc-800/50 text-zinc-400 text-xs uppercase border-b border-zinc-700/50">
                          <tr>
                            <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium">品項</th>
                            <th className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-center w-[5.25rem] sm:w-[10rem]">
                              {isPickingThis ? '實出數量' : '數量'}
                            </th>
                            <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium text-right">小計</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50 text-xs sm:text-sm">
                          {isPickingThis
                            ? pickingLines.map((line, idx) => {
                                const origQ = pickingOriginal[idx]?.qty ?? line.qty;
                                const sub = line.unitPrice * line.qty;
                                return (
                                  <tr key={line.productId + String(idx)} className="hover:bg-zinc-800/20">
                                    <td className="py-2.5 sm:py-3 px-3 sm:px-4 align-top">
                                      <div className="font-medium text-[#f5f2ed]">{line.name}</div>
                                      <div className="text-xs text-zinc-500">
                                        下單 {origQ} {line.unit}・單價 $ {line.unitPrice}
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 sm:px-4 align-top">
                                      <div className="flex items-center justify-center gap-0.5 max-w-[9rem] mx-auto">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            bumpPickingQty(idx, -1);
                                          }}
                                          disabled={line.qty <= 0}
                                          className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                          aria-label="減一"
                                        >
                                          <Minus size={16} />
                                        </button>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={String(line.qty)}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            setPickingQtyInput(idx, e.target.value);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          onFocus={(e) => e.target.select()}
                                          className="w-12 min-w-0 text-center text-base font-bold tabular-nums text-amber-200 bg-zinc-900/80 border border-zinc-600 rounded py-1"
                                          aria-label={`${line.name} 實出數量，0～${PICK_MAX_Q.toLocaleString()}`}
                                        />
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            bumpPickingQty(idx, 1);
                                          }}
                                          disabled={line.qty >= PICK_MAX_Q}
                                          className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                          aria-label="加一"
                                        >
                                          <Plus size={16} />
                                        </button>
                                      </div>
                                    </td>
                                    <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right tabular-nums text-zinc-200 align-top">
                                      $ {Math.round(sub * 100) / 100}
                                    </td>
                                  </tr>
                                );
                              })
                            : order.itemLines.map((item, idx) => (
                                <tr key={idx} className="hover:bg-zinc-800/30">
                                  <td className="py-2 sm:py-3 px-3 sm:px-4">
                                    <div className="font-medium text-[#f5f2ed] leading-tight break-keep">{item.name}</div>
                                    <div className="mt-0.5 text-[0.6875rem] text-zinc-500 leading-tight truncate">單位：{item.unit}</div>
                                  </td>
                                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-center font-semibold tabular-nums text-amber-100">{item.qty}</td>
                                  <td className="py-2 sm:py-3 px-3 sm:px-4 text-right tabular-nums whitespace-nowrap text-zinc-300">
                                    $ {item.price.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                        </tbody>
                        <tfoot className="bg-zinc-800/20 border-t border-zinc-700/50">
                          <tr>
                            <td colSpan={2} className="py-2.5 sm:py-4 px-3 sm:px-4 text-right text-xs sm:text-sm font-medium text-zinc-400">
                              {isPickingThis ? '實出合計' : '下單合計'}
                            </td>
                            <td className="py-2.5 sm:py-4 px-3 sm:px-4 text-right text-base sm:text-lg font-bold text-amber-500 tabular-nums whitespace-nowrap">
                              $ {(isPickingThis ? pickTotal : order.amount).toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>

      {shipModal && shipModalOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShipModal(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="ship-dialog-title" className="text-lg font-semibold text-[#f5f2ed]">
              標記為已出貨
            </h3>
            {shipModal.step === 1 ? (
              <>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
                  即將把訂單 <span className="font-mono text-zinc-300">{shipModalOrder.id}</span> 自「待出貨」改為
                  <span className="text-emerald-400/90">「已出貨」</span>。請先核對金額與品項。
                </p>
                <p className="mt-2 text-sm text-zinc-500">
                  合計 <span className="text-amber-500/90 font-medium tabular-nums">$ {shipModalOrder.totalAmount.toLocaleString()}</span>
                </p>
                <p className="mt-3 text-xs text-amber-500/80">點「下一步」後會再要求您確認一次，避免誤觸。</p>
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShipModal(null)}
                    className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => setShipModal((m) => (m ? { ...m, step: 2 } : null))}
                    className="px-4 py-2.5 rounded-lg bg-amber-600 text-zinc-950 text-sm font-medium hover:bg-amber-500"
                  >
                    下一步
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-zinc-300 leading-relaxed">
                  最後確認：是否將此單標示為
                  <span className="text-emerald-400/90">已出貨</span>？
                </p>
                <p className="mt-2 text-xs text-zinc-500">確認後仍可在本頁以「改回待出貨」復原狀態。</p>
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShipModal((m) => (m ? { ...m, step: 1 } : null))}
                    className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
                  >
                    上一步
                  </button>
                  <button
                    type="button"
                    onClick={applyShipped}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500"
                  >
                    確認出貨
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {revertModal && revertModalOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revert-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRevertModal(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="revert-dialog-title" className="text-lg font-semibold text-[#f5f2ed]">
              改回待出貨
            </h3>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              訂單 <span className="font-mono text-zinc-300">{revertModalOrder.id}</span> 目前為「已出貨」。要改回
              <span className="text-amber-500/90">「待出貨」</span> 嗎？（可再次操作出貨流程）
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevertModal(null)}
                className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={applyRevertPending}
                className="px-4 py-2.5 rounded-lg bg-amber-600 text-zinc-950 text-sm font-medium hover:bg-amber-500"
              >
                確認改回待出貨
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelModal && cancelModalOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCancelModal(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="cancel-dialog-title" className="text-lg font-semibold text-[#f5f2ed]">
              取消訂單
            </h3>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              訂單 <span className="font-mono text-zinc-300">{cancelModalOrder.id}</span> 仍會保留在清單中，狀態將改為
              <span className="text-rose-400/90">「已取消」</span>。是否確認？
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              合計 <span className="text-amber-500/90 font-medium tabular-nums">$ {cancelModalOrder.totalAmount.toLocaleString()}</span>
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelModal(null)}
                className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
              >
                關閉
              </button>
              <button
                type="button"
                onClick={applyCancelOrder}
                className="px-4 py-2.5 rounded-lg bg-rose-600/90 text-white text-sm font-medium hover:bg-rose-500"
              >
                確認取消
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && deleteModalOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-order-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteModal(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 sm:p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="delete-order-dialog-title" className="text-lg font-semibold text-[#f5f2ed]">
              永久刪除訂單
            </h3>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              訂單 <span className="font-mono text-zinc-300">{deleteModalOrder.id}</span> 將從本機完全移除；歷史訂單、銷售紀錄若出現同單也會一併刪除。此操作無法還原。是否確定？
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              合計 <span className="text-amber-500/90 font-medium tabular-nums">$ {deleteModalOrder.totalAmount.toLocaleString()}</span>
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-medium"
              >
                關閉
              </button>
              <button
                type="button"
                onClick={applyDeleteOrder}
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
