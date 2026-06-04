/**
 * 加盟主專用：每單位零售參考價（每位加盟主 user.id 一套），與總部 userCatalog 分開。
 */
import { listSystemUsers } from './systemUsersStorage';

const KEY = 'dongshan_franchisee_retail_v1';
const LEGACY_OWNER_KEY = '__legacy_v1__';

type OwnerBucket = {
  byId: Record<string, number>;
  updatedAt: string;
};

type StoreV1 = {
  version: 1;
  byId: Record<string, number>;
};

type StoreV2 = {
  version: 2;
  byOwnerId: Record<string, OwnerBucket>;
};

function notify() {
  window.dispatchEvent(new Event('supplyCatalogUpdated'));
}

function emptyBucket(): OwnerBucket {
  return { byId: {}, updatedAt: new Date(0).toISOString() };
}

function normalizeStore(raw: unknown): StoreV2 {
  if (!raw || typeof raw !== 'object') return { version: 2, byOwnerId: {} };
  const s = raw as Partial<StoreV1 & StoreV2>;
  if (s.version === 2 && s.byOwnerId && typeof s.byOwnerId === 'object') {
    return { version: 2, byOwnerId: { ...s.byOwnerId } };
  }
  const byId = (s as StoreV1).byId;
  if (s.version === 1 && byId && typeof byId === 'object' && Object.keys(byId).length > 0) {
    return {
      version: 2,
      byOwnerId: {
        [LEGACY_OWNER_KEY]: {
          byId: { ...byId },
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }
  return { version: 2, byOwnerId: {} };
}

function loadStore(): StoreV2 {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return { version: 2, byOwnerId: {} };
    return normalizeStore(JSON.parse(r) as unknown);
  } catch {
    return { version: 2, byOwnerId: {} };
  }
}

function saveStore(s: StoreV2) {
  localStorage.setItem(KEY, JSON.stringify(s));
  notify();
}

function requireOwnerUserId(ownerUserId: string | undefined | null): string | null {
  const id = ownerUserId?.trim();
  return id || null;
}

function readBucket(s: StoreV2, ownerUserId: string): OwnerBucket {
  const direct = s.byOwnerId[ownerUserId];
  if (direct) return direct;
  const legacy = s.byOwnerId[LEGACY_OWNER_KEY];
  if (legacy) return legacy;
  return emptyBucket();
}

/**
 * 讀取指定加盟主之零售價表；未傳 owner 時由呼叫端自行解析（避免循環依賴 dataScope）。
 */
export function loadFranchiseeRetailByItemId(ownerUserId: string): Readonly<Record<string, number>> {
  const owner = requireOwnerUserId(ownerUserId);
  if (!owner) return {};
  return readBucket(loadStore(), owner).byId;
}

/**
 * 設為 null 可清除、改回依批價推估。
 */
export function setFranchiseeRetailPieceForItem(
  ownerUserId: string,
  id: string,
  value: number | null,
) {
  const owner = requireOwnerUserId(ownerUserId);
  if (!owner) return;
  const s = loadStore();
  const prev = readBucket(s, owner);
  const byId = { ...prev.byId };
  if (value == null) {
    delete byId[id];
  } else {
    const n = Math.min(1_000_000, Math.round(value * 100) / 100);
    if (n < 0) return;
    byId[id] = n;
  }
  s.byOwnerId[owner] = { byId, updatedAt: new Date().toISOString() };
  if (owner !== LEGACY_OWNER_KEY && s.byOwnerId[LEGACY_OWNER_KEY] && Object.keys(byId).length > 0) {
    delete s.byOwnerId[LEGACY_OWNER_KEY];
  }
  saveStore(s);
}

function mergeOwnerBuckets(a: OwnerBucket, b: OwnerBucket): OwnerBucket {
  const aMs = Date.parse(a.updatedAt) || 0;
  const bMs = Date.parse(b.updatedAt) || 0;
  const newer = bMs >= aMs ? b : a;
  const older = bMs >= aMs ? a : b;
  const byId = { ...older.byId, ...newer.byId };
  return {
    byId,
    updatedAt: new Date(Math.max(aMs, bMs)).toISOString(),
  };
}

/** 雲端 bundle 合併：每位加盟主 union 品項，整桶取較新 updatedAt 後再合併 byId。 */
function safeParse(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function mergeFranchiseeRetailStoreJson(
  localRaw: string | null | undefined,
  cloudRaw: string | null | undefined,
): string {
  const local = normalizeStore(safeParse(localRaw));
  const cloud = normalizeStore(safeParse(cloudRaw));
  const ownerIds = new Set([
    ...Object.keys(local.byOwnerId),
    ...Object.keys(cloud.byOwnerId),
  ]);
  const byOwnerId: Record<string, OwnerBucket> = {};
  for (const ownerId of ownerIds) {
    const la = local.byOwnerId[ownerId] ?? emptyBucket();
    const ca = cloud.byOwnerId[ownerId] ?? emptyBucket();
    byOwnerId[ownerId] = mergeOwnerBuckets(la, ca);
  }
  return JSON.stringify({ version: 2, byOwnerId } satisfies StoreV2);
}

/** 將舊版單一 byId 複製到目錄中每位加盟主（僅在該加盟主尚無資料時），供一次性升級多店環境。 */
export function migrateLegacyFranchiseeRetailToAllOwners(): void {
  const s = loadStore();
  const legacy = s.byOwnerId[LEGACY_OWNER_KEY];
  if (!legacy || Object.keys(legacy.byId).length === 0) return;
  const franchiseeIds = listSystemUsers()
    .filter((u) => u.role === 'franchisee')
    .map((u) => u.id.trim())
    .filter(Boolean);
  let changed = false;
  for (const fid of franchiseeIds) {
    if (s.byOwnerId[fid]) continue;
    s.byOwnerId[fid] = {
      byId: { ...legacy.byId },
      updatedAt: legacy.updatedAt,
    };
    changed = true;
  }
  if (changed) saveStore(s);
}
