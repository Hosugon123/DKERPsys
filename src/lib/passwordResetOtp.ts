/**
 * 忘記密碼：以「註冊信箱」收取驗證碼後重設登入密碼（本機 localStorage）。
 *
 * - 驗證碼有效期限、嘗試次數見常數。
 * - 無郵件後端時：可經 VITE_SHOW_RESET_CODE 或開發模式在 UI 顯示驗證碼；上線請改 VITE_PASSWORD_RESET_EMAIL_URL 由後端寄信。
 * - POST JSON：`{ email, code, loginId, purpose: 'password-reset', expiresInMinutes }`；可選標頭 `VITE_PASSWORD_RESET_EMAIL_AUTH`（例如 `Bearer …`）。
 */
import * as credentialStorage from './credentialStorage';
import { listSystemUsers } from './systemUsersStorage';

const STORAGE_KEY = 'dongshan_pw_reset_pending_v1';
const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const CODE_LENGTH = 6;

type PendingV1 = {
  version: 1;
  emailNorm: string;
  loginId: string;
  code: string;
  expiresAt: number;
  attempts: number;
};

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function loadPending(): PendingV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== 'object') return null;
    const bag = o as PendingV1;
    if (bag.version !== 1 || typeof bag.emailNorm !== 'string' || typeof bag.code !== 'string') return null;
    if (typeof bag.expiresAt !== 'number' || typeof bag.attempts !== 'number') return null;
    if (typeof bag.loginId !== 'string') return null;
    return bag;
  } catch {
    return null;
  }
}

function savePending(p: PendingV1 | null): void {
  if (!p) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function generateOtp(): string {
  const n = Math.floor(Math.random() * 10 ** CODE_LENGTH);
  return String(n).padStart(CODE_LENGTH, '0');
}

/** 是否在忘記密碼流程中於畫面顯示驗證碼（無郵件後端時） */
export function shouldRevealResetCodeInUi(): boolean {
  const v = import.meta.env.VITE_SHOW_RESET_CODE;
  if (v === 'false') return false;
  if (v === 'true') return true;
  const url = import.meta.env.VITE_PASSWORD_RESET_EMAIL_URL;
  if (typeof url === 'string' && url.trim().length > 0) return false;
  /** 未設定寄信 URL 時預設顯示（本機／純前端部署）；正式串後端寄信後請設 URL 並將 VITE_SHOW_RESET_CODE=false */
  return true;
}

async function deliverOtpToEmail(email: string, code: string, loginId: string): Promise<void> {
  const url = import.meta.env.VITE_PASSWORD_RESET_EMAIL_URL;
  if (typeof url !== 'string' || !url.trim()) return;

  const auth = import.meta.env.VITE_PASSWORD_RESET_EMAIL_AUTH;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof auth === 'string' && auth.trim()) {
    headers.Authorization = auth.trim();
  }

  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: normalizeEmail(email),
        code,
        loginId: loginId.trim().toLowerCase(),
        purpose: 'password-reset',
        expiresInMinutes: 15,
      }),
      signal: ctrl.signal,
    });
    let errMsg = '驗證信寄送失敗，請稍後再試或聯絡管理員。';
    if (!res.ok) {
      try {
        const j = (await res.json()) as { message?: string; error?: string };
        if (typeof j.message === 'string' && j.message.trim()) errMsg = j.message.trim();
        else if (typeof j.error === 'string' && j.error.trim()) errMsg = j.error.trim();
      } catch {
        if (res.status === 404) errMsg = '寄信 API 回傳 404，請檢查 VITE_PASSWORD_RESET_EMAIL_URL。';
      }
      throw new Error(errMsg);
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('寄送逾時，請檢查網路或稍後再試。');
    }
    throw e;
  } finally {
    window.clearTimeout(t);
  }
}

export type RequestResetResult =
  | { ok: true; revealCode?: string }
  | { ok: false; message: string };

/**
 * 依註冊信箱產生驗證碼並嘗試寄送（若有設定 VITE_PASSWORD_RESET_EMAIL_URL）。
 * 成功後回傳 revealCode：僅在 shouldRevealResetCodeInUi() 為 true 時提供，供本機示範。
 */
export async function requestPasswordResetByEmail(rawEmail: string): Promise<RequestResetResult> {
  const emailNorm = normalizeEmail(rawEmail);
  if (!emailNorm) {
    return { ok: false, message: '請輸入電子信箱。' };
  }

  const users = listSystemUsers();
  const user = users.find((u) => normalizeEmail(u.email) === emailNorm);
  if (!user) {
    return { ok: false, message: '查無以此信箱註冊的使用者。' };
  }
  if (user.status !== 'active') {
    return { ok: false, message: '此帳號已停權，無法線上重設密碼，請聯絡管理員。' };
  }
  const loginId = user.loginId?.trim();
  if (!loginId) {
    return { ok: false, message: '此帳號尚未設定登入帳號，無法重設密碼，請聯絡管理員。' };
  }

  const code = generateOtp();
  const pending: PendingV1 = {
    version: 1,
    emailNorm,
    loginId: loginId.trim(),
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };
  savePending(pending);

  try {
    await deliverOtpToEmail(rawEmail.trim(), code, loginId);
  } catch (e) {
    savePending(null);
    return { ok: false, message: e instanceof Error ? e.message : '寄送驗證信失敗。' };
  }

  const reveal = shouldRevealResetCodeInUi() ? code : undefined;
  return { ok: true, revealCode: reveal };
}

export type ConfirmResetResult = { ok: true } | { ok: false; message: string };

export function confirmPasswordResetWithOtp(
  rawEmail: string,
  rawCode: string,
  newPassword: string,
): ConfirmResetResult {
  const emailNorm = normalizeEmail(rawEmail);
  const code = rawCode.trim().replace(/\s/g, '');
  if (!emailNorm) return { ok: false, message: '請輸入電子信箱。' };
  if (code.length !== CODE_LENGTH || !/^\d+$/.test(code)) {
    return { ok: false, message: `請輸入 ${CODE_LENGTH} 位數驗證碼。` };
  }
  if (newPassword.length < 4) {
    return { ok: false, message: '新密碼至少需 4 個字元。' };
  }

  const pending = loadPending();
  if (!pending) {
    return { ok: false, message: '沒有待驗證的申請，請重新寄送驗證碼。' };
  }
  if (pending.emailNorm !== emailNorm) {
    return { ok: false, message: '信箱與驗證申請不符，請使用同一信箱操作。' };
  }
  if (Date.now() > pending.expiresAt) {
    savePending(null);
    return { ok: false, message: '驗證碼已過期，請重新寄送。' };
  }

  if (pending.code !== code) {
    const nextAttempts = pending.attempts + 1;
    if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
      savePending(null);
      return { ok: false, message: '驗證錯誤次數過多，請重新寄送驗證碼。' };
    }
    savePending({ ...pending, attempts: nextAttempts });
    return { ok: false, message: `驗證碼錯誤（剩餘 ${MAX_VERIFY_ATTEMPTS - nextAttempts} 次機會）。` };
  }

  credentialStorage.setCredential(pending.loginId, newPassword);
  savePending(null);
  return { ok: true };
}
