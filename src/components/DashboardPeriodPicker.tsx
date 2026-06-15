import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

/** Dashboard 資料區間：本月或自訂（含選月份／起訖日） */
export type DashboardPeriodMode =
  | { kind: 'month' }
  | { kind: 'custom'; startYmd: string; endYmd: string };

export function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveCurrentMonthYmdRange(): { startYmd: string; endYmd: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startYmd: toYmdLocal(start), endYmd: toYmdLocal(today) };
}

export function normalizeYmdRangePair(startYmd: string, endYmd: string): { startYmd: string; endYmd: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
    return { startYmd, endYmd };
  }
  return startYmd <= endYmd ? { startYmd, endYmd } : { startYmd: endYmd, endYmd: startYmd };
}

/** 曆法月 1–12（year 為西元年）；結束日不晚於今日。 */
export function ymdRangeForCalendarMonth(year: number, month1to12: number): { startYmd: string; endYmd: string } {
  const m = Math.min(12, Math.max(1, Math.floor(month1to12)));
  const start = new Date(year, m - 1, 1);
  const endOfMonth = new Date(year, m, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = endOfMonth > today ? today : endOfMonth;
  return { startYmd: toYmdLocal(start), endYmd: toYmdLocal(end) };
}

export function resolveDashboardPeriodYmd(mode: DashboardPeriodMode): { startYmd: string; endYmd: string } {
  if (mode.kind === 'month') return resolveCurrentMonthYmdRange();
  return normalizeYmdRangePair(mode.startYmd, mode.endYmd);
}

export function dashboardPeriodLabel(mode: DashboardPeriodMode): string {
  if (mode.kind === 'month') return '本月';
  const { startYmd, endYmd } = resolveDashboardPeriodYmd(mode);
  if (startYmd === endYmd) return startYmd;
  return `${startYmd}～${endYmd}`;
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] as const;

function periodToggleClass(active: boolean) {
  return cn(
    'min-h-9 flex-1 rounded-lg border px-3 text-sm font-medium transition-colors',
    active
      ? 'border-amber-500/45 bg-amber-600/20 text-amber-200'
      : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-amber-600/35 hover:text-zinc-200',
  );
}

function DashboardCustomPeriodModal({
  open,
  initialStart,
  initialEnd,
  onClose,
  onConfirm,
}: {
  open: boolean;
  initialStart: string;
  initialEnd: string;
  onClose: () => void;
  onConfirm: (startYmd: string, endYmd: string) => void;
}) {
  const year = new Date().getFullYear();
  const [draftStart, setDraftStart] = useState(initialStart);
  const [draftEnd, setDraftEnd] = useState(initialEnd);
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftStart(initialStart);
    setDraftEnd(initialEnd);
    setPickedMonth(null);
  }, [open, initialStart, initialEnd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickMonth = useCallback(
    (month1to12: number) => {
      const { startYmd, endYmd } = ymdRangeForCalendarMonth(year, month1to12);
      setPickedMonth(month1to12);
      setDraftStart(startYmd);
      setDraftEnd(endYmd);
    },
    [year],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-period-modal-title"
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <h2 id="dashboard-period-modal-title" className="text-base font-medium text-zinc-100">
            自訂資料區間
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">{year} 年月份</p>
            <div className="grid grid-cols-4 gap-2">
              {MONTH_LABELS.map((label, idx) => {
                const m = idx + 1;
                const active = pickedMonth === m;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => pickMonth(m)}
                    className={cn(
                      'min-h-9 rounded-lg border text-sm transition-colors',
                      active
                        ? 'border-amber-500/50 bg-amber-600/25 text-amber-200'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-amber-600/35',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-zinc-800 pt-4">
            <p className="mb-2 text-xs font-medium text-zinc-400">或自訂日期區間</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="起始日"
                className="min-h-10 flex-1 min-w-[8.5rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-200"
                value={draftStart}
                onChange={(e) => {
                  setPickedMonth(null);
                  setDraftStart(e.target.value);
                }}
              />
              <span className="text-zinc-500 text-sm">～</span>
              <input
                type="date"
                aria-label="結束日"
                className="min-h-10 flex-1 min-w-[8.5rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-200"
                value={draftEnd}
                onChange={(e) => {
                  setPickedMonth(null);
                  setDraftEnd(e.target.value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 flex-1 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (!draftStart || !draftEnd) return;
              const { startYmd, endYmd } = normalizeYmdRangePair(draftStart, draftEnd);
              onConfirm(startYmd, endYmd);
              onClose();
            }}
            disabled={!draftStart || !draftEnd}
            className="min-h-10 flex-1 rounded-lg bg-amber-600 text-sm font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
          >
            確定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DashboardMonthCustomRangePicker({
  value,
  onChange,
  ariaLabel = '資料區間',
  className,
  stretch = false,
}: {
  value: DashboardPeriodMode;
  onChange: (next: DashboardPeriodMode) => void;
  ariaLabel?: string;
  className?: string;
  /** 按鈕均分寬度（KPI 卡內用） */
  stretch?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const resolved = resolveDashboardPeriodYmd(value);

  return (
    <div className={cn('min-w-0', className)} aria-label={ariaLabel}>
      <div className={cn('flex gap-2', stretch && 'w-full')}>
        <button
          type="button"
          aria-pressed={value.kind === 'month'}
          className={cn(periodToggleClass(value.kind === 'month'), stretch && 'flex-1')}
          onClick={() => onChange({ kind: 'month' })}
        >
          本月
        </button>
        <button
          type="button"
          aria-pressed={value.kind === 'custom'}
          className={cn(periodToggleClass(value.kind === 'custom'), stretch && 'flex-1')}
          onClick={() => setModalOpen(true)}
        >
          自訂時間
        </button>
      </div>
      {value.kind === 'custom' ? (
        <p className="mt-1.5 text-[11px] text-amber-200/80 tabular-nums truncate">
          {dashboardPeriodLabel(value)}
        </p>
      ) : null}
      <DashboardCustomPeriodModal
        open={modalOpen}
        initialStart={resolved.startYmd}
        initialEnd={resolved.endYmd}
        onClose={() => setModalOpen(false)}
        onConfirm={(startYmd, endYmd) => onChange({ kind: 'custom', startYmd, endYmd })}
      />
    </div>
  );
}
