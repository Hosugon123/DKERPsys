/**
 * 資料存取抽象層（達客 ERP → 本機 lib/*Storage ｜ remote 時自動 PUT /api/sync-bundle）
 *
 * 規範：
 * - UI 層應優先呼叫本檔公開之 async 方法，不直接 localStorage.setItem。
 * - remote：啟動時由 {@link initRemoteSyncOnAppLoad} 先 GET 覆蓋本地；每次寫入後自動推送整包。
 */
import { getStorageMode, type StorageMode } from './storageMode';
import { awaitRemotePushIdle, withRemoteStorageRead, withRemoteStorageWrite, withRemoteStorageWriteDeferPush } from './remoteSyncHub';
import { resolveOrderStallStorageScopeId } from '../lib/scopedStallDateKey';
import * as accountingLedger from '../lib/accountingLedgerStorage';
import * as orderHistory from '../lib/orderHistoryStorage';
import * as stallInventory from '../lib/stallInventoryStorage';
import * as salesRecord from '../lib/salesRecordStorage';
import * as userCatalog from '../lib/userCatalogState';
import * as costStructure from '../lib/costStructureStorage';
import {
  buildDongshanDataBundle,
  importDongshanDataBundle,
  serializeDongshanDataBundle,
  type DongshanDataBundleV1,
  type ImportBundleResult,
} from '../lib/appDataBundle';
import * as credentialStorage from '../lib/credentialStorage';
import {
  confirmPasswordResetWithOtp,
  requestPasswordResetByEmail,
} from '../lib/passwordResetOtp';
import * as systemUsers from '../lib/systemUsersStorage';
import { getStoreCode3, setStoreCode3 } from '../lib/storeCodeStorage';

export {
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
    return withRemoteStorageWrite(() => accountingLedger.appendAccountingLedgerEntry(input));
  },
  async update(id: string, patch: accountingLedger.AccountingLedgerUpdate): Promise<boolean> {
    return withRemoteStorageWrite(() => accountingLedger.updateAccountingLedgerEntry(id, patch));
  },
  async remove(id: string): Promise<boolean> {
    return withRemoteStorageWrite(() => accountingLedger.removeAccountingLedgerEntry(id));
  },
  async sumForMonth(ym: string, flow: accountingLedger.AccountingFlowType): Promise<number> {
    return withRemoteStorageRead(() => accountingLedger.sumAccountingLedgerForMonth(ym, flow));
  },
};

export type { AccountingLedgerEntry, NewAccountingLedgerInput, AccountingLedgerUpdate } from '../lib/accountingLedgerStorage';

// ——— 訂單 ———

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
    const ok = await withRemoteStorageWrite(() =>
      orderHistory.deleteOrderByIdFromAnyStore(orderId),
    );
    if (ok && getStorageMode() === 'remote') await awaitRemotePushIdle();
    return ok;
  },
  async updateFranchiseManagementOrderStatus(
    id: string,
    status: orderHistory.FranchiseOrderStatus,
  ): Promise<void> {
    return withRemoteStorageWrite(() => {
      orderHistory.updateFranchiseManagementOrderStatus(id, status);
    });
  },
  async updateOrderHistoryStatus(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withRemoteStorageWrite(() => {
      orderHistory.updateOrderHistoryStatus(id, status);
    });
  },
  async updateOrderStatusInEitherStore(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withRemoteStorageWrite(() => {
      orderHistory.updateOrderStatusInEitherStore(id, status);
    });
  },
  async updatePendingOrderLinesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.UpdateLinesResult> {
    return withRemoteStorageWrite(() => orderHistory.updatePendingOrderLinesById(id, nextLines));
  },
  async updateEditableOrderLinesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.UpdateEditableOrderLinesResult> {
    return withRemoteStorageWrite(() => {
      const res = orderHistory.updateEditableOrderLinesById(id, nextLines);
      if (res.ok) stallInventory.syncStallOutAfterOrderLinesChanged(id);
      return res;
    });
  },
  async adminPatchOrderLineUnitPricesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.AdminPatchOrderUnitPricesResult> {
    return withRemoteStorageWrite(() => orderHistory.adminPatchOrderLineUnitPricesById(id, nextLines));
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
    return withRemoteStorageWrite(() => {
      const basisOrderIds = orderHistory.normalizeProcurementDeductionBasisOrderIds({
        procurementDeductionBasisOrderId: params.procurementDeductionBasisOrderId,
        procurementDeductionBasisOrderIds: params.procurementDeductionBasisOrderIds,
      });
      const appliedQtyByBasisOrderId: Record<string, Record<string, number>> = {};
      for (const basisOrderId of basisOrderIds) {
        const basisYmd = stallInventory.getOrderStallCountBasisYmdForDeduction(basisOrderId);
        if (!basisYmd) continue;
        const basisOrder = basisOrderId
          ? orderHistory.readMergedOrderByIdFromStores(basisOrderId)
          : null;
        const scopeId = basisOrder ? resolveOrderStallStorageScopeId(basisOrder) : undefined;
        const toDeduct = stallInventory.buildProcurementRemainDeductionsFromLines(
          basisOrderId,
          params.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty })),
        );
        if (Object.keys(toDeduct).length > 0) {
          appliedQtyByBasisOrderId[basisOrderId] = toDeduct;
          stallInventory.ensureBasisDayFromOrderSnapshot(basisOrderId);
          stallInventory.applyOrderDeductionToDayRemain(basisYmd, toDeduct, scopeId);
        }
      }
      return orderHistory.appendProcurementOrderEntry({
        ...params,
        procurementDeductionBasisOrderId: basisOrderIds[0] ?? params.procurementDeductionBasisOrderId,
        procurementDeductionBasisOrderIds: basisOrderIds,
        procurementDeductionAppliedQtyByBasisOrderId:
          Object.keys(appliedQtyByBasisOrderId).length > 0 ? appliedQtyByBasisOrderId : undefined,
      });
    });
  },
  async applyProcurementDeductionBasisAfterSubmit(params: {
    orderId: string;
    basisOrderId: string;
    basisOrderIds?: string[];
  }): Promise<
    orderHistory.ApplyProcurementDeductionBasisResult | { ok: false; reason: 'basis_not_found' }
  > {
    return withRemoteStorageWrite(() => {
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
        const basisYmd = stallInventory.getOrderStallCountBasisYmdForDeduction(basisOrderId);
        if (!basisYmd) return { ok: false, reason: 'basis_not_found' };
        const basisOrder = orderHistory.readMergedOrderByIdFromStores(basisOrderId);
        if (!basisOrder) return { ok: false, reason: 'basis_not_found' };
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
        const basisYmd = stallInventory.getOrderStallCountBasisYmdForDeduction(basisOrderId);
        const basisOrder = orderHistory.readMergedOrderByIdFromStores(basisOrderId);
        if (!basisYmd || !basisOrder) continue;
        const scopeId = resolveOrderStallStorageScopeId(basisOrder);
        stallInventory.ensureBasisDayFromOrderSnapshot(basisOrderId);
        stallInventory.applyOrderDeductionToDayRemain(basisYmd, toDeduct, scopeId);
      }
      return { ok: true };
    });
  },
  async removeProcurementDeductionBasisFromOrder(params: {
    orderId: string;
    basisOrderId: string;
  }): Promise<orderHistory.RemoveProcurementDeductionBasisResult | { ok: false; reason: 'basis_not_found' }> {
    return withRemoteStorageWrite(() => {
      const orderId = params.orderId.trim();
      const basisOrderId = params.basisOrderId.trim();
      const basisYmd = stallInventory.getOrderStallCountBasisYmdForDeduction(basisOrderId);
      const basisOrder = orderHistory.readMergedOrderByIdFromStores(basisOrderId);
      if (!basisYmd || !basisOrder) return { ok: false, reason: 'basis_not_found' };
      const res = orderHistory.removeProcurementDeductionBasisOrderIdInEitherStore(orderId, basisOrderId);
      if (!res.ok) return res;
      if (Object.keys(res.restoredQty).length > 0) {
        stallInventory.restoreOrderDeductionToDayRemain(
          basisYmd,
          res.restoredQty,
          resolveOrderStallStorageScopeId(basisOrder),
        );
      }
      return res;
    });
  },
  async setOrderStallCountStamp(
    orderId: string,
    fields: {
      basisYmd: string;
      completedAt: string;
      snapshot: import('../lib/salesRecordStorage').SalesRecordDaySnapshot;
    },
  ): Promise<boolean> {
    return withRemoteStorageWrite(() => orderHistory.setOrderStallCountStamp(orderId, fields));
  },
  async commitStallInventoryComplete(params: {
    orderId: string;
    basisYmd: string;
    completedAt: string;
    recordSnap: import('../lib/salesRecordStorage').SalesRecordDaySnapshot;
    stallDaySnap: stallInventory.DaySnapshot;
    scopeId?: string;
  }): Promise<stallInventory.CommitStallInventoryCompleteResult> {
    const res = await withRemoteStorageWriteDeferPush(() =>
      stallInventory.commitStallInventoryComplete(params),
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
    const res = await withRemoteStorageWrite(() => {
      const inner = orderHistory.updateStallCountSnapshotByOrderId(orderId, snapshot);
      if (inner.ok) stallInventory.syncBasisDayFromOrderSnapshot(orderId);
      return inner;
    });
    if (res.ok && getStorageMode() === 'remote') await awaitRemotePushIdle();
    return res;
  },
  async updateOrderDateYmdByOrderId(
    orderId: string,
    orderDateYmd: string,
  ): Promise<orderHistory.UpdateOrderDateYmdResult> {
    return withRemoteStorageWrite(() => orderHistory.updateOrderDateYmdByOrderId(orderId, orderDateYmd));
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
    return withRemoteStorageWrite(() => salesRecord.patchSalesRecordRevenueGapReason(ymd, reason, scopeId));
  },
  async listMeta(scopeId?: string) {
    return withRemoteStorageRead(() => salesRecord.listSalesRecordMeta(scopeId));
  },
  async save(ymd: string, snapshot: salesRecord.SalesRecordDaySnapshot, scopeId?: string): Promise<void> {
    return withRemoteStorageWrite(() => salesRecord.saveSalesRecord(ymd, snapshot, scopeId));
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
    const write = options?.deferRemotePush ? withRemoteStorageWriteDeferPush : withRemoteStorageWrite;
    return write(() => stallInventory.saveDay(ymdStr, snap, scopeId));
  },
  async loadDay(ymdStr: string, scopeId?: string): Promise<stallInventory.DaySnapshot> {
    return withRemoteStorageRead(() => stallInventory.loadDay(ymdStr, scopeId));
  },
};

export type { DaySnapshot } from '../lib/stallInventoryStorage';

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
      return withRemoteStorageWrite(() => {
        userCatalog.setSupplyItemOverride(id, patch);
      });
    },
    async clearSupplyItemOverride(id: string): Promise<void> {
      return withRemoteStorageWrite(() => {
        userCatalog.clearSupplyItemOverride(id);
      });
    },
    async hideBaseItem(id: string): Promise<void> {
      return withRemoteStorageWrite(() => {
        userCatalog.hideBaseItem(id);
      });
    },
    async unhideBaseItem(id: string): Promise<void> {
      return withRemoteStorageWrite(() => {
        userCatalog.unhideBaseItem(id);
      });
    },
    async addCustomItem(init?: Parameters<typeof userCatalog.addCustomItem>[0]): Promise<string> {
      return withRemoteStorageWrite(() => userCatalog.addCustomItem(init));
    },
    async updateCustomItem(id: string, patch: Parameters<typeof userCatalog.updateCustomItem>[1]): Promise<void> {
      return withRemoteStorageWrite(() => {
        userCatalog.updateCustomItem(id, patch);
      });
    },
    async removeCustomItem(id: string): Promise<void> {
      return withRemoteStorageWrite(() => {
        userCatalog.removeCustomItem(id);
      });
    },
    async clearAllUserCatalog(): Promise<void> {
      return withRemoteStorageWrite(() => {
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
      return withRemoteStorageWrite(() => costStructure.addCostColumn(label, kind));
    },
    async updateCostColumn(
      id: string,
      patch: Partial<Pick<costStructure.CostColumn, 'label' | 'kind'>>,
    ): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.updateCostColumn(id, patch));
    },
    async moveCostColumn(id: string, delta: -1 | 1): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.moveCostColumn(id, delta));
    },
    async removeCostColumn(id: string): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.removeCostColumn(id));
    },
    async addCostItem(input: costStructure.AddCostItemInput): Promise<costStructure.CostItem> {
      return withRemoteStorageWrite(() => costStructure.addCostItem(input));
    },
    async updateCostItem(id: string, patch: costStructure.UpdateCostItemPatch): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.updateCostItem(id, patch));
    },
    async setCostItemValue(itemId: string, columnId: string, raw: string): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.setCostItemValue(itemId, columnId, raw));
    },
    async removeCostItem(id: string): Promise<boolean> {
      return withRemoteStorageWrite(() => costStructure.removeCostItem(id));
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
    return withRemoteStorageWrite(() => {
      const { initialPassword, ...rest } = input;
      if (rest.loginId?.trim() && !initialPassword?.trim()) {
        throw new Error('已填寫登入帳號時，請一併設定初始密碼。');
      }
      if (initialPassword?.trim() && !rest.loginId?.trim()) {
        throw new Error('設定初始密碼前請先填寫登入帳號。');
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
    return withRemoteStorageWrite(() => {
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
        if (!lid) throw new Error('此帳號尚未設定登入帳號，請先補上登入帳號再重設密碼。');
        credentialStorage.setCredential(lid, newPassword);
      }
      return true;
    });
  },
  async removeUser(id: string): Promise<boolean> {
    return withRemoteStorageWrite(() => {
      const cur = systemUsers.listSystemUsers().find((u) => u.id === id);
      const ok = systemUsers.removeSystemUser(id);
      if (ok && cur?.loginId) credentialStorage.removeCredential(cur.loginId);
      return ok;
    });
  },
  async setUserPassword(loginId: string, newPassword: string): Promise<void> {
    return withRemoteStorageWrite(() => {
      credentialStorage.setCredential(loginId, newPassword);
    });
  },
  /** 已登入者變更自己的密碼（須通過目前密碼）；remote 模式會一併推送 bundle，避免下次載入被舊雲端覆蓋） */
  async changeOwnPassword(loginId: string, currentPassword: string, newPassword: string): Promise<void> {
    return withRemoteStorageWrite(() => {
      credentialStorage.changeCredential(loginId, currentPassword, newPassword);
    });
  },
};

export type { SystemUser, SystemUserRole, SystemUserStatus, NewSystemUserInput, SystemUserUpdate } from '../lib/systemUsersStorage';

export const passwordReset = {
  async requestCode(email: string) {
    return withRemoteStorageWrite(() => requestPasswordResetByEmail(email));
  },
  async confirm(email: string, code: string, newPassword: string) {
    return withRemoteStorageWrite(() => confirmPasswordResetWithOtp(email, code, newPassword));
  },
};

export const storeSettings = {
  async getStoreCode3(): Promise<string> {
    return withRemoteStorageRead(() => getStoreCode3());
  },
  async setStoreCode3(code: string): Promise<void> {
    return withRemoteStorageWrite(() => {
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

export { getStorageMode, getApiBaseUrl, getAsyncStorageDelayMs, type StorageMode } from './storageMode';
