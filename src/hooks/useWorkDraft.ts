import { useEffect, useRef } from 'react';
import { clearWorkDraft, loadWorkDraft, saveWorkDraft } from '../lib/workDraftStorage';

/** 掛載時讀取並清除草稿（僅還原一次） */
export function useRestoreWorkDraft<T>(id: string): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (ref.current === undefined) {
    const loaded = loadWorkDraft<T>(id);
    if (loaded != null) {
      ref.current = loaded;
      clearWorkDraft(id);
    }
  }
  return ref.current;
}

/** active 時 debounce 寫入草稿；inactive 時清除 */
export function usePersistWorkDraft<T>(
  id: string,
  draft: T,
  active: boolean,
  debounceMs = 400,
): void {
  useEffect(() => {
    if (!active) {
      clearWorkDraft(id);
      return;
    }
    const timer = window.setTimeout(() => saveWorkDraft(id, draft), debounceMs);
    return () => window.clearTimeout(timer);
  }, [id, draft, active, debounceMs]);
}
