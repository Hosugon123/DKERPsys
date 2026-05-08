import { listSystemUsers, type SystemUser } from './systemUsersStorage';

type OrderActorRole = 'admin' | 'franchisee' | 'employee';

type OrderLike = {
  storeLabel: string;
  actorRole?: OrderActorRole;
  actorUserId?: string;
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

export function resolveOrderStoreLabel(order: OrderLike): string {
  const fallback = normalizeLegacyStoreLabel(order.storeLabel);
  const users = listSystemUsers();

  if (order.actorRole === 'admin') {
    return '直營店';
  }

  if (!order.actorUserId) {
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
