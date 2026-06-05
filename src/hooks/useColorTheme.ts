import { useCallback, useSyncExternalStore } from 'react';
import {
  COLOR_THEME_CHANGE_EVENT,
  getColorTheme,
  setColorTheme,
  toggleColorTheme,
  type ColorTheme,
} from '../lib/colorTheme';

function subscribeColorTheme(onStoreChange: () => void): () => void {
  window.addEventListener(COLOR_THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(COLOR_THEME_CHANGE_EVENT, onStoreChange);
}

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribeColorTheme, getColorTheme, () => 'dark' as ColorTheme);
  const toggleTheme = useCallback(() => {
    toggleColorTheme();
  }, []);
  const selectTheme = useCallback((next: ColorTheme) => {
    setColorTheme(next);
  }, []);
  return { theme, isDark: theme === 'dark', toggleTheme, setTheme: selectTheme };
}
