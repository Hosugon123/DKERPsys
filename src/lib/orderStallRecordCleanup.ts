/**
 * 刪除訂單後，若該盤點日已無其他完成盤點之單據，清除攤上日庫與銷售紀錄殘留。
 */
import type { OrderHistoryEntry } from './orderHistoryStorage';
import { listAllMergedOrdersFromStores } from './orderHistoryStorage';
import { resolveOrderStallStorageScopeId } from './scopedStallDateKey';
import { removeSalesRecordDay } from './salesRecordStorage';
import { removeStallDay } from './stallInventoryStorage';

export function purgeStallDayRecordsForDeletedOrder(
  deleted: Pick<
    OrderHistoryEntry,
    'id' | 'stallCountBasisYmd' | 'stallCountCompletedAt' | 'scopeId' | 'actorUserId' | 'actorRole'
  >,
): { removedStall: boolean; removedSales: boolean } {
  const basisYmd = deleted.stallCountBasisYmd?.trim();
  if (!basisYmd || !deleted.stallCountCompletedAt?.trim()) {
    return { removedStall: false, removedSales: false };
  }

  const scopeId = resolveOrderStallStorageScopeId(deleted);
  const othersOnSameDay = listAllMergedOrdersFromStores().filter(
    (o) =>
      o.id !== deleted.id &&
      Boolean(o.stallCountCompletedAt?.trim()) &&
      o.stallCountBasisYmd?.trim() === basisYmd &&
      resolveOrderStallStorageScopeId(o) === scopeId,
  );
  if (othersOnSameDay.length > 0) {
    return { removedStall: false, removedSales: false };
  }

  return {
    removedStall: removeStallDay(basisYmd, scopeId),
    removedSales: removeSalesRecordDay(basisYmd, scopeId),
  };
}
