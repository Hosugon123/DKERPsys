import { getAllSupplyItems } from './supplyCatalog';
import { num, roundProcurementQty } from './stallMath';

/** 與 stallInventoryStorage 之 DaySnapshot 結構一致（此檔避免反向 import 造成循環） */
export type SalesRecordDayLine = { out: string; remain: string };
export type SalesRecordDaySnapshot = {
  lines: Record<string, SalesRecordDayLine>;
  actualRevenue: string;
  updatedAt: string;
};

const SALES_KEY = 'dongshan_sales_records_v1';

type Row = { completedAt: string; snapshot: SalesRecordDaySnapshot };

type StoreV1 = {
  version: 1;
  byDate: Record<string, Row>;
};

function loadStore(): StoreV1 {
  try {
    const r = localStorage.getItem(SALES_KEY);
    if (!r) return { version: 1, byDate: {} };
    return JSON.parse(r) as StoreV1;
  } catch {
    return { version: 1, byDate: {} };
  }
}

function saveStore(s: StoreV1) {
  localStorage.setItem(SALES_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('salesRecordUpdated'));
}

function mergeSnapshotWithCatalog(snap: SalesRecordDaySnapshot): SalesRecordDaySnapshot {
  const lines: Record<string, SalesRecordDayLine> = { ...snap.lines };
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  return { ...snap, lines };
}

/** 供訂單內嵌快照或畫面顯示前與品項目錄合併。 */
export function mergeSalesRecordWithCatalog(snap: SalesRecordDaySnapshot): SalesRecordDaySnapshot {
  return mergeSnapshotWithCatalog(snap);
}

/**
 * 盤點完成時寫入；覆寫同營業日之舊銷售紀錄。
 */
export function saveSalesRecord(ymd: string, snapshot: SalesRecordDaySnapshot) {
  const s = loadStore();
  const completedAt = new Date().toISOString();
  const snapshotMerged = mergeSnapshotWithCatalog(snapshot);
  s.byDate[ymd] = { completedAt, snapshot: { ...snapshotMerged, updatedAt: completedAt } };
  saveStore(s);
}

export function getSalesRecord(ymd: string): SalesRecordDaySnapshot | null {
  const s = loadStore();
  const row = s.byDate[ymd];
  if (!row) return null;
  return mergeSnapshotWithCatalog(row.snapshot);
}

/**
 * 僅在該筆訂單有「盤點完成」押記時視為已盤點。
 * （舊版曾以「訂單建立日＝盤點日之銷售紀錄」推斷，會使同日多筆訂單或僅導入頁面就誤顯示已盤點，已移除。）
 */
export function isOrderStallCountDone(
  _createdAtIso: string,
  stallCountCompletedAt?: string | null
): boolean {
  return Boolean(stallCountCompletedAt);
}

export function listSalesRecordMeta(): { ymd: string; completedAt: string }[] {
  const s = loadStore();
  return Object.keys(s.byDate)
    .sort((a, b) => b.localeCompare(a))
    .map((d) => ({ ymd: d, completedAt: s.byDate[d].completedAt }));
}

/**
 * 與攤上扣庫相同邏輯，同步更新銷售紀錄內之「剩餘」（若該日有紀錄）。
 */
export function applySalesRecordOrderDeduction(ymdStr: string, deductions: Record<string, number>) {
  const s = loadStore();
  const row = s.byDate[ymdStr];
  if (!row) return;
  const prev = mergeSnapshotWithCatalog(row.snapshot);
  const lines: SalesRecordDaySnapshot['lines'] = { ...prev.lines };
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
  const now = new Date().toISOString();
  s.byDate[ymdStr] = {
    ...row,
    snapshot: { ...prev, lines, updatedAt: now },
  };
  saveStore(s);
}
