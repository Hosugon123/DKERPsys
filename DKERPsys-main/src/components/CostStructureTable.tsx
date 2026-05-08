import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  X,
  Search,
  ChevronLeft,
  Settings2,
  Check,
} from 'lucide-react';
import {
  COST_FIELD_KIND_LABELS,
  COST_STRUCTURE_UPDATED_EVENT,
  effectiveShrinkagePct,
  findShrinkageRateColumnId,
  itemShouldShowShrinkageDetail,
  type CostColumn,
  type CostFieldKind,
  type CostItem,
} from '../lib/costStructureStorage';
import { products } from '../services/apiService';
import {
  applyAdjacentColumnResize,
  buildDefaultCostTablePercents,
  costTableColumnSignature,
  loadCostTablePercents,
  normalizePercentsTo100,
  saveCostTablePercents,
} from '../lib/costTableLayoutStorage';
import { cn } from '../lib/utils';

const KIND_OPTIONS: CostFieldKind[] = ['currency', 'number', 'percent', 'text'];

const COST_TABLE_MIN_COL_PCT = 1.25;

function formatPctDisplay(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

function alignClassForKind(kind: CostFieldKind): string {
  return kind === 'text' ? 'text-left' : 'text-right';
}

function placeholderForKind(kind: CostFieldKind): string {
  switch (kind) {
    case 'currency':
      return '0.00';
    case 'number':
      return '0';
    case 'percent':
      return '0';
    default:
      return '—';
  }
}

/* ───────────────────── EditableCell ───────────────────── */

type EditableCellProps = {
  value: string;
  kind: CostFieldKind;
  placeholder?: string;
  onSave: (next: string) => void;
  className?: string;
  ariaLabel?: string;
};

function EditableCell({ value, kind, placeholder, onSave, className, ariaLabel }: EditableCellProps) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const commit = useCallback(() => {
    if (local !== value) onSave(local);
  }, [local, value, onSave]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        setLocal(value);
        e.currentTarget.blur();
      }
    },
    [value],
  );

  const inputMode = kind === 'text' ? 'text' : 'decimal';
  const align = alignClassForKind(kind);
  const showPrefix = kind === 'currency';
  const showSuffix = kind === 'percent';

  return (
    <div className={cn('relative flex items-center', className)}>
      {showPrefix && (
        <span className="absolute left-2 text-zinc-500 text-xs pointer-events-none">$</span>
      )}
      <input
        type="text"
        inputMode={inputMode}
        value={local}
        placeholder={placeholder ?? placeholderForKind(kind)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        aria-label={ariaLabel}
        className={cn(
          'w-full min-h-10 rounded-md border border-transparent bg-transparent px-1.5 py-2 text-base text-zinc-200 placeholder-zinc-600 sm:min-h-0 sm:py-0.5 sm:text-xs',
          'hover:border-zinc-700 focus:border-amber-600 focus:outline-none transition-colors',
          align,
          showPrefix && 'pl-5 sm:pl-5',
          showSuffix && 'pr-5 sm:pr-5',
        )}
      />
      {showSuffix && (
        <span className="absolute right-2 text-zinc-500 text-xs pointer-events-none">%</span>
      )}
    </div>
  );
}

/* ───────────────────── Modal ───────────────────── */

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="關閉"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────── ColumnDialog（新增／編輯欄位） ───────────────────── */

type ColumnDialogProps = {
  open: boolean;
  initial: CostColumn | null;
  onClose: () => void;
};

function ColumnDialog({ open, initial, onClose }: ColumnDialogProps) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CostFieldKind>('text');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? '');
    setKind(initial?.kind ?? 'text');
    setConfirmDelete(false);
  }, [open, initial]);

  const submit = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (initial) await products.cost.updateCostColumn(initial.id, { label: trimmed, kind });
    else await products.cost.addCostColumn(trimmed, kind);
    onClose();
  }, [label, kind, initial, onClose]);

  const onDelete = useCallback(async () => {
    if (!initial) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await products.cost.removeCostColumn(initial.id);
    onClose();
  }, [initial, confirmDelete, onClose]);

  return (
    <Modal open={open} title={initial ? '編輯欄位' : '新增欄位'} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-zinc-400">欄位名稱</span>
          <input
            type="text"
            value={label}
            placeholder="例：成本、批發價、漲縮率…"
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400">資料型態</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CostFieldKind)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {COST_FIELD_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[0.6875rem] text-zinc-500">
            僅影響顯示提示（$／%／純數字／文字），不影響舊資料。
          </p>
        </label>
        <div className="flex items-center justify-between pt-2">
          {initial ? (
            <button
              onClick={onDelete}
              className={cn(
                'text-xs px-3 py-2 rounded-lg border transition-colors',
                confirmDelete
                  ? 'border-rose-600 bg-rose-600/20 text-rose-300 hover:bg-rose-600/30'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800',
              )}
            >
              {confirmDelete ? '再點一次以確認刪除' : '刪除欄位'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={!label.trim()}
              className={cn(
                'text-xs px-3 py-2 rounded-lg font-medium border transition-colors',
                label.trim()
                  ? 'border-amber-600 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed',
              )}
            >
              {initial ? '儲存' : '新增'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────── ItemDialog（新增品項） ───────────────────── */

type ItemDialogProps = {
  open: boolean;
  categories: string[];
  onClose: () => void;
};

function ItemDialog({ open, categories, onClose }: ItemDialogProps) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setUnit('');
    setCategory('');
    setNote('');
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await products.cost.addCostItem({
      name: trimmed,
      unit: unit.trim(),
      category: category.trim(),
      note: note.trim(),
    });
    onClose();
  }, [name, unit, category, note, onClose]);

  return (
    <Modal open={open} title="新增品項" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-zinc-400">品名</span>
          <input
            type="text"
            value={name}
            placeholder="例：黑輪、豆皮、雞皮…"
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            autoFocus
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-zinc-400">單位</span>
            <input
              type="text"
              value={unit}
              placeholder="片、斤、條…"
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-400">類別（可空）</span>
            <input
              type="text"
              list="cost-cat-suggest"
              value={category}
              placeholder="主食肉類…"
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
            <datalist id="cost-cat-suggest">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-zinc-400">備註（可空）</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-none"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={!name.trim()}
            className={cn(
              'text-xs px-3 py-2 rounded-lg font-medium border transition-colors',
              name.trim()
                ? 'border-amber-600 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30'
                : 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed',
            )}
          >
            建立
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────── ShrinkagePanel（僅在主表漲縮率有填時顯示） ───────────────────── */

type ShrinkagePanelProps = {
  item: CostItem;
  colSpan: number;
};

function ShrinkagePanel({ item, colSpan }: ShrinkagePanelProps) {
  const eff = effectiveShrinkagePct(item);

  return (
    <tr className="bg-zinc-900/40">
      <td colSpan={colSpan} className="px-3 py-3 border-b border-zinc-800/50">
        <div className="flex flex-wrap items-end gap-4 text-xs">
          <div className="text-zinc-400 font-medium">補充紀錄 · {item.name}</div>
          <label className="flex flex-col gap-0.5">
            <span className="text-zinc-500">未滷成本（每單位）</span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={item.shrinkageRaw ?? ''}
                placeholder="例：110"
                onBlur={(e) =>
                  void products.cost.updateCostItem(item.id, { shrinkageRaw: e.target.value || null })
                }
                className="w-32 pl-5 pr-2 py-1.5 bg-zinc-950 border border-zinc-700 rounded-md text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-zinc-500">成品成本（每單位）</span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={item.shrinkageCooked ?? ''}
                placeholder="例：58.35"
                onBlur={(e) =>
                  void products.cost.updateCostItem(item.id, { shrinkageCooked: e.target.value || null })
                }
                className="w-32 pl-5 pr-2 py-1.5 bg-zinc-950 border border-zinc-700 rounded-md text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>
          </label>
          {eff !== null && (
            <p className="text-[0.6875rem] text-zinc-500 self-end pb-1">
              由未滷／成品推算約 {formatPctDisplay(eff)}（主表「漲縮率」欄仍以你填寫為準）
            </p>
          )}
          <button
            type="button"
            onClick={() =>
              void products.cost.updateCostItem(item.id, {
                shrinkageRaw: null,
                shrinkageCooked: null,
                shrinkagePctOverride: null,
                hasShrinkage: false,
              })
            }
            className="self-end pb-1 text-[0.6875rem] text-zinc-500 hover:text-rose-400 transition-colors"
          >
            清除補充紀錄
          </button>
        </div>
        <p className="text-[0.6875rem] text-zinc-600 mt-2">
          僅在已填寫主表「漲縮率」時需要此補充；未填漲縮率的品項不會出現此列。
        </p>
      </td>
    </tr>
  );
}

/* ───────────────────── 主元件 ───────────────────── */

export default function CostStructureTable() {
  const [snapshot, setSnapshot] = useState<{ columns: CostColumn[]; items: CostItem[] }>({
    columns: [],
    items: [],
  });
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [expandedShrinkageId, setExpandedShrinkageId] = useState<string | null>(null);
  const [columnDialog, setColumnDialog] = useState<{ open: boolean; column: CostColumn | null }>(
    { open: false, column: null },
  );
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [colPercents, setColPercents] = useState<number[]>([]);
  const [columnLayoutEditMode, setColumnLayoutEditMode] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<number[] | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const colSig = useMemo(() => costTableColumnSignature(snapshot.columns), [snapshot.columns]);

  useEffect(() => {
    const cols = snapshot.columns;
    const def = buildDefaultCostTablePercents(cols);
    const saved = loadCostTablePercents(cols);
    setColPercents(saved ?? def);
    setColumnLayoutEditMode(false);
    setLayoutDraft(null);
  }, [colSig]);

  const colWidthExpectedLen = 5 + snapshot.columns.length;
  const activeColPercents = useMemo(() => {
    const src =
      columnLayoutEditMode && layoutDraft && layoutDraft.length === colWidthExpectedLen
        ? layoutDraft
        : colPercents;
    if (src.length === colWidthExpectedLen) return src;
    return buildDefaultCostTablePercents(snapshot.columns);
  }, [
    columnLayoutEditMode,
    layoutDraft,
    colPercents,
    colWidthExpectedLen,
    snapshot.columns,
  ]);

  const enterColumnLayoutEdit = useCallback(() => {
    const expected = 5 + snapshot.columns.length;
    const base =
      colPercents.length === expected
        ? colPercents
        : buildDefaultCostTablePercents(snapshot.columns);
    setLayoutDraft([...base]);
    setColumnLayoutEditMode(true);
  }, [colPercents, snapshot.columns.length]);

  const confirmColumnLayoutEdit = useCallback(() => {
    if (layoutDraft && layoutDraft.length === colWidthExpectedLen) {
      const norm = normalizePercentsTo100(layoutDraft);
      setColPercents(norm);
      saveCostTablePercents(snapshot.columns, norm);
    }
    setLayoutDraft(null);
    setColumnLayoutEditMode(false);
  }, [layoutDraft, colWidthExpectedLen, snapshot.columns]);

  const cancelColumnLayoutEdit = useCallback(() => {
    setLayoutDraft(null);
    setColumnLayoutEditMode(false);
  }, []);

  const beginColumnResize = useCallback(
    (leftIndex: number, clientX: number) => {
      if (!layoutDraft || !tableWrapRef.current) return;
      const wrap = tableWrapRef.current;
      const startX = clientX;
      const startPercents = [...layoutDraft];

      const clientXFrom = (ev: globalThis.MouseEvent | globalThis.TouchEvent): number => {
        if ('touches' in ev && ev.touches.length > 0) return ev.touches[0].clientX;
        if ('changedTouches' in ev && ev.changedTouches.length > 0)
          return ev.changedTouches[0].clientX;
        return (ev as globalThis.MouseEvent).clientX;
      };

      const onMove = (ev: globalThis.Event) => {
        const me = ev as globalThis.MouseEvent | globalThis.TouchEvent;
        const w = wrap.getBoundingClientRect().width;
        if (w <= 0) return;
        const delta = ((clientXFrom(me) - startX) / w) * 100;
        setLayoutDraft(applyAdjacentColumnResize(startPercents, leftIndex, delta, COST_TABLE_MIN_COL_PCT));
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [layoutDraft],
  );

  const refresh = useCallback(async () => {
    setSnapshot(await products.cost.getSnapshot());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdate = () => {
      void refresh();
    };
    window.addEventListener(COST_STRUCTURE_UPDATED_EVENT, onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener(COST_STRUCTURE_UPDATED_EVENT, onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [refresh]);

  const categories: string[] = useMemo(() => {
    const set = new Set<string>();
    for (const it of snapshot.items) {
      if (it.category && it.category.trim()) set.add(it.category.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [snapshot.items]);

  const shrinkColId = useMemo(() => findShrinkageRateColumnId(snapshot.columns), [snapshot.columns]);

  const filteredItems: CostItem[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.items.filter((it: CostItem) => {
      if (categoryFilter && (it.category ?? '') !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        it.name,
        it.unit,
        it.category ?? '',
        it.note ?? '',
        ...Object.values(it.values),
        it.shrinkageRaw ?? '',
        it.shrinkageCooked ?? '',
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [snapshot.items, search, categoryFilter]);

  const onColumnEdit = (col: CostColumn) => setColumnDialog({ open: true, column: col });
  const onColumnAdd = () => setColumnDialog({ open: true, column: null });
  const onColumnMove = (col: CostColumn, delta: -1 | 1) => {
    void products.cost.moveCostColumn(col.id, delta);
  };

  const columnResizeHandleEl = (leftIndex: number, ariaLabel: string) =>
    columnLayoutEditMode ? (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        className="absolute right-0 top-0 bottom-0 z-20 flex w-4 -mr-2 cursor-col-resize touch-none items-center justify-center max-lg:w-7 max-lg:-mr-2.5"
        onMouseDown={(e: ReactMouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          beginColumnResize(leftIndex, e.clientX);
        }}
        onTouchStart={(e: ReactTouchEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const t = e.touches[0];
          if (t) beginColumnResize(leftIndex, t.clientX);
        }}
      >
        <span className="h-full w-0.5 max-lg:w-1 rounded-full bg-amber-500/80 hover:bg-amber-400" />
      </div>
    ) : null;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="shrink-0 flex flex-col gap-3 rounded-t-2xl border-b border-zinc-800 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="min-h-10 flex items-center">
            <h3 className="text-base font-semibold text-zinc-100">成本結構表</h3>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {!columnLayoutEditMode ? (
              <button
                type="button"
                onClick={enterColumnLayoutEdit}
                className="min-h-10 flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800 text-sm sm:w-auto"
              >
                <Settings2 size={14} /> 欄寬設定
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={confirmColumnLayoutEdit}
                  className="min-h-10 flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-amber-600 bg-amber-600/25 text-amber-200 hover:bg-amber-600/35 text-sm font-medium sm:w-auto"
                >
                  <Check size={14} /> 確認
                </button>
                <button
                  type="button"
                  onClick={cancelColumnLayoutEdit}
                  className="min-h-10 flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 text-sm sm:w-auto"
                >
                  取消
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onColumnAdd}
              disabled={columnLayoutEditMode}
              className="min-h-10 flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-sm disabled:opacity-40 disabled:pointer-events-none sm:w-auto"
            >
              <Plus size={14} /> 新增欄位
            </button>
            <button
              type="button"
              onClick={() => setItemDialogOpen(true)}
              disabled={columnLayoutEditMode}
              className="col-span-2 min-h-10 flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-amber-600 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 text-sm disabled:opacity-40 disabled:pointer-events-none sm:col-auto sm:w-auto"
            >
              <Plus size={14} /> 新增品項
            </button>
          </div>
        </div>
        {columnLayoutEditMode && (
          <p className="text-[0.6875rem] text-amber-200/90 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
            欄寬編輯模式：拖曳表頭<strong className="font-semibold">右側橘色拉桿</strong>調整相鄰兩欄比例，完成後按<strong className="font-semibold">確認</strong>儲存；取消則不套用。
          </p>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋品名、單位、類別、備註或任一欄位內容…"
            className="min-h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-8 pr-8 text-base text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none sm:min-h-0 sm:py-1.5 sm:text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                aria-label="清除搜尋"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="min-h-10 shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-base text-zinc-300 focus:border-amber-500 focus:outline-none sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            <option value="">所有類別</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {search.trim() && (
          <div className="text-[0.6875rem] text-zinc-500">
            符合「{search.trim()}」共 {filteredItems.length} 筆
          </div>
        )}
      </div>

      <p className="shrink-0 px-2 pb-1.5 pt-1 text-center text-[0.6875rem] text-amber-200/80 lg:hidden">
        下方表格可<strong className="font-semibold">左右滑動</strong>；必要時可拖曳底部橫向捲軸。
      </p>
      <div
        className="max-w-full min-w-0 flex-1 touch-pan-x overflow-x-scroll overscroll-x-contain rounded-b-2xl [-webkit-overflow-scrolling:touch] lg:overflow-x-auto"
        ref={tableWrapRef}
      >
        <table className="w-full min-w-[1000px] table-fixed border-collapse text-left lg:min-w-0">
          <colgroup>
            {activeColPercents.slice(0, 4).map((p, i) => (
              <col key={['expand', 'name', 'unit', 'category'][i]} style={{ width: `${p.toFixed(2)}%` }} />
            ))}
            {snapshot.columns.map((col, i) => (
              <col key={col.id} style={{ width: `${activeColPercents[4 + i]!.toFixed(2)}%` }} />
            ))}
            <col style={{ width: `${activeColPercents[activeColPercents.length - 1]!.toFixed(2)}%` }} />
          </colgroup>
          <thead>
            <tr className="text-zinc-500 text-[0.6875rem] uppercase border-b border-zinc-800 bg-zinc-950/50">
              <th
                className={cn(
                  'py-1.5 px-1 font-medium text-center border-b border-zinc-800',
                  columnLayoutEditMode && 'relative',
                )}
              >
                {columnResizeHandleEl(0, '調整展開欄與品名欄寬度')}
              </th>
              <th
                className={cn(
                  'py-1.5 px-1.5 font-medium text-left border-b border-zinc-800',
                  columnLayoutEditMode && 'relative',
                )}
              >
                品名
                {columnResizeHandleEl(1, '調整品名欄與單位欄寬度')}
              </th>
              <th
                className={cn(
                  'py-1.5 px-1.5 font-medium text-left border-b border-zinc-800',
                  columnLayoutEditMode && 'relative',
                )}
              >
                單位
                {columnResizeHandleEl(2, '調整單位欄與類別欄寬度')}
              </th>
              <th
                className={cn(
                  'py-1.5 px-1.5 font-medium text-left border-b border-zinc-800',
                  columnLayoutEditMode && 'relative',
                )}
              >
                類別
                {columnResizeHandleEl(3, '調整類別欄與第一個自訂欄寬度')}
              </th>
              {snapshot.columns.map((col, idx) => (
                <th
                  key={col.id}
                  className={cn(
                    'py-1.5 px-1 font-medium group border-b border-zinc-800 min-w-0',
                    alignClassForKind(col.kind),
                    columnLayoutEditMode && 'relative',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center gap-0.5 min-w-0',
                      col.kind === 'text' ? 'justify-start' : 'justify-end',
                    )}
                  >
                    <span className="min-w-0 truncate" title={col.label}>
                      {col.label}
                    </span>
                    <div
                      className={cn(
                        'flex shrink-0 transition-opacity',
                        columnLayoutEditMode ? 'opacity-30 pointer-events-none' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onColumnMove(col, -1)}
                        disabled={idx === 0}
                        className="p-0.5 text-zinc-500 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="向左移"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onColumnEdit(col)}
                        className="p-0.5 text-zinc-500 hover:text-amber-400"
                        title="編輯欄位"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onColumnMove(col, 1)}
                        disabled={idx === snapshot.columns.length - 1}
                        className="p-0.5 text-zinc-500 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="向右移"
                      >
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                  {columnResizeHandleEl(4 + idx, `調整「${col.label}」與右側欄寬度`)}
                </th>
              ))}
              <th className="py-1.5 px-1 font-medium text-center border-b border-zinc-800">操作</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {filteredItems.length === 0 && (
              <tr>
                <td
                  colSpan={4 + snapshot.columns.length + 1}
                  className="py-10 px-6 text-center text-zinc-500 text-xs"
                >
                  {snapshot.items.length === 0
                    ? '尚未建立任何品項，點右上「新增品項」開始記錄你的成本結構表。'
                    : '沒有符合的品項。'}
                </td>
              </tr>
            )}
            {filteredItems.map((item: CostItem) => {
              const expanded = expandedShrinkageId === item.id;
              const cols: CostColumn[] = snapshot.columns;
              const showDetail = itemShouldShowShrinkageDetail(item, shrinkColId);
              return (
                <Row
                  key={item.id}
                  item={item}
                  columns={cols}
                  categories={categories}
                  showShrinkageDetail={showDetail}
                  detailExpanded={expanded}
                  onToggleDetail={() =>
                    setExpandedShrinkageId((cur) => (cur === item.id ? null : item.id))
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <ColumnDialog
        open={columnDialog.open}
        initial={columnDialog.column}
        onClose={() => setColumnDialog({ open: false, column: null })}
      />
      <ItemDialog
        open={itemDialogOpen}
        categories={categories}
        onClose={() => setItemDialogOpen(false)}
      />
    </section>
  );
}

/* ───────────────────── Row（單筆品項列） ───────────────────── */

type RowProps = {
  item: CostItem;
  columns: CostColumn[];
  categories: string[];
  showShrinkageDetail: boolean;
  detailExpanded: boolean;
  onToggleDetail: () => void;
};

const Row: FC<RowProps> = ({
  item,
  columns,
  categories,
  showShrinkageDetail,
  detailExpanded,
  onToggleDetail,
}) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const detailColSpan = 4 + columns.length + 1;

  return (
    <>
      <tr className="border-b border-zinc-800/50 hover:bg-white/[0.02] transition-colors">
        <td className="py-1.5 px-1 text-center align-middle">
          {showShrinkageDetail ? (
            <button
              type="button"
              onClick={onToggleDetail}
              title={detailExpanded ? '收合補充紀錄' : '展開未滷／成品成本'}
              className="inline-flex items-center justify-center rounded-md p-1 text-amber-300/90 hover:bg-amber-600/20 transition-colors"
            >
              {detailExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="inline-block w-4" aria-hidden />
          )}
        </td>
        <td className="py-1.5 px-1.5 align-middle min-w-0">
          <EditableCell
            value={item.name}
            kind="text"
            onSave={(v) => void products.cost.updateCostItem(item.id, { name: v })}
            ariaLabel="品名"
            className="font-medium text-amber-100 min-w-0"
          />
          {item.note && (
            <div className="px-1.5 text-[0.6875rem] text-zinc-500 truncate" title={item.note}>
              {item.note}
            </div>
          )}
        </td>
        <td className="py-1.5 px-1 align-middle min-w-0">
          <EditableCell
            value={item.unit}
            kind="text"
            placeholder="片／斤…"
            onSave={(v) => void products.cost.updateCostItem(item.id, { unit: v })}
            ariaLabel="單位"
          />
        </td>
        <td className="py-1.5 px-1.5 align-middle min-w-0">
          <input
            type="text"
            list={`cat-${item.id}`}
            defaultValue={item.category ?? ''}
            placeholder="（未分類）"
            onBlur={(e) =>
              void products.cost.updateCostItem(item.id, { category: e.target.value || null })
            }
            className="min-h-10 w-full rounded-md border border-transparent bg-transparent px-1.5 py-2 text-base text-zinc-300 placeholder-zinc-600 hover:border-zinc-700 focus:border-amber-600 focus:outline-none sm:min-h-0 sm:py-0.5 sm:text-xs"
          />
          <datalist id={`cat-${item.id}`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </td>
        {columns.map((col) => (
          <td
            key={col.id}
            className={cn('py-1.5 px-1 align-middle min-w-0', alignClassForKind(col.kind))}
          >
            <EditableCell
              value={item.values[col.id] ?? ''}
              kind={col.kind}
              onSave={(v) => void products.cost.setCostItemValue(item.id, col.id, v)}
              ariaLabel={`${item.name} - ${col.label}`}
              className="min-w-0"
            />
          </td>
        ))}
        <td className="py-1.5 px-1 text-center align-middle">
          <button
            type="button"
            onClick={() => {
              if (!confirmDel) {
                setConfirmDel(true);
                window.setTimeout(() => setConfirmDel(false), 2400);
                return;
              }
              void products.cost.removeCostItem(item.id);
            }}
            title={confirmDel ? '再點一次以刪除' : '刪除品項'}
            className={cn(
              'p-1 rounded-md transition-colors',
              confirmDel
                ? 'text-rose-300 bg-rose-600/20'
                : 'text-zinc-500 hover:text-rose-400 hover:bg-rose-600/10',
            )}
          >
            <Trash2 size={16} />
          </button>
        </td>
      </tr>
      {detailExpanded && showShrinkageDetail && (
        <ShrinkagePanel item={item} colSpan={detailColSpan} />
      )}
    </>
  );
};
