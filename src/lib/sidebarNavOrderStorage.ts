import { getStorageMode } from '../services/storageMode';

const PREFIX = 'dongshan_sidebar_main_nav_order_v1';

let remotePushTimer: ReturnType<typeof setTimeout> | null = null;

/** remote 模式：排序寫入本機後延遲推送整包 bundle，避免重整時被舊雲端覆蓋 */
function scheduleRemoteBundlePush() {
  if (getStorageMode() !== 'remote') return;
  if (remotePushTimer) clearTimeout(remotePushTimer);
  remotePushTimer = setTimeout(() => {
    remotePushTimer = null;
    void import('../services/remoteSyncHub').then((m) => m.syncRemoteAfterDirectLocalMutation());
  }, 400);
}

/** 立即推送（例如按「完成」後），避免使用者馬上重整時尚未 PUT */
export async function flushNavOrderRemoteSync(): Promise<void> {
  if (getStorageMode() !== 'remote') return;
  if (remotePushTimer) {
    clearTimeout(remotePushTimer);
    remotePushTimer = null;
  }
  const { syncRemoteAfterDirectLocalMutation } = await import('../services/remoteSyncHub');
  await syncRemoteAfterDirectLocalMutation();
}

function keyForRole(role: string): string {
  if (role === 'admin' || role === 'franchisee' || role === 'employee') {
    return `${PREFIX}_${role}` as const;
  }
  return `${PREFIX}_other`;
}

/**
 * 依本機儲存之 id 順序排列選單；僅含目前角色實際存在的 id，遺漏者依預設順序補上。
 */
export function applySavedNavOrder<T extends { id: string }>(defaults: T[], role: string, saved: string[] | null): T[] {
  if (!saved || saved.length === 0) return defaults;
  const byId = new Map(defaults.map((x) => [x.id, x] as [string, T]));
  const out: T[] = [];
  for (const id of saved) {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id);
    }
  }
  for (const d of defaults) {
    if (byId.has(d.id)) out.push(d);
  }
  return out;
}

export function loadNavOrderForRole(role: string): string[] | null {
  try {
    const raw = localStorage.getItem(keyForRole(role));
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p) || p.some((x) => typeof x !== 'string')) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveNavOrderForRole(role: string, orderIds: string[]) {
  try {
    localStorage.setItem(keyForRole(role), JSON.stringify(orderIds));
    scheduleRemoteBundlePush();
  } catch {
    /* ignore */
  }
}

export function clearNavOrderForRole(role: string) {
  try {
    localStorage.removeItem(keyForRole(role));
    scheduleRemoteBundlePush();
  } catch {
    /* ignore */
  }
}
