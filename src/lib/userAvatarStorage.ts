const AVATAR_KEY_PREFIX = 'dongshan_user_avatar_v1:';

function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

function keyFor(loginId: string): string {
  return `${AVATAR_KEY_PREFIX}${normalizeLoginId(loginId)}`;
}

export function getUserAvatar(loginId: string): string | null {
  try {
    return localStorage.getItem(keyFor(loginId));
  } catch {
    return null;
  }
}

export function setUserAvatar(loginId: string, dataUrl: string): void {
  localStorage.setItem(keyFor(loginId), dataUrl);
}

export function removeUserAvatar(loginId: string): void {
  localStorage.removeItem(keyFor(loginId));
}
