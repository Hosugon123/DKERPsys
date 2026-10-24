import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDongshanDataBundle, importDongshanDataBundle, mergeDongshanBundlesLocalWinsDirty } from './appDataBundle';
import { applyConflictRecoveryAfterRemoteImport, hasConflictRecoveryBundle, stashLocalBundleForConflictRecovery } from './conflictRecoveryStorage';
import { mergeStorageKeyRecords } from './bundleRecordMerge';
import { appendAccountingLedgerEntry, removeAccountingLedgerEntry } from './accountingLedgerStorage';
import { saveSalesRecord, removeSalesRecordDay } from './salesRecordStorage';
import { archiveDataOlderThan, restoreDataArchive } from './dataArchiveStorage';

vi.mock('./dataScope', () => ({
  HQ_SCOPE_ID: 'scope:hq', getDataScopeContext: () => ({ role: 'admin', isAdmin: true, scopeId: 'scope:hq', userId: 'boss' }),
  resolveAccountingLedgerScopeId: () => 'scope:hq', resolveFranchiseeRetailOwnerUserId: () => null,
}));

describe('recovery and deletion synchronization safety', () => {
  beforeEach(() => localStorage.clear());

  it('merges an old recovery snapshot instead of replacing newer cloud orders and settings', () => {
    const order = (id: string, updatedAt: string) => ({ id, createdAt: '2026-10-23T00:00:00.000Z', updatedAt, lines: [], status: '已完成' });
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([order('sanmin', '2026-10-23T00:00:00.000Z')]));
    localStorage.setItem('dongshan_store_code_v1', '"OLD"');
    stashLocalBundleForConflictRecovery();
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([
      { ...order('sanmin', '2026-10-24T00:00:00.000Z'), stallCountCompletedAt: '2026-10-24T00:00:00.000Z' },
      order('other-store', '2026-10-24T00:00:00.000Z'),
    ]));
    localStorage.setItem('dongshan_store_code_v1', '"NEW"');
    expect(applyConflictRecoveryAfterRemoteImport()).toBe(true);
    const rows = JSON.parse(localStorage.getItem('dongshan_order_history_v1')!);
    expect(rows).toHaveLength(2);
    expect(rows.find((row: { id: string }) => row.id === 'sanmin').stallCountCompletedAt).toBeTruthy();
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"NEW"');
    expect(hasConflictRecoveryBundle()).toBe(true);
  });

  it('does not revive a deleted ledger entry when another device still has the old entry', () => {
    const entry = appendAccountingLedgerEntry({ dateYmd: '2026-10-24', flowType: 'expense', category: '雜項', note: '', amount: 100 });
    const stale = localStorage.getItem('dongshan_accounting_ledger_v1');
    expect(removeAccountingLedgerEntry(entry.id)).toBe(true);
    const deleted = localStorage.getItem('dongshan_accounting_ledger_v1');
    const merged = JSON.parse(mergeStorageKeyRecords('dongshan_accounting_ledger_v1', stale, deleted)!);
    expect(merged.byScope['scope:hq']).toEqual([]);
    // Another write/load must retain the deletion marker.
    appendAccountingLedgerEntry({ dateYmd: '2026-10-24', flowType: 'expense', category: '雜項', note: '', amount: 50 });
    const later = JSON.parse(mergeStorageKeyRecords('dongshan_accounting_ledger_v1', stale, localStorage.getItem('dongshan_accounting_ledger_v1'))!);
    expect(later.byScope['scope:hq']).toHaveLength(1);
    expect(later.byScope['scope:hq'][0].id).not.toBe(entry.id);
  });

  it('does not revive deleted daily sales but permits an explicitly saved new daily record', () => {
    saveSalesRecord('2026-10-24', { lines: {}, actualRevenue: '100', updatedAt: '' }, 'scope:hq');
    const stale = localStorage.getItem('dongshan_sales_records_v1');
    expect(removeSalesRecordDay('2026-10-24', 'scope:hq')).toBe(true);
    const deleted = localStorage.getItem('dongshan_sales_records_v1');
    expect(JSON.parse(mergeStorageKeyRecords('dongshan_sales_records_v1', stale, deleted)!).byDate).toEqual({});
    saveSalesRecord('2026-10-24', { lines: {}, actualRevenue: '200', updatedAt: '' }, 'scope:hq');
    const merged = JSON.parse(mergeStorageKeyRecords('dongshan_sales_records_v1', deleted, localStorage.getItem('dongshan_sales_records_v1'))!);
    expect(merged.byDate['scope:hq|2026-10-24'].snapshot.actualRevenue).toBe('200');
  });

  it('preserves order tombstones when importing recovery data', () => {
    localStorage.setItem('dongshan_order_history_v1', JSON.stringify([{ id: 'removed', createdAt: '2026-10-22T00:00:00.000Z', lines: [] }]));
    const old = buildDongshanDataBundle();
    localStorage.setItem('dongshan_order_history_v1', '[]');
    localStorage.setItem('dongshan_deleted_order_ids_v1', JSON.stringify({ version: 1, byId: { removed: '2026-10-24T00:00:00.000Z' } }));
    const merged = mergeDongshanBundlesLocalWinsDirty(old, buildDongshanDataBundle(), []);
    expect(importDongshanDataBundle(merged).ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('dongshan_order_history_v1')!)).toEqual([]);
  });

  it('preserves ledger deletion markers through archive and restore', () => {
    const removed = appendAccountingLedgerEntry({ dateYmd: '2026-01-01', flowType: 'expense', category: '雜項', note: '', amount: 100 });
    const stale = localStorage.getItem('dongshan_accounting_ledger_v1');
    removeAccountingLedgerEntry(removed.id);
    appendAccountingLedgerEntry({ dateYmd: '2026-01-02', flowType: 'expense', category: '雜項', note: '', amount: 50 });
    const result = archiveDataOlderThan('2026-07-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(restoreDataArchive(result.archive.id)).toBe(true);
    const merged = JSON.parse(mergeStorageKeyRecords('dongshan_accounting_ledger_v1', stale, localStorage.getItem('dongshan_accounting_ledger_v1'))!);
    expect(merged.byScope['scope:hq']).toHaveLength(1);
    expect(merged.byScope['scope:hq'][0].id).not.toBe(removed.id);
  });

  it('does not discard the archive or partially import when storage rejects the archive', () => {
    localStorage.setItem('dongshan_store_code_v1', '"001"');
    const cloud = buildDongshanDataBundle();
    cloud.keys.dongshan_store_code_v1 = '"002"';
    cloud.keys.dongshan_data_archives_v1 = '{"version":1,"archives":[{"id":"unconfirmed"}]}';
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'dongshan_data_archives_v1') throw new DOMException('quota exceeded', 'QuotaExceededError');
      original.call(this, key, value);
    });
    try {
      expect(importDongshanDataBundle(cloud).ok).toBe(false);
      expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"001"');
    } finally { write.mockRestore(); }
  });
});
