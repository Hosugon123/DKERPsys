import { getAllSupplyItems, getSupplyItem, isConsumableItem } from './supplyCatalog';
import { num, soldFromRow, aggregateStallKpis, roundProcurementQty, isStallRemainEntryValid } from './stallMath';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  listOrdersWithStallCountCompleted,
  listAllMergedOrdersFromStores,
  effectiveOrderDateYmd,
  readMergedOrderByIdFromStores,
  resolveOrderDataScopeId,
  setOrderStallCountStamp,
  stallCountSnapshotPersistedMatches,
  type OrderHistoryEntry,
} from './orderHistoryStorage';
import { HQ_SCOPE_ID, getDataScopeContext } from './dataScope';
import {
  bareYmdFromStallStorageKey,
  isLegacyBareStallDateKey,
  resolveOrderStallStorageScopeId,
  resolveStallStorageScopeId,
  scopedStallDateKey,
  stallStorageKeyMatchesScope,
} from './scopedStallDateKey';
import {
  getSalesRecord,
  applySalesRecordOrderDeduction,
  mergeSalesRecordWithCatalog,
  saveSalesRecord,
  type SalesRecordDaySnapshot,
} from './salesRecordStorage';
import { ymdDashToSlash } from './dateDisplay';
import { getSessionActorDisplayName } from './sessionActorDisplayName';

const KEY = 'dongshan_stall_inventory_v1';

export type DayLine = {
  out: string;
  remain: string;
  updatedAt?: string;
};

export type DaySnapshot = {
  lines: Record<string, DayLine>;
  actualRevenue: string;
  updatedAt: string;
  /** 與帳面／盤點推算之落差金額（自填） */
  revenueGapAmount?: string;
  /** 落差原因 */
  revenueGapReason?: string;
  /** 最近一次儲存攤上盤點表之操作者姓名 */
  lastSavedByName?: string;
  /** Internal merge timestamps for top-level editable fields. */
  fieldUpdatedAt?: Record<string, string>;
};

type StoreV1 = {
  version: 1;
  byDate: Record<string, DaySnapshot>;
};

export function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysYmd(ymdStr: string, delta: number) {
  const d = parseYmd(ymdStr);
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

function emptyDay(): DaySnapshot {
  const lines: Record<string, DayLine> = {};
  for (const it of getAllSupplyItems()) {
    lines[it.id] = { out: '', remain: '' };
  }
  return { lines, actualRevenue: '', revenueGapAmount: '0', updatedAt: new Date().toISOString() };
}

function loadAll(): StoreV1 {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return { version: 1, byDate: {} };
    const s = JSON.parse(r) as StoreV1;
    if (!s.byDate || typeof s.byDate !== 'object') return { version: 1, byDate: {} };
    return migrateLegacyStallDayKeys(s);
  } catch {
    return { version: 1, byDate: {} };
  }
}

function migrateLegacyStallDayKeys(s: StoreV1): StoreV1 {
  const next: Record<string, DaySnapshot> = { ...s.byDate };
  for (const [key, row] of Object.entries(s.byDate)) {
    if (!isLegacyBareStallDateKey(key)) continue;
    const scoped = scopedStallDateKey(HQ_SCOPE_ID, key);
    if (!next[scoped]) next[scoped] = row;
  }
  return { version: 1, byDate: next };
}

function readStallDay(s: StoreV1, ymdStr: string, scopeId?: string): DaySnapshot | undefined {
  const scope = resolveStallStorageScopeId(scopeId);
  const scopedKey = scopedStallDateKey(scope, ymdStr);
  if (s.byDate[scopedKey]) return s.byDate[scopedKey];
  if (scope === HQ_SCOPE_ID && s.byDate[ymdStr]) return s.byDate[ymdStr];
  return undefined;
}

function writeStallDay(s: StoreV1, ymdStr: string, snap: DaySnapshot, scopeId?: string): void {
  const key = scopedStallDateKey(resolveStallStorageScopeId(scopeId), ymdStr);
  s.byDate[key] = snap;
  if (isLegacyBareStallDateKey(ymdStr) && key !== ymdStr) {
    delete s.byDate[ymdStr];
  }
}

function saveAll(s: StoreV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('stallInventoryUpdated'));
}

function dayLineRevisionKey(l: DayLine | undefined): string {
  return `${String(l?.out ?? '').trim()}\u001f${String(l?.remain ?? '').trim()}`;
}

function stampChangedDayLines(
  nextLines: DaySnapshot['lines'],
  prevLines: DaySnapshot['lines'] | undefined,
  now: string,
): DaySnapshot['lines'] {
  const stamped: DaySnapshot['lines'] = {};
  for (const [id, line] of Object.entries(nextLines)) {
    const prev = prevLines?.[id];
    const unchanged = prev && dayLineRevisionKey(prev) === dayLineRevisionKey(line);
    stamped[id] = {
      ...line,
      updatedAt: unchanged ? prev.updatedAt ?? now : now,
    };
  }
  return stamped;
}

function stampChangedDayFields(
  next: DaySnapshot,
  prev: DaySnapshot | undefined,
  now: string,
): Record<string, string> {
  const out = { ...(prev?.fieldUpdatedAt ?? {}) };
  for (const field of ['actualRevenue', 'revenueGapAmount', 'revenueGapReason'] as const) {
    const changed = String(next[field] ?? '').trim() !== String(prev?.[field] ?? '').trim();
    if (changed || !out[field]) out[field] = changed ? now : prev?.fieldUpdatedAt?.[field] ?? now;
  }
  return out;
}

/**
 * 合併目前目錄中新增之品項欄位（帶出／剩餘空列），讓攤上盤點與品項變更連動
 */
function mergeDayWithCurrentCatalog(snap: DaySnapshot): DaySnapshot {
  const lines: DaySnapshot['lines'] = { ...snap.lines };
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  const gapAmt = (snap.revenueGapAmount ?? '').trim();
  return {
    ...snap,
    lines,
    revenueGapAmount: gapAmt === '' ? '0' : snap.revenueGapAmount,
  };
}

export function loadDay(ymdStr: string, scopeId?: string): DaySnapshot {
  const s = loadAll();
  const base = readStallDay(s, ymdStr, scopeId) ?? emptyDay();
  return mergeDayWithCurrentCatalog(base);
}

/** 比對攤上盤點表是否與基準不同（用於未儲存工作偵測）。 */
export function stallDaySnapshotFingerprint(snap: DaySnapshot): string {
  const lineKeys = Object.keys(snap.lines).sort();
  const lines = lineKeys
    .map((id) => {
      const l = snap.lines[id] ?? { out: '', remain: '' };
      return `${id}\t${String(l.out).trim()}\t${String(l.remain).trim()}`;
    })
    .join('\n');
  return [
    String(snap.actualRevenue ?? '').trim(),
    String(snap.revenueGapAmount ?? '').trim(),
    String(snap.revenueGapReason ?? '').trim(),
    lines,
  ].join('\n');
}

export function saveDay(ymdStr: string, snap: DaySnapshot, scopeId?: string) {
  const s = loadAll();
  const editor = getSessionActorDisplayName();
  const prev = readStallDay(s, ymdStr, scopeId);
  const now = new Date().toISOString();
  writeStallDay(
    s,
    ymdStr,
    {
      ...snap,
      lines: stampChangedDayLines(snap.lines, prev?.lines, now),
      fieldUpdatedAt: stampChangedDayFields(snap, prev, now),
      updatedAt: now,
      ...(editor ? { lastSavedByName: editor } : {}),
    },
    scopeId,
  );
  saveAll(s);
}

/** 刪除指定範圍、營業日之攤上日庫（刪單連動清理用）。 */
export function removeStallDay(ymdStr: string, scopeId?: string): boolean {
  const s = loadAll();
  const scope = resolveStallStorageScopeId(scopeId);
  const scopedKey = scopedStallDateKey(scope, ymdStr);
  let removed = false;
  if (s.byDate[scopedKey]) {
    delete s.byDate[scopedKey];
    removed = true;
  }
  if (scope === HQ_SCOPE_ID && s.byDate[ymdStr]) {
    delete s.byDate[ymdStr];
    removed = true;
  }
  if (removed) saveAll(s);
  return removed;
}

/**
 * 叫貨送出時自「盤點日」的剩餘量扣除（不會低於 0；該日尚無盤點則從空表建立欄位）。
 */
export function applyOrderDeductionToDayRemain(
  ymdStr: string,
  deductions: Record<string, number>,
  scopeId?: string,
) {
  const s = loadAll();
  const prev = readStallDay(s, ymdStr, scopeId) ?? emptyDay();
  const lines = { ...prev.lines } as DaySnapshot['lines'];
  const now = new Date().toISOString();
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  for (const [id, rawQty] of Object.entries(deductions)) {
    const qty = roundProcurementQty(Number(rawQty) || 0);
    if (qty <= 0) continue;
    if (!lines[id]) lines[id] = { out: '', remain: '' };
    const cur = num(lines[id].remain);
    const next = roundProcurementQty(Math.max(0, cur - qty));
    lines[id] = { ...lines[id], remain: String(next), updatedAt: now };
  }
  const snap: DaySnapshot = {
    ...prev,
    lines,
    updatedAt: now,
  };
  saveDay(ymdStr, snap, scopeId);
  applySalesRecordOrderDeduction(ymdStr, deductions, scopeId);
}

/**
 * 批貨、扣庫與參攤上「剩餘」讀取用：若該盤點日已有「銷售紀錄」（盤點完成），
 * **收攤剩餘 (remain)** 以銷售紀錄為準（送單扣庫會與攤上同步寫入），**帶出、實收** 仍以攤上即時資料為準。
 * 若銷售紀錄誤為 0 但攤上日庫仍有餘，以攤上為準（修復雲端同步或舊資料不一致）。
 */
function resolveMergedRemainForProcurement(wRemain: string, sRemain: string): string {
  const wValid = isStallRemainEntryValid(wRemain);
  const sValid = isStallRemainEntryValid(sRemain);
  if (sValid && !(num(sRemain) === 0 && wValid && num(wRemain) > 0)) {
    return sRemain;
  }
  if (wValid) return wRemain;
  if (sValid) return sRemain;
  return sRemain;
}

export function loadDayForProcurement(ymdStr: string, scopeId?: string): DaySnapshot {
  const scope = resolveStallStorageScopeId(scopeId);
  const work = loadDay(ymdStr, scope);
  const sales = getSalesRecord(ymdStr, scope);
  if (!sales) return work;
  const lines: DaySnapshot['lines'] = { ...work.lines };
  for (const it of getAllSupplyItems()) {
    const w = work.lines[it.id] ?? { out: '', remain: '' };
    const s = sales.lines[it.id] ?? { out: '', remain: '' };
    lines[it.id] = { out: w.out, remain: resolveMergedRemainForProcurement(w.remain ?? '', s.remain ?? '') };
  }
  return { ...work, lines };
}

/**
 * 批貨扣庫：以參考訂單之**盤點曆法日**即時合併讀法為準（`loadDayForProcurement`）；
 * 收攤剩餘以銷售紀錄為準，可反映後續叫貨扣庫；若該日尚無銷售紀錄則退訂單內嵌快照。
 */
export function loadDayForProcurementFromOrder(orderId: string): DaySnapshot {
  if (!orderId) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const o = findOrderByIdInStores(orderId);
  if (!o) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const scopeId = resolveOrderStallStorageScopeId(o);
  if (o.stallCountBasisYmd) {
    const live = loadDayForProcurement(o.stallCountBasisYmd, scopeId);
    if (getSalesRecord(o.stallCountBasisYmd, scopeId)) {
      return live;
    }
  }
  if (o.stallCountSnapshot) {
    const merged = mergeSalesRecordWithCatalog(o.stallCountSnapshot);
    const lines: DaySnapshot['lines'] = { ...merged.lines };
    for (const it of getAllSupplyItems()) {
      if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
    }
    return mergeDayWithCurrentCatalog({
      lines,
      actualRevenue: merged.actualRevenue,
      updatedAt: merged.updatedAt,
      revenueGapAmount: merged.revenueGapAmount,
      revenueGapReason: merged.revenueGapReason,
    });
  }
  if (o.stallCountBasisYmd) {
    return loadDayForProcurement(o.stallCountBasisYmd, scopeId);
  }
  return mergeDayWithCurrentCatalog(emptyDay());
}

/**
 * 批貨頁「所選盤點單帳上售出」顯示用：以訂單凍結盤點快照為準（與銷售紀錄一致），
 * 不讀後續叫貨扣庫後的即時 remain。扣庫計算仍用 {@link loadDayForProcurementFromOrder}。
 */
export function loadStallSalesDisplayFromBasisOrder(orderId: string): DaySnapshot {
  if (!orderId) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const o = findOrderByIdInStores(orderId);
  if (!o) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  if (o.stallCountSnapshot) {
    const merged = mergeSalesRecordWithCatalog(o.stallCountSnapshot);
    const lines: DaySnapshot['lines'] = { ...merged.lines };
    for (const it of getAllSupplyItems()) {
      if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
    }
    return mergeDayWithCurrentCatalog({
      lines,
      actualRevenue: merged.actualRevenue,
      updatedAt: merged.updatedAt,
      revenueGapAmount: merged.revenueGapAmount,
      revenueGapReason: merged.revenueGapReason,
    });
  }
  if (o.stallCountBasisYmd) {
    const scopeId = resolveOrderStallStorageScopeId(o);
    const day = getSalesRecord(o.stallCountBasisYmd, scopeId);
    if (day) {
      return loadDayForProcurement(o.stallCountBasisYmd, scopeId);
    }
  }
  return loadDayForProcurementFromOrder(orderId);
}

function frozenLineHasLedgerQty(line: { out: string; remain: string } | undefined): boolean {
  if (!line) return false;
  if (num(line.out) > 0) return true;
  return isStallRemainEntryValid(line.remain) && num(line.remain) > 0;
}

function resolveFrozenLineForItem(
  snap: DaySnapshot,
  productId: string,
): { out: string; remain: string } {
  const direct = snap.lines[productId];
  if (frozenLineHasLedgerQty(direct)) {
    return direct!;
  }
  const item = getSupplyItem(productId);
  if (item) {
    for (const [key, line] of Object.entries(snap.lines)) {
      if (key === productId) continue;
      if (key === item.name && frozenLineHasLedgerQty(line)) {
        return line;
      }
      const keyed = getSupplyItem(key);
      if (keyed?.name === item.name && frozenLineHasLedgerQty(line)) {
        return line;
      }
    }
  }
  return direct ?? { out: '', remain: '' };
}

/** 快照是否含可讀之帳上售出／剩餘（非僅目錄合併空列）。 */
function orderHasUsableStallCountSnapshot(o: OrderHistoryEntry | null): boolean {
  if (!o?.stallCountSnapshot) return false;
  const merged = mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  const lines: DaySnapshot['lines'] = { ...merged.lines };
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  const frozen = mergeDayWithCurrentCatalog({
    lines,
    actualRevenue: merged.actualRevenue,
    updatedAt: merged.updatedAt,
    revenueGapAmount: merged.revenueGapAmount,
    revenueGapReason: merged.revenueGapReason,
  });
  for (const it of getAllSupplyItems()) {
    if (frozenLineHasLedgerQty(resolveFrozenLineForItem(frozen, it.id))) return true;
  }
  return false;
}

function frozenRemainQtyForItem(snap: DaySnapshot, productId: string): number {
  const line = resolveFrozenLineForItem(snap, productId);
  if (!isStallRemainEntryValid(line.remain)) return 0;
  return roundProcurementQty(Math.max(0, num(line.remain)));
}

function resolveOrderLineProductId(line: { productId: string; name?: string }): string {
  if (getSupplyItem(line.productId)) return line.productId;
  const byName = getAllSupplyItems().find((i) => i.name === line.name);
  if (byName) return byName.id;
  const byIdName = getSupplyItem(line.productId);
  if (byIdName) return line.productId;
  return line.productId;
}

/**
 * 批貨「扣盤點剩」用：與帳上售出（凍結快照）一致，再扣掉已針對此參考單送出的扣庫量。
 * 即時銷售紀錄若有填剩餘且較小，則以即時為準（反映後續扣庫）。
 */
export function loadBasisOrderRemainForProcurementDeduction(orderId: string): DaySnapshot {
  if (!orderId) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const basisOrder = findOrderByIdInStores(orderId);
  const live = loadDayForProcurementFromOrder(orderId);
  const frozen = loadStallSalesDisplayFromBasisOrder(orderId);
  const deducted = totalRemainDeductedAgainstBasisOrder(orderId);
  const hasSnapshot = orderHasUsableStallCountSnapshot(basisOrder);
  const lines: DaySnapshot['lines'] = { ...live.lines };
  for (const it of getAllSupplyItems()) {
    const liveLine = live.lines[it.id] ?? { out: '', remain: '' };
    const frozenLine = resolveFrozenLineForItem(frozen, it.id);
    const liveRemainRaw = liveLine.remain ?? '';
    const liveR = isStallRemainEntryValid(liveRemainRaw)
      ? roundProcurementQty(num(liveRemainRaw))
      : 0;
    const poolRemain = roundProcurementQty(
      Math.max(0, frozenRemainQtyForItem(frozen, it.id) - (deducted[it.id] ?? 0)),
    );

    let effective = poolRemain;
    if (hasSnapshot) {
      effective = poolRemain;
    } else if (liveR > 0) {
      effective = liveR;
    } else if (!isStallRemainEntryValid(liveRemainRaw) && poolRemain > 0) {
      effective = poolRemain;
    }

    lines[it.id] = {
      ...(lines[it.id] ?? liveLine),
      out: frozenLine.out || liveLine.out || '',
      remain: String(effective),
    };
  }
  return mergeDayWithCurrentCatalog({ ...live, lines });
}

/** 已針對參考單送出之叫貨量合計（依 procurementDeductionBasisOrderId 彙總）。 */
export function sumProcurementQtyAgainstBasisOrder(basisOrderId: string): Record<string, number> {
  const sums: Record<string, number> = {};
  const target = basisOrderId.trim();
  if (!target) return sums;
  for (const o of listAllMergedOrdersFromStores()) {
    if (o.procurementDeductionBasisOrderId?.trim() !== target) continue;
    if (o.status === '已取消') continue;
    for (const line of o.lines) {
      const q = roundProcurementQty(Number(line.qty) || 0);
      if (q <= 0) continue;
      sums[line.productId] = roundProcurementQty((sums[line.productId] ?? 0) + q);
    }
  }
  return sums;
}

/**
 * 叫貨送出時自參考單剩餘扣庫：每品項最多扣至目前可扣餘額（不會超扣）。
 */
export function buildProcurementRemainDeductionsFromLines(
  basisOrderId: string,
  lines: { productId: string; qty: number }[],
): Record<string, number> {
  const basis = loadBasisOrderRemainForProcurementDeduction(basisOrderId);
  const out: Record<string, number> = {};
  for (const line of lines) {
    const qty = roundProcurementQty(Number(line.qty) || 0);
    if (qty <= 0) continue;
    const cur = roundProcurementQty(Math.max(0, num(basis.lines[line.productId]?.remain)));
    const deduct = roundProcurementQty(Math.min(qty, cur));
    if (deduct > 0) out[line.productId] = deduct;
  }
  return out;
}

function totalRemainDeductedAgainstBasisOrder(
  basisOrderId: string,
  excludeOrderId?: string,
): Record<string, number> {
  const basisOrder = findOrderByIdInStores(basisOrderId);
  const basisScope = basisOrder ? resolveOrderStallStorageScopeId(basisOrder) : '';
  const frozen = loadStallSalesDisplayFromBasisOrder(basisOrderId);
  const pool: Record<string, number> = {};
  for (const it of getAllSupplyItems()) {
    pool[it.id] = frozenRemainQtyForItem(frozen, it.id);
  }
  const orders = listAllMergedOrdersFromStores()
    .filter(
      (o) =>
        o.id !== basisOrderId.trim() &&
        o.procurementDeductionBasisOrderId?.trim() === basisOrderId.trim() &&
        o.status !== '已取消' &&
        (!basisScope || resolveOrderStallStorageScopeId(o) === basisScope),
    )
    .filter((o) => !excludeOrderId || o.id !== excludeOrderId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const deducted: Record<string, number> = {};
  for (const o of orders) {
    for (const line of o.lines) {
      const productId = resolveOrderLineProductId(line);
      const qty = roundProcurementQty(Number(line.qty) || 0);
      if (qty <= 0) continue;
      const avail = pool[productId] ?? 0;
      const d = roundProcurementQty(Math.min(qty, avail));
      if (d <= 0) continue;
      deducted[productId] = roundProcurementQty((deducted[productId] ?? 0) + d);
      pool[productId] = roundProcurementQty(Math.max(0, avail - d));
    }
  }
  return deducted;
}

function prevRemainForBringOut(
  order: OrderHistoryEntry,
  prevDay: DaySnapshot,
  productId: string,
  orderQty: number,
): number {
  if (!procurementOrderChainsPriorStallRemain(order)) {
    return roundProcurementQty(Math.max(0, num(prevDay.lines[productId]?.remain)));
  }
  const live = roundProcurementQty(Math.max(0, num(prevDay.lines[productId]?.remain)));
  if (live > 0) return live;
  const bid = order.procurementDeductionBasisOrderId!.trim();
  const frozen = loadStallSalesDisplayFromBasisOrder(bid);
  const frozenR = frozenRemainQtyForItem(frozen, productId);
  const deductedBefore = totalRemainDeductedAgainstBasisOrder(bid, order.id)[productId] ?? 0;
  const poolAtOrder = roundProcurementQty(Math.max(0, frozenR - deductedBefore));
  return roundProcurementQty(Math.max(0, Math.min(orderQty, poolAtOrder)));
}

/** 寫入扣庫時使用的攤上儲存鍵＝該筆盤點之曆法盤點日 */
export function getOrderStallCountBasisYmdForDeduction(orderId: string): string | null {
  if (!orderId) return null;
  const o = findOrderByIdInStores(orderId);
  return o?.stallCountBasisYmd ?? null;
}

function findOrderByIdInStores(orderId: string): OrderHistoryEntry | null {
  const merged = readMergedOrderByIdFromStores(orderId);
  if (!merged) return null;
  return 'actorRole' in merged
    ? merged
    : {
        id: merged.id,
        createdAt: merged.createdAt,
        orderDateYmd: merged.orderDateYmd,
        updatedAt: merged.updatedAt ?? merged.createdAt,
        source: merged.source,
        totalAmount: merged.totalAmount,
        payableAmount: merged.payableAmount ?? merged.totalAmount,
        selfSuppliedCostAmount: merged.selfSuppliedCostAmount ?? 0,
        itemCount: merged.itemCount,
        lines: merged.lines,
        storeLabel: merged.storeLabel,
        status: merged.status,
        actorRole: 'admin',
        scopeId: merged.scopeId,
        actorUserId: merged.actorUserId,
        createdByName: merged.createdByName,
        stallCountCompletedByName: merged.stallCountCompletedByName,
        stallCountCompletedByUserId: merged.stallCountCompletedByUserId,
        lastUpdatedByName: merged.lastUpdatedByName,
        stallCountBasisYmd: merged.stallCountBasisYmd,
        stallCountCompletedAt: merged.stallCountCompletedAt,
        stallCountSnapshot: merged.stallCountSnapshot,
        procurementDeductionBasisOrderId: merged.procurementDeductionBasisOrderId,
      };
}

/**
 * 是否於叫貨送出時選了「欲扣除餘貨的訂單」。
 * 未選（`''`）或舊單無此欄（`undefined`）時，盤點「植入訂單」不併入參考剩餘。
 */
function procurementOrderChainsPriorStallRemain(o: { procurementDeductionBasisOrderId?: string }): boolean {
  const raw = o.procurementDeductionBasisOrderId;
  if (raw === undefined) return false;
  return raw.trim() !== '';
}

/**
 * 與批貨頁「昨日剩貨」一致之剩餘來源，供植入帳上「帶出」：
 * - 有選扣庫參考單：該單盤點日之即時收攤剩餘（銷售紀錄，已反映叫貨扣庫）。
 * - 未指定或舊單無欄位：不併入剩餘。
 */
function loadRemainSnapshotForProcurementBringOut(
  o: {
    procurementDeductionBasisOrderId?: string;
    orderDateYmd?: string;
    createdAt: string;
    scopeId?: string;
    actorUserId?: string;
  },
  _stallYmd: string,
  _scopeId: string,
): DaySnapshot {
  if (!procurementOrderChainsPriorStallRemain(o)) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const bid = o.procurementDeductionBasisOrderId!.trim();
  return loadDayForProcurementFromOrder(bid);
}

/**
 * 訂單管理明細：顯示「剩餘貨量（參考）」用。與 {@link loadRemainSnapshotForProcurementBringOut} 語意一致，
 * 唯舊單改以**訂單歸屬日**之前一日收攤剩餘近似（因明細頁無盤點曆法日）。
 */
export function loadRemainSnapshotForOrderManagementDisplay(o: {
  procurementDeductionBasisOrderId?: string;
  orderDateYmd?: string;
  createdAt: string;
  scopeId?: string;
  actorUserId?: string;
}): DaySnapshot {
  if (!procurementOrderChainsPriorStallRemain(o)) {
    return mergeDayWithCurrentCatalog(emptyDay());
  }
  const bid = o.procurementDeductionBasisOrderId!.trim();
  return loadDayForProcurementFromOrder(bid);
}

export type StallOutCarryRemainSource =
  | { kind: 'calendar_prev_day'; prevYmd: string }
  | { kind: 'basis_order'; orderId: string };

/**
 * 依所選**單一訂單**帶出叫貨量、並依扣庫參考（或舊制前一日曆法剩餘）重寫各品「帶出」。
 * 帶出[品] ＝ **參考剩餘** ＋ **該筆**訂單內同品訂量合計（消耗品訂量不計入加總，但剩餘仍可反應於帶出）。
 * @param opts.clearRemain 盤上「植入訂單」時設為 true，重算帶出後一併將**剩餘貨量**欄全數清零；揀貨／訂單同步重算則不傳。
 */
export function recomputeStallOutForStallYmdAndOrder(
  stallYmd: string,
  orderId: string,
  editorSnap?: DaySnapshot,
  opts?: { clearRemain?: boolean; persist?: boolean }
): DaySnapshot {
  const o = findOrderByIdInStores(orderId);
  const scopeId = o ? resolveOrderStallStorageScopeId(o) : resolveStallStorageScopeId();
  if (!o || o.status === '已取消') {
    return loadDay(stallYmd, scopeId);
  }
  const sumBy: Record<string, number> = {};
  for (const l of o.lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    sumBy[l.productId] = roundProcurementQty((sumBy[l.productId] || 0) + q);
  }
  const prevDay = loadRemainSnapshotForProcurementBringOut(o, stallYmd, scopeId);
  const fromStorage = loadDay(stallYmd, scopeId);
  const base: DaySnapshot = editorSnap
    ? {
        ...fromStorage,
        ...editorSnap,
        actualRevenue: editorSnap.actualRevenue ?? fromStorage.actualRevenue,
        lines: { ...fromStorage.lines, ...editorSnap.lines },
        updatedAt: editorSnap.updatedAt ?? fromStorage.updatedAt,
      }
    : fromStorage;
  const snap = mergeDayWithCurrentCatalog(base);
  const clearRemain = Boolean(opts?.clearRemain);
  const lines: DaySnapshot['lines'] = { ...snap.lines };
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
    const item = getSupplyItem(it.id);
    const orderQty = item && isConsumableItem(item) ? 0 : (sumBy[it.id] ?? 0);
    const R = prevRemainForBringOut(o, prevDay, it.id, orderQty);
    const sum = orderQty;
    const nextOut = roundProcurementQty(R + sum);
    const nextRemain = clearRemain ? '' : (lines[it.id].remain ?? '');
    lines[it.id] = { out: String(nextOut), remain: nextRemain };
  }
  const nextSnap = { ...snap, lines };
  if (opts?.persist === false) return nextSnap;
  saveDay(stallYmd, nextSnap, scopeId);
  return loadDay(stallYmd, scopeId);
}

/** 盤點頁「植入訂單」公式之逐品明細（不含消耗品，與攤上盤點表一致） */
export type StallOutImportBreakdownRow = {
  productId: string;
  name: string;
  orderQty: number;
  /** 參考剩餘（舊制：前一日曆法；新制：扣庫參考訂單帳上剩餘） */
  prevRemain: number;
  /** 前項＋本單叫貨；等同按「植入訂單」寫入之實際帶出 */
  suggestedOut: number;
};

/**
 * 依盤點曆法日與所選叫貨單，列出「參考剩餘 + 本單叫貨 = 實際帶出」。
 * 與 {@link recomputeStallOutForStallYmdAndOrder} 計算一致；單據無效時回傳 null。
 */
export function computeStallOutImportBreakdown(
  stallYmd: string,
  orderId: string,
): {
  carrySource: StallOutCarryRemainSource | null;
  rows: StallOutImportBreakdownRow[];
  chainsPriorStallRemain: boolean;
} | null {
  const o = findOrderByIdInStores(orderId);
  if (!o || o.status === '已取消') return null;
  const scopeId = resolveOrderStallStorageScopeId(o);
  const chainsPriorStallRemain = procurementOrderChainsPriorStallRemain(o);
  const sumBy: Record<string, number> = {};
  for (const l of o.lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    sumBy[l.productId] = roundProcurementQty((sumBy[l.productId] || 0) + q);
  }
  const prevDay = loadRemainSnapshotForProcurementBringOut(o, stallYmd, scopeId);

  let carrySource: StallOutCarryRemainSource | null = null;
  if (chainsPriorStallRemain) {
    const bid = o.procurementDeductionBasisOrderId?.trim();
    if (bid) {
      carrySource = { kind: 'basis_order', orderId: bid };
    }
  }

  const rows: StallOutImportBreakdownRow[] = [];
  for (const it of getAllSupplyItems()) {
    const item = getSupplyItem(it.id);
    if (item && isConsumableItem(item)) continue;
    const orderQty = sumBy[it.id] ?? 0;
    const R = prevRemainForBringOut(o, prevDay, it.id, orderQty);
    const suggestedOut = roundProcurementQty(R + orderQty);
    if (orderQty <= 0 && R <= 0) continue;
    rows.push({
      productId: it.id,
      name: it.name,
      orderQty,
      prevRemain: R,
      suggestedOut,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return { carrySource, rows, chainsPriorStallRemain };
}

/**
 * 訂單變更後，以該單單筆帶出量重算其**建立曆法日**之攤上「帶出」。
 * 用於揀貨儲存、或訂單狀態變更後，使帳上與該筆單一致。
 */
export function recomputeStallOutForOrderId(orderId: string) {
  const o = findOrderByIdInStores(orderId);
  if (!o) return;
  recomputeStallOutForStallYmdAndOrder(effectiveOrderDateYmd(o), orderId);
}

/**
 * 訂單叫貨量變更後：依訂單歸屬日重算攤上「帶出」（尚未盤點押記時）。
 * 避免先植入、後改貨量，完成盤點時快照仍為舊帶出／舊剩餘。
 */
export function syncStallOutAfterOrderLinesChanged(orderId: string): void {
  const o = findOrderByIdInStores(orderId);
  if (!o || o.status === '已取消') return;
  if (o.stallCountCompletedAt?.trim()) return;
  const bookYmd = effectiveOrderDateYmd(o);
  if (!bookYmd) return;
  recomputeStallOutForStallYmdAndOrder(bookYmd, orderId);
}

/**
 * 已盤點訂單調整快照後：同步寫入該盤點日之銷售紀錄與攤上日庫，
 * 使 `loadDayForProcurement(basisYmd)` 與次日批貨扣庫讀法一致。
 */
export function syncBasisDayFromOrderSnapshot(orderId: string): void {
  const o = findOrderByIdInStores(orderId);
  const basisYmd = o?.stallCountBasisYmd?.trim();
  const snap = o?.stallCountSnapshot;
  if (!o || !basisYmd || !snap) return;

  const merged = mergeSalesRecordWithCatalog(snap as SalesRecordDaySnapshot);
  const scopeId = resolveOrderStallStorageScopeId(o);
  saveSalesRecord(
    basisYmd,
    {
      lines: merged.lines,
      actualRevenue: merged.actualRevenue,
      updatedAt: merged.updatedAt,
      revenueGapAmount: merged.revenueGapAmount,
      revenueGapReason: merged.revenueGapReason,
      frozenRetailUnitPriceByItem: merged.frozenRetailUnitPriceByItem,
      frozenWholesaleUnitPriceByItem: merged.frozenWholesaleUnitPriceByItem,
    },
    scopeId,
  );

  const work = loadDay(basisYmd, scopeId);
  saveDay(
    basisYmd,
    {
    ...work,
    lines: merged.lines,
    actualRevenue: merged.actualRevenue ?? work.actualRevenue,
    revenueGapAmount: merged.revenueGapAmount ?? work.revenueGapAmount,
    revenueGapReason: merged.revenueGapReason ?? work.revenueGapReason,
    updatedAt: merged.updatedAt,
    },
    scopeId,
  );
}

export type CommitStallInventoryCompleteResult =
  | { ok: true }
  | { ok: false; reason: 'order_not_found' | 'stamp_failed' | 'persist_mismatch' };

/**
 * 盤點完成一次寫入：訂單押記、攤上日、銷售紀錄（同 scope／營業日），並驗證押記已落地。
 */
export function commitStallInventoryComplete(params: {
  orderId: string;
  basisYmd: string;
  completedAt: string;
  recordSnap: SalesRecordDaySnapshot;
  stallDaySnap: DaySnapshot;
  scopeId?: string;
}): CommitStallInventoryCompleteResult {
  const { orderId, basisYmd, completedAt, recordSnap, stallDaySnap, scopeId } = params;
  if (!readMergedOrderByIdFromStores(orderId)) {
    return { ok: false, reason: 'order_not_found' };
  }
  const okStamp = setOrderStallCountStamp(orderId, {
    basisYmd,
    completedAt,
    snapshot: recordSnap,
  });
  if (!okStamp) return { ok: false, reason: 'stamp_failed' };

  saveDay(basisYmd, stallDaySnap, scopeId);
  saveSalesRecord(basisYmd, recordSnap, scopeId);

  const merged = readMergedOrderByIdFromStores(orderId);
  if (!stallCountSnapshotPersistedMatches(merged?.stallCountSnapshot, recordSnap)) {
    return { ok: false, reason: 'persist_mismatch' };
  }
  return { ok: true };
}

export type StallOrderForDateRow = {
  id: string;
  createdAt: string;
  orderDateYmd?: string;
  actorUserId?: string;
  createdByName?: string;
  stallCountCompletedByName?: string;
  stallCountCompletedByUserId?: string;
  status: '待出貨' | '已完成' | '已取消';
  totalAmount: number;
  itemCount: number;
  storeLabel: string;
  stallCountBasisYmd?: string;
  stallCountCompletedAt?: string;
};

function toStallOrderRow(
  o: {
    id: string;
    createdAt: string;
    orderDateYmd?: string;
    actorUserId?: string;
    createdByName?: string;
    stallCountCompletedByName?: string;
    stallCountCompletedByUserId?: string;
    status: '待出貨' | '已完成' | '已取消';
    totalAmount: number;
    itemCount: number;
    storeLabel: string;
    stallCountBasisYmd?: string;
    stallCountCompletedAt?: string;
  }
): StallOrderForDateRow {
  return {
    id: o.id,
    createdAt: o.createdAt,
    orderDateYmd: o.orderDateYmd,
    actorUserId: o.actorUserId,
    createdByName: o.createdByName,
    stallCountCompletedByName: o.stallCountCompletedByName,
    stallCountCompletedByUserId: o.stallCountCompletedByUserId,
    status: o.status,
    totalAmount: o.totalAmount,
    itemCount: o.itemCount,
    storeLabel: o.storeLabel,
    stallCountBasisYmd: o.stallCountBasisYmd,
    stallCountCompletedAt: o.stallCountCompletedAt,
  };
}

/** 盤點／植入訂單選單：僅保留「目前帳號所屬 scope」之訂單（不因管理員身分放寬）。 */
function filterStallOrderRowsForSessionScope(rows: StallOrderForDateRow[]): StallOrderForDateRow[] {
  const ctx = getDataScopeContext();
  const metaById = new Map<string, Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>>();
  for (const o of loadFranchiseManagementOrders()) {
    metaById.set(o.id, { scopeId: o.scopeId, actorUserId: o.actorUserId });
  }
  for (const o of loadOrderHistory()) {
    metaById.set(o.id, { scopeId: o.scopeId, actorUserId: o.actorUserId });
  }
  return rows.filter((r) => {
    const meta = metaById.get(r.id);
    if (!meta) return false;
    const orderScope = resolveOrderDataScopeId(meta);
    return Boolean(orderScope && orderScope === ctx.scopeId);
  });
}

/**
 * 盤點日與**訂單建立**日相同之**已出貨（已完成）**叫貨單。
 */
export function listProcurementOrdersForStallDate(stallYmd: string): StallOrderForDateRow[] {
  const out: StallOrderForDateRow[] = [];
  for (const o of loadFranchiseManagementOrders()) {
    if (o.status !== '已完成') continue;
    if (effectiveOrderDateYmd(o) !== stallYmd) continue;
    out.push(toStallOrderRow(o));
  }
  for (const o of loadOrderHistory()) {
    if (o.status !== '已完成') continue;
    if (effectiveOrderDateYmd(o) !== stallYmd) continue;
    out.push(toStallOrderRow(o));
  }
  return filterStallOrderRowsForSessionScope(out).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/**
 * 訂單**建立**日落在以 anchor 為終點、往前提煉一連續 n 個曆法日內之叫貨（n≥1）；
 * **僅狀態「已完成」（畫面即已出貨）** 可入選，待出貨／已取消不列出。
 */
export function listProcurementOrdersInLastNDays(anchorYmd: string, daySpan: number): StallOrderForDateRow[] {
  const span = Math.max(1, Math.floor(daySpan) || 1);
  const from = addDaysYmd(anchorYmd, -(span - 1));
  const to = anchorYmd;
  const inWindow = (o: { orderDateYmd?: string; createdAt: string }) => {
    const d = effectiveOrderDateYmd(o);
    return d >= from && d <= to;
  };
  const out: StallOrderForDateRow[] = [];
  for (const o of loadFranchiseManagementOrders()) {
    if (o.status !== '已完成') continue;
    if (!inWindow(o)) continue;
    out.push(toStallOrderRow(o));
  }
  for (const o of loadOrderHistory()) {
    if (o.status !== '已完成') continue;
    if (!inWindow(o)) continue;
    out.push(toStallOrderRow(o));
  }
  return filterStallOrderRowsForSessionScope(out).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/**
 * 攤上盤點選單：目前登入身分可讀取範圍內，「已出貨且尚未盤點完成」之全部訂單（不限訂單日）。
 * 用於同店多單逐筆完成盤點，不再受盤點日區間限制。
 */
export function listUncountedCompletedProcurementOrdersForSession(): StallOrderForDateRow[] {
  const out: StallOrderForDateRow[] = [];
  for (const o of loadFranchiseManagementOrders()) {
    if (o.status !== '已完成') continue;
    if (o.stallCountCompletedAt?.trim()) continue;
    out.push(toStallOrderRow(o));
  }
  for (const o of loadOrderHistory()) {
    if (o.status !== '已完成') continue;
    if (o.stallCountCompletedAt?.trim()) continue;
    out.push(toStallOrderRow(o));
  }
  return filterStallOrderRowsForSessionScope(out).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/**
 * 訂單**建立**日落在「盤點日起往前連續 5 個曆法日（含盤點日當天）」內的未取消叫貨，供參考選單用。
 * 即 `addDays(anchor, -4) … anchor` 與 ymd(createdAt) 字串比較之區間（含界）。
 */
export function listProcurementOrdersInLast5Days(anchorYmd: string): StallOrderForDateRow[] {
  return listProcurementOrdersInLastNDays(anchorYmd, 5);
}

export function listDateKeys(scopeId?: string) {
  const scope = resolveStallStorageScopeId(scopeId);
  return Object.keys(loadAll().byDate)
    .filter((k) => stallStorageKeyMatchesScope(k, scope))
    .map((k) => bareYmdFromStallStorageKey(k))
    .sort();
}

const PREF_STALL_BASIS = 'dongshan_procurement_stall_basis_ymd';
const PREF_PROCUREMENT_BASIS_ORDER = 'dongshan_procurement_stall_basis_order_id';

/** 自新到舊的已儲存盤點日＋寫入時間（供歷程與下單選用；回傳曆法日，非 storage key）。 */
export function listSavedStallDaysWithMeta(scopeId?: string): { ymd: string; updatedAt: string }[] {
  const scope = resolveStallStorageScopeId(scopeId);
  const s = loadAll();
  const byYmd = new Map<string, string>();
  for (const [storageKey, row] of Object.entries(s.byDate)) {
    if (!stallStorageKeyMatchesScope(storageKey, scope)) continue;
    const dayYmd = bareYmdFromStallStorageKey(storageKey);
    const prev = byYmd.get(dayYmd);
    const cur = row.updatedAt || '';
    if (!prev || cur > prev) byYmd.set(dayYmd, cur);
  }
  return Array.from(byYmd.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ymd, updatedAt]) => ({ ymd, updatedAt }));
}

/**
 * 批貨頁可選的「盤點基準日」清單：含所有已儲存日＋日曆今日（未儲存也可選，剩餘視為 0 ／ 未填）。
 */
export function getStallBasisDateOptions(): { ymd: string; updatedAt: string; isSaved: boolean }[] {
  const cal = ymd(new Date());
  const map = new Map<string, { ymd: string; updatedAt: string; isSaved: boolean }>();
  for (const s of listSavedStallDaysWithMeta()) {
    map.set(s.ymd, { ymd: s.ymd, updatedAt: s.updatedAt, isSaved: true });
  }
  if (!map.has(cal)) {
    map.set(cal, { ymd: cal, updatedAt: '', isSaved: false });
  }
  return Array.from(map.values()).sort((a, b) => b.ymd.localeCompare(a.ymd));
}

/** 讀取使用者在批貨頁最後選的盤點日；若無則用「最新一筆已儲存」，再退回日曆今日。 */
export function getPreferredStallBasisYmd(): string {
  const keys = listDateKeys();
  const options = getStallBasisDateOptions();
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(PREF_STALL_BASIS);
  } catch {
    /* ignore */
  }
  if (remembered && options.some((o) => o.ymd === remembered)) {
    return remembered;
  }
  if (keys.length > 0) {
    return keys[keys.length - 1];
  }
  return ymd(new Date());
}

export function setPreferredStallBasisYmd(ymdStr: string) {
  try {
    localStorage.setItem(PREF_STALL_BASIS, ymdStr);
  } catch {
    /* ignore */
  }
}

/** 批貨頁最後選的「欲扣除餘貨的訂單」；預設不指定，僅還原使用者曾明確選過的單號。 */
export function getPreferredProcurementBasisOrderId(): string {
  const orders = listOrdersWithStallCountCompleted();
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(PREF_PROCUREMENT_BASIS_ORDER);
  } catch {
    /* ignore */
  }
  // 明確儲存空字串＝使用者在批貨頁選「不指定」或按「清空」
  if (remembered === '' || remembered === null) return '';
  if (orders.some((o) => o.id === remembered)) {
    return remembered;
  }
  return '';
}

export function setPreferredProcurementBasisOrderId(id: string) {
  try {
    localStorage.setItem(PREF_PROCUREMENT_BASIS_ORDER, id);
  } catch {
    /* ignore */
  }
}

export function formatYmdWithWeekday(ymdStr: string) {
  const d = parseYmd(ymdStr);
  const w = d.toLocaleDateString('zh-TW', { weekday: 'long' });
  return `${ymdDashToSlash(ymdStr)}（${w}）`;
}

/** 同一星期幾的歷史「售出量」取平均，僅使用嚴格早於 asOfYmd 的日期 */
export function averageSoldSameWeekday(
  productId: string,
  asOfYmd: string,
  scopeId?: string,
): { avg: number; sampleCount: number } {
  const s = loadAll();
  const scope = resolveStallStorageScopeId(scopeId);
  const targetWd = parseYmd(asOfYmd).getDay();
  const solds: number[] = [];
  for (const storageKey of Object.keys(s.byDate).sort()) {
    if (!stallStorageKeyMatchesScope(storageKey, scope)) continue;
    const d = bareYmdFromStallStorageKey(storageKey);
    if (d >= asOfYmd) break;
    if (parseYmd(d).getDay() !== targetWd) continue;
    const line = s.byDate[storageKey].lines[productId];
    if (!line) continue;
    const out = num(line.out);
    const remain = num(line.remain);
    if (out === 0 && remain === 0) continue;
    solds.push(soldFromRow(out, remain));
  }
  if (solds.length === 0) return { avg: 0, sampleCount: 0 };
  const sum = solds.reduce((a, b) => a + b, 0);
  return { avg: sum / solds.length, sampleCount: solds.length };
}

/**
 * 所選「營業日」的建議帶出量（以當天凌晨視角）：
 * ＝ 與該日相同星期幾的歷史平均售出量 － 前一日庫存尾貨（前一日盤點的剩餘量）
 */
export function suggestBringForDate(productId: string, businessDayYmd: string, scopeId?: string) {
  const yPrev = addDaysYmd(businessDayYmd, -1);
  const prevSnap = loadDay(yPrev, scopeId);
  const carryRemain = num(prevSnap.lines[productId]?.remain);
  const { avg, sampleCount } = averageSoldSameWeekday(productId, businessDayYmd, scopeId);
  const raw = avg - carryRemain;
  return {
    suggest: Math.max(0, Math.round(raw * 10) / 10),
    avgSameWeekday: avg,
    sampleCount,
    carryFromYesterday: carryRemain,
  };
}

/**
 * 收攤盤點日 D 的「下一日」建議帶出量（你截圖最左欄的邏輯）：
 * ＝ 與 (D+1) 同星期幾的歷史平均售出 － 當日 D 收攤剩餘（可傳入表單尚未儲存之值）
 */
export function suggestBringAfterCloseDay(
  productId: string,
  closeDayYmd: string,
  endOfCloseDayRemain: number
) {
  const nextYmd = addDaysYmd(closeDayYmd, 1);
  const { avg, sampleCount } = averageSoldSameWeekday(productId, nextYmd);
  const raw = avg - endOfCloseDayRemain;
  return {
    nextYmd,
    suggest: Math.max(0, Math.round(raw * 10) / 10),
    avgSameWeekday: avg,
    sampleCount,
    carryFromCloseDay: endOfCloseDayRemain,
  };
}

/**
 * 以常用單的基準量，扣除某「盤點日」在攤上盤點中登錄的「剩餘」量，得到建議補貨量。
 * 每品項：max(0, 基準量 − 剩餘)。剩餘未填視為 0，故等同全數帶入常用量。
 * 盤點日通常選「本日」：用於明日實際叫貨 ≈ 固定週量 − 攤上尚餘。
 */
export function cartAfterDeductingStallRemain(
  baseQuantities: Record<string, number>,
  countDayYmd: string
): Record<string, number> {
  const day = loadDayForProcurement(countDayYmd);
  return cartAfterDeductingStallRemainFromSnapshot(baseQuantities, day);
}

/**
 * 以所選**已盤點訂單**之帳上剩餘（含內嵌快照）推算補貨量。
 */
export function cartAfterDeductingStallRemainFromOrder(
  baseQuantities: Record<string, number>,
  orderId: string
): Record<string, number> {
  const day = loadBasisOrderRemainForProcurementDeduction(orderId);
  return cartAfterDeductingStallRemainFromSnapshot(baseQuantities, day);
}

function cartAfterDeductingStallRemainFromSnapshot(
  baseQuantities: Record<string, number>,
  day: DaySnapshot
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(baseQuantities)) {
    const base = roundProcurementQty(Number(raw) || 0);
    if (base <= 0) continue;
    const remain = roundProcurementQty(Math.max(0, num(day.lines[id]?.remain)));
    const need = roundProcurementQty(Math.max(0, base - remain));
    if (need > 0) out[id] = need;
  }
  return out;
}

export function getLastKpisFromLatestDay(scopeId?: string) {
  const scope = resolveStallStorageScopeId(scopeId);
  const keys = Object.keys(loadAll().byDate)
    .filter((k) => stallStorageKeyMatchesScope(k, scope))
    .sort();
  if (keys.length === 0) return null;
  const lastKey = keys[keys.length - 1]!;
  const lastYmd = bareYmdFromStallStorageKey(lastKey);
  const day = loadDay(lastYmd, scope);
  const ids = getAllSupplyItems().map((i) => i.id);
  const split = aggregateStallKpis(
    ids,
    (id) => day.lines[id] ?? { out: '', remain: '' },
    (id) => getSupplyItem(id)
  );
  return {
    date: lastYmd,
    ...split.retail,
    consumableRef: split.consumable,
    actualRevenue: num(day.actualRevenue),
  };
}
