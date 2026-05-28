/**
 * 登記進行中的表單／盤點編輯，避免部署自動重整或整頁 reload 清掉僅存在記憶體的草稿。
 */
const blocks = new Map<string, string>();

/** @returns 取消登記 */
export function registerUnsavedWork(blockId: string, label?: string): () => void {
  blocks.set(blockId, label?.trim() || blockId);
  return () => {
    blocks.delete(blockId);
  };
}

export function hasUnsavedWork(): boolean {
  return blocks.size > 0;
}

export function listUnsavedWorkLabels(): string[] {
  return Array.from(blocks.values());
}

export function canReloadAppShell(): boolean {
  return !hasUnsavedWork();
}
