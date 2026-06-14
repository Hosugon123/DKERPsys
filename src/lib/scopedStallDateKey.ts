import { HQ_SCOPE_ID, getDataScopeContext } from './dataScope';
import { resolveOrderDataScopeId, type OrderHistoryEntry } from './orderHistoryStorage';

const SCOPED_KEY_SEP = '|';

/** 攤上／銷售紀錄依「資料範圍＋曆法日」分桶，避免直營與加盟同日互蓋。 */
export function scopedStallDateKey(scopeId: string, ymd: string): string {
  const scope = scopeId.trim() || HQ_SCOPE_ID;
  const day = ymd.trim();
  return `${scope}${SCOPED_KEY_SEP}${day}`;
}

export function parseScopedStallDateKey(key: string): { scopeId: string; ymd: string } | null {
  const i = key.indexOf(SCOPED_KEY_SEP);
  if (i <= 0) return null;
  const scopeId = key.slice(0, i).trim();
  const ymd = key.slice(i + 1).trim();
  if (!scopeId || !ymd) return null;
  return { scopeId, ymd };
}

export function resolveStallStorageScopeId(explicit?: string): string {
  const t = explicit?.trim();
  if (t) return t;
  return getDataScopeContext().scopeId || HQ_SCOPE_ID;
}

export function resolveOrderStallStorageScopeId(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId'>,
): string {
  return resolveOrderDataScopeId(row) ?? HQ_SCOPE_ID;
}

/** 舊版僅以 ymd 為鍵之資料視為總部直營範圍。 */
export function isLegacyBareStallDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key.trim());
}

/** 由儲存鍵還原曆法日（支援 scoped 與舊裸鍵）。 */
export function bareYmdFromStallStorageKey(key: string): string {
  const parsed = parseScopedStallDateKey(key);
  if (parsed) return parsed.ymd;
  return key.trim();
}

/** 儲存鍵是否屬於指定資料範圍（舊裸鍵視為總部）。 */
export function stallStorageKeyMatchesScope(storageKey: string, scopeId?: string): boolean {
  const scope = resolveStallStorageScopeId(scopeId);
  const parsed = parseScopedStallDateKey(storageKey);
  if (parsed) return parsed.scopeId === scope;
  return scope === HQ_SCOPE_ID && isLegacyBareStallDateKey(storageKey);
}
