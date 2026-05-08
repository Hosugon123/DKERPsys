/**
 * 登入密碼本機儲存（localStorage 明文，僅供離線／內網管理用途；上線後應改後端驗證）。
 */
import { SUPER_ADMIN_LOGIN_ID } from './authConstants';

const KEY = 'dongshan_login_credentials_v1';

function normalizeLoginId(s: string): string {
  return s.trim().toLowerCase();
}

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string') out[normalizeLoginId(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: Record<string, string>): void {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function registerCredential(loginId: string, password: string): void {
  const k = normalizeLoginId(loginId);
  if (!k) throw new Error('登入帳號不可為空。');
  if (password.length < 4) throw new Error('密碼至少需 4 個字元。');
  const c = load();
  if (c[k] !== undefined) throw new Error('此登入帳號已存在憑證，請改用更新流程。');
  c[k] = password;
  save(c);
}

/** 管理員重設他人密碼（不需舊密碼） */
export function setCredential(loginId: string, password: string): void {
  const k = normalizeLoginId(loginId);
  if (!k) throw new Error('登入帳號不可為空。');
  if (password.length < 4) throw new Error('新密碼至少需 4 個字元。');
  const c = load();
  c[k] = password;
  save(c);
}

export function verifyCredential(loginId: string, password: string): boolean {
  const k = normalizeLoginId(loginId);
  const c = load();
  return c[k] !== undefined && c[k] === password;
}

export function changeCredential(loginId: string, currentPassword: string, newPassword: string): void {
  const k = normalizeLoginId(loginId);
  if (newPassword.length < 4) throw new Error('新密碼至少需 4 個字元。');
  const c = load();
  if (c[k] === undefined) throw new Error('找不到此帳號的密碼設定，請由超級管理員重設。');
  if (c[k] !== currentPassword) throw new Error('目前密碼不正確。');
  c[k] = newPassword;
  save(c);
}

export function removeCredential(loginId: string): void {
  const k = normalizeLoginId(loginId);
  const c = load();
  if (c[k] === undefined) return;
  delete c[k];
  save(c);
}

export function migrateCredential(oldLoginId: string, newLoginId: string): void {
  const o = normalizeLoginId(oldLoginId);
  const n = normalizeLoginId(newLoginId);
  if (!n) throw new Error('新登入帳號不可為空。');
  if (o === n) return;
  const c = load();
  if (c[n] !== undefined) throw new Error('新登入帳號已有憑證紀錄，請先排除重複。');
  if (c[o] !== undefined) {
    c[n] = c[o];
    delete c[o];
    save(c);
  }
}

/** 首次安裝：若尚無 dk001 密碼則寫入預設值（不覆寫使用者已改過的密碼）。 */
export function ensureDefaultSuperAdminPasswordIfMissing(defaultPassword: string): void {
  const k = normalizeLoginId(SUPER_ADMIN_LOGIN_ID);
  const c = load();
  const cur = c[k];
  if (cur === undefined || cur === '') {
    c[k] = defaultPassword;
    save(c);
  }
}
