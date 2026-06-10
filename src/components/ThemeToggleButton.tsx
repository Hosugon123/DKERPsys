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
      aria-label={isDark ? '目前深色模式，切換至淺色模式' : '目前淺色模式，切換至深色模式'}
      title={isDark ? '目前深色，切換淺色' : '目前淺色，切換深色'}
    >
      {isDark ? <Sun size={iconSize} aria-hidden /> : <Moon size={iconSize} aria-hidden />}
    </button>
  );
}
