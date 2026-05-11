/**
 * 權限設定／系統使用者目錄（本機 localStorage，結構預留對應 Cloud SQL `users` 表）。
 */
import { SUPER_ADMIN_LOGIN_ID } from './authConstants';
import { normalizeStoreCode3Digits } from './storeCodeStorage';

const KEY = 'dongshan_system_users_v1';

export const SYSTEM_USERS_UPDATED_EVENT = 'systemUsersUpdated';

/** 與 Topbar／訂單權限之 `UserRole` 對齊 */
export type SystemUserRole = 'admin' | 'franchisee' | 'employee';

export type SystemUserStatus = 'active' | 'disabled';
export type EmployeeOrgType = 'hq' | 'franchisee';

export type SystemUser = {
  id: string;
  name: string;
  role: SystemUserRole;
  /** 系統登入帳號（英數，儲存為小寫） */
  loginId?: string;
  email: string;
  phone: string;
  status: SystemUserStatus;
  /** role=employee 時，員工隸屬：總部直營 or 加盟主體系 */
  employeeOrgType?: EmployeeOrgType;
  /** role=employee 且 employeeOrgType=franchisee 時，掛靠的加盟主 user.id */
  parentFranchiseeUserId?: string;
  /** 加盟主／直營門市顯示用（選填） */
  storeLabel?: string;
  /**
   * 加盟主專用：訂單單號前綴店號（3 位數字，與「店鋪名稱」不同）。
   * 員工帳號下單時沿用所屬加盟主此欄位。
   */
  orderStoreCode?: string;
  createdAt: string;
  updatedAt: string;
};

type PersistV1 = { version: 1; users: SystemUser[] };

export type NewSystemUserInput = {
  name: string;
  role: SystemUserRole;
  email: string;
  phone: string;
  /** 登入帳號（建立帳號時建議一併設定，並由 api 層寫入密碼） */
  loginId?: string;
  employeeOrgType?: EmployeeOrgType;
  parentFranchiseeUserId?: string;
  storeLabel?: string;
  /** 僅加盟主：訂單店號 3 碼 */
  orderStoreCode?: string;
  status?: SystemUserStatus;
};

export type SystemUserUpdate = Partial<
  Pick<
    SystemUser,
    | 'name'
    | 'role'
    | 'loginId'
    | 'email'
    | 'phone'
    | 'status'
    | 'employeeOrgType'
    | 'parentFranchiseeUserId'
    | 'storeLabel'
    | 'orderStoreCode'
  >
>;

function dispatchUpdated(): void {
  window.dispatchEvent(new Event(SYSTEM_USERS_UPDATED_EVENT));
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function normalizeLoginId(s: string): string {
  return s.trim().toLowerCase();
}

function isPrimarySuperAdminUser(u: SystemUser): boolean {
  return Boolean(u.loginId && normalizeLoginId(u.loginId) === normalizeLoginId(SUPER_ADMIN_LOGIN_ID));
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedUsers(): SystemUser[] {
  const t = nowIso();
  return [
    {
      id: '11111111-1111-4111-8111-111111111101',
      name: '陳建宏',
      role: 'admin',
      email: 'chen.admin@dongshan.com',
      phone: '0912-345-678',
      status: 'active',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: '22222222-2222-4222-8222-222222222202',
      name: '林雅婷',
      role: 'franchisee',
      email: 'yating.lin@store.com',
      phone: '0988-765-432',
      status: 'active',
      storeLabel: '高雄巨蛋店',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: '33333333-3333-4333-8333-333333333303',
      name: '王大明',
      role: 'employee',
      email: 'daming.w@store.com',
      phone: '0933-222-111',
      status: 'disabled',
      employeeOrgType: 'hq',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: '55555555-5555-4555-8555-555555555505',
      name: '周小雅',
      role: 'employee',
      email: 'xiaoya.zhou@store.com',
      phone: '0966-555-222',
      status: 'active',
      employeeOrgType: 'franchisee',
      parentFranchiseeUserId: '22222222-2222-4222-8222-222222222202',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: '44444444-4444-4444-8444-444444444404',
      name: '李小龍',
      role: 'franchisee',
      email: 'bruce.lee@store.com',
      phone: '0955-666-777',
      status: 'active',
      createdAt: t,
      updatedAt: t,
    },
  ];
}

function coerceUser(raw: unknown): SystemUser | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  const name = typeof o.name === 'string' ? o.name : '';
  const role = o.role;
  const email = typeof o.email === 'string' ? o.email : '';
  const phone = typeof o.phone === 'string' ? o.phone : '';
  const loginIdRaw = o.loginId;
  const status = o.status;
  const employeeOrgType = o.employeeOrgType;
  const parentFranchiseeUserId = o.parentFranchiseeUserId;
  const storeLabel = o.storeLabel;
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : '';
  if (!id || !name || !email) return null;
  if (role !== 'admin' && role !== 'franchisee' && role !== 'employee') return null;
  if (status !== 'active' && status !== 'disabled') return null;
  const u: SystemUser = {
    id,
    name,
    role,
    email,
    phone,
    status,
    createdAt: createdAt || nowIso(),
    updatedAt: updatedAt || nowIso(),
  };
  if (role === 'employee') {
    if (employeeOrgType === 'hq' || employeeOrgType === 'franchisee') {
      u.employeeOrgType = employeeOrgType;
    } else {
      u.employeeOrgType = 'hq';
    }
    if (u.employeeOrgType === 'franchisee' && typeof parentFranchiseeUserId === 'string' && parentFranchiseeUserId.trim()) {
      u.parentFranchiseeUserId = parentFranchiseeUserId.trim();
    }
  }
  if (typeof storeLabel === 'string' && storeLabel.trim()) u.storeLabel = storeLabel.trim();
  if (typeof loginIdRaw === 'string' && loginIdRaw.trim()) {
    u.loginId = normalizeLoginId(loginIdRaw);
  }
  return u;
}

function normalizeEmployeeAffiliation(
  role: SystemUserRole,
  employeeOrgType: EmployeeOrgType | undefined,
  parentFranchiseeUserId: string | undefined,
  users: SystemUser[],
): Pick<SystemUser, 'employeeOrgType' | 'parentFranchiseeUserId'> {
  if (role !== 'employee') {
    return {};
  }
  const org = employeeOrgType ?? 'hq';
  if (org === 'hq') {
    return { employeeOrgType: 'hq' };
  }
  if (!parentFranchiseeUserId) {
    throw new Error('員工若掛靠加盟主，請選擇所屬加盟主。');
  }
  const boss = users.find((u) => u.id === parentFranchiseeUserId);
  if (!boss || boss.role !== 'franchisee') {
    throw new Error('所屬加盟主不存在或角色不正確。');
  }
  return { employeeOrgType: 'franchisee', parentFranchiseeUserId };
}

function loadPersisted(): SystemUser[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const bag = parsed as PersistV1;
    if (bag.version !== 1 || !Array.isArray(bag.users)) return null;
    const out: SystemUser[] = [];
    for (const row of bag.users) {
      const u = coerceUser(row);
      if (u) out.push(u);
    }
    return out;
  } catch {
    return null;
  }
}

function savePersisted(users: SystemUser[]): void {
  const body: PersistV1 = { version: 1, users };
  localStorage.setItem(KEY, JSON.stringify(body));
  dispatchUpdated();
}

export function listSystemUsers(): SystemUser[] {
  const loaded = loadPersisted();
  if (loaded === null) {
    const seeded = seedUsers();
    savePersisted(seeded);
    return seeded.map((u) => ({ ...u }));
  }
  return loaded.map((u) => ({ ...u }));
}

/**
 * 保底建立／修正主要超級管理員帳號（dk001）。
 * - 若無任何 admin，會建立一筆 admin。
 * - 若有 admin 但沒有任何 loginId=dk001，會把第一位 admin 的 loginId 改為 dk001 並啟用。
 */
export function ensurePrimarySuperAdminAccount(): SystemUser {
  const list = listSystemUsers();
  const dk = list.find((u) => u.loginId && normalizeLoginId(u.loginId) === normalizeLoginId(SUPER_ADMIN_LOGIN_ID));
  if (dk) {
    if (dk.status !== 'active') {
      updateSystemUser(dk.id, { status: 'active' });
      const refreshed = listSystemUsers().find((u) => u.id === dk.id);
      return refreshed ? { ...refreshed } : { ...dk, status: 'active' };
    }
    return { ...dk };
  }

  const firstAdmin = list.find((u) => u.role === 'admin');
  if (firstAdmin) {
    updateSystemUser(firstAdmin.id, {
      loginId: SUPER_ADMIN_LOGIN_ID,
      status: 'active',
    });
    const refreshed = listSystemUsers().find((u) => u.id === firstAdmin.id);
    return refreshed
      ? { ...refreshed }
      : { ...firstAdmin, loginId: SUPER_ADMIN_LOGIN_ID, status: 'active' };
  }

  const t = nowIso();
  const seededAdmin: SystemUser = {
    id: crypto.randomUUID(),
    name: '系統管理員',
    role: 'admin',
    loginId: SUPER_ADMIN_LOGIN_ID,
    email: 'dk001@local.dongshan',
    phone: '',
    status: 'active',
    createdAt: t,
    updatedAt: t,
  };
  savePersisted([seededAdmin, ...list]);
  return { ...seededAdmin };
}

export function createSystemUser(input: NewSystemUserInput): SystemUser {
  const list = listSystemUsers();
  const emailN = normalizeEmail(input.email);
  if (!input.name.trim()) throw new Error('請填寫使用者名稱。');
  if (!emailN) throw new Error('請填寫電子信箱。');
  if (input.role === 'admin') {
    throw new Error('無法新增超級管理員帳號；系統僅保留主要管理帳號。');
  }
  if (list.some((u) => normalizeEmail(u.email) === emailN)) {
    throw new Error('此信箱已被使用。');
  }
  let loginId: string | undefined;
  if (input.loginId?.trim()) {
    loginId = normalizeLoginId(input.loginId);
    if (!loginId) throw new Error('登入帳號不可僅有空白。');
    if (list.some((x) => x.loginId && normalizeLoginId(x.loginId) === loginId)) {
      throw new Error('此登入帳號已被使用。');
    }
  }
  const t = nowIso();
  const u: SystemUser = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    role: input.role,
    email: input.email.trim(),
    phone: input.phone.trim(),
    status: input.status ?? 'active',
    createdAt: t,
    updatedAt: t,
  };
  if (loginId) u.loginId = loginId;
  const affiliation = normalizeEmployeeAffiliation(
    input.role,
    input.employeeOrgType,
    input.parentFranchiseeUserId,
    list,
  );
  Object.assign(u, affiliation);
  if (input.storeLabel?.trim()) u.storeLabel = input.storeLabel.trim();
  if (input.role === 'franchisee' && input.orderStoreCode != null && String(input.orderStoreCode).trim()) {
    u.orderStoreCode = normalizeStoreCode3Digits(input.orderStoreCode);
  }
  savePersisted([u, ...list]);
  return { ...u };
}

export function updateSystemUser(id: string, patch: SystemUserUpdate): boolean {
  const list = listSystemUsers();
  const i = list.findIndex((u) => u.id === id);
  if (i < 0) return false;
  const cur = list[i];
  if (isPrimarySuperAdminUser(cur)) {
    if (patch.role != null && patch.role !== 'admin') {
      throw new Error('無法變更主要超級管理員的角色。');
    }
    if (patch.status === 'disabled') {
      throw new Error('無法將主要超級管理員帳號設為停權。');
    }
    if (patch.loginId != null && normalizeLoginId(String(patch.loginId)) !== normalizeLoginId(SUPER_ADMIN_LOGIN_ID)) {
      throw new Error('無法變更主要超級管理員的登入帳號。');
    }
  }
  const nextEmail = patch.email != null ? normalizeEmail(patch.email) : normalizeEmail(list[i].email);
  if (patch.email != null) {
    if (!String(patch.email).trim()) throw new Error('信箱不可為空。');
    if (list.some((u, j) => j !== i && normalizeEmail(u.email) === nextEmail)) {
      throw new Error('此信箱已被其他帳號使用。');
    }
  }
  if (patch.loginId !== undefined) {
    const lid = String(patch.loginId).trim() ? normalizeLoginId(String(patch.loginId)) : '';
    if (!lid) throw new Error('登入帳號不可為空。');
    if (list.some((u, j) => j !== i && u.loginId && normalizeLoginId(u.loginId) === lid)) {
      throw new Error('此登入帳號已被其他帳號使用。');
    }
  }
  const t = nowIso();
  const nextRole = patch.role ?? cur.role;
  if (patch.role === 'admin' && !isPrimarySuperAdminUser(cur)) {
    throw new Error('無法將其他帳號升級為超級管理員。');
  }
  const nextOrgType = patch.employeeOrgType ?? cur.employeeOrgType;
  const nextParent = patch.parentFranchiseeUserId ?? cur.parentFranchiseeUserId;
  const affiliation = normalizeEmployeeAffiliation(nextRole, nextOrgType, nextParent, list);
  const merged: SystemUser = {
    ...cur,
    name: patch.name != null ? String(patch.name).trim() || cur.name : cur.name,
    role: patch.role ?? cur.role,
    email: patch.email != null ? String(patch.email).trim() : cur.email,
    phone: patch.phone != null ? String(patch.phone).trim() : cur.phone,
    status: patch.status ?? cur.status,
    updatedAt: t,
  };
  if (patch.loginId !== undefined) {
    merged.loginId = String(patch.loginId).trim() ? normalizeLoginId(String(patch.loginId)) : undefined;
  }
  if (nextRole !== 'employee') {
    delete merged.employeeOrgType;
    delete merged.parentFranchiseeUserId;
  } else {
    merged.employeeOrgType = affiliation.employeeOrgType;
    merged.parentFranchiseeUserId = affiliation.parentFranchiseeUserId;
  }
  if (nextRole !== 'franchisee') {
    delete merged.orderStoreCode;
  }
  if (patch.storeLabel !== undefined) {
    const s = String(patch.storeLabel).trim();
    merged.storeLabel = s || undefined;
  }
  if (patch.orderStoreCode !== undefined && nextRole === 'franchisee') {
    const s = String(patch.orderStoreCode).trim();
    merged.orderStoreCode = s ? normalizeStoreCode3Digits(s) : undefined;
  }
  const next = [...list];
  next[i] = merged;
  savePersisted(next);
  return true;
}

export function removeSystemUser(id: string): boolean {
  const list = listSystemUsers();
  const u = list.find((x) => x.id === id);
  if (u && isPrimarySuperAdminUser(u)) {
    throw new Error('無法刪除主要超級管理員帳號。');
  }
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  savePersisted(next);
  return true;
}
