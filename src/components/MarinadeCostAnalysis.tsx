import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import {
  DashboardMonthCustomRangePicker,
  dashboardPeriodLabel,
  resolveDashboardPeriodYmd,
  type DashboardPeriodMode,
} from './DashboardPeriodPicker';
import { useAccountingLedger } from '../hooks/useAccountingLedger';
import { useIsNarrowScreen } from '../hooks/useIsNarrowScreen';
import { computeMarinadeExpenseAnalysis } from '../lib/accountingLedgerStorage';
import { cn } from '../lib/utils';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MARINADE_PIE_COLORS = ['#d97706', '#ca8a04', '#b45309', '#92400e', '#78350f', '#451a03', '#57534e'];

function money(n: number) {
  return n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * 滷料成本分析（資料來自流水帳滷料集合）。預設統計當月，可自訂區間。
 */
export default function MarinadeCostAnalysis() {
  const isNarrow = useIsNarrowScreen();
  const { entries } = useAccountingLedger();
  const [analysisPeriod, setAnalysisPeriod] = useState<DashboardPeriodMode>({ kind: 'month' });

  const rangeBounds = useMemo(() => {
    const { startYmd, endYmd } = resolveDashboardPeriodYmd(analysisPeriod);
    return { lo: startYmd, hi: endYmd };
  }, [analysisPeriod]);

  const marinadeAnalysis = useMemo(() => {
    const lo = rangeBounds.lo;
    const hi = rangeBounds.hi;
    if (!lo || !hi) return computeMarinadeExpenseAnalysis(entries, todayYmd(), todayYmd());
    return computeMarinadeExpenseAnalysis(entries, lo, hi);
  }, [entries, rangeBounds.lo, rangeBounds.hi]);

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
              資料來自收入與支出「滷料」大項：依子類（糖、味精、醬油、中草藥、其他調味等）統計；無子類或無法對應者併入「未指定子類／其他」。與「食材支出」分開紀錄。明細請至「收入與支出」新增或編輯。
            </p>
          </div>

          <div className="w-full min-w-0 max-w-xs shrink-0">
            <DashboardMonthCustomRangePicker
              value={analysisPeriod}
              onChange={setAnalysisPeriod}
              ariaLabel="滷料分析日期區間"
            />
          </div>
        </div>

        <p className="text-[0.625rem] text-zinc-600">
          目前區間：{dashboardPeriodLabel(analysisPeriod)}
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
            <div className={cn('w-full', isNarrow ? 'h-[220px]' : 'h-[200px]')}>
              <ResponsiveContainer width="100%" height="100%" debounce={isNarrow ? 80 : 0}>
                <PieChart>
                  <Pie
                    data={marinadeAnalysis.pieRows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={isNarrow ? 36 : 40}
                    outerRadius={isNarrow ? 76 : 72}
                    paddingAngle={1}
                    label={
                      isNarrow
                        ? false
                        : ({ name, percent }) =>
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
                      fontSize: isNarrow ? '0.8125rem' : '0.75rem',
                    }}
                  />
                  {!isNarrow && (
                    <Legend
                      wrapperStyle={{ fontSize: '0.75rem', color: '#a1a1aa' }}
                      formatter={(value) => <span className="text-zinc-400">{value}</span>}
                    />
                  )}
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
