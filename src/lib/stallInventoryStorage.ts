import { getAllSupplyItems, getSupplyItem, isConsumableItem } from './supplyCatalog';
import { num, soldFromRow, aggregateStallKpis, roundProcurementQty } from './stallMath';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  listOrdersWithStallCountCompleted,
  orderMatchesSessionScope,
  effectiveOrderDateYmd,
  type OrderHistoryEntry,
} from './orderHistoryStorage';
import { getDataScopeContext } from './dataScope';
import {
  getSalesRecord,
  applySalesRecordOrderDeduction,
  mergeSalesRecordWithCatalog,
} from './salesRecordStorage';
import { ymdDashToSlash } from './dateDisplay';
import { getSessionActorDisplayName } from './sessionActorDisplayName';

const KEY = 'dongshan_stall_inventory_v1';

export type DayLine = {
  out: string;
  remain: string;
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
  return { lines, actualRevenue: '', updatedAt: new Date().toISOString() };
}

function loadAll(): StoreV1 {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return { version: 1, byDate: {} };
    return JSON.parse(r) as StoreV1;
  } catch {
    return { version: 1, byDate: {} };
  }

}

function saveAll(s: StoreV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('stallInventoryUpdated'));
}

/**
 * 合併目前目錄中新增之品項欄位（帶出／剩餘空列），讓攤上盤點與品項變更連動
 */
function mergeDayWithCurrentCatalog(snap: DaySnapshot): DaySnapshot {
  const lines: DaySnapshot['lines'] = { ...snap.lines };
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  return { ...snap, lines };
}

export function loadDay(ymdStr: string): DaySnapshot {
  const s = loadAll();
  const base = s.byDate[ymdStr] ?? emptyDay();
  return mergeDayWithCurrentCatalog(base);
}

export function saveDay(ymdStr: string, snap: DaySnapshot) {
  const s = loadAll();
  const editor = getSessionActorDisplayName();
  s.byDate[ymdStr] = {
    ...snap,
    updatedAt: new Date().toISOString(),
    ...(editor ? { lastSavedByName: editor } : {}),
  };
  saveAll(s);
}

/**
 * 叫貨送出時自「盤點日」的剩餘量扣除（不會低於 0；該日尚無盤點則從空表建立欄位）。
 */
export function applyOrderDeductionToDayRemain(ymdStr: string, deductions: Record<string, number>) {
  const s = loadAll();
  const prev = s.byDate[ymdStr] ?? emptyDay();
  const lines = { ...prev.lines } as DaySnapshot['lines'];
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  for (const [id, rawQty] of Object.entries(deductions)) {
    const qty = roundProcurementQty(Number(rawQty) || 0);
    if (qty <= 0) continue;
    if (!lines[id]) lines[id] = { out: '', remain: '' };
    const cur = num(lines[id].remain);
    const next = roundProcurementQty(Math.max(0, cur - qty));
    lines[id] = { ...lines[id], remain: String(next) };
  }
  const snap: DaySnapshot = {
    ...prev,
    lines,
    updatedAt: new Date().toISOString(),
  };
  saveDay(ymdStr, snap);
  applySalesRecordOrderDeduction(ymdStr, deductions);
}

/**
 * 批貨、扣庫與參攤上「剩餘」讀取用：若該盤點日已有「銷售紀錄」（盤點完成），
 * **收攤剩餘 (remain)** 以銷售紀錄為準（送單扣庫會與攤上同步寫入），**帶出、實收** 仍以攤上即時資料為準。
 */
export function loadDayForProcurement(ymdStr: string): DaySnapshot {
  const work = loadDay(ymdStr);
  const sales = getSalesRecord(ymdStr);
  if (!sales) return work;
  const lines: DaySnapshot['lines'] = { ...work.lines };
  for (const it of getAllSupplyItems()) {
    const w = work.lines[it.id] ?? { out: '', remain: '' };
    const s = sales.lines[it.id] ?? { out: '', remain: '' };
    lines[it.id] = { out: w.out, remain: s.remain };
  }
  return { ...work, lines };
}

/**
 * 批貨扣庫：以「單一已盤點訂單」內嵌之盤點快照為準（帶出／剩餘、含登錄實收）；
 * 若無內嵌快照則退回首選該盤點曆法日之合併讀法（`loadDayForProcurement(stallCountBasisYmd)`）。
 */
export function loadDayForProcurementFromOrder(orderId: string): DaySnapshot {
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
    return loadDayForProcurement(o.stallCountBasisYmd);
  }
  return mergeDayWithCurrentCatalog(emptyDay());
}

/** 寫入扣庫時使用的攤上儲存鍵＝該筆盤點之曆法盤點日 */
export function getOrderStallCountBasisYmdForDeduction(orderId: string): string | null {
  if (!orderId) return null;
  const o = findOrderByIdInStores(orderId);
  return o?.stallCountBasisYmd ?? null;
}

function findOrderByIdInStores(orderId: string) {
  return (
    loadFranchiseManagementOrders().find((x) => x.id === orderId) ??
    loadOrderHistory().find((x) => x.id === orderId) ??
    null
  );
}

/**
 * 是否於叫貨送出時選了「欲扣除餘貨的訂單」。
 * 未選（`procurementDeductionBasisOrderId === ''`）時，盤點「植入訂單」不應併入前一日收攤剩餘。
 * 舊單無此欄（undefined）則維持原公式（併入前日剩餘）。
 */
function procurementOrderChainsPriorStallRemain(o: { procurementDeductionBasisOrderId?: string }): boolean {
  if (o.procurementDeductionBasisOrderId === undefined) return true;
  return o.procurementDeductionBasisOrderId.trim() !== '';
}

/**
 * 依所選**單一訂單**帶出叫貨量、並以**盤點曆法日 (stallYmd)** 決定前一日收攤剩餘，重寫各品「帶出」。
 * 帶出[品] ＝ 盤點日之前一日**收攤剩餘** ＋ **該筆**訂單內同品訂量合計（多店則一單一盤、各選各單再植入／完成）。
 * @param opts.clearRemain 盤上「植入訂單」時設為 true，重算帶出後一併將**剩餘貨量**欄全數清零；揀貨／訂單同步重算則不傳。
 */
export function recomputeStallOutForStallYmdAndOrder(
  stallYmd: string,
  orderId: string,
  editorSnap?: DaySnapshot,
  opts?: { clearRemain?: boolean }
): DaySnapshot {
  const o = findOrderByIdInStores(orderId);
  if (!o || o.status === '已取消') {
    return loadDay(stallYmd);
  }
  const sumBy: Record<string, number> = {};
  for (const l of o.lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    sumBy[l.productId] = roundProcurementQty((sumBy[l.productId] || 0) + q);
  }
  const prevYmd = addDaysYmd(stallYmd, -1);
  /** 與批貨扣庫一致：前一日若已完成盤點，剩餘以銷售紀錄為準（未選扣庫參考單之叫貨單則不併入） */
  const prevDay =
    procurementOrderChainsPriorStallRemain(o) ? loadDayForProcurement(prevYmd) : mergeDayWithCurrentCatalog(emptyDay());
  const fromStorage = loadDay(stallYmd);
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
    const R = roundProcurementQty(Math.max(0, num(prevDay.lines[it.id]?.remain)));
    const item = getSupplyItem(it.id);
    const sum =
      item && isConsumableItem(item) ? 0 : (sumBy[it.id] ?? 0);
    const nextOut = roundProcurementQty(R + sum);
    const nextRemain = clearRemain ? '' : (lines[it.id].remain ?? '');
    lines[it.id] = { out: String(nextOut), remain: nextRemain };
  }
  saveDay(stallYmd, { ...snap, lines });
  return loadDay(stallYmd);
}

/** 盤點頁「植入訂單」公式之逐品明細（不含消耗品，與攤上盤點表一致） */
export type StallOutImportBreakdownRow = {
  productId: string;
  name: string;
  orderQty: number;
  /** 盤點日前一日收攤剩餘（`loadDayForProcurement`） */
  prevRemain: number;
  /** 前項＋本單叫貨；等同按「植入訂單」寫入之實際帶出 */
  suggestedOut: number;
};

/**
 * 依盤點曆法日與所選叫貨單，列出「前日剩餘 + 本單叫貨 = 實際帶出」。
 * 與 {@link recomputeStallOutForStallYmdAndOrder} 計算一致；單據無效時回傳 null。
 */
export function computeStallOutImportBreakdown(
  stallYmd: string,
  orderId: string,
): { prevYmd: string; rows: StallOutImportBreakdownRow[]; chainsPriorStallRemain: boolean } | null {
  const o = findOrderByIdInStores(orderId);
  if (!o || o.status === '已取消') return null;
  const chainsPriorStallRemain = procurementOrderChainsPriorStallRemain(o);
  const sumBy: Record<string, number> = {};
  for (const l of o.lines) {
    const q = roundProcurementQty(Number(l.qty) || 0);
    if (q <= 0) continue;
    sumBy[l.productId] = roundProcurementQty((sumBy[l.productId] || 0) + q);
  }
  const prevYmd = addDaysYmd(stallYmd, -1);
  const prevDay = chainsPriorStallRemain ? loadDayForProcurement(prevYmd) : mergeDayWithCurrentCatalog(emptyDay());
  const rows: StallOutImportBreakdownRow[] = [];
  for (const it of getAllSupplyItems()) {
    const item = getSupplyItem(it.id);
    if (item && isConsumableItem(item)) continue;
    const R = roundProcurementQty(Math.max(0, num(prevDay.lines[it.id]?.remain)));
    const orderQty = sumBy[it.id] ?? 0;
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
  return { prevYmd, rows, chainsPriorStallRemain };
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

/** 盤點／植入訂單選單：非管理員僅保留目前資料範圍可讀取之叫貨單 */
function filterStallOrderRowsForSessionScope(rows: StallOrderForDateRow[]): StallOrderForDateRow[] {
  const ctx = getDataScopeContext();
  if (ctx.isAdmin) return rows;
  const metaById = new Map<string, Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>>();
  for (const o of loadFranchiseManagementOrders()) {
    metaById.set(o.id, { scopeId: o.scopeId, actorUserId: o.actorUserId });
  }
  for (const o of loadOrderHistory()) {
    metaById.set(o.id, { scopeId: o.scopeId, actorUserId: o.actorUserId });
  }
  return rows.filter((r) => {
    const meta = metaById.get(r.id);
    return meta ? orderMatchesSessionScope(meta) : false;
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
 * 訂單**建立**日落在「盤點日起往前連續 5 個曆法日（含盤點日當天）」內的未取消叫貨，供參考選單用。
 * 即 `addDays(anchor, -4) … anchor` 與 ymd(createdAt) 字串比較之區間（含界）。
 */
export function listProcurementOrdersInLast5Days(anchorYmd: string): StallOrderForDateRow[] {
  return listProcurementOrdersInLastNDays(anchorYmd, 5);
}

export function listDateKeys() {
  return Object.keys(loadAll().byDate).sort();
}

const PREF_STALL_BASIS = 'dongshan_procurement_stall_basis_ymd';
const PREF_PROCUREMENT_BASIS_ORDER = 'dongshan_procurement_stall_basis_order_id';

/** 自新到舊的已儲存盤點日＋寫入時間（供歷程與下單選用） */
export function listSavedStallDaysWithMeta(): { ymd: string; updatedAt: string }[] {
  const s = loadAll();
  return Object.keys(s.byDate)
    .sort((a, b) => b.localeCompare(a))
    .map((d) => ({ ymd: d, updatedAt: s.byDate[d].updatedAt || '' }));
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

/** 批貨頁最後選的「欲扣除餘貨的訂單」；若無效則取最新一筆已盤點單。 */
export function getPreferredProcurementBasisOrderId(): string {
  const orders = listOrdersWithStallCountCompleted();
  if (orders.length === 0) return '';
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(PREF_PROCUREMENT_BASIS_ORDER);
  } catch {
    /* ignore */
  }
  // 明確儲存空字串＝使用者在批貨頁按「清空」，不帶入任何扣庫參考單
  if (remembered === '') return '';
  if (remembered && orders.some((o) => o.id === remembered)) {
    return remembered;
  }
  return orders[0]!.id;
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
  asOfYmd: string
): { avg: number; sampleCount: number } {
  const s = loadAll();
  const targetWd = parseYmd(asOfYmd).getDay();
  const solds: number[] = [];
  for (const d of Object.keys(s.byDate).sort()) {
    if (d >= asOfYmd) break;
    if (parseYmd(d).getDay() !== targetWd) continue;
    const line = s.byDate[d].lines[productId];
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
export function suggestBringForDate(productId: string, businessDayYmd: string) {
  const yPrev = addDaysYmd(businessDayYmd, -1);
  const s = loadAll();
  const prevSnap = s.byDate[yPrev];
  const carryRemain = num(prevSnap?.lines[productId]?.remain);
  const { avg, sampleCount } = averageSoldSameWeekday(productId, businessDayYmd);
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
  const day = loadDayForProcurementFromOrder(orderId);
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

export function getLastKpisFromLatestDay() {
  const keys = listDateKeys();
  if (keys.length === 0) return null;
  const last = keys[keys.length - 1];
  const day = loadDay(last);
  const ids = getAllSupplyItems().map((i) => i.id);
  const split = aggregateStallKpis(
    ids,
    (id) => day.lines[id] ?? { out: '', remain: '' },
    (id) => getSupplyItem(id)
  );
  return {
    date: last,
    ...split.retail,
    consumableRef: split.consumable,
    actualRevenue: num(day.actualRevenue),
  };
}
