/**
 * 本機店號（3 位數，例 001）— 訂單單號前綴。預設 001，可由超級管理員在「權限設定」變更。
 */
const KEY = 'dongshan_store_code_v1';

function normalize3(raw: string | undefined | null): string {
  const s = String(raw ?? '').replace(/\D/g, '').slice(0, 3);
  if (s.length === 0) return '001';
  return s.padStart(3, '0');
}

export function getStoreCode3(): string {
  try {
    const v = localStorage.getItem(KEY);
    return normalize3(v);
  } catch {
    return '001';
  }
}

export function setStoreCode3(code: string): void {
  const n = normalize3(code);
  localStorage.setItem(KEY, n);
  window.dispatchEvent(new Event('storeCodeUpdated'));
}
