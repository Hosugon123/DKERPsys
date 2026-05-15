import { useState, useMemo, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { Search, Package, Calendar, X, Minus, Plus, ListOrdered, Store } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  orderDateQueryMatches,
  formatSlashYmdWithWeekdayFromYmd,
  formatSlashDateTimeWithWeekdayFromIso,
  orderMatchesActiveWeekdaysFromYmd,
} from '../lib/dateDisplay';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import { LiangJinQtyHint } from '../components/LiangJinQtyHint';
import { OrderWeekdayFilter } from '../components/OrderWeekdayFilter';
import { orders as ordersApi } from '../services/apiService';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import {
  displayOrderCreatedByLabel,
  displayOrderLastUpdatedByLabel,
  displayOrderStallCountCompletedByLabel,
  effectiveOrderDateYmd,
  orderHasStallCountCompleted,
  type FranchiseManagementOrder,
  type OrderHistoryEntry,
  type OrderHistoryLine,
} from '../lib/orderHistoryStorage';
import {
  getStallDisplayRetailEstAndRemain,
  getStallDisplayShouldRevenue,
  getStallDisplaySoldAtRetail,
  getStallDisplayActualRevenue,
} from '../lib/orderStallDisplayRevenue';
import {
  estimatedRetailPerPackage,
  getSupplyItem,
  isConsumableItem,
  pricePerPackage,
  userRoleToSupplyRetailView,
  type SupplyItem,
  type SupplyRetailView,
} from '../lib/supplyCatalog';
import { computeLine, num, roundProcurementQty } from '../lib/stallMath';
import { getSalesRecord, mergeSalesRecordWithCatalog } from '../lib/salesRecordStorage';
import { loadRemainSnapshotForOrderManagementDisplay } from '../lib/stallInventoryStorage';
import { useSupplyCatalogItems } from '../hooks/useSupplyCatalogItems';

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
      scopeId: o.scopeId,
    }),
    contact: '—',
    phone: '—',
    address: '—',
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

function mergeOrderStallSnapshot(raw: RawOrder) {
  if (!orderHasStallCountCompleted(raw)) return null;
  if (raw.stallCountSnapshot) {
    return mergeSalesRecordWithCatalog(raw.stallCountSnapshot);
  }
  if (raw.stallCountBasisYmd) {
    const day = getSalesRecord(raw.stallCountBasisYmd);
    return day ? mergeSalesRecordWithCatalog(day) : null;
  }
  return null;
}

function fmtLineQty(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

type MergedStallSnapForOrderDetail = ReturnType<typeof mergeSalesRecordWithCatalog>;
type CarrySnapForOrderDetail = ReturnType<typeof loadRemainSnapshotForOrderManagementDisplay> | null;

/** 訂單明細表列：批價、叫貨小計、帶出量若全以零售售完之預估金額。 */
function computeOrderDetailLineMetrics(
  line: OrderHistoryLine,
  stallSnap: MergedStallSnapForOrderDetail | null,
  carrySnapForDisplay: CarrySnapForOrderDetail,
  supplyRetailView: SupplyRetailView,
) {
  const rowSnap = stallSnap?.lines[line.productId];
  const hasRowSnap = Boolean(stallSnap && rowSnap);
  const frozenR = Number(stallSnap?.frozenRetailUnitPriceByItem?.[line.productId]);
  const item = getSupplyItem(line.productId, supplyRetailView);
  const legacyPid = String(line.productId).startsWith('legacy-');
  const carryRemainQty =
    carrySnapForDisplay && !legacyPid
      ? Math.max(
          0,
          roundProcurementQty(num(carrySnapForDisplay.lines[line.productId]?.remain)),
        )
      : null;
  const orderQtyRounded = roundProcurementQty(Number(line.qty) || 0);
  let c = item
    ? computeLine(rowSnap?.out ?? '', rowSnap?.remain ?? '', item, {
        unitBasis: 'retail',
      })
    : null;
  if (c && Number.isFinite(frozenR)) {
    c = {
      ...c,
      estPrice: c.out * frozenR,
      remValue: c.remain * frozenR,
      soldRevenue: c.sold * frozenR,
    };
  }
  const plannedBringOutQty =
    carryRemainQty !== null
      ? roundProcurementQty(carryRemainQty + orderQtyRounded)
      : roundProcurementQty(orderQtyRounded);
  const displayedBringOut = hasRowSnap && c ? c.out : plannedBringOutQty;
  const unitRetail = Number.isFinite(frozenR)
    ? frozenR
    : item
      ? estimatedRetailPerPackage(item)
      : line.unitPrice;
  const batchUnitPrice = Number(line.unitPrice) || 0;
  const orderSub = Math.round(batchUnitPrice * line.qty * 100) / 100;
  const procurementQtyFromDiff =
    carryRemainQty !== null
      ? roundProcurementQty(Math.max(0, displayedBringOut - carryRemainQty))
      : null;
  const procurementQtyCellText =
    procurementQtyFromDiff !== null ? fmtLineQty(procurementQtyFromDiff) : fmtLineQty(orderQtyRounded);
  const procurementQtyForHint =
    procurementQtyFromDiff !== null ? procurementQtyFromDiff : orderQtyRounded;
  const retailEstSub = Math.round(displayedBringOut * unitRetail * 100) / 100;
  return {
    carryRemainQty,
    orderQtyRounded,
    displayedBringOut,
    procurementQtyCellText,
    procurementQtyForHint,
    orderSub,
    retailEstSub,
    batchUnitPrice,
    unitRetail,
  };
}

/** 調整貨量時列小計用：員工顯示預估零售單價，其餘身分用訂單批價。 */
function pickingLineUnitForDisplay(
  line: OrderHistoryLine,
  userRole: UserRole,
  supplyRetailView: SupplyRetailView,
): number {
  if (userRole !== 'employee') return Number(line.unitPrice) || 0;
  const it = getSupplyItem(line.productId, supplyRetailView);
  return it ? estimatedRetailPerPackage(it) : 0;
}

function buildOrderExpandedDetailLines(
  order: OrderRow,
  raw: RawOrder | undefined,
  catalogItems: SupplyItem[],
  supplyRetailView: SupplyRetailView,
): OrderHistoryLine[] {
  if (!raw) {
    return order.itemLines.map((it, i) => ({
      productId: `legacy-${i}`,
      name: it.name,
      unitPrice: it.qty > 0 ? it.price / it.qty : 0,
      qty: it.qty,
      unit: it.unit,
    }));
  }
  const qtyByProductId: Record<string, number> = {};
  for (const l of raw.lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    qtyByProductId[l.productId] = roundProcurementQty((qtyByProductId[l.productId] ?? 0) + q);
  }
  const detailLines: OrderHistoryLine[] = [];
  const seen = new Set<string>();
  for (const catalogEntry of catalogItems) {
    const pid = catalogEntry.id;
    const item = getSupplyItem(pid, supplyRetailView);
    if (!item) continue;
    const orderQtyRounded = qtyByProductId[pid] ?? 0;
    if (isConsumableItem(item) && orderQtyRounded <= 0) continue;
    const existingLine = raw.lines.find((l) => l.productId === pid);
    const line: OrderHistoryLine = existingLine
      ? { ...existingLine, qty: orderQtyRounded }
      : {
          productId: pid,
          name: item.name,
          unitPrice: pricePerPackage(item),
          qty: orderQtyRounded,
          unit: item.pieceUnit,
        };
    detailLines.push(line);
    seen.add(pid);
  }
  for (const l of raw.lines) {
    if (seen.has(l.productId)) continue;
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    detailLines.push(l);
    seen.add(l.productId);
  }
  return detailLines;
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
  /** 訂單明細表「叫貨金額小計」僅加盟主與管理員可見，員工不顯示 */
  const showOrderProcurementSubtotalCol = userRole === 'admin' || userRole === 'franchisee';
  /** 直營員工不顯示批價／成本，單價欄改為預估售價 */
  const hideOrderBatchPriceFromEmployee = userRole === 'employee';

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
  /** 總部：僅修正各列批價（不改數量），已出貨或已盤點押記亦可 */
  const [priceAdjustOrderId, setPriceAdjustOrderId] = useState<string | null>(null);
  const [priceAdjustLines, setPriceAdjustLines] = useState<OrderHistoryLine[]>([]);
  const [priceAdjustError, setPriceAdjustError] = useState<string | null>(null);
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

  const supplyRetailView = useMemo(() => userRoleToSupplyRetailView(userRole), [userRole]);
  const catalogItemsForOrderDetail = useSupplyCatalogItems(userRole);

  const ordersData = useMemo(() => {
    const view = supplyRetailView;
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
  }, [rawList, supplyRetailView]);

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
      return orderMatchesActiveWeekdaysFromYmd(effectiveOrderDateYmd(o), activeWeekdays);
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
      const key = effectiveOrderDateYmd(o);
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
          orderDateYmd: raw.orderDateYmd,
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
    const r = rawList.find((o) => o.id === revertModal.id);
    if (r && orderHasStallCountCompleted(r)) {
      setRevertModal(null);
      return;
    }
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

  const exitPriceAdjust = useCallback(() => {
    setPriceAdjustOrderId(null);
    setPriceAdjustLines([]);
    setPriceAdjustError(null);
  }, []);

  const startPickingEdit = (e: MouseEvent<HTMLButtonElement>, orderId: string) => {
    e.stopPropagation();
    setPickingError(null);
    exitPriceAdjust();
    const raw = rawList.find((r) => r.id === orderId);
    if (!raw || raw.status === '已取消' || !canEditOrderInList(raw, userRole)) return;
    if (orderHasStallCountCompleted(raw)) return;
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
        case 'stall_count_locked':
          setPickingError('此單已完成盤點押記，無法調整貨量。');
          break;
        default:
          setPickingError('找不到此訂單。');
      }
    })();
  };

  const startPriceAdjust = (e: MouseEvent<HTMLButtonElement>, orderId: string) => {
    e.stopPropagation();
    if (!isHeadquarters) return;
    setPriceAdjustError(null);
    exitPickingEdit();
    const raw = rawList.find((r) => r.id === orderId);
    if (!raw || raw.status === '已取消') return;
    setPriceAdjustOrderId(orderId);
    setPriceAdjustLines(raw.lines.map((l) => ({ ...l })));
  };

  const savePriceAdjust = (orderId: string) => {
    setPriceAdjustError(null);
    void (async () => {
      const res = await ordersApi.adminPatchOrderLineUnitPricesById(orderId, priceAdjustLines);
      if (res.ok === true) {
        exitPriceAdjust();
        syncOrders();
        return;
      }
      switch (res.reason) {
        case 'forbidden':
          setPriceAdjustError('僅超級管理員可更正批價。');
          break;
        case 'empty':
          setPriceAdjustError('品項不可全數為 0，請取消訂單或保留至少一項。');
          break;
        case 'canceled':
          setPriceAdjustError('此單已取消，無法更正。');
          break;
        case 'qty_mismatch':
          setPriceAdjustError('數量與原訂單不一致；此功能僅能改單價，請重新整理後再試。');
          break;
        default:
          setPriceAdjustError('找不到此訂單。');
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
        if (priceAdjustOrderId === id) exitPriceAdjust();
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
    if (priceAdjustOrderId && expandedOrderId && expandedOrderId !== priceAdjustOrderId) {
      exitPriceAdjust();
    }
  }, [expandedOrderId, priceAdjustOrderId, exitPriceAdjust]);

  useEffect(() => {
    if (!priceAdjustOrderId) return;
    const r = rawList.find((o) => o.id === priceAdjustOrderId);
    if (!r || r.status === '已取消' || !isHeadquarters) exitPriceAdjust();
  }, [priceAdjustOrderId, rawList, isHeadquarters, exitPriceAdjust]);

  useEffect(() => {
    if (!pickingOrderId) return;
    const r = rawList.find((o) => o.id === pickingOrderId);
    if (!r || !canEditOrderInList(r, userRole) || orderHasStallCountCompleted(r)) exitPickingEdit();
  }, [pickingOrderId, rawList, userRole, exitPickingEdit]);

  useEffect(() => {
    if (!pickingOrderId && !priceAdjustOrderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitPickingEdit();
        exitPriceAdjust();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickingOrderId, priceAdjustOrderId, exitPickingEdit, exitPriceAdjust]);

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
          const stallSnap = raw ? mergeOrderStallSnapshot(raw) : null;
          const carrySnapForDisplay = raw ? loadRemainSnapshotForOrderManagementDisplay(raw) : null;
          const canEdit = canEditOrderInList(raw, userRole);
          const isExpanded = expandedOrderId === order.id;
          const isPickingThis =
            canEdit && pickingOrderId === order.id && order.status !== '已取消';
          const isPriceAdjustThis =
            isHeadquarters &&
            priceAdjustOrderId === order.id &&
            (order.status === '待出貨' || order.status === '已完成');
          const expandedDetailLinesForTable =
            isExpanded && !isPickingThis && !isPriceAdjustThis
              ? buildOrderExpandedDetailLines(order, raw, catalogItemsForOrderDetail, supplyRetailView)
              : null;
          const orderRetailEstFooterTotal =
            showOrderProcurementSubtotalCol && expandedDetailLinesForTable
              ? Math.round(
                  expandedDetailLinesForTable.reduce(
                    (s, line) =>
                      s +
                      computeOrderDetailLineMetrics(
                        line,
                        stallSnap,
                        carrySnapForDisplay,
                        supplyRetailView,
                      ).retailEstSub,
                    0,
                  ) * 100,
                ) / 100
              : null;
          const orderDetailRetailEstFooterEmployee =
            hideOrderBatchPriceFromEmployee && expandedDetailLinesForTable
              ? Math.round(
                  expandedDetailLinesForTable.reduce(
                    (s, line) =>
                      s +
                      computeOrderDetailLineMetrics(
                        line,
                        stallSnap,
                        carrySnapForDisplay,
                        supplyRetailView,
                      ).retailEstSub,
                    0,
                  ) * 100,
                ) / 100
              : null;
          const pickKept = isPickingThis ? pickingLines.filter((l) => l.qty > 0) : [];
          const pickTotal = isPickingThis
            ? Math.round(
                pickKept.reduce(
                  (s, l) => s + pickingLineUnitForDisplay(l, userRole, supplyRetailView) * l.qty,
                  0,
                ) * 100,
              ) / 100
            : 0;
          const priceAdjKept = isPriceAdjustThis ? priceAdjustLines.filter((l) => l.qty > 0) : [];
          const priceAdjustTotal =
            isPriceAdjustThis
              ? Math.round(priceAdjKept.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100) / 100
              : 0;
          const pickCount = isPickingThis ? pickKept.reduce((s, l) => s + l.qty, 0) : 0;
          const orderLineCount = order.itemLines.reduce((s, l) => s + l.qty, 0);
          const orderEditLocked = isPickingThis || isPriceAdjustThis;
          const stallLocked = raw ? orderHasStallCountCompleted(raw) : false;

          return (
            <div
              key={order.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden transition-colors"
            >
              {/* Order Header / Summary：左側＋金額可點展開；刪除鈕僅超級管理員，浮在右上角 */}
              <div
                className={cn(
                  'relative min-w-0 w-full p-4 sm:p-6 cursor-pointer hover:bg-zinc-900/80 flex flex-col lg:flex-row lg:items-stretch gap-3 sm:gap-4'
                )}
                onClick={() => toggleOrder(order.id)}
              >
                <div className="flex min-w-0 w-full items-center gap-4 sm:gap-5 lg:min-w-0 lg:flex-1 lg:basis-0 lg:self-center">
                  <div className="hidden sm:flex w-12 h-12 rounded-full bg-zinc-800 items-center justify-center border border-zinc-700 flex-shrink-0">
                    <Package
                      size={24}
                      className={cn(
                        order.status === '待出貨' && 'text-amber-500',
                        order.status === '已完成' && 'text-emerald-500/90',
                        order.status === '已取消' && 'text-rose-500/80'
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
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
                    <p
                      className="text-base sm:text-lg font-mono text-zinc-200 mb-1.5 mt-1 break-all leading-snug"
                      title={order.id}
                    >
                      訂單編號 {order.id}
                    </p>
                    <div className="text-sm text-zinc-500 min-w-0 max-w-full space-y-1 leading-relaxed">
                      {raw ? (
                        <>
                          <p className="break-words [overflow-wrap:anywhere] text-base sm:text-lg text-zinc-100 leading-tight">
                            訂單日期 {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(raw))}
                          </p>
                          <p className="break-words [overflow-wrap:anywhere] text-xs sm:text-sm">
                            下單時間 {formatSlashDateTimeWithWeekdayFromIso(raw.createdAt)}
                          </p>
                          <div className="grid grid-cols-1 min-[430px]:grid-cols-2 gap-y-1 gap-x-3">
                            <p className="break-words [overflow-wrap:anywhere] text-sm">
                              下單者：{displayOrderCreatedByLabel(raw)}
                            </p>
                            <p className="break-words [overflow-wrap:anywhere] text-sm">
                              盤點者：{raw.stallCountCompletedAt
                                ? displayOrderStallCountCompletedByLabel(raw)
                                : '—'}
                            </p>
                            <p className="break-words [overflow-wrap:anywhere] text-sm min-[430px]:col-span-2">
                              最後異動：{displayOrderLastUpdatedByLabel(raw)}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-zinc-600">—</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex w-full min-w-0 shrink-0 flex-col lg:w-auto lg:flex-none lg:flex-row items-stretch lg:items-end justify-end gap-2 border-t lg:border-t-0 border-zinc-800 pt-3 lg:pt-0">
                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 px-3 py-2.5 w-full min-w-0 lg:min-w-[21rem] lg:max-w-[26rem] lg:shrink-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[0.825rem] sm:text-[0.9rem] min-w-0">
                      <span className="text-zinc-500 leading-snug">叫貨金額</span>
                      <span className="text-zinc-200 text-right tabular-nums break-all self-center">
                        $ {Math.round(order.franchisee === HQ_STORE_LABEL ? 0 : order.netPayableAmount).toLocaleString()}
                      </span>
                      <span className="text-zinc-500 leading-snug">自備貨物金額</span>
                      <span className="text-zinc-300 text-right tabular-nums break-all self-center">
                        {order.selfSuppliedDeduction > 0
                          ? `$ ${Math.round(order.selfSuppliedDeduction).toLocaleString()}`
                          : '—'}
                      </span>
                      <span className="text-zinc-500">預估金額</span>
                      <span className="text-zinc-300 text-right tabular-nums break-all self-center">
                        {order.estimatedAmount == null ? '—' : `$ ${Math.round(order.estimatedAmount).toLocaleString()}`}
                      </span>
                      <span className="text-zinc-500">盤點後金額</span>
                      <span className="text-zinc-100 text-right tabular-nums break-all self-center">
                        {order.countedRevenueAmount == null ? '—' : `$ ${Math.round(order.countedRevenueAmount).toLocaleString()}`}
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-end justify-between gap-3">
                      <span className="text-[0.825rem] sm:text-[0.9rem] text-zinc-400 leading-snug">實際金額</span>
                      <span className="text-[1.5rem] sm:text-[1.8rem] font-light text-amber-500 tabular-nums break-all text-right">
                        {order.actualIncomeAmount == null ? '—' : `$ ${Math.round(order.actualIncomeAmount).toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="self-end lg:self-auto p-2 text-zinc-500 rounded-lg hover:bg-zinc-800 hover:text-zinc-300 transition-colors shrink-0"
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

              {/* Order Details (Expanded) */}
              {isExpanded && (
                <div className="border-t border-zinc-800 bg-zinc-950 p-4 sm:p-6 animate-in slide-in-from-top-2">
                  <div className="min-w-0 w-full max-w-full">
                    <div className="mb-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/35 px-3 py-2 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <div className="min-w-0 space-y-1.5 flex-1">
                        <h4 className="text-[1.330875rem] font-medium text-zinc-400 uppercase tracking-widest shrink-0">
                          訂單品項明細
                        </h4>
                      </div>
                      {(order.status === '待出貨' || order.status === '已完成') && canEdit && (
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:min-w-0 sm:flex-1">
                          {!isPickingThis &&
                            !isPriceAdjustThis &&
                            (stallLocked ? (
                              <span className="text-[1.14075rem] text-zinc-500 shrink-0 text-left sm:text-right w-full sm:w-auto">
                                已完成盤點押記，無法調整貨量（總部可用「更正批價」修正單價）
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => startPickingEdit(e, order.id)}
                                className="h-9 min-h-9 px-3 rounded-lg bg-amber-600/90 text-zinc-950 text-[1.330875rem] font-medium hover:bg-amber-500 shrink-0"
                              >
                                調整貨量
                              </button>
                            ))}
                          {isHeadquarters &&
                            raw &&
                            !isPickingThis &&
                            !isPriceAdjustThis &&
                            (order.status === '待出貨' || order.status === '已完成') && (
                              <button
                                type="button"
                                onClick={(e) => startPriceAdjust(e, order.id)}
                                className="h-9 min-h-9 px-3 rounded-lg border border-amber-500/50 bg-amber-950/30 text-amber-200 text-[1.330875rem] font-medium hover:bg-amber-950/50 shrink-0"
                              >
                                更正批價
                              </button>
                            )}
                          {order.status === '待出貨' ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => openShipDialog(e, order.id)}
                                disabled={orderEditLocked}
                                title={orderEditLocked ? '請先儲存或放棄「調整貨量／更正批價」' : undefined}
                                className="h-9 min-h-9 px-3 rounded-lg bg-emerald-600 text-white text-[1.330875rem] font-semibold hover:bg-emerald-500 shadow-md shadow-emerald-900/25 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                              >
                                標記出貨
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isHeadquarters) setDeleteModal({ id: order.id });
                                  else setCancelModal({ id: order.id });
                                }}
                                disabled={orderEditLocked}
                                title={orderEditLocked ? '請先儲存或放棄「調整貨量／更正批價」' : undefined}
                                className="h-9 min-h-9 px-3 rounded-lg border border-rose-500/50 bg-rose-950/40 text-rose-200 text-[1.330875rem] font-medium hover:bg-rose-950/70 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isHeadquarters ? '刪除訂單' : '取消訂單'}
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
                                disabled={stallLocked || orderEditLocked}
                                title={
                                  orderEditLocked
                                    ? '請先儲存或放棄「調整貨量／更正批價」'
                                    : stallLocked
                                      ? '此單已完成盤點押記，無法改回待出貨'
                                      : undefined
                                }
                                className="h-9 min-h-9 px-3 rounded-lg border border-zinc-600 bg-zinc-800/50 text-zinc-200 text-[1.330875rem] font-medium hover:bg-zinc-800 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800/50"
                              >
                                改回待出貨
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isHeadquarters) setDeleteModal({ id: order.id });
                                  else setCancelModal({ id: order.id });
                                }}
                                disabled={orderEditLocked}
                                title={orderEditLocked ? '請先儲存或放棄「調整貨量／更正批價」' : undefined}
                                className="h-9 min-h-9 px-3 rounded-lg border border-rose-500/50 bg-rose-950/40 text-rose-200 text-[1.330875rem] font-medium hover:bg-rose-950/70 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isHeadquarters ? '刪除訂單' : '取消訂單'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {isPickingThis && (
                      <div className="mb-2.5 space-y-2">
                        <p className="text-[1.14075rem] text-amber-500/90 font-medium">
                          揀貨模式：＋/－ 或輸入數字；每列 0～{PICK_MAX_Q.toLocaleString()}，可高於下單量。
                        </p>
                        {pickingError && (
                          <p className="text-[1.330875rem] text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
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
                            className="py-2 px-4 rounded-lg bg-amber-600 text-zinc-950 text-[1.330875rem] font-semibold hover:bg-amber-500"
                          >
                            儲存貨量
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exitPickingEdit();
                            }}
                            className="py-2 px-4 rounded-lg border border-zinc-600 text-zinc-300 text-[1.330875rem] hover:bg-zinc-800"
                          >
                            放棄
                          </button>
                        </div>
                      </div>
                    )}

                    {isPriceAdjustThis && (
                      <div className="mb-2.5 space-y-2">
                        <p className="text-[1.14075rem] text-amber-500/90 font-medium leading-relaxed">
                          更正批價：僅修改「批價（每份）」；各列數量不變。適用菜價事後調整；已出貨或已盤點之訂單亦可，更正後儀表板與叫貨合計會依新單價重算。
                        </p>
                        {priceAdjustError && (
                          <p className="text-[1.330875rem] text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
                            {priceAdjustError}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              savePriceAdjust(order.id);
                            }}
                            className="py-2 px-4 rounded-lg bg-amber-600 text-zinc-950 text-[1.330875rem] font-semibold hover:bg-amber-500"
                          >
                            儲存批價
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exitPriceAdjust();
                            }}
                            className="py-2 px-4 rounded-lg border border-zinc-600 text-zinc-300 text-[1.330875rem] hover:bg-zinc-800"
                          >
                            放棄
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="bg-zinc-800/30 rounded-xl border border-zinc-800/50 overflow-x-auto overscroll-x-contain touch-[pan-x_pan-y] w-full min-w-0 pb-px">
                      <table
                        className={cn(
                          'w-full border-collapse text-left',
                          isPickingThis
                            ? 'table-auto min-w-[22rem] sm:min-w-[24rem]'
                            : isPriceAdjustThis
                              ? 'table-auto min-w-[24rem] sm:min-w-[30rem]'
                              : cn(
                                  'table-fixed',
                                  showOrderProcurementSubtotalCol
                                    ? 'min-w-[38rem] sm:min-w-[46rem] md:min-w-[54rem]'
                                    : 'min-w-[26rem] sm:min-w-[34rem] md:min-w-[38rem]',
                                ),
                        )}
                      >
                        <thead className="bg-zinc-800/50 text-zinc-400 text-[15.21px] sm:text-[1.14075rem] uppercase border-b border-zinc-700/50">
                          <tr>
                            {isPickingThis ? (
                              <>
                                <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium">品項</th>
                                <th className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-center whitespace-nowrap min-w-[11rem] w-[1%]">
                                  實出數量
                                </th>
                                <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium text-right">小計</th>
                              </>
                            ) : isPriceAdjustThis ? (
                              <>
                                <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium">品項</th>
                                <th className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-center whitespace-nowrap">
                                  數量
                                </th>
                                <th className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-center whitespace-nowrap min-w-[7.5rem]">
                                  批價（每份）
                                </th>
                                <th className="py-2 sm:py-3 px-3 sm:px-4 font-medium text-right">小計</th>
                              </>
                            ) : (
                              <>
                                <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium max-md:relative max-md:left-auto md:sticky md:left-0 bg-zinc-800/95 md:bg-zinc-800/50 z-[1] w-[14%] sm:w-[15.4%] md:w-[16.8%] md:min-w-[4.725rem]">
                                  品項
                                </th>
                                <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-center whitespace-nowrap">
                                  叫貨數量
                                </th>
                                <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-center whitespace-nowrap">
                                  昨剩餘帶出
                                </th>
                                <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-center whitespace-nowrap">
                                  帶出數量
                                </th>
                                <th
                                  className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-center whitespace-nowrap"
                                  title={
                                    hideOrderBatchPriceFromEmployee
                                      ? '帶出量（昨剩餘＋叫貨）若全以零售售完之預估金額'
                                      : undefined
                                  }
                                >
                                  {hideOrderBatchPriceFromEmployee ? '零售預估' : '批價'}
                                </th>
                                {showOrderProcurementSubtotalCol && (
                                  <>
                                    <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-right whitespace-nowrap">
                                      零售預估
                                    </th>
                                    <th className="py-2 sm:py-2.5 px-1.5 sm:px-2 font-medium text-right whitespace-nowrap">
                                      叫貨金額小計
                                    </th>
                                  </>
                                )}
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50 text-[16.731px] sm:text-[1.330875rem]">
                          {isPickingThis
                            ? pickingLines.map((line, idx) => {
                                const origQ = pickingOriginal[idx]?.qty ?? line.qty;
                                const unitForRow = pickingLineUnitForDisplay(line, userRole, supplyRetailView);
                                const sub = Math.round(unitForRow * line.qty * 100) / 100;
                                return (
                                  <tr key={line.productId + String(idx)} className="hover:bg-zinc-800/20">
                                    <td className="py-2.5 sm:py-3 px-3 sm:px-4 align-top">
                                      <div className="font-medium text-[#f5f2ed]">{line.name}</div>
                                      <div className="text-[1.14075rem] text-zinc-500">
                                        下單 {origQ} {line.unit}
                                        <LiangJinQtyHint liangQty={origQ} pieceUnit={line.unit} className="text-[15.21px]" />
                                        {hideOrderBatchPriceFromEmployee ? (
                                          <>
                                            ・預估零售單價 ${unitForRow.toLocaleString('zh-TW')}／{line.unit}
                                          </>
                                        ) : (
                                          <>
                                            ・單價 $ {line.unitPrice}
                                          </>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 sm:px-4 align-top whitespace-nowrap">
                                      <div className="flex flex-col items-center gap-0.5 min-w-[10.5rem] w-full max-w-[14rem] mx-auto">
                                        <div className="flex items-center justify-center gap-1 w-full">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            bumpPickingQty(idx, -1);
                                          }}
                                          disabled={line.qty <= 0}
                                          className="shrink-0 p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                          aria-label="減一"
                                        >
                                          <Minus size={24} />
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
                                          className="min-w-[4.25rem] w-16 max-w-[7rem] shrink-0 text-center text-[1.521rem] font-bold tabular-nums text-amber-200 bg-zinc-900/80 border border-zinc-600 rounded py-1.5 px-1 box-border"
                                          aria-label={`${line.name} 實出數量，0～${PICK_MAX_Q.toLocaleString()}`}
                                        />
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            bumpPickingQty(idx, 1);
                                          }}
                                          disabled={line.qty >= PICK_MAX_Q}
                                          className="shrink-0 p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                          aria-label="加一"
                                        >
                                          <Plus size={24} />
                                        </button>
                                        </div>
                                        <LiangJinQtyHint
                                          liangQty={line.qty}
                                          pieceUnit={line.unit}
                                          className="text-[15.21px] text-zinc-500"
                                        />
                                      </div>
                                    </td>
                                    <td
                                      className={cn(
                                        'py-2.5 sm:py-3 px-3 sm:px-4 text-right tabular-nums align-top',
                                        hideOrderBatchPriceFromEmployee
                                          ? 'text-emerald-400/95'
                                          : 'text-zinc-200',
                                      )}
                                    >
                                      $ {Math.round(sub * 100) / 100}
                                    </td>
                                  </tr>
                                );
                              })
                            : isPriceAdjustThis
                              ? priceAdjustLines.map((line, idx) => {
                                  const q = roundProcurementQty(Number(line.qty) || 0);
                                  const sub = Math.round(line.unitPrice * q * 100) / 100;
                                  return (
                                    <tr key={line.productId + String(idx)} className="hover:bg-zinc-800/20">
                                      <td className="py-2.5 sm:py-3 px-3 sm:px-4 align-top">
                                        <div className="font-medium text-[#f5f2ed]">{line.name}</div>
                                        <div className="text-[1.14075rem] text-zinc-500">{line.unit}</div>
                                      </td>
                                      <td className="py-2.5 sm:py-3 px-2 sm:px-4 text-center tabular-nums text-zinc-300">
                                        <span className="inline-flex flex-wrap items-center justify-center gap-x-0.5">
                                          {fmtLineQty(q)}
                                          <LiangJinQtyHint
                                            liangQty={q}
                                            pieceUnit={line.unit}
                                            className="text-[15.21px] sm:text-[1.14075rem]"
                                          />
                                        </span>
                                      </td>
                                      <td className="py-2.5 sm:py-3 px-2 sm:px-4 align-top">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          inputMode="decimal"
                                          value={line.unitPrice}
                                          onClick={(e) => e.stopPropagation()}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => {
                                            const n = parseFloat(e.target.value);
                                            setPriceAdjustLines((prev) =>
                                              prev.map((l, i) =>
                                                i === idx
                                                  ? {
                                                      ...l,
                                                      unitPrice: Number.isFinite(n)
                                                        ? Math.round(
                                                            Math.max(0, Math.min(9_999_999, n)) * 100
                                                          ) / 100
                                                        : 0,
                                                    }
                                                  : l
                                              )
                                            );
                                          }}
                                          className="w-full min-w-[5rem] max-w-[9rem] text-center text-[1.330875rem] font-medium tabular-nums text-amber-200 bg-zinc-900/80 border border-zinc-600 rounded py-1.5 px-1 box-border"
                                          aria-label={`${line.name} 批價（每份）`}
                                        />
                                      </td>
                                      <td className="py-2.5 sm:py-3 px-3 sm:px-4 text-right tabular-nums text-zinc-200">
                                        $ {sub.toLocaleString('zh-TW')}
                                      </td>
                                    </tr>
                                  );
                                })
                            : expandedDetailLinesForTable
                              ? expandedDetailLinesForTable.map((line, idx) => {
                                  const d = computeOrderDetailLineMetrics(
                                    line,
                                    stallSnap,
                                    carrySnapForDisplay,
                                    supplyRetailView,
                                  );
                                  return (
                                    <tr key={line.productId + String(idx)} className="hover:bg-zinc-800/30">
                                      <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 align-top max-md:relative max-md:left-auto max-md:z-0 max-md:shadow-none md:sticky md:left-0 md:z-[2] bg-zinc-900 md:shadow-[8px_0_10px_-10px_rgba(0,0,0,0.85)] w-[14%] sm:w-[15.4%] md:w-[16.8%] md:min-w-[4.725rem]">
                                        <div className="font-medium text-[#f5f2ed] text-[16.731px] sm:text-[1.330875rem] leading-tight max-md:break-words sm:break-keep">
                                          {line.name}
                                        </div>
                                      </td>
                                      <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 text-center tabular-nums text-amber-200/90">
                                        <span className="inline-flex flex-wrap items-center justify-center gap-x-0.5">
                                          {d.procurementQtyCellText}
                                          <LiangJinQtyHint
                                            liangQty={d.procurementQtyForHint}
                                            pieceUnit={line.unit}
                                            className="text-[15.21px] sm:text-[1.14075rem]"
                                          />
                                        </span>
                                      </td>
                                      <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 text-center tabular-nums text-zinc-400">
                                        {d.carryRemainQty !== null ? (
                                          <span className="inline-flex flex-wrap items-center justify-center gap-x-0.5">
                                            {fmtLineQty(d.carryRemainQty)}
                                            <LiangJinQtyHint
                                              liangQty={d.carryRemainQty}
                                              pieceUnit={line.unit}
                                              className="text-[15.21px] sm:text-[1.14075rem]"
                                            />
                                          </span>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                      <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 text-center tabular-nums text-zinc-200">
                                        <span className="inline-flex flex-wrap items-center justify-center gap-x-0.5">
                                          {fmtLineQty(d.displayedBringOut)}
                                          <LiangJinQtyHint
                                            liangQty={d.displayedBringOut}
                                            pieceUnit={line.unit}
                                            className="text-[15.21px] sm:text-[1.14075rem]"
                                          />
                                        </span>
                                      </td>
                                      <td
                                        className={cn(
                                          'py-2 sm:py-2.5 px-1.5 sm:px-2 tabular-nums whitespace-nowrap',
                                          hideOrderBatchPriceFromEmployee
                                            ? 'text-right text-emerald-400/95'
                                            : 'text-center text-amber-200/85',
                                        )}
                                      >
                                        {hideOrderBatchPriceFromEmployee ? (
                                          <>$ {d.retailEstSub.toLocaleString('zh-TW')}</>
                                        ) : (
                                          d.batchUnitPrice.toLocaleString('zh-TW')
                                        )}
                                      </td>
                                      {showOrderProcurementSubtotalCol && (
                                        <>
                                          <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 text-right tabular-nums text-emerald-400/95 whitespace-nowrap">
                                            $ {d.retailEstSub.toLocaleString('zh-TW')}
                                          </td>
                                          <td className="py-2 sm:py-2.5 px-1.5 sm:px-2 text-right tabular-nums text-amber-400/95 whitespace-nowrap">
                                            $ {d.orderSub.toLocaleString('zh-TW')}
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })
                              : null}
                        </tbody>
                        <tfoot className="bg-zinc-800/20 border-t border-zinc-700/50">
                          <tr>
                            {isPickingThis ? (
                              <>
                                <td
                                  colSpan={2}
                                  className="py-2.5 sm:py-4 px-3 sm:px-4 text-right text-[1.14075rem] sm:text-[1.330875rem] font-medium text-zinc-400"
                                >
                                  {hideOrderBatchPriceFromEmployee ? '零售預估合計' : '實出合計'}
                                </td>
                                <td
                                  className={cn(
                                    'py-2.5 sm:py-4 px-3 sm:px-4 text-right text-[1.521rem] sm:text-[1.711125rem] font-bold tabular-nums whitespace-nowrap',
                                    hideOrderBatchPriceFromEmployee
                                      ? 'text-emerald-400/95'
                                      : 'text-amber-500',
                                  )}
                                >
                                  $ {pickTotal.toLocaleString()}
                                </td>
                              </>
                            ) : isPriceAdjustThis ? (
                              <>
                                <td
                                  colSpan={3}
                                  className="py-2.5 sm:py-4 px-3 sm:px-4 text-right text-[1.14075rem] sm:text-[1.330875rem] font-medium text-zinc-400"
                                >
                                  批價更正後合計
                                </td>
                                <td className="py-2.5 sm:py-4 px-3 sm:px-4 text-right text-[1.521rem] sm:text-[1.711125rem] font-bold text-amber-500 tabular-nums whitespace-nowrap">
                                  $ {priceAdjustTotal.toLocaleString()}
                                </td>
                              </>
                            ) : (
                              <>
                                <td
                                  colSpan={showOrderProcurementSubtotalCol ? 5 : 4}
                                  className="py-2.5 sm:py-4 px-2 sm:px-3 text-right text-[1.14075rem] sm:text-[1.330875rem] font-medium text-zinc-400"
                                >
                                  {hideOrderBatchPriceFromEmployee
                                    ? '零售預估合計'
                                    : '叫貨合計（下單）'}
                                </td>
                                {showOrderProcurementSubtotalCol && (
                                  <td className="py-2.5 sm:py-4 px-1.5 sm:px-2 text-right text-[1.521rem] sm:text-[1.711125rem] font-bold text-emerald-400/95 tabular-nums whitespace-nowrap">
                                    $ {(orderRetailEstFooterTotal ?? 0).toLocaleString('zh-TW')}
                                  </td>
                                )}
                                <td
                                  className={cn(
                                    'py-2.5 sm:py-4 px-1.5 sm:px-2 text-right text-[1.521rem] sm:text-[1.711125rem] font-bold tabular-nums whitespace-nowrap',
                                    hideOrderBatchPriceFromEmployee
                                      ? 'text-emerald-400/95'
                                      : 'text-amber-500',
                                  )}
                                >
                                  ${' '}
                                  {(hideOrderBatchPriceFromEmployee
                                    ? orderDetailRetailEstFooterEmployee ?? 0
                                    : order.amount
                                  ).toLocaleString('zh-TW')}
                                </td>
                              </>
                            )}
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
