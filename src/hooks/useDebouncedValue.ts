import { useEffect, useState } from 'react';

/** 輸入欄去抖動，供金額落差等衍生顯示使用（避免逐字輸入時出現暫時錯誤數字）。 */
export function useDebouncedValue<T>(value: T, delayMs: number, active = true): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!active) {
      setDebounced(value);
      return;
    }
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs, active]);
  return debounced;
}
