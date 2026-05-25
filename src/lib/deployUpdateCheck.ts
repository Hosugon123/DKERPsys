import { reloadAppShell } from './appRefresh';

declare const __APP_BUILD_ID__: string;

/** 與 dist/build-version.json 同步；每次 build 會變更 */
export function getAppBuildId(): string {
  return typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
}

export type BuildVersionPayload = {
  buildId: string;
  builtAt?: string;
};

export async function fetchDeployedBuildVersion(): Promise<BuildVersionPayload | null> {
  try {
    const url = new URL('/build-version.json', window.location.origin);
    url.searchParams.set('_', String(Date.now()));
    const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as BuildVersionPayload;
    if (!data || typeof data.buildId !== 'string' || !data.buildId.trim()) return null;
    return data;
  } catch {
    return null;
  }
}

export async function isNewerDeploymentAvailable(): Promise<boolean> {
  const remote = await fetchDeployedBuildVersion();
  if (!remote) return false;
  return remote.buildId !== getAppBuildId();
}

const POLL_MS = 3 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000;

/**
 * 背景比對伺服器 build-version.json；發現新版本時呼叫 onUpdate（僅 production，通常為整頁重整）。
 * @returns 清除排程的函式
 */
export function startDeployUpdateWatch(onUpdate: () => void): () => void {
  if (import.meta.env.DEV) return () => {};

  let disposed = false;
  let checking = false;
  let reloadTriggered = false;

  const check = async () => {
    if (disposed || checking || reloadTriggered) return;
    checking = true;
    try {
      if (await isNewerDeploymentAvailable()) {
        reloadTriggered = true;
        onUpdate();
      }
    } finally {
      checking = false;
    }
  };

  const intervalId = window.setInterval(() => void check(), POLL_MS);
  const firstId = window.setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    disposed = true;
    clearInterval(intervalId);
    clearTimeout(firstId);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function applyDeployUpdateReload(): void {
  reloadAppShell();
}
