import { getStoreCode3, normalizeStoreCode3Digits } from './storeCodeStorage';

const SEQ_KEY = 'dongshan_order_seq_v1';

function readSeqMap(): Record<string, number> {
  try {
    const r = localStorage.getItem(SEQ_KEY);
    if (!r) return {};
    const o = JSON.parse(r) as Record<string, number>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function writeSeqMap(m: Record<string, number>) {
  localStorage.setItem(SEQ_KEY, JSON.stringify(m));
}

function ymd8Local(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${mo}${day}`;
}

/**
 * 從既有單號找當日同店之最大序號：店號(3) + 日期(8) + 序號(至少 1 位)
 */
function maxSeqFromIds(store3: string, ymd8: string, existingOrderIds: string[]): number {
  const esc = store3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}${ymd8}(\\d+)$`);
  let max = 0;
  for (const id of existingOrderIds) {
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/**
 * 新訂單流水：店號(3) + 日期 YYYYMMDD(8) + 當日第 n 筆（1 起，不補 0）→ 如 001202604251
 * @param storeCode3 指定店號（加盟主／其員工）；未傳則用本機「總部店號」{@link getStoreCode3}
 */
export function allocateOrderSerialId(
  existingOrderIds: string[],
  at: Date = new Date(),
  storeCode3?: string
): string {
  const store3 =
    storeCode3 != null && String(storeCode3).trim() !== ''
      ? normalizeStoreCode3Digits(storeCode3)
      : getStoreCode3();
  const ymd8 = ymd8Local(at);
  const counterKey = `${store3}-${ymd8}`;

  const fromIds = maxSeqFromIds(store3, ymd8, existingOrderIds);
  const map = readSeqMap();
  const last = map[counterKey] ?? 0;
  const next = Math.max(fromIds, last) + 1;
  map[counterKey] = next;
  writeSeqMap(map);
  return `${store3}${ymd8}${next}`;
}
