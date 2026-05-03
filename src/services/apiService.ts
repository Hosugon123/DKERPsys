/**
 * 資料存取抽象層（達客 ERP → Cloud Run / Cloud SQL 預備）
 *
 * 規範：
 * - UI 層（Views／與畫面綁定之 Hooks）應優先呼叫本檔公開之 async 方法，不直接 localStorage.setItem。
 * - localStorage 模式下仍委託 lib/*Storage；remote 模式預留，未接 API 前會拋錯。
 */
import { getAsyncStorageDelayMs, getApiBaseUrl, getStorageMode, type StorageMode } from './storageMode';
import * as accountingLedger from '../lib/accountingLedgerStorage';
import * as orderHistory from '../lib/orderHistoryStorage';
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

async function storageTick(): Promise<void> {
  const ms = getAsyncStorageDelayMs();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function assertLocalOrThrow(mode: StorageMode): void {
  if (mode === 'remote') {
    const base = getApiBaseUrl();
    throw new Error(
      base
        ? `VITE_STORAGE_MODE=remote 已設定，但前端尚未接駁 ${base}；請實作 REST 客戶端後再切換。`
        : 'VITE_STORAGE_MODE=remote 時請設定 VITE_API_URL 並實作遠端同步。',
    );
  }
}

async function withLocal<T>(fn: () => T): Promise<T> {
  await storageTick();
  assertLocalOrThrow(getStorageMode());
  return fn();
}

// ——— 流水帳 ———

export const ledger = {
  async listEntries(): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withLocal(() => accountingLedger.listAccountingLedgerEntries());
  },
  async listForMonth(ym: string): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withLocal(() => accountingLedger.listAccountingLedgerEntriesForMonth(ym));
  },
  async listInRange(startYmd: string, endYmd: string): Promise<accountingLedger.AccountingLedgerEntry[]> {
    return withLocal(() => accountingLedger.listAccountingLedgerEntriesInDateRange(startYmd, endYmd));
  },
  async append(input: accountingLedger.NewAccountingLedgerInput): Promise<accountingLedger.AccountingLedgerEntry> {
    return withLocal(() => accountingLedger.appendAccountingLedgerEntry(input));
  },
  async update(id: string, patch: accountingLedger.AccountingLedgerUpdate): Promise<boolean> {
    return withLocal(() => accountingLedger.updateAccountingLedgerEntry(id, patch));
  },
  async remove(id: string): Promise<boolean> {
    return withLocal(() => accountingLedger.removeAccountingLedgerEntry(id));
  },
  async sumForMonth(ym: string, flow: accountingLedger.AccountingFlowType): Promise<number> {
    return withLocal(() => accountingLedger.sumAccountingLedgerForMonth(ym, flow));
  },
};

export type { AccountingLedgerEntry, NewAccountingLedgerInput, AccountingLedgerUpdate } from '../lib/accountingLedgerStorage';

// ——— 訂單 ———

export const orders = {
  async loadOrderHistory(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withLocal(() => orderHistory.loadOrderHistory());
  },
  async loadFranchiseManagementOrders(): Promise<orderHistory.FranchiseManagementOrder[]> {
    return withLocal(() => orderHistory.loadFranchiseManagementOrders());
  },
  async loadCompletedOrderHistoryList(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withLocal(() => orderHistory.loadCompletedOrderHistoryList());
  },
  async loadCompletedOrderHistoryListForRole(
    role: orderHistory.OrderActorRole,
  ): Promise<orderHistory.OrderHistoryEntry[]> {
    return withLocal(() => orderHistory.loadCompletedOrderHistoryListForRole(role));
  },
  async deleteOrderByIdFromAnyStore(orderId: string): Promise<boolean> {
    return withLocal(() => orderHistory.deleteOrderByIdFromAnyStore(orderId));
  },
  async updateFranchiseManagementOrderStatus(
    id: string,
    status: orderHistory.FranchiseOrderStatus,
  ): Promise<void> {
    return withLocal(() => {
      orderHistory.updateFranchiseManagementOrderStatus(id, status);
    });
  },
  async updateOrderHistoryStatus(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withLocal(() => {
      orderHistory.updateOrderHistoryStatus(id, status);
    });
  },
  async updateOrderStatusInEitherStore(id: string, status: orderHistory.FranchiseOrderStatus): Promise<void> {
    return withLocal(() => {
      orderHistory.updateOrderStatusInEitherStore(id, status);
    });
  },
  async updatePendingOrderLinesById(
    id: string,
    nextLines: orderHistory.OrderHistoryLine[],
  ): Promise<orderHistory.UpdateLinesResult> {
    return withLocal(() => orderHistory.updatePendingOrderLinesById(id, nextLines));
  },
  async appendProcurementOrderEntry(params: {
    lines: orderHistory.OrderHistoryLine[];
    totalAmount: number;
    actorRole: orderHistory.OrderActorRole;
  }): Promise<void> {
    return withLocal(() => {
      orderHistory.appendProcurementOrderEntry(params);
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
    return withLocal(() => orderHistory.setOrderStallCountStamp(orderId, fields));
  },
  async updateStallCountSnapshotByOrderId(
    orderId: string,
    snapshot: import('../lib/salesRecordStorage').SalesRecordDaySnapshot,
  ): Promise<orderHistory.UpdateStallSnapshotResult> {
    return withLocal(() => orderHistory.updateStallCountSnapshotByOrderId(orderId, snapshot));
  },
  async listOrdersWithStallCountCompleted(): Promise<orderHistory.OrderHistoryEntry[]> {
    return withLocal(() => orderHistory.listOrdersWithStallCountCompleted());
  },
};

export type {
  OrderHistoryEntry,
  OrderHistoryLine,
  FranchiseManagementOrder,
  FranchiseOrderStatus,
  OrderActorRole,
  UpdateLinesResult,
  UpdateStallSnapshotResult,
} from '../lib/orderHistoryStorage';

// ——— 產品（品項庫 + 成本結構表）———

export const products = {
  catalog: {
    async loadUserCatalogState(): Promise<ReturnType<typeof userCatalog.loadUserCatalogState>> {
      return withLocal(() => userCatalog.loadUserCatalogState());
    },
    async setSupplyItemOverride(id: string, patch: userCatalog.ItemOverride): Promise<void> {
      return withLocal(() => {
        userCatalog.setSupplyItemOverride(id, patch);
      });
    },
    async clearSupplyItemOverride(id: string): Promise<void> {
      return withLocal(() => {
        userCatalog.clearSupplyItemOverride(id);
      });
    },
    async hideBaseItem(id: string): Promise<void> {
      return withLocal(() => {
        userCatalog.hideBaseItem(id);
      });
    },
    async unhideBaseItem(id: string): Promise<void> {
      return withLocal(() => {
        userCatalog.unhideBaseItem(id);
      });
    },
    async addCustomItem(init?: Parameters<typeof userCatalog.addCustomItem>[0]): Promise<string> {
      return withLocal(() => userCatalog.addCustomItem(init));
    },
    async updateCustomItem(id: string, patch: Parameters<typeof userCatalog.updateCustomItem>[1]): Promise<void> {
      return withLocal(() => {
        userCatalog.updateCustomItem(id, patch);
      });
    },
    async removeCustomItem(id: string): Promise<void> {
      return withLocal(() => {
        userCatalog.removeCustomItem(id);
      });
    },
    async clearAllUserCatalog(): Promise<void> {
      return withLocal(() => {
        userCatalog.clearAllUserCatalog();
      });
    },
  },
  cost: {
    async getSnapshot(): Promise<ReturnType<typeof costStructure.getCostStructureSnapshot>> {
      return withLocal(() => costStructure.getCostStructureSnapshot());
    },
    async listCostCategories(): Promise<string[]> {
      return withLocal(() => costStructure.listCostCategories());
    },
    async addCostColumn(label: string, kind?: costStructure.CostFieldKind): Promise<costStructure.CostColumn> {
      return withLocal(() => costStructure.addCostColumn(label, kind));
    },
    async updateCostColumn(
      id: string,
      patch: Partial<Pick<costStructure.CostColumn, 'label' | 'kind'>>,
    ): Promise<boolean> {
      return withLocal(() => costStructure.updateCostColumn(id, patch));
    },
    async moveCostColumn(id: string, delta: -1 | 1): Promise<boolean> {
      return withLocal(() => costStructure.moveCostColumn(id, delta));
    },
    async removeCostColumn(id: string): Promise<boolean> {
      return withLocal(() => costStructure.removeCostColumn(id));
    },
    async addCostItem(input: costStructure.AddCostItemInput): Promise<costStructure.CostItem> {
      return withLocal(() => costStructure.addCostItem(input));
    },
    async updateCostItem(id: string, patch: costStructure.UpdateCostItemPatch): Promise<boolean> {
      return withLocal(() => costStructure.updateCostItem(id, patch));
    },
    async setCostItemValue(itemId: string, columnId: string, raw: string): Promise<boolean> {
      return withLocal(() => costStructure.setCostItemValue(itemId, columnId, raw));
    },
    async removeCostItem(id: string): Promise<boolean> {
      return withLocal(() => costStructure.removeCostItem(id));
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
    return withLocal(() => systemUsers.listSystemUsers());
  },
  async createUser(input: CreateUserPayload): Promise<systemUsers.SystemUser> {
    return withLocal(() => {
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
    return withLocal(() => {
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
    return withLocal(() => {
      const cur = systemUsers.listSystemUsers().find((u) => u.id === id);
      const ok = systemUsers.removeSystemUser(id);
      if (ok && cur?.loginId) credentialStorage.removeCredential(cur.loginId);
      return ok;
    });
  },
  async setUserPassword(loginId: string, newPassword: string): Promise<void> {
    return withLocal(() => {
      credentialStorage.setCredential(loginId, newPassword);
    });
  },
};

export type { SystemUser, SystemUserRole, SystemUserStatus, NewSystemUserInput, SystemUserUpdate } from '../lib/systemUsersStorage';

export const passwordReset = {
  async requestCode(email: string) {
    await storageTick();
    assertLocalOrThrow(getStorageMode());
    return requestPasswordResetByEmail(email);
  },
  async confirm(email: string, code: string, newPassword: string) {
    return withLocal(() => confirmPasswordResetWithOtp(email, code, newPassword));
  },
};

export const storeSettings = {
  async getStoreCode3(): Promise<string> {
    return withLocal(() => getStoreCode3());
  },
  async setStoreCode3(code: string): Promise<void> {
    return withLocal(() => {
      setStoreCode3(code);
    });
  },
};

// ——— 全量 bundle（數據中心／備份）———

export const dataBundle = {
  async serialize(): Promise<string> {
    return withLocal(() => serializeDongshanDataBundle());
  },
  async build(): Promise<DongshanDataBundleV1> {
    return withLocal(() => buildDongshanDataBundle());
  },
  async importBundle(raw: unknown): Promise<ImportBundleResult> {
    return withLocal(() => importDongshanDataBundle(raw));
  },
};

export { getStorageMode, getApiBaseUrl, getAsyncStorageDelayMs, type StorageMode } from './storageMode';
