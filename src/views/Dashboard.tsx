import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, FileText, Target, Store, HandCoins, LayoutDashboard, ChevronRight, ArrowLeft, Eye, X } from 'lucide-react';
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
import {
  ACCOUNTING_LEDGER_UPDATED_EVENT,
  listAccountingLedgerEntries,
  listAccountingLedgerEntriesForScopeId,
} from '../lib/accountingLedgerStorage';
import { getSupplyItem, isFranchiseeSelfSuppliedItem } from '../lib/supplyCatalog';
import { getStallDisplaySoldAtRetail, getStallDisplayShouldRevenue } from '../lib/orderStallDisplayRevenue';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';
import {
  loadFranchiseManagementOrders,
  loadOrderHistory,
  effectiveOrderDateYmd,
  type OrderHistoryEntry,
  type OrderActorRole,
} from '../lib/orderHistoryStorage';

const HQ_STALL_VIEW = 'headquarter' as const;

const EXPENSE_PIE_COLORS = ['#d97706', '#6366f1', '#10b981', '#f43f5e', '#a855f7', '#06b6d4', '#eab308', '#ec4899', '#84cc16', '#f97316'];

const INGREDIENT_STRUCTURE_PIE_COLORS = ['#ea580c', '#6366f1'];

type DashboardOrder = OrderHistoryEntry;

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
  const [showAllDirect, setShowAllDirect] = useState(false);
  const [showAllFranchise, setShowAllFranchise] = useState(false);
  const [showAllSelf, setShowAllSelf] = useState(false);
  const [showAllExpenseSelf, setShowAllExpenseSelf] = useState(false);
  /** 各加盟店挑選浮層；點頂端按鈕才顯示，不佔主頁版面 */
  const [franchisePickerOpen, setFranchisePickerOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin && summaryRange === 'year') {
      setSummaryRange('month');
    }
  }, [isAdmin, summaryRange]);

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
    }));
    const history = loadOrderHistory();
    const all = [...mgmt, ...history].filter((o) => roleVisible(o.actorRole, userRole));
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all;
  }, [userRole, orderTick]);

  /**
   * 「實際渲染」用的訂單清單：view-as 時限縮為該加盟主之單，其他情境同 dashboardOrders。
   * 與 view-as 對應的下方營收／支出計算皆改用此清單，確保與該加盟主自身 Dashboard 一致。
   */
  const effectiveOrders = useMemo(() => {
    if (!viewAsFranchisee) return dashboardOrders;
    return dashboardOrders.filter(
      (o) => o.actorRole === 'franchisee' && o.actorUserId === viewAsFranchisee.userId,
    );
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
    const procurementCost = stallCompleted.reduce((s, o) => {
      if (o.actorRole === 'franchisee') {
        return s + o.totalAmount;
      }
      return s + o.totalAmount;
    }, 0);
    const gross = revenue - procurementCost;
    // employee 自身視角不計流水帳；總部以加盟主視角檢視時，直接讀該加盟店流水帳（admin 權限）。
    const ledgerExpense =
      userRole === 'employee' && !viewAsFranchisee
        ? 0
        : ledgerForView
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
  }, [effectiveOrders, ledgerForView, isAdmin, summaryRange, userRole, viewAsFranchisee]);

  const topProducts = useMemo(() => {
    const completed =
      isAdmin || !nonAdminSummary
        ? effectiveOrders.filter((o) => o.status === '已完成')
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
  }, [effectiveOrders, isAdmin, nonAdminSummary]);

  const topProductsTotalRevenue = useMemo(
    () => topProducts.reduce((s, p) => s + p.revenue, 0),
    [topProducts],
  );

  const nonAdminExpenseRows = useMemo(() => {
    if (isAdmin) return [];
    // employee 自身視角不顯示流水帳支出佔比；總部以加盟主視角檢視時直接讀該店流水帳。
    if (userRole === 'employee' && !viewAsFranchisee) return [];
    const { startYmd, endYmd } = resolveRange(summaryRange);
    const byName = new Map<string, number>();
    const procurementCost = nonAdminSummary?.procurementCost ?? 0;
    if (procurementCost > 0) byName.set('批貨與自備成本', procurementCost);
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
  }, [isAdmin, summaryRange, ledgerForView, nonAdminSummary, userRole, viewAsFranchisee]);

  const adminSummaryOrders = useMemo(() => {
    if (!isAdmin) return [];
    const { startYmd, endYmd } = resolveRange(summaryRange);
    return dashboardOrders.filter((o) => {
      if (o.status !== '已完成') return false;
      const ymd0 = effectiveOrderDateYmd(o);
      return ymd0 >= startYmd && ymd0 <= endYmd;
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
        const ymd0 = effectiveOrderDateYmd(o);
        if (ymd0 >= startYmd && ymd0 <= endYmd) {
          const selfSupplied = o.selfSuppliedCostAmount ?? Math.max(0, o.totalAmount - (o.payableAmount ?? o.totalAmount));
          franchiseRevenue += Math.max(0, o.totalAmount - selfSupplied);
          let orderCost = 0;
          for (const line of o.lines) {
            const item = getSupplyItem(line.productId);
            if (isFranchiseeSelfSuppliedItem(item)) continue;
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
    return aggregateProductRevenue(
      adminSummaryOrders,
      (o) => o.actorRole === 'franchisee',
      (_o, line) => {
        const item = getSupplyItem(line.productId);
        return !isFranchiseeSelfSuppliedItem(item);
      },
    );
  }, [adminSummaryOrders, isAdmin]);

  /**
   * 各加盟店「自身」營運摘要（與加盟主自己的 Dashboard 視角一致）：
   * - 已完成訂單數：依「建單日落於本期間」計
   * - 盤點完成數：依「盤點日落於本期間」計
   * - 盤點後營收：以盤點日歸屬，採加盟主視角的零售營收
   * - 批貨成本：對應的盤點完成單之批貨應付（含自備已扣後總額）
   * - 毛利＝營收 − 批貨成本
   * - 流水帳支出：總部看不到加盟店的私帳，因此不納入
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
      procurementCost: number;
    };
    const map = new Map<string, Row>();
    for (const o of dashboardOrders) {
      if (o.actorRole !== 'franchisee') continue;

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
      });
      const franchiseeUserId = o.actorUserId ?? null;
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
          procurementCost: 0,
        } satisfies Row);

      if (isCompletedInRange) row.completedOrderCount += 1;
      if (isStallInRange) {
        row.stallCompletedCount += 1;
        row.revenue += getStallDisplaySoldAtRetail(o, HQ_STALL_VIEW) ?? 0;
        row.procurementCost += o.totalAmount;
      }
      map.set(key, row);
    }
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        gross: r.revenue - r.procurementCost,
        grossRate: pct(r.revenue - r.procurementCost, r.revenue),
      }))
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.completedOrderCount - a.completedOrderCount ||
          a.label.localeCompare(b.label, 'zh-Hant'),
      );
  }, [dashboardOrders, realIsAdmin, summaryRange]);

  return (
    <div className="space-y-6">
      {viewAsFranchisee && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="text-amber-500 shrink-0" size={28} />
            {viewAsFranchisee
              ? `${viewAsFranchisee.label} 營運概況`
              : realIsAdmin
                ? '總部營運概況'
                : '我的營運概況'}
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setFranchisePickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-900/80 border border-zinc-700 rounded-lg text-zinc-200 hover:bg-zinc-800 hover:border-amber-600/50 hover:text-amber-200 transition-colors font-medium text-xs"
              title="點此挑選一家加盟店，以該加盟主視角檢視完整營運概況"
              aria-haspopup="dialog"
              aria-expanded={franchisePickerOpen}
            >
              <Store size={14} className="shrink-0" aria-hidden />
              各加盟店概況
              {franchiseStoreBreakdown.length > 0 && (
                <span className="text-[10px] font-semibold text-amber-400 tabular-nums">
                  {franchiseStoreBreakdown.length}
                </span>
              )}
            </button>
          )}
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
                <Store size={18} className="text-amber-400" />
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
                  營收 - 批貨與自備成本 {moneyTW(nonAdminSummary?.procurementCost ?? 0)}（毛利率 {nonAdminSummary?.grossRate.toFixed(1) ?? '0.0'}%）
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
              <p className="text-2xl mt-1 text-amber-300 tabular-nums">{moneyTW(adminRangeSummary.franchiseRevenue)}</p>
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
                  可關閉本視窗後切換上方時段（本日／本週／本月／本年）試試。
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
                          <div className="grid grid-cols-2 gap-2 text-[11px] mt-1 pt-2 border-t border-zinc-800/70">
                            <div>
                              <p className="text-zinc-500">批貨成本</p>
                              <p className="text-zinc-300 tabular-nums">{moneyTW(row.procurementCost)}</p>
                            </div>
                            <div>
                              <p className="text-zinc-500">
                                毛利（{row.revenue > 0 ? `${row.grossRate.toFixed(1)}%` : '—'}）
                              </p>
                              <p
                                className={cn(
                                  'tabular-nums',
                                  row.gross >= 0 ? 'text-emerald-300' : 'text-rose-300',
                                )}
                              >
                                {moneyTW(row.gross)}
                              </p>
                            </div>
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
                    營收／成本以「盤點完成」之單依盤點日歸期；訂單數依「建單日」歸期，故兩者數量可能不同。
                    點卡片進入後可看到該加盟主的商品營收佔比、流水帳支出佔比等完整 Dashboard。
                  </p>
                </>
              )}
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
      )}

    </div>
  );
}
