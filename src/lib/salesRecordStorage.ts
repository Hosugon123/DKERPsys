import { HQ_SCOPE_ID } from './dataScope';
import {
  isLegacyBareStallDateKey,
  parseScopedStallDateKey,
  resolveStallStorageScopeId,
  scopedStallDateKey,
} from './scopedStallDateKey';
import { getAllSupplyItems, getSupplyItem } from './supplyCatalog';
import { getSessionActorDisplayName } from './sessionActorDisplayName';
import { num, roundProcurementQty } from './stallMath';

/** 與 stallInventoryStorage 之 DaySnapshot 結構一致（此檔避免反向 import 造成循環） */
export type SalesRecordDayLine = { out: string; remain: string; updatedAt?: string };
export type SalesRecordDaySnapshot = {
  lines: Record<string, SalesRecordDayLine>;
  actualRevenue: string;
  updatedAt: string;
  /** 登錄實收與盤點推算之落差金額（自填，可對照參考差額） */
  revenueGapAmount?: string;
  /** 落差原因：損耗、請客、試吃等 */
  revenueGapReason?: string;
  /** 盤點完成當下凍結之零售單價（每品項，避免日後改價影響歷史） */
  frozenRetailUnitPriceByItem?: Record<string, number>;
  /** 盤點完成當下凍結之批價單價（每品項，供成本參考） */
  frozenWholesaleUnitPriceByItem?: Record<string, number>;
  /** Internal merge timestamps for top-level editable fields. */
  fieldUpdatedAt?: Record<string, string>;
};

const SALES_KEY = 'dongshan_sales_records_v1';

type Row = { completedAt: string; completedByName?: string; snapshot: SalesRecordDaySnapshot };

type StoreV1 = {
  version: 1;
  /** 鍵為 `scopeId|YYYY-MM-DD`；舊版僅 `YYYY-MM-DD` 視為總部直營。 */
  byDate: Record<string, Row>;
};

let cachedStoreRaw: string | null | undefined;
let cachedStore: StoreV1 | null = null;

function cloneSnapshot(snap: SalesRecordDaySnapshot): SalesRecordDaySnapshot {
  return {
    ...snap,
    lines: Object.fromEntries(
      Object.entries(snap.lines ?? {}).map(([id, line]) => [id, { ...line }]),
    ),
    frozenRetailUnitPriceByItem: snap.frozenRetailUnitPriceByItem
      ? { ...snap.frozenRetailUnitPriceByItem }
      : undefined,
    frozenWholesaleUnitPriceByItem: snap.frozenWholesaleUnitPriceByItem
      ? { ...snap.frozenWholesaleUnitPriceByItem }
      : undefined,
    fieldUpdatedAt: snap.fieldUpdatedAt ? { ...snap.fieldUpdatedAt } : undefined,
  };
}

function cloneStore(s: StoreV1): StoreV1 {
  const byDate: StoreV1['byDate'] = {};
  for (const [key, row] of Object.entries(s.byDate)) {
    byDate[key] = {
      completedAt: row.completedAt,
      ...(row.completedByName ? { completedByName: row.completedByName } : {}),
      snapshot: cloneSnapshot(row.snapshot),
    };
  }
  return { version: 1, byDate };
}

function loadStore(): StoreV1 {
  try {
    const r = localStorage.getItem(SALES_KEY);
    if (cachedStore && r === cachedStoreRaw) return cloneStore(cachedStore);
    if (!r) {
      cachedStoreRaw = r;
      cachedStore = { version: 1, byDate: {} };
      return { version: 1, byDate: {} };
    }
    const s = JSON.parse(r) as StoreV1;
    if (!s.byDate || typeof s.byDate !== 'object') {
      cachedStoreRaw = r;
      cachedStore = { version: 1, byDate: {} };
      return { version: 1, byDate: {} };
    }
    const migrated = migrateLegacyBareDateKeys(s);
    cachedStoreRaw = r;
    cachedStore = cloneStore(migrated);
    return cloneStore(migrated);
  } catch {
    cachedStoreRaw = undefined;
    cachedStore = null;
    return { version: 1, byDate: {} };
  }
}

function migrateLegacyBareDateKeys(s: StoreV1): StoreV1 {
  const next: Record<string, Row> = { ...s.byDate };
  for (const [key, row] of Object.entries(s.byDate)) {
    if (!isLegacyBareStallDateKey(key)) continue;
    const scoped = scopedStallDateKey(HQ_SCOPE_ID, key);
    if (!next[scoped]) next[scoped] = row;
  }
  return { version: 1, byDate: next };
}

function saveStore(s: StoreV1) {
  const raw = JSON.stringify(s);
  localStorage.setItem(SALES_KEY, raw);
  cachedStoreRaw = raw;
  cachedStore = cloneStore(s);
  window.dispatchEvent(new Event('salesRecordUpdated'));
}

function readRow(s: StoreV1, ymd: string, scopeId?: string): Row | undefined {
  const scope = resolveStallStorageScopeId(scopeId);
  const scopedKey = scopedStallDateKey(scope, ymd);
  if (s.byDate[scopedKey]) return s.byDate[scopedKey];
  if (scope === HQ_SCOPE_ID && s.byDate[ymd]) return s.byDate[ymd];
  return undefined;
}

function writeRow(s: StoreV1, ymd: string, row: Row, scopeId?: string): void {
  const key = scopedStallDateKey(resolveStallStorageScopeId(scopeId), ymd);
  s.byDate[key] = row;
  if (isLegacyBareStallDateKey(ymd) && key !== ymd) {
    delete s.byDate[ymd];
  }
}

function lineUpdatedMs(line: SalesRecordDayLine | undefined): number {
  const t = Date.parse(String(line?.updatedAt ?? ''));
  return Number.isFinite(t) ? t : 0;
}

function lineQtyScore(line: SalesRecordDayLine | undefined): number {
  if (!line) return -1;
  return Math.abs(num(line.out)) + Math.abs(num(line.remain));
}

function chooseCatalogLine(
  lines: Record<string, SalesRecordDayLine>,
  productId: string,
  productName: string,
): SalesRecordDayLine {
  const candidates: SalesRecordDayLine[] = [];
  const direct = lines[productId];
  if (direct) candidates.push(direct);
  for (const [key, line] of Object.entries(lines)) {
    if (key === productId) continue;
    if (key === productName || getSupplyItem(key)?.name === productName) {
      candidates.push(line);
    }
  }
  if (candidates.length === 0) return { out: '', remain: '' };
  return candidates.reduce((best, cur) => {
    const bestMs = lineUpdatedMs(best);
    const curMs = lineUpdatedMs(cur);
    if (curMs !== bestMs) return curMs > bestMs ? cur : best;
    return lineQtyScore(cur) > lineQtyScore(best) ? cur : best;
  });
}

function catalogLineKeysForProduct(
  lines: Record<string, SalesRecordDayLine>,
  productId: string,
): string[] {
  const keys = new Set<string>([productId]);
  const item = getSupplyItem(productId);
  if (!item) return Array.from(keys);
  for (const key of Object.keys(lines)) {
    if (key === productId) continue;
    if (key === item.name || getSupplyItem(key)?.name === item.name) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function mergeSnapshotWithCatalog(snap: SalesRecordDaySnapshot): SalesRecordDaySnapshot {
  const lines: Record<string, SalesRecordDayLine> = { ...snap.lines };
  for (const it of getAllSupplyItems()) {
    lines[it.id] = chooseCatalogLine(lines, it.id, it.name);
  }
  return { ...snap, lines };
}

function salesLineRevisionKey(l: SalesRecordDayLine | undefined): string {
  return `${String(l?.out ?? '').trim()}\u001f${String(l?.remain ?? '').trim()}`;
}

function stampChangedSalesLines(
  nextLines: SalesRecordDaySnapshot['lines'],
  prevLines: SalesRecordDaySnapshot['lines'] | undefined,
  now: string,
): SalesRecordDaySnapshot['lines'] {
  const stamped: SalesRecordDaySnapshot['lines'] = {};
  for (const [id, line] of Object.entries(nextLines)) {
    const prev = prevLines?.[id];
    const unchanged = prev && salesLineRevisionKey(prev) === salesLineRevisionKey(line);
    stamped[id] = {
      ...line,
      updatedAt: unchanged ? prev.updatedAt ?? now : now,
    };
  }
  return stamped;
}

function stampChangedSalesFields(
  next: SalesRecordDaySnapshot,
  prev: SalesRecordDaySnapshot | undefined,
  now: string,
): Record<string, string> {
  const out = { ...(prev?.fieldUpdatedAt ?? {}) };
  for (const field of ['actualRevenue', 'revenueGapAmount', 'revenueGapReason'] as const) {
    const changed = String(next[field] ?? '').trim() !== String(prev?.[field] ?? '').trim();
    if (changed || !out[field]) out[field] = changed ? now : prev?.fieldUpdatedAt?.[field] ?? now;
  }
  return out;
}

/** 供訂單內嵌快照或畫面顯示前與品項目錄合併。 */
export function mergeSalesRecordWithCatalog(snap: SalesRecordDaySnapshot): SalesRecordDaySnapshot {
  return mergeSnapshotWithCatalog(snap);
}

/**
 * 盤點完成時寫入；覆寫同資料範圍、同營業日之舊銷售紀錄。
 * @param scopeId 未傳則用目前登入者資料範圍；訂單同步時應傳該單之 {@link resolveOrderDataScopeId}。
 */
export function saveSalesRecord(ymd: string, snapshot: SalesRecordDaySnapshot, scopeId?: string) {
  const s = loadStore();
  const completedAt = new Date().toISOString();
  const prev = readRow(s, ymd, scopeId)?.snapshot;
  const snapshotMerged = mergeSnapshotWithCatalog(snapshot);
  const who = getSessionActorDisplayName();
  writeRow(s, ymd, {
    completedAt,
    ...(who ? { completedByName: who } : {}),
    snapshot: {
      ...snapshotMerged,
      lines: stampChangedSalesLines(snapshotMerged.lines, prev?.lines, completedAt),
      fieldUpdatedAt: stampChangedSalesFields(snapshotMerged, prev, completedAt),
      updatedAt: completedAt,
    },
  }, scopeId);
  saveStore(s);
}

/** 僅更新落差備註；無該日紀錄時建立最小快照（與 Dashboard 表格連動）。 */
export function patchSalesRecordRevenueGapReason(ymd: string, reason: string, scopeId?: string) {
  const trimmed = reason.trim();
  const s = loadStore();
  const row = readRow(s, ymd, scopeId);
  const now = new Date().toISOString();
  const prev = row
    ? mergeSnapshotWithCatalog(row.snapshot)
    : mergeSnapshotWithCatalog({
        lines: {},
        actualRevenue: '',
        updatedAt: '',
      });
  const who = getSessionActorDisplayName();
  writeRow(
    s,
    ymd,
    {
      completedAt: row?.completedAt ?? now,
      ...(row?.completedByName ? { completedByName: row.completedByName } : who ? { completedByName: who } : {}),
      snapshot: {
        ...prev,
        revenueGapReason: trimmed,
        lines: stampChangedSalesLines(prev.lines, row?.snapshot.lines, now),
        fieldUpdatedAt: stampChangedSalesFields(
          { ...prev, revenueGapReason: trimmed },
          row?.snapshot,
          now,
        ),
        updatedAt: now,
      },
    },
    scopeId,
  );
  saveStore(s);
}

export function getSalesRecord(ymd: string, scopeId?: string): SalesRecordDaySnapshot | null {
  const s = loadStore();
  const row = readRow(s, ymd, scopeId);
  if (!row) return null;
  return mergeSnapshotWithCatalog(row.snapshot);
}

/** 刪除指定範圍、營業日之銷售紀錄（刪單連動清理用）。 */
export function removeSalesRecordDay(ymd: string, scopeId?: string): boolean {
  const s = loadStore();
  const scope = resolveStallStorageScopeId(scopeId);
  const scopedKey = scopedStallDateKey(scope, ymd);
  let removed = false;
  if (s.byDate[scopedKey]) {
    delete s.byDate[scopedKey];
    removed = true;
  }
  if (scope === HQ_SCOPE_ID && s.byDate[ymd]) {
    delete s.byDate[ymd];
    removed = true;
  }
  if (removed) saveStore(s);
  return removed;
}

/**
 * 僅在該筆訂單有「盤點完成」押記時視為已盤點。
 */
export function isOrderStallCountDone(
  _createdAtIso: string,
  stallCountCompletedAt?: string | null
): boolean {
  return Boolean(stallCountCompletedAt);
}

export function listSalesRecordMeta(scopeId?: string): {
  ymd: string;
  completedAt: string;
  completedByName?: string;
  scopeId: string;
}[] {
  const s = loadStore();
  const scopeFilter = scopeId?.trim();
  const out: { ymd: string; completedAt: string; completedByName?: string; scopeId: string }[] = [];
  for (const [key, row] of Object.entries(s.byDate)) {
    let sid = HQ_SCOPE_ID;
    let ymd = key;
    const parsed = parseScopedStallDateKey(key);
    if (parsed) {
      sid = parsed.scopeId;
      ymd = parsed.ymd;
    } else if (isLegacyBareStallDateKey(key)) {
      sid = HQ_SCOPE_ID;
      ymd = key;
    } else {
      continue;
    }
    if (scopeFilter && sid !== scopeFilter) continue;
    out.push({
      ymd,
      completedAt: row.completedAt,
      completedByName: row.completedByName,
      scopeId: sid,
    });
  }
  return out.sort((a, b) => b.ymd.localeCompare(a.ymd));
}

/**
 * 與攤上扣庫相同邏輯，同步更新銷售紀錄內之「剩餘」（若該日有紀錄）。
 */
export function applySalesRecordOrderDeduction(
  ymdStr: string,
  deductions: Record<string, number>,
  scopeId?: string,
) {
  const s = loadStore();
  const row = readRow(s, ymdStr, scopeId);
  if (!row) return;
  const prev = mergeSnapshotWithCatalog(row.snapshot);
  const lines: SalesRecordDaySnapshot['lines'] = { ...prev.lines };
  const now = new Date().toISOString();
  for (const it of getAllSupplyItems()) {
    if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
  }
  for (const [id, rawQty] of Object.entries(deductions)) {
    const qty = roundProcurementQty(Number(rawQty) || 0);
    if (qty <= 0) continue;
    const keys = catalogLineKeysForProduct(lines, id);
    if (!lines[id]) lines[id] = { out: '', remain: '' };
    const cur = num(lines[id].remain);
    const next = roundProcurementQty(Math.max(0, cur - qty));
    for (const key of keys) {
      lines[key] = { ...(lines[key] ?? lines[id]), remain: String(next), updatedAt: now };
    }
  }
  writeRow(
    s,
    ymdStr,
    {
      ...row,
      snapshot: { ...prev, lines, updatedAt: now },
    },
    scopeId,
  );
  saveStore(s);
}

export function restoreSalesRecordOrderDeduction(
  ymdStr: string,
  restored: Record<string, number>,
  scopeId?: string,
) {
  const s = loadStore();
  const row = readRow(s, ymdStr, scopeId);
  if (!row) return;
  const prev = mergeSnapshotWithCatalog(row.snapshot);
  const lines: SalesRecordDaySnapshot['lines'] = { ...prev.lines };
  const now = new Date().toISOString();
  for (const [id, rawQty] of Object.entries(restored)) {
    const qty = roundProcurementQty(Number(rawQty) || 0);
    if (qty <= 0) continue;
    const keys = catalogLineKeysForProduct(lines, id);
    if (!lines[id]) lines[id] = { out: '', remain: '' };
    const cur = num(lines[id].remain);
    const next = roundProcurementQty(cur + qty);
    for (const key of keys) {
      lines[key] = { ...(lines[key] ?? lines[id]), remain: String(next), updatedAt: now };
    }
  }
  writeRow(s, ymdStr, { ...row, snapshot: { ...prev, lines, updatedAt: now } }, scopeId);
  saveStore(s);
}
