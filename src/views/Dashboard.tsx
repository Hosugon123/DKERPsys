import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, FileText, Target, Store, HandCoins } from 'lucide-react';
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
import { computeAdminDashboardFinance, currentYmLocal, stallCountAttributeYmd } from '../lib/financeLib';
import { ACCOUNTING_LEDGER_UPDATED_EVENT, listAccountingLedgerEntries } from '../lib/accountingLedgerStorage';
import { getSupplyItem } from '../lib/supplyCatalog';
import { getStallDisplaySoldAtRetail, getStallDisplayShouldRevenue } from '../lib/orderStallDisplayRevenue';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  type OrderHistoryEntry,
  type OrderActorRole,
} from '../lib/orderHistoryStorage';

const HQ_STALL_VIEW = 'headquarter' as const;

const EXPENSE_PIE_COLORS = ['#d97706', '#6366f1', '#10b981', '#f43f5e', '#a855f7', '#06b6d4', '#eab308', '#ec4899', '#84cc16', '#f97316'];

const INGREDIENT_STRUCTURE_PIE_COLORS = ['#ea580c', '#6366f1'];

type DashboardOrder = OrderHistoryEntry;

function ymdFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function roleVisible(actorRole: OrderActorRole, userRole: UserRole): boolean {
  if (userRole === 'admin') return true;
  if (userRole === 'franchisee') return actorRole === 'franchisee';
  return actorRole === 'employee';
}

type ProductRevenueRow = { id: number; name: string; revenue: number; qty: number; pct: number };
type SummaryRangeKey = 'today' | 'week' | 'month' | 'year';
type ExpenseShareRow = { id: number; name: string; amount: number; pct: number };
const RANK_DEFAULT_LIMIT = 10;

function aggregateProductRevenue(
  orders: DashboardOrder[],
  predicate: (o: DashboardOrder) => boolean,
): ProductRevenueRow[] {
  const byName = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const o of orders) {
    if (!predicate(o)) continue;
    for (const line of o.lines) {
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

function summaryRangeLabel(key: SummaryRangeKey): string {
  if (key === 'today') return '本日';
  if (key === 'week') return '本週';
  if (key === 'year') return '本年';
  return '本月';
}

function resolveRange(key: SummaryRangeKey): { startYmd: string; endYmd: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = toYmd(today);
  if (key === 'today') return { startYmd: end, endYmd: end };
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

function moneyTW(n: number) {
  return `$ ${Math.round(n).toLocaleString('zh-TW')}`;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

export default function Dashboard({ userRole }: { userRole: UserRole }) {
  const isNarrow = useIsNarrowScreen();
  const isAdmin = userRole === 'admin';
  const [financeTick, setFinanceTick] = useState(0);
  const [orderTick, setOrderTick] = useState(0);
  const [summaryRange, setSummaryRange] = useState<SummaryRangeKey>('month');
  const [showAllDirect, setShowAllDirect] = useState(false);
  const [showAllFranchise, setShowAllFranchise] = useState(false);
  const [showAllSelf, setShowAllSelf] = useState(false);
  const [showAllExpenseSelf, setShowAllExpenseSelf] = useState(false);

  useEffect(() => {
    if (!isAdmin && summaryRange === 'year') {
      setSummaryRange('month');
    }
  }, [isAdmin, summaryRange]);

  const adminFinance = useMemo(() => {
    if (!isAdmin) return null;
    return computeAdminDashboardFinance(currentYmLocal());
  }, [isAdmin, financeTick]);

  useEffect(() => {
    const bump = () => setOrderTick((t) => t + 1);
    window.addEventListener('orderHistoryUpdated', bump);
    window.addEventListener('franchiseManagementOrdersUpdated', bump);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bump);
      window.removeEventListener('franchiseManagementOrdersUpdated', bump);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const bump = () => setFinanceTick((t) => t + 1);
    window.addEventListener('orderHistoryUpdated', bump);
    window.addEventListener('franchiseManagementOrdersUpdated', bump);
    window.addEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener('orderHistoryUpdated', bump);
      window.removeEventListener('franchiseManagementOrdersUpdated', bump);
      window.removeEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, bump);
    };
  }, [isAdmin]);

  const dashboardOrders = useMemo(() => {
    const mgmt = loadFranchiseManagementOrders().map<DashboardOrder>((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      source: m.source,
      totalAmount: m.totalAmount,
      itemCount: m.itemCount,
      lines: m.lines,
      actorRole: 'admin',
      storeLabel: m.storeLabel,
      status: m.status,
      stallCountBasisYmd: m.stallCountBasisYmd,
      stallCountCompletedAt: m.stallCountCompletedAt,
      stallCountSnapshot: m.stallCountSnapshot,
    }));
    const history = loadOrderHistory();
    const all = [...mgmt, ...history].filter((o) => roleVisible(o.actorRole, userRole));
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all;
  }, [userRole, orderTick]);

  const nonAdminSummary = useMemo(() => {
    if (isAdmin) return null;
    const { startYmd, endYmd } = resolveRange(summaryRange);
    const stallCompleted = dashboardOrders.filter((o) => {
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
    const ledgerExpense =
      userRole === 'employee'
        ? 0
        : listAccountingLedgerEntries()
            .filter((e) => e.flowType === 'expense' && e.dateYmd >= startYmd && e.dateYmd <= endYmd)
            .reduce((s, e) => s + e.amount, 0);
    const expense = procurementCost + ledgerExpense;
    // 淨利以「營收 - 總支出」計，避免批貨成本於 gross 與 expense 重複扣減。
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
  }, [dashboardOrders, isAdmin, summaryRange, financeTick, userRole]);

  const topProducts = useMemo(() => {
    const completed =
      isAdmin || !nonAdminSummary
        ? dashboardOrders.filter((o) => o.status === '已完成')
        : nonAdminSummary.completed;
    const byName = new Map<string, { name: string; sales: number; revenue: number }>();
    for (const o of completed) {
      for (const line of o.lines) {
        const prev = byName.get(line.name) ?? { name: line.name, sales: 0, revenue: 0 };
        prev.sales += line.qty;
        prev.revenue += line.qty * line.unitPrice;
        byName.set(line.name, prev);
      }
    }
    return Array.from(byName.values())
      .sort((a, b) => (b.revenue === a.revenue ? b.sales - a.sales : b.revenue - a.revenue))
      .map((r, i) => ({ id: i + 1, ...r }));
  }, [dashboardOrders, isAdmin, nonAdminSummary]);

  const topProductsTotalRevenue = useMemo(
    () => topProducts.reduce((s, p) => s + p.revenue, 0),
    [topProducts],
  );

  const nonAdminExpenseRows = useMemo(() => {
    if (isAdmin) return [];
    if (userRole === 'employee') return [];
    const { startYmd, endYmd } = resolveRange(summaryRange);
    const byName = new Map<string, number>();
    const procurementCost = nonAdminSummary?.procurementCost ?? 0;
    if (procurementCost > 0) byName.set('批貨成本', procurementCost);
    for (const e of listAccountingLedgerEntries()) {
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
  }, [isAdmin, summaryRange, financeTick, nonAdminSummary, userRole]);

  const adminSummaryOrders = useMemo(() => {
    if (!isAdmin) return [];
    const { startYmd, endYmd } = resolveRange(summaryRange);
    return dashboardOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd = ymdFromIso(o.createdAt);
      return ymd >= startYmd && ymd <= endYmd;
    });
  }, [dashboardOrders, isAdmin, summaryRange]);

  const adminRangeSummary = useMemo(() => {
    if (!isAdmin) return null;
    const { startYmd, endYmd } = resolveRange(summaryRange);

    let directRevenue = 0;
    let franchiseRevenue = 0;
    let directCost = 0;
    let franchiseCost = 0;

    for (const o of dashboardOrders) {
      if (o.actorRole === 'admin' || o.actorRole === 'employee') {
        const stallYmd = stallCountAttributeYmd(o);
        if (o.stallCountCompletedAt && stallYmd && stallYmd >= startYmd && stallYmd <= endYmd) {
          const rev = getStallDisplaySoldAtRetail(o, HQ_STALL_VIEW);
          const cogsRef = getStallDisplayShouldRevenue(o, HQ_STALL_VIEW);
          if (rev != null) directRevenue += rev;
          if (cogsRef != null) directCost += cogsRef;
        }
      } else if (o.actorRole === 'franchisee' && o.status === '已完成') {
        const ymd = ymdFromIso(o.createdAt);
        if (ymd >= startYmd && ymd <= endYmd) {
          franchiseRevenue += o.totalAmount;
          let orderCost = 0;
          for (const line of o.lines) {
            const item = getSupplyItem(line.productId);
            const unitCost = item?.pricePerPiece ?? 0;
            orderCost += unitCost * line.qty;
          }
          franchiseCost += orderCost;
        }
      }
    }

    const totalExpense = listAccountingLedgerEntries()
      .filter((e) => e.flowType === 'expense' && e.dateYmd >= startYmd && e.dateYmd <= endYmd)
      .reduce((s, e) => s + e.amount, 0);

    const directGross = directRevenue - directCost;
    const franchiseGross = franchiseRevenue - franchiseCost;
    const totalRevenue = directRevenue + franchiseRevenue;
    const totalGross = totalRevenue - (directCost + franchiseCost);
    return {
      directRevenue,
      franchiseRevenue,
      totalExpense,
      directGross,
      directGrossRate: pct(directGross, directRevenue),
      franchiseGross,
      franchiseGrossRate: pct(franchiseGross, franchiseRevenue),
      totalGross,
      totalGrossRate: pct(totalGross, totalRevenue),
      rangeLabel: summaryRangeLabel(summaryRange),
    };
  }, [dashboardOrders, isAdmin, summaryRange, financeTick]);

  const adminDirectProducts = useMemo(() => {
    if (!isAdmin) return [];
    return aggregateProductRevenue(
      adminSummaryOrders,
      (o) => o.actorRole === 'admin' || o.actorRole === 'employee',
    );
  }, [adminSummaryOrders, isAdmin]);

  const adminFranchiseProducts = useMemo(() => {
    if (!isAdmin) return [];
    return aggregateProductRevenue(adminSummaryOrders, (o) => o.actorRole === 'franchisee');
  }, [adminSummaryOrders, isAdmin]);

  const headerSubline =
    isAdmin && adminFinance
      ? `本月 ${adminFinance.ym.split('-')[0]} 年 ${Number(adminFinance.ym.split('-')[1])} 月 · 直營以盤點零售營收、加盟以已完成叫貨；並含流水帳即時資料 | 總管理處`
      : `資料更新時間：${new Date().toLocaleString('zh-TW', { hour12: false })} | ${
          userRole === 'franchisee' ? '加盟體系' : '直營體系'
        }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            {isAdmin ? '總部營運概況' : '我的營運概況'}
          </h2>
          <p className="text-zinc-500 mt-1">{headerSubline}</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors font-medium text-xs">
            今日
          </button>
          <button className="px-4 py-2 bg-zinc-800 border border-zinc-700 text-amber-500 rounded-lg hover:bg-zinc-700 transition-colors font-medium text-xs">
            匯出報表
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-1">
          {([
            ['today', '本日'],
            ['week', '本週'],
            ['month', '本月'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSummaryRange(key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs border transition-colors',
                summaryRange === key
                  ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isAdmin && adminFinance ? (
          <>
            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <HandCoins size={18} className="text-amber-500" />
                <p className="text-sm">營收總計（本月）</p>
              </div>
              <div>
                <h2 className="text-3xl font-light mt-1 text-amber-500 tabular-nums">{moneyTW(adminFinance.revenueTotal)}</h2>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  直營店盤點營收 {moneyTW(adminFinance.directStoreStallRetailTotal)} ＋ 加盟主批貨{' '}
                  {moneyTW(adminFinance.franchiseeOrderTotal)}
                  {adminFinance.ledgerIncomeTotal > 0 ? (
                    <span className="block mt-1 text-zinc-600">
                      流水帳收入 {moneyTW(adminFinance.ledgerIncomeTotal)}（未計入營收總計）
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <Store size={18} className="text-indigo-400" />
                <p className="text-sm">支出總計（本月）</p>
              </div>
              <div>
                <h2 className="text-3xl font-light mt-1 text-[#f5f2ed] tabular-nums">{moneyTW(adminFinance.expenseTotal)}</h2>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  依流水帳支出認列（本月）{moneyTW(adminFinance.ledgerExpenseTotal)}
                </p>
              </div>
            </div>

            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <TrendingUp size={18} className="text-emerald-400" />
                <p className="text-sm">淨利（本月）</p>
              </div>
              <div>
                <div className="flex justify-between items-end mb-2 gap-2">
                  <h2
                    className={cn(
                      'text-3xl font-light mt-1 tabular-nums',
                      adminFinance.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    )}
                  >
                    {moneyTW(adminFinance.netProfit)}
                  </h2>
                  <div className="text-xs text-zinc-500 shrink-0 text-right">營收 − 支出</div>
                </div>
                <p className="text-xs text-zinc-500">
                  營收＝直營盤點零售＋加盟叫貨；支出＝本月已完成直營叫貨與流水帳支出。
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <TrendingUp size={18} className="text-amber-500" />
                <p className="text-sm">{nonAdminSummary?.rangeLabel ?? '本月'}營收</p>
              </div>
              <div>
                <h2 className="text-3xl font-light mt-1 text-amber-500">{moneyTW(nonAdminSummary?.revenue ?? 0)}</h2>
                <div className="text-xs mt-2 text-zinc-500">依已完成訂單統計</div>
              </div>
            </div>

            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <FileText size={18} />
                <p className="text-sm">{nonAdminSummary?.rangeLabel ?? '本月'}營收毛利</p>
              </div>
              <div>
                <h2 className={cn('text-3xl font-light mt-1', (nonAdminSummary?.gross ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {moneyTW(nonAdminSummary?.gross ?? 0)}
                </h2>
                <div className="text-xs mt-2 text-zinc-500">
                  營收 - 批貨成本 {moneyTW(nonAdminSummary?.procurementCost ?? 0)}（毛利率 {nonAdminSummary?.grossRate.toFixed(1) ?? '0.0'}%）
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2 text-zinc-500">
                <Target size={18} />
                <p className="text-sm">{nonAdminSummary?.rangeLabel ?? '本月'}支出與淨利</p>
              </div>
              <div>
                <div className="flex justify-between items-end mb-1">
                  <h2 className="text-3xl font-light mt-1 text-rose-300">{moneyTW(nonAdminSummary?.expense ?? 0)}</h2>
                  <div className="text-xs text-zinc-500">支出</div>
                </div>
                <div className={cn('text-xs mt-2', (nonAdminSummary?.net ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  淨利 {moneyTW(nonAdminSummary?.net ?? 0)}（淨利率 {nonAdminSummary?.netRate.toFixed(1) ?? '0.0'}%）
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {isAdmin && adminRangeSummary && (
        <div className="bg-zinc-900/40 rounded-2xl p-6 border border-zinc-800">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 text-amber-500/90">
            <TrendingUp size={20} className="shrink-0" />
              <h3 className="text-lg font-medium text-zinc-100">{adminRangeSummary.rangeLabel}總部營運摘要</h3>
            </div>
            <div className="flex items-center gap-1">
              {([
                ['today', '本日'],
                ['week', '本週'],
                ['month', '本月'],
                ['year', '本年'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSummaryRange(key)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs border transition-colors',
                    summaryRange === key
                      ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            直營依盤點日區間加總零售營收（與銷售紀錄盤點金額一致）；加盟依建單日區間之已完成叫貨；右欄為同期流水帳支出。
          </p>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4">
              <p className="text-xs text-zinc-500">直營店營收</p>
              <p className="text-2xl mt-1 text-amber-300 tabular-nums">{moneyTW(adminRangeSummary.directRevenue)}</p>
              <p className={cn('text-xs mt-2', adminRangeSummary.directGross >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                毛利 {moneyTW(adminRangeSummary.directGross)}（{adminRangeSummary.directGrossRate.toFixed(1)}%）
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4">
              <p className="text-xs text-zinc-500">加盟主批貨營收</p>
              <p className="text-2xl mt-1 text-indigo-300 tabular-nums">{moneyTW(adminRangeSummary.franchiseRevenue)}</p>
              <p className={cn('text-xs mt-2', adminRangeSummary.franchiseGross >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                毛利 {moneyTW(adminRangeSummary.franchiseGross)}（{adminRangeSummary.franchiseGrossRate.toFixed(1)}%）
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/35 p-4">
              <p className="text-xs text-zinc-500">總支出成本</p>
              <p className="text-2xl mt-1 text-rose-300 tabular-nums">{moneyTW(adminRangeSummary.totalExpense)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800 flex flex-col gap-5">
          {isAdmin ? (
            <>
              <div>
                <h3 className="text-base font-medium">直營商品營收佔比（{summaryRangeLabel(summaryRange)}）</h3>
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
                <h3 className="text-base font-medium">加盟批貨商品營收佔比（{summaryRangeLabel(summaryRange)}）</h3>
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
                          <span className="text-indigo-200 tabular-nums">{moneyTW(r.revenue)} / {r.pct.toFixed(1)}%</span>
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
              <h3 className="text-base font-medium">商品營收佔比（{summaryRangeLabel(summaryRange)}）</h3>
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
                <h3 className="text-base font-medium">支出佔比（{summaryRangeLabel(summaryRange)}）</h3>
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
                          <span className="text-indigo-200 tabular-nums">
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

      {isAdmin && adminFinance && (
        <div className="bg-zinc-900/40 rounded-2xl p-6 border border-zinc-800">
          <div className="flex items-center gap-2 mb-1 text-amber-500/90">
            <TrendingUp size={20} className="shrink-0" />
            <h3 className="text-lg font-medium text-zinc-100">支出結構表（本月）</h3>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            依流水帳支出細項加總，展示本月各支出類別占比。
          </p>
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
                      <span className="text-indigo-200 tabular-nums">
                        {moneyTW(row.value)} / {row.pctOfExpense.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
