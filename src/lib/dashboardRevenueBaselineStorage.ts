import { HQ_SCOPE_ID } from './dataScope';

const KEY = 'dongshan_dashboard_revenue_baseline_v1';
export const REVENUE_BASELINE_UPDATED_EVENT = 'revenueBaselineUpdated';

type StoreV1 = {
  version: 1;
  /** scope:hq 或 scope:franchisee:{userId} → 週一 0 … 週日 6 → 目標金額（整數） */
  targetByScope: Record<string, Record<string, number>>;
};

function loadStore(): StoreV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, targetByScope: {} };
    const parsed = JSON.parse(raw) as StoreV1;
    return parsed?.targetByScope && typeof parsed.targetByScope === 'object'
      ? parsed
      : { version: 1, targetByScope: {} };
  } catch {
    return { version: 1, targetByScope: {} };
  }
}

function saveStore(s: StoreV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(REVENUE_BASELINE_UPDATED_EVENT));
}

/** 儀表板銷售數據：直營或指定加盟店之打底 scope */
export function resolveStallRevenueBaselineScopeId(franchiseOwnerUserId: string | null | undefined): string {
  const id = franchiseOwnerUserId?.trim();
  if (id) return `scope:franchisee:${id}`;
  return HQ_SCOPE_ID;
}

/** 該 scope、該星期（週一＝0）之營業額打底；未設定為 undefined */
export function getRevenueBaselineTarget(scopeId: string, mondayFirstWeekdayIdx: number): number | undefined {
  const scope = scopeId?.trim() || HQ_SCOPE_ID;
  const row = loadStore().targetByScope[scope]?.[String(mondayFirstWeekdayIdx)];
  return typeof row === 'number' && Number.isFinite(row) ? Math.round(row) : undefined;
}

export function setRevenueBaselineTarget(
  scopeId: string,
  mondayFirstWeekdayIdx: number,
  amount: number,
): void {
  const scope = scopeId?.trim() || HQ_SCOPE_ID;
  const s = loadStore();
  const bucket = { ...(s.targetByScope[scope] ?? {}) };
  bucket[String(mondayFirstWeekdayIdx)] = Math.round(amount);
  s.targetByScope[scope] = bucket;
  saveStore(s);
}

export function clearRevenueBaselineTarget(scopeId: string, mondayFirstWeekdayIdx: number): void {
  const scope = scopeId?.trim() || HQ_SCOPE_ID;
  const s = loadStore();
  const bucket = { ...(s.targetByScope[scope] ?? {}) };
  delete bucket[String(mondayFirstWeekdayIdx)];
  if (Object.keys(bucket).length === 0) {
    delete s.targetByScope[scope];
  } else {
    s.targetByScope[scope] = bucket;
  }
  saveStore(s);
}
