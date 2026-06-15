import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  TrendingUp,
  FileText,
  Target,
  Store,
  HandCoins,
  Boxes,
  Package,
  LayoutDashboard,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Eye,
  X,
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { UserRole } from './Orders';
import {
  DashboardMonthCustomRangePicker,
  dashboardPeriodLabel,
  resolveDashboardPeriodYmd,
  type DashboardPeriodMode,
} from '../components/DashboardPeriodPicker';
import { cn } from '../lib/utils';
import { useIsNarrowScreen } from '../hooks/useIsNarrowScreen';
import { useUnsavedWorkBlock } from '../hooks/useUnsavedWorkBlock';
import { usePersistWorkDraft, useRestoreWorkDraft } from '../hooks/useWorkDraft';
import { WORK_DRAFT_IDS, clearWorkDraft } from '../lib/workDraftStorage';
import {
  computeAdminDashboardFinanceForYmdRange,
  computeStallGapSummary,
  stallCountAttributeYmd,
  stallSalesBoardRowYmd,
  type StallGapSummary,
} from '../lib/financeLib';
import type { AccountingLedgerEntry } from '../lib/accountingLedgerStorage';
import { computeDirectStoreOperatingExpense } from '../lib/directStoreOperatingExpense';
import {
  usesDirectStoreOperatingExpenseModel,
  usesFranchiseeOperatingExpenseModel,
} from '../lib/operatingExpenseModel';
import {
  getAllSupplyItems,
  getSupplyItem,
  isConsumableItem,
  isFranchiseeSelfSuppliedItem,
  type SupplyRetailView,
} from '../lib/supplyCatalog';
import {
  getStallDisplayActualRevenueIfEntered,
  getStallDisplaySoldAtRetail,
} from '../lib/orderStallDisplayRevenue';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import {
  effectiveOrderDateYmd,
  orderCountsTowardStallEconomics,
  orderIsFranchiseBusinessScoped,
  orderIsHeadquartersDirectScoped,
  orderMatchesSessionScope,
  resolveOrderDataScopeId,
  type OrderHistoryEntry,
} from '../lib/orderHistoryStorage';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  buildDirectStallEconomicsByYmd,
  buildFranchiseStallEconomicsByYmd,
  type DirectStallDayEconomics,
} from '../lib/directStallDayEconomics';
import { getDataScopeContext, HQ_SCOPE_ID } from '../lib/dataScope';
import {
  clearRevenueBaselineTarget,
  getRevenueBaselineTarget,
  REVENUE_BASELINE_UPDATED_EVENT,
  resolveStallRevenueBaselineScopeId,
  setRevenueBaselineTarget,
} from '../lib/dashboardRevenueBaselineStorage';
import { computeLine } from '../lib/stallMath';
import { mergeSalesRecordWithCatalog, type SalesRecordDaySnapshot } from '../lib/salesRecordStorage';

const HQ_STALL_VIEW = 'headquarter' as const;
const FRANCHISE_STALL_VIEW = 'franchisee' as const;

type DashboardOrder = OrderHistoryEntry;

function resolveFranchiseScopeOwnerUserId(
  viewAsFranchisee: DashboardViewAsTarget | null | undefined,
): string | null {
  if (viewAsFranchisee?.userId?.trim()) return viewAsFranchisee.userId.trim();
  const ctx = getDataScopeContext();
  const fromScope = ctx.scopeId.match(/^scope:franchisee:(.+)$/)?.[1]?.trim();
  if (fromScope) return fromScope;
  if (ctx.role === 'franchisee' && ctx.userId.trim()) return ctx.userId.trim();
  return null;
}

type ProductRevenueRow = { id: number; name: string; revenue: number; qty: number; pct: number };
/** 盤點落差等區塊：與營運 KPI 相同語意（本月／自訂） */
type DirectStallGapRangeMode = DashboardPeriodMode;
/** 銷售數據區間：none＝不篩日期（全部已建檔營業日） */
type StallSalesBoardRangeMode = { kind: 'none' } | DashboardPeriodMode;
type ExpenseShareRow = { id: number; name: string; amount: number; pct: number };
const RANK_DEFAULT_LIMIT = 10;
type RevenueRankRow = { id: number; name: string; revenue: number; pct?: number };
type AmountRankRow = { id: number; name: string; amount: number; pct?: number };
const FRANCHISE_REVENUE_SCOPE_ALL = 'all';

function aggregateProductRevenue(
  orders: DashboardOrder[],
  predicate: (o: DashboardOrder) => boolean,
  includeLine?: (o: DashboardOrder, line: DashboardOrder['lines'][number]) => boolean,
): ProductRevenueRow[] {
  const byName = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const o of orders) {
    if (!predicate(o)) continue;
    for (const line of o.lines) {
      if (includeLine && !includeLine(o, line)) continue;
      const prev = byName.get(line.name) ?? { name: line.name, qty: 0, revenue: 0 };
      prev.qty += line.qty;
      prev.revenue += line.qty * line.unitPrice;
      byName.set(line.name, prev);
    }
  }
  const rows = Array.from(byName.values()).sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return rows.map((r, i) => ({
    id: i + 1,
    name: r.name,
    qty: r.qty,
    revenue: r.revenue,
    pct: total > 0 ? (r.revenue / total) * 100 : 0,
  }));
}

function aggregateExpenseShareRows(
  entries: AccountingLedgerEntry[],
  startYmd: string,
  endYmd: string,
): ExpenseShareRow[] {
  const byName = new Map<string, number>();
  for (const e of entries) {
    if (e.flowType !== 'expense') continue;
    if (e.dateYmd < startYmd || e.dateYmd > endYmd) continue;
    const name = e.subCategory?.trim() ? `${e.category} / ${e.subCategory.trim()}` : e.category;
    byName.set(name, (byName.get(name) ?? 0) + e.amount);
  }
  const rows = Array.from(byName.entries()).map(([name, amount]) => ({ name, amount }));
  rows.sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.map((r, i) => ({ id: i + 1, name: r.name, amount: r.amount, pct: pct(r.amount, total) }));
}

function RevenueRankingBars({
  rows,
  totalRevenue,
  showAll,
  onToggleShowAll,
  emptyText,
}: {
  rows: RevenueRankRow[];
  totalRevenue: number;
  showAll: boolean;
  onToggleShowAll: () => void;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 py-8 text-center">{emptyText}</p>;
  }
  const visibleRows = showAll ? rows : rows.slice(0, RANK_DEFAULT_LIMIT);
  return (
    <>
      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1 space-y-2.5 overscroll-y-contain">
        {visibleRows.map((row, idx) => {
          const rank = idx + 1;
          const pctVal = row.pct ?? pct(row.revenue, totalRevenue);
          const pctSafe = Number.isFinite(pctVal) ? Math.max(0, pctVal) : 0;
          const fillPct = Math.max(2, Math.min(100, pctSafe));
          const isTop3 = rank <= 3;
          return (
            <div key={`${row.id}-${row.name}`} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 tabular-nums text-[11px] font-semibold',
                      isTop3 ? 'bg-amber-600 text-zinc-950' : 'bg-zinc-800 text-zinc-300',
                    )}
                  >
                    {rank}
                  </span>
                  <span className="truncate text-zinc-200">{row.name}</span>
                </div>
                <span className="shrink-0 tabular-nums text-amber-200">
                  {moneyTW(row.revenue)} ({pctSafe.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-zinc-800/90 border border-zinc-700/80 overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    isTop3
                      ? 'bg-gradient-to-r from-amber-500 to-amber-700'
                      : 'bg-gradient-to-r from-zinc-500 to-zinc-700',
                  )}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > RANK_DEFAULT_LIMIT && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-3 text-xs text-amber-400 hover:text-amber-300"
        >
          {showAll ? '收合排行' : '展開全部商品'}
        </button>
      )}
    </>
  );
}

function AmountRankingBars({
  rows,
  totalAmount,
  showAll,
  onToggleShowAll,
  emptyText,
  expandLabel = '展開全部項目',
  hideToggle = false,
}: {
  rows: AmountRankRow[];
  totalAmount: number;
  showAll: boolean;
  onToggleShowAll: () => void;
  emptyText: string;
  expandLabel?: string;
  hideToggle?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 py-8 text-center">{emptyText}</p>;
  }
  const visibleRows = showAll ? rows : rows.slice(0, RANK_DEFAULT_LIMIT);
  return (
    <>
      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1 space-y-2.5 overscroll-y-contain">
        {visibleRows.map((row, idx) => {
          const rank = idx + 1;
          const pctVal = row.pct ?? pct(row.amount, totalAmount);
          const pctSafe = Number.isFinite(pctVal) ? Math.max(0, pctVal) : 0;
          const fillPct = Math.max(2, Math.min(100, pctSafe));
          const isTop3 = rank <= 3;
          return (
            <div key={`${row.id}-${row.name}`} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 tabular-nums text-[11px] font-semibold',
                      isTop3 ? 'bg-amber-600 text-zinc-950' : 'bg-zinc-800 text-zinc-300',
                    )}
                  >
                    {rank}
                  </span>
                  <span className="truncate text-zinc-200">{row.name}</span>
                </div>
                <span className="shrink-0 tabular-nums text-amber-200">
                  {moneyTW(row.amount)} ({pctSafe.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-zinc-800/90 border border-zinc-700/80 overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    isTop3
                      ? 'bg-gradient-to-r from-amber-500 to-amber-700'
                      : 'bg-gradient-to-r from-zinc-500 to-zinc-700',
                  )}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {!hideToggle && rows.length > RANK_DEFAULT_LIMIT && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-3 text-xs text-amber-400 hover:text-amber-300"
        >
          {showAll ? '收合排行' : expandLabel}
        </button>
      )}
    </>
  );
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDaysYmd(ymd: string, days: number): string {
  const dt = parseYmdToDate(ymd);
  dt.setDate(dt.getDate() + days);
  return toYmd(dt);
}

function startOfWeekMondayYmd(baseYmd: string): string {
  const dt = parseYmdToDate(baseYmd);
  const shift = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - shift);
  return toYmd(dt);
}

/** 週營業額分析用：週一 index 0 … 週日 index 6 */
function mondayFirstWeekdayIndexFromYmd(ymd: string): number {
  const dt = parseYmdToDate(ymd);
  return (dt.getDay() + 6) % 7;
}

const WEEKDAY_TOGGLE_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const;

/** 營業額打底：週二（index 1）公休，不顯示、不設目標 */
const REVENUE_BASELINE_OFF_WEEKDAY_IDX = 1;

const REVENUE_BASELINE_WEEKDAYS = WEEKDAY_TOGGLE_LABELS.map((label, idx) => ({ label, idx })).filter(
  (x) => x.idx !== REVENUE_BASELINE_OFF_WEEKDAY_IDX,
);

/** 本週、上週、上上週…共對照幾列（同名星期） */
const WEEKDAY_CHAIN_ROW_COUNT = 16;

function weekdayChainPeriodLabel(k: number, dayShort: string): string {
  if (k === 0) return `本週・${dayShort}`;
  if (k === 1) return `上週・${dayShort}`;
  if (k === 2) return `上上週・${dayShort}`;
  return `${k} 週前・${dayShort}`;
}

function weeksBackFromCurrentWeekMonday(ymd: string): number {
  const todayStr = toYmd(new Date());
  const mondayThisWeek = startOfWeekMondayYmd(todayStr);
  const mondayTarget = startOfWeekMondayYmd(ymd);
  const diffMs =
    parseYmdToDate(mondayThisWeek).getTime() - parseYmdToDate(mondayTarget).getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function ymdSlash(ymd: string): string {
  return ymd.replace(/-/g, '/');
}

function orderMatchesFranchiseeBusinessDash(
  row: Pick<OrderHistoryEntry, 'scopeId' | 'actorUserId' | 'actorRole'>,
  franchiseeUserId: string,
): boolean {
  const uid = franchiseeUserId.trim();
  if (!uid) return false;
  const scope = resolveOrderDataScopeId(row);
  if (scope === `scope:franchisee:${uid}`) return true;
  return row.actorRole === 'franchisee' && row.actorUserId === uid;
}

function stallSnapshotMergedFromOrder(
  o: OrderHistoryEntry,
  getSalesRecordLookup: (ymd: string, scopeId: string) => SalesRecordDaySnapshot | null,
) {
  if (o.stallCountSnapshot) return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  const b = o.stallCountBasisYmd?.trim();
  if (b) {
    const rec = getSalesRecordLookup(b, resolveOrderDataScopeId(o) ?? HQ_SCOPE_ID);
    if (rec) return mergeSalesRecordWithCatalog(rec);
  }
  return null;
}

function accumulateSoldQtyByProductFromSnapshot(
  dayMap: Map<string, number>,
  snap: ReturnType<typeof mergeSalesRecordWithCatalog>,
  retailView: SupplyRetailView,
  franchiseeOwnerUserId?: string,
) {
  for (const id of Object.keys(snap.lines)) {
    const item = getSupplyItem(id, retailView, franchiseeOwnerUserId);
    if (!item || isConsumableItem(item)) continue;
    const line = snap.lines[id] ?? { out: '', remain: '' };
    const c = computeLine(line.out, line.remain, item, { unitBasis: 'retail' });
    if (c.remainUnfilled) continue;
    dayMap.set(id, (dayMap.get(id) ?? 0) + c.sold);
  }
}

function formatWeekdaySoldQty(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

function resolveDirectStallGapYmdRange(mode: DirectStallGapRangeMode): { startYmd: string; endYmd: string } {
  return resolveDashboardPeriodYmd(mode);
}

function directStallGapRangeLabel(mode: DirectStallGapRangeMode): string {
  return dashboardPeriodLabel(mode);
}

function stallSalesBoardRangeLabel(mode: StallSalesBoardRangeMode): string {
  if (mode.kind === 'none') return '全部';
  return directStallGapRangeLabel(mode);
}

function resolveStallSalesBoardYmdRange(
  mode: StallSalesBoardRangeMode,
  economicsByYmd: Map<string, DirectStallDayEconomics>,
): { startYmd: string; endYmd: string } {
  const todayStr = toYmd(new Date());
  if (mode.kind !== 'none') return resolveDirectStallGapYmdRange(mode);
  let min = '';
  let max = '';
  for (const ymd of economicsByYmd.keys()) {
    if (ymd > todayStr) continue;
    if (!min || ymd < min) min = ymd;
    if (!max || ymd > max) max = ymd;
  }
  if (!max) return { startYmd: todayStr, endYmd: todayStr };
  return { startYmd: min, endYmd: max };
}

function commitRevenueBaselineDraft(scopeId: string, idx: number, rawInput: string): void {
  const raw = String(rawInput).replace(/,/g, '').trim();
  if (raw === '') {
    clearRevenueBaselineTarget(scopeId, idx);
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return;
  setRevenueBaselineTarget(scopeId, idx, n);
}

type RevenueBaselineWorkDraft = {
  scopeId: string;
  editing: boolean;
  editDrafts: Record<number, string>;
};

function StallRevenueBaselinePanel({ scopeId }: { scopeId: string }) {
  const restoredBaseline = useRestoreWorkDraft<RevenueBaselineWorkDraft>(
    WORK_DRAFT_IDS.dashboardRevenueBaseline,
  );
  const restoredForScope =
    restoredBaseline?.scopeId === scopeId ? restoredBaseline : undefined;
  const [editing, setEditing] = useState(() => restoredForScope?.editing ?? false);
  const [editDrafts, setEditDrafts] = useState<Record<number, string>>(
    () => restoredForScope?.editDrafts ?? {},
  );
  const [loadTick, setLoadTick] = useState(0);

  useUnsavedWorkBlock(
    `${WORK_DRAFT_IDS.dashboardRevenueBaseline}:${scopeId}`,
    editing,
    '營業額打底',
  );

  usePersistWorkDraft(
    WORK_DRAFT_IDS.dashboardRevenueBaseline,
    { scopeId, editing, editDrafts },
    editing,
  );

  useEffect(() => {
    const onUpdate = () => setLoadTick((t) => t + 1);
    window.addEventListener(REVENUE_BASELINE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(REVENUE_BASELINE_UPDATED_EVENT, onUpdate);
  }, []);

  const savedByWeekday = useMemo(() => {
    const next: Record<number, number | undefined> = {};
    for (const { idx } of REVENUE_BASELINE_WEEKDAYS) {
      next[idx] = getRevenueBaselineTarget(scopeId, idx);
    }
    return next;
  }, [scopeId, loadTick]);

  const startEdit = () => {
    const next: Record<number, string> = {};
    for (const { idx } of REVENUE_BASELINE_WEEKDAYS) {
      const v = savedByWeekday[idx];
      next[idx] = v !== undefined ? String(v) : '';
    }
    setEditDrafts(next);
    setEditing(true);
  };

  const finishEdit = () => {
    for (const { idx } of REVENUE_BASELINE_WEEKDAYS) {
      commitRevenueBaselineDraft(scopeId, idx, editDrafts[idx] ?? '');
    }
    clearWorkDraft(WORK_DRAFT_IDS.dashboardRevenueBaseline);
    setEditing(false);
    setLoadTick((t) => t + 1);
  };

  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-3 sm:p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-sm font-medium text-amber-200/95">營業額打底</span>
        {editing ? (
          <button
            type="button"
            onClick={finishEdit}
            className="shrink-0 min-h-9 px-3 py-1.5 rounded-lg border border-amber-600/50 bg-amber-600/20 text-xs sm:text-sm font-medium text-amber-100 hover:bg-amber-600/30"
          >
            完成
          </button>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 min-h-9 px-3 py-1.5 rounded-lg border border-zinc-600/80 bg-zinc-900/80 text-xs sm:text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800/90"
          >
            編輯
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-1.5">
        {REVENUE_BASELINE_WEEKDAYS.map(({ label, idx }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1 min-w-0 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-1.5 py-2 sm:py-1.5"
          >
            <span className="text-[11px] sm:text-xs text-zinc-500 leading-none">{label}</span>
            {editing ? (
              <input
                type="text"
                inputMode="numeric"
                value={editDrafts[idx] ?? ''}
                onChange={(e) => setEditDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                placeholder="未設定"
                aria-label={`${label}營業額打底`}
                className="w-full min-w-0 h-10 sm:h-9 box-border rounded-md border border-zinc-600/80 bg-zinc-950 px-2 py-0 text-center text-sm sm:text-base font-medium tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/45"
              />
            ) : (
              <span
                className={cn(
                  'w-full text-center text-sm sm:text-base font-medium tabular-nums leading-snug break-all',
                  savedByWeekday[idx] !== undefined ? 'text-amber-100/95' : 'text-zinc-600',
                )}
              >
                {savedByWeekday[idx] !== undefined ? moneyTW(savedByWeekday[idx]!) : '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const WEEKDAY_SELECT_CLASS =
  'w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-600/45 focus:outline-none focus:ring-1 focus:ring-amber-600/25';

function WeekdayChainPicker({
  focusIdx,
  onChange,
}: {
  focusIdx: number | null;
  onChange: (idx: number | null) => void;
  isNarrow?: boolean;
}) {
  return (
    <select
      aria-label="對照星期"
      value={focusIdx === null ? '' : String(focusIdx)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
      className={cn(WEEKDAY_SELECT_CLASS, 'h-9 min-h-0 max-w-full')}
    >
      <option value="">全部（逐日）</option>
      {WEEKDAY_TOGGLE_LABELS.map((label, idx) => (
        <option key={label} value={idx}>
          {label}
        </option>
      ))}
    </select>
  );
}

function moneyTW(n: number) {
  return `$ ${Math.round(n).toLocaleString('zh-TW')}`;
}

function moneySignedInt(n: number) {
  if (n === 0) return '$0';
  const abs = Math.round(Math.abs(n)).toLocaleString('zh-TW');
  return `${n < 0 ? '−' : '+'}$${abs}`;
}

function DirectStallGapReasonCell({
  ymd,
  syncKey,
  preferredNote,
  scopedNotesOnly = false,
  getSalesRecordLookup,
  onPatchRevenueGapReason,
}: {
  ymd: string;
  syncKey: number;
  /** 同列經濟指標已依直營／加盟 scope 彙總之備註；避免讀到另一端的全域銷售紀錄 */
  preferredNote?: string;
  /** 加盟本店：僅顯示該店訂單快照備註，不讀寫全域 salesRecord */
  scopedNotesOnly?: boolean;
  getSalesRecordLookup: (ymd: string, scopeId: string) => SalesRecordDaySnapshot | null;
  onPatchRevenueGapReason: (ymd: string, reason: string, scopeId?: string) => void | Promise<void>;
}) {
  const snap = useMemo(
    () => (scopedNotesOnly ? null : getSalesRecordLookup(ymd, HQ_SCOPE_ID)),
    [ymd, syncKey, scopedNotesOnly, getSalesRecordLookup],
  );
  const snapReason = scopedNotesOnly ? '' : snap?.revenueGapReason?.trim() ?? '';
  const seedReason =
    snapReason ||
    (preferredNote
      ?.split(' · ')
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('落差登錄')) ??
      '');
  const [val, setVal] = useState(seedReason);
  useEffect(() => {
    setVal(seedReason);
  }, [seedReason]);
  const amountLine = scopedNotesOnly
    ? preferredNote
        ?.split(' · ')
        .map((p) => p.trim())
        .find((p) => p.startsWith('落差登錄'))
        ?.replace(/^落差登錄\s*/, '')
    : snap?.revenueGapAmount?.trim() ||
      preferredNote
        ?.split(' · ')
        .map((p) => p.trim())
        .find((p) => p.startsWith('落差登錄'))
        ?.replace(/^落差登錄\s*/, '');
  if (scopedNotesOnly) {
    return (
      <div className="flex min-w-[10rem] max-w-[18rem] flex-col gap-1 text-xs text-zinc-400">
        {seedReason ? <span className="break-words">{seedReason}</span> : <span className="text-zinc-600">—</span>}
        {amountLine ? (
          <span className="text-[10px] leading-snug text-zinc-600">登錄落差 {amountLine}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex min-w-[10rem] max-w-[18rem] flex-col gap-1">
      <input
        type="text"
        aria-label={`${ymd} 備註`}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600/50 focus:outline-none focus:ring-1 focus:ring-amber-600/30"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val.trim() === seedReason.trim()) return;
          void onPatchRevenueGapReason(ymd, val, scopedNotesOnly ? undefined : HQ_SCOPE_ID);
        }}
      />
      {amountLine ? (
        <span className="text-[10px] leading-snug text-zinc-600">登錄落差 {amountLine}</span>
      ) : null}
    </div>
  );
}

function StallGapDashboardSection({
  title,
  summary,
  filterSlot,
}: {
  title: string;
  summary: StallGapSummary;
  /** 置於 `<details>` 展開後、統計與表格明細之上（篩選不佔用 summary 列） */
  filterSlot?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/35">
      <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 text-left [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-zinc-200">{title}</h3>
          <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
            <span className="tabular-nums text-rose-300/90">推估呆帳 {moneyTW(summary.badDebtEstimate)}</span>
            <span className="text-zinc-600 mx-1.5">·</span>
            <span
              className={cn(
                'tabular-nums',
                summary.loggedGapSum < 0
                  ? 'text-rose-400'
                  : summary.loggedGapSum > 0
                    ? 'text-emerald-400/90'
                    : 'text-zinc-400',
              )}
            >
              登記落差 {moneySignedInt(summary.loggedGapSum)}
            </span>
            <span className="text-zinc-600 ml-2">
              {filterSlot ? '（點此展開篩選與明細）' : '（點此展開明細）'}
            </span>
          </p>
        </div>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0 space-y-4 border-t border-zinc-800/80">
      {filterSlot ? <div className="pt-4 pb-4 border-b border-zinc-800/80">{filterSlot}</div> : null}
      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">已知原因落差</p>
          <p
            className={cn(
              'text-xl font-light tabular-nums mt-1',
              summary.loggedGapSum < 0
                ? 'text-rose-300'
                : summary.loggedGapSum > 0
                  ? 'text-emerald-300/90'
                  : 'text-zinc-300',
            )}
          >
            {moneySignedInt(summary.loggedGapSum)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500">落差總和</p>
          <p className="text-xl font-light text-amber-300/90 tabular-nums mt-1">
            {moneyTW(summary.bookShortfallSum)}
          </p>
        </div>
        <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 sm:col-span-2 lg:col-span-2">
          <p className="text-xs text-rose-200/80">推估呆帳</p>
          <p className="text-2xl font-light text-rose-300 tabular-nums mt-1">{moneyTW(summary.badDebtEstimate)}</p>
        </div>
      </div>
      {summary.reasonBreakdown.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">依原因彙總（登記落差金額）</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm min-w-[520px]">
              <thead className="bg-zinc-900/80 text-zinc-500 text-xs border-b border-zinc-800">
                <tr>
                  <th className="px-3 py-2 font-medium">原因摘要</th>
                  <th className="px-3 py-2 font-medium text-center">筆數</th>
                  <th className="px-3 py-2 font-medium text-right">金額加總</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {summary.reasonBreakdown.map((r) => (
                  <tr key={r.reason} className="text-zinc-300">
                    <td className="px-3 py-2 max-w-[280px] break-words">{r.reason}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-zinc-400">{r.orderCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{moneySignedInt(r.loggedAmountSum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-600">本期尚無具名落差原因可彙總。</p>
      )}
      {summary.rows.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">單據明細</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800 max-h-[min(24rem,50vh)] overflow-y-auto">
            <table className="w-full text-left text-[13px] min-w-[720px]">
              <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500 text-xs border-b border-zinc-800 z-[1]">
                <tr>
                  <th className="px-2 py-2 font-medium">盤點日</th>
                  <th className="px-2 py-2 font-medium">門市</th>
                  <th className="px-2 py-2 font-medium font-mono">單號</th>
                  <th className="px-2 py-2 font-medium text-right">登記落差</th>
                  <th className="px-2 py-2 font-medium text-right">帳面短收</th>
                  <th className="px-2 py-2 font-medium">原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {summary.rows.map((r) => (
                  <tr key={r.orderId} className="text-zinc-300 hover:bg-white/[0.02]">
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400">{r.stallYmd}</td>
                    <td className="px-2 py-1.5">{r.storeLabel}</td>
                    <td className="px-2 py-1.5 font-mono text-xs text-zinc-500">{r.orderId}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{moneySignedInt(r.loggedGapAmount)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-200/80">
                      {r.bookShortfall > 0 ? moneyTW(r.bookShortfall) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-400 max-w-[200px] break-words">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-600">本期無盤點短收或落差登記資料。</p>
      )}
      </div>
      </details>
    </div>
  );
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

export type DashboardViewAsTarget = { userId: string; label: string };

export default function Dashboard({
  userRole,
  viewAsFranchisee = null,
  onSelectFranchisee,
  onExitViewAs,
}: {
  userRole: UserRole;
  /** 總部以「另存身份」檢視某加盟店的營運概況；非 null 時整頁切換為加盟主視角 */
  viewAsFranchisee?: DashboardViewAsTarget | null;
  /** 點擊「各加盟店」入口卡時觸發；由 App 切換 viewAsFranchisee */
  onSelectFranchisee?: (target: DashboardViewAsTarget) => void;
  /** 點「返回總部概況」時清除 viewAsFranchisee */
  onExitViewAs?: () => void;
}) {
  const isNarrow = useIsNarrowScreen();
  const realIsAdmin = userRole === 'admin';
  /** 「實際渲染時」的 admin 身份：總部本人＋未進入 view-as 才為 true */
  const isAdmin = realIsAdmin && !viewAsFranchisee;
  const {
    dashboardOrders,
    ledgerEntries: ledgerForView,
    getSalesRecordCached,
    patchRevenueGapReason,
    orderTick,
    financeTick,
  } = useDashboardData(viewAsFranchisee?.userId ?? null);
  const [summaryPeriod, setSummaryPeriod] = useState<DashboardPeriodMode>({ kind: 'month' });
  /** 總部合併 KPI 卡（總部營運總覽／直營店營運摘要）專用區間；與其他區塊的 summaryPeriod 可分開設定 */
  const [adminFinancePeriod, setAdminFinancePeriod] = useState<DashboardPeriodMode>({ kind: 'month' });
  /** 支出結構表專用區間（與上方營運 KPI 獨立） */
  const [expenseStructurePeriod, setExpenseStructurePeriod] = useState<DashboardPeriodMode>({ kind: 'month' });
  /** 總部合併 KPI 卡：總覽四欄 vs 直營兩欄 */
  const [adminKpiTab, setAdminKpiTab] = useState<'hq-overview' | 'direct-stall'>('hq-overview');
  /** 商品營收圓餅專用區間（總部與本店共用；本店僅含可視訂單）；與營運摘要 summaryRange 分開 */
  const [productChartsPeriod, setProductChartsPeriod] = useState<DashboardPeriodMode>({ kind: 'month' });
  const [showAllDirect, setShowAllDirect] = useState(false);
  const [showAllFranchise, setShowAllFranchise] = useState(false);
  const [showAllSelf, setShowAllSelf] = useState(false);
  const [showAllExpenseSelf, setShowAllExpenseSelf] = useState(false);
  const [franchiseRevenueScope, setFranchiseRevenueScope] = useState(FRANCHISE_REVENUE_SCOPE_ALL);
  /** 各加盟店挑選浮層；點頂端按鈕才顯示，不佔主頁版面 */
  const [franchisePickerOpen, setFranchisePickerOpen] = useState(false);
  /** 直營「盤點落差與呆帳」專用區間（與總部營運摘要 summaryRange 獨立） */
  const [directStallGapRange, setDirectStallGapRange] = useState<DirectStallGapRangeMode>({
    kind: 'month',
  });
  /** 本店盤點落差區間（與上方 KPI 的 summaryPeriod 分開；同總部直營盤點操作） */
  const [nonAdminStallGapRange, setNonAdminStallGapRange] = useState<DirectStallGapRangeMode>({
    kind: 'month',
  });
  /** 銷售數據區：週次對照與同名星期統計之區間（與 KPI、盤點落差分開） */
  const [stallSalesBoardRange, setStallSalesBoardRange] = useState<StallSalesBoardRangeMode>({
    kind: 'none',
  });
  /** 對照「本週／上週／上上週…」之同名星期：0＝週一 … 6＝週日 */
  /** null＝不篩星期，表格為區間內逐日；0–6＝週一…週日同名星期對照 */
  const [weekdayChainFocusIdx, setWeekdayChainFocusIdx] = useState<number | null>(null);
  /** 銷售數據表列點選之聚焦日（null 時取區間內最近一筆同名星期） */
  const [stallBoardFocusYmd, setStallBoardFocusYmd] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin && franchisePickerOpen) {
      setFranchisePickerOpen(false);
    }
  }, [isAdmin, franchisePickerOpen]);

  useEffect(() => {
    if (!franchisePickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFranchisePickerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [franchisePickerOpen]);

  useEffect(() => {
    setStallBoardFocusYmd(null);
  }, [weekdayChainFocusIdx, stallSalesBoardRange]);

  const adminFinance = useMemo(() => {
    if (!isAdmin) return null;
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(adminFinancePeriod);
    return computeAdminDashboardFinanceForYmdRange(startYmd, endYmd);
  }, [isAdmin, financeTick, orderTick, adminFinancePeriod]);

  const expenseStructureFinance = useMemo(() => {
    if (!isAdmin) return null;
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(expenseStructurePeriod);
    return computeAdminDashboardFinanceForYmdRange(startYmd, endYmd);
  }, [isAdmin, financeTick, orderTick, expenseStructurePeriod]);

  /** 總部營運總覽 KPI：直營店實際營收、加盟批貨、消耗品代收、總支出、淨利 */
  const adminHqOverviewMetrics = useMemo(() => {
    if (!isAdmin || !adminFinance) return null;
    const directStoreRevenue = adminFinance.directStoreActualRevenueTotal;
    const franchiseRevenue = adminFinance.franchiseeOrderTotal;
    const consumableGoodsRevenue = adminFinance.franchiseeConsumableGoodsTotal;
    const expenseTotal = adminFinance.expenseTotal;
    const netProfit = directStoreRevenue + franchiseRevenue - expenseTotal;
    return {
      directStoreRevenue,
      franchiseRevenue,
      consumableGoodsRevenue,
      expenseTotal,
      netProfit,
    };
  }, [isAdmin, adminFinance]);

  /** 直營店營運摘要分頁：毛利與毛利率 */
  const adminFinanceGrossMetrics = useMemo(() => {
    if (!isAdmin || !adminFinance) return null;
    const directOperating = adminFinance.directStoreOperatingExpenseTotal;
    const directRev = adminFinance.directStoreStallRetailTotal;
    const directGross = directRev - directOperating;
    const directGrossRate = pct(directGross, directRev);
    return {
      directOperating,
      directGross,
      directGrossRate,
    };
  }, [isAdmin, adminFinance]);

  /**
   * 「實際渲染」用的訂單清單：view-as 時限縮為該加盟主之單，其他情境同 dashboardOrders。
   * 與 view-as 對應的下方營收／支出計算皆改用此清單，確保與該加盟主自身 Dashboard 一致。
   */
  const effectiveOrders = useMemo(() => {
    if (viewAsFranchisee) {
      const uid = viewAsFranchisee.userId;
      return dashboardOrders.filter((o) => orderMatchesFranchiseeBusinessDash(o, uid));
    }
    return dashboardOrders;
  }, [dashboardOrders, viewAsFranchisee]);

  /** 「銷售數據」區：加盟 scope 為該店加盟主 userId；總部直營為 null */
  const franchiseStallSalesBoardOwnerUserId = useMemo(
    () => resolveFranchiseScopeOwnerUserId(viewAsFranchisee),
    [viewAsFranchisee, userRole],
  );

  /** 加盟主視角：支出＝批貨＋流水；直營店：僅「直營店營業支出」等收支（不含批貨） */
  const franchiseOperatingExpenseModel = useMemo(
    () =>
      franchiseStallSalesBoardOwnerUserId != null ||
      usesFranchiseeOperatingExpenseModel({ userRole, viewAsFranchisee }),
    [franchiseStallSalesBoardOwnerUserId, userRole, viewAsFranchisee],
  );
  const directStoreOperatingExpenseModel = useMemo(
    () => usesDirectStoreOperatingExpenseModel({ userRole, viewAsFranchisee }),
    [userRole, viewAsFranchisee],
  );

  /** 總部直營：每日經濟指標（加盟視角略過以降低不必要計算） */
  const hqDirectStallEconomicsByYmd = useMemo(() => {
    if (franchiseStallSalesBoardOwnerUserId) return new Map<string, DirectStallDayEconomics>();
    return buildDirectStallEconomicsByYmd(effectiveOrders, HQ_STALL_VIEW);
  }, [effectiveOrders, franchiseStallSalesBoardOwnerUserId, orderTick]);

  /** 指定加盟店：已完成盤點之訂單＋孤立銷售紀錄（加盟零售價視角） */
  const franchiseStoreEconomicsByYmd = useMemo(() => {
    if (!franchiseStallSalesBoardOwnerUserId) return new Map<string, DirectStallDayEconomics>();
    return buildFranchiseStallEconomicsByYmd(
      effectiveOrders,
      FRANCHISE_STALL_VIEW,
      franchiseStallSalesBoardOwnerUserId,
    );
  }, [effectiveOrders, franchiseStallSalesBoardOwnerUserId, orderTick]);

  const stallSalesEconomicsByYmd = franchiseStallSalesBoardOwnerUserId
    ? franchiseStoreEconomicsByYmd
    : hqDirectStallEconomicsByYmd;

  type StallWeekdayChainRow = {
    periodLabel: string;
    ymd: string;
    weeksBack: number;
    eco: DirectStallDayEconomics | null;
  };

  const stallSalesBoardResolvedYmd = useMemo(
    () => resolveStallSalesBoardYmdRange(stallSalesBoardRange, stallSalesEconomicsByYmd),
    [stallSalesBoardRange, stallSalesEconomicsByYmd],
  );

  const stallWeekdayChainRows = useMemo((): StallWeekdayChainRow[] => {
    const d = weekdayChainFocusIdx;
    const todayStr = toYmd(new Date());
    const ymdsInScope: string[] = [];

    if (stallSalesBoardRange.kind === 'none') {
      for (const ymd of stallSalesEconomicsByYmd.keys()) {
        if (ymd > todayStr) continue;
        if (d !== null && mondayFirstWeekdayIndexFromYmd(ymd) !== d) continue;
        ymdsInScope.push(ymd);
      }
      ymdsInScope.sort((a, b) => b.localeCompare(a));
    } else {
      const { startYmd, endYmd } = stallSalesBoardResolvedYmd;
      const end = endYmd > todayStr ? todayStr : endYmd;
      if (startYmd <= end) {
        for (let cur = startYmd; cur <= end; cur = addDaysYmd(cur, 1)) {
          const wd = mondayFirstWeekdayIndexFromYmd(cur);
          if (d !== null && wd !== d) continue;
          ymdsInScope.push(cur);
        }
        ymdsInScope.sort((a, b) => b.localeCompare(a));
      }
    }

    const rows: StallWeekdayChainRow[] = ymdsInScope.map((ymd) => {
      const wd = mondayFirstWeekdayIndexFromYmd(ymd);
      const dayShort = WEEKDAY_TOGGLE_LABELS[d ?? wd];
      const weeksBack = weeksBackFromCurrentWeekMonday(ymd);
      return {
        periodLabel:
          d !== null ? weekdayChainPeriodLabel(weeksBack, dayShort) : dayShort,
        ymd,
        weeksBack,
        eco: stallSalesEconomicsByYmd.get(ymd) ?? null,
      };
    });
    if (d !== null) return rows.slice(0, WEEKDAY_CHAIN_ROW_COUNT);
    return rows;
  }, [
    stallSalesEconomicsByYmd,
    stallSalesBoardRange,
    stallSalesBoardResolvedYmd,
    weekdayChainFocusIdx,
  ]);

  const calendarWeekFocusYmd = useMemo(() => {
    if (stallBoardFocusYmd && stallWeekdayChainRows.some((r) => r.ymd === stallBoardFocusYmd)) {
      return stallBoardFocusYmd;
    }
    const todayStr = toYmd(new Date());
    const { endYmd } = stallSalesBoardResolvedYmd;
    const rangeEnd = endYmd > todayStr ? todayStr : endYmd;
    const fallback =
      weekdayChainFocusIdx !== null
        ? addDaysYmd(startOfWeekMondayYmd(todayStr), weekdayChainFocusIdx)
        : rangeEnd;
    return stallWeekdayChainRows[0]?.ymd ?? fallback;
  }, [
    stallBoardFocusYmd,
    stallWeekdayChainRows,
    weekdayChainFocusIdx,
    stallSalesBoardResolvedYmd,
  ]);

  const focusDayEconomics = useMemo(() => {
    return stallSalesEconomicsByYmd.get(calendarWeekFocusYmd) ?? null;
  }, [stallSalesEconomicsByYmd, calendarWeekFocusYmd]);

  const sameWeekdayActualStats = useMemo(() => {
    const d = weekdayChainFocusIdx;
    const todayStr = toYmd(new Date());
    const { startYmd, endYmd } = stallSalesBoardResolvedYmd;
    const filterByRange = stallSalesBoardRange.kind !== 'none';
    const entries: { ymd: string; actual: number }[] = [];
    for (const [ymd, row] of stallSalesEconomicsByYmd.entries()) {
      if (d !== null && mondayFirstWeekdayIndexFromYmd(ymd) !== d) continue;
      if (filterByRange && (ymd < startYmd || ymd > endYmd)) continue;
      if (ymd > todayStr) continue;
      if (row.actual === null) continue;
      entries.push({ ymd, actual: row.actual });
    }
    if (entries.length === 0) {
      return {
        dayCount: 0,
        sum: 0,
        avg: 0,
        max: null as null | { ymd: string; actual: number },
        min: null as null | { ymd: string; actual: number },
      };
    }
    const sum = entries.reduce((s, e) => s + e.actual, 0);
    const avg = sum / entries.length;
    const max = entries.reduce((b, c) => (c.actual > b.actual ? c : b), entries[0]!);
    const min = entries.reduce((b, c) => (c.actual < b.actual ? c : b), entries[0]!);
    return { dayCount: entries.length, sum, avg, max, min };
  }, [
    stallSalesEconomicsByYmd,
    weekdayChainFocusIdx,
    stallSalesBoardRange,
    stallSalesBoardResolvedYmd,
  ]);

  /** 與「銷售統計」相同之曆日集合：各品項當日售出量加總後，再算平均／最高／最低 */
  const sameWeekdayProductSoldStats = useMemo(() => {
    const d = weekdayChainFocusIdx;
    const todayStr = toYmd(new Date());
    const { startYmd, endYmd } = stallSalesBoardResolvedYmd;
    const filterByRange = stallSalesBoardRange.kind !== 'none';
    const retailView: SupplyRetailView = franchiseStallSalesBoardOwnerUserId
      ? FRANCHISE_STALL_VIEW
      : HQ_STALL_VIEW;
    const franchiseId = franchiseStallSalesBoardOwnerUserId;

    const qualifyingYmds: string[] = [];
    for (const [ymd, row] of stallSalesEconomicsByYmd.entries()) {
      if (d !== null && mondayFirstWeekdayIndexFromYmd(ymd) !== d) continue;
      if (filterByRange && (ymd < startYmd || ymd > endYmd)) continue;
      if (ymd > todayStr) continue;
      if (row.actual === null) continue;
      qualifyingYmds.push(ymd);
    }
    qualifyingYmds.sort();

    if (qualifyingYmds.length === 0) {
      return {
        dayCount: 0,
        rows: [] as { id: string; name: string; avg: number; max: number; min: number }[],
      };
    }

    const qualifying = new Set(qualifyingYmds);
    const perDay = new Map<string, Map<string, number>>();

    for (const o of effectiveOrders) {
      if (!orderCountsTowardStallEconomics(o)) continue;
      if (franchiseId) {
        if (!orderMatchesFranchiseeBusinessDash(o, franchiseId)) continue;
      } else if (!orderIsHeadquartersDirectScoped(o)) {
        continue;
      }
      const ymd = stallSalesBoardRowYmd(o);
      if (!ymd || !qualifying.has(ymd)) continue;
      const snap = stallSnapshotMergedFromOrder(o, getSalesRecordCached);
      if (!snap) continue;
      let dayMap = perDay.get(ymd);
      if (!dayMap) {
        dayMap = new Map();
        perDay.set(ymd, dayMap);
      }
      accumulateSoldQtyByProductFromSnapshot(dayMap, snap, retailView, franchiseId ?? undefined);
    }

    for (const ymd of qualifyingYmds) {
      if (perDay.has(ymd)) continue;
      const salesScope = franchiseId ? `scope:franchisee:${franchiseId}` : HQ_SCOPE_ID;
      const raw = getSalesRecordCached(ymd, salesScope);
      if (!raw) continue;
      const snap = mergeSalesRecordWithCatalog(raw);
      const dayMap = new Map<string, number>();
      accumulateSoldQtyByProductFromSnapshot(dayMap, snap, retailView, franchiseId ?? undefined);
      if (dayMap.size > 0) perDay.set(ymd, dayMap);
    }

    const allIds = new Set<string>();
    for (const m of perDay.values()) {
      for (const id of m.keys()) allIds.add(id);
    }

    const n = qualifyingYmds.length;
    const rows: { id: string; name: string; avg: number; max: number; min: number }[] = [];
    for (const id of allIds) {
      const item = getSupplyItem(id, retailView, franchiseId ?? undefined);
      const name = item?.name ?? id;
      const series = qualifyingYmds.map((ymd) => perDay.get(ymd)?.get(id) ?? 0);
      const sum = series.reduce((s, v) => s + v, 0);
      const avg = sum / n;
      const max = Math.max(...series);
      const min = Math.min(...series);
      rows.push({ id, name, avg, max, min });
    }
    const catalogOrderIndex = new Map<string, number>();
    getAllSupplyItems(retailView, franchiseId ?? undefined)
      .filter((item) => !isConsumableItem(item))
      .forEach((item, index) => catalogOrderIndex.set(item.id, index));
    rows.sort((a, b) => {
      const ia = catalogOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const ib = catalogOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
    return { dayCount: n, rows };
  }, [
    stallSalesEconomicsByYmd,
    weekdayChainFocusIdx,
    stallSalesBoardRange,
    stallSalesBoardResolvedYmd,
    effectiveOrders,
    franchiseStallSalesBoardOwnerUserId,
    orderTick,
    getSalesRecordCached,
  ]);

  const showFranchiseStallSalesBoard = franchiseStallSalesBoardOwnerUserId != null;
  const showStallSalesBoard =
    (realIsAdmin && !viewAsFranchisee) || showFranchiseStallSalesBoard;

  const stallRevenueBaselineScopeId = useMemo(
    () => resolveStallRevenueBaselineScopeId(franchiseStallSalesBoardOwnerUserId),
    [franchiseStallSalesBoardOwnerUserId],
  );
  const [revenueBaselineTick, setRevenueBaselineTick] = useState(0);
  useEffect(() => {
    const onUpdate = () => setRevenueBaselineTick((t) => t + 1);
    window.addEventListener(REVENUE_BASELINE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(REVENUE_BASELINE_UPDATED_EVENT, onUpdate);
  }, []);

  const focusDayWeekdayIdx = useMemo(
    () => (calendarWeekFocusYmd ? mondayFirstWeekdayIndexFromYmd(calendarWeekFocusYmd) : null),
    [calendarWeekFocusYmd],
  );

  const focusDayRevenueBaseline = useMemo(() => {
    if (!calendarWeekFocusYmd || focusDayWeekdayIdx === REVENUE_BASELINE_OFF_WEEKDAY_IDX) return undefined;
    return getRevenueBaselineTarget(stallRevenueBaselineScopeId, focusDayWeekdayIdx);
  }, [calendarWeekFocusYmd, focusDayWeekdayIdx, stallRevenueBaselineScopeId, revenueBaselineTick]);

  const focusDayMeetsRevenueBaseline = useMemo(() => {
    if (focusDayRevenueBaseline === undefined) return false;
    const actual = focusDayEconomics?.actual;
    return actual !== null && actual !== undefined && actual >= focusDayRevenueBaseline;
  }, [focusDayRevenueBaseline, focusDayEconomics]);

  const nonAdminSummary = useMemo(() => {
    if (isAdmin) return null;
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(summaryPeriod);
    const stallCompleted = effectiveOrders.filter((o) => {
      if (!orderCountsTowardStallEconomics(o)) return false;
      const ymd = stallCountAttributeYmd(o);
      return Boolean(ymd && ymd >= startYmd && ymd <= endYmd);
    });
    const stallRetailView: SupplyRetailView = franchiseStallSalesBoardOwnerUserId
      ? FRANCHISE_STALL_VIEW
      : HQ_STALL_VIEW;
    const revenue = stallCompleted.reduce((s, o) => {
      if (franchiseOperatingExpenseModel) {
        return s + (getStallDisplayActualRevenueIfEntered(o) ?? 0);
      }
      return s + (getStallDisplaySoldAtRetail(o, stallRetailView) ?? 0);
    }, 0);
    let procurementCost = 0;
    let ledgerExpense = 0;
    let expense = 0;
    if (franchiseOperatingExpenseModel) {
      procurementCost = stallCompleted.reduce((s, o) => s + o.totalAmount, 0);
      ledgerExpense = ledgerForView
        .filter((e) => e.flowType === 'expense' && e.dateYmd >= startYmd && e.dateYmd <= endYmd)
        .reduce((s, e) => s + e.amount, 0);
      expense = procurementCost + ledgerExpense;
    } else if (directStoreOperatingExpenseModel) {
      const parts = computeDirectStoreOperatingExpense(
        effectiveOrders,
        startYmd,
        endYmd,
        undefined,
        userRole === 'employee' ? { includePayroll: false } : undefined,
      );
      ledgerExpense = parts.ledgerExpenseTotal;
      expense = parts.total;
    } else {
      ledgerExpense = ledgerForView
        .filter((e) => e.flowType === 'expense' && e.dateYmd >= startYmd && e.dateYmd <= endYmd)
        .reduce((s, e) => s + e.amount, 0);
      expense = ledgerExpense;
    }
    const gross = revenue - expense;
    const net = revenue - expense;
    return {
      rangeLabel: dashboardPeriodLabel(summaryPeriod),
      revenue,
      procurementCost,
      ledgerExpense,
      gross,
      grossRate: pct(gross, revenue),
      expense,
      net,
      netRate: pct(net, revenue),
      completed: stallCompleted,
    };
  }, [
    effectiveOrders,
    directStoreOperatingExpenseModel,
    franchiseOperatingExpenseModel,
    franchiseStallSalesBoardOwnerUserId,
    ledgerForView,
    isAdmin,
    summaryPeriod,
    userRole,
    viewAsFranchisee,
  ]);

  /** 本店／view-as：與總部相同，依「建單日」落在區間內之已完成訂單（僅 effectiveOrders） */
  const nonAdminProductChartOrders = useMemo(() => {
    if (isAdmin) return [];
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(productChartsPeriod);
    return effectiveOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd0 = effectiveOrderDateYmd(o);
      return ymd0 >= startYmd && ymd0 <= endYmd;
    });
  }, [effectiveOrders, isAdmin, productChartsPeriod]);

  const topProducts = useMemo(() => {
    if (isAdmin) return [];
    const byName = new Map<string, { name: string; sales: number; revenue: number }>();
    for (const o of nonAdminProductChartOrders) {
      for (const line of o.lines) {
        const lit = getSupplyItem(line.productId);
        if (isConsumableItem(lit)) continue;
        const prev = byName.get(line.name) ?? { name: line.name, sales: 0, revenue: 0 };
        prev.sales += line.qty;
        prev.revenue += line.qty * line.unitPrice;
        byName.set(line.name, prev);
      }
    }
    return Array.from(byName.values())
      .sort((a, b) => (b.revenue === a.revenue ? b.sales - a.sales : b.revenue - a.revenue))
      .map((r, i) => ({ id: i + 1, ...r }));
  }, [isAdmin, nonAdminProductChartOrders]);

  const topProductsTotalRevenue = useMemo(
    () => topProducts.reduce((s, p) => s + p.revenue, 0),
    [topProducts],
  );

  const nonAdminExpenseRows = useMemo(() => {
    if (isAdmin) return [];
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(productChartsPeriod);
    const byName = new Map<string, number>();
    if (franchiseOperatingExpenseModel) {
      const procurementCost = nonAdminProductChartOrders.reduce((s, o) => s + o.totalAmount, 0);
      if (procurementCost > 0) byName.set('批貨與自備成本', procurementCost);
      for (const e of ledgerForView) {
        if (e.flowType !== 'expense') continue;
        if (e.dateYmd < startYmd || e.dateYmd > endYmd) continue;
        const name = e.subCategory?.trim() ? `${e.category} / ${e.subCategory.trim()}` : e.category;
        byName.set(name, (byName.get(name) ?? 0) + e.amount);
      }
    } else if (directStoreOperatingExpenseModel) {
      const parts = computeDirectStoreOperatingExpense(
        effectiveOrders,
        startYmd,
        endYmd,
        undefined,
        userRole === 'employee' ? { includePayroll: false } : undefined,
      );
      if (parts.ledgerOperatingExpenseTotal > 0) {
        byName.set('直營店營業支出', parts.ledgerOperatingExpenseTotal);
      }
    } else {
      for (const e of ledgerForView) {
        if (e.flowType !== 'expense') continue;
        if (e.dateYmd < startYmd || e.dateYmd > endYmd) continue;
        const name = e.subCategory?.trim() ? `${e.category} / ${e.subCategory.trim()}` : e.category;
        byName.set(name, (byName.get(name) ?? 0) + e.amount);
      }
    }
    const rows = Array.from(byName.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return rows.map((r, i) => ({ id: i + 1, name: r.name, amount: r.amount, pct: pct(r.amount, total) }));
  }, [
    directStoreOperatingExpenseModel,
    effectiveOrders,
    franchiseOperatingExpenseModel,
    isAdmin,
    productChartsPeriod,
    ledgerForView,
    nonAdminProductChartOrders,
  ]);

  const adminProductChartOrders = useMemo(() => {
    if (!isAdmin) return [];
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(productChartsPeriod);
    return dashboardOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd0 = effectiveOrderDateYmd(o);
      return ymd0 >= startYmd && ymd0 <= endYmd;
    });
  }, [dashboardOrders, isAdmin, productChartsPeriod]);

  const adminStallGapRange = useMemo(() => {
    if (!isAdmin) return null;
    const { startYmd, endYmd } = resolveDirectStallGapYmdRange(directStallGapRange);
    const directOnly = dashboardOrders.filter((o) => orderIsHeadquartersDirectScoped(o));
    return computeStallGapSummary(directOnly, { type: 'ymd', startYmd, endYmd });
  }, [dashboardOrders, isAdmin, directStallGapRange, orderTick]);

  const directStallGapResolvedYmd = useMemo(
    () => resolveDirectStallGapYmdRange(directStallGapRange),
    [directStallGapRange],
  );

  const nonAdminStallGap = useMemo(() => {
    if (isAdmin) return null;
    const { startYmd, endYmd } = resolveDirectStallGapYmdRange(nonAdminStallGapRange);
    const ordersForGap = franchiseStallSalesBoardOwnerUserId
      ? effectiveOrders.filter((o) => orderMatchesFranchiseeBusinessDash(o, franchiseStallSalesBoardOwnerUserId))
      : effectiveOrders.filter((o) => orderIsHeadquartersDirectScoped(o));
    const retailView = franchiseStallSalesBoardOwnerUserId ? FRANCHISE_STALL_VIEW : HQ_STALL_VIEW;
    return computeStallGapSummary(ordersForGap, { type: 'ymd', startYmd, endYmd }, retailView);
  }, [
    effectiveOrders,
    franchiseStallSalesBoardOwnerUserId,
    isAdmin,
    nonAdminStallGapRange,
    orderTick,
  ]);

  const nonAdminStallGapResolvedYmd = useMemo(
    () => resolveDirectStallGapYmdRange(nonAdminStallGapRange),
    [nonAdminStallGapRange],
  );

  const adminDirectProducts = useMemo(() => {
    if (!isAdmin) return [];
    return aggregateProductRevenue(
      adminProductChartOrders,
      (o) => orderIsHeadquartersDirectScoped(o),
    );
  }, [adminProductChartOrders, isAdmin]);

  const adminFranchiseRevenueScopeOptions = useMemo(() => {
    if (!isAdmin) return [] as Array<{ key: string; label: string }>;
    const map = new Map<string, string>();
    for (const o of adminProductChartOrders) {
      if (!orderIsFranchiseBusinessScoped(o)) continue;
      const userId = o.actorUserId?.trim();
      const key = userId ? `uid:${userId}` : `label:${o.storeLabel}`;
      if (!map.has(key)) map.set(key, resolveOrderStoreLabel(o));
    }
    const list = Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
    return [{ key: FRANCHISE_REVENUE_SCOPE_ALL, label: '整體批貨' }, ...list];
  }, [adminProductChartOrders, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (adminFranchiseRevenueScopeOptions.some((o) => o.key === franchiseRevenueScope)) return;
    setFranchiseRevenueScope(FRANCHISE_REVENUE_SCOPE_ALL);
  }, [adminFranchiseRevenueScopeOptions, franchiseRevenueScope, isAdmin]);

  const adminFranchiseProducts = useMemo(() => {
    if (!isAdmin) return [];
    return aggregateProductRevenue(
      adminProductChartOrders,
      (o) => {
        if (!orderIsFranchiseBusinessScoped(o)) return false;
        if (franchiseRevenueScope === FRANCHISE_REVENUE_SCOPE_ALL) return true;
        if (franchiseRevenueScope.startsWith('uid:')) {
          const uid = franchiseRevenueScope.slice(4);
          return (o.actorUserId?.trim() ?? '') === uid;
        }
        if (franchiseRevenueScope.startsWith('label:')) {
          const label = franchiseRevenueScope.slice(6);
          return o.storeLabel === label;
        }
        return true;
      },
      (_o, line) => {
        const item = getSupplyItem(line.productId);
        if (isConsumableItem(item)) return false;
        return !isFranchiseeSelfSuppliedItem(item);
      },
    );
  }, [adminProductChartOrders, franchiseRevenueScope, isAdmin]);

  /**
   * 各加盟店摘要（總部選店浮層）：
   * - 已完成訂單數：依「建單日落於本期間」計
   * - 盤點完成數：依「盤點日落於本期間」計
   * - 實際營收：盤點登錄之實際收入，以盤點日歸屬；總部介面不顯示批貨進貨成本（詳細請進入該加盟主視角）
   */
  const franchiseStoreBreakdown = useMemo(() => {
    if (!realIsAdmin) return [];
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(summaryPeriod);
    type Row = {
      /** 加盟主之 user.id；舊資料若無 actorUserId 則為 null（無法進入 view-as） */
      franchiseeUserId: string | null;
      label: string;
      completedOrderCount: number;
      stallCompletedCount: number;
      revenue: number;
    };
    const map = new Map<string, Row>();
    for (const o of dashboardOrders) {
      if (!orderIsFranchiseBusinessScoped(o)) continue;

      const bookYmd = effectiveOrderDateYmd(o);
      const isCompletedInRange =
        o.status === '已完成' && bookYmd >= startYmd && bookYmd <= endYmd;

      const stallYmd = stallCountAttributeYmd(o);
      const isStallInRange = Boolean(
        orderCountsTowardStallEconomics(o) && stallYmd && stallYmd >= startYmd && stallYmd <= endYmd,
      );

      if (!isCompletedInRange && !isStallInRange) continue;

      const label = resolveOrderStoreLabel({
        storeLabel: o.storeLabel,
        actorRole: o.actorRole,
        actorUserId: o.actorUserId,
        scopeId: o.scopeId,
      });
      let franchiseeUserId = o.actorUserId ?? null;
      if (!franchiseeUserId && o.scopeId?.trim().startsWith('scope:franchisee:')) {
        franchiseeUserId = o.scopeId.trim().slice('scope:franchisee:'.length) || null;
      }
      // 以加盟主 user.id 為唯一鍵，避免不同加盟主湊巧同名而被合併
      const key = franchiseeUserId ? `uid:${franchiseeUserId}` : `legacy:${label}`;
      const row =
        map.get(key) ??
        ({
          franchiseeUserId,
          label,
          completedOrderCount: 0,
          stallCompletedCount: 0,
          revenue: 0,
        } satisfies Row);

      if (isCompletedInRange) row.completedOrderCount += 1;
      if (isStallInRange) {
        row.stallCompletedCount += 1;
        row.revenue += getStallDisplayActualRevenueIfEntered(o) ?? 0;
      }
      map.set(key, row);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.completedOrderCount - a.completedOrderCount ||
        a.label.localeCompare(b.label, 'zh-Hant'),
    );
  }, [dashboardOrders, realIsAdmin, summaryPeriod]);

  return (
    <div className="space-y-6">
      {viewAsFranchisee && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <Eye size={18} className="text-amber-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
            <p className="text-sm text-amber-100 leading-relaxed">
              目前以加盟主視角檢視
              <span className="font-semibold text-amber-300 mx-1">{viewAsFranchisee.label}</span>
              的營運概況
              <span className="text-amber-200/70 ml-1">（與加盟主自身畫面一致；收支支出取該店本機紀錄）</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => onExitViewAs?.()}
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/50 bg-amber-600/15 text-amber-200 text-xs font-medium hover:bg-amber-600/25 shrink-0"
          >
            <ArrowLeft size={14} aria-hidden />
            返回總部概況
          </button>
        </div>
      )}

      <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
        <h2 className="min-w-0 flex-1 pr-1 m-0 text-xl font-bold leading-snug tracking-tight sm:text-3xl flex flex-wrap items-center gap-x-2 gap-y-1">
          <LayoutDashboard className="text-amber-500 shrink-0 block" size={28} aria-hidden />
          <span className="min-w-0 break-words">
            {viewAsFranchisee
              ? `${viewAsFranchisee.label} 營運概況`
              : realIsAdmin
                ? '總部營運概況'
                : '我的營運概況'}
          </span>
        </h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setFranchisePickerOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-2 sm:px-3 bg-zinc-900/80 border border-zinc-700 rounded-lg text-zinc-200 hover:bg-zinc-800 hover:border-amber-600/50 hover:text-amber-200 transition-colors font-medium text-[0.8rem] sm:text-[0.825rem]"
            aria-label="各加盟店概況"
            title="點此挑選一家加盟店，以該加盟主視角檢視完整營運概況"
            aria-haspopup="dialog"
            aria-expanded={franchisePickerOpen}
          >
            <Store size={14} className="shrink-0" aria-hidden />
            <span className="sm:hidden" aria-hidden>
              加盟店
            </span>
            <span className="hidden sm:inline">各加盟店概況</span>
            {franchiseStoreBreakdown.length > 0 && (
              <span className="text-[10px] font-semibold text-amber-400 tabular-nums">
                {franchiseStoreBreakdown.length}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {isAdmin && adminFinance ? (
          <div className="lg:col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-[1.15rem] sm:p-7">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2">
              <div className="flex flex-col gap-2.5">
                <div
                  className="grid w-full grid-cols-2 gap-1.5"
                  role="tablist"
                  aria-label="營運數據檢視"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={adminKpiTab === 'hq-overview'}
                    onClick={() => setAdminKpiTab('hq-overview')}
                    className={cn(
                      'min-h-9 w-full rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                      adminKpiTab === 'hq-overview'
                        ? 'bg-amber-600/20 text-amber-200 ring-1 ring-amber-500/35'
                        : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200',
                    )}
                  >
                    總部營運總覽
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={adminKpiTab === 'direct-stall'}
                    onClick={() => setAdminKpiTab('direct-stall')}
                    className={cn(
                      'min-h-9 w-full rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                      adminKpiTab === 'direct-stall'
                        ? 'bg-amber-600/20 text-amber-200 ring-1 ring-amber-500/35'
                        : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200',
                    )}
                  >
                    直營店營運摘要
                  </button>
                </div>
                <div className="w-full min-w-0 border-t border-zinc-800/80 pt-2.5 space-y-2">
                  <span className="block text-xs text-zinc-500">
                    數據區間：
                    <span className="font-medium text-amber-200/90">
                      {dashboardPeriodLabel(adminFinancePeriod)}
                    </span>
                  </span>
                  <DashboardMonthCustomRangePicker
                    value={adminFinancePeriod}
                    onChange={setAdminFinancePeriod}
                    ariaLabel="營運數據區間"
                    stretch
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4 sm:p-5">
              {adminKpiTab === 'hq-overview' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0 lg:divide-x lg:divide-zinc-800/80">
                  <div className="min-w-0 lg:px-4 lg:first:pl-0">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Store size={16} className="shrink-0 text-amber-400" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">直營店營收</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-amber-300 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminHqOverviewMetrics?.directStoreRevenue ?? 0)}
                    </h2>
                  </div>
                  <div className="min-w-0 lg:px-4">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Package size={16} className="shrink-0 text-amber-500/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">加盟主批貨收入</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-amber-500 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminHqOverviewMetrics?.franchiseRevenue ?? 0)}
                    </h2>
                  </div>
                  <div className="min-w-0 lg:px-4">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Boxes size={16} className="shrink-0 text-sky-400/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">消耗品貨款</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-sky-300/90 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminHqOverviewMetrics?.consumableGoodsRevenue ?? 0)}
                    </h2>
                    <p className="mt-1 text-[10px] leading-snug text-zinc-500 sm:text-[11px]">
                      加盟代訂代收，不計批貨營收；對帳可抵銷支出
                    </p>
                  </div>
                  <div className="min-w-0 lg:px-4">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Target size={16} className="shrink-0 text-rose-300/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">總支出</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-rose-300/90 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminHqOverviewMetrics?.expenseTotal ?? 0)}
                    </h2>
                  </div>
                  <div className="min-w-0 lg:px-4 lg:last:pr-0">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <TrendingUp size={16} className="shrink-0 text-emerald-400" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">淨利</p>
                    </div>
                    <h2
                      className={cn(
                        'mt-2.5 text-xl font-light tabular-nums sm:text-[2.1rem]',
                        (adminHqOverviewMetrics?.netProfit ?? 0) >= 0
                          ? 'text-emerald-300'
                          : 'text-rose-300',
                      )}
                    >
                      {moneyTW(adminHqOverviewMetrics?.netProfit ?? 0)}
                    </h2>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-zinc-800/80">
                  <div className="min-w-0 sm:px-4 sm:first:pl-0">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Store size={16} className="shrink-0 text-amber-400" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">直營店營收</p>
                    </div>
                    <p className="mt-2.5 text-xl font-light text-amber-300 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminFinance.directStoreStallRetailTotal)}
                    </p>
                    {adminFinanceGrossMetrics && (
                      <>
                        <p
                          className={cn(
                            'mt-1.5 text-[11px] sm:text-sm tabular-nums',
                            adminFinanceGrossMetrics.directGross >= 0 ? 'text-emerald-300/90' : 'text-rose-300/90',
                          )}
                        >
                          毛利 {moneyTW(adminFinanceGrossMetrics.directGross)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-sm tabular-nums">
                          毛利率 {adminFinanceGrossMetrics.directGrossRate.toFixed(1)}%
                        </p>
                      </>
                    )}
                  </div>
                  <div className="min-w-0 sm:px-4 sm:last:pr-0">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <HandCoins size={16} className="shrink-0 text-rose-300/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">直營店營運支出</p>
                    </div>
                    <p className="mt-2.5 text-xl font-light text-rose-300 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminFinance.directStoreOperatingExpenseTotal)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="lg:col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-[1.15rem] sm:p-7">
            <div className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-amber-500/90">
                <TrendingUp size={22} className="shrink-0" aria-hidden />
                <h3 className="text-lg font-medium leading-snug text-zinc-100 sm:text-xl">
                  {nonAdminSummary?.rangeLabel ?? '本月'}營運摘要
                </h3>
              </div>
              <div className="w-full min-w-0 shrink-0 sm:w-auto sm:min-w-[11rem] sm:max-w-[20rem] space-y-2">
                <span className="block text-xs text-zinc-500">
                  區間：
                  <span className="font-medium text-amber-200/90">
                    {dashboardPeriodLabel(summaryPeriod)}
                  </span>
                </span>
                <DashboardMonthCustomRangePicker
                  value={summaryPeriod}
                  onChange={setSummaryPeriod}
                  ariaLabel="營運摘要區間"
                  stretch
                />
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-zinc-800/80">
                <div className="min-w-0 sm:px-4 sm:first:pl-0">
                  <div className="flex items-center gap-1.5 text-zinc-500">
                    <TrendingUp size={16} className="shrink-0 text-amber-500" aria-hidden />
                    <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">
                      營收（{nonAdminSummary?.rangeLabel ?? '本月'}）
                    </p>
                  </div>
                  <p className="mt-2.5 text-xl font-light text-amber-500 tabular-nums sm:text-[2.1rem]">
                    {moneyTW(nonAdminSummary?.revenue ?? 0)}
                  </p>
                </div>

                <div className="min-w-0 sm:px-4">
                  <div className="flex items-center gap-1.5 text-zinc-500">
                    <FileText size={16} className="shrink-0 text-emerald-400" aria-hidden />
                    <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">營收毛利</p>
                  </div>
                  <p
                    className={cn(
                      'mt-2.5 text-xl font-light tabular-nums sm:text-[2.1rem]',
                      (nonAdminSummary?.gross ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300',
                    )}
                  >
                    {moneyTW(nonAdminSummary?.gross ?? 0)}
                  </p>
                  <p className="mt-1.5 text-[11px] text-zinc-500 sm:text-sm">
                    毛利率 {nonAdminSummary?.grossRate.toFixed(1) ?? '0.0'}%
                  </p>
                </div>

                <div className="min-w-0 sm:px-4 sm:last:pr-0">
                  <div className="flex items-center gap-1.5 text-zinc-500">
                    <Target size={16} className="shrink-0 text-rose-300" aria-hidden />
                    <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">
                      {directStoreOperatingExpenseModel
                        ? '直營店營運支出'
                        : franchiseOperatingExpenseModel
                          ? '總支出'
                          : '收支支出'}
                    </p>
                  </div>
                  <p className="mt-2.5 text-xl font-light text-rose-300 tabular-nums sm:text-[2.1rem]">
                    {moneyTW(nonAdminSummary?.expense ?? 0)}
                  </p>
                  <p
                    className={cn(
                      'mt-1.5 text-[11px] sm:text-sm',
                      (nonAdminSummary?.net ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300',
                    )}
                  >
                    淨利 {moneyTW(nonAdminSummary?.net ?? 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>


      {!isAdmin && nonAdminStallGap && (
        <StallGapDashboardSection
          title={`本店盤點落差與呆帳（${directStallGapRangeLabel(nonAdminStallGapRange)}）`}
          summary={nonAdminStallGap}
          filterSlot={
            <DashboardMonthCustomRangePicker
              value={nonAdminStallGapRange}
              onChange={setNonAdminStallGapRange}
              ariaLabel="本店盤點落差區間"
            />
          }
        />
      )}

      {showStallSalesBoard ? (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/35">
        <details className="group">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5 text-left [&::-webkit-details-marker]:hidden"
            onClick={(e) => {
              const summary = e.currentTarget;
              const detailsEl = summary.parentElement;
              if (!detailsEl || detailsEl.tagName !== 'DETAILS') return;
              e.preventDefault();
              (detailsEl as HTMLDetailsElement).open = !(detailsEl as HTMLDetailsElement).open;
            }}
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-base sm:text-lg font-medium text-zinc-100">
                {showFranchiseStallSalesBoard ? '本店銷售數據' : '直營店銷售數據'}
              </h3>
            </div>
            <ChevronDown
              className="h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-4 border-t border-zinc-800/80 space-y-4">
            <StallRevenueBaselinePanel scopeId={stallRevenueBaselineScopeId} />
            <div className="rounded-xl border border-zinc-600/80 bg-zinc-900/70 p-3 sm:p-4 space-y-3 ring-1 ring-amber-600/10">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-zinc-100">資料區間</span>
                  <span className="text-xs text-amber-200/80 tabular-nums">
                    {stallSalesBoardRange.kind === 'none'
                      ? '全部已建檔營業日'
                      : `${ymdSlash(stallSalesBoardResolvedYmd.startYmd)}～${ymdSlash(stallSalesBoardResolvedYmd.endYmd)}`}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  {stallSalesBoardRange.kind === 'none'
                    ? '未選取：含所有已建檔營業日（可搭配下方對照星期）'
                    : `已選 ${stallSalesBoardRangeLabel(stallSalesBoardRange)}：再點一次可取消`}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                  <button
                    type="button"
                    aria-pressed={stallSalesBoardRange.kind === 'none'}
                    onClick={() => setStallSalesBoardRange({ kind: 'none' })}
                    className={cn(
                      'min-h-9 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors',
                      stallSalesBoardRange.kind === 'none'
                        ? 'border-amber-500/45 bg-amber-600/20 text-amber-200'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-amber-600/35',
                    )}
                  >
                    全部
                  </button>
                  <div className="min-w-0 flex-1">
                    <DashboardMonthCustomRangePicker
                      value={
                        stallSalesBoardRange.kind === 'none'
                          ? { kind: 'month' }
                          : stallSalesBoardRange
                      }
                      onChange={(m) => setStallSalesBoardRange(m)}
                      ariaLabel="銷售數據區間"
                      stretch
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-700/80 pt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-xs sm:text-sm font-medium text-zinc-400 shrink-0 whitespace-nowrap">
                    對照星期
                  </span>
                  <WeekdayChainPicker
                    focusIdx={weekdayChainFocusIdx}
                    onChange={setWeekdayChainFocusIdx}
                  />
                </label>
                <p className="text-xs sm:text-sm text-zinc-500 shrink-0 lg:text-right">
                  選取日期：
                  <span className="tabular-nums text-amber-200/90 font-medium">
                    {ymdSlash(calendarWeekFocusYmd)}
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-8 space-y-4 min-w-0">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-xl border border-rose-900/35 bg-rose-950/15 p-3">
                    <p className="text-[11px] text-rose-200/75">應有營業額</p>
                    <p className="text-lg font-light tabular-nums text-rose-200 mt-1">
                      {focusDayEconomics ? moneyTW(focusDayEconomics.expectedRetail) : '—'}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-1">零售推算售出</p>
                  </div>
                  <div className="rounded-xl border border-amber-900/35 bg-amber-950/15 p-3">
                    <p className="text-[11px] text-amber-200/75">實際營收</p>
                    <p className="text-lg font-light tabular-nums text-amber-200 mt-1">
                      {focusDayEconomics?.actual !== null && focusDayEconomics?.actual !== undefined
                        ? moneyTW(focusDayEconomics.actual)
                        : '—'}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-1">盤點登錄實收</p>
                    {focusDayWeekdayIdx === REVENUE_BASELINE_OFF_WEEKDAY_IDX ? (
                      <p className="text-[10px] text-zinc-600 mt-1">週二公休</p>
                    ) : focusDayRevenueBaseline !== undefined ? (
                      <p className="text-[10px] text-zinc-500 mt-1 tabular-nums">
                        打底 {moneyTW(focusDayRevenueBaseline)}
                        {focusDayMeetsRevenueBaseline ? (
                          <span className="ml-1.5 text-emerald-400 font-medium">已達標</span>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-[10px] text-zinc-600 mt-1">尚未設定當日打底</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
                    <p className="text-[11px] text-zinc-400">落差金額</p>
                    <p
                      className={cn(
                        'text-lg font-light tabular-nums mt-1',
                        focusDayEconomics?.gap == null
                          ? 'text-zinc-500'
                          : focusDayEconomics.gap > 0
                            ? 'text-emerald-300'
                            : focusDayEconomics.gap < 0
                              ? 'text-rose-300'
                              : 'text-zinc-400',
                      )}
                    >
                      {focusDayEconomics?.gap == null ? '—' : moneySignedInt(focusDayEconomics.gap)}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-1">實收 − 應有</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 font-medium">
                          {weekdayChainFocusIdx === null ? '星期' : '週期'}
                        </th>
                        <th className="px-3 py-2 font-medium">日期</th>
                        <th className="px-3 py-2 font-medium text-right">應收</th>
                        <th className="px-3 py-2 font-medium text-right">實收</th>
                        <th className="px-3 py-2 font-medium text-right">落差</th>
                        <th className="px-3 py-2 font-medium min-w-[11rem]">備註</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {stallWeekdayChainRows.map((row) => {
                        const eco = row.eco;
                        const isFocus = row.ymd === calendarWeekFocusYmd;
                        return (
                          <tr
                            key={row.ymd + String(row.weeksBack)}
                            role="button"
                            tabIndex={0}
                            onClick={() => setStallBoardFocusYmd(row.ymd)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setStallBoardFocusYmd(row.ymd);
                              }
                            }}
                            className={cn(
                              'text-zinc-300 hover:bg-white/[0.02] cursor-pointer',
                              isFocus && 'bg-amber-950/30',
                            )}
                          >
                            <td className="px-3 py-2 whitespace-nowrap">{row.periodLabel}</td>
                            <td className="px-3 py-2 tabular-nums text-zinc-400">{ymdSlash(row.ymd)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-200/90">
                              {eco ? moneyTW(eco.expectedRetail) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-200/90">
                              {eco?.actual !== null && eco?.actual !== undefined ? moneyTW(eco.actual) : '—'}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right tabular-nums',
                                eco?.gap == null
                                  ? 'text-zinc-600'
                                  : eco.gap > 0
                                    ? 'text-emerald-300/90'
                                    : eco.gap < 0
                                      ? 'text-rose-300/90'
                                      : 'text-zinc-500',
                              )}
                            >
                              {eco?.gap == null ? '—' : moneySignedInt(eco.gap)}
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <DirectStallGapReasonCell
                                ymd={row.ymd}
                                syncKey={orderTick}
                                preferredNote={eco?.note}
                                scopedNotesOnly={showFranchiseStallSalesBoard}
                                getSalesRecordLookup={getSalesRecordCached}
                                onPatchRevenueGapReason={patchRevenueGapReason}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-zinc-500">
                  {weekdayChainFocusIdx === null
                    ? stallSalesBoardRange.kind === 'none'
                      ? '全部已建檔營業日（已登錄實收）'
                      : `區間內逐日（已登錄實收，${stallSalesBoardRangeLabel(stallSalesBoardRange)}）`
                    : stallSalesBoardRange.kind === 'none'
                      ? `全部同名 ${WEEKDAY_TOGGLE_LABELS[weekdayChainFocusIdx]}（已登錄實收）`
                      : `區間內同名星期（已登錄實收，${stallSalesBoardRangeLabel(stallSalesBoardRange)}）`}
                  ：{sameWeekdayActualStats.dayCount} 日
                </p>
              </div>

              <div className="xl:col-span-4 rounded-xl border border-sky-900/35 bg-sky-950/15 p-4 sm:p-5 space-y-3 text-base">
                <p className="text-base sm:text-lg font-medium text-sky-200/90">銷售統計</p>
                <div className="space-y-2.5 text-base sm:text-[1.0625rem]">
                  <div className="flex justify-between gap-2 border-b border-zinc-800/70 pb-2">
                    <span className="text-zinc-500">總營收（實收合計）</span>
                    <span className="tabular-nums text-sky-100">{moneyTW(sameWeekdayActualStats.sum)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-800/70 pb-2">
                    <span className="text-zinc-500">平均營收</span>
                    <span className="tabular-nums text-zinc-100">{moneyTW(sameWeekdayActualStats.avg)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-800/70 pb-2">
                    <span className="text-zinc-500">最高營收</span>
                    <span className="text-right">
                      <span className="tabular-nums text-emerald-300 block">
                        {sameWeekdayActualStats.max ? moneyTW(sameWeekdayActualStats.max.actual) : '—'}
                      </span>
                      <span className="text-sm sm:text-base text-zinc-600 tabular-nums">
                        {sameWeekdayActualStats.max ? ymdSlash(sameWeekdayActualStats.max.ymd) : ''}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-800/70 pb-2">
                    <span className="text-zinc-500">最低營收</span>
                    <span className="text-right">
                      <span className="tabular-nums text-rose-300 block">
                        {sameWeekdayActualStats.min ? moneyTW(sameWeekdayActualStats.min.actual) : '—'}
                      </span>
                      <span className="text-sm sm:text-base text-zinc-600 tabular-nums">
                        {sameWeekdayActualStats.min ? ymdSlash(sameWeekdayActualStats.min.ymd) : ''}
                      </span>
                    </span>
                  </div>
                  {sameWeekdayActualStats.dayCount > 0 && (
                    <div className="space-y-2.5 pt-1 border-b border-zinc-800/70 pb-2">
                      <p className="text-base font-medium text-sky-200/85">
                        售出量統計
                      </p>
                      {sameWeekdayProductSoldStats.rows.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border border-zinc-800/80 max-h-52 sm:max-h-64 overflow-y-auto -mx-0.5 px-0.5">
                          <table className="w-full min-w-[280px] text-left text-sm sm:text-base">
                            <thead className="sticky top-0 bg-sky-950/95 text-zinc-500 border-b border-zinc-800/80 text-sm sm:text-base">
                              <tr>
                                <th className="py-2 pr-2 pl-1 font-medium">品項</th>
                                <th className="py-2 px-1.5 font-medium text-right whitespace-nowrap">平均</th>
                                <th className="py-2 px-1.5 font-medium text-right whitespace-nowrap">最高</th>
                                <th className="py-2 pl-1.5 pr-1 font-medium text-right whitespace-nowrap">最低</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                              {sameWeekdayProductSoldStats.rows.map((r) => (
                                <tr key={r.id}>
                                  <td className="py-2 pr-2 pl-1 text-zinc-200 leading-snug">{r.name}</td>
                                  <td className="py-2 px-1.5 text-right tabular-nums text-sky-100/95">
                                    {formatWeekdaySoldQty(r.avg)}
                                  </td>
                                  <td className="py-2 px-1.5 text-right tabular-nums text-emerald-300/90">
                                    {formatWeekdaySoldQty(r.max)}
                                  </td>
                                  <td className="py-2 pl-1.5 pr-1 text-right tabular-nums text-rose-300/85">
                                    {formatWeekdaySoldQty(r.min)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm sm:text-base text-zinc-600">尚無可匯總之盤點售出明細（或非販售品）。</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
      ) : null}


      {isAdmin && adminStallGapRange && (
        <StallGapDashboardSection
          title="盤點落差與呆帳（直營）"
          summary={adminStallGapRange}
          filterSlot={
            <DashboardMonthCustomRangePicker
              value={directStallGapRange}
              onChange={setDirectStallGapRange}
              ariaLabel="直營盤點落差區間"
            />
          }
        />
      )}

      {isAdmin && franchisePickerOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="franchise-picker-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFranchisePickerOpen(false);
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[90dvh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <Store size={20} className="text-amber-500/90 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <h3
                    id="franchise-picker-title"
                    className="text-base sm:text-lg font-medium text-zinc-100"
                  >
                    各加盟店營運概況（{dashboardPeriodLabel(summaryPeriod)}）
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {franchiseStoreBreakdown.length === 0
                      ? '本期間尚無加盟店資料；新增叫貨／完成盤點後即會出現。'
                      : `共 ${franchiseStoreBreakdown.length} 家加盟店・點任一卡片即可進入該加盟主視角檢視完整概況`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFranchisePickerOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 shrink-0"
                aria-label="關閉"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
              {franchiseStoreBreakdown.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-8">
                  本期間（{dashboardPeriodLabel(summaryPeriod)}）尚無加盟店訂單或盤點資料可彙整。
                  <br />
                  可關閉本視窗後切換上方「本月」或「自訂時間」試試。
                </p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {franchiseStoreBreakdown.map((row) => {
                      const canDrillIn = Boolean(row.franchiseeUserId && onSelectFranchisee);
                      const cardInner = (
                        <>
                          <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <h4
                              className="text-sm font-medium text-zinc-100 truncate"
                              title={row.label}
                            >
                              {row.label}
                            </h4>
                            <span className="text-[11px] text-zinc-500 shrink-0 tabular-nums">
                              {row.completedOrderCount} 單・盤 {row.stallCompletedCount}
                            </span>
                          </div>
                          <div>
                            <p className="text-[11px] text-zinc-500">實際營收</p>
                            <p className="text-lg sm:text-xl font-light tabular-nums text-amber-300">
                              {moneyTW(row.revenue)}
                            </p>
                          </div>
                          <div
                            className={cn(
                              'mt-3 pt-2 border-t border-zinc-800/70 flex items-center justify-between text-[11px]',
                              canDrillIn ? 'text-amber-300/90' : 'text-zinc-600',
                            )}
                          >
                            <span>
                              {canDrillIn ? '進入該加盟主完整營運概況' : '舊資料缺加盟主帳號，無法進入'}
                            </span>
                            {canDrillIn && (
                              <ChevronRight
                                size={14}
                                className="shrink-0 transition-transform group-hover:translate-x-0.5"
                                aria-hidden
                              />
                            )}
                          </div>
                        </>
                      );
                      return canDrillIn ? (
                        <button
                          key={row.franchiseeUserId ?? row.label}
                          type="button"
                          onClick={() => {
                            onSelectFranchisee?.({
                              userId: row.franchiseeUserId as string,
                              label: row.label,
                            });
                            setFranchisePickerOpen(false);
                          }}
                          className="group text-left rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4 flex flex-col gap-2 hover:border-amber-600/50 hover:bg-amber-600/[0.04] focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-colors"
                          aria-label={`進入 ${row.label} 的營運概況`}
                        >
                          {cardInner}
                        </button>
                      ) : (
                        <div
                          key={row.franchiseeUserId ?? row.label}
                          className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4 flex flex-col gap-2 opacity-90"
                        >
                          {cardInner}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-4 leading-relaxed">
                    營收以「盤點完成」之單依盤點日歸期；訂單數依「建單日」歸期，故兩者數量可能不同。總部此處不顯示批貨進貨成本。
                    點卡片進入後可看到該加盟主之完整 Dashboard。
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/35">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 text-left [&::-webkit-details-marker]:hidden">
            <div className="min-w-0 flex-1">
              {isAdmin ? (
                <>
                  <h3 className="text-lg font-medium text-zinc-100">商品營收佔比</h3>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                    依訂單建單日・{dashboardPeriodLabel(productChartsPeriod)}・直營與加盟批貨
                    <span className="text-zinc-600 ml-1">（點此展開）</span>
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-zinc-100">營收與支出佔比</h3>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                    依訂單建單日・{dashboardPeriodLabel(productChartsPeriod)}・本店可視訂單與收支
                    <span className="text-zinc-600 ml-1">（點此展開）</span>
                  </p>
                </>
              )}
            </div>
            <ChevronDown
              className="h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-4 border-t border-zinc-800/80 flex flex-col gap-5 bg-zinc-900/30">
          {isAdmin ? (
            <>
              <div
                className={cn(
                  'flex gap-3 pb-4 border-b border-zinc-800/80',
                  isNarrow ? 'flex-col items-stretch' : 'flex-row flex-wrap items-center justify-between',
                )}
              >
                <p className="text-xs text-zinc-500 shrink-0">商品營收排行區間（依訂單建單日）</p>
                <DashboardMonthCustomRangePicker
                  value={productChartsPeriod}
                  onChange={setProductChartsPeriod}
                  ariaLabel="商品營收排行區間"
                />
              </div>
              <div>
                <h3 className="text-base font-medium">直營商品營收佔比（{dashboardPeriodLabel(productChartsPeriod)}）</h3>
                <RevenueRankingBars
                  rows={adminDirectProducts}
                  totalRevenue={adminDirectProducts.reduce((s, r) => s + r.revenue, 0)}
                  showAll={showAllDirect}
                  onToggleShowAll={() => setShowAllDirect((v) => !v)}
                  emptyText="尚無直營已完成訂單。"
                />
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-medium">加盟批貨商品營收佔比（{dashboardPeriodLabel(productChartsPeriod)}）</h3>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {adminFranchiseRevenueScopeOptions.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setFranchiseRevenueScope(opt.key);
                          setShowAllFranchise(false);
                        }}
                        className={cn(
                          'whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs transition-colors',
                          franchiseRevenueScope === opt.key
                            ? 'border-amber-500/60 bg-amber-600/20 text-amber-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
                        )}
                        aria-pressed={franchiseRevenueScope === opt.key}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <RevenueRankingBars
                  rows={adminFranchiseProducts}
                  totalRevenue={adminFranchiseProducts.reduce((s, r) => s + r.revenue, 0)}
                  showAll={showAllFranchise}
                  onToggleShowAll={() => setShowAllFranchise((v) => !v)}
                  emptyText="尚無加盟批貨已完成訂單。"
                />
              </div>
            </>
          ) : (
            <>
              <div
                className={cn(
                  'flex gap-3 pb-4 border-b border-zinc-800/80',
                  isNarrow ? 'flex-col items-stretch' : 'flex-row flex-wrap items-center justify-between',
                )}
              >
                <p className="text-xs text-zinc-500 shrink-0">商品營收排行區間（依訂單建單日・本店資料）</p>
                <DashboardMonthCustomRangePicker
                  value={productChartsPeriod}
                  onChange={setProductChartsPeriod}
                  ariaLabel="商品營收排行區間"
                />
              </div>
              <h3 className="text-base font-medium">商品營收佔比（{dashboardPeriodLabel(productChartsPeriod)}）</h3>
              <div className="flex-1">
                <RevenueRankingBars
                  rows={topProducts.map((p) => ({ id: p.id, name: p.name, revenue: p.revenue }))}
                  totalRevenue={topProductsTotalRevenue}
                  showAll={showAllSelf}
                  onToggleShowAll={() => setShowAllSelf((v) => !v)}
                  emptyText="尚無已完成銷售可排行。"
                />
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-base font-medium">支出佔比（{dashboardPeriodLabel(productChartsPeriod)}）</h3>
                <AmountRankingBars
                  rows={nonAdminExpenseRows.map((r) => ({ id: r.id, name: r.name, amount: r.amount, pct: r.pct }))}
                  totalAmount={nonAdminExpenseRows.reduce((s, r) => s + r.amount, 0)}
                  showAll={showAllExpenseSelf}
                  onToggleShowAll={() => setShowAllExpenseSelf((v) => !v)}
                  emptyText="尚無支出資料。"
                />
              </div>
            </>
          )}
          </div>
        </details>
      </div>

      {isAdmin && expenseStructureFinance && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/35">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 text-left [&::-webkit-details-marker]:hidden">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-amber-500/90">
                  <TrendingUp size={20} className="shrink-0" aria-hidden />
                  <h3 className="text-lg font-medium text-zinc-100">
                    支出結構表（{dashboardPeriodLabel(expenseStructurePeriod)}）
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  依收入與支出細項加總・{expenseStructureFinance.expenseBreakdown.length} 項類別
                  <span className="text-zinc-600 ml-1">（點此展開）</span>
                </p>
              </div>
              <ChevronDown
                className="h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-4 border-t border-zinc-800/80 space-y-4">
              <div className="max-w-sm">
                <DashboardMonthCustomRangePicker
                  value={expenseStructurePeriod}
                  onChange={setExpenseStructurePeriod}
                  ariaLabel="支出結構表資料區間"
                />
              </div>
              <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/35 p-4">
                {expenseStructureFinance.expenseBreakdown.length === 0 ? (
                  <p className="text-sm text-zinc-500 flex items-center justify-center py-10 text-center">
                    {dashboardPeriodLabel(expenseStructurePeriod)}尚無支出資料可供分析。
                  </p>
                ) : (
                  <AmountRankingBars
                    rows={expenseStructureFinance.expenseBreakdown.map((row, idx) => ({
                      id: idx + 1,
                      name: row.name,
                      amount: row.value,
                      pct: row.pctOfExpense,
                    }))}
                    totalAmount={expenseStructureFinance.expenseBreakdown.reduce((s, r) => s + r.value, 0)}
                    showAll
                    onToggleShowAll={() => {}}
                    emptyText={`${dashboardPeriodLabel(expenseStructurePeriod)}尚無支出資料可供分析。`}
                    hideToggle
                  />
                )}
              </div>
            </div>
          </details>
        </div>
      )}

    </div>
  );
}
