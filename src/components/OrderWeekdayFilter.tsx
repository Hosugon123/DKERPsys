import { CalendarRange } from 'lucide-react';
import { ALL_ISO_WEEKDAYS, type IsoWeekday } from '../lib/dateDisplay';
import { cn } from '../lib/utils';

const LABELS: Record<IsoWeekday, string> = {
  1: '週一',
  2: '週二',
  3: '週三',
  4: '週四',
  5: '週五',
  6: '週六',
  7: '週日',
};

const SELECT_CLASS =
  'accounting-form-date-input box-border h-9 min-h-0 min-w-0 flex-1 max-w-full rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-2.5 py-0 text-sm leading-tight text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50 focus:border-amber-600/40 [color-scheme:dark]';

type Props = {
  /** 已點選、要篩選的星期（空＝不篩選、顯示全部） */
  value: number[];
  onChange: (next: number[]) => void;
  className?: string;
};

/**
 * 建單星期篩選：下拉選單（單選），預設全部；較按鈕列省垂直空間，適合手機。
 */
export function OrderWeekdayFilter({ value, onChange, className }: Props) {
  const selected = value.length === 1 ? value[0]! : null;

  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-zinc-800/90 bg-zinc-900/40 px-2 py-1.5 sm:px-2.5',
        className,
      )}
    >
      <CalendarRange size={15} className="text-amber-500/80 shrink-0" aria-hidden />
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">建單星期</span>
        <select
          aria-label="建單星期篩選"
          value={selected === null ? '' : String(selected)}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onChange([]);
            else onChange([Number(v)]);
          }}
          className={SELECT_CLASS}
        >
          <option value="">全部</option>
          {ALL_ISO_WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {LABELS[d]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
