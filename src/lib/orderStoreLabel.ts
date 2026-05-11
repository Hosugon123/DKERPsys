import { listSystemUsers, type SystemUser } from './systemUsersStorage';

type OrderActorRole = 'admin' | 'franchisee' | 'employee';

type OrderLike = {
  storeLabel: string;
  actorRole?: OrderActorRole;
  actorUserId?: string;
  /** 資料範圍：總部代建加盟單可能 actorRole 仍為 admin，需依 scope 辨識門市 */
  scopeId?: string;
};

function normalizeLegacyStoreLabel(label: string): string {
  if (label === '總部／示範門市' || label === '總部 / 示範門市') return '直營店';
  return label;
}

function preferUserStoreLabel(user: SystemUser | undefined): string | null {
  if (!user) return null;
  const fromStore = user.storeLabel?.trim();
  if (fromStore) return fromStore;
  const fromName = user.name?.trim();
  if (fromName) return fromName;
  return null;
}

/**
 * 加盟主叫貨建單時寫入 `storeLabel`：直接存店鋪名稱，避免僅顯示「加盟門市」且舊單缺 actorUserId 時無法還原。
 */
export function initialFranchiseeStoreLabelForOrder(actorUserId: string | undefined): string {
  const id = actorUserId?.trim();
  if (!id) return '加盟門市';
  const u = listSystemUsers().find((x) => x.id === id);
  return preferUserStoreLabel(u) ?? '加盟門市';
}

export function resolveOrderStoreLabel(order: OrderLike): string {
  const fallback = normalizeLegacyStoreLabel(order.storeLabel);
  const users = listSystemUsers();
  const scopeFranchiseeUid = order.scopeId?.trim().match(/^scope:franchisee:(.+)$/)?.[1]?.trim();

  if (order.actorRole === 'admin' && !scopeFranchiseeUid) {
    return '直營店';
  }

  if (order.actorRole === 'admin' && scopeFranchiseeUid) {
    const franchisee = users.find((u) => u.id === scopeFranchiseeUid);
    return preferUserStoreLabel(franchisee) ?? fallback;
  }

  if (!order.actorUserId) {
    if (
      scopeFranchiseeUid &&
      (order.actorRole === 'franchisee' || order.actorRole === 'employee')
    ) {
      const franchisee = users.find((u) => u.id === scopeFranchiseeUid);
      return preferUserStoreLabel(franchisee) ?? fallback;
    }
    return fallback;
  }

  const actor = users.find((u) => u.id === order.actorUserId);

  if (order.actorRole === 'franchisee') {
    return preferUserStoreLabel(actor) ?? fallback;
  }

  if (order.actorRole === 'employee') {
    if (actor?.employeeOrgType === 'franchisee' && actor.parentFranchiseeUserId) {
      const parent = users.find((u) => u.id === actor.parentFranchiseeUserId);
      return preferUserStoreLabel(parent) ?? preferUserStoreLabel(actor) ?? fallback;
    }
    if (actor?.employeeOrgType === 'hq') {
      return '直營店';
    }
    return preferUserStoreLabel(actor) ?? fallback;
  }

  return fallback;
}
