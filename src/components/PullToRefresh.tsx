import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { cn } from '../lib/utils';

const PULL_THRESHOLD_PX = 68;
const PULL_MAX_PX = 112;
const PULL_DAMPING = 0.45;

type PullToRefreshProps = {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  /** 僅在手機等窄螢幕啟用 */
  enabled?: boolean;
  className?: string;
};

export default function PullToRefresh({
  children,
  onRefresh,
  enabled = true,
  className,
}: PullToRefreshProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const touchStartY = useRef(0);
  const pullingRef = useRef(false);
  const pullYRef = useRef(0);

  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  onRefreshRef.current = onRefresh;

  const canPull = useCallback(() => {
    const el = scrollRef.current;
    return Boolean(el && el.scrollTop <= 0);
  }, []);

  const resetPull = useCallback(() => {
    pullingRef.current = false;
    pullYRef.current = 0;
    setPullY(0);
  }, []);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    setHint('重新整理中…');
    try {
      await onRefreshRef.current();
      setHint('已更新');
      window.setTimeout(() => setHint(null), 900);
    } catch {
      setHint('重新整理失敗');
      window.setTimeout(() => setHint(null), 2200);
    } finally {
      setRefreshing(false);
      resetPull();
    }
  }, [resetPull]);

  const onTouchStart = (e: ReactTouchEvent<HTMLElement>) => {
    if (!enabled || refreshing) return;
    if (!canPull()) return;
    touchStartY.current = e.touches[0]?.clientY ?? 0;
    pullingRef.current = true;
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLElement>) => {
    if (!enabled || !pullingRef.current || refreshing) return;
    if (!canPull()) {
      resetPull();
      return;
    }
    const y = e.touches[0]?.clientY ?? touchStartY.current;
    const dy = y - touchStartY.current;
    if (dy <= 0) {
      setPullY(0);
      return;
    }
    const next = Math.min(PULL_MAX_PX, dy * PULL_DAMPING);
    if (next > 0 && e.cancelable) {
      e.preventDefault();
    }
    pullYRef.current = next;
    setPullY(next);
  };

  const onTouchEnd = () => {
    if (!enabled || !pullingRef.current || refreshing) return;
    pullingRef.current = false;
    if (pullYRef.current >= PULL_THRESHOLD_PX) {
      void runRefresh();
      return;
    }
    resetPull();
  };

  useEffect(() => {
    if (!enabled) resetPull();
  }, [enabled, resetPull]);

  const readyToRelease = pullY >= PULL_THRESHOLD_PX;
  const showChrome = enabled && (pullY > 0 || refreshing || hint);

  return (
    <main
      ref={scrollRef}
      className={cn(className, enabled && 'touch-pan-y')}
      onTouchStart={enabled ? onTouchStart : undefined}
      onTouchMove={enabled ? onTouchMove : undefined}
      onTouchEnd={enabled ? onTouchEnd : undefined}
      onTouchCancel={enabled ? onTouchEnd : undefined}
    >
      {showChrome ? (
        <div
          className="pointer-events-none sticky top-0 z-20 flex justify-center overflow-hidden"
          style={{ height: refreshing ? PULL_THRESHOLD_PX : pullY }}
          aria-live="polite"
        >
          <div
            className={cn(
              'flex items-center gap-1.5 pt-2 text-[11px] font-medium transition-colors',
              readyToRelease || refreshing ? 'text-amber-400' : 'text-zinc-500',
            )}
          >
            {refreshing ? (
              <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
            ) : (
              <ArrowDown
                size={14}
                className={cn('shrink-0 transition-transform', readyToRelease && 'rotate-180')}
                aria-hidden
              />
            )}
            <span>{hint ?? (readyToRelease ? '放開重新整理' : '下拉重新整理')}</span>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'min-h-0',
          enabled && pullY > 0 && !refreshing && 'transition-transform duration-150 ease-out',
        )}
        style={enabled && pullY > 0 && !refreshing ? { transform: `translateY(${pullY}px)` } : undefined}
      >
        {children}
      </div>
    </main>
  );
}
