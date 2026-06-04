/**
 * 雲端 bundle 合併：多裝置同時寫入時，依紀錄 id／日期鍵 union，避免整段 JSON 覆蓋導致訂單遺失。
 */
import { orderLineQtyMapsEqual, type OrderHistoryLine } from './orderHistoryStorage';
import type { DongshanStorageKey } from './appDataBundle';

export type OrderLikeForMerge = {
  id: string;
  updatedAt?: string;
  createdAt: string;
  status?: string;
  lines?: OrderHistoryLine[];
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

const ORDER_STATUS_RANK: Record<string, number> = {
  已完成: 3,
  待出貨: 2,
  已取消: 1,
};

function orderStatusRank(status: string | undefined): number {
  return ORDER_STATUS_RANK[status ?? ''] ?? 0;
}

function pickMergedOrderStatus(a: OrderLikeForMerge, b: OrderLikeForMerge): string | undefined {
  const ar = orderStatusRank(a.status);
  const br = orderStatusRank(b.status);
  if (ar >= br) return a.status ?? b.status;
  return b.status ?? a.status;
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

  let lineSource: T;
  if (linesEqual) {
    lineSource = bMs >= aMs ? b : a;
  } else {
    const aDone = a.status === '已完成';
    const bDone = b.status === '已完成';
    if (aDone && !bDone) lineSource = a;
    else if (bDone && !aDone) lineSource = b;
    else lineSource = bMs >= aMs ? b : a;
  }

  const status = pickMergedOrderStatus(a, b);
  const updatedAt = new Date(Math.max(aMs, bMs)).toISOString();

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

  return {
    ...lineSource,
    status: status ?? lineSource.status,
    lines: lineSource.lines,
    updatedAt,
    ...(stampSource.stallCountCompletedAt
      ? {
          stallCountBasisYmd: stampSource.stallCountBasisYmd,
          stallCountCompletedAt: stampSource.stallCountCompletedAt,
          stallCountSnapshot: stampSource.stallCountSnapshot,
          stallCountCompletedByName: stampSource.stallCountCompletedByName,
          stallCountCompletedByUserId: stampSource.stallCountCompletedByUserId,
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

function mergeByDateStore(localRaw: string | null | undefined, cloudRaw: string | null | undefined): string {
  const local = (safeParseJson(localRaw) as ByDateStore | null) ?? { version: 1, byDate: {} };
  const cloud = (safeParseJson(cloudRaw) as ByDateStore | null) ?? { version: 1, byDate: {} };
  const localDates = local.byDate && typeof local.byDate === 'object' ? local.byDate : {};
  const cloudDates = cloud.byDate && typeof cloud.byDate === 'object' ? cloud.byDate : {};
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
    const lMs = recordUpdatedAtMs({
      updatedAt: (l as { updatedAt?: string }).updatedAt ?? (l as { snapshot?: { updatedAt?: string } }).snapshot?.updatedAt,
      createdAt: (l as { completedAt?: string }).completedAt,
    });
    const cMs = recordUpdatedAtMs({
      updatedAt: (c as { updatedAt?: string }).updatedAt ?? (c as { snapshot?: { updatedAt?: string } }).snapshot?.updatedAt,
      createdAt: (c as { completedAt?: string }).completedAt,
    });
    byDate[dk] = cMs >= lMs ? c : l;
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
    case 'dongshan_order_seq_v1':
      return mergeOrderSeqMap(localRaw, cloudRaw);
    default:
      return localRaw ?? cloudRaw ?? null;
  }
}
