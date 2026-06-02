/**
 * 進行中表單草稿（sessionStorage）：整頁重新整理或衝突重整後還原尚未送出的輸入。
 */
const PREFIX = 'dongshan_work_draft_v1:';

/** 各畫面草稿鍵（集中管理，避免拼字錯誤） */
export const WORK_DRAFT_IDS = {
  procurement: 'procurement',
  stallInventory: 'stall-inventory',
  salesRecordStallEdit: 'sales-record-stall-edit',
  ordersLineEdit: 'orders-line-edit',
  accounting: 'accounting',
  itemCatalogDeferred: 'item-catalog-deferred',
  dashboardRevenueBaseline: 'dashboard-revenue-baseline',
} as const;

function draftKey(id: string): string {
  return `${PREFIX}${id}`;
}

export function saveWorkDraft<T>(id: string, payload: T): void {
  try {
    sessionStorage.setItem(
      draftKey(id),
      JSON.stringify({ savedAt: Date.now(), payload }),
    );
  } catch {
    /* ignore */
  }
}

export function loadWorkDraft<T>(id: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): T | null {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; payload?: T };
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > maxAgeMs) {
      sessionStorage.removeItem(draftKey(id));
      return null;
    }
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

export function clearWorkDraft(id: string): void {
  try {
    sessionStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}
