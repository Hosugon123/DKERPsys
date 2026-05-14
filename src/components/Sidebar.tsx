import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  ShoppingBasket,
  Receipt,
  Wallet,
  LogOut,
  Boxes,
  ListOrdered,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Database,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { applySavedNavOrder, loadNavOrderForRole, saveNavOrderForRole } from '../lib/sidebarNavOrderStorage';
import { cn } from '../lib/utils';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  userRole: string;
  isSuperAdmin: boolean;
  onLogout: () => void;
}

const adminItems = [
  { id: 'dashboard', label: '營運概況', icon: LayoutDashboard },
  { id: 'orders', label: '訂單管理', icon: ShoppingCart },
  { id: 'products', label: '產品與成本庫存', icon: Package },
  { id: 'procurement', label: '批貨與下單', icon: ShoppingBasket },
  { id: 'stallInventory', label: '攤上盤點', icon: Boxes },
  { id: 'salesRecord', label: '銷售紀錄', icon: Receipt },
  { id: 'accounting', label: '流水帳', icon: Wallet },
] as const;

const franchiseeItems = [
  { id: 'dashboard', label: '我的營運概況', icon: LayoutDashboard },
  { id: 'procurement', label: '批貨與下單', icon: ShoppingCart },
  { id: 'stallInventory', label: '攤上盤點', icon: Boxes },
  { id: 'salesRecord', label: '銷售紀錄', icon: Receipt },
  { id: 'accounting', label: '流水帳', icon: Wallet },
  { id: 'orders', label: '訂單管理', icon: ListOrdered },
] as const;

const employeeItems = [
  { id: 'orders', label: '訂單管理', icon: ListOrdered },
  { id: 'stallInventory', label: '攤上盤點', icon: Boxes },
  { id: 'salesRecord', label: '銷售紀錄', icon: Receipt },
  { id: 'accounting', label: '流水帳', icon: Wallet },
] as const;

type NavItem =
  | (typeof adminItems)[number]
  | (typeof franchiseeItems)[number]
  | (typeof employeeItems)[number];

function defaultItemsForRole(userRole: string): NavItem[] {
  if (userRole === 'admin') return [...adminItems];
  if (userRole === 'franchisee') return [...franchiseeItems];
  return [...employeeItems];
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = list.slice();
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m!);
  return next;
}

export default function Sidebar({
  currentView,
  setCurrentView,
  isOpen,
  setIsOpen,
  userRole,
  isSuperAdmin,
  onLogout,
}: SidebarProps) {
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const baseMenu = useMemo(() => defaultItemsForRole(userRole), [userRole]);

  useEffect(() => {
    setSavedOrder(loadNavOrderForRole(userRole));
  }, [userRole]);

  const menuItems = useMemo(() => {
    const merged = applySavedNavOrder(baseMenu, userRole, savedOrder);
    const seen = new Set(merged.map((item) => item.id));
    const trailing = baseMenu.filter((item) => !seen.has(item.id));
    return trailing.length > 0 ? [...merged, ...trailing] : merged;
  }, [baseMenu, userRole, savedOrder]);

  const persistNewOrder = useCallback(
    (next: NavItem[]) => {
      const ids = next.map((x) => x.id);
      saveNavOrderForRole(userRole, ids);
      setSavedOrder(ids);
    },
    [userRole]
  );

  const moveItem = useCallback(
    (from: number, to: number) => {
      if (!reorderMode) return;
      const next = arrayMove(menuItems, from, to);
      persistNewOrder(next);
    },
    [reorderMode, menuItems, persistNewOrder]
  );

  const onDragStart = (index: number) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setDragFrom(index);
  };

  const onDragEnd = () => {
    setDragFrom(null);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (toIndex: number) => (e: DragEvent) => {
    e.preventDefault();
    const from = Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!Number.isFinite(from)) return;
    moveItem(from, toIndex);
    setDragFrom(null);
  };

  return (
    <>
      <div
        role="presentation"
        aria-hidden={!isOpen}
        className={cn(
          'fixed inset-0 z-40 touch-none overscroll-none bg-black/50 md:hidden',
          isOpen ? 'block' : 'hidden',
        )}
        onClick={() => setIsOpen(false)}
      />
      <aside
        id="app-sidebar-drawer"
        className={cn(
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 flex w-64 max-md:max-w-[85vw] flex-col border-r border-zinc-800 bg-[#0f0f0f] py-6 transition-transform duration-200 ease-in-out max-md:overscroll-y-contain max-md:pl-[env(safe-area-inset-left)] md:static md:shrink-0',
          isOpen ? 'translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 px-4 mb-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/30">
            <img
              src="/brand-logo-v2.png"
              alt="達客東山鴨頭 Logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-wide">達客東山鴨頭</h1>
            <p className="text-[0.625rem] text-zinc-500 uppercase tracking-widest">職人數據管理</p>
          </div>
        </div>

        <div className="px-4 mb-2 flex items-center justify-between gap-2 min-h-8">
          {reorderMode ? (
            <>
              <p className="text-[0.6875rem] text-zinc-500 leading-snug">拖曳 <GripVertical className="inline w-3 h-3 align-text-bottom" /> 或使用箭頭；完成後點右側</p>
              <button
                type="button"
                onClick={() => {
                  setReorderMode(false);
                  setDragFrom(null);
                }}
                className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-600/20 text-amber-200 border border-amber-600/50 hover:bg-amber-600/30"
              >
                完成
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setReorderMode(true)}
              className="text-[0.6875rem] text-zinc-500 hover:text-amber-400/90 transition-colors w-full text-left"
            >
              調整導覽列順序
            </button>
          )}
        </div>

        <nav
          className="flex-1 px-2 space-y-0.5 overflow-y-auto"
          role="list"
          aria-label="主要選單"
        >
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = !reorderMode && currentView === item.id;
            if (reorderMode) {
              return (
                <div
                  key={item.id}
                  role="listitem"
                  draggable
                  onDragStart={onDragStart(index)}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDrop={onDrop(index)}
                  className={cn(
                    'flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-1.5 pr-0',
                    dragFrom === index && 'opacity-60'
                  )}
                >
                  <div
                    className="flex items-center justify-center w-8 shrink-0 text-zinc-500 cursor-grab active:cursor-grabbing touch-none"
                    title="拖曳以排序"
                  >
                    <GripVertical size={18} />
                  </div>
                  <div className="min-w-0 flex-1 flex items-center gap-2 py-1.5">
                    <Icon size={18} className="text-zinc-400 shrink-0" />
                    <span className="font-medium text-sm text-zinc-300 truncate">{item.label}</span>
                  </div>
                  <div className="flex flex-col shrink-0 border-l border-zinc-800/80 self-stretch">
                    <button
                      type="button"
                      onClick={() => moveItem(index, index - 1)}
                      disabled={index === 0}
                      className="flex-1 px-1.5 text-zinc-500 hover:text-amber-400 disabled:opacity-25 disabled:pointer-events-none"
                      aria-label={`將「${item.label}」上移`}
                    >
                      <ChevronUp size={16} className="mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, index + 1)}
                      disabled={index === menuItems.length - 1}
                      className="flex-1 px-1.5 text-zinc-500 hover:text-amber-400 disabled:opacity-25 disabled:pointer-events-none border-t border-zinc-800/50"
                      aria-label={`將「${item.label}」下移`}
                    >
                      <ChevronDown size={16} className="mx-auto" />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={item.id}
                role="listitem"
                type="button"
                onClick={() => {
                  setCurrentView(item.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200',
                  isActive
                    ? 'bg-amber-600/10 border-r-4 border-amber-600 text-amber-500'
                    : 'text-zinc-400 hover:bg-zinc-800/90'
                )}
              >
                <Icon size={20} className={isActive ? 'text-amber-500' : 'text-zinc-400'} />
                <span className="font-medium text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-shrink-0 space-y-1 border-t border-zinc-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => {
                if (reorderMode) return;
                setCurrentView('dataHub');
                setIsOpen(false);
              }}
              disabled={reorderMode}
              className={cn(
                'w-full flex items-center gap-3 p-3 transition-colors duration-200 rounded-lg',
                reorderMode && 'opacity-40 pointer-events-none',
                !reorderMode && currentView === 'dataHub'
                  ? 'bg-amber-600/10 border-r-4 border-amber-600 text-amber-500'
                  : 'text-zinc-400 hover:bg-zinc-800'
              )}
            >
              <Database
                size={20}
                className={!reorderMode && currentView === 'dataHub' ? 'text-amber-500' : 'text-zinc-400'}
              />
              <span className="font-medium">數據中心</span>
            </button>
          )}
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => {
                if (reorderMode) return;
                setCurrentView('permissions');
                setIsOpen(false);
              }}
              disabled={reorderMode}
              className={cn(
                'w-full flex items-center gap-3 p-3 transition-colors duration-200 rounded-lg',
                reorderMode && 'opacity-40 pointer-events-none',
                !reorderMode && currentView === 'permissions'
                  ? 'bg-amber-600/10 border-r-4 border-amber-600 text-amber-500'
                  : 'text-zinc-400 hover:bg-zinc-800'
              )}
            >
              <Users
                size={20}
                className={!reorderMode && currentView === 'permissions' ? 'text-amber-500' : 'text-zinc-400'}
              />
              <span className="font-medium">權限編輯</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (reorderMode) return;
              onLogout();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 p-3 text-zinc-400 hover:bg-zinc-800 transition-colors duration-200 rounded-lg disabled:opacity-40"
            disabled={reorderMode}
          >
            <LogOut size={20} className="text-zinc-400" />
            <span className="font-medium">登出系統</span>
          </button>
        </div>
      </aside>
    </>
  );
}
