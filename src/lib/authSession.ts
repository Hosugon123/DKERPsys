import { SUPER_ADMIN_LOGIN_ID } from './authConstants';
import * as credentialStorage from './credentialStorage';
import { ensurePrimarySuperAdminAccount, listSystemUsers, type SystemUserRole } from './systemUsersStorage';

const SESSION_KEY = 'dongshan_session_v1';

export const AUTH_SESSION_CHANGED_EVENT = 'dongshanAuthSessionChanged';

export type AuthSession = {
  userId: string;
  loginId: string;
  role: SystemUserRole;
};

function normalizeLoginId(s: string): string {
  return s.trim().toLowerCase();
}

function dispatchChanged(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== 'object') return null;
    const bag = o as Record<string, unknown>;
    const userId = typeof bag.userId === 'string' ? bag.userId : '';
    const loginId = typeof bag.loginId === 'string' ? bag.loginId : '';
    const role = bag.role;
    if (!userId || !loginId) return null;
    if (role !== 'admin' && role !== 'franchisee' && role !== 'employee') return null;
    return { userId, loginId, role };
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  const body: AuthSession = {
    userId: session.userId,
    loginId: normalizeLoginId(session.loginId),
    role: session.role,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(body));
  dispatchChanged();
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  dispatchChanged();
}

export function validateSession(s: AuthSession): boolean {
  const u = listSystemUsers().find((x) => x.id === s.userId);
  if (!u || u.status !== 'active') return false;
  if (!u.loginId || normalizeLoginId(u.loginId) !== normalizeLoginId(s.loginId)) return false;
  if (u.role !== s.role) return false;
  return true;
}

export function tryLogin(loginId: string, password: string): { ok: true } | { ok: false; message: string } {
  const id = normalizeLoginId(loginId);
  if (!id) return { ok: false, message: '請輸入登入帳號。' };
  ensureAuthBootstrap();
  const users = listSystemUsers();
  const user = users.find((u) => u.loginId && normalizeLoginId(u.loginId) === id);
  if (!user) return { ok: false, message: '帳號或密碼錯誤。' };
  if (user.status === 'disabled') return { ok: false, message: '此帳號已停權，無法登入。' };
  if (!credentialStorage.verifyCredential(id, password)) {
    return { ok: false, message: '帳號或密碼錯誤。' };
  }
  writeSession({
    userId: user.id,
    loginId: user.loginId!,
    role: user.role,
  });
  return { ok: true };
}

export function changeOwnPassword(
  loginId: string,
  currentPassword: string,
  newPassword: string,
): void {
  credentialStorage.changeCredential(loginId, currentPassword, newPassword);
}

/**
 * 首次載入／登入前：確保有一位管理員的登入帳號為 dk001，並補上預設密碼（若無）。
 * 若資料庫裡管理員已有「其他」loginId、但尚無 dk001，會將第一位管理員改為 dk001 並遷移密碼。
 */
export function ensureAuthBootstrap(defaultPassword = '123'): void {
  const before = listSystemUsers();
  const firstAdminBefore = before.find((u) => u.role === 'admin');
  const oldLogin = firstAdminBefore?.loginId?.trim();

  ensurePrimarySuperAdminAccount();

  if (oldLogin && normalizeLoginId(oldLogin) !== normalizeLoginId(SUPER_ADMIN_LOGIN_ID)) {
    try {
      credentialStorage.migrateCredential(oldLogin, SUPER_ADMIN_LOGIN_ID);
    } catch {
      /** 密碼表已有 dk001 憑證（與使用者列未對齊）時，只移除舊帳號鍵，保留 dk001 */
      credentialStorage.removeCredential(oldLogin);
    }
  }
  credentialStorage.ensureDefaultSuperAdminPasswordIfMissing(defaultPassword);
}

export function isSuperAdminSession(loginId: string): boolean {
  return normalizeLoginId(loginId) === SUPER_ADMIN_LOGIN_ID;
}
