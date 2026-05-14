import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Wallet, CalendarDays, Pencil, Trash2, X, Search } from 'lucide-react';
import type { UserRole } from './Orders';
import { useAccountingLedger } from '../hooks/useAccountingLedger';
import {
  ACCOUNTING_CATEGORIES,
  FOOD_EXPENSE_CATEGORY,
  MARINADE_EXPENSE_CATEGORY,
  MAIN_INGREDIENT_SUBS,
  SEASONING_SUBS,
  isCurrentIngredientSubOption,
  isCurrentMarinadeSubOption,
  isValidIngredientSubForEntry,
  isValidMarinadeSubForEntry,
  canSaveIngredientSubWhenEditing,
  canSaveMarinadeSubWhenEditing,
  ledgerEntryHasMarinadeTag,
  ledgerEntryHasMisplacedSeasoningUnderFood,
  type AccountingCategory,
  type AccountingFlowType,
  type AccountingLedgerEntry,
} from '../lib/accountingLedgerStorage';
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

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 本週一至週日（依本機曆法，週一為一週起始） */
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

/** 取得 YYYY-MM 當月首日與末日（YYYY-MM-DD） */
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

/** 僅保留數字與單一小數點 */
function sanitizeMoneyInput(raw: string): string {
  let t = raw.replace(/[^\d.]/g, '');
  const firstDot = t.indexOf('.');
  if (firstDot !== -1) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '');
  }
  return t;
}

function parseMoneyAmount(sanitized: string): number {
  if (sanitized === '' || sanitized === '.') return NaN;
  const n = Number.parseFloat(sanitized);
  return Number.isFinite(n) ? n : NaN;
}

function money(n: number) {
  return n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function MainIngredientSubcategorySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const showLegacyOptgroup = Boolean(value) && !isCurrentIngredientSubOption(value);

  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} className={className}>
      <option value="">請選擇子類別</option>
      <optgroup label="主食材進貨">
        {MAIN_INGREDIENT_SUBS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
      {showLegacyOptgroup ? (
        <optgroup label="目前紀錄（滷料子項請改列「滷料」大項）">
          <option value={value}>{value}</option>
        </optgroup>
      ) : null}
    </select>
  );
}

function MarinadeSubcategorySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const showLegacyOptgroup = Boolean(value) && !isCurrentMarinadeSubOption(value);

  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} className={className}>
      <option value="">請選擇子類別</option>
      <optgroup label="滷料配料">
        {SEASONING_SUBS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
      {showLegacyOptgroup ? (
        <optgroup label="目前紀錄（無子類整筆或舊字串）">
          <option value={value}>{value || '（無）'}</option>
        </optgroup>
      ) : null}
    </select>
  );
}

const EMPTY_CATEGORY = '' as const;
const EMPTY_SUB = '';

const dateInputClass =
  'w-full rounded-xl bg-zinc-950/80 border border-zinc-700/80 pl-10 pr-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50 focus:border-amber-600/40 [color-scheme:dark]';

/** 支出明細列內之日期範圍（精簡高度） */
const rangeDateInputClass =
  'h-9 min-w-0 w-[124px] sm:w-[136px] rounded-lg bg-zinc-950/90 border border-amber-900/40 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/60 [color-scheme:dark] shrink-0';

export default function Accounting({ userRole }: { userRole: UserRole }) {
  const { entries, add, update, remove } = useAccountingLedger();

  const defaultRange = useMemo(() => monthBoundsFromYm(currentYm()), []);
  const [rangeStart, setRangeStart] = useState(defaultRange.start);
  const [rangeEnd, setRangeEnd] = useState(defaultRange.end);
  const [quickPreset, setQuickPreset] = useState<DateQuickPreset | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [dateYmd, setDateYmd] = useState(todayYmd);
  const [flowType, setFlowType] = useState<AccountingFlowType>('expense');
  const [category, setCategory] = useState<AccountingCategory | typeof EMPTY_CATEGORY>(EMPTY_CATEGORY);
  const [subCategory, setSubCategory] = useState('');
  const [note, setNote] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [editingEntry, setEditingEntry] = useState<AccountingLedgerEntry | null>(null);
  const [editDateYmd, setEditDateYmd] = useState('');
  const [editFlowType, setEditFlowType] = useState<AccountingFlowType>('expense');
  const [editCategory, setEditCategory] = useState<AccountingCategory | typeof EMPTY_CATEGORY>(EMPTY_CATEGORY);
  const [editSubCategory, setEditSubCategory] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAmountRaw, setEditAmountRaw] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const rangeBounds = useMemo(() => {
    if (!rangeStart || !rangeEnd) return { lo: '', hi: '' };
    return rangeStart <= rangeEnd ? { lo: rangeStart, hi: rangeEnd } : { lo: rangeEnd, hi: rangeStart };
  }, [rangeStart, rangeEnd]);

  const dateFiltered = useMemo(() => {
    if (!rangeBounds.lo || !rangeBounds.hi) return entries;
    return entries.filter((e) => e.dateYmd >= rangeBounds.lo && e.dateYmd <= rangeBounds.hi);
  }, [entries, rangeBounds.lo, rangeBounds.hi]);

  const trimmedQuery = searchQuery.trim().toLocaleLowerCase('zh-Hant');

  const filtered = useMemo(() => {
    if (!trimmedQuery) return dateFiltered;
    return dateFiltered.filter((e) => {
      const flowLabel = e.flowType === 'income' ? '收入' : '支出';
      const haystack = [
        e.category,
        e.subCategory ?? '',
        e.note,
        flowLabel,
        ymdDashToSlash(e.dateYmd),
        e.dateYmd,
        String(e.amount),
        Math.round(e.amount).toString(),
      ]
        .join(' ')
        .toLocaleLowerCase('zh-Hant');
      return haystack.includes(trimmedQuery);
    });
  }, [dateFiltered, trimmedQuery]);

  const periodTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of filtered) {
      if (e.flowType === 'income') income += e.amount;
      else expense += e.amount;
    }
    return { income, expense, net: income - expense };
  }, [filtered]);

  const categoryOptions = useMemo(
    () =>
      flowType === 'income'
        ? ACCOUNTING_CATEGORIES.filter(
            (c) => c !== FOOD_EXPENSE_CATEGORY && c !== MARINADE_EXPENSE_CATEGORY
          )
        : [...ACCOUNTING_CATEGORIES],
    [flowType]
  );

  const editCategoryOptions = useMemo(
    () =>
      editFlowType === 'income'
        ? ACCOUNTING_CATEGORIES.filter(
            (c) => c !== FOOD_EXPENSE_CATEGORY && c !== MARINADE_EXPENSE_CATEGORY
          )
        : [...ACCOUNTING_CATEGORIES],
    [editFlowType]
  );

  const resetForm = useCallback(() => {
    setDateYmd(todayYmd());
    setFlowType('expense');
    setCategory(EMPTY_CATEGORY);
    setSubCategory(EMPTY_SUB);
    setNote('');
    setAmountRaw('');
    setFormError(null);
  }, []);

  const clearDateFilter = useCallback(() => {
    setQuickPreset(null);
    const { start, end } = monthBoundsFromYm(currentYm());
    setRangeStart(start);
    setRangeEnd(end);
  }, []);

  const showAllDateRange = useCallback(() => {
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

  /** 含今日在內連續 30 天 */
  const applyQuick30Days = useCallback(() => {
    const end = todayYmd();
    setRangeEnd(end);
    setRangeStart(addDaysToYmd(end, -29));
    setQuickPreset('30d');
  }, []);

  const openEdit = (row: AccountingLedgerEntry) => {
    setEditingEntry(row);
    setEditDateYmd(row.dateYmd);
    setEditFlowType(row.flowType);
    setEditCategory(row.category);
    setEditSubCategory(row.subCategory ?? EMPTY_SUB);
    setEditNote(row.note);
    setEditAmountRaw(String(row.amount));
    setEditError(null);
  };

  const closeEdit = () => {
    setEditingEntry(null);
    setEditError(null);
  };

  useEffect(() => {
    if (!editingEntry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingEntry]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!category) {
      setFormError('請先選擇類別。');
      return;
    }

    const amt = parseMoneyAmount(amountRaw.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError('請輸入大於 0 的有效金額。');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
      setFormError('日期格式不正確。');
      return;
    }

    if (category === FOOD_EXPENSE_CATEGORY) {
      if (!isValidIngredientSubForEntry(subCategory)) {
        setFormError('請選擇有效的食材子類別（主食材進貨）。');
        return;
      }
    }
    if (category === MARINADE_EXPENSE_CATEGORY) {
      if (!isValidMarinadeSubForEntry(subCategory)) {
        setFormError('請選擇有效的滷料子類別；滷料為獨立大項，不列在食材支出內。');
        return;
      }
    }

    await add({
      dateYmd,
      flowType,
      category,
      subCategory:
        category === FOOD_EXPENSE_CATEGORY || category === MARINADE_EXPENSE_CATEGORY
          ? subCategory
          : undefined,
      note,
      amount: amt,
    });
    resetForm();
  };

  const onEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    setEditError(null);

    if (!editCategory) {
      setEditError('請先選擇類別。');
      return;
    }

    const amt = parseMoneyAmount(editAmountRaw.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      setEditError('請輸入大於 0 的有效金額。');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDateYmd)) {
      setEditError('日期格式不正確。');
      return;
    }

    if (editCategory === FOOD_EXPENSE_CATEGORY) {
      if (!canSaveIngredientSubWhenEditing(editSubCategory, editingEntry.subCategory)) {
        setEditError('請選擇有效的食材子類別。');
        return;
      }
    }
    if (editCategory === MARINADE_EXPENSE_CATEGORY) {
      if (!canSaveMarinadeSubWhenEditing(editSubCategory, editingEntry.subCategory)) {
        setEditError('請選擇有效的滷料子類別，或保留原整筆紀錄。');
        return;
      }
    }

    await update(editingEntry.id, {
      dateYmd: editDateYmd,
      flowType: editFlowType,
      category: editCategory,
      subCategory:
        editCategory === FOOD_EXPENSE_CATEGORY || editCategory === MARINADE_EXPENSE_CATEGORY
          ? editSubCategory
          : undefined,
      note: editNote,
      amount: amt,
    });
    closeEdit();
  };

  const onDelete = async (row: AccountingLedgerEntry) => {
    const ok = window.confirm(
      `確定要刪除此筆流水帳嗎？\n${ymdDashToSlash(row.dateYmd)} · ${row.category} · $${money(row.amount)}\n此操作無法復原。`
    );
    if (!ok) return;
    await remove(row.id);
    if (editingEntry?.id === row.id) closeEdit();
  };

  const onAmountChange = (v: string) => {
    setAmountRaw(sanitizeMoneyInput(v));
  };

  const onEditAmountChange = (v: string) => {
    setEditAmountRaw(sanitizeMoneyInput(v));
  };

  return (
    <div className="space-y-6 pb-24 max-w-[900px] mx-auto">
      <div>
        <div className="flex items-center gap-2 text-amber-500/90 mb-1">
          <Wallet size={22} className="shrink-0" />
          <span className="text-sm font-medium tracking-wide">非訂單類</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="text-amber-500 shrink-0" size={28} />
          流水帳
        </h2>
        {userRole === 'employee' ? (
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed rounded-xl border border-zinc-700/70 bg-zinc-950/50 px-4 py-3">
            您目前為店員身分：此處<strong className="text-zinc-200">僅會顯示由您本人登記</strong>
            的流水帳紀錄；其他同仁建立的項目不會出現於此。未標記登記者之舊資料亦不會在此列出。您仍可在此新增、修改或刪除自己的紀錄。
          </p>
        ) : null}
      </div>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 backdrop-blur-sm shadow-xl shadow-black/20 p-5 md:p-6">
        <h3 className="text-lg font-semibold text-zinc-200 mb-4">新增紀錄</h3>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <CalendarDays size={14} className="text-amber-600/80" />
                日期
              </span>
              <div className="relative">
                <CalendarDays
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600/70 pointer-events-none"
                  aria-hidden
                />
                <input
                  type="date"
                  value={dateYmd}
                  onChange={(ev) => setDateYmd(ev.target.value)}
                  className={dateInputClass}
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">收支類型</span>
              <div className="flex rounded-xl border border-zinc-700/80 overflow-hidden p-0.5 bg-zinc-950/60">
                {(
                  [
                    { id: 'expense' as const, label: '支出' },
                    { id: 'income' as const, label: '收入' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setFlowType(opt.id);
                      if (
                        opt.id === 'income' &&
                        (category === FOOD_EXPENSE_CATEGORY || category === MARINADE_EXPENSE_CATEGORY)
                      ) {
                        setCategory(EMPTY_CATEGORY);
                        setSubCategory(EMPTY_SUB);
                      }
                    }}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium rounded-lg transition-colors',
                      flowType === opt.id
                        ? 'bg-amber-600/25 text-amber-200 border border-amber-600/40'
                        : 'text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <label className="block space-y-1.5 sm:col-span-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">類別</span>
              <select
                value={category}
                onChange={(ev) => {
                  const v = ev.target.value;
                  const next = v === '' ? EMPTY_CATEGORY : (v as AccountingCategory);
                  setCategory(next);
                  setSubCategory(EMPTY_SUB);
                }}
                className={cn(
                  'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                  !category ? 'border-amber-700/50' : 'border-zinc-700/80'
                )}
              >
                <option value="">請選擇類別</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 sm:col-span-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">金額</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="僅限數字"
                value={amountRaw}
                onChange={(ev) => onAmountChange(ev.target.value)}
                className="w-full rounded-xl bg-zinc-950/80 border border-zinc-700/80 px-3 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-600/50"
              />
            </label>
          </div>

          {category === FOOD_EXPENSE_CATEGORY && flowType === 'expense' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">子類別（主食材進貨）</span>
              <MainIngredientSubcategorySelect
                value={subCategory}
                onChange={setSubCategory}
                className={cn(
                  'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                  !subCategory ? 'border-amber-700/50' : 'border-zinc-700/80'
                )}
              />
              <p className="text-[0.625rem] text-zinc-600">
                僅主食材進貨（COGS）。糖、醬油等滷汁成本請另選大項「滷料」，勿列在食材支出。
              </p>
            </label>
          )}

          {category === MARINADE_EXPENSE_CATEGORY && flowType === 'expense' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">子類別（滷料配料）</span>
              <MarinadeSubcategorySelect
                value={subCategory}
                onChange={setSubCategory}
                className={cn(
                  'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                  !subCategory ? 'border-amber-700/50' : 'border-zinc-700/80'
                )}
              />
              <p className="text-[0.625rem] text-zinc-600">
                滷料為獨立支出大項，與「食材支出」分開；會計入儀表板滷汁成本。
              </p>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">備註</span>
            <textarea
              rows={2}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="選填"
              className="w-full rounded-xl bg-zinc-950/80 border border-zinc-700/80 px-3 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-600/50 resize-y min-h-[72px]"
            />
          </label>

          {formError && (
            <p className="text-sm text-red-400/90" role="alert">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit"
              disabled={
                !category ||
                (category === FOOD_EXPENSE_CATEGORY &&
                  flowType === 'expense' &&
                  !isValidIngredientSubForEntry(subCategory)) ||
                (category === MARINADE_EXPENSE_CATEGORY &&
                  flowType === 'expense' &&
                  !isValidMarinadeSubForEntry(subCategory))
              }
              className={cn(
                'px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                category &&
                  !(
                    (category === FOOD_EXPENSE_CATEGORY &&
                      flowType === 'expense' &&
                      !isValidIngredientSubForEntry(subCategory)) ||
                    (category === MARINADE_EXPENSE_CATEGORY &&
                      flowType === 'expense' &&
                      !isValidMarinadeSubForEntry(subCategory))
                  )
                  ? 'bg-amber-600 text-white hover:bg-amber-500 shadow-lg shadow-amber-900/20'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              )}
            >
              新增紀錄
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-5 py-2.5 rounded-xl text-sm font-medium border border-zinc-600/80 text-zinc-300 hover:bg-zinc-800/80"
            >
              清除表單
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-amber-900/20 bg-zinc-900/35 backdrop-blur-sm shadow-xl shadow-black/20 p-4 md:p-5">
        <div className="flex flex-col gap-3 mb-4">
          {/* 手機：篩選在上；md+：標題在左、篩選在右 */}
          <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-start md:justify-between md:gap-x-4 md:gap-y-2">
            <div className="order-2 md:order-1 w-full min-w-0 md:w-auto md:max-w-full md:shrink-0">
              <h3 className="text-lg font-semibold text-zinc-200">支出明細</h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-zinc-500 leading-snug">
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0 tabular-nums">
                  {rangeBounds.lo && rangeBounds.hi ? (
                    <>
                      <span className="whitespace-nowrap">{ymdDashToSlash(rangeBounds.lo)}</span>
                      <span className="text-zinc-600">～</span>
                      <span className="whitespace-nowrap">{ymdDashToSlash(rangeBounds.hi)}</span>
                    </>
                  ) : (
                    <span>全部紀錄</span>
                  )}
                </span>
                <span className="text-zinc-600" aria-hidden>
                  ·
                </span>
                <span className="min-w-0">
                  {trimmedQuery
                    ? `符合「${searchQuery.trim()}」共 ${filtered.length} 筆 / 期間 ${dateFiltered.length} 筆`
                    : `共 ${filtered.length} 筆`}
                </span>
              </div>
            </div>

            <div
              className="order-1 md:order-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-lg border border-amber-900/35 bg-zinc-950/60 px-2 py-1.5 shrink-0"
              role="group"
              aria-label="日期範圍篩選"
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
                onClick={clearDateFilter}
                className="h-9 px-2 rounded-lg text-[0.6875rem] font-medium border border-zinc-600/70 text-zinc-400 hover:bg-zinc-800/90 hover:text-zinc-200 hover:border-amber-800/45 transition-colors whitespace-nowrap"
              >
                清除篩選
              </button>
              <button
                type="button"
                onClick={showAllDateRange}
                className="h-9 px-2 rounded-lg text-[0.6875rem] font-medium border border-amber-800/45 text-amber-200/85 bg-amber-950/25 hover:bg-amber-950/40 transition-colors whitespace-nowrap"
              >
                顯示全部
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600/70 pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(ev) => setSearchQuery(ev.target.value)}
              placeholder="搜尋類別、子類別、備註、金額或日期…"
              aria-label="搜尋支出明細"
              className="w-full h-9 rounded-lg bg-zinc-950/80 border border-zinc-700/80 pl-9 pr-9 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/60"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80"
                aria-label="清除搜尋"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 px-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 text-[0.6875rem]">
            <span className="text-zinc-500 shrink-0">{trimmedQuery ? '搜尋結果' : '所選期間'}</span>
            <span className="text-emerald-400/95 tabular-nums">
              收入 <span className="text-emerald-200 font-medium">${money(periodTotals.income)}</span>
            </span>
            <span className="text-zinc-600">|</span>
            <span className="text-rose-400/95 tabular-nums">
              支出 <span className="text-rose-200 font-medium">${money(periodTotals.expense)}</span>
            </span>
            <span className="text-zinc-600">|</span>
            <span
              className={cn(
                'tabular-nums font-medium',
                periodTotals.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
              )}
            >
              小計 ${money(periodTotals.net)}
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded-xl">
            {trimmedQuery
              ? `沒有符合「${searchQuery.trim()}」的紀錄`
              : '此日期範圍內尚無紀錄'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="支出明細列表">
            {filtered.map((row) => (
              <li
                key={row.id}
                className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950 px-3 py-3"
              >
                <div className="shrink-0 text-xs text-zinc-500 tabular-nums w-[88px]">
                  {ymdDashToSlash(row.dateYmd)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-[0.625rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md',
                        row.flowType === 'income'
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : 'bg-rose-900/45 text-rose-200'
                      )}
                    >
                      {row.flowType === 'income' ? '收入' : '支出'}
                    </span>
                    <span className="text-sm font-medium text-zinc-200">{row.category}</span>
                    {(row.category === FOOD_EXPENSE_CATEGORY || row.category === MARINADE_EXPENSE_CATEGORY) &&
                    row.subCategory ? (
                      <span className="text-xs text-zinc-500">· {row.subCategory}</span>
                    ) : null}
                    {ledgerEntryHasMarinadeTag(row) ? (
                      <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded-md border border-amber-500/55 bg-amber-950/50 text-amber-300 shadow-sm shadow-amber-950/30">
                        滷料
                      </span>
                    ) : null}
                    {ledgerEntryHasMisplacedSeasoningUnderFood(row) ? (
                      <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-md border border-rose-500/45 bg-rose-950/40 text-rose-300">
                        滷料誤列食材
                      </span>
                    ) : null}
                  </div>
                  {row.note ? <p className="text-xs text-zinc-500 mt-1 break-words">{row.note}</p> : null}
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2 sm:shrink-0">
                  <span
                    className={cn(
                      'text-base font-semibold tabular-nums sm:min-w-[100px] sm:text-right',
                      row.flowType === 'income' ? 'text-emerald-300' : 'text-rose-200'
                    )}
                  >
                    {row.flowType === 'income' ? '+' : '−'}${money(row.amount)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="p-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-700/50 transition-colors"
                      title="編輯"
                      aria-label={`編輯 ${row.category}`}
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(row)}
                      className="p-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-900/50 transition-colors"
                      title="刪除"
                      aria-label={`刪除 ${row.category}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingEntry && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-edit-title"
            className="w-full max-w-md rounded-2xl border border-amber-900/35 bg-zinc-900 shadow-2xl shadow-black/50 p-5 md:p-6 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 id="accounting-edit-title" className="text-lg font-semibold text-zinc-100">
                編輯流水帳
              </h3>
              <button
                type="button"
                onClick={closeEdit}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                aria-label="關閉"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={onEditSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-amber-600/80" />
                  日期
                </span>
                <div className="relative">
                  <CalendarDays
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600/70 pointer-events-none"
                    aria-hidden
                  />
                  <input
                    type="date"
                    value={editDateYmd}
                    onChange={(ev) => setEditDateYmd(ev.target.value)}
                    className={dateInputClass}
                  />
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">收支類型</span>
                <div className="flex rounded-xl border border-zinc-700/80 overflow-hidden p-0.5 bg-zinc-950/60">
                  {(
                    [
                      { id: 'expense' as const, label: '支出' },
                      { id: 'income' as const, label: '收入' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setEditFlowType(opt.id);
                        if (
                          opt.id === 'income' &&
                          (editCategory === FOOD_EXPENSE_CATEGORY ||
                            editCategory === MARINADE_EXPENSE_CATEGORY)
                        ) {
                          setEditCategory(EMPTY_CATEGORY);
                          setEditSubCategory(EMPTY_SUB);
                        }
                      }}
                      className={cn(
                        'flex-1 py-2 text-sm font-medium rounded-lg transition-colors',
                        editFlowType === opt.id
                          ? 'bg-amber-600/25 text-amber-200 border border-amber-600/40'
                          : 'text-zinc-400 hover:text-zinc-200'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">類別</span>
                <select
                  value={editCategory}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    const next = v === '' ? EMPTY_CATEGORY : (v as AccountingCategory);
                    setEditCategory(next);
                    setEditSubCategory(EMPTY_SUB);
                  }}
                  className={cn(
                    'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                    !editCategory ? 'border-amber-700/50' : 'border-zinc-700/80'
                  )}
                >
                  <option value="">請選擇類別</option>
                  {editCategoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              {editCategory === FOOD_EXPENSE_CATEGORY && editFlowType === 'expense' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">子類別（主食材進貨）</span>
                  <MainIngredientSubcategorySelect
                    value={editSubCategory}
                    onChange={setEditSubCategory}
                    className={cn(
                      'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                      !editSubCategory ? 'border-amber-700/50' : 'border-zinc-700/80'
                    )}
                  />
                </label>
              )}

              {editCategory === MARINADE_EXPENSE_CATEGORY && editFlowType === 'expense' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">子類別（滷料配料）</span>
                  <MarinadeSubcategorySelect
                    value={editSubCategory}
                    onChange={setEditSubCategory}
                    className={cn(
                      'w-full rounded-xl bg-zinc-950/80 border px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50',
                      !editSubCategory ? 'border-amber-700/50' : 'border-zinc-700/80'
                    )}
                  />
                </label>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">金額</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAmountRaw}
                  onChange={(ev) => onEditAmountChange(ev.target.value)}
                  className="w-full rounded-xl bg-zinc-950/80 border border-zinc-700/80 px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">備註</span>
                <textarea
                  rows={2}
                  value={editNote}
                  onChange={(ev) => setEditNote(ev.target.value)}
                  className="w-full rounded-xl bg-zinc-950/80 border border-zinc-700/80 px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50 resize-y min-h-[72px]"
                />
              </label>

              {editError && (
                <p className="text-sm text-red-400/90" role="alert">
                  {editError}
                </p>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={
                    !editCategory ||
                    (editCategory === FOOD_EXPENSE_CATEGORY &&
                      editFlowType === 'expense' &&
                      !canSaveIngredientSubWhenEditing(editSubCategory, editingEntry.subCategory)) ||
                    (editCategory === MARINADE_EXPENSE_CATEGORY &&
                      editFlowType === 'expense' &&
                      !canSaveMarinadeSubWhenEditing(editSubCategory, editingEntry.subCategory))
                  }
                  className={cn(
                    'px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                    editCategory &&
                      !(
                        (editCategory === FOOD_EXPENSE_CATEGORY &&
                          editFlowType === 'expense' &&
                          !canSaveIngredientSubWhenEditing(editSubCategory, editingEntry.subCategory)) ||
                        (editCategory === MARINADE_EXPENSE_CATEGORY &&
                          editFlowType === 'expense' &&
                          !canSaveMarinadeSubWhenEditing(editSubCategory, editingEntry.subCategory))
                      )
                      ? 'bg-amber-600 text-white hover:bg-amber-500'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  )}
                >
                  儲存變更
                </button>
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium border border-zinc-600/80 text-zinc-300 hover:bg-zinc-800/80"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
