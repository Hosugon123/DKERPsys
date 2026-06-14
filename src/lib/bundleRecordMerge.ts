/**
 * 雲端 bundle 合併：多裝置同時寫入時，依紀錄 id／日期鍵 union，避免整段 JSON 覆蓋導致訂單遺失。
 */
import { orderLineQtyMapsEqual, type OrderHistoryLine } from './orderHistoryStorage';
import type { DongshanStorageKey } from './appDataBundle';
import { mergeFranchiseeRetailStoreJson } from './franchiseeRetailState';
import { HQ_SCOPE_ID } from './dataScope';
import { isLegacyBareStallDateKey, scopedStallDateKey } from './scopedStallDateKey';

export type OrderLikeForMerge = {
  id: string;
  updatedAt?: string;
  createdAt: string;
  status?: string;
  statusUpdatedAt?: string;
  lines?: OrderHistoryLine[];
  itemCount?: number;
  totalAmount?: number;
  payableAmount?: number;
  stallCountCompletedAt?: string;
  stallCountBasisYmd?: string;
  stallCountSnapshot?: unknown;
  stallCountCompletedByName?: string;
  stallCountCompletedByUserId?: string;
};

export const MULTI_DEVICE_RECORD_MERGE_KEYS = [
  'dongshan_order_history_v1',
  'dongshan_franchise_mgmt_orders_v1',
  'dongshan_accounting_ledger_v1',
  'dongshan_sales_records_v1',
  'dongshan_stall_inventory_v1',
  'dongshan_franchisee_retail_v1',
  'dongshan_order_seq_v1',
] as const satisfies readonly DongshanStorageKey[];

const RECORD_MERGE_KEY_SET = new Set<string>(MULTI_DEVICE_RECORD_MERGE_KEYS);

export function isMultiDeviceRecordMergeKey(k: string): k is (typeof MULTI_DEVICE_RECORD_MERGE_KEYS)[number] {
  return RECORD_MERGE_KEY_SET.has(k);
}

export function recordUpdatedAtMs(o: { updatedAt?: string; createdAt?: string }): number {
  const t = (o.updatedAt || o.createdAt || '').trim();
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function pickNewerByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(a: T, b: T): T {
  return recordUpdatedAtMs(b) >= recordUpdatedAtMs(a) ? b : a;
}

type DeletedOrderIdsStore = { version: 1; byId: Record<string, string> };

function parseDeletedOrderIdsStore(raw: string | null | undefined): DeletedOrderIdsStore {
  const p = safeParseJson(raw);
  if (
    p &&
    typeof p === 'object' &&
    'byId' in p &&
    typeof (p as DeletedOrderIdsStore).byId === 'object'
  ) {
    return { version: 1, byId: { ...(p as DeletedOrderIdsStore).byId } };
  }
  return { version: 1, byId: {} };
}

/** 合併兩端已刪除訂單墓碑（同 id 取較新 deletedAt）。 */
export function mergeDeletedOrderIdsStore(
  localRaw: string | null | undefined,
  cloudRaw: string | null | undefined,
): string {
  const local = parseDeletedOrderIdsStore(localRaw);
  const cloud = parseDeletedOrderIdsStore(cloudRaw);
  const byId: Record<string, string> = { ...cloud.byId };
  for (const [id, deletedAt] of Object.entries(local.byId)) {
    const cid = id.trim();
    if (!cid || !deletedAt?.trim()) continue;
    const prev = byId[cid];
    if (
      !prev ||
      recordUpdatedAtMs({ createdAt: deletedAt }) >= recordUpdatedAtMs({ createdAt: prev })
    ) {
      byId[cid] = deletedAt;
    }
  }
  return JSON.stringify({ version: 1, byId });
}

/** 從訂單陣列 JSON 排除墓碑中的 id。 */
export function filterOrderArrayJsonByTombstones(
  ordersJson: string,
  tombstonesJson: string,
): string {
  const tombstones = parseDeletedOrderIdsStore(tombstonesJson);
  const tombstoneIds = new Set(
    Object.keys(tombstones.byId).map((id) => id.trim()).filter(Boolean),
  );
  if (tombstoneIds.size === 0) return ordersJson;
  const arr = safeParseJson(ordersJson);
  if (!Array.isArray(arr)) return ordersJson;
  const filtered = arr.filter((x) => {
    if (x == null || typeof x !== 'object') return true;
    const id = (x as { id?: string }).id?.trim();
    return !id || !tombstoneIds.has(id);
  });
  return JSON.stringify(filtered);
}

const ORDER_STATUS_RANK: Record<string, number> = {
  已完成: 3,
  待出貨: 2,
  已取消: 1,
};

function orderStatusRank(status: string | undefined): number {
  return ORDER_STATUS_RANK[status ?? ''] ?? 0;
}

function pickMergedOrderStatus(a: OrderLikeForMerge, b: OrderLikeForMerge): string | undefined {
  if (!a.statusUpdatedAt && !b.statusUpdatedAt) {
    const ar = orderStatusRank(a.status);
    const br = orderStatusRank(b.status);
    if (ar === 3 || br === 3) return ar >= br ? a.status ?? b.status : b.status ?? a.status;
    if (ar === 1 && br === 2) return a.status ?? b.status;
    if (ar === 2 && br === 1) return b.status ?? a.status;
    if (ar >= br) return a.status ?? b.status;
    return b.status ?? a.status;
  }
  const aStatusMs = recordUpdatedAtMs({
    updatedAt: a.statusUpdatedAt ?? a.updatedAt,
    createdAt: a.createdAt,
  });
  const bStatusMs = recordUpdatedAtMs({
    updatedAt: b.statusUpdatedAt ?? b.updatedAt,
    createdAt: b.createdAt,
  });
  if (bStatusMs >= aStatusMs) return b.status ?? a.status;
  return a.status ?? b.status;
}

function pickMergedStatusUpdatedAt(a: OrderLikeForMerge, b: OrderLikeForMerge): string | undefined {
  const aAt = a.statusUpdatedAt ?? a.updatedAt ?? a.createdAt;
  const bAt = b.statusUpdatedAt ?? b.updatedAt ?? b.createdAt;
  return recordUpdatedAtMs({ updatedAt: bAt }) >= recordUpdatedAtMs({ updatedAt: aAt })
    ? bAt
    : aAt;
}

type StallSnapshotLike = { updatedAt?: string };

function stallSnapshotUpdatedAtMs(order: OrderLikeForMerge): number {
  const snap = order.stallCountSnapshot as StallSnapshotLike | null | undefined;
  if (!snap || typeof snap !== 'object') return 0;
  return recordUpdatedAtMs({ updatedAt: snap.updatedAt });
}

/** 盤點帳上快照以 snapshot.updatedAt 為準（調整盤點不會改 stallCountCompletedAt）。 */
function pickNewerStallCountSnapshot(a: OrderLikeForMerge, b: OrderLikeForMerge): unknown | undefined {
  const aSnap = a.stallCountSnapshot;
  const bSnap = b.stallCountSnapshot;
  if (aSnap == null && bSnap == null) return undefined;
  if (aSnap == null) return bSnap;
  if (bSnap == null) return aSnap;
  return stallSnapshotUpdatedAtMs(b) >= stallSnapshotUpdatedAtMs(a) ? bSnap : aSnap;
}

function orderLineUpdatedAtMs(line: OrderHistoryLine, order: OrderLikeForMerge): number {
  return recordUpdatedAtMs({
    updatedAt: line.updatedAt ?? order.updatedAt,
    createdAt: order.createdAt,
  });
}

function orderLinesHaveLineTimestamps(lines: OrderHistoryLine[]): boolean {
  return lines.some((line) => Boolean(line.updatedAt?.trim()));
}

function mergeOrderLinesByProduct(a: OrderLikeForMerge, b: OrderLikeForMerge): OrderHistoryLine[] {
  const aLines = a.lines ?? [];
  const bLines = b.lines ?? [];
  const byProductId = new Map<string, { line: OrderHistoryLine; order: OrderLikeForMerge }>();
  const orderIds: string[] = [];

  for (const order of [a, b]) {
    for (const line of order.lines ?? []) {
      const id = line.productId?.trim();
      if (!id) continue;
      if (!byProductId.has(id)) orderIds.push(id);
      const prev = byProductId.get(id);
      if (!prev || orderLineUpdatedAtMs(line, order) >= orderLineUpdatedAtMs(prev.line, prev.order)) {
        byProductId.set(id, { line, order });
      }
    }
  }

  const sourceOrder = recordUpdatedAtMs(b) >= recordUpdatedAtMs(a) ? bLines : aLines;
  const sourceIds = sourceOrder
    .map((line) => line.productId?.trim())
    .filter((id): id is string => Boolean(id));
  const sortedIds = [
    ...sourceIds,
    ...orderIds.filter((id) => !sourceIds.includes(id)),
  ];

  return sortedIds
    .map((id) => byProductId.get(id)?.line)
    .filter((line): line is OrderHistoryLine => Boolean(line));
}

function summarizeOrderLines(lines: OrderHistoryLine[]) {
  const itemCount = Math.round(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) * 1000) / 1000;
  const totalAmount = Math.round(lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0) * 100) / 100;
  return { itemCount, totalAmount };
}

/**
 * 合併同一單號兩份訂單：狀態取較進階（已完成優先於待出貨），
 * 品項數量衝突時優先採用「已出貨」方之 lines，避免僅更新時間戳的舊本機蓋回已出貨調整結果。
 */
export function mergeOrderLikeRecord<T extends OrderLikeForMerge>(a: T, b: T): T {
  const aMs = recordUpdatedAtMs(a);
  const bMs = recordUpdatedAtMs(b);
  const aLines = a.lines ?? [];
  const bLines = b.lines ?? [];
  const linesEqual = orderLineQtyMapsEqual(aLines, bLines);
  const hasLineTimestamps = orderLinesHaveLineTimestamps(aLines) || orderLinesHaveLineTimestamps(bLines);

  let lineSource: T;
  let mergedLines: OrderHistoryLine[] | undefined;
  if (linesEqual) {
    lineSource = bMs >= aMs ? b : a;
  } else if (hasLineTimestamps) {
    lineSource = bMs >= aMs ? b : a;
    mergedLines = mergeOrderLinesByProduct(a, b);
  } else {
    const aDone = a.status === '已完成';
    const bDone = b.status === '已完成';
    if (aDone && !bDone) lineSource = a;
    else if (bDone && !aDone) lineSource = b;
    else {
      lineSource = bMs >= aMs ? b : a;
      if (orderLinesHaveLineTimestamps(aLines) || orderLinesHaveLineTimestamps(bLines)) {
        mergedLines = mergeOrderLinesByProduct(a, b);
      }
    }
  }

  const status = pickMergedOrderStatus(a, b);
  const updatedAt = new Date(Math.max(aMs, bMs)).toISOString();
  const lines = mergedLines ?? lineSource.lines;
  const lineTotals = lines ? summarizeOrderLines(lines) : null;

  const aStamped = Boolean(a.stallCountCompletedAt?.trim());
  const bStamped = Boolean(b.stallCountCompletedAt?.trim());
  let stampSource: T = lineSource;
  if (aStamped && !bStamped) stampSource = a;
  else if (bStamped && !aStamped) stampSource = b;
  else if (aStamped && bStamped) {
    const aStampMs = recordUpdatedAtMs({ updatedAt: a.stallCountCompletedAt, createdAt: a.createdAt });
    const bStampMs = recordUpdatedAtMs({ updatedAt: b.stallCountCompletedAt, createdAt: b.createdAt });
    stampSource = bStampMs >= aStampMs ? b : a;
  }

  const mergedSnapshot = pickNewerStallCountSnapshot(a, b);

  return {
    ...lineSource,
    status: status ?? lineSource.status,
    statusUpdatedAt: pickMergedStatusUpdatedAt(a, b),
    lines,
    ...(lineTotals
      ? {
          itemCount: lineTotals.itemCount,
          totalAmount: lineTotals.totalAmount,
        }
      : {}),
    updatedAt,
    ...(stampSource.stallCountCompletedAt || mergedSnapshot != null
      ? {
          stallCountBasisYmd:
            stampSource.stallCountBasisYmd ?? a.stallCountBasisYmd ?? b.stallCountBasisYmd,
          stallCountCompletedAt: stampSource.stallCountCompletedAt,
          ...(mergedSnapshot != null ? { stallCountSnapshot: mergedSnapshot } : {}),
          stallCountCompletedByName:
            stampSource.stallCountCompletedByName ??
            a.stallCountCompletedByName ??
            b.stallCountCompletedByName,
          stallCountCompletedByUserId:
            stampSource.stallCountCompletedByUserId ??
            a.stallCountCompletedByUserId ??
            b.stallCountCompletedByUserId,
        }
      : {}),
  };
}

export function mergeArraysById<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  localArr: T[],
  cloudArr: T[],
): T[] {
  const map = new Map<string, T>();
  for (const row of [...localArr, ...cloudArr]) {
    const id = row.id?.trim();
    if (!id) continue;
    const prev = map.get(id);
    map.set(id, prev ? pickNewerByUpdatedAt(prev, row) : row);
  }
  return [...map.values()].sort((a, b) => recordUpdatedAtMs(b) - recordUpdatedAtMs(a));
}

export function mergeOrderArraysById<T extends OrderLikeForMerge>(localArr: T[], cloudArr: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of [...localArr, ...cloudArr]) {
    const id = row.id?.trim();
    if (!id) continue;
    const prev = map.get(id);
    map.set(id, prev ? mergeOrderLikeRecord(prev, row) : row);
  }
  return [...map.values()].sort((a, b) => recordUpdatedAtMs(b) - recordUpdatedAtMs(a));
}

function parseOrderLikeArray(raw: string | null | undefined): { id: string; updatedAt?: string; createdAt: string }[] {
  const p = safeParseJson(raw);
  if (!Array.isArray(p)) return [];
  return p.filter(
    (x): x is { id: string; updatedAt?: string; createdAt: string } =>
      x != null &&
      typeof x === 'object' &&
      typeof (x as { id?: string }).id === 'string' &&
      typeof (x as { createdAt?: string }).createdAt === 'string',
  );
}

type LedgerStoreV2 = {
  version?: number;
  byScope?: Record<string, { id: string; updatedAt?: string; createdAt: string }[]>;
};

function mergeAccountingLedger(localRaw: string | null | undefined, cloudRaw: string | null | undefined): string {
  const local = (safeParseJson(localRaw) as LedgerStoreV2 | null) ?? { version: 2, byScope: {} };
  const cloud = (safeParseJson(cloudRaw) as LedgerStoreV2 | null) ?? { version: 2, byScope: {} };
  const localScopes = local.byScope && typeof local.byScope === 'object' ? local.byScope : {};
  const cloudScopes = cloud.byScope && typeof cloud.byScope === 'object' ? cloud.byScope : {};
  const scopeIds = new Set([...Object.keys(localScopes), ...Object.keys(cloudScopes)]);
  const byScope: Record<string, ReturnType<typeof mergeArraysById>> = {};
  for (const scopeId of scopeIds) {
    const la = Array.isArray(localScopes[scopeId]) ? localScopes[scopeId]! : [];
    const ca = Array.isArray(cloudScopes[scopeId]) ? cloudScopes[scopeId]! : [];
    byScope[scopeId] = mergeArraysById(la, ca);
  }
  return JSON.stringify({ version: 2, byScope });
}

type ByDateStore = {
  version?: number;
  byDate?: Record<string, { updatedAt?: string; snapshot?: { updatedAt?: string } }>;
};

type DayLineLike = { out?: string; remain?: string; updatedAt?: string };
type DaySnapshotLike = {
  updatedAt?: string;
  lines?: Record<string, DayLineLike>;
  actualRevenue?: string;
  revenueGapAmount?: string;
  revenueGapReason?: string;
  fieldUpdatedAt?: Record<string, string>;
};
type ByDateRowLike = DaySnapshotLike & {
  completedAt?: string;
  snapshot?: DaySnapshotLike;
};

function snapshotForByDateRow(row: unknown): DaySnapshotLike | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as ByDateRowLike;
  if (r.snapshot && typeof r.snapshot === 'object') return r.snapshot;
  return r;
}

function byDateLineUpdatedAtMs(line: DayLineLike, fallback: { updatedAt?: string; createdAt?: string }): number {
  return recordUpdatedAtMs({
    updatedAt: line.updatedAt ?? fallback.updatedAt,
    createdAt: fallback.createdAt,
  });
}

function byDateLinesHaveTimestamps(lines: Record<string, DayLineLike> | undefined): boolean {
  return Object.values(lines ?? {}).some((line) => Boolean(line.updatedAt?.trim()));
}

function mergeDayLines(
  aLines: Record<string, DayLineLike> | undefined,
  bLines: Record<string, DayLineLike> | undefined,
  aFallback: { updatedAt?: string; createdAt?: string },
  bFallback: { updatedAt?: string; createdAt?: string },
): Record<string, DayLineLike> {
  const out: Record<string, DayLineLike> = {};
  const ids = new Set([...Object.keys(aLines ?? {}), ...Object.keys(bLines ?? {})]);
  for (const id of ids) {
    const aLine = aLines?.[id];
    const bLine = bLines?.[id];
    if (!aLine) {
      if (bLine) out[id] = bLine;
      continue;
    }
    if (!bLine) {
      out[id] = aLine;
      continue;
    }
    out[id] =
      byDateLineUpdatedAtMs(bLine, bFallback) >= byDateLineUpdatedAtMs(aLine, aFallback)
        ? bLine
        : aLine;
  }
  return out;
}

function mergeDayEditableFields(
  target: DaySnapshotLike,
  aSnap: DaySnapshotLike,
  bSnap: DaySnapshotLike,
): DaySnapshotLike {
  if (!aSnap.fieldUpdatedAt && !bSnap.fieldUpdatedAt) return target;
  const next: DaySnapshotLike = { ...target, fieldUpdatedAt: { ...(target.fieldUpdatedAt ?? {}) } };
  for (const field of ['actualRevenue', 'revenueGapAmount', 'revenueGapReason'] as const) {
    const aAt = aSnap.fieldUpdatedAt?.[field] ?? aSnap.updatedAt;
    const bAt = bSnap.fieldUpdatedAt?.[field] ?? bSnap.updatedAt;
    if (recordUpdatedAtMs({ updatedAt: bAt }) >= recordUpdatedAtMs({ updatedAt: aAt })) {
      next[field] = bSnap[field];
      next.fieldUpdatedAt![field] = bAt ?? '';
    } else {
      next[field] = aSnap[field];
      next.fieldUpdatedAt![field] = aAt ?? '';
    }
  }
  return next;
}

function mergeByDateRow(l: unknown, c: unknown): unknown {
  const lSnap = snapshotForByDateRow(l);
  const cSnap = snapshotForByDateRow(c);
  const lMs = recordUpdatedAtMs({
    updatedAt: lSnap?.updatedAt ?? (l as { updatedAt?: string })?.updatedAt,
    createdAt: (l as { completedAt?: string })?.completedAt,
  });
  const cMs = recordUpdatedAtMs({
    updatedAt: cSnap?.updatedAt ?? (c as { updatedAt?: string })?.updatedAt,
    createdAt: (c as { completedAt?: string })?.completedAt,
  });
  const newer = cMs >= lMs ? c : l;

  if (!lSnap || !cSnap) {
    return newer;
  }
  const hasLineTimestamps = byDateLinesHaveTimestamps(lSnap.lines) || byDateLinesHaveTimestamps(cSnap.lines);
  const hasFieldTimestamps = Boolean(lSnap.fieldUpdatedAt || cSnap.fieldUpdatedAt);
  if (!hasLineTimestamps && !hasFieldTimestamps) return newer;

  const newerSnap = snapshotForByDateRow(newer);
  const mergedLines = hasLineTimestamps
    ? mergeDayLines(
        lSnap.lines,
        cSnap.lines,
        { updatedAt: lSnap.updatedAt, createdAt: (l as { completedAt?: string })?.completedAt },
        { updatedAt: cSnap.updatedAt, createdAt: (c as { completedAt?: string })?.completedAt },
      )
    : newerSnap?.lines;

  if (newer && typeof newer === 'object' && 'snapshot' in newer) {
    const row = newer as ByDateRowLike;
    const snapshot = mergeDayEditableFields(
      { ...(row.snapshot ?? {}), lines: mergedLines },
      lSnap,
      cSnap,
    );
    return {
      ...row,
      snapshot,
    };
  }
  if (newer && typeof newer === 'object') {
    return mergeDayEditableFields({
      ...(newer as DaySnapshotLike),
      lines: mergedLines,
    }, lSnap, cSnap);
  }
  return newer;
}

function normalizeByDateStoreKeys(byDate: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, row] of Object.entries(byDate)) {
    const normalizedKey = isLegacyBareStallDateKey(key)
      ? scopedStallDateKey(HQ_SCOPE_ID, key)
      : key;
    const existing = out[normalizedKey];
    if (existing == null) {
      out[normalizedKey] = row;
      continue;
    }
    out[normalizedKey] = mergeByDateRow(existing, row);
  }
  return out;
}

function mergeByDateStore(localRaw: string | null | undefined, cloudRaw: string | null | undefined): string {
  const local = (safeParseJson(localRaw) as ByDateStore | null) ?? { version: 1, byDate: {} };
  const cloud = (safeParseJson(cloudRaw) as ByDateStore | null) ?? { version: 1, byDate: {} };
  const localDates =
    local.byDate && typeof local.byDate === 'object'
      ? normalizeByDateStoreKeys(local.byDate as Record<string, unknown>)
      : {};
  const cloudDates =
    cloud.byDate && typeof cloud.byDate === 'object'
      ? normalizeByDateStoreKeys(cloud.byDate as Record<string, unknown>)
      : {};
  const dateKeys = new Set([...Object.keys(localDates), ...Object.keys(cloudDates)]);
  const byDate: Record<string, unknown> = {};
  for (const dk of dateKeys) {
    const l = localDates[dk];
    const c = cloudDates[dk];
    if (l == null) {
      byDate[dk] = c;
      continue;
    }
    if (c == null) {
      byDate[dk] = l;
      continue;
    }
    byDate[dk] = mergeByDateRow(l, c);
  }
  return JSON.stringify({ version: local.version ?? cloud.version ?? 1, byDate });
}

function mergeOrderSeqMap(localRaw: string | null | undefined, cloudRaw: string | null | undefined): string {
  const local = (safeParseJson(localRaw) as Record<string, number> | null) ?? {};
  const cloud = (safeParseJson(cloudRaw) as Record<string, number> | null) ?? {};
  const out: Record<string, number> = { ...cloud };
  for (const [k, v] of Object.entries(local)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.max(Number(out[k] || 0), n);
  }
  return JSON.stringify(out);
}

/** 合併單一 storage 鍵之 JSON 字串（僅適用 MULTI_DEVICE_RECORD_MERGE_KEYS）。 */
export function mergeStorageKeyRecords(
  key: DongshanStorageKey,
  localRaw: string | null | undefined,
  cloudRaw: string | null | undefined,
): string | null {
  if (!isMultiDeviceRecordMergeKey(key)) return localRaw ?? cloudRaw ?? null;

  switch (key) {
    case 'dongshan_order_history_v1':
    case 'dongshan_franchise_mgmt_orders_v1': {
      const merged = mergeOrderArraysById(parseOrderLikeArray(localRaw), parseOrderLikeArray(cloudRaw));
      return JSON.stringify(merged);
    }
    case 'dongshan_accounting_ledger_v1':
      return mergeAccountingLedger(localRaw, cloudRaw);
    case 'dongshan_sales_records_v1':
    case 'dongshan_stall_inventory_v1':
      return mergeByDateStore(localRaw, cloudRaw);
    case 'dongshan_franchisee_retail_v1':
      return mergeFranchiseeRetailStoreJson(localRaw, cloudRaw);
    case 'dongshan_order_seq_v1':
      return mergeOrderSeqMap(localRaw, cloudRaw);
    default:
      return localRaw ?? cloudRaw ?? null;
  }
}
