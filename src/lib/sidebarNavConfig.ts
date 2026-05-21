import { applySavedNavOrder, loadNavOrderForRole } from './sidebarNavOrderStorage';

/** 主選單 view id（不含數據中心、權限編輯等底部固定項） */
export type MainNavId =
  | 'dashboard'
  | 'orders'
  | 'products'
  | 'procurement'
  | 'stallInventory'
  | 'salesRecord'
  | 'accounting';

const ADMIN_NAV_IDS: MainNavId[] = [
  'dashboard',
  'orders',
  'products',
  'procurement',
  'stallInventory',
  'salesRecord',
  'accounting',
];

const FRANCHISEE_NAV_IDS: MainNavId[] = [
  'dashboard',
  'procurement',
  'stallInventory',
  'salesRecord',
  'accounting',
  'orders',
];

const EMPLOYEE_NAV_IDS: MainNavId[] = ['orders', 'stallInventory', 'salesRecord', 'accounting'];

export function getDefaultMainNavIdsForRole(userRole: string): MainNavId[] {
  if (userRole === 'admin') return [...ADMIN_NAV_IDS];
  if (userRole === 'franchisee') return [...FRANCHISEE_NAV_IDS];
  return [...EMPLOYEE_NAV_IDS];
}

/** 依本機儲存順序排列後的主選單 id 列表（與 Sidebar 顯示一致） */
export function getOrderedMainNavIdsForRole(userRole: string): MainNavId[] {
  const defaults = getDefaultMainNavIdsForRole(userRole);
  const saved = loadNavOrderForRole(userRole);
  const ordered = applySavedNavOrder(
    defaults.map((id) => ({ id })),
    userRole,
    saved,
  );
  return ordered.map((x) => x.id);
}

/** 登入或重新整理後應開啟的主選單第一頁 */
export function getDefaultLandingViewForRole(userRole: string): MainNavId {
  return getOrderedMainNavIdsForRole(userRole)[0] ?? 'dashboard';
}
