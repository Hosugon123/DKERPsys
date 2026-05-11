/**
 * 本機店號（3 位數，例 001）— 訂單單號前綴。預設 001，可由超級管理員在「權限設定」變更。
 */
const KEY = 'dongshan_store_code_v1';

/** 訂單單號店號前綴：僅數字、最多 3 碼，左補 0；空則 001 */
export function normalizeStoreCode3Digits(raw: string | undefined | null): string {
  const s = String(raw ?? '').replace(/\D/g, '').slice(0, 3);
  if (s.length === 0) return '001';
  return s.padStart(3, '0');
}

export function getStoreCode3(): string {
  try {
    const v = localStorage.getItem(KEY);
    return normalizeStoreCode3Digits(v);
  } catch {
    return '001';
  }
}

export function setStoreCode3(code: string): void {
  const n = normalizeStoreCode3Digits(code);
  localStorage.setItem(KEY, n);
  window.dispatchEvent(new Event('storeCodeUpdated'));
}
