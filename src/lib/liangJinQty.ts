/**
 * 品項以「兩」計量時，輔助換算台斤（1 斤 = 16 兩）。
 */

export const LIANG_PER_JIN = 16;

export function pieceUnitIsLiang(pieceUnit: string | undefined | null): boolean {
  return String(pieceUnit ?? '').trim() === '兩';
}

export function jinFromLiangQty(liangQty: number): number | null {
  if (!Number.isFinite(liangQty) || liangQty < 0) return null;
  return liangQty / LIANG_PER_JIN;
}

/** 斤之數字字串：四捨五入至小數點後一位；整數不顯示小數。 */
export function formatJinFromLiangQty(liangQty: number): string {
  const jin = jinFromLiangQty(liangQty);
  if (jin == null) return '';
  const rounded = Math.round(jin * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toLocaleString('zh-TW', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}
