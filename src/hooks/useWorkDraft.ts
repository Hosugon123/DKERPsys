import { useEffect, useMemo, useRef } from 'react';
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
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!active) {
      clearWorkDraft(id);
      return;
    }
    const timer = window.setTimeout(() => saveWorkDraft(id, draftRef.current), debounceMs);
    return () => window.clearTimeout(timer);
  }, [id, draftJson, active, debounceMs]);
}

/** 自訂 debounce 寫入（例：從 ref 收集子列快照） */
export function usePersistWorkDraftEffect(
  id: string,
  active: boolean,
  save: () => void,
  deps: readonly unknown[],
  debounceMs = 400,
): void {
  useEffect(() => {
    if (!active) {
      clearWorkDraft(id);
      return;
    }
    const timer = window.setTimeout(save, debounceMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save/deps 由呼叫端控制
  }, [id, active, debounceMs, ...deps]);
}
