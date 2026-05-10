import { readSession } from './authSession';
import { listSystemUsers } from './systemUsersStorage';

/**
 * 目前登入者在系統使用者目錄中的顯示姓名；無名稱時退回 loginId。
 */
export function getSessionActorDisplayName(): string {
  const s = readSession();
  if (!s) return '';
  const u = listSystemUsers().find((x) => x.id === s.userId);
  const name = u?.name?.trim();
  if (name) return name;
  return (s.loginId ?? '').trim();
}

/** 依使用者目錄補姓名／帳號；供舊訂單僅存 actorUserId 時顯示。 */
export function resolveUserDisplayNameById(userId: string | undefined): string {
  if (!userId?.trim()) return '';
  const u = listSystemUsers().find((x) => x.id === userId);
  const name = u?.name?.trim();
  if (name) return name;
  return (u?.loginId ?? '').trim();
}
