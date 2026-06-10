/** 加入主畫面（PWA）自訂圖示，本機儲存（每台裝置／瀏覽器一份） */
export const PWA_ICON_STORAGE_KEY = 'dongshan_pwa_icon_v1';

export const DEFAULT_PWA_ICON_URL = '/brand-logo.png';

export const PWA_ICON_UPDATED_EVENT = 'pwaIconUpdated';

export const PWA_MANIFEST_STATIC = {
  name: '達客東山鴨頭',
  short_name: '達客東山鴨頭',
  description: '達客東山鴨頭門市管理',
  start_url: '/',
  display: 'standalone' as const,
  background_color: '#f5f2ed',
  theme_color: '#f4f1eb',
  lang: 'zh-Hant',
};

let manifestBlobUrl: string | null = null;

export function getCustomPwaIconDataUrl(): string | null {
  try {
    return localStorage.getItem(PWA_ICON_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setCustomPwaIconDataUrl(dataUrl: string): void {
  localStorage.setItem(PWA_ICON_STORAGE_KEY, dataUrl);
  applyPwaIconsToDocument();
  window.dispatchEvent(new Event(PWA_ICON_UPDATED_EVENT));
}

export function removeCustomPwaIcon(): void {
  localStorage.removeItem(PWA_ICON_STORAGE_KEY);
  applyPwaIconsToDocument();
  window.dispatchEvent(new Event(PWA_ICON_UPDATED_EVENT));
}

export function getEffectivePwaIconUrl(): string {
  return getCustomPwaIconDataUrl() ?? DEFAULT_PWA_ICON_URL;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('讀取圖片失敗，請稍後再試。'));
    };
    reader.onerror = () => reject(new Error('讀取圖片失敗，請稍後再試。'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片格式不支援，請改用 JPG / PNG / WEBP。'));
    img.src = src;
  });
}

/** 裁成正方形並縮放，供主畫面圖示使用（建議 512×512） */
export async function normalizePwaIconFile(file: File, target = 512): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法處理圖片，請稍後再試。');
  const crop = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - crop) / 2);
  const sy = Math.floor((img.height - crop) / 2);
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, target, target);
  const png = canvas.toDataURL('image/png');
  if (png.length > 900_000) {
    const jpeg = canvas.toDataURL('image/jpeg', 0.88);
    if (jpeg.length > 900_000) {
      throw new Error('圖片處理後仍過大，請改用較簡單的圖案或較小尺寸的檔案。');
    }
    return jpeg;
  }
  return png;
}

function setHeadLinks(rel: string, href: string) {
  const mime = href.startsWith('data:image/')
    ? href.slice(5, href.indexOf(';'))
    : undefined;
  const nodes = document.querySelectorAll(`link[rel="${rel}"]`);
  if (nodes.length === 0) {
    const el = document.createElement('link');
    el.rel = rel;
    el.href = href;
    if (mime) el.type = mime;
    document.head.appendChild(el);
    return;
  }
  nodes.forEach((node) => {
    const el = node as HTMLLinkElement;
    el.href = href;
    if (mime) el.type = mime;
  });
}

function applyDynamicManifest(iconHref: string) {
  if (manifestBlobUrl) {
    URL.revokeObjectURL(manifestBlobUrl);
    manifestBlobUrl = null;
  }
  const mime = iconHref.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
  const manifest = {
    ...PWA_MANIFEST_STATIC,
    icons: [
      { src: iconHref, sizes: '512x512', type: mime, purpose: 'any' },
      { src: iconHref, sizes: '512x512', type: mime, purpose: 'maskable' },
    ],
  };
  manifestBlobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }),
  );
  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = manifestBlobUrl;
}

/** 將目前有效圖示寫入 <head>（啟動時與更換後呼叫） */
export function applyPwaIconsToDocument(): void {
  const href = getEffectivePwaIconUrl();
  setHeadLinks('icon', href);
  setHeadLinks('apple-touch-icon', href);
  applyDynamicManifest(href);
}
