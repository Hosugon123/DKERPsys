export type ColorTheme = 'dark' | 'light';

export const COLOR_THEME_STORAGE_KEY = 'dongshan_color_theme_v1';
export const COLOR_THEME_CHANGE_EVENT = 'dongshanColorThemeChange';

const THEME_COLORS: Record<ColorTheme, string> = {
  dark: '#0d0d0d',
  light: '#f4f1eb',
};

function normalizeTheme(raw: unknown): ColorTheme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

function readDocumentTheme(): ColorTheme | null {
  if (typeof document === 'undefined') return null;
  return normalizeTheme(document.documentElement.dataset.theme);
}

function readStoredTheme(): ColorTheme {
  try {
    const stored = normalizeTheme(localStorage.getItem(COLOR_THEME_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return readDocumentTheme() ?? 'light';
}

let cachedTheme: ColorTheme = readDocumentTheme() ?? 'light';

export function getColorTheme(): ColorTheme {
  return cachedTheme;
}

export function applyColorTheme(theme: ColorTheme): void {
  cachedTheme = theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

export function setColorTheme(theme: ColorTheme): void {
  cachedTheme = theme;
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyColorTheme(theme);
  window.dispatchEvent(new Event(COLOR_THEME_CHANGE_EVENT));
}

export function toggleColorTheme(): ColorTheme {
  const next: ColorTheme = cachedTheme === 'dark' ? 'light' : 'dark';
  setColorTheme(next);
  return next;
}

/** 應用啟動時呼叫，還原使用者上次選擇的主題。 */
export function initColorTheme(): void {
  applyColorTheme(readStoredTheme());
}
