import { useCallback, useEffect, useRef } from 'react';
import { DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT } from '../lib/appDataBundle';

type UseStorageRevisionGuardOptions = {
  /** 是否正在編輯會寫回 storage 的資料 */
  active: boolean;
  /** 讀取目前 storage 上該筆資料的修訂時間（毫秒） */
  readRevisionMs: () => number;
  /** 遠端／本機同步後 storage 比編輯開始時更新 → 重載 UI，勿用舊 state 寫回 */
  onStorageNewer: () => void;
  /** 額外觸發重讀的事件（如 orderHistoryUpdated） */
  extraEvents?: string[];
};

/**
 * 防止「畫面仍握著舊草稿，卻在自動儲存／debounce 時覆寫較新的雲端資料」。
 */
export function useStorageRevisionGuard({
  active,
  readRevisionMs,
  onStorageNewer,
  extraEvents = [],
}: UseStorageRevisionGuardOptions) {
  const baselineMsRef = useRef(0);

  const bumpBaseline = useCallback(() => {
    baselineMsRef.current = readRevisionMs();
  }, [readRevisionMs]);

  useEffect(() => {
    if (active) bumpBaseline();
  }, [active, bumpBaseline]);

  useEffect(() => {
    if (!active) return;
    const check = () => {
      const ms = readRevisionMs();
      if (ms > baselineMsRef.current) {
        baselineMsRef.current = ms;
        onStorageNewer();
      }
    };
    window.addEventListener(DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT, check);
    for (const ev of extraEvents) {
      window.addEventListener(ev, check);
    }
    return () => {
      window.removeEventListener(DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT, check);
      for (const ev of extraEvents) {
        window.removeEventListener(ev, check);
      }
    };
  }, [active, readRevisionMs, onStorageNewer, extraEvents]);

  const canWriteWithoutStaleOverwrite = useCallback((): boolean => {
    return readRevisionMs() <= baselineMsRef.current;
  }, [readRevisionMs]);

  const noteWriteSucceeded = useCallback(() => {
    baselineMsRef.current = readRevisionMs();
  }, [readRevisionMs]);

  return { canWriteWithoutStaleOverwrite, noteWriteSucceeded, bumpBaseline };
}
