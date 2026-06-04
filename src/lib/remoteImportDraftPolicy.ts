import { DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT } from './appDataBundle';
import { WORK_DRAFT_IDS, clearWorkDraft } from './workDraftStorage';

/** 遠端 bundle 匯入後應清除的草稿（會自動寫回訂單／盤點快照，易覆蓋較新雲端資料） */
const DRAFTS_TO_CLEAR_ON_REMOTE_IMPORT = [
  WORK_DRAFT_IDS.ordersLineEdit,
  WORK_DRAFT_IDS.salesRecordStallEdit,
] as const;

let listening = false;

/** 全站註冊一次：雲端合併匯入後丟棄高風險工作草稿 */
export function ensureRemoteImportDraftPolicy(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(DONGSHAN_DATA_BUNDLE_IMPORTED_EVENT, () => {
    for (const id of DRAFTS_TO_CLEAR_ON_REMOTE_IMPORT) {
      clearWorkDraft(id);
    }
  });
}
