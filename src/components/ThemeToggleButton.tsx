import { Moon, Sun } from 'lucide-react';
import { useColorTheme } from '../hooks/useColorTheme';
import { cn } from '../lib/utils';

type ThemeToggleButtonProps = {
  className?: string;
  iconSize?: number;
};

export default function ThemeToggleButton({ className, iconSize = 18 }: ThemeToggleButtonProps) {
  const { isDark, toggleTheme } = useColorTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        'shrink-0 flex h-9 w-9 items-center justify-center rounded-lg border border-ds text-ds-subtle transition-colors hover:bg-ds-surface-hover hover:text-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50',
        className,
      )}
      aria-label={isDark ? '切換至淺色主題' : '切換至深色主題'}
      title={isDark ? '淺色模式' : '深色模式'}
    >
      {isDark ? <Sun size={iconSize} aria-hidden /> : <Moon size={iconSize} aria-hidden />}
    </button>
  );
}
