import { readSession } from './authSession';
import { listSystemUsers, type SystemUser } from './systemUsersStorage';

export const HQ_SCOPE_ID = 'scope:hq';

export type DataScopeContext = {
  isAdmin: boolean;
  scopeId: string;
  userId: string;
  role: 'admin' | 'franchisee' | 'employee' | 'unknown';
};

/** 依使用者目錄（非僅 session 字串）決定流水帳／訂單資料範圍 */
export function resolveLedgerScopeIdForUser(user: SystemUser | undefined): string {
  if (!user) return HQ_SCOPE_ID;
  if (user.role === 'franchisee') return `scope:franchisee:${user.id}`;
  if (user.role === 'admin') return HQ_SCOPE_ID;
  if (user.role === 'employee') {
    if (user.employeeOrgType === 'hq') return HQ_SCOPE_ID;
    const parent = user.parentFranchiseeUserId?.trim();
    if (parent) return `scope:franchisee:${parent}`;
    return HQ_SCOPE_ID;
  }
  return HQ_SCOPE_ID;
}

/** 目前登入者之流水帳 scope（以權限表角色為準，避免 session 與目錄不一致） */
export function resolveAccountingLedgerScopeId(): string {
  const s = readSession();
  if (!s?.userId) return HQ_SCOPE_ID;
  const u = listSystemUsers().find((x) => x.id === s.userId);
  return resolveLedgerScopeIdForUser(u);
}

export function getDataScopeContext(): DataScopeContext {
  const s = readSession();
  if (!s) {
    return { isAdmin: false, scopeId: HQ_SCOPE_ID, userId: '', role: 'unknown' };
  }
  const u = listSystemUsers().find((x) => x.id === s.userId);
  const role = (u?.role ?? s.role) as DataScopeContext['role'];
  const scopeId = resolveLedgerScopeIdForUser(u);
  if (role === 'admin') {
    return { isAdmin: true, scopeId, userId: s.userId, role: 'admin' };
  }
  if (role === 'franchisee') {
    return { isAdmin: false, scopeId, userId: s.userId, role: 'franchisee' };
  }
  if (role === 'employee') {
    return { isAdmin: false, scopeId, userId: s.userId, role: 'employee' };
  }
  return { isAdmin: false, scopeId: HQ_SCOPE_ID, userId: s.userId, role: 'unknown' };
}

