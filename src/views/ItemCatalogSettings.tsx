import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Tags, Plus, Trash2 } from 'lucide-react';
import {
  CATEGORY_CHIPS,
  getBaseSupplyItem,
  getAllSupplyItems,
  defaultRetailPerPieceFromWholesale,
  type ItemCategory,
  type SupplyItem,
} from '../lib/supplyCatalog';
import { loadFranchiseeRetailByItemId, setFranchiseeRetailPieceForItem } from '../lib/franchiseeRetailState';
import { isCustomItemId, type ItemOverride } from '../lib/userCatalogState';
import { products } from '../services/apiService';
import { cn } from '../lib/utils';

async function commitBaseFromForm(
  id: string,
  p: {
    name: string;
    price: string;
    unit: string;
    tag: string;
    category: ItemCategory;
    franchiseeSelfSuppliedForPayable: boolean;
    retail: string;
  }
) {
  const b = getBaseSupplyItem(id);
  if (!b) return;
  const st = await products.catalog.loadUserCatalogState();
  const name = p.name.trim() || b.name;
  const priceN = Math.round((Number.parseFloat(p.price) || 0) * 100) / 100;
  if (priceN < 0) return;
  const unit = p.unit.trim() || b.pieceUnit;
  const tagTrim = p.tag.trim();
  const bTag = b.tag ?? '';
  const defaultR = Math.min(1_000_000, Math.round(priceN * 1.45 * 100) / 100);
  const retailParsed = Number.parseFloat(p.retail);
  const retailN = Number.isFinite(retailParsed)
    ? Math.min(1_000_000, Math.round(retailParsed * 100) / 100)
    : defaultR;
  const hadRetail = typeof st.overrides[id]?.retailPerPiece === 'number';
  const patch: ItemOverride = {};
  if (name !== b.name) patch.name = name;
  if (Math.abs(priceN - b.pricePerPiece) > 0.0001) patch.pricePerPiece = priceN;
  if (unit !== b.pieceUnit) patch.pieceUnit = unit;
  if (p.category !== b.category) patch.category = p.category;
  if (tagTrim !== bTag) {
    if (tagTrim === '') patch.tag = null;
    else patch.tag = tagTrim;
  }
  if (Boolean(st.overrides[id]?.franchiseeSelfSuppliedForPayable) !== p.franchiseeSelfSuppliedForPayable) {
    patch.franchiseeSelfSuppliedForPayable = p.franchiseeSelfSuppliedForPayable;
  }
  if (Math.abs(retailN - defaultR) < 0.0001) {
    if (hadRetail) patch.retailPerPiece = null;
  } else {
    patch.retailPerPiece = retailN;
  }
  if (Object.keys(patch).length === 0) await products.catalog.clearSupplyItemOverride(id);
  else await products.catalog.setSupplyItemOverride(id, patch);
}

/** 加盟主「本店零售價」專用寫入，與總部 `userCatalog` 的零售覆寫分庫。 */
function applyRetailForItemOnly(item: SupplyItem, retailStr: string) {
  const defaultR = defaultRetailPerPieceFromWholesale(item);
  const n = Math.min(1_000_000, Math.round((Number.parseFloat(retailStr) || 0) * 100) / 100);
  if (n < 0) return;
  const fr = loadFranchiseeRetailByItemId() as Record<string, number | undefined>;
  const hadRetail = fr[item.id] != null;
  if (Math.abs(n - defaultR) < 0.0001) {
    if (hadRetail) setFranchiseeRetailPieceForItem(item.id, null);
  } else {
    setFranchiseeRetailPieceForItem(item.id, n);
  }
}

type Props = { embedded?: boolean; retailOnly?: boolean };

export default function ItemCatalogSettings({ embedded, retailOnly }: Props) {
  const [v, setV] = useState(0);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'all' | ItemCategory>('all');
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setV((x) => x + 1);
    window.addEventListener('supplyCatalogUpdated', h);
    return () => window.removeEventListener('supplyCatalogUpdated', h);
  }, []);

  useEffect(() => {
    if (!deleteArmedId) return;
    const t = window.setTimeout(() => setDeleteArmedId(null), 8_000);
    return () => clearTimeout(t);
  }, [deleteArmedId]);

  const [st, setSt] = useState<Awaited<ReturnType<typeof products.catalog.loadUserCatalogState>> | null>(
    null,
  );
  useEffect(() => {
    void products.catalog.loadUserCatalogState().then(setSt);
  }, [v]);
  const catalogState = st ?? {
    version: 2 as const,
    overrides: {},
    hiddenBaseIds: [],
    customItems: [],
  };

  const items = useMemo(
    () => getAllSupplyItems(retailOnly ? 'franchisee' : 'headquarter'),
    [v, retailOnly]
  );
  const overrideOnly = catalogState.overrides;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (cat !== 'all' && it.category !== cat) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
    });
  }, [items, search, cat]);

  const onDeleteForId = useCallback(
    (id: string) => {
      if (deleteArmedId !== id) {
        setDeleteArmedId(id);
        return;
      }
      setDeleteArmedId(null);
      if (isCustomItemId(id)) {
        void products.catalog.removeCustomItem(id);
      } else {
        void products.catalog.clearSupplyItemOverride(id);
        void products.catalog.hideBaseItem(id);
      }
    },
    [deleteArmedId]
  );

  return (
    <div className={cn('space-y-4 max-w-5xl mx-auto', embedded ? 'pb-4' : 'pb-8')}>
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Tags className="text-amber-500 shrink-0" size={28} />
              {retailOnly ? '本店零售參考價' : '品項與單價'}
            </h2>
            <p className="text-zinc-500 mt-1 text-sm sm:text-base max-w-xl">
              {retailOnly
                ? '各店售價可能不同，僅本機可調。未自訂時以批價 × 1.45 作為參考。'
                : '僅存本機瀏覽器。'}
            </p>
          </div>
        </div>
      )}

      {!retailOnly && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-start gap-2">
          <button
            type="button"
            onClick={() => {
              void products.catalog.addCustomItem({
                name: '新品項',
                pricePerPiece: 0,
                pieceUnit: '份',
                category: 'tofu',
              });
            }}
            className="inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-xl bg-amber-600/25 border border-amber-500/50 text-amber-200 text-sm font-semibold hover:bg-amber-600/35"
          >
            <Plus size={18} />
            新增品項
          </button>
        </div>
      )}

      {!retailOnly && (
        <p className="text-[0.6875rem] text-rose-300/80">
          刪除：第一次點選後再點一次「刪除」才會生效。內建品刪除後不會再出現於叫貨清單。
        </p>
      )}
      <div className="space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            placeholder="搜尋編號或品名"
            className="w-full h-11 pl-10 pr-3 rounded-xl border-2 border-zinc-700 bg-zinc-900/80 text-sm"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id as 'all' | ItemCategory)}
              className={cn(
                'shrink-0 px-3 h-9 rounded-full text-xs font-medium border-2',
                cat === c.id
                  ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                  : 'border-zinc-700 text-zinc-500'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/30">
        {retailOnly ? (
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                <th className="py-3 px-2 font-medium w-24">編號</th>
                <th className="py-3 px-2 font-medium min-w-[7rem]">品名</th>
                <th className="py-3 px-2 font-medium w-24 text-right">批貨／份</th>
                <th className="py-3 px-2 font-medium w-28 text-right">本店零售／份</th>
                <th className="py-3 px-2 font-medium w-20">單位</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <Fragment key={it.id}>
                  <ItemRetailRow item={it} onOtherAction={() => setDeleteArmedId(null)} />
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                <th className="py-3 px-2 font-medium w-24">編號</th>
                <th className="py-3 px-2 font-medium min-w-[7rem]">品名</th>
                <th className="py-3 px-2 font-medium w-20 text-right">單價</th>
                <th className="py-3 px-2 font-medium w-24 text-right">零售／份</th>
                <th className="py-3 px-2 font-medium w-20">單位</th>
                <th className="py-3 px-2 font-medium w-32">分類</th>
                <th className="py-3 px-2 font-medium w-24 text-center">加盟主自備</th>
                <th className="py-3 px-2 font-medium min-w-[5rem]">標籤</th>
                <th className="py-3 px-2 font-medium text-right w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <Fragment key={it.id}>
                  <ItemRow
                    item={it}
                    isCustom={isCustomItemId(it.id)}
                    hasOverride={isCustomItemId(it.id) || Boolean(overrideOnly[it.id])}
                    deleteArmed={deleteArmedId === it.id}
                    onPatchBase={(f) => void commitBaseFromForm(it.id, f)}
                    onUpdateCustom={(next) => void products.catalog.updateCustomItem(it.id, next)}
                    onDeleteClick={() => onDeleteForId(it.id)}
                    onOtherAction={() => setDeleteArmedId(null)}
                  />
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {filtered.length === 0 && (
          <p className="p-6 text-center text-zinc-500 text-sm">
            {retailOnly ? '沒有符合的品項。' : '沒有符合的品項。可點「新增品項」。'}
          </p>
        )}
      </div>
    </div>
  );
}

function ItemRetailRow({
  item,
  onOtherAction,
}: {
  item: SupplyItem;
  onOtherAction: () => void;
}) {
  const refDefault = defaultRetailPerPieceFromWholesale(item);
  const [retail, setRetail] = useState('');

  useEffect(() => {
    const d = defaultRetailPerPieceFromWholesale(item);
    const v = item.retailPerPiece != null ? item.retailPerPiece : d;
    setRetail(String(v));
  }, [item.id, item.pricePerPiece, item.retailPerPiece, item.pieceUnit]);

  const onBlur = () => {
    onOtherAction();
    applyRetailForItemOnly(item, retail);
  };

  return (
    <tr className="border-b border-zinc-800/60 hover:bg-white/[0.02]">
      <td className="py-2.5 px-2 align-top">
        <div className="font-mono text-xs text-zinc-500">{item.id}</div>
        {item.retailPerPiece != null && (
          <span className="text-[0.5625rem] text-emerald-500/90 font-medium">自訂零售</span>
        )}
      </td>
      <td className="py-2.5 px-2 align-top text-zinc-200 text-sm font-medium">{item.name}</td>
      <td className="py-2.5 px-2 align-top text-right font-mono text-amber-200/90 text-sm">
        {item.pricePerPiece.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}
      </td>
      <td className="py-2.5 px-2 align-top text-right">
        <input
          value={retail}
          onChange={(e) => setRetail(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={onBlur}
          onFocus={onOtherAction}
          inputMode="decimal"
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 text-right font-mono text-emerald-300/95 text-sm"
        />
        <p className="text-[0.625rem] text-zinc-600 mt-0.5 tabular-nums">推估 {refDefault.toLocaleString()}</p>
      </td>
      <td className="py-2.5 px-2 align-top text-zinc-500 text-sm">{item.pieceUnit}</td>
    </tr>
  );
}

function ItemRow({
  item,
  isCustom,
  hasOverride,
  deleteArmed,
  onPatchBase,
  onUpdateCustom,
  onDeleteClick,
  onOtherAction,
}: {
  item: SupplyItem;
  isCustom: boolean;
  hasOverride: boolean;
  deleteArmed: boolean;
  onPatchBase: (f: {
    name: string;
    price: string;
    unit: string;
    tag: string;
    category: ItemCategory;
    franchiseeSelfSuppliedForPayable: boolean;
    retail: string;
  }) => void;
  onUpdateCustom: (next: Partial<SupplyItem> & { retailPerPiece?: number | null }) => void;
  onDeleteClick: () => void;
  onOtherAction: () => void;
}) {
  const b = getBaseSupplyItem(item.id);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.pricePerPiece));
  const [retail, setRetail] = useState(() =>
    String(
      (item.retailPerPiece != null
        ? item.retailPerPiece
        : defaultRetailPerPieceFromWholesale(item)
      ).toString()
    )
  );
  const [unit, setUnit] = useState(item.pieceUnit);
  const [tag, setTag] = useState(item.tag ?? '');
  const [category, setCategory] = useState<ItemCategory>(item.category);
  const [franchiseeSelfSuppliedForPayable, setFranchiseeSelfSuppliedForPayable] = useState(
    !!item.franchiseeSelfSuppliedForPayable
  );

  useEffect(() => {
    setName(item.name);
    setPrice(String(item.pricePerPiece));
    setRetail(
      String(
        item.retailPerPiece != null
          ? item.retailPerPiece
          : defaultRetailPerPieceFromWholesale(item)
      )
    );
    setUnit(item.pieceUnit);
    setTag(item.tag ?? '');
    setCategory(item.category);
    setFranchiseeSelfSuppliedForPayable(!!item.franchiseeSelfSuppliedForPayable);
  }, [item.id, item.name, item.pricePerPiece, item.pieceUnit, item.tag, item.category, item.retailPerPiece, item.franchiseeSelfSuppliedForPayable]);

  const doCommit = () => {
    onOtherAction();
    const priceN = Math.round((Number.parseFloat(price) || 0) * 100) / 100;
    const defaultR = Math.min(1_000_000, Math.round(priceN * 1.45 * 100) / 100);
    const retailParsed = Number.parseFloat(retail);
    const retailN = Number.isFinite(retailParsed)
      ? Math.min(1_000_000, Math.round(retailParsed * 100) / 100)
      : defaultR;
    if (isCustom) {
      const patch: Partial<SupplyItem> & { retailPerPiece?: number | null } = {
        name: name.trim() || '未命名',
        pricePerPiece: priceN,
        pieceUnit: unit.trim() || '份',
        tag: tag.trim() || undefined,
        category,
        franchiseeSelfSuppliedForPayable,
      };
      if (Math.abs(retailN - defaultR) < 0.0001) {
        if (item.retailPerPiece != null) patch.retailPerPiece = null;
      } else {
        patch.retailPerPiece = retailN;
      }
      onUpdateCustom(patch);
    } else {
      onPatchBase({ name, price, unit, tag, category, franchiseeSelfSuppliedForPayable, retail });
    }
  };

  return (
    <tr
      className={cn(
        'border-b border-zinc-800/60 hover:bg-white/[0.02]',
        deleteArmed && 'bg-rose-950/20 ring-1 ring-rose-500/20'
      )}
    >
      <td className="py-2.5 px-2 align-top">
        <div className="font-mono text-xs text-zinc-500">{item.id}</div>
        {hasOverride && <span className="text-[0.5625rem] text-amber-500/90 font-medium">已調整</span>}
      </td>
      <td className="py-2.5 px-2 align-top">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={doCommit}
          onFocus={onOtherAction}
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 text-zinc-100 text-sm"
        />
        {b && !isCustom && name.trim() !== b.name && (
          <p className="text-[0.625rem] text-zinc-600 mt-0.5">內建：{b.name}</p>
        )}
      </td>
      <td className="py-2.5 px-2 align-top text-right">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={doCommit}
          onFocus={onOtherAction}
          inputMode="decimal"
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 text-right font-mono text-amber-200 text-sm"
        />
        {b && !isCustom && (
          <p className="text-[0.625rem] text-zinc-600 mt-0.5">內建 ${b.pricePerPiece}</p>
        )}
      </td>
      <td className="py-2.5 px-2 align-top text-right">
        <input
          value={retail}
          onChange={(e) => setRetail(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={doCommit}
          onFocus={onOtherAction}
          inputMode="decimal"
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 text-right font-mono text-emerald-300/95 text-sm"
        />
        {b && !isCustom && (
          <p className="text-[0.625rem] text-zinc-600 mt-0.5">
            內建推估 {defaultRetailPerPieceFromWholesale(b).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}
          </p>
        )}
      </td>
      <td className="py-2.5 px-2 align-top">
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={doCommit}
          onFocus={onOtherAction}
          placeholder="份、兩、條…"
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-1.5 text-sm"
        />
      </td>
      <td className="py-2.5 px-2 align-top">
        <select
          value={category}
          onChange={(e) => {
            onOtherAction();
            const c = e.target.value as ItemCategory;
            setCategory(c);
            if (isCustom) onUpdateCustom({ category: c });
            else
              onPatchBase({
                name,
                price,
                unit,
                tag,
                category: c,
                franchiseeSelfSuppliedForPayable,
                retail,
              });
          }}
          onFocus={onOtherAction}
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-1 text-sm"
        >
          {CATEGORY_CHIPS.filter((x) => x.id !== 'all').map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2.5 px-2 align-top text-center">
        <input
          type="checkbox"
          checked={franchiseeSelfSuppliedForPayable}
          onChange={(e) => {
            onOtherAction();
            const checked = e.target.checked;
            setFranchiseeSelfSuppliedForPayable(checked);
            if (isCustom) onUpdateCustom({ franchiseeSelfSuppliedForPayable: checked });
            else
              onPatchBase({
                name,
                price,
                unit,
                tag,
                category,
                franchiseeSelfSuppliedForPayable: checked,
                retail,
              });
          }}
          onFocus={onOtherAction}
          className="h-4 w-4 accent-amber-500"
          title="勾選後：加盟主叫貨不計貨款，但盤點仍計營業額"
        />
      </td>
      <td className="py-2.5 px-2 align-top">
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onBlur={doCommit}
          onFocus={onOtherAction}
          placeholder="選填"
          className="w-full min-h-9 rounded-lg border border-zinc-700 bg-zinc-900/50 px-2 text-sm placeholder:text-zinc-600"
        />
      </td>
      <td className="py-2.5 px-2 align-top text-right">
        <button
          type="button"
          onClick={onDeleteClick}
          className={cn(
            'inline-flex items-center gap-1 min-h-9 px-2.5 rounded-lg border text-xs font-medium',
            deleteArmed
              ? 'border-rose-500/70 bg-rose-600/20 text-rose-200'
              : 'border-rose-900/50 text-rose-400/90 hover:bg-rose-950/30'
          )}
          title={deleteArmed ? '再按以確認刪除' : '刪除（需再按一次）'}
        >
          <Trash2 size={14} />
          刪除
        </button>
        {deleteArmed && (
          <p className="text-[0.625rem] text-rose-300/90 mt-1">再按一次刪除</p>
        )}
      </td>
    </tr>
  );
}
