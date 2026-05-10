import { mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from './salesRecordStorage';
import { roundProcurementQty } from './stallMath';
import { allocateOrderSerialId } from './orderSerialId';
import { getDataScopeContext, HQ_SCOPE_ID } from './dataScope';
import { listSystemUsers } from './systemUsersStorage';
import { getSessionActorDisplayName, resolveUserDisplayNameById } from './sessionActorDisplayName';
import { getSupplyItem, isFranchiseeSelfSuppliedItem } from './supplyCatalog';

/** 寫入訂單／押記時可存檔的顯示名（登入者姓名 → 帳號 → 依 userId 查目錄） */
function persistableActorDisplayName(): string | undefined {
  const ctx = getDataScopeContext();
  const raw = getSessionActorDisplayName() || resolveUserDisplayNameById(ctx.userId);
  return raw || undefined;
}

export type OrderActorRole = 'admin' | 'franchisee' | 'employee';

export type OrderHistoryLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  unit: string;
};

export type FranchiseOrderStatus = '待出貨' | '已完成' | '已取消';

export type OrderHistoryEntry = {
  id: string;
  /** 實際送出叫貨之時間（ISO，下單時間） */
  createdAt: string;
  /** 訂單歸屬曆法日 YYYY-MM-DD（可預先下單）；舊資料無此欄時以 createdAt 之本地日視同訂單日 */
  orderDateYmd?: string;
  /** ISO 最後更新時間（舊資料由 createdAt 補齊） */
  updatedAt: string;
  source: 'procurement';
  totalAmount: number;
/** 應付貨款（展示用總額）；舊單缺值時以 totalAmount 相容。 */
  payableAmount?: number;
  /** 加盟主自備成本（不計入貨款，但計入成本/毛利）。 */
  selfSuppliedCostAmount?: number;
  itemCount: number;
  lines: OrderHistoryLine[];
  actorRole: OrderActorRole;
  storeLabel: string;
  /** 舊資料可能無此欄位，讀取時以 待出貨 帶入 */
  status: FranchiseOrderStatus;
  /** 攤上盤點按「盤點完成」押記：當日曆盤點日（本機 ymd） */
  stallCountBasisYmd?: string;
  /** 攤上盤點按「盤點完成」押記之時間（ISO） */
  stallCountCompletedAt?: string;
  /** 盤點完成當下寫入之帳上快照 */
  stallCountSnapshot?: SalesRecordDaySnapshot;
  /** 資料範圍（同店共用）：hq 或 franchisee:<userId> */
  scopeId?: string;
  /** 建單帳號 userId（同店多員工仍可共看 scope） */
  actorUserId?: string;
  /** 建單者姓名（權限／使用者目錄） */
  createdByName?: string;
  /** 攤上盤點「完成」押記之操作者姓名 */
  stallCountCompletedByName?: string;
  /** 盤點完成當下之操作者 userId（供舊單僅缺姓名時回補顯示） */
  stallCountCompletedByUserId?: string;
  /** 最近一次異動本筆訂單之操作者姓名（狀態、揀貨、盤點快照修正等） */
  lastUpdatedByName?: string;
};

const STORAGE_KEY = 'dongshan_order_history_v1';
const FRANCHISE_MGMT_KEY = 'dongshan_franchise_mgmt_orders_v1';

export type FranchiseManagementOrder = {
  id: string;
  createdAt: string;
  /** 訂單歸屬曆法日 YYYY-MM-DD；舊資料無此欄時以 createdAt 之本地日視同訂單日 */
  orderDateYmd?: string;
  updatedAt: string;
  source: 'procurement';
  totalAmount: number;
  /** 應付貨款（管理端預設同 totalAmount） */
  payableAmount?: number;
  /** 管理端預設為 0。 */
  selfSuppliedCostAmount?: number;
  itemCount: number;
  lines: OrderHistoryLine[];
  storeLabel: string;
  status: FranchiseOrderStatus;
  /** 攤上盤點按「盤點完成」押記：當日曆盤點日（本機 ymd） */
  stallCountBasisYmd?: string;
  /** 攤上盤點按「盤點完成」押記之時間（ISO） */
  stallCountCompletedAt?: string;
  /** 盤點完成當下寫入之帳上快照 */
  stallCountSnapshot?: SalesRecordDaySnapshot;
  scopeId?: string;
  actorUserId?: string;
  createdByName?: string;
  stallCountCompletedByName?: string;
  stallCountCompletedByUserId?: string;
  lastUpdatedByName?: string;
};

function newOrderId(): string {
  const ids = [
    ...loadFranchiseManagementOrders().map((o) => o.id),
    ...loadOrderHistory().map((o) => o.id),
  ];
  return allocateOrderSerialId(ids);
}

function normalizeHistoryEntry(
  e: OrderHistoryEntry & {
    status?: FranchiseOrderStatus;
    stallCountBasisYmd?: string;
    stallCountCompletedAt?: string;
    updatedAt?: string;
  }
): OrderHistoryEntry {
  const createdAt = e.createdAt;
  return {
    ...e,
    status: e.status ?? '待出貨',
    updatedAt: e.updatedAt ?? createdAt,
    payableAmount: e.payableAmount ?? e.totalAmount,
    selfSuppliedCostAmount:
      e.selfSuppliedCostAmount ??
      Math.max(0, e.totalAmount - (e.payableAmount ?? e.totalAmount)),
  };
}

function ymdFromCreatedAtLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 訂單業務曆法日（盤點／篩選／帶出重算與此對齊）；舊單無 orderDateYmd 則取自 createdAt 本地日 */
export function effectiveOrderDateYmd(o: { orderDateYmd?: string; createdAt: string }): string {
  const raw = o.orderDateYmd?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return ymdFromCreatedAtLocal(o.createdAt) || raw || '';
}

function normalizeOrderDateYmdInput(s: string): string {
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return ymdFromCreatedAtLocal(new Date().toISOString());
}

/**
 * 舊訂單可能缺 scopeId：依建單者 userId 向使用者目錄推斷與 {@link getDataScopeContext} 相同語意之資料範圍，
 * 讓加盟店／店員只看得到本體系訂單，且不會誤套總部 fallback。
 */
function inferScopeIdFromActorUserId(actorUserId: string | undefined): string | undefined {
  const id = actorUserId?.trim();
  if (!id) return undefined;
  const u = listSystemUsers().find((x) => x.id === id);
  if (!u) return undefined;
  if (u.role === 'admin') return HQ_SCOPE_ID;
  if (u.role === 'franchisee') return `scope:franchisee:${u.id}`;
  if (u.role === 'employee') {
    if (u.employeeOrgType === 'franchisee' && u.parentFranchiseeUserId) {
      return `scope:franchisee:${u.parentFranchiseeUserId}`;
    }
    return HQ_SCOPE_ID;
  }
  return undefined;
}

/**
 * 訂單所屬資料範圍（與權限推斷一致）：已存 scopeId 優先，否則依建單者向使用者目錄回推。
 */
export function resolveOrderDataScopeId(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>,
): string | undefined {
  const declared = row.scopeId?.trim();
  if (declared) return declared;
  return inferScopeIdFromActorUserId(row.actorUserId);
}

/** 是否為加盟店體系之資料範圍（含加盟主、隸屬加盟之店員、以及總部代建單但 scope 指向加盟） */
export function orderIsFranchiseBusinessScoped(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
): boolean {
  if (row.actorRole === 'franchisee') return true;
  const scope = resolveOrderDataScopeId(row);
  return Boolean(scope?.startsWith('scope:franchisee:'));
}

/**
 * 總部視角：直營（總部範圍）訂單。不含 actorRole 為 admin 但 scope 指向加盟之「訂單管理」單。
 */
export function orderIsHeadquartersDirectScoped(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
): boolean {
  if (row.actorRole === 'franchisee') return false;
  if (orderIsFranchiseBusinessScoped(row)) return false;
  return row.actorRole === 'admin' || row.actorRole === 'employee';
}

function canAccessOrder(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>,
  ctx: ReturnType<typeof getDataScopeContext>
): boolean {
  if (ctx.isAdmin) return true;
  const declared = row.scopeId?.trim();
  const effectiveScope = declared || inferScopeIdFromActorUserId(row.actorUserId);
  if (effectiveScope) return effectiveScope === ctx.scopeId;
  if (row.actorUserId) return row.actorUserId === ctx.userId;
  // 舊資料（尚未有 scope/actor）預設視為總部資料，直營帳號可讀取
  return ctx.scopeId === HQ_SCOPE_ID;
}

/** 目前登入身分是否可讀取該筆訂單（盤點／叫貨扣庫／列表共用） */
export function orderMatchesSessionScope(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>
): boolean {
  return canAccessOrder(row, getDataScopeContext());
}

/** 建單者：優先已存姓名，否則依 actorUserId 向使用者目錄回補 */
export function displayOrderCreatedByLabel(
  e: Pick<OrderHistoryEntry, 'createdByName' | 'actorUserId'>
): string {
  return e.createdByName?.trim() || resolveUserDisplayNameById(e.actorUserId) || '—';
}

/** 已有攤上盤點完成押記（與銷售紀錄綁定），不可改回待出貨或調整叫貨／揀貨品項 */
export function orderHasStallCountCompleted(o: { stallCountCompletedAt?: string }): boolean {
  return Boolean(o.stallCountCompletedAt?.trim());
}

/** 盤點完成者：已存姓名 → 完成者 userId → 舊押記無紀錄時退回建單者 userId（僅顯示用） */
export function displayOrderStallCountCompletedByLabel(
  e: Pick<
    OrderHistoryEntry,
    | 'stallCountCompletedByName'
    | 'stallCountCompletedByUserId'
    | 'actorUserId'
    | 'stallCountCompletedAt'
  >
): string {
  const fromStamp =
    e.stallCountCompletedByName?.trim() ||
    resolveUserDisplayNameById(e.stallCountCompletedByUserId);
  if (fromStamp) return fromStamp;
  if (e.stallCountCompletedAt) {
    const legacy = resolveUserDisplayNameById(e.actorUserId);
    if (legacy) return legacy;
  }
  return '—';
}

export function loadOrderHistory(): OrderHistoryEntry[] {
  try {
    const ctx = getDataScopeContext();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (OrderHistoryEntry & { status?: FranchiseOrderStatus })[];
    const list = Array.isArray(parsed) ? parsed : [];
    // 舊資料可能含 admin 單；保留並交由 scope/角色層過濾，避免直營員工看不到歷史直營單。
    return list
      .filter((e) => canAccessOrder(e, ctx))
      .map((e) => normalizeHistoryEntry(e as OrderHistoryEntry & { status?: FranchiseOrderStatus }));
  } catch {
    return [];
  }
}

function saveOrderHistory(entries: OrderHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event('orderHistoryUpdated'));
}

function normalizeFranchiseManagementOrder(
  m: FranchiseManagementOrder & { updatedAt?: string }
): FranchiseManagementOrder {
  return {
    ...m,
    updatedAt: m.updatedAt ?? m.createdAt,
    payableAmount: m.payableAmount ?? m.totalAmount,
    selfSuppliedCostAmount: m.selfSuppliedCostAmount ?? 0,
  };
}

export function loadFranchiseManagementOrders(): FranchiseManagementOrder[] {
  try {
    const ctx = getDataScopeContext();
    const raw = localStorage.getItem(FRANCHISE_MGMT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (FranchiseManagementOrder & { updatedAt?: string })[];
    const list = Array.isArray(parsed) ? parsed.map(normalizeFranchiseManagementOrder) : [];
    if (ctx.isAdmin) return list;
    return list.filter((o) => canAccessOrder(o, ctx));
  } catch {
    return [];
  }
}

function saveFranchiseManagementOrders(orders: FranchiseManagementOrder[]) {
  localStorage.setItem(FRANCHISE_MGMT_KEY, JSON.stringify(orders));
  window.dispatchEvent(new Event('franchiseManagementOrdersUpdated'));
}

function franchiseMgmtToHistoryEntry(m: FranchiseManagementOrder): OrderHistoryEntry {
  return {
    id: m.id,
    createdAt: m.createdAt,
    orderDateYmd: m.orderDateYmd,
    updatedAt: m.updatedAt ?? m.createdAt,
    source: m.source,
    totalAmount: m.totalAmount,
    payableAmount: m.payableAmount ?? m.totalAmount,
    selfSuppliedCostAmount: m.selfSuppliedCostAmount ?? 0,
    itemCount: m.itemCount,
    lines: m.lines,
    storeLabel: m.storeLabel,
    status: m.status,
    actorRole: 'admin',
    scopeId: m.scopeId,
    actorUserId: m.actorUserId,
    createdByName: m.createdByName,
    stallCountCompletedByName: m.stallCountCompletedByName,
    stallCountCompletedByUserId: m.stallCountCompletedByUserId,
    lastUpdatedByName: m.lastUpdatedByName,
    stallCountBasisYmd: m.stallCountBasisYmd,
    stallCountCompletedAt: m.stallCountCompletedAt,
    stallCountSnapshot: m.stallCountSnapshot,
  };
}

/**
 * 歷史訂單畫面專用：本機內已確認出貨（狀態「已完成」）的批貨單。
 * 含加盟/店員寫入之 order_history，以及超級管理員專寫之訂單管理內、已完成之單（兩庫併陳）。
 */
export function loadCompletedOrderHistoryList(): OrderHistoryEntry[] {
  const fromList = loadOrderHistory().filter((e) => e.status === '已完成');
  const fromMgmt = loadFranchiseManagementOrders()
    .filter((m) => m.status === '已完成')
    .map(franchiseMgmtToHistoryEntry);
  const byId = new Map<string, OrderHistoryEntry>();
  for (const e of fromList) {
    byId.set(e.id, e);
  }
  for (const e of fromMgmt) {
    byId.set(e.id, e);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/**
 * 歷史訂單列表：直營店員工僅能看直營相關單（總部＋本店帳下單），不含加盟主單。
 * 隸屬加盟店之員工資料範圍已是本店，不再依 actorRole 排除（需看到加盟主所下之單）。
 */
export function loadCompletedOrderHistoryListForRole(
  role: 'admin' | 'franchisee' | 'employee'
): OrderHistoryEntry[] {
  const all = loadCompletedOrderHistoryList();
  if (role !== 'employee') return all;
  const ctx = getDataScopeContext();
  if (ctx.scopeId !== HQ_SCOPE_ID) return all;
  return all.filter((e) => e.actorRole === 'admin' || e.actorRole === 'employee');
}

/** 讀取本機 `order_history` 全部項目（不過濾舊版 admin 寫入，供內部刪除用） */
function loadOrderHistoryAllEntries(): OrderHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (OrderHistoryEntry & { status?: FranchiseOrderStatus })[];
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map((e) =>
      normalizeHistoryEntry(e as OrderHistoryEntry & { status?: FranchiseOrderStatus })
    );
  } catch {
    return [];
  }
}

/**
 * 從本機「歷史訂單」或「訂單管理」儲存中永久移除一筆訂單（超級管理員專用）。
 * @returns 是否曾找到該筆並已刪除
 */
export function deleteOrderByIdFromAnyStore(orderId: string): boolean {
  const mgmt = loadFranchiseManagementOrders();
  if (mgmt.some((o) => o.id === orderId)) {
    saveFranchiseManagementOrders(mgmt.filter((o) => o.id !== orderId));
    return true;
  }
  const hist = loadOrderHistoryAllEntries();
  if (hist.some((o) => o.id === orderId)) {
    saveOrderHistory(hist.filter((o) => o.id !== orderId));
    return true;
  }
  return false;
}

function appendFranchiseManagementOrderInternal(params: {
  lines: OrderHistoryLine[];
  totalAmount: number;
  payableAmount?: number;
  selfSuppliedCostAmount?: number;
  orderDateYmd: string;
}): void {
  const { lines, totalAmount, payableAmount, selfSuppliedCostAmount, orderDateYmd } = params;
  const itemCount = roundProcurementQty(lines.reduce((s, l) => s + l.qty, 0));
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  const entry: FranchiseManagementOrder = {
    id: newOrderId(),
    createdAt: now,
    orderDateYmd: normalizeOrderDateYmdInput(orderDateYmd),
    updatedAt: now,
    source: 'procurement',
    totalAmount,
    payableAmount: payableAmount ?? totalAmount,
    selfSuppliedCostAmount: selfSuppliedCostAmount ?? 0,
    itemCount,
    lines,
    storeLabel: '直營店',
    status: '待出貨',
    scopeId: getDataScopeContext().scopeId,
    actorUserId: getDataScopeContext().userId || undefined,
    createdByName: who,
    lastUpdatedByName: who,
  };
  saveFranchiseManagementOrders([entry, ...loadFranchiseManagementOrders()]);
}

export function updateFranchiseManagementOrderStatus(id: string, status: FranchiseOrderStatus) {
  const list = loadFranchiseManagementOrders();
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return;
  if (status === '待出貨' && orderHasStallCountCompleted(list[i])) return;
  const next = [...list];
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  next[i] = { ...next[i], status, updatedAt: now, ...(who ? { lastUpdatedByName: who } : {}) };
  saveFranchiseManagementOrders(next);
}

export function updateOrderHistoryStatus(id: string, status: FranchiseOrderStatus) {
  const list = loadOrderHistory();
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return;
  if (status === '待出貨' && orderHasStallCountCompleted(list[i])) return;
  const next = [...list];
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  next[i] = { ...next[i], status, updatedAt: now, ...(who ? { lastUpdatedByName: who } : {}) };
  saveOrderHistory(next);
}

/**
 * 依單號更新狀態：先尋訂單管理庫，再尋歷史訂單（供超管合併檢視時使用）。
 */
export function updateOrderStatusInEitherStore(id: string, status: FranchiseOrderStatus): void {
  if (loadFranchiseManagementOrders().some((o) => o.id === id)) {
    updateFranchiseManagementOrderStatus(id, status);
    return;
  }
  updateOrderHistoryStatus(id, status);
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function calculateSelfSuppliedCostAmount(lines: OrderHistoryLine[], actorRole: OrderActorRole): number {
  if (actorRole !== 'franchisee') return 0;
  return roundMoney(
    lines.reduce((s, l) => {
      const item = getSupplyItem(l.productId, 'franchisee');
      if (!isFranchiseeSelfSuppliedItem(item)) return s;
      return s + l.unitPrice * l.qty;
    }, 0)
  );
}

/**
 * 待出貨時調整實出：重算小計與訂單總額。每列 0～99999（可小數，與叫貨一致）；0 則刪除該列。
 */
export function aggregateOrderLinesForSave(lines: OrderHistoryLine[]) {
  const kept = lines
    .map((l) => ({
      ...l,
      qty: roundProcurementQty(Number(l.qty) || 0),
    }))
    .filter((l) => l.qty > 0);
  const itemCount = roundProcurementQty(kept.reduce((s, l) => s + l.qty, 0));
  const totalAmount = roundMoney(kept.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  return { lines: kept, itemCount, totalAmount };
}

export type UpdateLinesResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'empty' | 'stall_count_locked' };

/**
 * 依單號更新待出貨品項（總部或加盟/店員帳內之訂單，會自動尋找儲位）。
 */
export function updatePendingOrderLinesById(id: string, nextLines: OrderHistoryLine[]): UpdateLinesResult {
  const { lines, itemCount, totalAmount } = aggregateOrderLinesForSave(nextLines);
  if (lines.length === 0) return { ok: false, reason: 'empty' };

  const mgmt = loadFranchiseManagementOrders();
  const mi = mgmt.findIndex((o) => o.id === id);
  if (mi >= 0) {
    if (mgmt[mi].status !== '待出貨') return { ok: false, reason: 'not_pending' };
    if (orderHasStallCountCompleted(mgmt[mi])) return { ok: false, reason: 'stall_count_locked' };
    const m = [...mgmt];
    const now = new Date().toISOString();
    const who = persistableActorDisplayName();
    m[mi] = {
      ...m[mi],
      lines,
      itemCount,
      totalAmount,
      payableAmount: totalAmount,
      selfSuppliedCostAmount: 0,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveFranchiseManagementOrders(m);
    return { ok: true };
  }

  const hist = loadOrderHistory();
  const hi = hist.findIndex((o) => o.id === id);
  if (hi >= 0) {
    if (hist[hi].status !== '待出貨') return { ok: false, reason: 'not_pending' };
    if (orderHasStallCountCompleted(hist[hi])) return { ok: false, reason: 'stall_count_locked' };
    const h = [...hist];
    const now = new Date().toISOString();
    const payableAmount = totalAmount;
    const selfSuppliedCostAmount = calculateSelfSuppliedCostAmount(lines, h[hi].actorRole);
    const who = persistableActorDisplayName();
    h[hi] = {
      ...h[hi],
      lines,
      itemCount,
      totalAmount,
      payableAmount,
      selfSuppliedCostAmount,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveOrderHistory(h);
    return { ok: true };
  }

  return { ok: false, reason: 'not_found' };
}

export type UpdateEditableOrderLinesResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'canceled' | 'empty' | 'stall_count_locked' };

/**
 * 依單號更新可編輯訂單之品項（允許「待出貨」與「已完成」，禁止「已取消」）。
 * 用於現場更正已出貨單之實出數量。
 */
export function updateEditableOrderLinesById(
  id: string,
  nextLines: OrderHistoryLine[]
): UpdateEditableOrderLinesResult {
  const { lines, itemCount, totalAmount } = aggregateOrderLinesForSave(nextLines);
  if (lines.length === 0) return { ok: false, reason: 'empty' };

  const mgmt = loadFranchiseManagementOrders();
  const mi = mgmt.findIndex((o) => o.id === id);
  if (mi >= 0) {
    if (mgmt[mi].status === '已取消') return { ok: false, reason: 'canceled' };
    if (orderHasStallCountCompleted(mgmt[mi])) return { ok: false, reason: 'stall_count_locked' };
    const m = [...mgmt];
    const now = new Date().toISOString();
    const who = persistableActorDisplayName();
    m[mi] = {
      ...m[mi],
      lines,
      itemCount,
      totalAmount,
      payableAmount: totalAmount,
      selfSuppliedCostAmount: 0,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveFranchiseManagementOrders(m);
    return { ok: true };
  }

  const hist = loadOrderHistory();
  const hi = hist.findIndex((o) => o.id === id);
  if (hi >= 0) {
    if (hist[hi].status === '已取消') return { ok: false, reason: 'canceled' };
    if (orderHasStallCountCompleted(hist[hi])) return { ok: false, reason: 'stall_count_locked' };
    const h = [...hist];
    const now = new Date().toISOString();
    const payableAmount = totalAmount;
    const selfSuppliedCostAmount = calculateSelfSuppliedCostAmount(lines, h[hi].actorRole);
    const who = persistableActorDisplayName();
    h[hi] = {
      ...h[hi],
      lines,
      itemCount,
      totalAmount,
      payableAmount,
      selfSuppliedCostAmount,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveOrderHistory(h);
    return { ok: true };
  }

  return { ok: false, reason: 'not_found' };
}

/**
 * 超級管理員叫貨 → 訂單管理（專用儲存）；
 * 加盟主／店員叫貨 → 歷史訂單（本清單）。
 */
export function appendProcurementOrderEntry(params: {
  lines: OrderHistoryLine[];
  totalAmount: number;
  payableAmount?: number;
  selfSuppliedCostAmount?: number;
  actorRole: OrderActorRole;
  /** 訂單歸屬日 YYYY-MM-DD（與實際送出時間 createdAt 分開） */
  orderDateYmd: string;
}): void {
  const { lines, totalAmount, payableAmount, selfSuppliedCostAmount, actorRole, orderDateYmd } = params;
  const ctx = getDataScopeContext();
  const bookYmd = normalizeOrderDateYmdInput(orderDateYmd);
  if (actorRole === 'admin') {
    appendFranchiseManagementOrderInternal({
      lines,
      totalAmount,
      payableAmount: payableAmount ?? totalAmount,
      selfSuppliedCostAmount: selfSuppliedCostAmount ?? 0,
      orderDateYmd: bookYmd,
    });
    return;
  }

  const itemCount = roundProcurementQty(lines.reduce((s, l) => s + l.qty, 0));
  const storeLabel = actorRole === 'franchisee' ? '加盟門市' : '門市帳號';

  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  const entry: OrderHistoryEntry = {
    id: newOrderId(),
    createdAt: now,
    orderDateYmd: bookYmd,
    updatedAt: now,
    source: 'procurement',
    totalAmount,
    payableAmount: payableAmount ?? totalAmount,
    selfSuppliedCostAmount: selfSuppliedCostAmount ?? calculateSelfSuppliedCostAmount(lines, actorRole),
    itemCount,
    lines,
    actorRole,
    storeLabel,
    status: '待出貨',
    scopeId: ctx.scopeId,
    actorUserId: ctx.userId || undefined,
    createdByName: who,
    lastUpdatedByName: who,
  };

  const next = [entry, ...loadOrderHistory()];
  saveOrderHistory(next);
}

/**
 * 在該筆訂單寫入攤上盤點壓記（盤點日＋完成時間＋帳上快照），供多店多單與銷售紀錄分帳顯示。
 */
export function setOrderStallCountStamp(
  orderId: string,
  fields: { basisYmd: string; completedAt: string; snapshot: SalesRecordDaySnapshot }
): boolean {
  const merged = mergeSalesRecordWithCatalog(fields.snapshot);
  const ctx = getDataScopeContext();
  const completedByUserId = ctx.userId?.trim() || undefined;
  const who = persistableActorDisplayName();
  const stampPatch = {
    stallCountBasisYmd: fields.basisYmd,
    stallCountCompletedAt: fields.completedAt,
    stallCountSnapshot: merged,
    ...(completedByUserId ? { stallCountCompletedByUserId: completedByUserId } : {}),
    ...(who ? { stallCountCompletedByName: who, lastUpdatedByName: who } : {}),
  };
  const mgmt = loadFranchiseManagementOrders();
  const mi = mgmt.findIndex((o) => o.id === orderId);
  if (mi >= 0) {
    const now = new Date().toISOString();
    const next = mgmt.map((o, i) =>
      i === mi
        ? {
            ...o,
            ...stampPatch,
            updatedAt: now,
          }
        : o
    );
    saveFranchiseManagementOrders(next);
    return true;
  }
  const hist = loadOrderHistory();
  const hi = hist.findIndex((o) => o.id === orderId);
  if (hi >= 0) {
    const now = new Date().toISOString();
    const next = hist.map((o, i) =>
      i === hi
        ? {
            ...o,
            ...stampPatch,
            updatedAt: now,
          }
        : o
    );
    saveOrderHistory(next);
    return true;
  }
  return false;
}

export type UpdateStallSnapshotResult = { ok: true } | { ok: false; reason: 'not_found' | 'no_stamp' };

/**
 * 已盤點訂單之盤點帳上快照事後修訂（不變盤點完成時間，僅更新快照內容）。
 */
export function updateStallCountSnapshotByOrderId(
  orderId: string,
  snapshot: SalesRecordDaySnapshot
): UpdateStallSnapshotResult {
  const merged = mergeSalesRecordWithCatalog(snapshot);
  const now = new Date().toISOString();
  const nextSnap: SalesRecordDaySnapshot = { ...merged, updatedAt: snapshot.updatedAt || now };

  const mgmt = loadFranchiseManagementOrders();
  const mi = mgmt.findIndex((o) => o.id === orderId);
  const who = persistableActorDisplayName();
  if (mi >= 0) {
    if (!mgmt[mi].stallCountCompletedAt) return { ok: false, reason: 'no_stamp' };
    const m = [...mgmt];
    m[mi] = {
      ...m[mi],
      stallCountSnapshot: nextSnap,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveFranchiseManagementOrders(m);
    return { ok: true };
  }
  const hist = loadOrderHistory();
  const hi = hist.findIndex((o) => o.id === orderId);
  if (hi >= 0) {
    if (!hist[hi].stallCountCompletedAt) return { ok: false, reason: 'no_stamp' };
    const h = [...hist];
    h[hi] = {
      ...h[hi],
      stallCountSnapshot: nextSnap,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
    saveOrderHistory(h);
    return { ok: true };
  }
  return { ok: false, reason: 'not_found' };
}

/**
 * 有「盤點完成」押記之訂單（含總部與加盟／店員庫），依完成時間新到舊；供銷售紀錄列表用。
 */
export function listOrdersWithStallCountCompleted(): OrderHistoryEntry[] {
  const ctx = getDataScopeContext();
  const byId = new Map<string, OrderHistoryEntry>();
  for (const m of loadFranchiseManagementOrders()) {
    if (!m.stallCountCompletedAt) continue;
    byId.set(m.id, franchiseMgmtToHistoryEntry(m));
  }
  for (const e of loadOrderHistory()) {
    if (!e.stallCountCompletedAt) continue;
    byId.set(e.id, normalizeHistoryEntry(e));
  }
  const sorted = Array.from(byId.values()).sort((a, b) => {
    const ta = a.stallCountCompletedAt ?? '';
    const tb = b.stallCountCompletedAt ?? '';
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  if (ctx.isAdmin) return sorted;
  return sorted.filter((e) => canAccessOrder(e, ctx));
}
