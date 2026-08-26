/**
 * 資料存取抽象層（達客 ERP → 本機 lib/*Storage ｜ remote 時自動 PUT /api/sync-bundle）
 *
 * 規範：
 * - UI 層應優先呼叫本檔公開之 async 方法，不直接 localStorage.setItem。
 * - remote：啟動時由 {@link initRemoteSyncOnAppLoad} 先 GET 合併本地；寫入後推送整包。
 */
import { getStorageMode, type StorageMode } from './storageMode';
import {
  awaitRemotePushIdle,
  pushRemoteBundle,
  withRemoteStorageRead,
  withRemoteStorageWrite,
  withRemoteStorageWriteDeferPush,
} from './remoteSyncHub';
import { resolveOrderStallStorageScopeId } from '../lib/scopedStallDateKey';
import * as accountingLedger from '../lib/accountingLedgerStorage';
import * as orderHistory from '../lib/orderHistoryStorage';
import * as stallInventory from '../lib/stallInventoryStorage';
import * as salesRecord from '../lib/salesRecordStorage';
import * as userCatalog from '../lib/userCatalogState';
import * as costStructure from '../lib/costStructureStorage';
import * as procurementFavoritesStorage from '../lib/procurementFavoritesStorage';
import {
  buildDongshanDataBundle,
  importDongshanDataBundle,
  serializeDongshanDataBundle,
  type DongshanDataBundleV1,
  type DongshanStorageKey,
  type ImportBundleResult,
} from '../lib/appDataBundle';
import * as credentialStorage from '../lib/credentialStorage';
import {
  confirmPasswordResetWithOtp,
  requestPasswordResetByEmail,
} from '../lib/passwordResetOtp';
import { reportUserError } from '../lib/userErrorReport';
import * as systemUsers from '../lib/systemUsersStorage';
import { getStoreCode3, setStoreCode3 } from '../lib/storeCodeStorage';
import * as dataArchive from '../lib/dataArchiveStorage';
import { roundProcurementQty } from '../lib/stallMath';

export {
  awaitRemotePushIdle,
  initRemoteSyncOnAppLoad,
  pushRemoteIfLocalBundleChangedSince,
  refreshRemoteBundleVersionIfStale,
  syncRemoteAfterDirectLocalMutation,
  withRemoteStorageRead,
  withRemoteStorageWrite,
  withRemoteStorageWriteDeferPush,
  hasPendingRemotePush,
} from './remoteSyncHub';
export type { RemoteSyncStatus } from './remoteSyncHub';
export {
  getRemoteSyncStatus,
  isRemoteSyncLocked,
  REMOTE_SYNC_STATUS_EVENT,
  REMOTE_SYNC_VERSION_CONFLICT_EVENT,
} from './remoteSyncHub';

// User-facing writes should update local state first and sync the full bundle in
// the background. If the local write fails, surface a copyable report immediately.
async function withUiRemoteStorageWrite<T>(
  fn: () => T | Promise<T>,
  action = '資料儲存',
): Promise<T> {
  try {
    return await withRemoteStorageWriteDeferPush(fn);
  } catch (error) {
    reportUserError({
      title: '資料儲存失敗',
      message: error instanceof Error && error.message.trim()
        ? error.message
        : '資料儲存時發生錯誤，請截圖或複製錯誤資訊後回報管理員。',
      source: 'apiService',
      action,
      error,
    });
    throw error;
  }
}

async function withUiRemoteStorageWriteNow<T>(
  fn: () => T | Promise<T>,
  action = '資料儲存',
  dirtyKeys?: readonly DongshanStorageKey[],
): Promise<T> {
  try {
    if (getStorageMode() !== 'remote') {
      return await withRemoteStorageWrite(fn);
    }

    const before = serializeDongshanDataBundle();
    const out = await Promise.resolve(fn());
    const after = serializeDongshanDataBundle();
    if (after !== before) {
      await pushRemoteBundle(after, dirtyKeys);
    }
    return out;
  } catch (error) {
    reportUserError({
      title: '資料儲存失敗',
      message: error instanceof Error && error.message.trim()
        ? error.message
        : '資料儲存時發生錯誤，請截圖或複製錯誤資訊後回報管理員。',
      source: 'apiService',
      action,
      error,
    });
    throw error;
  }
}

// ——— 流水帳 ———

export const ledger = {
  async listEntries(): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withRemoteStorageRead(() => accountingLedger.listAccountingLedgerEntries());
  },
  async listForMonth(ym: string): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withRemoteStorageRead(() => accountingLedger.listAccountingLedgerEntriesForMonth(ym));
  },
  async listInRange(startYmd: string, endYmd: string): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withRemoteStorageRead(() =>
      accountingLedger.listAccountingLedgerEntriesInDateRange(startYmd, endYmd),
    );
  },
  async listForScopeId(scopeId: string): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withRemoteStorageRead(() => accountingLedger.listAccountingLedgerEntriesForScopeId(scopeId));
  },
  async append(input: accountingLedger.NewAccountingLedgerInput): Promise<accountingLedger.AccountingLedgerEntry> {
    return withUiRemoteStorageWrite(() => accountingLedger.appendAccountingLedgerEntry(input), '新增流水帳');
  },
  async update(id: string, patch: accountingLedger.AccountingLedgerUpdate): Promise<boolean> {
    return withUiRemoteStorageWrite(() => accountingLedger.updateAccountingLedgerEntry(id, patch), '更新流水帳');
  },
  async remove(id: string): Promise<boolean> {
    return withUiRemoteStorageWrite(() => accountingLedger.removeAccountingLedgerEntry(id), '刪除流水帳');
  },
  async sumForMonth(ym: string, flow: accountingLedger.AccountingFlowType): Promise<number> {
    return withRemoteStorageRead(() => accountingLedger.sumAccountingLedgerForMonth(ym, flow));
  },
};

export type { AccountingLedgerEntry, NewAccountingLedgerInput, AccountingLedgerUpdate } from '../lib/accountingLedgerStorage';

// ——— 訂單 ———

type BasisDeductionContext = {
  basisYmd: string;
  scopeId: string;
};

function getBasisDeductionContext(basisOrderId: string): BasisDeductionContext | null {
  const basisYmd = stallInventory.getOrderStallCountBasisYmdForDeduction(basisOrderId);
  const basisOrder = orderHistory.readMergedOrderByIdFromStores(basisOrderId);
  if (!basisYmd || !basisOrder) return null;
  return {
    basisYmd,
    scopeId: resolveOrderStallStorageScopeId(basisOrder),
  };
}

function applyBasisRemainDeduction(
  basisOrderId: string,
  toDeduct: Record<string, number>,
): boolean {
  if (Object.keys(toDeduct).length === 0) return true;
  const ctx = getBasisDeductionContext(basisOrderId);
  if (!ctx) return false;
  stallInventory.ensureBasisDayFromOrderSnapshot(basisOrderId);
  stallInventory.applyOrderDeductionToDayRemain(ctx.basisYmd, toDeduct, ctx.scopeId);
  return true;
}

function restoreBasisRemainDeduction(
  basisOrderId: string,
  restoredQty: Record<string, number>,
): boolean {
  if (Object.keys(restoredQty).length === 0) return true;
  const ctx = getBasisDeductionContext(basisOrderId);
  if (!ctx) return false;
  stallInventory.restoreOrderDeductionToDayRemain(ctx.basisYmd, restoredQty, ctx.scopeId);
  return true;
}

function orderLinesForRemainDeduction(lines: orderHistory.OrderHistoryLine[]) {
  return lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty }));
}

export const orders = {
  async loadOrderHistory(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withRemoteStorageRead(() => orderHistory.loadOrderHistory());
  },
  async loadFranchiseManagementOrders(): Promise<orderHistory.FranchiseManagementOrder[]> {
    return withRemoteStorageRead(() => orderHistory.loadFranchiseManagementOrders());
  },
  async loadCompletedOrderHistoryList(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withRemoteStorageRead(() => orderHistory.loadCompletedOrderHistoryList());
  },
  async loadCompletedOrderHistoryListForRole(
    role: orderHistory.OrderActorRole,
  ): Promise<orderHistory.OrderHistoryEntry[]> {
    return withRemoteStorageRead(() => orderHistory.loadCompletedOrderHistoryListForRole(role));
  },
  async deleteOrderByIdFromAnyStore(orderId: string): Promise<boolean> {
    const ok = await withUiRemoteStorageWrite(() =>
      orderHistory.deleteOrderByIdFromAnyStore(orderId),
      '刪除訂單',
    );
    if (ok && getStorageMode() === 'remote') void awaitRemotePushIdle();
    return ok;
  },
  async updateFranchiseManagementOrderStatus(
    id: string,
    status: orderHistory.FranchiseOrderStatus,
  ): Promise<void> {
    return withUiRemoteStorageWriteNow(() => {
      orderHistory.updateFranchiseManagementOrderStatus(id, status);
    }, '更新加盟訂單狀態');
  },
  async updateOrderHistoryStatus(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withUiRemoteStorageWriteNow(() => {
      orderHistory.updateOrderHistoryStatus(id, status);
    }, '更新訂單狀態');
  },
  async updateOrderStatusInEitherStore(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withUiRemoteStorageWriteNow(() => {
      orderHistory.updateOrderStatusInEitherStore(id, status);
    }, '更新訂單狀態');
  },
  async updatePendingOrderLinesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.UpdateLinesResult> {
    return withUiRemoteStorageWrite(() => orderHistory.updatePendingOrderLinesById(id, nextLines), '調整待出貨訂單貨量');
  },
  async updateEditableOrderLinesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.UpdateEditableOrderLinesResult> {
    return withUiRemoteStorageWrite(() => {
      const res = orderHistory.updateEditableOrderLinesById(id, nextLines);
      if (res.ok) stallInventory.syncStallOutAfterOrderLinesChanged(id);
      return res;
    }, '調整訂單貨量');
  },
  async adminPatchOrderLineUnitPricesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.AdminPatchOrderUnitPricesResult> {
    return withUiRemoteStorageWrite(() => orderHistory.adminPatchOrderLineUnitPricesById(id, nextLines), '更正訂單批價');
  },
  async appendProcurementOrderEntry(params: {
    lines: orderHistory.OrderHistoryLine[];
    totalAmount: number;
    payableAmount?: number;
    selfSuppliedCostAmount?: number;
    actorRole: orderHistory.OrderActorRole;
    orderDateYmd: string;
    procurementDeductionBasisOrderId?: string;
    procurementDeductionBasisOrderIds?: string[];
  }): Promise<string> {
    return withUiRemoteStorageWrite(() => {
      const basisOrderIds = orderHistory.normalizeProcurementDeductionBasisOrderIds({
        procurementDeductionBasisOrderId: params.procurementDeductionBasisOrderId,
        procurementDeductionBasisOrderIds: params.procurementDeductionBasisOrderIds,
      });
      const totalDeductByProductId: Record<string, number> = {};
      const appliedQtyByBasisOrderId: Record<string, Record<string, number>> = {};
      for (const basisOrderId of basisOrderIds) {
        if (!getBasisDeductionContext(basisOrderId)) continue;
        const remainingLines = params.lines.map((l) => ({
          ...l,
          qty: Math.max(0, roundProcurementQty(Number(l.qty) - (totalDeductByProductId[l.productId] ?? 0))),
        }));
        const toDeduct = stallInventory.buildProcurementRemainDeductionsFromLines(
          basisOrderId,
          orderLinesForRemainDeduction(remainingLines),
        );
        if (Object.keys(toDeduct).length > 0) {
          appliedQtyByBasisOrderId[basisOrderId] = toDeduct;
          for (const [productId, qty] of Object.entries(toDeduct)) {
            totalDeductByProductId[productId] = roundProcurementQty(
              (totalDeductByProductId[productId] ?? 0) + qty,
            );
          }
          applyBasisRemainDeduction(basisOrderId, toDeduct);
        }
      }
      return orderHistory.appendProcurementOrderEntry({
        ...params,
        procurementDeductionBasisOrderId: basisOrderIds[0] ?? params.procurementDeductionBasisOrderId,
        procurementDeductionBasisOrderIds: basisOrderIds,
        procurementDeductionAppliedQtyByBasisOrderId:
          Object.keys(appliedQtyByBasisOrderId).length > 0 ? appliedQtyByBasisOrderId : undefined,
      });
    }, '更新盤點快照');
  },
  async applyProcurementDeductionBasisAfterSubmit(params: {
    orderId: string;
    basisOrderId: string;
    basisOrderIds?: string[];
  }): Promise<
    orderHistory.ApplyProcurementDeductionBasisResult | { ok: false; reason: 'basis_not_found' }
  > {
    return withUiRemoteStorageWrite(() => {
      const orderId = params.orderId.trim();
      const basisOrderIds = orderHistory.normalizeProcurementDeductionBasisOrderIds({
        procurementDeductionBasisOrderId: params.basisOrderId,
        procurementDeductionBasisOrderIds: params.basisOrderIds,
      });
      if (basisOrderIds.length === 0) return { ok: false, reason: 'basis_not_found' };

      const order = orderHistory.readMergedOrderByIdFromStores(orderId);
      if (!order) return { ok: false, reason: 'not_found' };

      const totalDeductByProductId: Record<string, number> = {};
      const appliedQtyByBasisOrderId: Record<string, Record<string, number>> = {};
      for (const basisOrderId of basisOrderIds) {
        if (!getBasisDeductionContext(basisOrderId)) {
          return { ok: false, reason: 'basis_not_found' };
        }
        const remainingLines = order.lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          qty: Math.max(0, Number(l.qty) - (totalDeductByProductId[l.productId] ?? 0)),
        }));
        const toDeduct = stallInventory.buildProcurementRemainDeductionsFromLines(
          basisOrderId,
          remainingLines,
          { excludeOrderId: orderId },
        );
        if (Object.keys(toDeduct).length === 0) continue;
        appliedQtyByBasisOrderId[basisOrderId] = toDeduct;
        for (const [productId, qty] of Object.entries(toDeduct)) {
          totalDeductByProductId[productId] = Math.round(((totalDeductByProductId[productId] ?? 0) + qty) * 1000) / 1000;
        }
      }
      const nextLines = order.lines.map((line) => {
        const deduct = Number(totalDeductByProductId[line.productId] ?? 0) || 0;
        return {
          ...line,
          qty: Math.max(0, Math.round((Number(line.qty) - deduct) * 1000) / 1000),
        };
      });
      const patchRes = orderHistory.updateProcurementDeductionBasisOrderLinesInEitherStore(
        orderId,
        basisOrderIds,
        nextLines,
        appliedQtyByBasisOrderId,
      );
      if (!patchRes.ok) return patchRes;

      for (const basisOrderId of basisOrderIds) {
        const toDeduct = appliedQtyByBasisOrderId[basisOrderId];
        if (!toDeduct) continue;
        if (!applyBasisRemainDeduction(basisOrderId, toDeduct)) {
          return { ok: false, reason: 'basis_not_found' };
        }
      }
      stallInventory.syncStallOutAfterOrderLinesChanged(orderId);
      return { ok: true };
    }, '套用扣除餘貨訂單');
  },
  async removeProcurementDeductionBasisFromOrder(params: {
    orderId: string;
    basisOrderId: string;
  }): Promise<orderHistory.RemoveProcurementDeductionBasisResult | { ok: false; reason: 'basis_not_found' }> {
    return withUiRemoteStorageWrite(() => {
      const orderId = params.orderId.trim();
      const basisOrderId = params.basisOrderId.trim();
      if (!getBasisDeductionContext(basisOrderId)) return { ok: false, reason: 'basis_not_found' };
      const res = orderHistory.removeProcurementDeductionBasisOrderIdInEitherStore(orderId, basisOrderId);
      if (!res.ok) return res;
      if (!restoreBasisRemainDeduction(basisOrderId, res.restoredQty)) {
        return { ok: false, reason: 'basis_not_found' };
      }
      stallInventory.syncStallOutAfterOrderLinesChanged(orderId);
      return res;
    }, '移除扣除餘貨訂單');
  },
  async setOrderStallCountStamp(
    orderId: string,
    fields: {
      basisYmd: string;
      completedAt: string;
      snapshot: import('../lib/salesRecordStorage').SalesRecordDaySnapshot;
    },
  ): Promise<boolean> {
    return withUiRemoteStorageWrite(() => orderHistory.setOrderStallCountStamp(orderId, fields), '寫入盤點完成紀錄');
  },
  async commitStallInventoryComplete(params: {
    orderId: string;
    basisYmd: string;
    completedAt: string;
    recordSnap: import('../lib/salesRecordStorage').SalesRecordDaySnapshot;
    stallDaySnap: stallInventory.DaySnapshot;
    scopeId?: string;
  }): Promise<stallInventory.CommitStallInventoryCompleteResult> {
    const res = await withUiRemoteStorageWrite(() =>
      stallInventory.commitStallInventoryComplete(params),
      '完成攤上盤點',
    );
    if (res.ok && getStorageMode() === 'remote') {
      void awaitRemotePushIdle();
    }
    return res;
  },
  async updateStallCountSnapshotByOrderId(
    orderId: string,
    snapshot: import('../lib/salesRecordStorage').SalesRecordDaySnapshot,
  ): Promise<orderHistory.UpdateStallSnapshotResult> {
    const res = await withUiRemoteStorageWrite(() => {
      const inner = orderHistory.updateStallCountSnapshotByOrderId(orderId, snapshot);
      if (inner.ok) stallInventory.syncBasisDayFromOrderSnapshot(orderId);
      return inner;
    }, '送出叫貨訂單');
    if (res.ok && getStorageMode() === 'remote') void awaitRemotePushIdle();
    return res;
  },
  async updateOrderDateYmdByOrderId(
    orderId: string,
    orderDateYmd: string,
  ): Promise<orderHistory.UpdateOrderDateYmdResult> {
    return withUiRemoteStorageWrite(() => orderHistory.updateOrderDateYmdByOrderId(orderId, orderDateYmd), '更新訂單日期');
  },
  async listOrdersWithStallCountCompleted(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withRemoteStorageRead(() => orderHistory.listOrdersWithStallCountCompleted());
  },
};

// ——— 銷售紀錄 ———

export const salesRecords = {
  async get(ymd: string, scopeId?: string): Promise<salesRecord.SalesRecordDaySnapshot | null> {
    return withRemoteStorageRead(() => salesRecord.getSalesRecord(ymd, scopeId));
  },
  async patchRevenueGapReason(ymd: string, reason: string, scopeId?: string): Promise<void> {
    return withUiRemoteStorageWrite(() => salesRecord.patchSalesRecordRevenueGapReason(ymd, reason, scopeId), '更新銷售落差原因');
  },
  async listMeta(scopeId?: string) {
    return withRemoteStorageRead(() => salesRecord.listSalesRecordMeta(scopeId));
  },
  async listSnapshots(scopeId?: string) {
    return withRemoteStorageRead(() => salesRecord.listSalesRecordSnapshots(scopeId));
  },
  async save(ymd: string, snapshot: salesRecord.SalesRecordDaySnapshot, scopeId?: string): Promise<void> {
    return withUiRemoteStorageWrite(() => salesRecord.saveSalesRecord(ymd, snapshot, scopeId), '儲存銷售紀錄');
  },
};

export type { SalesRecordDaySnapshot } from '../lib/salesRecordStorage';

// ——— 攤上盤點 ———

export const stallInventoryApi = {
  async saveDay(
    ymdStr: string,
    snap: stallInventory.DaySnapshot,
    scopeId?: string,
    options?: { deferRemotePush?: boolean },
  ): Promise<void> {
    void options;
    return withUiRemoteStorageWrite(() => stallInventory.saveDay(ymdStr, snap, scopeId), '儲存攤上盤點');
  },
  async loadDay(ymdStr: string, scopeId?: string): Promise<stallInventory.DaySnapshot> {
    return withRemoteStorageRead(() => stallInventory.loadDay(ymdStr, scopeId));
  },
};

export type { DaySnapshot } from '../lib/stallInventoryStorage';

export const procurementFavorites = {
  async list(): Promise<procurementFavoritesStorage.FavoriteOrder[]> {
    return withRemoteStorageRead(() => procurementFavoritesStorage.listProcurementFavorites());
  },
  async add(
    name: string,
    cart: Record<string, number>,
  ): Promise<ReturnType<typeof procurementFavoritesStorage.addProcurementFavorite>> {
    return withUiRemoteStorageWriteNow(
      () => procurementFavoritesStorage.addProcurementFavorite(name, cart),
      '儲存常用訂單',
      ['dongshan_procurement_favorites_v1'],
    );
  },
  async remove(id: string): Promise<void> {
    return withUiRemoteStorageWriteNow(
      () => procurementFavoritesStorage.removeProcurementFavorite(id),
      '刪除常用訂單',
      ['dongshan_procurement_favorites_v1'],
    );
  },
};

export type { FavoriteOrder } from '../lib/procurementFavoritesStorage';

export type {
  OrderHistoryEntry,
  OrderHistoryLine,
  FranchiseManagementOrder,
  FranchiseOrderStatus,
  OrderActorRole,
  UpdateLinesResult,
  UpdateEditableOrderLinesResult,
  UpdateStallSnapshotResult,
  AdminPatchOrderUnitPricesResult,
} from '../lib/orderHistoryStorage';

// ——— 產品（品項庫 + 成本結構表）———

export const products = {
  catalog: {
    async loadUserCatalogState(): Promise<ReturnType<typeof userCatalog.loadUserCatalogState>> {
      return withRemoteStorageRead(() => userCatalog.loadUserCatalogState());
    },
    async setSupplyItemOverride(id: string, patch: userCatalog.ItemOverride): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.setSupplyItemOverride(id, patch);
      });
    },
    async clearSupplyItemOverride(id: string): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.clearSupplyItemOverride(id);
      });
    },
    async hideBaseItem(id: string): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.hideBaseItem(id);
      });
    },
    async unhideBaseItem(id: string): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.unhideBaseItem(id);
      });
    },
    async addCustomItem(init?: Parameters<typeof userCatalog.addCustomItem>[0]): Promise<string> {
      return withUiRemoteStorageWrite(() => userCatalog.addCustomItem(init));
    },
    async updateCustomItem(id: string, patch: Parameters<typeof userCatalog.updateCustomItem>[1]): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.updateCustomItem(id, patch);
      });
    },
    async removeCustomItem(id: string): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.removeCustomItem(id);
      });
    },
    async clearAllUserCatalog(): Promise<void> {
      return withUiRemoteStorageWrite(() => {
        userCatalog.clearAllUserCatalog();
      });
    },
  },
  cost: {
    async getSnapshot(): Promise<ReturnType<typeof costStructure.getCostStructureSnapshot>> {
      return withRemoteStorageRead(() => costStructure.getCostStructureSnapshot());
    },
    async listCostCategories(): Promise<string[]> {
      return withRemoteStorageRead(() => costStructure.listCostCategories());
    },
    async addCostColumn(label: string, kind?: costStructure.CostFieldKind): Promise<costStructure.CostColumn> {
      return withUiRemoteStorageWrite(() => costStructure.addCostColumn(label, kind));
    },
    async updateCostColumn(
      id: string,
      patch: Partial<Pick<costStructure.CostColumn, 'label' | 'kind'>>,
    ): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.updateCostColumn(id, patch));
    },
    async moveCostColumn(id: string, delta: -1 | 1): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.moveCostColumn(id, delta));
    },
    async removeCostColumn(id: string): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.removeCostColumn(id));
    },
    async addCostItem(input: costStructure.AddCostItemInput): Promise<costStructure.CostItem> {
      return withUiRemoteStorageWrite(() => costStructure.addCostItem(input));
    },
    async updateCostItem(id: string, patch: costStructure.UpdateCostItemPatch): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.updateCostItem(id, patch));
    },
    async setCostItemValue(itemId: string, columnId: string, raw: string): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.setCostItemValue(itemId, columnId, raw));
    },
    async removeCostItem(id: string): Promise<boolean> {
      return withUiRemoteStorageWrite(() => costStructure.removeCostItem(id));
    },
  },
};

export type { ItemOverride } from '../lib/userCatalogState';
export type { CostColumn, CostItem, CostFieldKind, AddCostItemInput, UpdateCostItemPatch } from '../lib/costStructureStorage';

// ——— 權限／店號（本機目錄）———

export type CreateUserPayload = systemUsers.NewSystemUserInput & { initialPassword?: string };

export type UpdateAccountPayload = systemUsers.SystemUserUpdate & { newPassword?: string };

function normalizeLoginId(s: string): string {
  return s.trim().toLowerCase();
}

export const accounts = {
  async listUsers(): Promise<systemUsers.SystemUser[]> {
    return withRemoteStorageRead(() => systemUsers.listSystemUsers());
  },
  async createUser(input: CreateUserPayload): Promise<systemUsers.SystemUser> {
    return withUiRemoteStorageWrite(() => {
      const { initialPassword, ...rest } = input;
      if (rest.loginId?.trim() && !initialPassword?.trim()) {
        throw new Error('建立登入帳號時必須提供初始密碼。');
      }
      if (initialPassword?.trim() && !rest.loginId?.trim()) {
        throw new Error('設定初始密碼時必須提供登入帳號。');
      }
      const u = systemUsers.createSystemUser(rest);
      try {
        if (rest.loginId?.trim() && initialPassword) {
          credentialStorage.registerCredential(rest.loginId, initialPassword);
        }
      } catch (e) {
        systemUsers.removeSystemUser(u.id);
        throw e;
      }
      return u;
    });
  },
  async updateUser(id: string, patch: UpdateAccountPayload): Promise<boolean> {
    return withUiRemoteStorageWrite(() => {
      const { newPassword, ...userPatch } = patch;
      const cur = systemUsers.listSystemUsers().find((u) => u.id === id);
      const oldLogin = cur?.loginId;
      const ok = systemUsers.updateSystemUser(id, userPatch);
      if (!ok) return false;
      const refreshed = systemUsers.listSystemUsers().find((u) => u.id === id);
      const newLogin = refreshed?.loginId;
      if (oldLogin && newLogin && normalizeLoginId(oldLogin) !== normalizeLoginId(newLogin)) {
        credentialStorage.migrateCredential(oldLogin, newLogin);
      }
      if (newPassword?.trim()) {
        const lid = refreshed?.loginId;
        if (!lid) throw new Error('更新密碼前必須先設定登入帳號。');
        credentialStorage.setCredential(lid, newPassword);
      }
      return true;
    });
  },
  async removeUser(id: string): Promise<boolean> {
    return withUiRemoteStorageWrite(() => {
      const cur = systemUsers.listSystemUsers().find((u) => u.id === id);
      const ok = systemUsers.removeSystemUser(id);
      if (ok && cur?.loginId) credentialStorage.removeCredential(cur.loginId);
      return ok;
    });
  },
  async setUserPassword(loginId: string, newPassword: string): Promise<void> {
    return withUiRemoteStorageWrite(() => {
      credentialStorage.setCredential(loginId, newPassword);
    });
  },
  /** 已登入者變更自己的密碼（須通過目前密碼）；remote 模式會一併推送 bundle，避免下次載入被舊雲端覆蓋） */
  async changeOwnPassword(loginId: string, currentPassword: string, newPassword: string): Promise<void> {
    return withUiRemoteStorageWrite(() => {
      credentialStorage.changeCredential(loginId, currentPassword, newPassword);
    });
  },
};

export type { SystemUser, SystemUserRole, SystemUserStatus, NewSystemUserInput, SystemUserUpdate } from '../lib/systemUsersStorage';

export const passwordReset = {
  async requestCode(email: string) {
    return withUiRemoteStorageWrite(() => requestPasswordResetByEmail(email));
  },
  async confirm(email: string, code: string, newPassword: string) {
    return withUiRemoteStorageWrite(() => confirmPasswordResetWithOtp(email, code, newPassword));
  },
};

export const storeSettings = {
  async getStoreCode3(): Promise<string> {
    return withRemoteStorageRead(() => getStoreCode3());
  },
  async setStoreCode3(code: string): Promise<void> {
    return withUiRemoteStorageWrite(() => {
      setStoreCode3(code);
    });
  },
};

// ——— 全量 bundle（數據中心／備份）———

export const dataBundle = {
  async serialize(): Promise<string> {
    return withRemoteStorageRead(() => serializeDongshanDataBundle());
  },
  async build(): Promise<DongshanDataBundleV1> {
    return withRemoteStorageRead(() => buildDongshanDataBundle());
  },
  async importBundle(raw: unknown): Promise<ImportBundleResult> {
    return withRemoteStorageWrite(() => importDongshanDataBundle(raw));
  },
};

export const archives = {
  async list(): Promise<dataArchive.DataArchiveEntry[]> {
    return withRemoteStorageRead(() => dataArchive.listDataArchives());
  },
  async archiveOlderThan(cutoffYmd: string): Promise<dataArchive.ArchiveDataResult> {
    return withUiRemoteStorageWriteNow(
      () => dataArchive.archiveDataOlderThan(cutoffYmd),
      '封存舊資料',
    );
  },
  async restore(id: string): Promise<boolean> {
    return withUiRemoteStorageWriteNow(
      () => dataArchive.restoreDataArchive(id),
      '還原封存資料',
    );
  },
};

export { getStorageMode, getApiBaseUrl, getAsyncStorageDelayMs, type StorageMode } from './storageMode';

