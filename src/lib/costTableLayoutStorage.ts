import type { CostColumn } from './costStructureStorage';

const STORAGE_KEY = 'dongshan_cost_table_col_widths_v1';

/** 與 CostStructureTable 歷史配置一致：品名 ×0.8、類別 ×0.5；展開／單位／自訂欄池／操作 ×1.3 */
const COST_TABLE_RAW = {
  expand: 2 * 1.3,
  name: 26 * 0.8,
  unit: 4 * 1.3,
  category: 15 * 0.5,
  dynamicPool: 49 * 1.3,
  action: 4 * 1.3,
} as const;

const COST_TABLE_RAW_SUM =
  COST_TABLE_RAW.expand +
  COST_TABLE_RAW.name +
  COST_TABLE_RAW.unit +
  COST_TABLE_RAW.category +
  COST_TABLE_RAW.dynamicPool +
  COST_TABLE_RAW.action;

const DYNAMIC_POOL_PERCENT = (COST_TABLE_RAW.dynamicPool / COST_TABLE_RAW_SUM) * 100;

function dynamicColumnPercentsNumbers(columns: CostColumn[], poolPercent: number): number[] {
  if (columns.length === 0) return [];
  const weight = (c: CostColumn) =>
    c.kind === 'text' ? 1.55 : c.kind === 'percent' ? 0.58 : c.kind === 'currency' ? 0.64 : 0.62;
  const sum = columns.reduce((s, c) => s + weight(c), 0);
  if (sum <= 0) return columns.map(() => poolPercent / columns.length);
  return columns.map((c) => ((weight(c) / sum) * poolPercent));
}

/** 欄位 id 序列簽章，結構變更時不重用最後儲存的寬度 */
export function costTableColumnSignature(columns: CostColumn[]): string {
  return JSON.stringify(columns.map((c) => c.id));
}

/** 預設欄寬百分比，順序：展開、品名、單位、類別、…自訂欄、操作；加總 100 */
export function buildDefaultCostTablePercents(columns: CostColumn[]): number[] {
  const e = (COST_TABLE_RAW.expand / COST_TABLE_RAW_SUM) * 100;
  const n = (COST_TABLE_RAW.name / COST_TABLE_RAW_SUM) * 100;
  const u = (COST_TABLE_RAW.unit / COST_TABLE_RAW_SUM) * 100;
  const c = (COST_TABLE_RAW.category / COST_TABLE_RAW_SUM) * 100;
  const a = (COST_TABLE_RAW.action / COST_TABLE_RAW_SUM) * 100;
  const dyn = dynamicColumnPercentsNumbers(columns, DYNAMIC_POOL_PERCENT);
  return normalizePercentsTo100([e, n, u, c, ...dyn, a]);
}

export function normalizePercentsTo100(percents: number[]): number[] {
  const s = percents.reduce((acc, x) => acc + (Number.isFinite(x) ? x : 0), 0);
  if (s <= 0) return percents.map(() => 100 / percents.length);
  return percents.map((x) => ((Number.isFinite(x) ? x : 0) / s) * 100);
}

type SavedLayoutV1 = { v: 1; sig: string; percents: number[] };

export function loadCostTablePercents(columns: CostColumn[]): number[] | null {
  const expectedLen = 5 + columns.length;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedLayoutV1;
    if (p.v !== 1 || typeof p.sig !== 'string' || p.sig !== costTableColumnSignature(columns)) return null;
    if (!Array.isArray(p.percents) || p.percents.length !== expectedLen) return null;
    if (p.percents.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
    return normalizePercentsTo100(p.percents);
  } catch {
    return null;
  }
}

export function saveCostTablePercents(columns: CostColumn[], percents: number[]): void {
  const expectedLen = 5 + columns.length;
  if (percents.length !== expectedLen) return;
  try {
    const norm = normalizePercentsTo100(percents);
    const payload: SavedLayoutV1 = { v: 1, sig: costTableColumnSignature(columns), percents: norm };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

/** 拖曳分隔線：第 i 欄與第 i+1 欄之間，delta 為左欄增加之百分比（表寬為 100%） */
export function applyAdjacentColumnResize(
  percents: number[],
  leftIndex: number,
  deltaPercent: number,
  minPct: number,
): number[] {
  if (leftIndex < 0 || leftIndex >= percents.length - 1) return percents;
  const out = [...percents];
  const a = leftIndex;
  const b = leftIndex + 1;
  const d = Math.min(Math.max(deltaPercent, minPct - out[a]!), out[b]! - minPct);
  out[a] = out[a]! + d;
  out[b] = out[b]! - d;
  return normalizePercentsTo100(out);
}
