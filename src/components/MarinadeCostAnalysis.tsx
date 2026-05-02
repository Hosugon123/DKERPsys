import { useCallback, useMemo, useState } from 'react';
import { FlaskConical, CalendarDays } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { useAccountingLedger } from '../hooks/useAccountingLedger';
import { computeMarinadeExpenseAnalysis } from '../lib/accountingLedgerStorage';
import { ymdDashToSlash } from '../lib/dateDisplay';
import { cn } from '../lib/utils';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBoundsFromYm(ym: string): { start: string; end: string } {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    const t = todayYmd();
    return { start: t, end: t };
  }
  const mm = String(m).padStart(2, '0');
  const start = `${y}-${mm}-01`;
  const lastCal = new Date(y, m, 0);
  const end = `${y}-${mm}-${String(lastCal.getDate()).padStart(2, '0')}`;
  return { start, end };
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function thisWeekMonToSunBounds(): { start: string; end: string } {
  const now = new Date();
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return {
    start: `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`,
    end: `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`,
  };
}

type DateQuickPreset = 'today' | 'week' | '30d';

const MARINADE_PIE_COLORS = ['#d97706', '#ca8a04', '#b45309', '#92400e', '#78350f', '#451a03', '#57534e'];

const rangeDateInputClass =
  'h-9 min-w-0 w-[124px] sm:w-[136px] rounded-lg bg-zinc-950/90 border border-amber-900/40 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/60 [color-scheme:dark] shrink-0';

function money(n: number) {
  return n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * 滷料成本分析（資料來自流水帳滷料集合）。預設統計當月，可自訂區間。
 */
export default function MarinadeCostAnalysis() {
  const { entries } = useAccountingLedger();

  const defaultRange = useMemo(() => monthBoundsFromYm(currentYm()), []);
  const [rangeStart, setRangeStart] = useState(defaultRange.start);
  const [rangeEnd, setRangeEnd] = useState(defaultRange.end);
  const [quickPreset, setQuickPreset] = useState<DateQuickPreset | null>(null);

  const rangeBounds = useMemo(() => {
    if (!rangeStart || !rangeEnd) return { lo: '', hi: '' };
    return rangeStart <= rangeEnd ? { lo: rangeStart, hi: rangeEnd } : { lo: rangeEnd, hi: rangeStart };
  }, [rangeStart, rangeEnd]);

  const marinadeAnalysis = useMemo(() => {
    const lo = rangeBounds.lo;
    const hi = rangeBounds.hi;
    if (!lo || !hi) return computeMarinadeExpenseAnalysis(entries, todayYmd(), todayYmd());
    return computeMarinadeExpenseAnalysis(entries, lo, hi);
  }, [entries, rangeBounds.lo, rangeBounds.hi]);

  const clearToCurrentMonth = useCallback(() => {
    setQuickPreset(null);
    const { start, end } = monthBoundsFromYm(currentYm());
    setRangeStart(start);
    setRangeEnd(end);
  }, []);

  const showAllDataRange = useCallback(() => {
    setQuickPreset(null);
    if (entries.length === 0) {
      const t = todayYmd();
      setRangeStart(t);
      setRangeEnd(t);
      return;
    }
    const sorted = entries.map((e) => e.dateYmd).sort();
    setRangeStart(sorted[0]!);
    setRangeEnd(sorted[sorted.length - 1]!);
  }, [entries]);

  const applyQuickToday = useCallback(() => {
    const t = todayYmd();
    setRangeStart(t);
    setRangeEnd(t);
    setQuickPreset('today');
  }, []);

  const applyQuickWeek = useCallback(() => {
    const { start, end } = thisWeekMonToSunBounds();
    setRangeStart(start);
    setRangeEnd(end);
    setQuickPreset('week');
  }, []);

  const applyQuick30Days = useCallback(() => {
    const end = todayYmd();
    setRangeEnd(end);
    setRangeStart(addDaysToYmd(end, -29));
    setQuickPreset('30d');
  }, []);

  return (
    <section className="rounded-2xl border border-amber-900/25 bg-zinc-900/40 backdrop-blur-sm shadow-xl shadow-black/15 p-4 md:p-5">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-amber-500/90 mb-1">
              <FlaskConical size={18} className="shrink-0" />
              <h3 className="text-base font-semibold text-zinc-100">滷料成本分析</h3>
            </div>
            <p className="text-[0.6875rem] text-zinc-500 max-w-2xl">
              資料來自流水帳大項「滷料」：依子類（糖、味精、醬油、中草藥、其他調味等）統計；無子類或無法對應者併入「未指定子類／其他」。與「食材支出」分開紀錄。明細請至「流水帳」新增或編輯。
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-lg border border-amber-900/35 bg-zinc-950/60 px-2 py-1.5 shrink-0"
            role="group"
            aria-label="滷料分析日期範圍"
          >
            <div className="flex flex-wrap items-center gap-1 mr-0.5 pr-1 border-r border-zinc-800/90">
              {(
                [
                  { id: 'today' as const, label: '今天', onClick: applyQuickToday },
                  { id: 'week' as const, label: '本週', onClick: applyQuickWeek },
                  { id: '30d' as const, label: '近 30 天', onClick: applyQuick30Days },
                ] as const
              ).map(({ id, label, onClick }) => (
                <button
                  key={id}
                  type="button"
                  onClick={onClick}
                  aria-pressed={quickPreset === id}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md font-medium transition-colors border',
                    quickPreset === id
                      ? 'bg-amber-600 text-white border-amber-500 shadow-sm shadow-amber-900/30'
                      : 'bg-zinc-950/50 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:border-zinc-600'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <CalendarDays size={14} className="text-amber-600/75 shrink-0" aria-hidden />
            <span className="text-[0.6875rem] text-zinc-500 whitespace-nowrap">從</span>
            <input
              type="date"
              value={rangeStart}
              onChange={(ev) => {
                setRangeStart(ev.target.value);
                setQuickPreset(null);
              }}
              className={rangeDateInputClass}
              aria-label="起始日期"
            />
            <span className="text-[0.6875rem] text-zinc-500 whitespace-nowrap">至</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(ev) => {
                setRangeEnd(ev.target.value);
                setQuickPreset(null);
              }}
              className={rangeDateInputClass}
              aria-label="結束日期"
            />
            <button
              type="button"
              onClick={clearToCurrentMonth}
              className="h-9 px-2 rounded-lg text-[0.6875rem] font-medium border border-zinc-600/70 text-zinc-400 hover:bg-zinc-800/90 hover:text-zinc-200 transition-colors whitespace-nowrap"
            >
              當月
            </button>
            <button
              type="button"
              onClick={showAllDataRange}
              className="h-9 px-2 rounded-lg text-[0.6875rem] font-medium border border-amber-800/45 text-amber-200/85 bg-amber-950/25 hover:bg-amber-950/40 transition-colors whitespace-nowrap"
            >
              全部
            </button>
          </div>
        </div>

        <p className="text-[0.625rem] text-zinc-600">
          目前區間：{rangeBounds.lo && rangeBounds.hi ? `${ymdDashToSlash(rangeBounds.lo)} ～ ${ymdDashToSlash(rangeBounds.hi)}` : '—'}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-stretch">
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/35 p-3 flex flex-col">
          <div className="text-[0.6875rem] text-zinc-500 mb-2">集合視角</div>
          <div className="text-sm text-zinc-300">
            滷料總支出{' '}
            <span className="text-amber-200 font-semibold tabular-nums">${money(marinadeAnalysis.totalMarinadeExpense)}</span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            區間 {marinadeAnalysis.spanDays} 天 · 平均每日滷料成本{' '}
            <span className="text-amber-200/95 font-medium tabular-nums">
              ${money(marinadeAnalysis.avgDailyMarinade)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/35 p-3 min-h-[200px]">
          <div className="text-[0.6875rem] text-zinc-500 mb-1">細分視角（佔滷料總支出）</div>
          {marinadeAnalysis.totalMarinadeExpense <= 0 || marinadeAnalysis.pieRows.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 text-center">此期間尚無滷料相關支出</p>
          ) : (
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={marinadeAnalysis.pieRows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={72}
                    paddingAngle={1}
                    label={({ name, percent }) =>
                      `${String(name).length > 4 ? String(name).slice(0, 4) + '…' : name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                  >
                    {marinadeAnalysis.pieRows.map((_, i) => (
                      <Cell
                        key={i}
                        fill={MARINADE_PIE_COLORS[i % MARINADE_PIE_COLORS.length]}
                        stroke="#18181b"
                        strokeWidth={1}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | undefined) => [`$${money(value ?? 0)}`, '金額']}
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #3f3f46',
                      backgroundColor: '#18181b',
                      color: '#f5f2ed',
                      fontSize: '0.75rem',
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '0.6875rem', color: '#a1a1aa' }}
                    formatter={(value) => <span className="text-zinc-400">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
