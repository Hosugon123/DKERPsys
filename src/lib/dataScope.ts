import { readSession } from './authSession';
import { listSystemUsers } from './systemUsersStorage';

export const HQ_SCOPE_ID = 'scope:hq';

export type DataScopeContext = {
  isAdmin: boolean;
  scopeId: string;
  userId: string;
  role: 'admin' | 'franchisee' | 'employee' | 'unknown';
};

export function getDataScopeContext(): DataScopeContext {
  const s = readSession();
  if (!s) {
    return { isAdmin: false, scopeId: HQ_SCOPE_ID, userId: '', role: 'unknown' };
  }
  if (s.role === 'admin') {
    return { isAdmin: true, scopeId: HQ_SCOPE_ID, userId: s.userId, role: 'admin' };
  }
  if (s.role === 'franchisee') {
    return { isAdmin: false, scopeId: `scope:franchisee:${s.userId}`, userId: s.userId, role: 'franchisee' };
  }
  const u = listSystemUsers().find((x) => x.id === s.userId);
  if (u?.employeeOrgType === 'franchisee' && u.parentFranchiseeUserId) {
    return {
      isAdmin: false,
      scopeId: `scope:franchisee:${u.parentFranchiseeUserId}`,
      userId: s.userId,
      role: 'employee',
    };
  }
  return { isAdmin: false, scopeId: HQ_SCOPE_ID, userId: s.userId, role: 'employee' };
}

