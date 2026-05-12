const KEY = 'dongshan_dashboard_revenue_notes_v1';

type WeekRevenueNote = {
  highReason: string;
  lowReason: string;
  updatedAt: string;
};

type StoreV1 = {
  version: 1;
  byWeekStartYmd: Record<string, WeekRevenueNote>;
};

export const DASHBOARD_REVENUE_NOTES_UPDATED_EVENT = 'dashboardRevenueNotesUpdated';

function loadStore(): StoreV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, byWeekStartYmd: {} };
    const parsed = JSON.parse(raw) as StoreV1;
    if (!parsed || typeof parsed !== 'object') return { version: 1, byWeekStartYmd: {} };
    return {
      version: 1,
      byWeekStartYmd:
        parsed.byWeekStartYmd && typeof parsed.byWeekStartYmd === 'object'
          ? parsed.byWeekStartYmd
          : {},
    };
  } catch {
    return { version: 1, byWeekStartYmd: {} };
  }
}

function saveStore(store: StoreV1): void {
  localStorage.setItem(KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(DASHBOARD_REVENUE_NOTES_UPDATED_EVENT));
}

export function getWeekRevenueNote(weekStartYmd: string): WeekRevenueNote {
  const store = loadStore();
  const row = store.byWeekStartYmd[weekStartYmd];
  if (!row) return { highReason: '', lowReason: '', updatedAt: '' };
  return {
    highReason: String(row.highReason ?? ''),
    lowReason: String(row.lowReason ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

export function setWeekRevenueNote(
  weekStartYmd: string,
  patch: { highReason?: string; lowReason?: string },
): WeekRevenueNote {
  const store = loadStore();
  const prev = store.byWeekStartYmd[weekStartYmd] ?? { highReason: '', lowReason: '', updatedAt: '' };
  const next: WeekRevenueNote = {
    highReason: patch.highReason ?? prev.highReason,
    lowReason: patch.lowReason ?? prev.lowReason,
    updatedAt: new Date().toISOString(),
  };
  store.byWeekStartYmd[weekStartYmd] = next;
  saveStore(store);
  return next;
}
