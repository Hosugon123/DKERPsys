const KEY = 'dongshan_dashboard_weekday_baseline_v1';

type StoreV1 = {
  version: 1;
  /** 週一 index 0 … 週日 6 → 業績打底金額（整數） */
  targetByWeekdayIdx: Record<string, number>;
};

function loadStore(): StoreV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, targetByWeekdayIdx: {} };
    const parsed = JSON.parse(raw) as StoreV1;
    return parsed?.targetByWeekdayIdx && typeof parsed.targetByWeekdayIdx === 'object'
      ? parsed
      : { version: 1, targetByWeekdayIdx: {} };
  } catch {
    return { version: 1, targetByWeekdayIdx: {} };
  }
}

function saveStore(s: StoreV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** 業績打底（同名星期）：無設定時為 undefined */
export function getWeekdayBaselineTarget(mondayFirstWeekdayIdx: number): number | undefined {
  const row = loadStore().targetByWeekdayIdx[String(mondayFirstWeekdayIdx)];
  return typeof row === 'number' && Number.isFinite(row) ? Math.round(row) : undefined;
}

export function setWeekdayBaselineTarget(mondayFirstWeekdayIdx: number, amount: number): void {
  const s = loadStore();
  s.targetByWeekdayIdx[String(mondayFirstWeekdayIdx)] = Math.round(amount);
  saveStore(s);
}
