export type ColorTheme = 'dark' | 'light';

export const COLOR_THEME_STORAGE_KEY = 'dongshan_color_theme_v1';
const COLOR_THEME_VERSION_STORAGE_KEY = 'dongshan_color_theme_version_v2';
export const COLOR_THEME_CHANGE_EVENT = 'dongshanColorThemeChange';

const THEME_COLORS: Record<ColorTheme, string> = {
  dark: '#0d0d0d',
  light: '#f4f1eb',
};

const THEME_TOKENS: Record<ColorTheme, Record<string, string>> = {
  dark: {
    '--ds-bg-root': '#0d0d0d',
    '--ds-bg-sidebar': '#0f0f0f',
    '--ds-bg-topbar': '#111111',
    '--ds-bg-surface': '#18181b',
    '--ds-bg-surface-hover': '#27272a',
    '--ds-bg-input': '#09090b',
    '--ds-bg-muted': '#141414',
    '--ds-bg-subtle': '#27272a',
    '--ds-shadow-color': 'rgb(0 0 0 / 0.35)',
    '--ds-amber-tint': 'rgb(251 191 36 / 0.12)',
    '--ds-rose-tint': 'rgb(190 18 60 / 0.12)',
    '--ds-sky-tint': 'rgb(2 132 199 / 0.12)',
    '--ds-amber-text': '#fbbf24',
    '--ds-amber-text-strong': '#fde68a',
    '--ds-rose-text': '#fda4af',
    '--ds-border': '#27272a',
    '--ds-border-muted': '#3f3f46',
    '--ds-text-primary': '#f5f2ed',
    '--ds-text-muted': '#71717a',
    '--ds-text-subtle': '#a1a1aa',
    '--ds-overlay': 'rgb(0 0 0 / 0.5)',
    '--ds-scrollbar-thumb': '#27272a',
    '--ds-scrollbar-thumb-hover': '#3f3f46',
  },
  light: {
    '--ds-bg-root': '#f5f2ed',
    '--ds-bg-sidebar': '#fffdf8',
    '--ds-bg-topbar': '#fffefa',
    '--ds-bg-surface': '#fffaf4',
    '--ds-bg-surface-hover': '#eee7dd',
    '--ds-bg-input': '#fffdf8',
    '--ds-bg-muted': '#f1ebe2',
    '--ds-bg-subtle': '#e7ded2',
    '--ds-shadow-color': 'rgb(68 54 38 / 0.11)',
    '--ds-amber-tint': '#fff6dd',
    '--ds-rose-tint': '#fff0f2',
    '--ds-sky-tint': '#eaf7ff',
    '--ds-amber-text': '#a8550b',
    '--ds-amber-text-strong': '#7c3f09',
    '--ds-rose-text': '#be123c',
    '--ds-border': '#d7cbbb',
    '--ds-border-muted': '#bcae9b',
    '--ds-text-primary': '#211c18',
    '--ds-text-muted': '#5f554b',
    '--ds-text-subtle': '#877a6b',
    '--ds-overlay': 'rgb(33 28 24 / 0.34)',
    '--ds-scrollbar-thumb': '#bcae9b',
    '--ds-scrollbar-thumb-hover': '#9f8f7d',
  },
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
    const hasCurrentPreference = localStorage.getItem(COLOR_THEME_VERSION_STORAGE_KEY) === '2';
    if (stored === 'dark' && !hasCurrentPreference) return 'light';
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

function persistColorThemePreference(theme: ColorTheme): void {
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
    localStorage.setItem(COLOR_THEME_VERSION_STORAGE_KEY, '2');
  } catch {
    /* ignore */
  }
}

export function applyColorTheme(theme: ColorTheme): void {
  cachedTheme = theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const [name, value] of Object.entries(THEME_TOKENS[theme])) {
    root.style.setProperty(name, value);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

export function repairColorThemeIfNeeded(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const currentTheme = normalizeTheme(root.dataset.theme);
  const bgRoot = getComputedStyle(root).getPropertyValue('--ds-bg-root').trim().toLowerCase();
  const expectedBgRoot = THEME_TOKENS[cachedTheme]['--ds-bg-root'].toLowerCase();
  if (currentTheme !== cachedTheme || bgRoot !== expectedBgRoot) {
    applyColorTheme(cachedTheme);
  }
}

export function setColorTheme(theme: ColorTheme): void {
  cachedTheme = theme;
  persistColorThemePreference(theme);
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
  const theme = readStoredTheme();
  applyColorTheme(theme);
  persistColorThemePreference(theme);
}
