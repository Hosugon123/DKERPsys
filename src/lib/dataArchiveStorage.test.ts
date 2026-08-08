import { beforeEach, describe, expect, it } from 'vitest';
import {
  DATA_ARCHIVE_STORAGE_KEY,
  archiveDataOlderThan,
  listDataArchives,
  restoreDataArchive,
} from './dataArchiveStorage';

const ORDER_HISTORY_KEY = 'dongshan_order_history_v1';
const FRANCHISE_MGMT_KEY = 'dongshan_franchise_mgmt_orders_v1';
const STALL_INVENTORY_KEY = 'dongshan_stall_inventory_v1';
const SALES_RECORDS_KEY = 'dongshan_sales_records_v1';
const ACCOUNTING_LEDGER_KEY = 'dongshan_accounting_ledger_v1';

function order(id: string, ymd: string, scopeId: string) {
  return {
    id,
    createdAt: `${ymd}T08:00:00.000Z`,
    orderDateYmd: ymd,
    updatedAt: `${ymd}T08:10:00.000Z`,
    source: 'procurement' as const,
    totalAmount: 100,
    itemCount: 1,
    lines: [{ productId: 'p1', name: '黑輪', unitPrice: 100, qty: 1, unit: '份' }],
    actorRole: scopeId === 'scope:hq' ? 'admin' : 'franchisee',
    storeLabel: scopeId === 'scope:hq' ? '直營店' : '加盟店',
    status: '已完成',
    scopeId,
    actorUserId: scopeId === 'scope:hq' ? 'hq-user' : 'dk002',
  };
}

describe('data archive storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('archives all scopes older than cutoff and keeps recent active data', () => {
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify([
      order('old-hq', '2026-01-10', 'scope:hq'),
      order('recent-hq', '2026-06-10', 'scope:hq'),
    ]));
    localStorage.setItem(FRANCHISE_MGMT_KEY, JSON.stringify([
      order('old-franchise', '2026-01-11', 'scope:franchisee:dk002'),
      order('recent-franchise', '2026-06-11', 'scope:franchisee:dk002'),
    ]));
    localStorage.setItem(STALL_INVENTORY_KEY, JSON.stringify({
      version: 1,
      byDate: {
        'scope:hq|2026-01-10': { lines: {}, actualRevenue: '1000', updatedAt: '2026-01-10T22:00:00.000Z' },
        'scope:franchisee:dk002|2026-01-11': { lines: {}, actualRevenue: '800', updatedAt: '2026-01-11T22:00:00.000Z' },
        'scope:hq|2026-06-10': { lines: {}, actualRevenue: '1200', updatedAt: '2026-06-10T22:00:00.000Z' },
      },
    }));
    localStorage.setItem(SALES_RECORDS_KEY, JSON.stringify({
      version: 1,
      byDate: {
        'scope:hq|2026-01-10': { completedAt: '2026-01-10T22:00:00.000Z', snapshot: { lines: {}, actualRevenue: '1000', updatedAt: '2026-01-10T22:00:00.000Z' } },
        'scope:franchisee:dk002|2026-01-11': { completedAt: '2026-01-11T22:00:00.000Z', snapshot: { lines: {}, actualRevenue: '800', updatedAt: '2026-01-11T22:00:00.000Z' } },
        'scope:hq|2026-06-10': { completedAt: '2026-06-10T22:00:00.000Z', snapshot: { lines: {}, actualRevenue: '1200', updatedAt: '2026-06-10T22:00:00.000Z' } },
      },
    }));
    localStorage.setItem(ACCOUNTING_LEDGER_KEY, JSON.stringify({
      version: 2,
      byScope: {
        'scope:hq': [
          { id: 'old-ledger-hq', dateYmd: '2026-01-10', flowType: 'income', category: '營收', note: '', amount: 1000, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z', scopeId: 'scope:hq' },
          { id: 'recent-ledger-hq', dateYmd: '2026-06-10', flowType: 'income', category: '營收', note: '', amount: 1200, createdAt: '2026-06-10T00:00:00.000Z', updatedAt: '2026-06-10T00:00:00.000Z', scopeId: 'scope:hq' },
        ],
        'scope:franchisee:dk002': [
          { id: 'old-ledger-franchise', dateYmd: '2026-01-11', flowType: 'expense', category: '支出', note: '', amount: 300, createdAt: '2026-01-11T00:00:00.000Z', updatedAt: '2026-01-11T00:00:00.000Z', scopeId: 'scope:franchisee:dk002' },
        ],
      },
    }));

    const res = archiveDataOlderThan('2026-04-01');

    expect(res.ok).toBe(true);
    expect(localStorage.getItem(DATA_ARCHIVE_STORAGE_KEY)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) ?? '[]').map((x: { id: string }) => x.id)).toEqual(['recent-hq']);
    expect(JSON.parse(localStorage.getItem(FRANCHISE_MGMT_KEY) ?? '[]').map((x: { id: string }) => x.id)).toEqual(['recent-franchise']);
    expect(Object.keys(JSON.parse(localStorage.getItem(STALL_INVENTORY_KEY) ?? '{}').byDate)).toEqual(['scope:hq|2026-06-10']);
    expect(Object.keys(JSON.parse(localStorage.getItem(SALES_RECORDS_KEY) ?? '{}').byDate)).toEqual(['scope:hq|2026-06-10']);
    expect(JSON.parse(localStorage.getItem(ACCOUNTING_LEDGER_KEY) ?? '{}').byScope['scope:hq'].map((x: { id: string }) => x.id)).toEqual(['recent-ledger-hq']);

    const archive = listDataArchives()[0]!;
    expect(archive.payload.orderHistory[0]?.scopeId).toBe('scope:hq');
    expect(archive.payload.franchiseManagementOrders[0]?.scopeId).toBe('scope:franchisee:dk002');
    expect(archive.payload.accountingLedger.byScope['scope:franchisee:dk002']?.[0]?.id).toBe('old-ledger-franchise');
  });

  it('restores an archive back to active data and removes the archive entry', () => {
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify([order('recent-hq', '2026-06-10', 'scope:hq')]));
    localStorage.setItem(FRANCHISE_MGMT_KEY, JSON.stringify([]));
    localStorage.setItem(STALL_INVENTORY_KEY, JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem(SALES_RECORDS_KEY, JSON.stringify({ version: 1, byDate: {} }));
    localStorage.setItem(ACCOUNTING_LEDGER_KEY, JSON.stringify({ version: 2, byScope: {} }));
    localStorage.setItem(DATA_ARCHIVE_STORAGE_KEY, JSON.stringify({
      version: 1,
      archives: [{
        id: 'archive-a',
        createdAt: '2026-08-06T00:00:00.000Z',
        cutoffYmd: '2026-04-01',
        counts: {
          orderHistory: 1,
          franchiseManagementOrders: 0,
          stallInventoryDays: 1,
          salesRecordDays: 0,
          accountingLedgerEntries: 1,
        },
        payload: {
          orderHistory: [order('old-hq', '2026-01-10', 'scope:hq')],
          franchiseManagementOrders: [],
          stallInventory: { version: 1, byDate: { 'scope:hq|2026-01-10': { lines: {}, actualRevenue: '1000', updatedAt: '2026-01-10T22:00:00.000Z' } } },
          salesRecords: { version: 1, byDate: {} },
          accountingLedger: { version: 2, byScope: { 'scope:hq': [{ id: 'old-ledger-hq', dateYmd: '2026-01-10', flowType: 'income', category: '營收', note: '', amount: 1000, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z', scopeId: 'scope:hq' }] } },
        },
      }],
    }));

    expect(restoreDataArchive('archive-a')).toBe(true);

    expect(JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) ?? '[]').map((x: { id: string }) => x.id).sort()).toEqual(['old-hq', 'recent-hq']);
    expect(Object.keys(JSON.parse(localStorage.getItem(STALL_INVENTORY_KEY) ?? '{}').byDate)).toEqual(['scope:hq|2026-01-10']);
    expect(JSON.parse(localStorage.getItem(ACCOUNTING_LEDGER_KEY) ?? '{}').byScope['scope:hq'].map((x: { id: string }) => x.id)).toEqual(['old-ledger-hq']);
    expect(listDataArchives()).toEqual([]);
  });
});
