/**
 * 本機曆法之日期顯示與關鍵字搜尋用（例：2026/4/25，月日不補前導 0）
 */

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function toLocalYmdDashed(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ymd 儲存字串 YYYY-MM-DD → 2026/4/25 */
export function ymdDashToSlash(ymdDash: string): string {
  const p = ymdDash.split('-');
  if (p.length !== 3) return ymdDash;
  const a = parseInt(p[0], 10);
  const b = parseInt(p[1], 10);
  const c = parseInt(p[2], 10);
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return ymdDash;
  return `${a}/${b}/${c}`;
}

export function formatSlashDateFromDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatSlashDateFromIso(iso: string): string {
  return formatSlashDateFromDate(new Date(iso));
}

export function formatSlashDateTimeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = formatSlashDateFromDate(d);
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${date} ${hh}:${mm}`;
}

export function formatSlashDateTimeWithWeekdayFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = formatSlashDateFromDate(d);
  const weekday = d.toLocaleDateString('zh-TW', { weekday: 'short' });
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${date}（${weekday}） ${hh}:${mm}`;
}

/**
 * 彙整可搜尋之日期變體：2026/4/25、2026-04-25、2026/4、20260425
 */
export function getOrderDateSearchIndex(
  orderCreatedIso: string,
  extra?: { stallCountBasisYmd?: string; stallCountCompletedAt?: string }
): string {
  const parts: string[] = [];
  const ymd0 = toLocalYmdDashed(orderCreatedIso);
  if (ymd0) {
    const [Y, M, D] = ymd0.split('-');
    const slash = ymdDashToSlash(ymd0);
    parts.push(slash, ymd0, ymd0.replace(/-/g, '/'), ymd0.replace(/-/g, ''), `${Y}/${M}`, `/${M}/${D}`);
  }
  if (extra?.stallCountBasisYmd) {
    const b = extra.stallCountBasisYmd;
    parts.push(b, ymdDashToSlash(b), b.replace(/-/g, ''), b.replace(/-/g, '/'));
  }
  if (extra?.stallCountCompletedAt) {
    const y1 = toLocalYmdDashed(extra.stallCountCompletedAt);
    if (y1) {
      parts.push(
        ymdDashToSlash(y1),
        y1,
        y1.replace(/-/g, '/'),
        y1.replace(/-/g, '')
      );
    }
  }
  return parts.join(' ').toLowerCase();
}

function normalizeDateQuery(s: string): string {
  return s.trim().toLowerCase().replace(/-/g, '/').replace(/\s/g, '');
}

/** 訂單關鍵字是否命中日期變體（例：2026/4/25、2026/4、0425） */
export function orderDateQueryMatches(
  orderCreatedIso: string,
  extra: { stallCountBasisYmd?: string; stallCountCompletedAt?: string } | undefined,
  qRaw: string
): boolean {
  const nq = normalizeDateQuery(qRaw);
  if (nq.length < 2) return false;
  if (!/\d/.test(qRaw)) return false;
  return getOrderDateSearchIndex(orderCreatedIso, extra).includes(nq);
}

/** 週一～週日（1=週一 … 7=週日，依本機曆法） */
export const ALL_ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ALL_ISO_WEEKDAYS)[number];

/**
 * 建單時間 ISO 對應之星期：1=週一 … 7=週日。
 * 無效時間則回 null（呼叫端可視為不篩掉）。
 */
export function getIsoWeekdayFromCreatedAt(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const j = d.getDay();
  return (j === 0 ? 7 : j) as number;
}

/**
 * 建單日星期篩選：`activeWeekdays` 為空＝不篩選（顯示全部）；
 * 非空時只保留建單日落在所點選之星期者（複選為 OR）。
 */
export function orderMatchesActiveWeekdays(
  createdAtIso: string,
  activeWeekdays: readonly number[]
): boolean {
  if (activeWeekdays.length === 0) return true;
  const w = getIsoWeekdayFromCreatedAt(createdAtIso);
  if (w == null) return true;
  return activeWeekdays.includes(w);
}
