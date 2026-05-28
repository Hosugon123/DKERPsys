import { useEffect } from 'react';
import { registerUnsavedWork } from '../lib/unsavedWorkGuard';

/** 當 active 為 true 時登記未儲存工作，卸載或 active 變 false 時自動取消。 */
export function useUnsavedWorkBlock(blockId: string, active: boolean, label?: string): void {
  useEffect(() => {
    if (!active) return;
    return registerUnsavedWork(blockId, label);
  }, [blockId, active, label]);
}
