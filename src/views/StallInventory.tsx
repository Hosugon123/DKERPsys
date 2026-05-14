import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  Boxes,
  CheckCircle2,
  PackagePlus,
  ClipboardList,
  ChevronDown,
  X,
  Minus,
  Plus,
  Wallet,
} from 'lucide-react';
import type { UserRole } from './Orders';
import { AUTH_SESSION_CHANGED_EVENT } from '../lib/authSession';
import {
  estimatedRetailPerPackage,
  getSupplyItem,
  isConsumableItem,
  pricePerPackage,
  userRoleToSupplyRetailView,
} from '../lib/supplyCatalog';
import { useSupplyCatalogItems } from '../hooks/useSupplyCatalogItems';
import { num, computeLine, aggregateStallKpis, isStallRemainEntryValid } from '../lib/stallMath';
import {
  ymd,
  loadDay,
  saveDay,
  recomputeStallOutForStallYmdAndOrder,
  computeStallOutImportBreakdown,
  listUncountedCompletedProcurementOrdersForSession,
  type DaySnapshot,
} from '../lib/stallInventoryStorage';
import { orders as ordersApi, withRemoteStorageWrite } from '../services/apiService';
import type { SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { saveSalesRecord } from '../lib/salesRecordStorage';
import { cn } from '../lib/utils';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import { LiangJinQtyHint } from '../components/LiangJinQtyHint';
import {
  formatSlashDateTimeFromIso,
  formatSlashYmdWithWeekdayFromYmd,
  formatTimeHmFromIso,
  ymdDashToSlash,
} from '../lib/dateDisplay';
import {
  displayOrderCreatedByLabel,
  displayOrderStallCountCompletedByLabel,
  effectiveOrderDateYmd,
} from '../lib/orderHistoryStorage';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';

function money(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
}

/** 數量欄旁按鈕不搶焦點；避免虛擬鍵盤收起（touch + pointer／mouse）。 */
function preventAdjacentInputBlurActivate(e: SyntheticEvent<Element>) {
  e.preventDefault();
}

/** 叫貨單內部狀態「已完成」在攤上盤點語境顯示為「已出貨」 */
function procurementStatusDisplay(s: '待出貨' | '已完成' | '已取消') {
  return s === '已完成' ? '已出貨' : s;
}

/** ±1 步進後寫入字串，不低於 0；供盤點帶出／剩餘微調。 */
function formatStallBumpedValue(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (Number.isInteger(n)) return String(n);
  const t = n.toFixed(4).replace(/\.?0+$/, '');
  return t === '' ? '0' : t;
}

export default function StallInventory({ userRole }: { userRole: UserRole }) {
  const supplyItems = useSupplyCatalogItems(userRole);
  const supplyRetailView = userRoleToSupplyRetailView(userRole);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const dateStr = useMemo(() => ymd(new Date(nowIso)), [nowIso]);
  const [snap, setSnap] = useState<DaySnapshot>(() => loadDay(ymd(new Date())));
  const [saveFlash, setSaveFlash] = useState(false);
  const [stallListTick, setStallListTick] = useState(0);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [stallCountConfirmOpen, setStallCountConfirmOpen] = useState(false);
  /** 本場盤點鎖定之單一叫貨單：植入帶出、盤點完成押記皆針對此單。 */
  const [viewOrderId, setViewOrderId] = useState<string>('');
  /** 訂單摘要＋帶出試算表預設收合，避免清單過長 */
  const [stallOrderDetailOpen, setStallOrderDetailOpen] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => {
      setNowIso(new Date().toISOString());
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    setSnap(loadDay(dateStr));
  }, [dateStr]);

  useEffect(() => {
    if (!stallCountConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStallCountConfirmOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stallCountConfirmOpen]);

  useEffect(() => {
    const on = () => {
      setStallListTick((n) => n + 1);
      setSnap(loadDay(dateStr));
    };
    window.addEventListener('stallInventoryUpdated', on);
    window.addEventListener('supplyCatalogUpdated', on);
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, on);
    return () => {
      window.removeEventListener('stallInventoryUpdated', on);
      window.removeEventListener('supplyCatalogUpdated', on);
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, on);
    };
  }, [dateStr]);

  const setLine = useCallback(
    (id: string, key: 'out' | 'remain', value: string) => {
      setSnap((prev) => ({
        ...prev,
        lines: {
          ...prev.lines,
          [id]: { ...prev.lines[id], [key]: value },
        },
      }));
    },
    []
  );

  const bumpLine = useCallback((id: string, key: 'out' | 'remain', delta: number) => {
    setSnap((prev) => {
      const cur = prev.lines[id]?.[key] ?? '';
      const n = num(String(cur));
      const next = Math.max(0, n + delta);
      return {
        ...prev,
        lines: {
          ...prev.lines,
          [id]: { ...prev.lines[id], [key]: formatStallBumpedValue(next) },
        },
      };
    });
  }, []);

  const actualNum = num(snap.actualRevenue);

  /** 盤點畫面不顯示分類「消耗品」，採買用耗材請在批貨與下單；資料仍併入同一庫，叫貨扣庫不變 */
  const stallDisplayItems = useMemo(
    () => supplyItems.filter((i) => !isConsumableItem(i)),
    [supplyItems]
  );

  const { retail: dayKpi } = useMemo(
    () =>
      aggregateStallKpis(
        stallDisplayItems.map((i) => i.id),
        (id) => snap.lines[id] ?? { out: '', remain: '' },
        (id) => getSupplyItem(id, supplyRetailView),
        { unitBasis: 'retail' }
      ),
    [snap.lines, stallDisplayItems, supplyRetailView]
  );

  const diff = actualNum - dayKpi.shouldRevenue;

  /** 供選單：盤點日起往前提煉內多店多單，依單一筆一盤 */
  const ordersInWindow = useMemo(
    () => listUncountedCompletedProcurementOrdersForSession(),
    [stallListTick]
  );

  // 有訂單時預設選清單最前一筆；單據變更時若目前選單已無則重選
  useEffect(() => {
    if (ordersInWindow.length === 0) {
      setViewOrderId('');
      return;
    }
    setViewOrderId((prev) => {
      if (prev && ordersInWindow.some((o) => o.id === prev)) return prev;
      return ordersInWindow[0]!.id;
    });
  }, [ordersInWindow]);

  useEffect(() => {
    setStallOrderDetailOpen(false);
  }, [viewOrderId]);

  const viewOrder = useMemo(
    () => ordersInWindow.find((o) => o.id === viewOrderId) ?? null,
    [ordersInWindow, viewOrderId]
  );

  /** 所選訂單 × 盤點日：參考剩餘（扣庫單據或前一日）＋本單叫貨＝實際帶出（與「植入訂單」一致） */
  const importBreakdown = useMemo(() => {
    if (!viewOrderId) return null;
    return computeStallOutImportBreakdown(dateStr, viewOrderId);
  }, [dateStr, viewOrderId, stallListTick]);

  const formatStallCountStamp = (iso: string) => formatSlashDateTimeFromIso(iso) || iso;

  const formatQtyCell = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toLocaleString('zh-TW', { maximumFractionDigits: 3 });

  const rows = useMemo(
    () =>
      stallDisplayItems.map((item) => {
        const line = snap.lines[item.id] ?? { out: '', remain: '' };
        const c = computeLine(line.out, line.remain, item, { unitBasis: 'retail' });
        return { item, c };
      }),
    [snap.lines, dateStr, stallDisplayItems]
  );

  /** 通過欄位檢查後才開啟「確認盤點完成」彈窗 */
  const requestInventoryComplete = () => {
    if (!viewOrderId) {
      setRecomputeMsg('請先從清單選一筆要盤點的訂單，盤點完成時會一併在該單壓上盤點日與時間。');
      setTimeout(() => setRecomputeMsg(null), 6000);
      return;
    }
    const missingRemainNames: string[] = [];
    for (const item of stallDisplayItems) {
      const raw = snap.lines[item.id]?.remain;
      if (!isStallRemainEntryValid(raw)) missingRemainNames.push(item.name);
    }
    if (missingRemainNames.length > 0) {
      const n = missingRemainNames.length;
      const list =
        n <= 6
          ? missingRemainNames.join('、')
          : `${missingRemainNames.slice(0, 6).join('、')} 等共 ${n} 項`;
      window.alert(
        `「剩餘貨量」尚有未正確填寫：${list}\n\n` +
          '請補齊每一列；已售完可按「已售完」帶入 0，或手動填 0 以上之數字。'
      );
      return;
    }
    setStallCountConfirmOpen(true);
  };

  /** 彈窗按「確定」後寫入：訂單押記、攤上日、銷售紀錄（歷史訂單才會顯示已盤點） */
  const commitInventoryComplete = () => {
    if (!viewOrderId) {
      setStallCountConfirmOpen(false);
      return;
    }
    const lines: DaySnapshot['lines'] = { ...snap.lines };
    for (const it of supplyItems) {
      if (!lines[it.id]) lines[it.id] = { out: '', remain: '' };
    }
    const next: DaySnapshot = { ...snap, lines };
    const completedAt = new Date().toISOString();
    const recordLines: DaySnapshot['lines'] = { ...next.lines };
    for (const it of supplyItems) {
      if (isConsumableItem(it)) delete recordLines[it.id];
    }
    const recordSnap: SalesRecordDaySnapshot = {
      lines: recordLines,
      actualRevenue: next.actualRevenue,
      updatedAt: completedAt,
      revenueGapAmount: (next.revenueGapAmount ?? '').trim(),
      revenueGapReason: (next.revenueGapReason ?? '').trim(),
      frozenRetailUnitPriceByItem: Object.fromEntries(
        stallDisplayItems.map((it) => [it.id, estimatedRetailPerPackage(it)])
      ),
      frozenWholesaleUnitPriceByItem: Object.fromEntries(
        stallDisplayItems.map((it) => [it.id, pricePerPackage(it)])
      ),
    };
    void (async () => {
      const okStamp = await ordersApi.setOrderStallCountStamp(viewOrderId, {
        basisYmd: dateStr,
        completedAt,
        snapshot: recordSnap,
      });
      if (!okStamp) {
        setStallCountConfirmOpen(false);
        setRecomputeMsg('寫入訂單押記失敗（找不到單號）。請確認訂單仍在本機。');
        setTimeout(() => setRecomputeMsg(null), 5000);
        return;
      }
      await withRemoteStorageWrite(() => {
        saveDay(dateStr, next);
        saveSalesRecord(dateStr, recordSnap);
      });
      setStallListTick((n) => n + 1);
      setStallCountConfirmOpen(false);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2500);
    })();
  };

  const onImportFromOrders = () => {
    if (!viewOrderId) {
      setRecomputeMsg('請先從清單選一筆叫貨訂單，再按「植入訂單」帶入帶出。');
      return;
    }
    void (async () => {
      const next = await withRemoteStorageWrite(() =>
        recomputeStallOutForStallYmdAndOrder(dateStr, viewOrderId, snap, { clearRemain: true })
      );
      setSnap(next);
      setStallListTick((n) => n + 1);
      setRecomputeMsg('已帶入。剩餘貨量請逐格填寫。');
      setTimeout(() => setRecomputeMsg(null), 5000);
    })();
  };

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-24">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="text-amber-500 shrink-0" size={28} />
            攤上盤點
          </h2>
          {snap.lastSavedByName && (
            <p className="text-xs text-zinc-500 mt-1">本日表單最近存檔：{snap.lastSavedByName}</p>
          )}
        </div>
        <div className="w-full sm:w-auto grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2">
          <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-300">
            <span className="text-zinc-400">盤點時間</span>
            <span className="min-w-0 text-right sm:text-left text-amber-400 font-medium tabular-nums">
              {formatSlashDateTimeFromIso(nowIso)}
            </span>
          </div>
          <button
            type="button"
            onClick={requestInventoryComplete}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-amber-600 text-zinc-950 font-semibold text-sm hover:bg-amber-500"
          >
            <CheckCircle2 size={18} />
            盤點完成
          </button>
        </div>
      </div>

      {saveFlash && <p className="text-sm text-emerald-400">已寫入。</p>}

      <div
        className="rounded-2xl border border-amber-900/50 bg-amber-950/15 p-4"
        role="region"
        aria-label="帶出依據之叫貨訂單"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-amber-200/90 flex items-center gap-2">
              <ClipboardList size={16} className="text-amber-500 shrink-0" />
              盤點之叫貨訂單
            </h3>
          </div>
          <button
            type="button"
            onClick={onImportFromOrders}
            className="shrink-0 inline-flex items-center justify-center gap-2 min-h-[40px] px-3 rounded-xl border border-amber-800/60 bg-amber-950/40 text-amber-200 text-sm font-semibold hover:bg-amber-900/50"
          >
            <PackagePlus size={16} className="text-amber-500" />
            植入訂單
          </button>
        </div>
        {recomputeMsg && <p className="text-sm text-amber-200/90 mt-3">{recomputeMsg}</p>}
        {ordersInWindow.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-3">
            此期間內沒有「已出貨」之叫貨單。請在訂單管理完成出貨後再於此盤點，或把盤點日改到有已出貨單的區間。
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block w-full text-xs text-zinc-500">
              <span className="text-zinc-400">植入訂單</span>
              <div className="relative mt-1.5 w-full">
                <ChevronDown
                  size={18}
                  className="pointer-events-none absolute right-3 top-1/2 z-[1] -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <select
                  value={viewOrderId}
                  onChange={(e) => setViewOrderId(e.target.value)}
                  className="w-full max-w-none cursor-pointer appearance-none rounded-lg border border-zinc-700 bg-zinc-950/80 py-2 pl-3 pr-10 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-800/50 box-border"
                >
                  {ordersInWindow.map((o) => (
                    <option key={o.id} value={o.id}>
                      {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(o))} ·
                      建單 {displayOrderCreatedByLabel(o)} ·
                      {resolveOrderStoreLabel(o)} ·
                      單號 {o.id} ·
                      {procurementStatusDisplay(o.status)}／{o.stallCountCompletedAt ? '已盤點' : '未盤點'}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            {viewOrder && (
              <div className="w-full rounded-lg border border-zinc-800/80 bg-zinc-950/40 overflow-hidden box-border">
                <button
                  type="button"
                  onClick={() => setStallOrderDetailOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-900/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-800/50"
                  aria-expanded={stallOrderDetailOpen}
                  aria-controls="stall-order-detail-panel"
                  aria-label={stallOrderDetailOpen ? '收合訂單明細' : '展開訂單明細'}
                >
                  <p className="text-sm text-zinc-200">訂單明細</p>
                  <ChevronDown
                    size={18}
                    className={cn(
                      'shrink-0 text-zinc-500 transition-transform self-center',
                      stallOrderDetailOpen && 'rotate-180'
                    )}
                    aria-hidden
                  />
                </button>
                <div
                  id="stall-order-detail-panel"
                  className={cn(!stallOrderDetailOpen && 'hidden')}
                >
                  <div className="px-3 pb-2.5 pt-0 text-sm text-zinc-300 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 border-t border-zinc-800/60">
                    <div className="min-w-0 pt-2">
                      <p className="font-mono text-xs text-zinc-400 truncate" title={viewOrder.id}>
                        {viewOrder.id}
                        {ordersInWindow.length === 1 && (
                          <span className="ml-1.5 text-zinc-500 font-sans">（期間內一筆）</span>
                        )}
                      </p>
                      <p className="text-zinc-500 text-xs mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span>
                          訂單日 {formatSlashYmdWithWeekdayFromYmd(effectiveOrderDateYmd(viewOrder))} ・ 下單{' '}
                          {formatTimeHmFromIso(viewOrder.createdAt)}
                        </span>
                        <span aria-hidden>·</span>
                        <span
                          className={cn(
                            'font-medium',
                            viewOrder.status === '待出貨' ? 'text-amber-400' : 'text-emerald-500/90'
                          )}
                        >
                          {procurementStatusDisplay(viewOrder.status)}
                        </span>
                        <StallCountOrderBadge
                          createdAtIso={viewOrder.createdAt}
                          stallCountCompletedAt={viewOrder.stallCountCompletedAt}
                        />
                        <span>· {resolveOrderStoreLabel(viewOrder)}</span>
                      </p>
                      <p className="text-[0.6875rem] text-zinc-500 mt-1">
                        建單者：{displayOrderCreatedByLabel(viewOrder)}
                      </p>
                      {viewOrder.stallCountCompletedAt && viewOrder.stallCountBasisYmd && (
                        <p className="text-[0.6875rem] text-amber-200/80 mt-1.5 pl-0.5">
                          {`日期:${ymdDashToSlash(viewOrder.stallCountBasisYmd)}.時間:${
                            formatTimeHmFromIso(viewOrder.stallCountCompletedAt) ||
                            formatStallCountStamp(viewOrder.stallCountCompletedAt)
                          }.盤點者:${displayOrderStallCountCompletedByLabel(viewOrder)} .`}
                        </p>
                      )}
                    </div>
                    {userRole !== 'admin' && (
                      <div className="shrink-0 text-zinc-500 text-sm tabular-nums sm:pt-2 sm:text-right">
                        批貨 $ {money(viewOrder.totalAmount)}
                      </div>
                    )}
                  </div>
                  {importBreakdown && (
                    <div className="mt-0 mx-3 mb-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 overflow-hidden">
                      <p className="px-3 py-2 text-[0.6875rem] sm:text-xs text-zinc-500 border-b border-zinc-800/80 leading-relaxed">
                        帶出試算明細（盤點日 {formatSlashYmdWithWeekdayFromYmd(dateStr)}）：
                        {importBreakdown.carrySource?.kind === 'calendar_prev_day' ? (
                          <>
                            前一日 {formatSlashYmdWithWeekdayFromYmd(importBreakdown.carrySource.prevYmd)}{' '}
                            收攤剩餘 ＋ 本單叫貨 ＝ 實際帶出
                          </>
                        ) : importBreakdown.carrySource?.kind === 'basis_order' ? (
                          <>
                            扣庫參考單{' '}
                            <span className="font-mono text-zinc-400">{importBreakdown.carrySource.orderId}</span>{' '}
                            帳上剩餘 ＋ 本單叫貨 ＝ 實際帶出
                          </>
                        ) : (
                          <>本單叫貨（未併入參考剩餘）＝ 實際帶出</>
                        )}
                        {!importBreakdown.chainsPriorStallRemain ? (
                          <span className="text-amber-200/85">
                            {' '}
                            （本單建立時未指定扣庫參考單：參考剩餘依系統以 0 計。）
                          </span>
                        ) : (
                          <span className="text-zinc-600">
                            （與「植入訂單」寫入公式一致；按該鈕即帶入下列加總）
                          </span>
                        )}
                      </p>
                      {importBreakdown.rows.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-zinc-500">
                          無販售品可列示（本單無叫貨且參考剩餘為 0），或僅含消耗品。
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[0.6875rem] sm:text-xs min-w-[520px]">
                            <thead>
                              <tr className="border-b border-zinc-800/80 text-zinc-500">
                                <th className="px-2 sm:px-3 py-2 font-medium">品項</th>
                                <th className="px-2 sm:px-3 py-2 font-medium text-right whitespace-nowrap">
                                  參考剩餘
                                </th>
                                <th className="px-2 sm:px-3 py-2 font-medium text-right whitespace-nowrap">
                                  本單叫貨
                                </th>
                                <th className="px-2 sm:px-3 py-2 font-medium text-right whitespace-nowrap text-amber-200/90">
                                  實際帶出
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {importBreakdown.rows.map((r) => (
                                <tr
                                  key={r.productId}
                                  className="border-b border-zinc-800/40 last:border-b-0 text-zinc-300"
                                >
                                  <td className="px-2 sm:px-3 py-1.5 min-w-0 max-w-[12rem] sm:max-w-none truncate sm:whitespace-normal">
                                    {r.name}
                                  </td>
                                  <td className="px-2 sm:px-3 py-1.5 text-right tabular-nums text-zinc-400">
                                    {formatQtyCell(r.prevRemain)}
                                  </td>
                                  <td className="px-2 sm:px-3 py-1.5 text-right tabular-nums">
                                    {formatQtyCell(r.orderQty)}
                                  </td>
                                  <td className="px-2 sm:px-3 py-1.5 text-right tabular-nums font-medium text-amber-200/85">
                                    {formatQtyCell(r.suggestedOut)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="rounded-xl border border-amber-800/55 bg-amber-950/20 overflow-hidden divide-y divide-amber-900/40"
        role="region"
        aria-label="盤點彙總"
      >
        <section className="p-3 sm:p-5 space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-600/35"
              aria-hidden
            >
              <ClipboardList className="text-amber-400/95" size={15} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-amber-100 tracking-wide">預估與帳面</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="rounded-lg border border-zinc-800/90 bg-black/25 px-3 py-2.5 sm:py-3">
              <p className="text-[0.65rem] sm:text-xs text-zinc-500 uppercase tracking-wide">預估金額</p>
              <p className="mt-1 text-lg sm:text-xl font-semibold text-emerald-400 tabular-nums leading-none">
                $ {money(dayKpi.estTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800/90 bg-black/25 px-3 py-2.5 sm:py-3">
              <p className="text-[0.65rem] sm:text-xs text-zinc-500 uppercase tracking-wide">
                剩餘貨品金額
              </p>
              <p className="mt-1 text-lg sm:text-xl font-semibold text-emerald-400/90 tabular-nums leading-none">
                $ {money(dayKpi.remGoodsValue)}
              </p>
            </div>
            <div className="rounded-lg border border-rose-900/45 bg-rose-950/[0.14] px-3 py-2.5 sm:py-3 ring-1 ring-rose-500/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <p className="text-[0.65rem] sm:text-xs text-rose-200/65 font-medium uppercase tracking-wide">
                應有營業額
              </p>
              <p className="mt-1 text-lg sm:text-xl font-semibold text-rose-300 tabular-nums leading-none">
                $ {money(dayKpi.shouldRevenue)}
              </p>
            </div>
          </div>
        </section>

        <section className="p-3 sm:p-5 space-y-4 sm:space-y-5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-600/35"
              aria-hidden
            >
              <Wallet className="text-amber-400/95" size={15} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-amber-100 tracking-wide">實收對帳</h3>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
            <label className="block min-w-0 flex-1 space-y-1.5 lg:max-w-[16rem]">
              <span className="text-xs font-medium text-zinc-400">實收現金</span>
              <input
                type="text"
                inputMode="decimal"
                value={snap.actualRevenue}
                onChange={(e) => setSnap((p) => ({ ...p, actualRevenue: e.target.value }))}
                className="w-full min-h-11 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-base text-amber-100 font-mono tabular-nums shadow-inner"
                placeholder="0"
                aria-describedby="stall-diff-explainer"
              />
            </label>
            <div
              id="stall-diff-explainer"
              className="flex flex-1 flex-col justify-center rounded-xl border border-amber-900/45 bg-black/35 px-3.5 py-3 sm:px-4 sm:py-4 min-h-[5.75rem]"
            >
              <p className="text-[0.65rem] sm:text-xs text-zinc-500 leading-snug">帳面落差</p>
              <p
                className={cn(
                  'mt-1.5 text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight',
                  diff < 0 ? 'text-rose-400' : diff > 0 ? 'text-emerald-400' : 'text-zinc-200',
                )}
              >
                {diff === 0 ? '$0' : `${diff < 0 ? '−' : '+'}$${money(Math.abs(diff))}`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-4 sm:items-start pt-1 border-t border-amber-900/35">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">認列金額</label>
              <input
                type="text"
                inputMode="decimal"
                value={snap.revenueGapAmount ?? ''}
                onChange={(e) => setSnap((p) => ({ ...p, revenueGapAmount: e.target.value }))}
                className="w-full min-h-10 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-amber-100 font-mono text-sm shadow-inner placeholder:text-zinc-600"
                placeholder="例：500 或 -200"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="text-xs font-medium text-zinc-400">落差原因</label>
              <textarea
                value={snap.revenueGapReason ?? ''}
                onChange={(e) => setSnap((p) => ({ ...p, revenueGapReason: e.target.value }))}
                rows={1}
                className="w-full resize-none min-h-10 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                placeholder="例：請客、食材耗損、收銀短溢、零錢誤差…"
              />
            </div>
          </div>
        </section>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40 -mx-1 px-1">
        <table className="w-full min-w-[860px] text-left text-[14px] sm:text-sm">
          <thead>
            <tr className="text-zinc-500 text-[14px] sm:text-xs border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center">品項</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">帶出貨量</th>
              <th className="pl-0 pr-1.5 sm:pl-0.5 sm:pr-2.5 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">剩餘貨量</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">售出數量</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">餘貨金額</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">單價（零售）</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">預估帶出價格</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">單位</th>
              <th className="px-1 sm:px-2 py-2.5 sm:py-3 font-medium text-center whitespace-nowrap">餘貨率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, c }) => (
              <tr
                key={item.id}
                className="border-b border-zinc-800/70 hover:bg-white/[0.02] text-zinc-200"
              >
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-rose-300 font-medium whitespace-nowrap text-[14px] sm:text-sm">
                  {item.name}
                </td>
                <td className="pl-0 pr-1.5 sm:pl-0.5 sm:pr-2.5 py-2 sm:py-2.5 p-0">
                  <div className="flex flex-col items-stretch gap-0.5 max-w-[7.2rem] sm:max-w-[10.5rem]">
                    <div className="flex items-center justify-end gap-0.5 max-w-[7.2rem] sm:max-w-[10.5rem]">
                      <button
                        type="button"
                        onPointerDown={preventAdjacentInputBlurActivate}
                        onTouchStart={preventAdjacentInputBlurActivate}
                        onClick={() => bumpLine(item.id, 'out', -1)}
                        disabled={num(snap.lines[item.id]?.out ?? '') <= 0}
                        className="inline-flex items-center justify-center h-8 w-8 sm:h-auto sm:w-auto sm:p-1.5 rounded border border-zinc-600 text-amber-500 leading-none hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                        aria-label={`${item.name} 帶出減一`}
                      >
                        <Minus size={14} className="mx-auto" />
                      </button>
                      <input
                        value={snap.lines[item.id]?.out ?? ''}
                        onChange={(e) => setLine(item.id, 'out', e.target.value)}
                        className="w-8 sm:w-20 min-w-0 h-8 sm:min-h-9 box-border bg-zinc-900/80 border border-zinc-700 rounded px-0.5 sm:px-1 text-amber-100 font-mono text-[14px] sm:text-sm leading-none text-center"
                        inputMode="decimal"
                        aria-label={`${item.name} 帶出`}
                      />
                      <button
                        type="button"
                        onPointerDown={preventAdjacentInputBlurActivate}
                        onTouchStart={preventAdjacentInputBlurActivate}
                        onClick={() => bumpLine(item.id, 'out', 1)}
                        className="inline-flex items-center justify-center h-8 w-8 sm:h-auto sm:w-auto sm:p-1.5 rounded border border-zinc-600 text-amber-500 leading-none hover:bg-zinc-800 shrink-0"
                        aria-label={`${item.name} 帶出加一`}
                      >
                        <Plus size={14} className="mx-auto" />
                      </button>
                    </div>
                    <LiangJinQtyHint
                      liangQty={c.out}
                      pieceUnit={item.pieceUnit}
                      className="text-[10px] text-zinc-500 text-center"
                    />
                  </div>
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 p-0">
                  <div className="flex flex-col items-stretch gap-0.5 min-w-0">
                    <div className="flex items-center gap-0.5 sm:gap-1 flex-nowrap min-w-0">
                      <button
                        type="button"
                        onPointerDown={preventAdjacentInputBlurActivate}
                        onTouchStart={preventAdjacentInputBlurActivate}
                        onClick={() => bumpLine(item.id, 'remain', -1)}
                        disabled={c.remainUnfilled || num(snap.lines[item.id]?.remain ?? '') <= 0}
                        className="inline-flex items-center justify-center h-8 w-8 sm:h-auto sm:w-auto sm:p-1.5 rounded border border-zinc-600 text-amber-500 leading-none hover:bg-zinc-800 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label={`${item.name} 剩餘減一`}
                      >
                        <Minus size={14} className="mx-auto" />
                      </button>
                      <input
                        value={snap.lines[item.id]?.remain ?? ''}
                        onChange={(e) => setLine(item.id, 'remain', e.target.value)}
                        placeholder="必填"
                        className={cn(
                          'w-8 sm:w-16 min-w-0 h-8 sm:min-h-9 box-border bg-zinc-900/80 border rounded px-0.5 sm:px-1 font-mono text-[11px] sm:text-[19px] leading-none text-center placeholder:text-[10px] sm:placeholder:text-[13px]',
                          c.remainUnfilled
                            ? 'border-amber-800/50 border-dashed text-zinc-400 placeholder:text-zinc-600'
                            : c.remain > 0
                              ? 'border-rose-800/60 text-rose-300'
                              : 'border-zinc-700 text-zinc-300',
                        )}
                        inputMode="decimal"
                        aria-label={`${item.name} 剩餘貨量`}
                      />
                      <button
                        type="button"
                        onPointerDown={preventAdjacentInputBlurActivate}
                        onTouchStart={preventAdjacentInputBlurActivate}
                        onClick={() => bumpLine(item.id, 'remain', 1)}
                        className="inline-flex items-center justify-center h-8 w-8 sm:h-auto sm:w-auto sm:p-1.5 rounded border border-zinc-600 text-amber-500 leading-none hover:bg-zinc-800 shrink-0"
                        aria-label={`${item.name} 剩餘加一`}
                      >
                        <Plus size={14} className="mx-auto" />
                      </button>
                      <button
                        type="button"
                        onPointerDown={preventAdjacentInputBlurActivate}
                        onTouchStart={preventAdjacentInputBlurActivate}
                        onClick={() => setLine(item.id, 'remain', '0')}
                        className="shrink-0 h-8 rounded border border-zinc-600 bg-zinc-800/60 px-1 sm:px-1.5 py-0 sm:py-1 text-[14px] sm:text-xs leading-none text-zinc-400 hover:border-amber-600/50 hover:text-amber-200/90"
                      >
                        已售完
                      </button>
                    </div>
                    {!c.remainUnfilled && (
                      <LiangJinQtyHint
                        liangQty={c.remain}
                        pieceUnit={item.pieceUnit}
                        className="text-[10px] text-zinc-500 text-center w-full"
                      />
                    )}
                  </div>
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center font-mono tabular-nums text-zinc-300 text-[14px] sm:text-sm">
                  {c.remainUnfilled ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <span className="inline-flex flex-wrap items-center justify-center gap-x-0.5">
                      {money(c.sold)}
                      <LiangJinQtyHint liangQty={c.sold} pieceUnit={item.pieceUnit} className="text-[10px] sm:text-xs" />
                    </span>
                  )}
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center font-mono tabular-nums text-zinc-400 text-[14px] sm:text-sm">
                  {c.remainUnfilled ? <span className="text-zinc-600">—</span> : <>$ {money(c.remValue)}</>}
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center font-mono text-zinc-400 text-[14px] sm:text-sm">
                  {estimatedRetailPerPackage(item).toLocaleString()}
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center font-mono text-emerald-300/90 text-[14px] sm:text-sm">
                  $ {Math.round(c.estPrice).toLocaleString()}
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center text-zinc-500 whitespace-nowrap text-[14px] sm:text-sm">{item.pieceUnit}</td>
                <td className="px-1 sm:px-2 py-2 sm:py-2.5 text-center text-amber-200/80 font-mono text-[14px] sm:text-sm">
                  {c.remainUnfilled || c.out <= 0 ? '—' : `${c.leftRatePct.toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="fixed bottom-4 z-40 inset-x-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:left-auto sm:max-w-md sm:w-[min(28rem,calc(100vw-3rem))]"
        aria-label="實收對帳與盤點完成"
      >
        <div className="w-full rounded-2xl border border-amber-500/40 bg-zinc-950/95 backdrop-blur-md shadow-2xl shadow-black/60 ring-1 ring-amber-500/20 p-2 sm:p-2.5 flex flex-col gap-1.5">
          <div className="flex w-full items-stretch justify-between gap-2 sm:gap-2">
            <label
              className="flex min-w-0 flex-1 items-stretch rounded-xl border border-zinc-700 bg-zinc-900/80 overflow-hidden focus-within:border-amber-500/60 focus-within:ring-1 focus-within:ring-amber-500/30"
              title="盤點後實收：當日現金／收銀實收金額。與上方「實收對帳」欄位連動。"
            >
              <span className="px-2 sm:px-2.5 py-2 text-[11px] sm:text-xs text-amber-300 font-medium flex items-center gap-1 whitespace-nowrap border-r border-zinc-700/80 bg-zinc-900/60 shrink-0">
                <Wallet size={14} className="text-amber-500 shrink-0" aria-hidden />
                實收
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={snap.actualRevenue}
                onChange={(e) => setSnap((p) => ({ ...p, actualRevenue: e.target.value }))}
                placeholder="0"
                aria-label="盤點後實收金額"
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-amber-100 font-mono text-sm sm:text-base tabular-nums focus:outline-none placeholder:text-zinc-600"
              />
            </label>
            <button
              type="button"
              onClick={requestInventoryComplete}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[48px] px-3 sm:px-4 rounded-xl bg-amber-600 text-zinc-950 font-semibold text-sm hover:bg-amber-500 active:scale-[0.98] ring-1 ring-amber-400/40 self-stretch"
              aria-label="盤點完成（與上方按鈕相同）"
            >
              <CheckCircle2 size={18} className="shrink-0" />
              盤點完成
            </button>
          </div>
          {snap.actualRevenue.trim() !== '' && (
            <p className="text-[10.5px] sm:text-[11px] text-zinc-500 px-1 leading-snug tabular-nums">
              應有 ${money(dayKpi.shouldRevenue)}・落差{' '}
              <span
                className={cn(
                  'font-medium',
                  diff < 0 ? 'text-rose-400' : diff > 0 ? 'text-emerald-300' : 'text-zinc-300',
                )}
              >
                {diff === 0 ? '$0' : `${diff < 0 ? '−' : '+'}$${money(Math.abs(diff))}`}
              </span>
            </p>
          )}
        </div>
      </div>

      {stallCountConfirmOpen && viewOrder && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stall-count-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStallCountConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 sm:p-6 animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="stall-count-confirm-title" className="text-lg font-bold text-zinc-100">
                  確認送出盤點完成？
                </h3>
                <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                  按下「確定送出」後，會將本筆盤點寫入
                  <span className="text-zinc-200"> 銷售紀錄</span>，並在
                  <span className="text-zinc-200"> 歷史訂單</span> 的此筆單上顯示
                  <span className="text-amber-300/90"> 已盤點</span>。此步驟無法在此處還原。
                </p>
                <p className="text-xs text-zinc-500 mt-3 font-mono break-all" title={viewOrder.id}>
                  單號 {viewOrder.id}
                </p>
                <p className="text-sm text-amber-200/80 mt-1">
                  盤點日 {ymdDashToSlash(dateStr)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStallCountConfirmOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 shrink-0"
                aria-label="關閉"
              >
                <X size={22} />
              </button>
            </div>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setStallCountConfirmOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-zinc-600 text-zinc-300 text-sm font-medium hover:bg-zinc-800/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={commitInventoryComplete}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-amber-500 text-zinc-950 text-sm font-bold hover:bg-amber-400"
              >
                確定送出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
