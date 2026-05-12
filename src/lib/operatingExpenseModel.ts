import { readSession } from './authSession';
import { listSystemUsers } from './systemUsersStorage';

export type DashboardViewAsFranchiseeTarget = { userId: string; label: string };

/**
 * 是否採「加盟主視角」的營運支出公式：**批貨與自備成本 + 流水帳支出**。
 * - 加盟主本人、加盟體系員工：是。
 * - 總部以 view-as 進入某加盟主 Dashboard：是（與該加盟主自己看到的摘要一致）。
 * - 總部直營門市等非加盟視角：否（營運支出僅認列流水帳）。
 */
export function usesFranchiseeOperatingExpenseModel(opts: {
  userRole: 'admin' | 'franchisee' | 'employee';
  viewAsFranchisee: DashboardViewAsFranchiseeTarget | null | undefined;
}): boolean {
  if (opts.viewAsFranchisee) return true;
  if (opts.userRole === 'franchisee') return true;
  if (opts.userRole !== 'employee') return false;
  const s = readSession();
  if (!s || s.role !== 'employee') return false;
  const u = listSystemUsers().find((x) => x.id === s.userId);
  return (u?.employeeOrgType ?? 'hq') === 'franchisee';
}
