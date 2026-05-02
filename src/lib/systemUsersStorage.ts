/**
 * 權限設定／系統使用者目錄（本機 localStorage，結構預留對應 Cloud SQL `users` 表）。
 */
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
  email: string;
  phone: string;
  status: SystemUserStatus;
  /** role=employee 時，員工隸屬：總部直營 or 加盟主體系 */
  employeeOrgType?: EmployeeOrgType;
  /** role=employee 且 employeeOrgType=franchisee 時，掛靠的加盟主 user.id */
  parentFranchiseeUserId?: string;
  /** 加盟主／直營門市顯示用（選填） */
  storeLabel?: string;
  createdAt: string;
  updatedAt: string;
};

type PersistV1 = { version: 1; users: SystemUser[] };

export type NewSystemUserInput = {
  name: string;
  role: SystemUserRole;
  email: string;
  phone: string;
  employeeOrgType?: EmployeeOrgType;
  parentFranchiseeUserId?: string;
  storeLabel?: string;
  status?: SystemUserStatus;
};

export type SystemUserUpdate = Partial<
  Pick<
    SystemUser,
    'name' | 'role' | 'email' | 'phone' | 'status' | 'employeeOrgType' | 'parentFranchiseeUserId' | 'storeLabel'
  >
>;

function dispatchUpdated(): void {
  window.dispatchEvent(new Event(SYSTEM_USERS_UPDATED_EVENT));
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
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

export function createSystemUser(input: NewSystemUserInput): SystemUser {
  const list = listSystemUsers();
  const emailN = normalizeEmail(input.email);
  if (!input.name.trim()) throw new Error('請填寫使用者名稱。');
  if (!emailN) throw new Error('請填寫電子信箱。');
  if (list.some((u) => normalizeEmail(u.email) === emailN)) {
    throw new Error('此信箱已被使用。');
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
  const affiliation = normalizeEmployeeAffiliation(
    input.role,
    input.employeeOrgType,
    input.parentFranchiseeUserId,
    list,
  );
  Object.assign(u, affiliation);
  if (input.storeLabel?.trim()) u.storeLabel = input.storeLabel.trim();
  savePersisted([u, ...list]);
  return { ...u };
}

export function updateSystemUser(id: string, patch: SystemUserUpdate): boolean {
  const list = listSystemUsers();
  const i = list.findIndex((u) => u.id === id);
  if (i < 0) return false;
  const nextEmail = patch.email != null ? normalizeEmail(patch.email) : normalizeEmail(list[i].email);
  if (patch.email != null) {
    if (!String(patch.email).trim()) throw new Error('信箱不可為空。');
    if (list.some((u, j) => j !== i && normalizeEmail(u.email) === nextEmail)) {
      throw new Error('此信箱已被其他帳號使用。');
    }
  }
  const t = nowIso();
  const cur = list[i];
  const nextRole = patch.role ?? cur.role;
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
  if (nextRole !== 'employee') {
    delete merged.employeeOrgType;
    delete merged.parentFranchiseeUserId;
  } else {
    merged.employeeOrgType = affiliation.employeeOrgType;
    merged.parentFranchiseeUserId = affiliation.parentFranchiseeUserId;
  }
  if (patch.storeLabel !== undefined) {
    const s = String(patch.storeLabel).trim();
    merged.storeLabel = s || undefined;
  }
  const next = [...list];
  next[i] = merged;
  savePersisted(next);
  return true;
}

export function removeSystemUser(id: string): boolean {
  const list = listSystemUsers();
  const next = list.filter((u) => u.id !== id);
  if (next.length === list.length) return false;
  savePersisted(next);
  return true;
}
