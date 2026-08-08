import { bareYmdFromStallStorageKey } from './scopedStallDateKey';
import { effectiveOrderDateYmd } from './orderHistoryStorage';
import { mergeOrderLikeRecord } from './bundleRecordMerge';

export const DATA_ARCHIVE_STORAGE_KEY = 'dongshan_data_archives_v1';

const ORDER_HISTORY_KEY = 'dongshan_order_history_v1';
const FRANCHISE_MGMT_KEY = 'dongshan_franchise_mgmt_orders_v1';
const STALL_INVENTORY_KEY = 'dongshan_stall_inventory_v1';
const SALES_RECORDS_KEY = 'dongshan_sales_records_v1';
const ACCOUNTING_LEDGER_KEY = 'dongshan_accounting_ledger_v1';

type AnyOrder = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  orderDateYmd?: string;
  lines?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type StallStore = { version: 1; byDate: Record<string, unknown> };
type SalesStore = { version: 1; byDate: Record<string, unknown> };
type LedgerEntry = { id: string; dateYmd: string; scopeId?: string; [key: string]: unknown };
type LedgerStoreV1 = { version: 1; entries: LedgerEntry[] };
type LedgerStoreV2 = { version: 2; byScope: Record<string, LedgerEntry[]> };

export type DataArchivePayload = {
  orderHistory: AnyOrder[];
  franchiseManagementOrders: AnyOrder[];
  stallInventory: StallStore;
  salesRecords: SalesStore;
  accountingLedger: LedgerStoreV2;
};

export type DataArchiveEntry = {
  id: string;
  createdAt: string;
  cutoffYmd: string;
  counts: {
    orderHistory: number;
    franchiseManagementOrders: number;
    stallInventoryDays: number;
    salesRecordDays: number;
    accountingLedgerEntries: number;
  };
  payload: DataArchivePayload;
};

type DataArchiveStore = {
  version: 1;
  archives: DataArchiveEntry[];
};

export type ArchiveDataResult = {
  ok: true;
  archive: DataArchiveEntry;
  movedCount: number;
} | {
  ok: false;
  reason: 'empty' | 'invalid_cutoff';
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readArchiveStore(): DataArchiveStore {
  const parsed = safeParse<Partial<DataArchiveStore>>(localStorage.getItem(DATA_ARCHIVE_STORAGE_KEY), {});
  return {
    version: 1,
    archives: Array.isArray(parsed.archives) ? parsed.archives as DataArchiveEntry[] : [],
  };
}

function saveArchiveStore(store: DataArchiveStore): void {
  localStorage.setItem(DATA_ARCHIVE_STORAGE_KEY, JSON.stringify(store));
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isValidYmd(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}

function orderArchiveYmd(order: AnyOrder): string {
  const ymd = effectiveOrderDateYmd({
    orderDateYmd: typeof order.orderDateYmd === 'string' ? order.orderDateYmd : undefined,
    createdAt: String(order.createdAt ?? ''),
  });
  return ymd || String(order.createdAt ?? '').slice(0, 10);
}

function splitOrders<T extends AnyOrder>(orders: T[], cutoffYmd: string): { keep: T[]; archive: T[] } {
  const keep: T[] = [];
  const archive: T[] = [];
  for (const order of orders) {
    if (orderArchiveYmd(order) < cutoffYmd) archive.push(order);
    else keep.push(order);
  }
  return { keep, archive };
}

function emptyStallStore(): StallStore {
  return { version: 1, byDate: {} };
}

function emptySalesStore(): SalesStore {
  return { version: 1, byDate: {} };
}

function emptyLedgerStore(): LedgerStoreV2 {
  return { version: 2, byScope: {} };
}

function splitByDateStore<T extends StallStore | SalesStore>(
  store: T,
  cutoffYmd: string,
): { keep: T; archive: T; archivedCount: number } {
  const keepByDate: Record<string, unknown> = {};
  const archiveByDate: Record<string, unknown> = {};
  for (const [key, row] of Object.entries(store.byDate ?? {})) {
    const ymd = bareYmdFromStallStorageKey(key);
    if (ymd < cutoffYmd) archiveByDate[key] = row;
    else keepByDate[key] = row;
  }
  return {
    keep: { ...store, byDate: keepByDate },
    archive: { ...store, byDate: archiveByDate },
    archivedCount: Object.keys(archiveByDate).length,
  };
}

function normalizeLedgerStore(raw: unknown): LedgerStoreV2 {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<LedgerStoreV1> & Partial<LedgerStoreV2>
    : {} as Partial<LedgerStoreV1> & Partial<LedgerStoreV2>;
  if (obj.version === 2 && obj.byScope && typeof obj.byScope === 'object') {
    const byScope: Record<string, LedgerEntry[]> = {};
    for (const [scopeId, rows] of Object.entries(obj.byScope)) {
      byScope[scopeId] = Array.isArray(rows) ? rows as LedgerEntry[] : [];
    }
    return { version: 2, byScope };
  }
  return {
    version: 2,
    byScope: {
      'scope:hq': Array.isArray(obj.entries) ? obj.entries as LedgerEntry[] : [],
    },
  };
}

function splitLedgerStore(store: LedgerStoreV2, cutoffYmd: string) {
  const keep: LedgerStoreV2 = emptyLedgerStore();
  const archive: LedgerStoreV2 = emptyLedgerStore();
  let archivedCount = 0;
  for (const [scopeId, rows] of Object.entries(store.byScope)) {
    const keepRows: LedgerEntry[] = [];
    const archiveRows: LedgerEntry[] = [];
    for (const row of rows) {
      if (row.dateYmd < cutoffYmd) archiveRows.push(row);
      else keepRows.push(row);
    }
    if (keepRows.length) keep.byScope[scopeId] = keepRows;
    if (archiveRows.length) {
      archive.byScope[scopeId] = archiveRows;
      archivedCount += archiveRows.length;
    }
  }
  return { keep, archive, archivedCount };
}

function archiveId(cutoffYmd: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `archive-before-${cutoffYmd}-${stamp}`;
}

function entryMovedCount(entry: DataArchiveEntry): number {
  return (
    entry.counts.orderHistory +
    entry.counts.franchiseManagementOrders +
    entry.counts.stallInventoryDays +
    entry.counts.salesRecordDays +
    entry.counts.accountingLedgerEntries
  );
}

export function listDataArchives(): DataArchiveEntry[] {
  return readArchiveStore().archives.map((archive) => ({
    ...archive,
    payload: archive.payload,
  }));
}

export function archiveDataOlderThan(cutoffYmd: string): ArchiveDataResult {
  if (!isValidYmd(cutoffYmd)) return { ok: false, reason: 'invalid_cutoff' };

  const orderHistory = safeParse<AnyOrder[]>(localStorage.getItem(ORDER_HISTORY_KEY), []);
  const franchiseManagementOrders = safeParse<AnyOrder[]>(localStorage.getItem(FRANCHISE_MGMT_KEY), []);
  const stallInventory = safeParse<StallStore>(localStorage.getItem(STALL_INVENTORY_KEY), emptyStallStore());
  const salesRecords = safeParse<SalesStore>(localStorage.getItem(SALES_RECORDS_KEY), emptySalesStore());
  const accountingLedger = normalizeLedgerStore(safeParse<unknown>(localStorage.getItem(ACCOUNTING_LEDGER_KEY), emptyLedgerStore()));

  const orderSplit = splitOrders(orderHistory, cutoffYmd);
  const mgmtSplit = splitOrders(franchiseManagementOrders, cutoffYmd);
  const stallSplit = splitByDateStore(stallInventory, cutoffYmd);
  const salesSplit = splitByDateStore(salesRecords, cutoffYmd);
  const ledgerSplit = splitLedgerStore(accountingLedger, cutoffYmd);

  const entry: DataArchiveEntry = {
    id: archiveId(cutoffYmd),
    createdAt: new Date().toISOString(),
    cutoffYmd,
    counts: {
      orderHistory: orderSplit.archive.length,
      franchiseManagementOrders: mgmtSplit.archive.length,
      stallInventoryDays: stallSplit.archivedCount,
      salesRecordDays: salesSplit.archivedCount,
      accountingLedgerEntries: ledgerSplit.archivedCount,
    },
    payload: {
      orderHistory: orderSplit.archive,
      franchiseManagementOrders: mgmtSplit.archive,
      stallInventory: stallSplit.archive,
      salesRecords: salesSplit.archive,
      accountingLedger: ledgerSplit.archive,
    },
  };

  const movedCount = entryMovedCount(entry);
  if (movedCount <= 0) return { ok: false, reason: 'empty' };

  const store = readArchiveStore();
  saveArchiveStore({ version: 1, archives: [entry, ...store.archives] });
  writeJson(ORDER_HISTORY_KEY, orderSplit.keep);
  writeJson(FRANCHISE_MGMT_KEY, mgmtSplit.keep);
  writeJson(STALL_INVENTORY_KEY, stallSplit.keep);
  writeJson(SALES_RECORDS_KEY, salesSplit.keep);
  writeJson(ACCOUNTING_LEDGER_KEY, ledgerSplit.keep);
  window.dispatchEvent(new Event('orderHistoryUpdated'));
  window.dispatchEvent(new Event('franchiseManagementOrdersUpdated'));
  window.dispatchEvent(new Event('stallInventoryUpdated'));
  window.dispatchEvent(new Event('salesRecordUpdated'));
  window.dispatchEvent(new Event('accountingLedgerUpdated'));
  return { ok: true, archive: entry, movedCount };
}

function mergeOrdersById(existing: AnyOrder[], archived: AnyOrder[]): AnyOrder[] {
  const byId = new Map<string, AnyOrder>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of archived) {
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? mergeOrderLikeRecord(prev as never, row as never) as AnyOrder : row);
  }
  return [...byId.values()].sort((a, b) => orderArchiveYmd(b).localeCompare(orderArchiveYmd(a)));
}

function mergeDateStore<T extends StallStore | SalesStore>(existing: T, archived: T): T {
  return {
    ...existing,
    byDate: {
      ...(archived.byDate ?? {}),
      ...(existing.byDate ?? {}),
    },
  };
}

function mergeLedgerStore(existing: LedgerStoreV2, archived: LedgerStoreV2): LedgerStoreV2 {
  const byScope: Record<string, LedgerEntry[]> = {};
  for (const [scopeId, rows] of Object.entries({ ...archived.byScope, ...existing.byScope })) {
    const byId = new Map<string, LedgerEntry>();
    for (const row of archived.byScope[scopeId] ?? []) byId.set(row.id, row);
    for (const row of existing.byScope[scopeId] ?? []) byId.set(row.id, row);
    byScope[scopeId] = [...byId.values()].sort((a, b) => b.dateYmd.localeCompare(a.dateYmd));
    if (byScope[scopeId].length === 0) delete byScope[scopeId];
  }
  return { version: 2, byScope };
}

export function restoreDataArchive(id: string): boolean {
  const store = readArchiveStore();
  const archive = store.archives.find((row) => row.id === id);
  if (!archive) return false;

  const orderHistory = safeParse<AnyOrder[]>(localStorage.getItem(ORDER_HISTORY_KEY), []);
  const franchiseManagementOrders = safeParse<AnyOrder[]>(localStorage.getItem(FRANCHISE_MGMT_KEY), []);
  const stallInventory = safeParse<StallStore>(localStorage.getItem(STALL_INVENTORY_KEY), emptyStallStore());
  const salesRecords = safeParse<SalesStore>(localStorage.getItem(SALES_RECORDS_KEY), emptySalesStore());
  const accountingLedger = normalizeLedgerStore(safeParse<unknown>(localStorage.getItem(ACCOUNTING_LEDGER_KEY), emptyLedgerStore()));

  writeJson(ORDER_HISTORY_KEY, mergeOrdersById(orderHistory, archive.payload.orderHistory));
  writeJson(FRANCHISE_MGMT_KEY, mergeOrdersById(franchiseManagementOrders, archive.payload.franchiseManagementOrders));
  writeJson(STALL_INVENTORY_KEY, mergeDateStore(stallInventory, archive.payload.stallInventory));
  writeJson(SALES_RECORDS_KEY, mergeDateStore(salesRecords, archive.payload.salesRecords));
  writeJson(ACCOUNTING_LEDGER_KEY, mergeLedgerStore(accountingLedger, archive.payload.accountingLedger));
  saveArchiveStore({ version: 1, archives: store.archives.filter((row) => row.id !== id) });
  window.dispatchEvent(new Event('orderHistoryUpdated'));
  window.dispatchEvent(new Event('franchiseManagementOrdersUpdated'));
  window.dispatchEvent(new Event('stallInventoryUpdated'));
  window.dispatchEvent(new Event('salesRecordUpdated'));
  window.dispatchEvent(new Event('accountingLedgerUpdated'));
  return true;
}
