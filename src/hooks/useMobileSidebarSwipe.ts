import { useCallback, useRef, type TouchEvent as ReactTouchEvent } from 'react';

/** 左側邊緣可觸發開啟 sidebar 的寬度（px） */
const LEFT_EDGE_PX = 40;
/** 向右滑開啟 sidebar 的最小位移 */
const OPEN_THRESHOLD_PX = 56;
/** 向左滑關閉 sidebar 的最小位移 */
const CLOSE_THRESHOLD_PX = 48;
/** 判定為水平滑動：|dx| 須大於 |dy| × 此比例 */
const HORIZONTAL_RATIO = 1.2;
const AXIS_LOCK_PX = 10;

export type MobileSidebarSwipeOptions = {
  enabled: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

export type MobileSidebarSwipeHandlers = {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  /** 回傳 true 表示已消耗此次水平滑動手勢 */
  onTouchEnd: (e: ReactTouchEvent) => boolean;
  onTouchCancel: (e: ReactTouchEvent) => boolean;
  /** 水平滑動進行中時為 true，供下拉重整等手勢讓路 */
  isHorizontalSwipeActive: () => boolean;
};

type TouchTrack = {
  x: number;
  y: number;
  fromEdge: boolean;
  tracking: boolean;
  axisLocked: boolean;
  horizontal: boolean;
};

function emptyTrack(): TouchTrack {
  return {
    x: 0,
    y: 0,
    fromEdge: false,
    tracking: false,
    axisLocked: false,
    horizontal: false,
  };
}

/**
 * 手機版側欄滑動手勢：
 * - 自左側邊緣向右滑 → 開啟 sidebar
 * - 側欄開啟時向左滑 → 關閉 sidebar
 */
export function useMobileSidebarSwipe({
  enabled,
  isOpen,
  setIsOpen,
}: MobileSidebarSwipeOptions): MobileSidebarSwipeHandlers {
  const trackRef = useRef<TouchTrack>(emptyTrack());
  const horizontalActiveRef = useRef(false);

  const reset = useCallback(() => {
    trackRef.current = emptyTrack();
    horizontalActiveRef.current = false;
  }, []);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      trackRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        fromEdge: touch.clientX <= LEFT_EDGE_PX,
        tracking: true,
        axisLocked: false,
        horizontal: false,
      };
      horizontalActiveRef.current = false;
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      const track = trackRef.current;
      if (!enabled || !track.tracking) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - track.x;
      const dy = touch.clientY - track.y;

      if (!track.axisLocked) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        track.axisLocked = true;
        track.horizontal = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO;
        if (!track.horizontal) {
          track.tracking = false;
          return;
        }
      }

      if (!track.horizontal) return;

      const opening = !isOpen && track.fromEdge && dx > 0;
      const closing = isOpen && dx < 0;
      if (opening || closing) {
        horizontalActiveRef.current = true;
        if (e.cancelable) e.preventDefault();
      }
    },
    [enabled, isOpen],
  );

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent): boolean => {
      const track = trackRef.current;
      const wasHorizontal = track.tracking && track.horizontal;
      if (!enabled || !wasHorizontal) {
        reset();
        return false;
      }

      const touch = e.changedTouches[0];
      if (!touch) {
        reset();
        return wasHorizontal;
      }

      const dx = touch.clientX - track.x;
      if (!isOpen && track.fromEdge && dx >= OPEN_THRESHOLD_PX) {
        setIsOpen(true);
      } else if (isOpen && dx <= -CLOSE_THRESHOLD_PX) {
        setIsOpen(false);
      }

      reset();
      return true;
    },
    [enabled, isOpen, reset, setIsOpen],
  );

  const isHorizontalSwipeActive = useCallback(() => horizontalActiveRef.current, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    isHorizontalSwipeActive,
  };
}
