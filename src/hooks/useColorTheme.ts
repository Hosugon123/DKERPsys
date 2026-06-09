import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  COLOR_THEME_CHANGE_EVENT,
  getColorTheme,
  repairColorThemeIfNeeded,
  setColorTheme,
  toggleColorTheme,
  type ColorTheme,
} from '../lib/colorTheme';

function subscribeColorTheme(onStoreChange: () => void): () => void {
  window.addEventListener(COLOR_THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(COLOR_THEME_CHANGE_EVENT, onStoreChange);
}

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribeColorTheme, getColorTheme, () => 'light' as ColorTheme);
  useEffect(() => {
    repairColorThemeIfNeeded();
    const repair = () => repairColorThemeIfNeeded();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') repair();
    };
    window.addEventListener('focus', repair);
    window.addEventListener('pageshow', repair);
    window.addEventListener('storage', repair);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', repair);
      window.removeEventListener('pageshow', repair);
      window.removeEventListener('storage', repair);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [theme]);
  const toggleTheme = useCallback(() => {
    toggleColorTheme();
  }, []);
  const selectTheme = useCallback((next: ColorTheme) => {
    setColorTheme(next);
  }, []);
  return { theme, isDark: theme === 'dark', toggleTheme, setTheme: selectTheme };
}
