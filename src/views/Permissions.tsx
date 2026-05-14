import { UserPlus, Search, ShieldAlert, Store, Users, Edit, KeyRound, X, Hash, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserRole } from './Orders';
import { accounts, storeSettings } from '../services/apiService';
import type { EmployeeOrgType, SystemUser, SystemUserRole, SystemUserStatus } from '../lib/systemUsersStorage';
import { SYSTEM_USERS_UPDATED_EVENT } from '../lib/systemUsersStorage';
import { SUPER_ADMIN_LOGIN_ID } from '../lib/authConstants';
import { isSuperAdminSession } from '../lib/authSession';
import { cn } from '../lib/utils';

function roleLabel(r: SystemUserRole): string {
  switch (r) {
    case 'admin':
      return 'BOSS';
    case 'franchisee':
      return '加盟主';
    case 'employee':
      return '員工';
  }
}

function statusLabel(s: SystemUserStatus): string {
  return s === 'active' ? '啟用中' : '停權';
}

function employeeAffiliationLabel(user: SystemUser, users: SystemUser[]): string {
  if (user.role !== 'employee') return '';
  if (user.employeeOrgType === 'franchisee') {
    const boss = users.find((x) => x.id === user.parentFranchiseeUserId);
    return boss ? `員工（${boss.name} 名下）` : '員工（加盟主名下）';
  }
  return '員工（總部直營）';
}

function avatarChar(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const cp = [...t][0];
  return cp ?? '?';
}

function isPrimarySuperUser(u: SystemUser | null | undefined): boolean {
  return Boolean(u?.loginId && u.loginId.toLowerCase() === SUPER_ADMIN_LOGIN_ID.toLowerCase());
}

type RoleFilter = 'all' | SystemUserRole;

/** 刪除二次確認用：以開啟刪除流程當下的系統紀錄為準（不受表單草稿欄位影響） */
type DeleteConfirmSnapshot = {
  userId: string;
  name: string;
  loginId: string;
  email: string;
};

function normalizeDeleteInputLogin(s: string): string {
  return s.trim().toLowerCase();
}

function normalizeDeleteInputEmail(s: string): string {
  return s.trim().toLowerCase();
}

function deleteConfirmMatches(snapshot: DeleteConfirmSnapshot, rawInput: string): boolean {
  const input = rawInput.trim();
  if (!input) return false;
  if (snapshot.loginId && normalizeDeleteInputLogin(input) === normalizeDeleteInputLogin(snapshot.loginId)) {
    return true;
  }
  if (input === snapshot.name.trim()) {
    return true;
  }
  if (snapshot.email && normalizeDeleteInputEmail(input) === normalizeDeleteInputEmail(snapshot.email)) {
    return true;
  }
  return false;
}

export default function Permissions({
  userRole,
  sessionLoginId,
}: {
  userRole: UserRole;
  sessionLoginId: string;
}) {
  const isSuperAdmin = isSuperAdminSession(sessionLoginId);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editing, setEditing] = useState<SystemUser | null>(null);
  const [storeDraft, setStoreDraft] = useState('001');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState<SystemUserRole>('franchisee');
  const [addEmployeeOrgType, setAddEmployeeOrgType] = useState<EmployeeOrgType>('hq');
  const [addParentFranchiseeUserId, setAddParentFranchiseeUserId] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addStoreLabel, setAddStoreLabel] = useState('');
  const [addOrderStoreCode, setAddOrderStoreCode] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<SystemUserRole>('employee');
  const [editEmployeeOrgType, setEditEmployeeOrgType] = useState<EmployeeOrgType>('hq');
  const [editParentFranchiseeUserId, setEditParentFranchiseeUserId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStoreLabel, setEditStoreLabel] = useState('');
  const [editOrderStoreCode, setEditOrderStoreCode] = useState('');
  const [editStatus, setEditStatus] = useState<SystemUserStatus>('active');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSnapshot, setDeleteSnapshot] = useState<DeleteConfirmSnapshot | null>(null);
  const [addLoginId, setAddLoginId] = useState('');
  const [addInitialPassword, setAddInitialPassword] = useState('');
  const [editLoginId, setEditLoginId] = useState('');
  const [pwdResetFor, setPwdResetFor] = useState<SystemUser | null>(null);
  const [pwdResetNew, setPwdResetNew] = useState('');
  const [pwdResetNew2, setPwdResetNew2] = useState('');
  const [pwdResetErr, setPwdResetErr] = useState<string | null>(null);
  const [pwdResetBusy, setPwdResetBusy] = useState(false);

  const isEditingPrimarySuper = useMemo(() => isPrimarySuperUser(editing), [editing]);

  const refreshUsers = useCallback(async () => {
    setListLoading(true);
    try {
      const list = await accounts.listUsers();
      setUsers(list);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  useEffect(() => {
    const onUsers = () => void refreshUsers();
    window.addEventListener(SYSTEM_USERS_UPDATED_EVENT, onUsers);
    return () => window.removeEventListener(SYSTEM_USERS_UPDATED_EVENT, onUsers);
  }, [refreshUsers]);

  useEffect(() => {
    void storeSettings.getStoreCode3().then(setStoreDraft);
  }, []);

  useEffect(() => {
    const on = () => void storeSettings.getStoreCode3().then(setStoreDraft);
    window.addEventListener('storeCodeUpdated', on);
    return () => window.removeEventListener('storeCodeUpdated', on);
  }, []);

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const franchisees = users.filter((u) => u.role === 'franchisee').length;
    const employees = users.filter((u) => u.role === 'employee').length;
    const hqEmployees = users.filter((u) => u.role === 'employee' && (u.employeeOrgType ?? 'hq') === 'hq').length;
    const franchiseeEmployees = users.filter(
      (u) => u.role === 'employee' && (u.employeeOrgType ?? 'hq') === 'franchisee',
    ).length;
    return { total, admins, franchisees, employees, hqEmployees, franchiseeEmployees };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.loginId ?? '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))
      );
    });
  }, [users, search, roleFilter]);

  const franchiseeOptions = useMemo(() => users.filter((u) => u.role === 'franchisee'), [users]);

  const openAddModal = () => {
    setAddError(null);
    setAddName('');
    setAddRole('franchisee');
    setAddEmployeeOrgType('hq');
    setAddParentFranchiseeUserId('');
    setAddPhone('');
    setAddEmail('');
    setAddStoreLabel('');
    setAddOrderStoreCode('');
    setAddLoginId('');
    setAddInitialPassword('');
    setIsAddModalOpen(true);
  };

  const closeEditModal = () => {
    setEditing(null);
    setDeleteArmed(false);
    setDeleteConfirmText('');
    setDeleteSnapshot(null);
    setEditError(null);
  };

  const openEdit = (u: SystemUser) => {
    setEditError(null);
    setDeleteArmed(false);
    setDeleteConfirmText('');
    setDeleteSnapshot(null);
    setEditing(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditEmployeeOrgType(u.employeeOrgType ?? 'hq');
    setEditParentFranchiseeUserId(u.parentFranchiseeUserId ?? '');
    setEditPhone(u.phone);
    setEditEmail(u.email);
    setEditStoreLabel(u.storeLabel ?? '');
    setEditOrderStoreCode(u.orderStoreCode ?? '');
    setEditStatus(u.status);
    setEditLoginId(u.loginId ?? '');
  };

  const submitAdd = async () => {
    if (!isSuperAdmin) return;
    setAddError(null);
    if (!addLoginId.trim()) {
      setAddError('請填寫登入帳號。');
      return;
    }
    if (!addInitialPassword.trim() || addInitialPassword.length < 4) {
      setAddError('請設定至少 4 碼的初始密碼。');
      return;
    }
    setAddSaving(true);
    try {
      await accounts.createUser({
        name: addName,
        role: addRole,
        email: addEmail,
        phone: addPhone,
        loginId: addLoginId.trim(),
        initialPassword: addInitialPassword,
        employeeOrgType: addRole === 'employee' ? addEmployeeOrgType : undefined,
        parentFranchiseeUserId:
          addRole === 'employee' && addEmployeeOrgType === 'franchisee' ? addParentFranchiseeUserId : undefined,
        storeLabel: addStoreLabel.trim() || undefined,
        orderStoreCode: addRole === 'franchisee' ? addOrderStoreCode : undefined,
      });
      setIsAddModalOpen(false);
      await refreshUsers();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : '新增失敗');
    } finally {
      setAddSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!isSuperAdmin) return;
    if (!isEditingPrimarySuper && !editLoginId.trim()) {
      setEditError('請填寫登入帳號。');
      return;
    }
    setEditError(null);
    setEditSaving(true);
    try {
      await accounts.updateUser(editing.id, {
        name: editName,
        role: editRole,
        loginId: isEditingPrimarySuper ? SUPER_ADMIN_LOGIN_ID : editLoginId.trim(),
        email: editEmail,
        phone: editPhone,
        status: editStatus,
        employeeOrgType: editRole === 'employee' ? editEmployeeOrgType : undefined,
        parentFranchiseeUserId:
          editRole === 'employee' && editEmployeeOrgType === 'franchisee' ? editParentFranchiseeUserId : undefined,
        storeLabel: editStoreLabel,
        ...(editRole === 'franchisee' ? { orderStoreCode: editOrderStoreCode } : {}),
      });
      closeEditModal();
      await refreshUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '更新失敗');
    } finally {
      setEditSaving(false);
    }
  };

  const removeEditingUser = async () => {
    if (!editing || !isSuperAdmin) return;
    if (!deleteArmed) {
      setDeleteConfirmText('');
      setDeleteSnapshot({
        userId: editing.id,
        name: editing.name,
        loginId: (editing.loginId ?? '').trim(),
        email: editing.email,
      });
      setDeleteArmed(true);
      return;
    }
    const snap = deleteSnapshot;
    if (!snap || snap.userId !== editing.id) {
      setEditError('刪除確認狀態已過期，請關閉後重新開啟編輯，再按一次「刪除此帳號」。');
      setDeleteArmed(false);
      setDeleteSnapshot(null);
      setDeleteConfirmText('');
      return;
    }
    if (!deleteConfirmMatches(snap, deleteConfirmText)) {
      setEditError(
        '確認文字不符：請輸入與下方「登入帳號」「使用者名稱」「電子信箱」三者之一完全相同的內容（登入帳號不分大小寫；名稱與信箱需與紀錄一致）。',
      );
      return;
    }
    setEditError(null);
    setEditSaving(true);
    try {
      const ok = await accounts.removeUser(snap.userId);
      if (!ok) {
        setEditError('刪除失敗：找不到此帳號或資料已變更，請關閉視窗後重新整理再試。');
        return;
      }
      closeEditModal();
      await refreshUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setEditSaving(false);
    }
  };

  const onSaveStoreCode = () => void storeSettings.setStoreCode3(storeDraft);

  const submitPwdReset = async () => {
    if (!pwdResetFor?.loginId) {
      setPwdResetErr(
        isSuperAdmin
          ? '此使用者尚未設定登入帳號，請先於「編輯」中補上。'
          : '此使用者尚未設定登入帳號，請聯絡主要超級管理員於權限編輯中補上。',
      );
      return;
    }
    if (isPrimarySuperUser(pwdResetFor) && !isSuperAdmin) {
      setPwdResetErr('主要超級管理員（dk001）登入密碼僅能由該帳號本人變更，或由具超管身分之帳號重設。');
      return;
    }
    setPwdResetErr(null);
    if (pwdResetNew !== pwdResetNew2) {
      setPwdResetErr('兩次新密碼輸入不一致。');
      return;
    }
    if (pwdResetNew.length < 4) {
      setPwdResetErr('新密碼至少需 4 個字元。');
      return;
    }
    setPwdResetBusy(true);
    try {
      await accounts.setUserPassword(pwdResetFor.loginId, pwdResetNew);
      setPwdResetFor(null);
      setPwdResetNew('');
      setPwdResetNew2('');
    } catch (e) {
      setPwdResetErr(e instanceof Error ? e.message : '重設失敗');
    } finally {
      setPwdResetBusy(false);
    }
  };

  if (userRole !== 'admin') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-16 text-center">
        <ShieldAlert className="mb-4 text-amber-500" size={48} />
        <p className="text-lg font-semibold text-[#f5f2ed]">無權限瀏覽此頁面</p>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          僅具 BOSS（系統管理員）身分可進入帳號與密碼管理；加盟主與員工請洽店內管理員。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-amber-500 shrink-0" size={28} />
            權限設定
          </h2>
          <p className="text-zinc-500 mt-1">
            管理系統使用者帳號、角色配置與存取權限。
            {!isSuperAdmin ? ' 您目前可檢視名冊並重設他人登入密碼；新增／刪除帳號與編輯使用者資料僅限主要超級管理員。' : ''}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={openAddModal}
            className="px-5 py-2.5 bg-zinc-800 border border-zinc-700 text-amber-500 rounded-lg hover:bg-zinc-700 transition-colors font-medium flex items-center gap-2 self-start sm:self-auto text-sm"
          >
            <UserPlus size={18} /> 新增加盟主 / 員工
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-amber-800/50 bg-amber-950/25 px-4 py-3 sm:px-5 sm:py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Hash className="shrink-0 text-amber-500/90 mt-0.5" size={20} />
          <div>
            <p className="text-sm font-semibold text-amber-100/90">本機店號（總部／直營）</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              BOSS 建單與直營員工叫貨之訂單前綴（3 碼）。加盟店請於各<strong className="text-zinc-400">加盟主帳號</strong>內設定「訂單店號」。
            </p>
          </div>
        </div>
        {isSuperAdmin ? (
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={storeDraft}
              onChange={(e) => setStoreDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-20 h-10 rounded-lg border border-zinc-600 bg-zinc-900/90 px-2 text-center font-mono text-amber-200 text-sm"
              maxLength={3}
              inputMode="numeric"
              placeholder="001"
              aria-label="店號三碼"
            />
            <button
              type="button"
              onClick={onSaveStoreCode}
              className="h-10 px-4 rounded-lg bg-amber-600 text-zinc-950 text-sm font-semibold hover:bg-amber-500"
            >
              儲存
            </button>
          </div>
        ) : (
          <p className="text-lg font-mono text-amber-200/90 tabular-nums shrink-0">{storeDraft}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-zinc-800/20 rounded-bl-full -mr-4 -mt-4 z-0"></div>
          <div className="flex items-center gap-2 text-zinc-500 relative z-10">
            <Users size={20} className="text-zinc-500" />
            <span className="font-medium text-sm">總使用者數</span>
          </div>
          <div className="text-3xl font-light relative z-10 text-[#f5f2ed]">{listLoading ? '…' : stats.total}</div>
        </div>
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-zinc-500">
            <ShieldAlert size={20} className="text-amber-500" />
            <span className="font-medium text-sm">系統管理員</span>
          </div>
          <div className="text-3xl font-light text-[#f5f2ed]">{listLoading ? '…' : stats.admins}</div>
        </div>
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-zinc-500">
            <Store size={20} className="text-amber-500" />
            <span className="font-medium text-sm">加盟主帳號</span>
          </div>
          <div className="text-3xl font-light text-[#f5f2ed]">{listLoading ? '…' : stats.franchisees}</div>
        </div>
        <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-zinc-500">
            <Users size={20} className="text-emerald-500" />
            <span className="font-medium text-sm">員工帳號（已分流）</span>
          </div>
          <div className="text-3xl font-light text-[#f5f2ed]">{listLoading ? '…' : stats.employees}</div>
          {!listLoading && (
            <p className="text-xs text-zinc-500">直營 {stats.hqEmployees} / 加盟 {stats.franchiseeEmployees}</p>
          )}
        </div>
      </div>

      <div className="bg-zinc-900/30 rounded-2xl border border-zinc-800 overflow-hidden flex flex-col">
        <div className="p-4 flex flex-col lg:flex-row gap-4 justify-between items-center mb-2">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋名稱、登入帳號、信箱或電話..."
                className="w-full pl-10 pr-4 py-2 border border-zinc-700 bg-zinc-900 rounded-full focus:outline-none focus:border-amber-500 transition-colors text-sm text-zinc-300 placeholder-zinc-500"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="all">所有角色</option>
              <option value="admin">BOSS</option>
              <option value="franchisee">加盟主</option>
              <option value="employee">員工</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                <th className="py-4 px-6 font-medium whitespace-nowrap">使用者名稱</th>
                <th className="py-4 px-6 font-medium whitespace-nowrap">登入帳號</th>
                <th className="py-4 px-6 font-medium whitespace-nowrap">角色權限</th>
                <th className="py-4 px-6 font-medium whitespace-nowrap">信箱帳號</th>
                <th className="py-4 px-6 font-medium whitespace-nowrap">聯絡電話</th>
                <th className="py-4 px-6 font-medium whitespace-nowrap">帳號狀態</th>
                <th className="py-4 px-6 font-medium text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {listLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    載入使用者清單…
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'hover:bg-white/[0.02] transition-colors border-b border-zinc-800/50 group',
                      u.status === 'disabled' && 'opacity-50'
                    )}
                  >
                    <td className="py-4 px-6 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-600/20 text-amber-500 flex items-center justify-center font-bold shrink-0 text-sm">
                          {avatarChar(u.name)}
                        </div>
                        <span className="font-medium text-[#f5f2ed]">{u.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono text-sm text-amber-200/90 whitespace-nowrap">
                      {u.loginId ?? '—'}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium',
                          u.role === 'admin' && 'bg-amber-600/10 border-amber-600/30 text-amber-500',
                          u.role === 'franchisee' && 'bg-amber-600/10 border-amber-600/30 text-amber-300',
                          u.role === 'employee' && 'bg-zinc-800 border-zinc-700 text-zinc-400'
                        )}
                      >
                        {u.role === 'employee' ? employeeAffiliationLabel(u, users) : roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-zinc-400 whitespace-nowrap">{u.email}</td>
                    <td className="py-4 px-6 text-zinc-400 whitespace-nowrap">{u.phone}</td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
                          u.status === 'active' ? 'bg-emerald-600/10 text-emerald-400' : 'bg-red-600/10 text-red-400'
                        )}
                      >
                        <span
                          className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            u.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'
                          )}
                        />
                        {statusLabel(u.status)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="p-1.5 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded-lg transition-colors"
                            title="編輯"
                          >
                            <Edit size={18} />
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPwdResetErr(null);
                              setPwdResetNew('');
                              setPwdResetNew2('');
                              setPwdResetFor(u);
                            }}
                            className="p-1.5 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded-lg transition-colors"
                            title="重設密碼"
                          >
                            <KeyRound size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!listLoading && filteredUsers.length === 0 && (
          <p className="p-6 text-center text-zinc-500 text-sm">沒有符合條件的使用者。</p>
        )}
      </div>

      {isAddModalOpen && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[88dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="text-lg sm:text-xl font-bold text-[#f5f2ed]">新增系統使用者</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <form
              className="overflow-y-auto px-4 py-4 space-y-4 sm:px-6 sm:py-5 sm:space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitAdd();
              }}
            >
              {addError && (
                <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">{addError}</p>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">使用者名稱</label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="例如：林雅婷"
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">登入帳號（英數）</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={addLoginId}
                    onChange={(e) => setAddLoginId(e.target.value)}
                    placeholder="例如：store01"
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 font-mono text-sm text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">初始密碼（至少 4 碼）</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={addInitialPassword}
                    onChange={(e) => setAddInitialPassword(e.target.value)}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">角色權限</label>
                  <select
                    value={addRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as SystemUserRole;
                      setAddRole(nextRole);
                      if (nextRole !== 'employee') {
                        setAddEmployeeOrgType('hq');
                        setAddParentFranchiseeUserId('');
                      }
                      if (nextRole !== 'franchisee') setAddOrderStoreCode('');
                    }}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                  >
                    <option value="franchisee">加盟主</option>
                    <option value="employee">員工</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">店鋪名稱 (選填)</label>
                  <input
                    type="text"
                    value={addStoreLabel}
                    onChange={(e) => setAddStoreLabel(e.target.value)}
                    placeholder="例如：高雄巨蛋店"
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
              {addRole === 'franchisee' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    訂單店號（3 碼數字，選填）
                  </label>
                  <input
                    type="text"
                    value={addOrderStoreCode}
                    onChange={(e) => setAddOrderStoreCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="例如：002（未填則預設 001）"
                    maxLength={3}
                    inputMode="numeric"
                    className="w-full max-w-[12rem] bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 font-mono text-amber-200/90 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <p className="mt-1 text-[0.6875rem] text-zinc-500 leading-relaxed">
                    訂單編號格式：店號 ＋ 日期 ＋ 當日序號。加盟門市員工下單時沿用所屬加盟主此店號。
                  </p>
                </div>
              )}
              {addRole === 'employee' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">員工隸屬</label>
                    <select
                      value={addEmployeeOrgType}
                      onChange={(e) => setAddEmployeeOrgType(e.target.value as EmployeeOrgType)}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                    >
                      <option value="hq">總部直營</option>
                      <option value="franchisee">加盟主名下</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">所屬加盟主</label>
                    <select
                      value={addParentFranchiseeUserId}
                      onChange={(e) => setAddParentFranchiseeUserId(e.target.value)}
                      disabled={addEmployeeOrgType !== 'franchisee'}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] disabled:opacity-50 focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                    >
                      <option value="">請選擇</option>
                      {franchiseeOptions.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">聯絡電話</label>
                <input
                  type="tel"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder="09xx-xxx-xxx"
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">電子信箱</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="example@mail.com"
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 font-medium transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="px-6 py-2.5 rounded-lg bg-amber-600 text-zinc-900 font-bold hover:bg-amber-500 transition-colors disabled:opacity-50"
                >
                  {addSaving ? '儲存中…' : '確認新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[88dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="text-lg sm:text-xl font-bold text-[#f5f2ed]">編輯使用者</h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <form
              className="overflow-y-auto px-4 py-4 space-y-4 sm:px-6 sm:py-5 sm:space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitEdit();
              }}
            >
              {editError && (
                <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">{editError}</p>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">使用者名稱</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">登入帳號</label>
                {isEditingPrimarySuper ? (
                  <input
                    type="text"
                    readOnly
                    value={SUPER_ADMIN_LOGIN_ID}
                    className="w-full cursor-not-allowed rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 font-mono text-sm text-zinc-400"
                  />
                ) : (
                  <input
                    type="text"
                    value={editLoginId}
                    onChange={(e) => setEditLoginId(e.target.value)}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 font-mono text-sm text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">角色權限</label>
                  <select
                    value={editRole}
                    disabled={isEditingPrimarySuper}
                    onChange={(e) => {
                      const nextRole = e.target.value as SystemUserRole;
                      setEditRole(nextRole);
                      if (nextRole !== 'employee') {
                        setEditEmployeeOrgType('hq');
                        setEditParentFranchiseeUserId('');
                      }
                      if (nextRole !== 'franchisee') setEditOrderStoreCode('');
                    }}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isEditingPrimarySuper ? (
                      <option value="admin">BOSS</option>
                    ) : (
                      <>
                        <option value="franchisee">加盟主</option>
                        <option value="employee">員工</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">帳號狀態</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as SystemUserStatus)}
                    disabled={isEditingPrimarySuper}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="active">啟用中</option>
                    <option value="disabled">停權</option>
                  </select>
                </div>
              </div>
              {editRole === 'employee' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">員工隸屬</label>
                    <select
                      value={editEmployeeOrgType}
                      onChange={(e) => setEditEmployeeOrgType(e.target.value as EmployeeOrgType)}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                    >
                      <option value="hq">總部直營</option>
                      <option value="franchisee">加盟主名下</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">所屬加盟主</label>
                    <select
                      value={editParentFranchiseeUserId}
                      onChange={(e) => setEditParentFranchiseeUserId(e.target.value)}
                      disabled={editEmployeeOrgType !== 'franchisee'}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] disabled:opacity-50 focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                    >
                      <option value="">請選擇</option>
                      {franchiseeOptions.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">店鋪名稱 (選填)</label>
                <input
                  type="text"
                  value={editStoreLabel}
                  onChange={(e) => setEditStoreLabel(e.target.value)}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              {editRole === 'franchisee' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    訂單店號（3 碼數字，選填）
                  </label>
                  <input
                    type="text"
                    value={editOrderStoreCode}
                    onChange={(e) => setEditOrderStoreCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="例如：002（未填則預設 001）"
                    maxLength={3}
                    inputMode="numeric"
                    className="w-full max-w-[12rem] bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 font-mono text-amber-200/90 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <p className="mt-1 text-[0.6875rem] text-zinc-500 leading-relaxed">
                    訂單編號：店號 ＋ 日期 ＋ 當日第幾張。門市員工叫貨沿用此加盟主店號。
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">聯絡電話</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">電子信箱</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              <div className="pt-2 flex flex-col gap-3">
                {!isEditingPrimarySuper ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void removeEditingUser()}
                      disabled={editSaving}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={16} /> 刪除此帳號
                    </button>
                    {deleteArmed && editing && deleteSnapshot && deleteSnapshot.userId === editing.id && (
                      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 space-y-2">
                        <p className="text-xs font-medium text-red-200">二次確認（請擇一完整輸入，與下列紀錄相同）</p>
                        <ul className="list-inside list-disc space-y-1 text-[0.6875rem] leading-relaxed text-zinc-400">
                          {deleteSnapshot.loginId ? (
                            <li>
                              登入帳號：<span className="font-mono text-amber-200/90">{deleteSnapshot.loginId}</span>
                            </li>
                          ) : (
                            <li>登入帳號：（尚無）— 請改輸入使用者名稱或電子信箱</li>
                          )}
                          <li>
                            使用者名稱：<span className="text-zinc-200">{deleteSnapshot.name}</span>
                          </li>
                          <li>
                            電子信箱：<span className="font-mono text-zinc-300">{deleteSnapshot.email}</span>
                          </li>
                        </ul>
                        <input
                          type="text"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="輸入登入帳號、名稱或信箱其中一項"
                          autoComplete="off"
                          className="w-full bg-zinc-900/70 border border-red-900/50 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-red-500"
                        />
                        <p className="text-[0.625rem] text-zinc-500">輸入後請再按一次「刪除此帳號」。無須先按「儲存變更」。</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
                    主要超級管理員帳號不可刪除。
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="px-5 py-2.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 font-medium transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="px-6 py-2.5 rounded-lg bg-amber-600 text-zinc-900 font-bold hover:bg-amber-500 transition-colors disabled:opacity-50"
                  >
                    {editSaving ? '儲存中…' : '儲存變更'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {pwdResetFor && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/60 p-2 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl max-h-[92dvh] sm:max-h-[88dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5 sm:py-4">
              <h3 className="text-lg font-bold text-[#f5f2ed]">重設密碼</h3>
              <button
                type="button"
                onClick={() => {
                  setPwdResetFor(null);
                  setPwdResetErr(null);
                }}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800"
                aria-label="關閉"
              >
                <X size={22} />
              </button>
            </div>
            <div className="overflow-y-auto space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              <p className="text-sm text-zinc-400">
                使用者：<span className="font-medium text-[#f5f2ed]">{pwdResetFor.name}</span>（
                <span className="font-mono text-amber-200/90">{pwdResetFor.loginId ?? '尚未設定登入帳號'}</span>）
              </p>
              {pwdResetErr && (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{pwdResetErr}</p>
              )}
              <div>
                <label className="mb-1 block text-sm text-zinc-400">新密碼</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdResetNew}
                  onChange={(e) => setPwdResetNew(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">確認新密碼</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdResetNew2}
                  onChange={(e) => setPwdResetNew2(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPwdResetFor(null);
                    setPwdResetErr(null);
                  }}
                  className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={pwdResetBusy}
                  onClick={() => void submitPwdReset()}
                  className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"
                >
                  {pwdResetBusy ? '處理中…' : '確認重設'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
