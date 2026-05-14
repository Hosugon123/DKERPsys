import { cn } from '../lib/utils';
import { formatJinFromLiangQty, pieceUnitIsLiang } from '../lib/liangJinQty';

type Props = {
  liangQty: number;
  pieceUnit: string | undefined | null;
  className?: string;
};

/** 單位為「兩」時，在數量旁顯示換算值（1斤=16兩；不另標「斤」字）。 */
export function LiangJinQtyHint({ liangQty, pieceUnit, className }: Props) {
  if (!pieceUnitIsLiang(pieceUnit)) return null;
  if (!Number.isFinite(liangQty) || liangQty < 0) return null;
  const s = formatJinFromLiangQty(liangQty);
  if (!s) return null;
  return (
    <span className={cn('text-zinc-500 tabular-nums whitespace-nowrap', className)}>（{s}）</span>
  );
}
