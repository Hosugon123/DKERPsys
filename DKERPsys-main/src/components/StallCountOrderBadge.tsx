import { useEffect, useState } from 'react';
import { isOrderStallCountDone } from '../lib/salesRecordStorage';
import { cn } from '../lib/utils';

const badgeClass =
  'px-2 py-0.5 rounded text-[0.625rem] font-medium border bg-sky-600/10 text-sky-300 border-sky-500/30';

type Props = {
  /** 訂單建立時間 ISO 字串 */
  createdAtIso: string;
  /** 有值表示該單已在攤上按「盤點完成」押記 */
  stallCountCompletedAt?: string | null;
  className?: string;
};

/** 在訂單列顯示「已盤點」：僅當該筆訂單有盤點完成押記。 */
export function StallCountOrderBadge({ createdAtIso, stallCountCompletedAt, className }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener('salesRecordUpdated', h);
    window.addEventListener('orderHistoryUpdated', h);
    window.addEventListener('franchiseManagementOrdersUpdated', h);
    return () => {
      window.removeEventListener('salesRecordUpdated', h);
      window.removeEventListener('orderHistoryUpdated', h);
      window.removeEventListener('franchiseManagementOrdersUpdated', h);
    };
  }, []);
  if (!isOrderStallCountDone(createdAtIso, stallCountCompletedAt)) return null;
  return <span className={cn(badgeClass, className)}>已盤點</span>;
}
