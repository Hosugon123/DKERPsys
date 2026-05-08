import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  CalendarDays,
  PackagePlus,
  ClipboardList,
  X,
  Minus,
  Plus,
} from 'lucide-react';
import type { UserRole } from './Orders';
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
  listProcurementOrdersInLastNDays,
  type DaySnapshot,
} from '../lib/stallInventoryStorage';
import { orders as ordersApi, withRemoteStorageWrite } from '../services/apiService';
import type { SalesRecordDaySnapshot } from '../lib/salesRecordStorage';
import { saveSalesRecord } from '../lib/salesRecordStorage';
import { cn } from '../lib/utils';
import { StallCountOrderBadge } from '../components/StallCountOrderBadge';
import { formatSlashDateTimeFromIso, formatSlashDateTimeWithWeekdayFromIso, ymdDashToSlash } from '../lib/dateDisplay';
import { resolveOrderStoreLabel } from '../lib/orderStoreLabel';

function money(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
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
  const [dateStr, setDateStr] = useState(() => ymd(new Date()));
  const [snap, setSnap] = useState<DaySnapshot>(() => loadDay(ymd(new Date())));
  const [saveFlash, setSaveFlash] = useState(false);
  const [stallListTick, setStallListTick] = useState(0);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [stallCountConfirmOpen, setStallCountConfirmOpen] = useState(false);
  /** 本場盤點鎖定之單一叫貨單：植入帶出、盤點完成押記皆針對此單。 */
  const [viewOrderId, setViewOrderId] = useState<string>('');
  const ORDER_PICKER_SPAN = 35;

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
    return () => {
      window.removeEventListener('stallInventoryUpdated', on);
      window.removeEventListener('supplyCatalogUpdated', on);
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
    () => listProcurementOrdersInLastNDays(dateStr, ORDER_PICKER_SPAN),
    [dateStr, stallListTick]
  );

  // 有訂單時預設選清單最前一筆；盤點日或單據變更時若目前選單已無則重選
  useEffect(() => {
    if (ordersInWindow.length === 0) {
      setViewOrderId('');
      return;
    }
    setViewOrderId((prev) => {
      if (prev && ordersInWindow.some((o) => o.id === prev)) return prev;
      return ordersInWindow[0]!.id;
    });
  }, [dateStr, ordersInWindow]);

  const viewOrder = useMemo(
    () => ordersInWindow.find((o) => o.id === viewOrderId) ?? null,
    [ordersInWindow, viewOrderId]
  );

  const formatOrderTime = (iso: string) => formatSlashDateTimeWithWeekdayFromIso(iso) || iso;

  const formatStallCountStamp = (iso: string) => formatSlashDateTimeFromIso(iso) || iso;

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
        </div>
        <div className="w-full sm:w-auto grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2">
          <label className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 rounded-xl border-2 border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-300">
            <span className="inline-flex items-center gap-2 shrink-0">
              <CalendarDays size={18} className="text-amber-500" />
              <span>盤點日</span>
            </span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="min-w-0 bg-transparent text-right sm:text-left text-amber-400 font-medium focus:outline-none [color-scheme:dark]"
            />
          </label>
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
            <label className="block text-xs text-zinc-500">
              <span className="text-zinc-400">選本場要盤點的訂單</span>
              <select
                value={viewOrderId}
                onChange={(e) => setViewOrderId(e.target.value)}
                className="mt-1.5 w-full sm:max-w-xl rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-800/50"
              >
                {ordersInWindow.map((o) => (
                  <option key={o.id} value={o.id}>
                    建單 {ymdDashToSlash(ymd(new Date(o.createdAt)))} · {resolveOrderStoreLabel(o)} · {o.id.slice(0, 16)}… · {procurementStatusDisplay(o.status)}
                  </option>
                ))}
              </select>
            </label>
            {viewOrder && (
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5 text-sm text-zinc-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-zinc-400 truncate" title={viewOrder.id}>
                    {viewOrder.id}
                    {ordersInWindow.length === 1 && (
                      <span className="ml-1.5 text-zinc-500 font-sans">（期間內一筆）</span>
                    )}
                  </p>
                  <p className="text-zinc-500 text-xs mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>{formatOrderTime(viewOrder.createdAt)}</span>
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
                    <span>
                      · {resolveOrderStoreLabel(viewOrder)}
                    </span>
                  </p>
                  {viewOrder.stallCountCompletedAt && viewOrder.stallCountBasisYmd && (
                    <p className="text-[0.6875rem] text-amber-200/80 mt-1.5 pl-0.5">
                      盤點壓記：{ymdDashToSlash(viewOrder.stallCountBasisYmd)}（盤點日）· {formatStallCountStamp(viewOrder.stallCountCompletedAt)}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-zinc-400 text-sm tabular-nums">
                  $ {money(viewOrder.totalAmount)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="rounded-2xl border-2 border-amber-800/60 bg-amber-950/20 p-4 sm:p-5 grid sm:grid-cols-2 gap-4"
        role="region"
        aria-label="盤點彙總"
      >
        <div className="space-y-2 border-b sm:border-b-0 sm:border-r border-amber-900/50 pb-4 sm:pb-0 sm:pr-4">
          <p className="text-xs text-amber-300/80 uppercase tracking-wider">預估與帳面</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-zinc-500">預估金額</p>
              <p className="text-lg font-semibold text-emerald-400 tabular-nums">
                $ {money(dayKpi.estTotal)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">剩餘貨品金額</p>
              <p className="text-lg font-semibold text-emerald-400/90 tabular-nums">
                $ {money(dayKpi.remGoodsValue)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">應有營業額</p>
              <p className="text-lg font-semibold text-rose-400 tabular-nums">
                $ {money(dayKpi.shouldRevenue)}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-amber-300/80 uppercase tracking-wider">實收對帳</p>
          <div>
            <label className="text-zinc-500 text-sm">盤點後實收（當日現金／收銀）</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={snap.actualRevenue}
                onChange={(e) =>
                  setSnap((p) => ({ ...p, actualRevenue: e.target.value }))
                }
                className="w-40 min-h-[44px] rounded-lg border-2 border-zinc-600 bg-zinc-900 px-3 text-amber-100 font-mono"
                placeholder="0"
              />
              <p className="text-lg font-semibold text-emerald-400 tabular-nums">
                落差{' '}
                <span className={diff < 0 ? 'text-rose-400' : 'text-zinc-200'}>
                  {diff < 0 ? '' : '+'}${money(diff)}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40 -mx-1 px-1">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-2 py-3 font-medium">品項</th>
              <th className="px-2 py-3 font-medium whitespace-nowrap">帶出貨量</th>
              <th className="px-2 py-3 font-medium whitespace-nowrap">剩餘貨量</th>
              <th className="px-2 py-3 font-medium whitespace-nowrap">售出數量</th>
              <th className="px-2 py-3 font-medium text-right whitespace-nowrap">餘貨金額</th>
              <th className="px-2 py-3 font-medium text-right whitespace-nowrap">單價（零售）</th>
              <th className="px-2 py-3 font-medium text-right whitespace-nowrap">預估帶出價格</th>
              <th className="px-2 py-3 font-medium whitespace-nowrap">單位</th>
              <th className="px-2 py-3 font-medium text-right whitespace-nowrap">餘貨率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, c }) => (
              <tr
                key={item.id}
                className="border-b border-zinc-800/70 hover:bg-white/[0.02] text-zinc-200"
              >
                <td className="px-2 py-2.5 text-rose-300 font-medium whitespace-nowrap">
                  {item.name}
                </td>
                <td className="px-2 py-2.5 p-0">
                  <div className="flex items-center justify-end gap-0.5 max-w-[9.5rem] sm:max-w-[10.5rem]">
                    <button
                      type="button"
                      onClick={() => bumpLine(item.id, 'out', -1)}
                      disabled={num(snap.lines[item.id]?.out ?? '') <= 0}
                      className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      aria-label={`${item.name} 帶出減一`}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      value={snap.lines[item.id]?.out ?? ''}
                      onChange={(e) => setLine(item.id, 'out', e.target.value)}
                      className="w-16 sm:w-20 min-w-0 min-h-9 bg-zinc-900/80 border border-zinc-700 rounded px-1 text-amber-100 font-mono text-sm text-center"
                      inputMode="decimal"
                      aria-label={`${item.name} 帶出`}
                    />
                    <button
                      type="button"
                      onClick={() => bumpLine(item.id, 'out', 1)}
                      className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 shrink-0"
                      aria-label={`${item.name} 帶出加一`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </td>
                <td className="px-2 py-2.5 p-0">
                  <div className="flex items-center gap-1 flex-nowrap min-w-0">
                    <button
                      type="button"
                      onClick={() => bumpLine(item.id, 'remain', -1)}
                      disabled={c.remainUnfilled || num(snap.lines[item.id]?.remain ?? '') <= 0}
                      className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`${item.name} 剩餘減一`}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      value={snap.lines[item.id]?.remain ?? ''}
                      onChange={(e) => setLine(item.id, 'remain', e.target.value)}
                      placeholder="必填"
                      className={cn(
                        'w-14 min-w-0 min-h-9 bg-zinc-900/80 border rounded px-1 font-mono text-sm text-center',
                        c.remainUnfilled
                          ? 'border-amber-800/50 border-dashed text-zinc-400 placeholder:text-zinc-600'
                          : c.remain > 0
                            ? 'border-rose-800/60 text-rose-300'
                            : 'border-zinc-700 text-zinc-300'
                      )}
                      inputMode="decimal"
                      aria-label={`${item.name} 剩餘貨量`}
                    />
                    <button
                      type="button"
                      onClick={() => bumpLine(item.id, 'remain', 1)}
                      className="p-1.5 rounded border border-zinc-600 text-amber-500 hover:bg-zinc-800 shrink-0"
                      aria-label={`${item.name} 剩餘加一`}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLine(item.id, 'remain', '0')}
                      className="shrink-0 rounded border border-zinc-600 bg-zinc-800/60 px-1.5 py-1 text-[0.625rem] sm:text-xs text-zinc-400 hover:border-amber-600/50 hover:text-amber-200/90"
                    >
                      已售完
                    </button>
                  </div>
                </td>
                <td className="px-2 py-2.5 font-mono tabular-nums text-zinc-300">
                  {c.remainUnfilled ? <span className="text-zinc-600">—</span> : money(c.sold)}
                </td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-zinc-400">
                  {c.remainUnfilled ? <span className="text-zinc-600">—</span> : <>$ {money(c.remValue)}</>}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-zinc-400">
                  {estimatedRetailPerPackage(item).toLocaleString()}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-emerald-300/90">
                  $ {money(c.estPrice)}
                </td>
                <td className="px-2 py-2.5 text-zinc-500 whitespace-nowrap">{item.pieceUnit}</td>
                <td className="px-2 py-2.5 text-right text-amber-200/80 font-mono">
                  {c.remainUnfilled || c.out <= 0 ? '—' : `${c.leftRatePct.toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={requestInventoryComplete}
        className="fixed bottom-5 right-4 z-40 inline-flex items-center justify-center gap-2 min-h-[48px] px-4 sm:px-5 rounded-2xl bg-amber-600 text-zinc-950 font-semibold text-sm shadow-lg shadow-black/50 ring-2 ring-amber-400/30 hover:bg-amber-500 sm:bottom-6 sm:right-6"
        aria-label="盤點完成（與上方按鈕相同）"
      >
        <CheckCircle2 size={20} className="shrink-0" />
        盤點完成
      </button>

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
