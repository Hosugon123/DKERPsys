const PREFIX = 'dongshan_sidebar_main_nav_order_v1';

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
  } catch {
    /* ignore */
  }
}

export function clearNavOrderForRole(role: string) {
  try {
    localStorage.removeItem(keyForRole(role));
  } catch {
    /* ignore */
  }
}
