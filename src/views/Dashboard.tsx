import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  TrendingUp,
  FileText,
  Target,
  Store,
  HandCoins,
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
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { UserRole } from './Orders';
import { cn } from '../lib/utils';
import { useIsNarrowScreen } from '../hooks/useIsNarrowScreen';
import {
  computeAdminDashboardFinanceForYmdRange,
  computeStallGapSummary,
  stallCountAttributeYmd,
  type StallGapSummary,
} from '../lib/financeLib';
import {
  ACCOUNTING_LEDGER_UPDATED_EVENT,
  listAccountingLedgerEntries,
  listAccountingLedgerEntriesForScopeId,
} from '../lib/accountingLedgerStorage';
import { usesFranchiseeOperatingExpenseModel } from '../lib/operatingExpenseModel';
import {
  getAllSupplyItems,
  getSupplyItem,
  isConsumableItem,
  isFranchiseeSelfSuppliedItem,
  type SupplyRetailView,
} from '../lib/supplyCatalog';
import { getStallDisplaySoldAtRetail } from '../lib/orderStallDisplayRevenue';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  effectiveOrderDateYmd,
  orderIsFranchiseBusinessScoped,
  orderIsHeadquartersDirectScoped,
  resolveOrderDataScopeId,
  type OrderHistoryEntry,
  type OrderActorRole,
} from '../lib/orderHistoryStorage';
import { getWeekdayBaselineTarget, setWeekdayBaselineTarget } from '../lib/dashboardWeekdayBaselineStorage';
import {
  buildDirectStallEconomicsByYmd,
  buildFranchiseStallEconomicsByYmd,
  type DirectStallDayEconomics,
} from '../lib/directStallDayEconomics';
import { getDataScopeContext } from '../lib/dataScope';
import { computeLine } from '../lib/stallMath';
import { getSalesRecord, mergeSalesRecordWithCatalog, patchSalesRecordRevenueGapReason } from '../lib/salesRecordStorage';

const HQ_STALL_VIEW = 'headquarter' as const;
const FRANCHISE_STALL_VIEW = 'franchisee' as const;

const EXPENSE_PIE_COLORS = ['#d97706', '#6366f1', '#10b981', '#f43f5e', '#a855f7', '#06b6d4', '#eab308', '#ec4899', '#84cc16', '#f97316'];

const INGREDIENT_STRUCTURE_PIE_COLORS = ['#ea580c', '#6366f1'];

type DashboardOrder = OrderHistoryEntry;

function roleVisible(actorRole: OrderActorRole, userRole: UserRole): boolean {
  if (userRole === 'admin') return true;
  if (userRole === 'franchisee') return actorRole === 'franchisee';
  return actorRole === 'employee';
}

type ProductRevenueRow = { id: number; name: string; revenue: number; qty: number; pct: number };
type SummaryRangeKey = 'today' | 'week' | 'days7' | 'days30' | 'month' | 'year';
const SUMMARY_RANGE_OPTIONS: ReadonlyArray<{ key: SummaryRangeKey; label: string }> = [
  { key: 'today', label: '本日' },
  { key: 'week', label: '本週' },
  { key: 'days7', label: '7天' },
  { key: 'days30', label: '30天' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
];
/** 總部「直營盤點落差」專用；與下方營運摘要的 summaryRange 分開，避免必須捲動才能換區間 */
type DirectStallGapRangeMode =
  | { kind: 'preset'; key: SummaryRangeKey }
  | { kind: 'custom'; startYmd: string; endYmd: string };
type ExpenseShareRow = { id: number; name: string; amount: number; pct: number };
const RANK_DEFAULT_LIMIT = 10;

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
  entries: ReturnType<typeof listAccountingLedgerEntries>,
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

/** 本週、上週、上上週…共對照幾列（同名星期） */
const WEEKDAY_CHAIN_ROW_COUNT = 16;

function weekdayChainPeriodLabel(k: number, dayShort: string): string {
  if (k === 0) return `本週・${dayShort}`;
  if (k === 1) return `上週・${dayShort}`;
  if (k === 2) return `上上週・${dayShort}`;
  return `${k} 週前・${dayShort}`;
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

function stallSnapshotMergedFromOrder(o: OrderHistoryEntry) {
  if (o.stallCountSnapshot) return mergeSalesRecordWithCatalog(o.stallCountSnapshot);
  const b = o.stallCountBasisYmd?.trim();
  if (b) {
    const rec = getSalesRecord(b);
    if (rec) return mergeSalesRecordWithCatalog(rec);
  }
  return null;
}

function accumulateSoldQtyByProductFromSnapshot(
  dayMap: Map<string, number>,
  snap: ReturnType<typeof mergeSalesRecordWithCatalog>,
  retailView: SupplyRetailView,
) {
  for (const id of Object.keys(snap.lines)) {
    const item = getSupplyItem(id, retailView);
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

function summaryRangeLabel(key: SummaryRangeKey): string {
  if (key === 'today') return '本日';
  if (key === 'week') return '本週';
  if (key === 'days7') return '7天';
  if (key === 'days30') return '30天';
  if (key === 'year') return '本年';
  return '本月';
}

function resolveRange(key: SummaryRangeKey): { startYmd: string; endYmd: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = toYmd(today);
  if (key === 'today') return { startYmd: end, endYmd: end };
  if (key === 'days7') {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return { startYmd: toYmd(start), endYmd: end };
  }
  if (key === 'days30') {
    const start = new Date(today);
    start.setDate(today.getDate() - 29);
    return { startYmd: toYmd(start), endYmd: end };
  }
  if (key === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startYmd: toYmd(start), endYmd: end };
  }
  if (key === 'year') {
    const start = new Date(today.getFullYear(), 0, 1);
    return { startYmd: toYmd(start), endYmd: end };
  }
  // 本週（週一到今天）
  const mondayShift = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - mondayShift);
  return { startYmd: toYmd(start), endYmd: end };
}

function normalizeYmdRange(startYmd: string, endYmd: string): { startYmd: string; endYmd: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
    return { startYmd, endYmd };
  }
  return startYmd <= endYmd ? { startYmd, endYmd } : { startYmd: endYmd, endYmd: startYmd };
}

function resolveDirectStallGapYmdRange(mode: DirectStallGapRangeMode): { startYmd: string; endYmd: string } {
  if (mode.kind === 'preset') return resolveRange(mode.key);
  return normalizeYmdRange(mode.startYmd, mode.endYmd);
}

function directStallGapRangeLabel(mode: DirectStallGapRangeMode): string {
  if (mode.kind === 'preset') return summaryRangeLabel(mode.key);
  const { startYmd, endYmd } = resolveDirectStallGapYmdRange(mode);
  return `${startYmd}～${endYmd}`;
}

const SUMMARY_RANGE_SELECT_CLASS =
  'w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-600/45 focus:outline-none focus:ring-1 focus:ring-amber-600/25';

const SUMMARY_RANGE_INLINE_BUTTON_CLASS =
  'inline-flex h-[26px] w-24 items-center justify-between gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-medium leading-none text-zinc-200 transition-colors hover:border-amber-600/45 hover:text-amber-200 focus:border-amber-600/45 focus:outline-none focus:ring-1 focus:ring-amber-600/25';

/** 營運 KPI 卡：窄螢幕區間觸發鈕（與卡片同寬、對齊分頁列） */
const ADMIN_KPI_RANGE_NARROW_TRIGGER_CLASS =
  'flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-200 transition-colors hover:border-amber-600/45 hover:text-amber-200 focus:border-amber-600/45 focus:outline-none focus:ring-1 focus:ring-amber-600/25';

function summaryRangeToggleClass(active: boolean) {
  return cn(
    'px-2.5 py-1 rounded-md text-xs border transition-colors',
    active
      ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200',
  );
}

function DashboardSummaryRangePicker({
  value,
  onChange,
  isNarrow,
  ariaLabel = '區間',
  narrowSelectClassName,
  selectClassName,
  wideGapClass = 'gap-1.5',
  /** 寬螢幕時讓各預設區間鈕均分寬度（營運 KPI 工具列用） */
  wideStretch = false,
}: {
  value: SummaryRangeKey;
  onChange: (key: SummaryRangeKey) => void;
  isNarrow: boolean;
  ariaLabel?: string;
  narrowSelectClassName?: string;
  selectClassName?: string;
  wideGapClass?: string;
  wideStretch?: boolean;
}) {
  if (isNarrow) {
    return (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as SummaryRangeKey)}
        className={cn(narrowSelectClassName ?? SUMMARY_RANGE_SELECT_CLASS, selectClassName)}
      >
        {SUMMARY_RANGE_OPTIONS.map(({ key, label }) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div
      className={cn(
        'flex flex-wrap items-center',
        wideStretch ? 'w-full min-w-0 gap-1.5 sm:flex-nowrap' : wideGapClass,
      )}
    >
      {SUMMARY_RANGE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
                  className={cn(
            summaryRangeToggleClass(value === key),
            wideStretch && 'flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center text-center',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DashboardInlineSummaryRangePicker({
  value,
  onChange,
  isNarrow,
  ariaLabel = '區間',
  wideGapClass = 'gap-1.5',
  narrowTriggerClassName,
  /** 窄螢幕下列表寬度；預設靠右固定 w-28 */
  narrowMenuClassName,
  narrowWrapperClassName,
  /** 寬螢幕時區間鈕均分整列寬度 */
  wideStretch = false,
}: {
  value: SummaryRangeKey;
  onChange: (key: SummaryRangeKey) => void;
  isNarrow: boolean;
  ariaLabel?: string;
  wideGapClass?: string;
  /** 窄螢幕下拉觸發鈕 class（預設為 {@link SUMMARY_RANGE_INLINE_BUTTON_CLASS}） */
  narrowTriggerClassName?: string;
  narrowMenuClassName?: string;
  /** 窄螢幕時外層容器 class（例：w-full min-w-0 與觸發鈕同寬） */
  narrowWrapperClassName?: string;
  wideStretch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = SUMMARY_RANGE_OPTIONS.find((option) => option.key === value);

  if (!isNarrow) {
    return (
      <div className={cn(wideStretch && 'w-full min-w-0')}>
        <DashboardSummaryRangePicker
          value={value}
          onChange={onChange}
          isNarrow={isNarrow}
          ariaLabel={ariaLabel}
          wideGapClass={wideGapClass}
          wideStretch={wideStretch}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('relative', narrowWrapperClassName)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={narrowTriggerClassName ?? SUMMARY_RANGE_INLINE_BUTTON_CLASS}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{current?.label ?? summaryRangeLabel(value)}</span>
        <ChevronDown
          size={12}
          className={cn('shrink-0 text-zinc-500 transition-transform', open ? 'rotate-180 text-amber-400' : null)}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute top-full z-30 mt-1 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/30',
            narrowMenuClassName ?? 'right-0 w-28',
          )}
        >
          {SUMMARY_RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={value === key}
              className={cn(
                'block w-full px-3 py-2 text-left text-xs transition-colors',
                value === key ? 'bg-amber-600/20 text-amber-300' : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
              )}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StallGapQuickPresetRow(props: {
  range: DirectStallGapRangeMode;
  onPreset: (key: SummaryRangeKey) => void;
  onPickCustom: () => void;
  isNarrow: boolean;
}) {
  const { range, onPreset, onPickCustom, isNarrow } = props;
  const selectVal = range.kind === 'preset' ? range.key : 'custom';

  if (isNarrow) {
    return (
      <select
        aria-label="快速選擇區間"
        value={selectVal}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') onPickCustom();
          else onPreset(v as SummaryRangeKey);
        }}
        className={SUMMARY_RANGE_SELECT_CLASS}
      >
        {SUMMARY_RANGE_OPTIONS.map(({ key, label }) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
        <option value="custom">自訂起訖</option>
      </select>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <span className="text-[11px] text-zinc-500 mr-0.5 shrink-0">快速選擇</span>
      {SUMMARY_RANGE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onPreset(key)}
          className={summaryRangeToggleClass(range.kind === 'preset' && range.key === key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WeekdayChainPicker({
  focusIdx,
  onChange,
  isNarrow,
}: {
  focusIdx: number;
  onChange: (idx: number) => void;
  isNarrow: boolean;
}) {
  if (isNarrow) {
    return (
      <select
        aria-label="對照星期"
        value={focusIdx}
        onChange={(e) => onChange(Number(e.target.value))}
        className={SUMMARY_RANGE_SELECT_CLASS}
      >
        {WEEKDAY_TOGGLE_LABELS.map((label, idx) => (
          <option key={label} value={idx}>
            {label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      {WEEKDAY_TOGGLE_LABELS.map((label, idx) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(idx)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs border transition-colors min-h-[32px]',
            focusIdx === idx
              ? 'bg-amber-600/25 border-amber-500/45 text-amber-200'
              : 'bg-zinc-950 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600',
          )}
        >
          {label}
        </button>
      ))}
    </div>
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

function DirectStallGapReasonCell({ ymd, syncKey }: { ymd: string; syncKey: number }) {
  const snap = useMemo(() => getSalesRecord(ymd), [ymd, syncKey]);
  const stored = snap?.revenueGapReason ?? '';
  const [val, setVal] = useState(stored);
  useEffect(() => {
    setVal(stored);
  }, [stored]);
  const amountLine = snap?.revenueGapAmount?.trim();
  return (
    <div className="flex min-w-[10rem] max-w-[18rem] flex-col gap-1">
      <input
        type="text"
        aria-label={`${ymd} 備註`}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-600/50 focus:outline-none focus:ring-1 focus:ring-amber-600/30"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val.trim() === stored.trim()) return;
          patchSalesRecordRevenueGapReason(ymd, val);
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
  const [financeTick, setFinanceTick] = useState(0);
  const [orderTick, setOrderTick] = useState(0);
  const [summaryRange, setSummaryRange] = useState<SummaryRangeKey>('month');
  /** 總部合併 KPI 卡（總部營運總覽／直營店營運摘要）專用區間；與其他區塊的 summaryRange 可分開設定 */
  const [adminFinanceSummaryRange, setAdminFinanceSummaryRange] = useState<SummaryRangeKey>('month');
  /** 總部合併 KPI 卡：總覽四欄 vs 直營兩欄 */
  const [adminKpiTab, setAdminKpiTab] = useState<'hq-overview' | 'direct-stall'>('hq-overview');
  /** 商品營收圓餅專用區間（總部與本店共用；本店僅含可視訂單）；與營運摘要 summaryRange 分開 */
  const [productChartsRange, setProductChartsRange] = useState<SummaryRangeKey>('month');
  const [showAllDirect, setShowAllDirect] = useState(false);
  const [showAllFranchise, setShowAllFranchise] = useState(false);
  const [showAllSelf, setShowAllSelf] = useState(false);
  const [showAllExpenseSelf, setShowAllExpenseSelf] = useState(false);
  /** 各加盟店挑選浮層；點頂端按鈕才顯示，不佔主頁版面 */
  const [franchisePickerOpen, setFranchisePickerOpen] = useState(false);
  /** 直營「盤點落差與呆帳」專用區間（與總部營運摘要 summaryRange 獨立） */
  const [directStallGapRange, setDirectStallGapRange] = useState<DirectStallGapRangeMode>({
    kind: 'preset',
    key: 'month',
  });
  /** 本店盤點落差區間（與上方 KPI 的 summaryRange 分開；同總部直營盤點操作） */
  const [nonAdminStallGapRange, setNonAdminStallGapRange] = useState<DirectStallGapRangeMode>({
    kind: 'preset',
    key: 'month',
  });
  const [selectedWeekStartYmd] = useState(() => startOfWeekMondayYmd(toYmd(new Date())));
  /** 對照「本週／上週／上上週…」之同名星期：0＝週一 … 6＝週日 */
  const [weekdayChainFocusIdx, setWeekdayChainFocusIdx] = useState(0);
  /** 同名星期「業績打底」編輯草稿（localStorage 鍵為 weekdayChainFocusIdx） */
  const [weekdayBaselineDraft, setWeekdayBaselineDraft] = useState('');

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
    const v = getWeekdayBaselineTarget(weekdayChainFocusIdx);
    setWeekdayBaselineDraft(v !== undefined ? String(v) : '');
  }, [weekdayChainFocusIdx]);

  const adminFinance = useMemo(() => {
    if (!isAdmin) return null;
    const { startYmd, endYmd } = resolveRange(adminFinanceSummaryRange);
    return computeAdminDashboardFinanceForYmdRange(startYmd, endYmd);
  }, [isAdmin, financeTick, orderTick, adminFinanceSummaryRange]);

  useEffect(() => {
    const bump = () => setOrderTick((t) => t + 1);
    window.addEventListener('orderHistoryUpdated', bump);
    window.addEventListener('franchiseManagementOrdersUpdated', bump);
    window.addEventListener('salesRecordUpdated', bump);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bump);
      window.removeEventListener('franchiseManagementOrdersUpdated', bump);
      window.removeEventListener('salesRecordUpdated', bump);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const bump = () => setFinanceTick((t) => t + 1);
    window.addEventListener('orderHistoryUpdated', bump);
    window.addEventListener('franchiseManagementOrdersUpdated', bump);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bump);
      window.removeEventListener('franchiseManagementOrdersUpdated', bump);
    };
  }, [isAdmin]);

  useEffect(() => {
    const bump = () => setFinanceTick((t) => t + 1);
    window.addEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bump);
    };
  }, []);

  const dashboardOrders = useMemo(() => {
    const mgmt = loadFranchiseManagementOrders().map<DashboardOrder>((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      orderDateYmd: m.orderDateYmd,
      updatedAt: m.updatedAt,
      source: m.source,
      totalAmount: m.totalAmount,
      payableAmount: m.payableAmount ?? m.totalAmount,
      selfSuppliedCostAmount: m.selfSuppliedCostAmount ?? 0,
      itemCount: m.itemCount,
      lines: m.lines,
      actorRole: 'admin',
      storeLabel: m.storeLabel,
      status: m.status,
      stallCountBasisYmd: m.stallCountBasisYmd,
      stallCountCompletedAt: m.stallCountCompletedAt,
      stallCountSnapshot: m.stallCountSnapshot,
      scopeId: m.scopeId,
      actorUserId: m.actorUserId,
      createdByName: m.createdByName,
      stallCountCompletedByName: m.stallCountCompletedByName,
      stallCountCompletedByUserId: m.stallCountCompletedByUserId,
      lastUpdatedByName: m.lastUpdatedByName,
    }));
    const history = loadOrderHistory();
    const all = [...mgmt, ...history].filter((o) => roleVisible(o.actorRole, userRole));
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all;
  }, [userRole, orderTick]);

  /**
   * 與本店營運摘要「營收毛利」一致：直營盤點零售 − 同期直營已完成盤點訂單叫貨合計（訂單 totalAmount）。
   * 總覽淨利旁之毛利：營收總計 − 上述直營叫貨合計（加盟批貨收入不另扣進貨）；毛利率皆以對應營收為分母。
   */
  const adminFinanceGrossMetrics = useMemo(() => {
    if (!isAdmin || !adminFinance) return null;
    const { startYmd, endYmd } = resolveRange(adminFinanceSummaryRange);
    let directProcurement = 0;
    for (const o of dashboardOrders) {
      if (!orderIsHeadquartersDirectScoped(o)) continue;
      if (!o.stallCountCompletedAt) continue;
      const stallYmd = stallCountAttributeYmd(o);
      if (!stallYmd || stallYmd < startYmd || stallYmd > endYmd) continue;
      directProcurement += o.totalAmount;
    }
    const directRev = adminFinance.directStoreStallRetailTotal;
    const directGross = directRev - directProcurement;
    const directGrossRate = pct(directGross, directRev);
    const revTotal = adminFinance.revenueTotal;
    const overviewGross = revTotal - directProcurement;
    const overviewGrossRate = pct(overviewGross, revTotal);
    return { directProcurement, directGross, directGrossRate, overviewGross, overviewGrossRate };
  }, [isAdmin, adminFinance, adminFinanceSummaryRange, dashboardOrders]);

  /**
   * 「實際渲染」用的訂單清單：view-as 時限縮為該加盟主之單，其他情境同 dashboardOrders。
   * 與 view-as 對應的下方營收／支出計算皆改用此清單，確保與該加盟主自身 Dashboard 一致。
   */
  const effectiveOrders = useMemo(() => {
    if (!viewAsFranchisee) return dashboardOrders;
    const uid = viewAsFranchisee.userId;
    return dashboardOrders.filter((o) => {
      if (o.actorRole === 'franchisee' && o.actorUserId === uid) return true;
      const scope = o.scopeId?.trim();
      if (scope === `scope:franchisee:${uid}`) return true;
      return false;
    });
  }, [dashboardOrders, viewAsFranchisee]);

  /**
   * 「實際渲染」用之流水帳：view-as 改讀指定加盟店 scope 的紀錄；其餘沿用目前登入身份的 scope。
   */
  const ledgerForView = useMemo(() => {
    if (viewAsFranchisee) {
      return listAccountingLedgerEntriesForScopeId(`scope:franchisee:${viewAsFranchisee.userId}`);
    }
    return listAccountingLedgerEntries();
  }, [viewAsFranchisee, financeTick, userRole]);

  /** 加盟主視角：支出＝批貨＋流水；直營等非加盟視角：支出僅流水帳 */
  const franchiseOperatingExpenseModel = useMemo(
    () => usesFranchiseeOperatingExpenseModel({ userRole, viewAsFranchisee }),
    [userRole, viewAsFranchisee],
  );

  /** 「銷售數據」區：加盟視角為該店加盟主 userId；總部直營為 null */
  const franchiseStallSalesBoardOwnerUserId = useMemo(() => {
    if (!franchiseOperatingExpenseModel) return null;
    if (viewAsFranchisee) return viewAsFranchisee.userId;
    const ctx = getDataScopeContext();
    const m = ctx.scopeId.match(/^scope:franchisee:(.+)$/);
    return m?.[1]?.trim() || null;
  }, [franchiseOperatingExpenseModel, viewAsFranchisee]);

  /** 總部直營：每日經濟指標（加盟視角略過以降低不必要計算） */
  const hqDirectStallEconomicsByYmd = useMemo(() => {
    if (franchiseOperatingExpenseModel) return new Map<string, DirectStallDayEconomics>();
    return buildDirectStallEconomicsByYmd(effectiveOrders, HQ_STALL_VIEW);
  }, [effectiveOrders, franchiseOperatingExpenseModel, orderTick]);

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

  const calendarWeekFocusYmd = useMemo(
    () => addDaysYmd(selectedWeekStartYmd, weekdayChainFocusIdx),
    [selectedWeekStartYmd, weekdayChainFocusIdx],
  );

  const focusDayEconomics = useMemo(() => {
    return stallSalesEconomicsByYmd.get(calendarWeekFocusYmd) ?? null;
  }, [stallSalesEconomicsByYmd, calendarWeekFocusYmd]);

  const stallWeekdayChainRows = useMemo((): StallWeekdayChainRow[] => {
    const d = weekdayChainFocusIdx;
    const dayShort = WEEKDAY_TOGGLE_LABELS[d];
    return Array.from({ length: WEEKDAY_CHAIN_ROW_COUNT }, (_, k) => {
      const ymd = addDaysYmd(selectedWeekStartYmd, d - 7 * k);
      return {
        periodLabel: weekdayChainPeriodLabel(k, dayShort),
        ymd,
        weeksBack: k,
        eco: stallSalesEconomicsByYmd.get(ymd) ?? null,
      };
    });
  }, [stallSalesEconomicsByYmd, selectedWeekStartYmd, weekdayChainFocusIdx]);

  const sameWeekdayActualStats = useMemo(() => {
    const d = weekdayChainFocusIdx;
    const todayStr = toYmd(new Date());
    const entries: { ymd: string; actual: number }[] = [];
    for (const [ymd, row] of stallSalesEconomicsByYmd.entries()) {
      if (mondayFirstWeekdayIndexFromYmd(ymd) !== d) continue;
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
  }, [stallSalesEconomicsByYmd, weekdayChainFocusIdx]);

  /** 與「同名星期・歷史實收統計」相同之曆日集合：各品項當日售出量加總後，再算平均／最高／最低 */
  const sameWeekdayProductSoldStats = useMemo(() => {
    const d = weekdayChainFocusIdx;
    const todayStr = toYmd(new Date());
    const retailView: SupplyRetailView = franchiseStallSalesBoardOwnerUserId
      ? FRANCHISE_STALL_VIEW
      : HQ_STALL_VIEW;
    const franchiseId = franchiseStallSalesBoardOwnerUserId;

    const qualifyingYmds: string[] = [];
    for (const [ymd, row] of stallSalesEconomicsByYmd.entries()) {
      if (mondayFirstWeekdayIndexFromYmd(ymd) !== d) continue;
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
      if (!o.stallCountCompletedAt) continue;
      if (franchiseId) {
        if (!orderMatchesFranchiseeBusinessDash(o, franchiseId)) continue;
      } else if (!orderIsHeadquartersDirectScoped(o)) {
        continue;
      }
      const ymd = stallCountAttributeYmd(o);
      if (!ymd || !qualifying.has(ymd)) continue;
      const snap = stallSnapshotMergedFromOrder(o);
      if (!snap) continue;
      let dayMap = perDay.get(ymd);
      if (!dayMap) {
        dayMap = new Map();
        perDay.set(ymd, dayMap);
      }
      accumulateSoldQtyByProductFromSnapshot(dayMap, snap, retailView);
    }

    for (const ymd of qualifyingYmds) {
      if (perDay.has(ymd)) continue;
      const raw = getSalesRecord(ymd);
      if (!raw) continue;
      const snap = mergeSalesRecordWithCatalog(raw);
      const dayMap = new Map<string, number>();
      accumulateSoldQtyByProductFromSnapshot(dayMap, snap, retailView);
      if (dayMap.size > 0) perDay.set(ymd, dayMap);
    }

    const allIds = new Set<string>();
    for (const m of perDay.values()) {
      for (const id of m.keys()) allIds.add(id);
    }

    const n = qualifyingYmds.length;
    const rows: { id: string; name: string; avg: number; max: number; min: number }[] = [];
    for (const id of allIds) {
      const item = getSupplyItem(id, retailView);
      const name = item?.name ?? id;
      const series = qualifyingYmds.map((ymd) => perDay.get(ymd)?.get(id) ?? 0);
      const sum = series.reduce((s, v) => s + v, 0);
      const avg = sum / n;
      const max = Math.max(...series);
      const min = Math.min(...series);
      rows.push({ id, name, avg, max, min });
    }
    const catalogOrderIndex = new Map<string, number>();
    getAllSupplyItems(retailView)
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
    effectiveOrders,
    franchiseStallSalesBoardOwnerUserId,
    orderTick,
  ]);

  const showFranchiseStallSalesBoard =
    franchiseOperatingExpenseModel && franchiseStallSalesBoardOwnerUserId != null;
  const showStallSalesBoard =
    (!franchiseOperatingExpenseModel && !viewAsFranchisee) || showFranchiseStallSalesBoard;

  const saveWeekdayBaseline = useCallback(() => {
    const n = Number(String(weekdayBaselineDraft).replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n < 0) return;
    setWeekdayBaselineTarget(weekdayChainFocusIdx, n);
    setWeekdayBaselineDraft(String(Math.round(n)));
  }, [weekdayBaselineDraft, weekdayChainFocusIdx]);

  const nonAdminSummary = useMemo(() => {
    if (isAdmin) return null;
    const { startYmd, endYmd } = resolveRange(summaryRange);
    const stallCompleted = effectiveOrders.filter((o) => {
      if (!o.stallCountCompletedAt) return false;
      const ymd = stallCountAttributeYmd(o);
      return Boolean(ymd && ymd >= startYmd && ymd <= endYmd);
    });
    const revenue = stallCompleted.reduce(
      (s, o) => s + (getStallDisplaySoldAtRetail(o, HQ_STALL_VIEW) ?? 0),
      0,
    );
    const procurementCost = stallCompleted.reduce((s, o) => s + o.totalAmount, 0);
    const gross = revenue - procurementCost;
    const ledgerExpense = ledgerForView
      .filter((e) => e.flowType === 'expense' && e.dateYmd >= startYmd && e.dateYmd <= endYmd)
      .reduce((s, e) => s + e.amount, 0);
    const expense = franchiseOperatingExpenseModel ? procurementCost + ledgerExpense : ledgerExpense;
    const net = revenue - expense;
    return {
      rangeLabel: summaryRangeLabel(summaryRange),
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
  }, [effectiveOrders, franchiseOperatingExpenseModel, ledgerForView, isAdmin, summaryRange, userRole, viewAsFranchisee]);

  /** 本店／view-as：與總部相同，依「建單日」落在區間內之已完成訂單（僅 effectiveOrders） */
  const nonAdminProductChartOrders = useMemo(() => {
    if (isAdmin) return [];
    const { startYmd, endYmd } = resolveRange(productChartsRange);
    return effectiveOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd0 = effectiveOrderDateYmd(o);
      return ymd0 >= startYmd && ymd0 <= endYmd;
    });
  }, [effectiveOrders, isAdmin, productChartsRange]);

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
    const { startYmd, endYmd } = resolveRange(productChartsRange);
    const byName = new Map<string, number>();
    if (franchiseOperatingExpenseModel) {
      const procurementCost = nonAdminProductChartOrders.reduce((s, o) => s + o.totalAmount, 0);
      if (procurementCost > 0) byName.set('批貨與自備成本', procurementCost);
    }
    for (const e of ledgerForView) {
      if (e.flowType !== 'expense') continue;
      if (e.dateYmd < startYmd || e.dateYmd > endYmd) continue;
      const name = e.subCategory?.trim() ? `${e.category} / ${e.subCategory.trim()}` : e.category;
      byName.set(name, (byName.get(name) ?? 0) + e.amount);
    }
    const rows = Array.from(byName.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return rows.map((r, i) => ({ id: i + 1, name: r.name, amount: r.amount, pct: pct(r.amount, total) }));
  }, [franchiseOperatingExpenseModel, isAdmin, productChartsRange, ledgerForView, nonAdminProductChartOrders]);

  const adminProductChartOrders = useMemo(() => {
    if (!isAdmin) return [];
    const { startYmd, endYmd } = resolveRange(productChartsRange);
    return dashboardOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd0 = effectiveOrderDateYmd(o);
      return ymd0 >= startYmd && ymd0 <= endYmd;
    });
  }, [dashboardOrders, isAdmin, productChartsRange]);

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
    return computeStallGapSummary(effectiveOrders, { type: 'ymd', startYmd, endYmd });
  }, [effectiveOrders, isAdmin, nonAdminStallGapRange, orderTick]);

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

  const adminFranchiseProducts = useMemo(() => {
    if (!isAdmin) return [];
    return aggregateProductRevenue(
      adminProductChartOrders,
      (o) => orderIsFranchiseBusinessScoped(o),
      (_o, line) => {
        const item = getSupplyItem(line.productId);
        if (isConsumableItem(item)) return false;
        return !isFranchiseeSelfSuppliedItem(item);
      },
    );
  }, [adminProductChartOrders, isAdmin]);

  /**
   * 各加盟店摘要（總部選店浮層）：
   * - 已完成訂單數：依「建單日落於本期間」計
   * - 盤點完成數：依「盤點日落於本期間」計
   * - 盤點後營收：以盤點日歸屬；總部介面不顯示批貨進貨成本（詳細請進入該加盟主視角）
   */
  const franchiseStoreBreakdown = useMemo(() => {
    if (!realIsAdmin) return [];
    const { startYmd, endYmd } = resolveRange(summaryRange);
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
        o.stallCountCompletedAt && stallYmd && stallYmd >= startYmd && stallYmd <= endYmd,
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
        row.revenue += getStallDisplaySoldAtRetail(o, HQ_STALL_VIEW) ?? 0;
      }
      map.set(key, row);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.completedOrderCount - a.completedOrderCount ||
        a.label.localeCompare(b.label, 'zh-Hant'),
    );
  }, [dashboardOrders, realIsAdmin, summaryRange]);

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
              <span className="text-amber-200/70 ml-1">（與加盟主自身畫面一致；流水帳支出取該店本機紀錄）</span>
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
                <div className="w-full min-w-0 border-t border-zinc-800/80 pt-2.5">
                  <DashboardInlineSummaryRangePicker
                    value={adminFinanceSummaryRange}
                    onChange={setAdminFinanceSummaryRange}
                    isNarrow={isNarrow}
                    ariaLabel="營運數據區間"
                    wideGapClass="gap-1.5"
                    narrowTriggerClassName={ADMIN_KPI_RANGE_NARROW_TRIGGER_CLASS}
                    narrowMenuClassName="left-0 right-0 w-full"
                    narrowWrapperClassName="w-full min-w-0"
                    wideStretch
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4 sm:p-5">
              {adminKpiTab === 'hq-overview' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-zinc-800/80">
                  <div className="min-w-0 lg:px-4 lg:first:pl-0">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Store size={16} className="shrink-0 text-amber-400" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">直營店營收</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-amber-400 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminFinance.directStoreStallRetailTotal)}
                    </h2>
                  </div>
                  <div className="min-w-0 lg:px-4">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Package size={16} className="shrink-0 text-amber-500/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">加盟店批貨收入</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-amber-500 tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminFinance.franchiseeOrderTotal)}
                    </h2>
                  </div>
                  <div className="min-w-0 lg:px-4">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Target size={16} className="shrink-0 text-rose-300/90" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-[0.95rem]">總支出</p>
                    </div>
                    <h2 className="mt-2.5 text-xl font-light text-[#f5f2ed] tabular-nums sm:text-[2.1rem]">
                      {moneyTW(adminFinance.expenseTotal)}
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
                        adminFinance.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300',
                      )}
                    >
                      {moneyTW(adminFinance.netProfit)}
                    </h2>
                    {adminFinanceGrossMetrics && (
                      <>
                        <p
                          className={cn(
                            'mt-1.5 text-[11px] sm:text-sm tabular-nums',
                            adminFinanceGrossMetrics.overviewGross >= 0 ? 'text-emerald-300/90' : 'text-rose-300/90',
                          )}
                        >
                          毛利 {moneyTW(adminFinanceGrossMetrics.overviewGross)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-sm tabular-nums">
                          毛利率 {adminFinanceGrossMetrics.overviewGrossRate.toFixed(1)}%
                        </p>
                      </>
                    )}
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
                      {moneyTW(adminFinance.expenseTotal)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="lg:col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-[1.15rem] sm:p-7">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-amber-500/90">
                <TrendingUp size={22} className="shrink-0" aria-hidden />
                <h3 className="text-lg font-medium leading-snug text-zinc-100 sm:text-xl">
                  {nonAdminSummary?.rangeLabel ?? '本月'}營運摘要
                </h3>
              </div>
              <div
                className={cn(
                  'ml-auto flex shrink-0 items-center',
                  isNarrow ? 'w-24 sm:w-auto sm:max-w-[min(12rem,calc(100vw-12rem))]' : '',
                )}
              >
                <DashboardInlineSummaryRangePicker
                  value={summaryRange}
                  onChange={setSummaryRange}
                  isNarrow={isNarrow}
                  ariaLabel="營運摘要區間"
                  wideGapClass="justify-end gap-1.5"
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
                      {franchiseOperatingExpenseModel ? '總支出' : '流水帳支出'}
                    </p>
                  </div>
                  <p className="mt-2.5 text-xl font-light text-rose-300 tabular-nums sm:text-[2.1rem]">
                    {moneyTW(franchiseOperatingExpenseModel ? (nonAdminSummary?.expense ?? 0) : (nonAdminSummary?.ledgerExpense ?? 0))}
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
            <div className="space-y-2.5">
              <StallGapQuickPresetRow
                range={nonAdminStallGapRange}
                onPreset={(key) => setNonAdminStallGapRange({ kind: 'preset', key })}
                onPickCustom={() =>
                  setNonAdminStallGapRange({
                    kind: 'custom',
                    startYmd: nonAdminStallGapResolvedYmd.startYmd,
                    endYmd: nonAdminStallGapResolvedYmd.endYmd,
                  })
                }
                isNarrow={isNarrow}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <span className="text-[11px] text-zinc-500 shrink-0">自訂起訖</span>
                <input
                  type="date"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 tabular-nums"
                  value={nonAdminStallGapResolvedYmd.startYmd}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setNonAdminStallGapRange({
                      kind: 'custom',
                      startYmd: v,
                      endYmd: nonAdminStallGapResolvedYmd.endYmd,
                    });
                  }}
                />
                <span className="text-zinc-600 text-xs">～</span>
                <input
                  type="date"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 tabular-nums"
                  value={nonAdminStallGapResolvedYmd.endYmd}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setNonAdminStallGapRange({
                      kind: 'custom',
                      startYmd: nonAdminStallGapResolvedYmd.startYmd,
                      endYmd: v,
                    });
                  }}
                />
                <span className="text-[11px] text-zinc-600 tabular-nums">
                  盤點歸屬日：{nonAdminStallGapResolvedYmd.startYmd}～{nonAdminStallGapResolvedYmd.endYmd}
                </span>
              </div>
            </div>
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
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <WeekdayChainPicker
                focusIdx={weekdayChainFocusIdx}
                onChange={setWeekdayChainFocusIdx}
                isNarrow={isNarrow}
              />
              <p className="text-[11px] text-zinc-500 leading-relaxed max-w-xl lg:text-right lg:self-end">
                選取日期：<span className="tabular-nums text-zinc-300">{ymdSlash(calendarWeekFocusYmd)}</span>
              </p>
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
                    <p className="text-[11px] text-amber-200/75">盤點後營收</p>
                    <p className="text-lg font-light tabular-nums text-amber-200 mt-1">
                      {focusDayEconomics?.actual !== null && focusDayEconomics?.actual !== undefined
                        ? moneyTW(focusDayEconomics.actual)
                        : '—'}
                    </p>
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
                        <th className="px-3 py-2 font-medium">週期</th>
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
                            className={cn(
                              'text-zinc-300 hover:bg-white/[0.02]',
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
                              <DirectStallGapReasonCell ymd={row.ymd} syncKey={orderTick} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-zinc-500">
                  歷史同名星期（已登錄實收）：{sameWeekdayActualStats.dayCount} 日
                </p>
              </div>

              <div className="xl:col-span-4 rounded-xl border border-sky-900/35 bg-sky-950/15 p-4 sm:p-5 space-y-3 text-base">
                <p className="text-base sm:text-lg font-medium text-sky-200/90">同名星期・歷史實收統計</p>
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
                      <p className="text-base font-medium text-sky-200/85">各品項售出量（同名星期）</p>
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
                  <div className="pt-1 space-y-2">
                    <div className="flex justify-between gap-2 items-baseline">
                      <span className="text-zinc-500 shrink-0">業績打底</span>
                      <span className="tabular-nums text-amber-200/90 text-sm sm:text-base">
                        已存：
                        {getWeekdayBaselineTarget(weekdayChainFocusIdx) !== undefined
                          ? moneyTW(getWeekdayBaselineTarget(weekdayChainFocusIdx)!)
                          : '未設定'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={weekdayBaselineDraft}
                        onChange={(e) => setWeekdayBaselineDraft(e.target.value)}
                        placeholder="目標金額"
                        className="min-w-[8rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2.5 text-base sm:text-[1.0625rem] text-zinc-200 tabular-nums focus:outline-none focus:border-sky-600/50"
                      />
                      <button
                        type="button"
                        onClick={saveWeekdayBaseline}
                        className="px-3 py-2.5 rounded-lg border border-sky-700/80 bg-sky-950/40 text-sky-200 text-sm sm:text-base hover:bg-sky-900/40"
                      >
                        儲存打底
                      </button>
                    </div>
                  </div>
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
            <div className="space-y-2.5">
              <StallGapQuickPresetRow
                range={directStallGapRange}
                onPreset={(key) => setDirectStallGapRange({ kind: 'preset', key })}
                onPickCustom={() =>
                  setDirectStallGapRange({
                    kind: 'custom',
                    startYmd: directStallGapResolvedYmd.startYmd,
                    endYmd: directStallGapResolvedYmd.endYmd,
                  })
                }
                isNarrow={isNarrow}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <span className="text-[11px] text-zinc-500 shrink-0">自訂起訖</span>
                <input
                  type="date"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 tabular-nums"
                  value={directStallGapResolvedYmd.startYmd}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setDirectStallGapRange({
                      kind: 'custom',
                      startYmd: v,
                      endYmd: directStallGapResolvedYmd.endYmd,
                    });
                  }}
                />
                <span className="text-zinc-600 text-xs">～</span>
                <input
                  type="date"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 tabular-nums"
                  value={directStallGapResolvedYmd.endYmd}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setDirectStallGapRange({
                      kind: 'custom',
                      startYmd: directStallGapResolvedYmd.startYmd,
                      endYmd: v,
                    });
                  }}
                />
                <span className="text-[11px] text-zinc-600 tabular-nums">
                  盤點歸屬日：{directStallGapResolvedYmd.startYmd}～{directStallGapResolvedYmd.endYmd}
                </span>
              </div>
            </div>
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
                    各加盟店營運概況（{summaryRangeLabel(summaryRange)}）
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
                  本期間（{summaryRangeLabel(summaryRange)}）尚無加盟店訂單或盤點資料可彙整。
                  <br />
                  可關閉本視窗後切換上方時段（本日／本週／7天／30天／本月／本年）試試。
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
                            <p className="text-[11px] text-zinc-500">盤點後營收</p>
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
                    依訂單建單日・{summaryRangeLabel(productChartsRange)}・直營與加盟批貨
                    <span className="text-zinc-600 ml-1">（點此展開）</span>
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-zinc-100">營收與支出佔比</h3>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                    依訂單建單日・{summaryRangeLabel(productChartsRange)}・本店可視訂單與流水帳
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
                <DashboardSummaryRangePicker
                  value={productChartsRange}
                  onChange={setProductChartsRange}
                  isNarrow={isNarrow}
                  ariaLabel="商品營收排行區間"
                  wideGapClass="gap-1"
                />
              </div>
              <div>
                <h3 className="text-base font-medium">直營商品營收佔比（{summaryRangeLabel(productChartsRange)}）</h3>
                {adminDirectProducts.length === 0 ? (
                  <p className="text-xs text-zinc-500 mt-2">尚無直營已完成訂單。</p>
                ) : (
                  <>
                    <div className={cn('mt-2', isNarrow ? 'h-44' : 'h-36')}>
                      <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                        <PieChart>
                          <Pie
                            data={adminDirectProducts.slice(0, RANK_DEFAULT_LIMIT).map((r) => ({ name: r.name, value: r.revenue }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={isNarrow ? 22 : 24}
                            outerRadius={isNarrow ? 58 : 52}
                            paddingAngle={2}
                          >
                            {adminDirectProducts.slice(0, RANK_DEFAULT_LIMIT).map((_, i) => (
                              <Cell key={i} fill={EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number | undefined) => [moneyTW(value ?? 0), '營收']}
                            contentStyle={{
                              fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                              borderRadius: '10px',
                              border: '1px solid #3f3f46',
                              backgroundColor: '#18181b',
                              color: '#f5f2ed',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(showAllDirect ? adminDirectProducts : adminDirectProducts.slice(0, RANK_DEFAULT_LIMIT)).map((r) => (
                        <div key={`direct-${r.id}`} className="flex justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{r.id}. {r.name}</span>
                          <span className="text-amber-200 tabular-nums">{moneyTW(r.revenue)} / {r.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                    {adminDirectProducts.length > RANK_DEFAULT_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllDirect((v) => !v)}
                        className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {showAllDirect ? '收合排行' : '展開全部商品'}
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-base font-medium">加盟批貨商品營收佔比（{summaryRangeLabel(productChartsRange)}）</h3>
                {adminFranchiseProducts.length === 0 ? (
                  <p className="text-xs text-zinc-500 mt-2">尚無加盟批貨已完成訂單。</p>
                ) : (
                  <>
                    <div className={cn('mt-2', isNarrow ? 'h-44' : 'h-36')}>
                      <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                        <PieChart>
                          <Pie
                            data={adminFranchiseProducts.slice(0, RANK_DEFAULT_LIMIT).map((r) => ({ name: r.name, value: r.revenue }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={isNarrow ? 22 : 24}
                            outerRadius={isNarrow ? 58 : 52}
                            paddingAngle={2}
                          >
                            {adminFranchiseProducts.slice(0, RANK_DEFAULT_LIMIT).map((_, i) => (
                              <Cell key={i} fill={INGREDIENT_STRUCTURE_PIE_COLORS[i % INGREDIENT_STRUCTURE_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number | undefined) => [moneyTW(value ?? 0), '營收']}
                            contentStyle={{
                              fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                              borderRadius: '10px',
                              border: '1px solid #3f3f46',
                              backgroundColor: '#18181b',
                              color: '#f5f2ed',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(showAllFranchise ? adminFranchiseProducts : adminFranchiseProducts.slice(0, RANK_DEFAULT_LIMIT)).map((r) => (
                        <div key={`fr-${r.id}`} className="flex justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{r.id}. {r.name}</span>
                          <span className="text-amber-200 tabular-nums">{moneyTW(r.revenue)} / {r.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                    {adminFranchiseProducts.length > RANK_DEFAULT_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllFranchise((v) => !v)}
                        className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {showAllFranchise ? '收合排行' : '展開全部商品'}
                      </button>
                    )}
                  </>
                )}
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
                <DashboardSummaryRangePicker
                  value={productChartsRange}
                  onChange={setProductChartsRange}
                  isNarrow={isNarrow}
                  ariaLabel="商品營收排行區間"
                  wideGapClass="gap-1"
                />
              </div>
              <h3 className="text-base font-medium">商品營收佔比（{summaryRangeLabel(productChartsRange)}）</h3>
              <div className="flex-1">
                {topProducts.length === 0 ? (
                  <p className="text-sm text-zinc-500 py-8 text-center">尚無已完成銷售可排行。</p>
                ) : (
                  <>
                    <div className={cn(isNarrow ? 'h-48' : 'h-40')}>
                      <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                        <PieChart>
                          <Pie
                            data={topProducts.slice(0, RANK_DEFAULT_LIMIT).map((r) => ({ name: r.name, value: r.revenue }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={isNarrow ? 28 : 30}
                            outerRadius={isNarrow ? 68 : 62}
                            paddingAngle={2}
                          >
                            {topProducts.slice(0, RANK_DEFAULT_LIMIT).map((_, i) => (
                              <Cell key={i} fill={EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number | undefined) => [moneyTW(value ?? 0), '營收']}
                            contentStyle={{
                              fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                              borderRadius: '10px',
                              border: '1px solid #3f3f46',
                              backgroundColor: '#18181b',
                              color: '#f5f2ed',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(showAllSelf ? topProducts : topProducts.slice(0, RANK_DEFAULT_LIMIT)).map((product) => (
                        <div key={product.id} className="flex justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{product.id}. {product.name}</span>
                          <span className="text-amber-100 tabular-nums">
                            {moneyTW(product.revenue)} /{' '}
                            {((product.revenue / Math.max(1, topProductsTotalRevenue)) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {topProducts.length > RANK_DEFAULT_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllSelf((v) => !v)}
                        className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {showAllSelf ? '收合排行' : '展開全部商品'}
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-base font-medium">支出佔比（{summaryRangeLabel(productChartsRange)}）</h3>
                {nonAdminExpenseRows.length === 0 ? (
                  <p className="text-sm text-zinc-500 py-6 text-center">尚無支出資料。</p>
                ) : (
                  <>
                    <div className={cn('mt-2', isNarrow ? 'h-48' : 'h-40')}>
                      <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                        <PieChart>
                          <Pie
                            data={nonAdminExpenseRows.slice(0, RANK_DEFAULT_LIMIT).map((r) => ({ name: r.name, value: r.amount }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={isNarrow ? 28 : 30}
                            outerRadius={isNarrow ? 68 : 62}
                            paddingAngle={2}
                          >
                            {nonAdminExpenseRows.slice(0, RANK_DEFAULT_LIMIT).map((_, i) => (
                              <Cell key={i} fill={INGREDIENT_STRUCTURE_PIE_COLORS[i % INGREDIENT_STRUCTURE_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number | undefined) => [moneyTW(value ?? 0), '支出']}
                            contentStyle={{
                              fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                              borderRadius: '10px',
                              border: '1px solid #3f3f46',
                              backgroundColor: '#18181b',
                              color: '#f5f2ed',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(showAllExpenseSelf
                        ? nonAdminExpenseRows
                        : nonAdminExpenseRows.slice(0, RANK_DEFAULT_LIMIT)
                      ).map((row) => (
                        <div key={row.id} className="flex justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{row.id}. {row.name}</span>
                          <span className="text-amber-200 tabular-nums">
                            {moneyTW(row.amount)} / {row.pct.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {nonAdminExpenseRows.length > RANK_DEFAULT_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllExpenseSelf((v) => !v)}
                        className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                      >
                        {showAllExpenseSelf ? '收合排行' : '展開全部項目'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          </div>
        </details>
      </div>

      {isAdmin && adminFinance && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/35">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 text-left [&::-webkit-details-marker]:hidden">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-amber-500/90">
                  <TrendingUp size={20} className="shrink-0" aria-hidden />
                  <h3 className="text-lg font-medium text-zinc-100">支出結構表（本月）</h3>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  依流水帳支出細項加總・{adminFinance.expenseBreakdown.length} 項類別
                  <span className="text-zinc-600 ml-1">（點此展開）</span>
                </p>
              </div>
              <ChevronDown
                className="h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-4 border-t border-zinc-800/80">
              <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/35 p-4">
                {adminFinance.expenseBreakdown.length === 0 ? (
                  <p className="text-sm text-zinc-500 flex items-center justify-center py-10 text-center">
                    本月尚無支出資料可供分析。
                  </p>
                ) : (
                  <>
                    <div className={cn('w-full', isNarrow ? 'h-[260px]' : 'h-[300px]')}>
                      <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                        <PieChart>
                          <Pie
                            data={adminFinance.expenseBreakdown.map((r) => ({ name: r.name, value: r.value }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={isNarrow ? 42 : 56}
                            outerRadius={isNarrow ? 86 : 110}
                            paddingAngle={2}
                            label={
                              isNarrow
                                ? false
                                : ({ name, percent }) =>
                                    `${String(name).length > 10 ? String(name).slice(0, 10) + '…' : name} ${((percent ?? 0) * 100).toFixed(0)}%`
                            }
                          >
                            {adminFinance.expenseBreakdown.map((_, i) => (
                              <Cell key={i} fill={EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number | undefined) => [moneyTW(value ?? 0), '支出']}
                            contentStyle={{
                              borderRadius: '12px',
                              border: '1px solid #3f3f46',
                              backgroundColor: '#18181b',
                              color: '#f5f2ed',
                              fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 space-y-2">
                      {adminFinance.expenseBreakdown.map((row, idx) => (
                        <div key={row.name} className="flex justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{idx + 1}. {row.name}</span>
                          <span className="text-amber-200 tabular-nums">
                            {moneyTW(row.value)} / {row.pctOfExpense.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </details>
        </div>
      )}

    </div>
  );
}
