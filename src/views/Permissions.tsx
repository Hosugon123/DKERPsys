import { UserPlus, Search, ShieldAlert, Store, Users, Edit, KeyRound, X, Hash, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserRole } from './Orders';
import { accounts, storeSettings } from '../services/apiService';
import type { EmployeeOrgType, SystemUser, SystemUserRole, SystemUserStatus } from '../lib/systemUsersStorage';
import { SYSTEM_USERS_UPDATED_EVENT } from '../lib/systemUsersStorage';
import { cn } from '../lib/utils';

function roleLabel(r: SystemUserRole): string {
  switch (r) {
    case 'admin':
      return '超級管理員';
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

type RoleFilter = 'all' | SystemUserRole;

export default function Permissions({ userRole }: { userRole: UserRole }) {
  const isAdmin = userRole === 'admin';
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
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<SystemUserRole>('employee');
  const [editEmployeeOrgType, setEditEmployeeOrgType] = useState<EmployeeOrgType>('hq');
  const [editParentFranchiseeUserId, setEditParentFranchiseeUserId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStoreLabel, setEditStoreLabel] = useState('');
  const [editStatus, setEditStatus] = useState<SystemUserStatus>('active');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

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
    setIsAddModalOpen(true);
  };

  const openEdit = (u: SystemUser) => {
    setEditError(null);
    setDeleteArmed(false);
    setDeleteConfirmName('');
    setEditing(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditEmployeeOrgType(u.employeeOrgType ?? 'hq');
    setEditParentFranchiseeUserId(u.parentFranchiseeUserId ?? '');
    setEditPhone(u.phone);
    setEditEmail(u.email);
    setEditStoreLabel(u.storeLabel ?? '');
    setEditStatus(u.status);
  };

  const submitAdd = async () => {
    setAddError(null);
    setAddSaving(true);
    try {
      await accounts.createUser({
        name: addName,
        role: addRole,
        email: addEmail,
        phone: addPhone,
        employeeOrgType: addRole === 'employee' ? addEmployeeOrgType : undefined,
        parentFranchiseeUserId:
          addRole === 'employee' && addEmployeeOrgType === 'franchisee' ? addParentFranchiseeUserId : undefined,
        storeLabel: addStoreLabel.trim() || undefined,
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
    setEditError(null);
    setEditSaving(true);
    try {
      await accounts.updateUser(editing.id, {
        name: editName,
        role: editRole,
        email: editEmail,
        phone: editPhone,
        status: editStatus,
        employeeOrgType: editRole === 'employee' ? editEmployeeOrgType : undefined,
        parentFranchiseeUserId:
          editRole === 'employee' && editEmployeeOrgType === 'franchisee' ? editParentFranchiseeUserId : undefined,
        storeLabel: editStoreLabel,
      });
      setEditing(null);
      await refreshUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '更新失敗');
    } finally {
      setEditSaving(false);
    }
  };

  const removeEditingUser = async () => {
    if (!editing || !isAdmin) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const expected = editName.trim();
    if (!expected) {
      setEditError('請先填寫「使用者名稱」再執行刪除。');
      return;
    }
    if (deleteConfirmName.trim() !== expected) {
      setEditError('二次確認姓名不符：請輸入與上方「使用者名稱」欄位完全相同（含空格需一致，建議直接複製貼上）。');
      return;
    }
    setEditError(null);
    setEditSaving(true);
    try {
      const ok = await accounts.removeUser(editing.id);
      if (!ok) {
        setEditError('刪除失敗：找不到此帳號或資料已變更，請關閉視窗後重新整理再試。');
        return;
      }
      setDeleteArmed(false);
      setDeleteConfirmName('');
      setEditing(null);
      await refreshUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setEditSaving(false);
    }
  };

  const onSaveStoreCode = () => void storeSettings.setStoreCode3(storeDraft);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">權限設定</h2>
          <p className="text-zinc-500 mt-1">管理系統使用者帳號、角色配置與存取權限。</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openAddModal}
            className="px-5 py-2.5 bg-zinc-800 border border-zinc-700 text-amber-500 rounded-lg hover:bg-zinc-700 transition-colors font-medium flex items-center gap-2 self-start sm:self-auto text-sm"
          >
            <UserPlus size={18} /> 新增加盟主 / 員工
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-amber-800/50 bg-amber-950/25 px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Hash className="shrink-0 text-amber-500/90 mt-0.5" size={20} />
          <div>
            <p className="text-sm font-semibold text-amber-100/90">本機店號</p>
            <p className="text-xs text-zinc-500 mt-0.5">訂單單號前綴（3 碼）。</p>
          </div>
        </div>
        {isAdmin ? (
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
            <Store size={20} className="text-indigo-500" />
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
        <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between items-center mb-2">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋名稱、信箱或電話..."
                className="w-full pl-10 pr-4 py-2 border border-zinc-700 bg-zinc-900 rounded-full focus:outline-none focus:border-amber-500 transition-colors text-sm text-zinc-300 placeholder-zinc-500"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="all">所有角色</option>
              <option value="admin">超級管理員</option>
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
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
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
                    <td className="py-4 px-6 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium',
                          u.role === 'admin' && 'bg-amber-600/10 border-amber-600/30 text-amber-500',
                          u.role === 'franchisee' && 'bg-indigo-600/10 border-indigo-600/30 text-indigo-400',
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
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="p-1.5 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded-lg transition-colors"
                            title="編輯"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              window.alert(
                                '本機版尚未連線認證後台；重設密碼將於後端 API（Cloud Run）上線後開放。'
                              )
                            }
                            className="p-1.5 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded-lg transition-colors"
                            title="重設密碼"
                          >
                            <KeyRound size={18} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
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

      {isAddModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-xl font-bold text-[#f5f2ed]">新增系統使用者</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <form
              className="p-6 space-y-5"
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
              <div className="grid grid-cols-2 gap-4">
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
                    }}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                  >
                    <option value="franchisee">加盟主</option>
                    <option value="employee">員工</option>
                    <option value="admin">超級管理員</option>
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
              {addRole === 'employee' && (
                <div className="grid grid-cols-2 gap-4">
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
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">電子信箱 (登入帳號)</label>
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

      {editing && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-xl font-bold text-[#f5f2ed]">編輯使用者</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <form
              className="p-6 space-y-5"
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">角色權限</label>
                  <select
                    value={editRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as SystemUserRole;
                      setEditRole(nextRole);
                      if (nextRole !== 'employee') {
                        setEditEmployeeOrgType('hq');
                        setEditParentFranchiseeUserId('');
                      }
                    }}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                  >
                    <option value="franchisee">加盟主</option>
                    <option value="employee">員工</option>
                    <option value="admin">超級管理員</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">帳號狀態</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as SystemUserStatus)}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2.5 text-[#f5f2ed] focus:outline-none focus:border-amber-500 transition-colors appearance-none"
                  >
                    <option value="active">啟用中</option>
                    <option value="disabled">停權</option>
                  </select>
                </div>
              </div>
              {editRole === 'employee' && (
                <div className="grid grid-cols-2 gap-4">
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
                <button
                  type="button"
                  onClick={() => void removeEditingUser()}
                  disabled={editSaving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={16} /> 刪除此帳號
                </button>
                {deleteArmed && editing && (
                  <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 space-y-2">
                    <p className="text-xs text-red-300">
                      二次確認：請輸入與上方「使用者名稱」欄位完全相同的「{editName.trim() || '（請先填寫名稱）'}」後，再按一次「刪除此帳號」。
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder={editName.trim() || '與上方名稱欄相同'}
                      className="w-full bg-zinc-900/70 border border-red-900/50 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-red-500"
                    />
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteArmed(false);
                      setDeleteConfirmName('');
                      setEditing(null);
                    }}
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
    </div>
  );
}
