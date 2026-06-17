import { mergeOrderLikeRecord, recordUpdatedAtMs } from './bundleRecordMerge';
import { mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from './salesRecordStorage';
import { roundProcurementQty } from './stallMath';
import { allocateOrderSerialId } from './orderSerialId';
import { getDataScopeContext, HQ_SCOPE_ID, resolveFranchiseeRetailOwnerUserId } from './dataScope';
import { listSystemUsers } from './systemUsersStorage';
import { getStoreCode3, normalizeStoreCode3Digits } from './storeCodeStorage';
import { getSessionActorDisplayName, resolveUserDisplayNameById } from './sessionActorDisplayName';
import { getSupplyItem, isConsumableItem, isFranchiseeSelfSuppliedItem } from './supplyCatalog';
import { initialFranchiseeStoreLabelForOrder } from './orderStoreLabel';
import { purgeStallDayRecordsForDeletedOrder } from './orderStallRecordCleanup';

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
  /** Internal merge timestamp for this product line. */
  updatedAt?: string;
};

/** 訂單明細中「消耗品」分類之列小計加總（代訂固定成本，不計入總部營收／加盟排行）。 */
export function orderConsumableLinesAmountTotal(lines: OrderHistoryLine[]): number {
  let s = 0;
  for (const l of lines) {
    const it = getSupplyItem(l.productId);
    if (!isConsumableItem(it)) continue;
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    const u = Number(l.unitPrice) || 0;
    s += u * q;
  }
  return Math.round(s * 100) / 100;
}

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
  statusUpdatedAt?: string;
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
  /**
   * 批貨送出時所選「欲扣除餘貨的訂單」單號；空字串＝不指定（下單不扣盤點剩餘）。
   * 未定義之舊單：盤點「植入訂單」仍併入前一日收攤剩餘（相容舊行為）。
   */
  procurementDeductionBasisOrderId?: string;
};

const STORAGE_KEY = 'dongshan_order_history_v1';
const FRANCHISE_MGMT_KEY = 'dongshan_franchise_mgmt_orders_v1';
/** 已永久刪除之訂單 id（雲端合併時過濾，避免 union 還原） */
export const DELETED_ORDER_IDS_KEY = 'dongshan_deleted_order_ids_v1';

type DeletedOrderIdsStore = { version: 1; byId: Record<string, string> };

function loadDeletedOrderIdsStore(): DeletedOrderIdsStore {
  try {
    const raw = localStorage.getItem(DELETED_ORDER_IDS_KEY);
    if (!raw) return { version: 1, byId: {} };
    const p = JSON.parse(raw) as Partial<DeletedOrderIdsStore>;
    if (p && typeof p === 'object' && p.byId && typeof p.byId === 'object') {
      return { version: 1, byId: { ...p.byId } };
    }
  } catch {
    /* ignore */
  }
  return { version: 1, byId: {} };
}

/** 記錄訂單已刪除（多機同步時以墓碑排除該 id）。 */
export function tombstoneDeletedOrderId(orderId: string): void {
  const id = orderId.trim();
  if (!id) return;
  const store = loadDeletedOrderIdsStore();
  store.byId[id] = new Date().toISOString();
  localStorage.setItem(DELETED_ORDER_IDS_KEY, JSON.stringify(store));
}

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
  statusUpdatedAt?: string;
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
  /**
   * 批貨送出時所選「欲扣除餘貨的訂單」單號；空字串＝不指定。舊單無此欄時盤點公式仍併入前日剩餘。
   */
  procurementDeductionBasisOrderId?: string;
};

function franchiseeUserIdFromScopeId(scopeId: string): string | null {
  const m = /^scope:franchisee:(.+)$/.exec(scopeId);
  const id = m?.[1]?.trim();
  return id || null;
}

function orderStoreCode3ForFranchiseeUserId(
  franchiseeUserId: string,
  users: ReturnType<typeof listSystemUsers>
): string | null {
  const u = users.find((x) => x.id === franchiseeUserId);
  const raw = u?.orderStoreCode?.trim();
  return raw ? normalizeStoreCode3Digits(raw) : null;
}

/**
 * 依登入身分決定訂單店號前綴：
 * - 加盟 scope（加盟主／其員工）：權限表「訂單店號」orderStoreCode
 * - 總部／直營員工：本機「本機店號」{@link getStoreCode3}
 */
function resolveStoreCode3ForNewOrder(): string {
  const ctx = getDataScopeContext();
  const users = listSystemUsers();

  const scopeFranchiseeId = franchiseeUserIdFromScopeId(ctx.scopeId);
  if (scopeFranchiseeId) {
    const fromScope = orderStoreCode3ForFranchiseeUserId(scopeFranchiseeId, users);
    if (fromScope) return fromScope;
  }

  if (ctx.role === 'admin' || ctx.role === 'unknown' || !ctx.userId) {
    return getStoreCode3();
  }
  if (ctx.role === 'franchisee') {
    return orderStoreCode3ForFranchiseeUserId(ctx.userId, users) ?? getStoreCode3();
  }
  if (ctx.role === 'employee') {
    const u = users.find((x) => x.id === ctx.userId);
    const parentId = u?.parentFranchiseeUserId?.trim();
    if (parentId) {
      return orderStoreCode3ForFranchiseeUserId(parentId, users) ?? getStoreCode3();
    }
    return getStoreCode3();
  }
  return getStoreCode3();
}

function newOrderId(): string {
  const ids = [
    ...loadFranchiseManagementOrdersAll().map((o) => o.id),
    ...loadOrderHistoryAllEntries().map((o) => o.id),
  ];
  return allocateOrderSerialId(ids, new Date(), resolveStoreCode3ForNewOrder());
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
    ...(e.statusUpdatedAt ? { statusUpdatedAt: e.statusUpdatedAt } : {}),
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
  // 總部管理員需跨 scope 檢視／維護加盟店訂單；非管理員仍僅能存取自身資料範圍
  if (ctx.isAdmin) return true;
  const declared = row.scopeId?.trim();
  const effectiveScope = declared || inferScopeIdFromActorUserId(row.actorUserId);
  if (effectiveScope) return effectiveScope === ctx.scopeId;
  if (row.actorUserId) return row.actorUserId === ctx.userId;
  // 舊資料（尚未有 scope/actor）預設視為總部資料，直營帳號可讀取
  return ctx.scopeId === HQ_SCOPE_ID;
}

/**
 * 訂單管理／批貨後列表：總部直營員工需看見加盟主叫貨單（出貨作業），
 * 否則僅能看見 scope:hq 內單據會「加盟主昨晚下單、白天總部看不到」。
 */
export function canAccessOrderInManagementList(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
  ctx: ReturnType<typeof getDataScopeContext> = getDataScopeContext(),
): boolean {
  if (canAccessOrder(row, ctx)) return true;
  if (
    ctx.role === 'employee' &&
    ctx.scopeId === HQ_SCOPE_ID &&
    row.actorRole === 'franchisee'
  ) {
    return true;
  }
  return false;
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

/** 已有攤上盤點完成押記（與銷售紀錄綁定），不可改回待出貨或調整叫貨／揀貨品項；總部仍可以以「更正批價」僅改單價（見 adminPatchOrderLineUnitPricesById）。 */
export function orderHasStallCountCompleted(o: { stallCountCompletedAt?: string }): boolean {
  return Boolean(o.stallCountCompletedAt?.trim());
}

/** 已盤點且未取消：才計入銷售數據、營運概況營收與盤點落差彙總。 */
export function orderCountsTowardStallEconomics(
  o: Pick<OrderHistoryEntry, 'status' | 'stallCountCompletedAt'>,
): boolean {
  return orderHasStallCountCompleted(o) && o.status !== '已取消';
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

/** 最近一次異動本筆訂單之操作者；尚未寫入時為 —（舊資料或僅建單未再異動） */
export function displayOrderLastUpdatedByLabel(
  e: Pick<OrderHistoryEntry, 'lastUpdatedByName'>,
): string {
  return e.lastUpdatedByName?.trim() || '—';
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
      .filter((e) => canAccessOrderInManagementList(e, ctx))
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
    ...(m.statusUpdatedAt ? { statusUpdatedAt: m.statusUpdatedAt } : {}),
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
    statusUpdatedAt: m.statusUpdatedAt,
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
    procurementDeductionBasisOrderId: m.procurementDeductionBasisOrderId,
  };
}

/** 雙庫合併讀取全部訂單（不過濾 scope；供刪單清理、財務彙總等內部用途）。 */
export function listAllMergedOrdersFromStores(): OrderHistoryEntry[] {
  const byId = new Map<string, OrderHistoryEntry>();
  for (const m of loadFranchiseManagementOrdersAll()) {
    byId.set(m.id, franchiseMgmtToHistoryEntry(m));
  }
  for (const e of loadOrderHistoryAllEntries()) {
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeOrderLikeRecord(prev, e) : normalizeHistoryEntry(e));
  }
  return Array.from(byId.values());
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
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeOrderLikeRecord(prev, e) : e);
  }
  for (const e of fromMgmt) {
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeOrderLikeRecord(prev, e) : e);
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

/** 讀取本機 `order_history` 全部項目（不過濾 scope，供寫入合併用） */
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

function loadFranchiseManagementOrdersAll(): FranchiseManagementOrder[] {
  try {
    const raw = localStorage.getItem(FRANCHISE_MGMT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (FranchiseManagementOrder & { updatedAt?: string })[];
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map(normalizeFranchiseManagementOrder);
  } catch {
    return [];
  }
}

function patchOrderHistoryById(
  id: string,
  patch: (row: OrderHistoryEntry) => OrderHistoryEntry | null
): boolean {
  const ctx = getDataScopeContext();
  const all = loadOrderHistoryAllEntries();
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) return false;
  if (!canAccessOrder(all[i], ctx)) return false;
  const updated = patch(all[i]);
  if (!updated) return false;
  const next = [...all];
  next[i] = updated;
  saveOrderHistory(next);
  return true;
}

function patchFranchiseManagementOrderById(
  id: string,
  patch: (row: FranchiseManagementOrder) => FranchiseManagementOrder | null
): boolean {
  const ctx = getDataScopeContext();
  const all = loadFranchiseManagementOrdersAll();
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) return false;
  if (!canAccessOrder(all[i], ctx)) return false;
  const updated = patch(all[i]);
  if (!updated) return false;
  const next = [...all];
  next[i] = updated;
  saveFranchiseManagementOrders(next);
  return true;
}

/**
 * 從本機「歷史訂單」或「訂單管理」儲存中永久移除一筆訂單（僅限目前身分可存取之 scope）。
 * @returns 是否曾找到該筆並已刪除
 */
export function deleteOrderByIdFromAnyStore(orderId: string): boolean {
  const ctx = getDataScopeContext();
  const mgmtAll = loadFranchiseManagementOrdersAll();
  const histAll = loadOrderHistoryAllEntries();
  const mgmtHit = mgmtAll.find((o) => o.id === orderId);
  const histHit = histAll.find((o) => o.id === orderId);
  if (!mgmtHit && !histHit) return false;
  if (mgmtHit && !canAccessOrder(mgmtHit, ctx)) return false;
  if (histHit && !canAccessOrder(histHit, ctx)) return false;

  const deletedForCleanup: OrderHistoryEntry | null = (() => {
    if (mgmtHit && histHit) {
      return mergeOrderLikeRecord(franchiseMgmtToHistoryEntry(mgmtHit), normalizeHistoryEntry(histHit));
    }
    if (mgmtHit) return franchiseMgmtToHistoryEntry(mgmtHit);
    if (histHit) return normalizeHistoryEntry(histHit);
    return null;
  })();

  if (mgmtHit) {
    saveFranchiseManagementOrders(mgmtAll.filter((o) => o.id !== orderId));
  }
  if (histHit) {
    saveOrderHistory(histAll.filter((o) => o.id !== orderId));
  }
  tombstoneDeletedOrderId(orderId);
  if (deletedForCleanup) {
    purgeStallDayRecordsForDeletedOrder(deletedForCleanup);
  }
  return true;
}

function appendFranchiseManagementOrderInternal(params: {
  lines: OrderHistoryLine[];
  totalAmount: number;
  payableAmount?: number;
  selfSuppliedCostAmount?: number;
  orderDateYmd: string;
  procurementDeductionBasisOrderId?: string;
}): string {
  const {
    lines,
    totalAmount,
    payableAmount,
    selfSuppliedCostAmount,
    orderDateYmd,
    procurementDeductionBasisOrderId,
  } = params;
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
    lines: lines.map((line) => ({ ...line, updatedAt: now })),
    storeLabel: '直營店',
    status: '待出貨',
    statusUpdatedAt: now,
    scopeId: getDataScopeContext().scopeId,
    actorUserId: getDataScopeContext().userId || undefined,
    createdByName: who,
    lastUpdatedByName: who,
    ...(procurementDeductionBasisOrderId !== undefined
      ? { procurementDeductionBasisOrderId }
      : {}),
  };
  saveFranchiseManagementOrders([entry, ...loadFranchiseManagementOrdersAll()]);
  return entry.id;
}

export function updateFranchiseManagementOrderStatus(id: string, status: FranchiseOrderStatus) {
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  patchFranchiseManagementOrderById(id, (row) => {
    if (status === '待出貨' && orderHasStallCountCompleted(row)) return null;
    return { ...row, status, statusUpdatedAt: now, updatedAt: now, ...(who ? { lastUpdatedByName: who } : {}) };
  });
}

export function updateOrderHistoryStatus(id: string, status: FranchiseOrderStatus) {
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  patchOrderHistoryById(id, (row) => {
    if (status === '待出貨' && orderHasStallCountCompleted(row)) return null;
    return { ...row, status, statusUpdatedAt: now, updatedAt: now, ...(who ? { lastUpdatedByName: who } : {}) };
  });
}

/**
 * 依單號更新狀態：先尋訂單管理庫，再尋歷史訂單（供超管合併檢視時使用）。
 */
export function updateOrderStatusInEitherStore(id: string, status: FranchiseOrderStatus): void {
  const inMgmt = loadFranchiseManagementOrdersAll().some((o) => o.id === id);
  const inHist = loadOrderHistoryAllEntries().some((o) => o.id === id);
  if (inMgmt) updateFranchiseManagementOrderStatus(id, status);
  if (inHist) updateOrderHistoryStatus(id, status);
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function franchiseeRetailOwnerIdForOrder(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
): string | null {
  const scope = resolveOrderDataScopeId(row);
  const fromScope = scope?.match(/^scope:franchisee:(.+)$/)?.[1]?.trim();
  if (fromScope) return fromScope;
  return row.actorRole === 'franchisee' ? row.actorUserId?.trim() || null : null;
}

function calculateSelfSuppliedCostAmount(
  lines: OrderHistoryLine[],
  actorRole: OrderActorRole,
  franchiseeOwnerUserId?: string | null,
): number {
  if (actorRole !== 'franchisee') return 0;
  const ownerId = resolveFranchiseeRetailOwnerUserId(franchiseeOwnerUserId ?? undefined);
  return roundMoney(
    lines.reduce((s, l) => {
      const item = getSupplyItem(l.productId, 'franchisee', ownerId ?? undefined);
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

function orderLineRevisionKey(l: OrderHistoryLine): string {
  return [
    l.productId,
    roundProcurementQty(Number(l.qty) || 0),
    roundMoney(Number(l.unitPrice) || 0),
    l.name,
    l.unit,
  ].join('\u001f');
}

function stampChangedOrderLines(
  nextLines: OrderHistoryLine[],
  previousLines: OrderHistoryLine[],
  now: string,
  previousOrderUpdatedAt?: string,
): OrderHistoryLine[] {
  const previousByProductId = new Map<string, OrderHistoryLine>();
  for (const line of previousLines) {
    if (!line.productId) continue;
    previousByProductId.set(line.productId, line);
  }

  return nextLines.map((line) => {
    const prev = previousByProductId.get(line.productId);
    const unchanged = prev && orderLineRevisionKey(prev) === orderLineRevisionKey(line);
    return {
      ...line,
      updatedAt: unchanged ? prev.updatedAt ?? previousOrderUpdatedAt ?? now : now,
    };
  });
}

/** 各品項實出量（qty>0 合計），供比對調整貨量是否已寫入訂單。 */
export function orderLineQtyByProductId(lines: OrderHistoryLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    m.set(l.productId, roundProcurementQty((m.get(l.productId) ?? 0) + q));
  }
  return m;
}

export function orderLineQtyMapsEqual(a: OrderHistoryLine[], b: OrderHistoryLine[]): boolean {
  const ma = orderLineQtyByProductId(a);
  const mb = orderLineQtyByProductId(b);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) {
    if (mb.get(k) !== v) return false;
  }
  return true;
}

/** 兩庫同單號合併為一筆（狀態／數量／盤點押記皆採較完整者），供列表與修訂時間判斷。 */
export function readMergedOrderByIdFromStores(
  id: string,
): OrderHistoryEntry | FranchiseManagementOrder | null {
  const mgmt = loadFranchiseManagementOrdersAll().find((o) => o.id === id);
  const hist = loadOrderHistoryAllEntries().find((o) => o.id === id);
  if (mgmt && hist) {
    return mergeOrderLikeRecord(
      franchiseMgmtToHistoryEntry(mgmt),
      normalizeHistoryEntry(hist as OrderHistoryEntry & { status?: FranchiseOrderStatus }),
    );
  }
  if (mgmt) return mgmt;
  if (hist) return normalizeHistoryEntry(hist as OrderHistoryEntry & { status?: FranchiseOrderStatus });
  return null;
}

/** 訂單在 storage 上的修訂時間（毫秒），供遠端同步後判斷 UI 是否過期。 */
export function getOrderStorageRevisionMs(id: string): number {
  const row = readMergedOrderByIdFromStores(id);
  return row ? recordUpdatedAtMs(row) : 0;
}

/** 讀取單號對應品項（兩庫皆查；訂單管理優先），供儲存後驗證用。 */
export function readOrderLinesByIdFromStores(id: string): OrderHistoryLine[] | null {
  const mgmt = loadFranchiseManagementOrdersAll().find((o) => o.id === id);
  if (mgmt) return mgmt.lines;
  const hist = loadOrderHistoryAllEntries().find((o) => o.id === id);
  return hist?.lines ?? null;
}

type AggregatedOrderLines = ReturnType<typeof aggregateOrderLinesForSave>;

type LinePatchBlockReason = 'canceled' | 'stall_count_locked' | 'not_pending';

function linePatchBlockReason(
  row: { status: FranchiseOrderStatus; stallCountCompletedAt?: string },
  mode: 'pending' | 'editable',
): LinePatchBlockReason | null {
  if (row.status === '已取消') return 'canceled';
  if (orderHasStallCountCompleted(row)) return 'stall_count_locked';
  if (mode === 'pending' && row.status !== '待出貨') return 'not_pending';
  return null;
}

/**
 * 同一單號若同時存在「訂單管理」與「歷史訂單」兩庫，一併寫入，避免只更新一庫、畫面卻讀到舊副本。
 */
function patchOrderLinesInEitherStore(
  id: string,
  totals: AggregatedOrderLines,
  mode: 'pending' | 'editable',
): { ok: true } | { ok: false; reason: 'not_found' | LinePatchBlockReason } {
  const mgmtHit = loadFranchiseManagementOrdersAll().find((o) => o.id === id);
  const histHit = loadOrderHistoryAllEntries().find((o) => o.id === id);
  if (!mgmtHit && !histHit) return { ok: false, reason: 'not_found' };

  const now = new Date().toISOString();
  const who = persistableActorDisplayName();
  const { itemCount, totalAmount } = totals;
  let wrote = false;
  const blockers = new Set<LinePatchBlockReason>();

  if (mgmtHit) {
    const block = linePatchBlockReason(mgmtHit, mode);
    if (block) blockers.add(block);
    else {
      const lines = stampChangedOrderLines(totals.lines, mgmtHit.lines, now, mgmtHit.updatedAt);
      const patched = patchFranchiseManagementOrderById(id, (row) => ({
        ...row,
        lines,
        itemCount,
        totalAmount,
        payableAmount: totalAmount,
        selfSuppliedCostAmount: 0,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      }));
      if (patched) wrote = true;
    }
  }

  if (histHit) {
    const block = linePatchBlockReason(histHit, mode);
    if (block) blockers.add(block);
    else {
      const lines = stampChangedOrderLines(totals.lines, histHit.lines, now, histHit.updatedAt);
      const payableAmount = totalAmount;
      const selfSuppliedCostAmount = calculateSelfSuppliedCostAmount(
        lines,
        histHit.actorRole,
        franchiseeRetailOwnerIdForOrder(histHit),
      );
      const patched = patchOrderHistoryById(id, (row) => ({
        ...row,
        lines,
        itemCount,
        totalAmount,
        payableAmount,
        selfSuppliedCostAmount,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      }));
      if (patched) wrote = true;
    }
  }

  if (wrote) return { ok: true };
  if (blockers.has('stall_count_locked')) return { ok: false, reason: 'stall_count_locked' };
  if (blockers.has('canceled')) return { ok: false, reason: 'canceled' };
  if (blockers.has('not_pending')) return { ok: false, reason: 'not_pending' };
  return { ok: false, reason: 'not_found' };
}

export type UpdateLinesResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'empty' | 'stall_count_locked' };

/**
 * 依單號更新待出貨品項（總部或加盟/店員帳內之訂單，會自動尋找儲位）。
 */
export function updatePendingOrderLinesById(id: string, nextLines: OrderHistoryLine[]): UpdateLinesResult {
  const totals = aggregateOrderLinesForSave(nextLines);
  if (totals.lines.length === 0) return { ok: false, reason: 'empty' };
  const res = patchOrderLinesInEitherStore(id, totals, 'pending');
  if (res.ok === true) return res;
  if (res.reason === 'canceled') return { ok: false, reason: 'not_pending' };
  if (res.reason === 'not_found') return { ok: false, reason: 'not_found' };
  if (res.reason === 'not_pending') return { ok: false, reason: 'not_pending' };
  return { ok: false, reason: 'stall_count_locked' };
}

export type UpdateEditableOrderLinesResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'canceled' | 'empty' | 'stall_count_locked' };

/** 管理員修正訂單「批價／每份單價」專用（與攤上盤點押記無關，不變更數量）。 */
export type AdminPatchOrderUnitPricesResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'canceled' | 'empty' | 'qty_mismatch';
    };

function lineQtyByProductId(lines: OrderHistoryLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    m.set(l.productId, roundProcurementQty((m.get(l.productId) ?? 0) + q));
  }
  return m;
}

function lineQtyMapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

function clampOrderUnitPrice(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return roundMoney(Math.max(0, Math.min(9_999_999, x)));
}

/**
 * 僅限超級管理員：在不改變各品項「數量」的前提下，修正 `lines[].unitPrice` 並重算總額。
 * 允許「待出貨」「已完成」；**略過**攤上盤點押記（僅改單價，不影響盤點當下帶出量）。
 */
export function adminPatchOrderLineUnitPricesById(
  id: string,
  nextLines: OrderHistoryLine[]
): AdminPatchOrderUnitPricesResult {
  const ctx = getDataScopeContext();
  if (!ctx.isAdmin) return { ok: false, reason: 'forbidden' };

  const nextAgg = aggregateOrderLinesForSave(nextLines);
  if (nextAgg.lines.length === 0) return { ok: false, reason: 'empty' };

  const pricedLines = nextAgg.lines.map((l) => ({
    ...l,
    unitPrice: clampOrderUnitPrice(l.unitPrice),
  }));
  const pricedAgg = aggregateOrderLinesForSave(pricedLines);
  const nextQtyMap = lineQtyByProductId(pricedAgg.lines);

  const tryPatch = (
    row: {
      lines: OrderHistoryLine[];
      status: FranchiseOrderStatus;
      actorRole?: OrderActorRole;
    },
    apply: (totals: ReturnType<typeof aggregateOrderLinesForSave>) => void
  ): AdminPatchOrderUnitPricesResult => {
    if (row.status === '已取消') return { ok: false, reason: 'canceled' };
    const prevQtyMap = lineQtyByProductId(aggregateOrderLinesForSave(row.lines).lines);
    if (!lineQtyMapsEqual(prevQtyMap, nextQtyMap)) return { ok: false, reason: 'qty_mismatch' };

    const finalLines = pricedAgg.lines.map((nl) => {
      const prevSame = row.lines.find((pl) => pl.productId === nl.productId);
      return {
        ...nl,
        name: prevSame?.name ?? nl.name,
        unit: prevSame?.unit ?? nl.unit,
      };
    });
    const totals = aggregateOrderLinesForSave(finalLines);
    apply(totals);
    return { ok: true };
  };

  const mgmtHit = loadFranchiseManagementOrdersAll().find((o) => o.id === id);
  const histHit = loadOrderHistoryAllEntries().find((o) => o.id === id);
  if (!mgmtHit && !histHit) return { ok: false, reason: 'not_found' };

  if (mgmtHit) {
    const now = new Date().toISOString();
    const who = persistableActorDisplayName();
    const mgmtRes = tryPatch(mgmtHit, (tot) => {
      patchFranchiseManagementOrderById(id, (row) => ({
        ...row,
        lines: tot.lines,
        itemCount: tot.itemCount,
        totalAmount: tot.totalAmount,
        payableAmount: tot.totalAmount,
        selfSuppliedCostAmount: 0,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      }));
    });
    if (!mgmtRes.ok) return mgmtRes;
  }
  if (histHit) {
    const now = new Date().toISOString();
    const who = persistableActorDisplayName();
    const res = tryPatch(histHit, (tot) => {
      const payableAmount = tot.totalAmount;
      const selfSuppliedCostAmount = calculateSelfSuppliedCostAmount(
        tot.lines,
        histHit.actorRole,
        franchiseeRetailOwnerIdForOrder(histHit),
      );
      patchOrderHistoryById(id, (row) => ({
        ...row,
        lines: tot.lines,
        itemCount: tot.itemCount,
        totalAmount: tot.totalAmount,
        payableAmount,
        selfSuppliedCostAmount,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      }));
    });
    if (!res.ok) return res;
  }
  return { ok: true };
}

/**
 * 依單號更新可編輯訂單之品項（允許「待出貨」與「已完成」，禁止「已取消」）。
 * 用於現場更正已出貨單之實出數量。
 */
export function updateEditableOrderLinesById(
  id: string,
  nextLines: OrderHistoryLine[]
): UpdateEditableOrderLinesResult {
  const totals = aggregateOrderLinesForSave(nextLines);
  if (totals.lines.length === 0) return { ok: false, reason: 'empty' };
  const res = patchOrderLinesInEitherStore(id, totals, 'editable');
  if (res.ok === true) return res;
  if (res.reason === 'not_pending') return { ok: false, reason: 'not_found' };
  if (res.reason === 'not_found') return { ok: false, reason: 'not_found' };
  if (res.reason === 'canceled') return { ok: false, reason: 'canceled' };
  return { ok: false, reason: 'stall_count_locked' };
}

/**
 * 直營店管理員叫貨 → 訂單管理（專用儲存）；
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
  /** 批貨頁選取之扣庫參考單號；傳空字串表示不指定 */
  procurementDeductionBasisOrderId?: string;
}): string {
  const {
    lines,
    totalAmount,
    payableAmount,
    selfSuppliedCostAmount,
    actorRole,
    orderDateYmd,
    procurementDeductionBasisOrderId,
  } = params;
  const ctx = getDataScopeContext();
  const bookYmd = normalizeOrderDateYmdInput(orderDateYmd);
  if (actorRole === 'admin') {
    return appendFranchiseManagementOrderInternal({
      lines,
      totalAmount,
      payableAmount: payableAmount ?? totalAmount,
      selfSuppliedCostAmount: selfSuppliedCostAmount ?? 0,
      orderDateYmd: bookYmd,
      procurementDeductionBasisOrderId,
    });
  }

  const itemCount = roundProcurementQty(lines.reduce((s, l) => s + l.qty, 0));
  const storeLabel =
    actorRole === 'franchisee'
      ? initialFranchiseeStoreLabelForOrder(ctx.userId || undefined)
      : '門市帳號';

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
    selfSuppliedCostAmount:
      selfSuppliedCostAmount ??
      calculateSelfSuppliedCostAmount(
        lines,
        actorRole,
        actorRole === 'franchisee'
          ? ctx.userId
          : ctx.scopeId.match(/^scope:franchisee:(.+)$/)?.[1]?.trim() || null,
      ),
    itemCount,
    lines: lines.map((line) => ({ ...line, updatedAt: now })),
    actorRole,
    storeLabel,
    status: '待出貨',
    statusUpdatedAt: now,
    scopeId: ctx.scopeId,
    actorUserId: ctx.userId || undefined,
    createdByName: who,
    lastUpdatedByName: who,
    ...(procurementDeductionBasisOrderId !== undefined
      ? { procurementDeductionBasisOrderId }
      : {}),
  };

  saveOrderHistory([entry, ...loadOrderHistoryAllEntries()]);
  return entry.id;
}

function patchOrderStallFieldsInEveryStore(
  orderId: string,
  patch: (row: OrderHistoryEntry) => OrderHistoryEntry | null,
): boolean {
  const inMgmt = loadFranchiseManagementOrdersAll().some((o) => o.id === orderId);
  const inHist = loadOrderHistoryAllEntries().some((o) => o.id === orderId);
  if (!inMgmt && !inHist) return false;
  let ok = true;
  if (inMgmt) {
    ok = patchFranchiseManagementOrderById(orderId, (row) => patch(row as OrderHistoryEntry)) && ok;
  }
  if (inHist) {
    ok = patchOrderHistoryById(orderId, patch) && ok;
  }
  return ok;
}

/**
 * 在該筆訂單寫入攤上盤點壓記（盤點日＋完成時間＋帳上快照），供多店多單與銷售紀錄分帳顯示。
 */
export function setOrderStallCountStamp(
  orderId: string,
  fields: { basisYmd: string; completedAt: string; snapshot: SalesRecordDaySnapshot }
): boolean {
  if (!readMergedOrderByIdFromStores(orderId)) return false;
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
  const now = new Date().toISOString();
  return patchOrderStallFieldsInEveryStore(orderId, (row) => ({
    ...row,
    ...stampPatch,
    updatedAt: now,
  }));
}

export type UpdateStallSnapshotResult = { ok: true } | { ok: false; reason: 'not_found' | 'no_stamp' };

function stallSnapshotLineQtyKey(
  lines: SalesRecordDaySnapshot['lines'] | undefined,
  itemId: string,
  field: 'out' | 'remain',
): string {
  const raw = lines?.[itemId]?.[field];
  const n = roundProcurementQty(Number(String(raw ?? '').trim() || '0'));
  return Number.isFinite(n) ? String(n) : '0';
}

/** 儲存後驗證：比對盤點帳上關鍵欄位（不依賴 updatedAt 字串完全一致）。 */
export function stallCountSnapshotPersistedMatches(
  saved: SalesRecordDaySnapshot | undefined | null,
  expected: SalesRecordDaySnapshot,
): boolean {
  if (!saved) return false;
  const a = mergeSalesRecordWithCatalog(saved);
  const b = mergeSalesRecordWithCatalog(expected);
  if (String(a.actualRevenue ?? '').trim() !== String(b.actualRevenue ?? '').trim()) return false;
  if (String(a.revenueGapAmount ?? '').trim() !== String(b.revenueGapAmount ?? '').trim()) return false;
  if (String(a.revenueGapReason ?? '').trim() !== String(b.revenueGapReason ?? '').trim()) return false;
  const ids = new Set([...Object.keys(a.lines ?? {}), ...Object.keys(b.lines ?? {})]);
  for (const id of ids) {
    if (stallSnapshotLineQtyKey(a.lines, id, 'out') !== stallSnapshotLineQtyKey(b.lines, id, 'out')) {
      return false;
    }
    if (stallSnapshotLineQtyKey(a.lines, id, 'remain') !== stallSnapshotLineQtyKey(b.lines, id, 'remain')) {
      return false;
    }
  }
  return true;
}

export type UpdateOrderDateYmdResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_date' };

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

  const who = persistableActorDisplayName();
  const mgmtHit = loadFranchiseManagementOrdersAll().find((o) => o.id === orderId);
  const histHit = loadOrderHistoryAllEntries().find((o) => o.id === orderId);
  if (!mgmtHit && !histHit) return { ok: false, reason: 'not_found' };
  const stampedRef = [mgmtHit, histHit].find((o) => o?.stallCountCompletedAt?.trim());
  if (!stampedRef?.stallCountCompletedAt?.trim()) return { ok: false, reason: 'no_stamp' };

  const stampBackfill = {
    stallCountBasisYmd: stampedRef.stallCountBasisYmd,
    stallCountCompletedAt: stampedRef.stallCountCompletedAt,
    stallCountCompletedByUserId: stampedRef.stallCountCompletedByUserId,
    stallCountCompletedByName: stampedRef.stallCountCompletedByName,
  };

  const ok = patchOrderStallFieldsInEveryStore(orderId, (row) => {
    if (!row.stallCountCompletedAt?.trim()) {
      return {
        ...row,
        ...stampBackfill,
        stallCountSnapshot: nextSnap,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      };
    }
    return {
      ...row,
      stallCountSnapshot: nextSnap,
      updatedAt: now,
      ...(who ? { lastUpdatedByName: who } : {}),
    };
  });
  return ok ? { ok: true } : { ok: false, reason: 'no_stamp' };
}

/**
 * 變更訂單業務曆法日（與下單時間 createdAt 分開）；訂單管理與歷史訂單庫皆可更新。
 */
export function updateOrderDateYmdByOrderId(
  orderId: string,
  orderDateYmd: string,
): UpdateOrderDateYmdResult {
  const raw = String(orderDateYmd).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, reason: 'invalid_date' };
  }
  const bookYmd = normalizeOrderDateYmdInput(raw);
  const now = new Date().toISOString();
  const who = persistableActorDisplayName();

  let wrote = false;
  if (loadFranchiseManagementOrdersAll().some((o) => o.id === orderId)) {
    wrote =
      patchFranchiseManagementOrderById(orderId, (row) => ({
        ...row,
        orderDateYmd: bookYmd,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      })) || wrote;
  }
  if (loadOrderHistoryAllEntries().some((o) => o.id === orderId)) {
    wrote =
      patchOrderHistoryById(orderId, (row) => ({
        ...row,
        orderDateYmd: bookYmd,
        updatedAt: now,
        ...(who ? { lastUpdatedByName: who } : {}),
      })) || wrote;
  }
  return wrote ? { ok: true } : { ok: false, reason: 'not_found' };
}

/**
 * 有「盤點完成」押記之訂單（含總部與加盟／店員庫），依完成時間新到舊；供銷售紀錄列表用。
 */
export function listOrdersWithStallCountCompleted(): OrderHistoryEntry[] {
  const ctx = getDataScopeContext();
  const byId = new Map<string, OrderHistoryEntry>();
  for (const m of loadFranchiseManagementOrders()) {
    if (!m.stallCountCompletedAt) continue;
    const entry = franchiseMgmtToHistoryEntry(m);
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? mergeOrderLikeRecord(prev, entry) : entry);
  }
  for (const e of loadOrderHistory()) {
    if (!e.stallCountCompletedAt) continue;
    const entry = normalizeHistoryEntry(e);
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeOrderLikeRecord(prev, entry) : entry);
  }
  const sorted = Array.from(byId.values()).sort((a, b) => {
    const ta = a.stallCountCompletedAt ?? '';
    const tb = b.stallCountCompletedAt ?? '';
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  return sorted.filter((e) => canAccessOrderInManagementList(e, ctx));
}
