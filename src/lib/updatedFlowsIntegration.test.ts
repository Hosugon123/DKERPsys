/**
 * 五項優先修復之端到端流程回歸（模擬實際操作序列）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendProcurementOrderEntry,
  deleteOrderByIdFromAnyStore,
  readMergedOrderByIdFromStores,
  setOrderStallCountStamp,
  updateOrderStatusInEitherStore,
} from './orderHistoryStorage';
import {
  appendAccountingLedgerEntry,
  listAccountingLedgerEntriesForScopeId,
} from './accountingLedgerStorage';
import { getSalesRecord, saveSalesRecord } from './salesRecordStorage';
import { loadDay, loadDayForProcurement, saveDay } from './stallInventoryStorage';
import { buildProcurementLedgerDraftInput, buildStallGapLedgerDraftInput } from './procurementLedgerDraft';
import { HQ_SCOPE_ID } from './dataScope';

vi.mock('./dataScope', () => ({
  getDataScopeContext: () => ({
    role: 'admin',
    userId: 'admin-1',
    scopeId: 'scope:hq',
    isAdmin: true,
  }),
  HQ_SCOPE_ID: 'scope:hq',
  resolveAccountingLedgerScopeId: () => 'scope:hq',
  resolveFranchiseeRetailOwnerUserId: () => null,
}));

vi.mock('./sessionActorDisplayName', () => ({
  getSessionActorDisplayName: () => '測試管理員',
  resolveUserDisplayNameById: () => '測試管理員',
}));

vi.mock('./storeCodeStorage', () => ({
  getStoreCode3: () => '001',
  normalizeStoreCode3Digits: (s: string) => s,
}));

let orderSeq = 0;
vi.mock('./orderSerialId', () => ({
  allocateOrderSerialId: () => `FLOW-ORD-${++orderSeq}`,
}));

const BASIS = '2026-06-10';
const DUCK = 's20';

function seed() {
  orderSeq = 0;
  localStorage.clear();
  localStorage.setItem('dongshan_order_history_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_franchise_mgmt_orders_v1', JSON.stringify([]));
  localStorage.setItem('dongshan_stall_inventory_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem('dongshan_sales_records_v1', JSON.stringify({ version: 1, byDate: {} }));
  localStorage.setItem(
    'dongshan_accounting_ledger_v1',
    JSON.stringify({ version: 2, byScope: {} }),
  );
  localStorage.setItem('dongshan_deleted_order_ids_v1', JSON.stringify({ version: 1, byId: {} }));
}

describe('五項更新流程整合', () => {
  beforeEach(seed);

  it('流程 A：叫貨 → 食材支出流水 → 盤點完成 → 落差流水', () => {
    const lines = [{ productId: DUCK, name: '鴨頭', unitPrice: 50, qty: 20, unit: '份' }];
    const orderId = appendProcurementOrderEntry({
      lines,
      totalAmount: 1000,
      payableAmount: 1000,
      actorRole: 'admin',
      orderDateYmd: BASIS,
    });
    expect(orderId).toBe('FLOW-ORD-1');

    const ledgerDraft = buildProcurementLedgerDraftInput({
      lines,
      payableAmount: 1000,
      orderDateYmd: BASIS,
      orderId,
    });
    expect(ledgerDraft).not.toBeNull();
    appendAccountingLedgerEntry(ledgerDraft!);

    updateOrderStatusInEitherStore(orderId, '已完成');

    const snap = {
      lines: { [DUCK]: { out: '20', remain: '1' } },
      actualRevenue: '8800',
      revenueGapAmount: '150',
      revenueGapReason: '請客試吃',
      updatedAt: '2026-06-10T18:00:00.000Z',
    };
    expect(
      setOrderStallCountStamp(orderId, { basisYmd: BASIS, completedAt: snap.updatedAt, snapshot: snap }),
    ).toBe(true);

    const gapDraft = buildStallGapLedgerDraftInput({
      gapAmount: 150,
      gapReason: '請客試吃',
      basisYmd: BASIS,
      orderId,
    });
    expect(gapDraft?.flowType).toBe('expense');
    appendAccountingLedgerEntry(gapDraft!);

    const ledger = listAccountingLedgerEntriesForScopeId(HQ_SCOPE_ID);
    expect(ledger).toHaveLength(2);
    expect(ledger.some((e) => e.category === '食材支出' && e.amount === 1000)).toBe(true);
    expect(ledger.some((e) => e.category === '雜項' && e.amount === 150)).toBe(true);
  });

  it('流程 B：盤點自動儲存 → 刪單 → 幽靈資料清除', () => {
    const orderId = appendProcurementOrderEntry({
      lines: [{ productId: DUCK, name: '鴨頭', unitPrice: 50, qty: 10, unit: '份' }],
      totalAmount: 500,
      actorRole: 'admin',
      orderDateYmd: BASIS,
    });
    updateOrderStatusInEitherStore(orderId, '已完成');
    setOrderStallCountStamp(orderId, {
      basisYmd: BASIS,
      completedAt: '2026-06-10T12:00:00.000Z',
      snapshot: {
        lines: { [DUCK]: { out: '10', remain: '2' } },
        actualRevenue: '4000',
        updatedAt: '2026-06-10T12:00:00.000Z',
      },
    });

    saveDay(BASIS, {
      lines: { [DUCK]: { out: '10', remain: '3' } },
      actualRevenue: '4100',
      updatedAt: '2026-06-10T13:00:00.000Z',
    });
    saveSalesRecord(BASIS, {
      lines: { [DUCK]: { out: '10', remain: '2' } },
      actualRevenue: '4000',
      updatedAt: '2026-06-10T12:00:00.000Z',
    });

    expect(Number(loadDay(BASIS).lines[DUCK]?.remain)).toBe(3);
    expect(deleteOrderByIdFromAnyStore(orderId)).toBe(true);
    expect(readMergedOrderByIdFromStores(orderId)).toBeNull();
    expect(getSalesRecord(BASIS)).toBeNull();
    expect(Number(loadDayForProcurement(BASIS).lines[DUCK]?.remain) || 0).toBe(0);
  });

  it('流程 C：同日多單刪一筆 → 另一筆盤點資料保留', () => {
    const orderA = 'FLOW-ORD-A';
    const orderB = 'FLOW-ORD-B';
    const base = {
      createdAt: '2026-06-10T08:00:00.000Z',
      orderDateYmd: BASIS,
      updatedAt: '2026-06-10T09:00:00.000Z',
      source: 'procurement' as const,
      status: '已完成' as const,
      totalAmount: 500,
      payableAmount: 500,
      itemCount: 1,
      lines: [{ productId: DUCK, name: '鴨頭', unitPrice: 50, qty: 10, unit: '份' }],
      storeLabel: '直營店',
      scopeId: 'scope:hq',
      actorRole: 'admin' as const,
      stallCountBasisYmd: BASIS,
      stallCountCompletedAt: '2026-06-10T18:00:00.000Z',
      stallCountSnapshot: {
        lines: { [DUCK]: { out: '10', remain: '1' } },
        actualRevenue: '4000',
        updatedAt: '2026-06-10T18:00:00.000Z',
      },
    };
    localStorage.setItem(
      'dongshan_franchise_mgmt_orders_v1',
      JSON.stringify([
        { ...base, id: orderA },
        { ...base, id: orderB },
      ]),
    );
    saveSalesRecord(BASIS, base.stallCountSnapshot);

    expect(deleteOrderByIdFromAnyStore(orderA)).toBe(true);
    expect(getSalesRecord(BASIS)).not.toBeNull();
    expect(readMergedOrderByIdFromStores(orderB)).toBeTruthy();
  });
});
