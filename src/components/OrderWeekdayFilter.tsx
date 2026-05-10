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

type Props = {
  /** 已點選、要篩選的星期（空＝不篩選、顯示全部） */
  value: number[];
  onChange: (next: number[]) => void;
  className?: string;
};

/**
 * 預設不篩選；點選週幾才只顯示「訂單日期」落在該星期之訂單（可複選）。
 */
export function OrderWeekdayFilter({ value, onChange, className }: Props) {
  const set = new Set(value);
  const filtering = value.length > 0;

  const toggle = (d: IsoWeekday) => {
    if (set.has(d)) {
      onChange(value.filter((x) => x !== d).sort((a, b) => a - b));
    } else {
      onChange([...value, d].sort((a, b) => a - b));
    }
  };

  const clear = () => onChange([]);

  return (
    <div
      className={cn(
        'rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 sm:px-4',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5 text-zinc-500 min-w-0">
          <CalendarRange size={16} className="text-amber-500/80 shrink-0" />
          <span className="text-xs sm:text-sm whitespace-nowrap">建單星期</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_ISO_WEEKDAYS.map((d) => {
            const on = set.has(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                className={cn(
                  'min-w-[2.5rem] px-2 py-1 rounded-lg text-xs font-medium border transition-colors',
                  on
                    ? 'bg-amber-600/20 border-amber-500/50 text-amber-100'
                    : 'bg-zinc-950/50 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                )}
              >
                {LABELS[d]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={clear}
            className={cn(
              'ml-0.5 sm:ml-1 px-2 py-1 rounded-lg text-xs border transition-colors',
              !filtering
                ? 'border-zinc-700 text-zinc-600 cursor-default'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/80'
            )}
            disabled={!filtering}
          >
            清除
          </button>
        </div>
      </div>
    </div>
  );
}
