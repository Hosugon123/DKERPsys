import { useEffect, useState } from 'react';

/** 與 Tailwind `sm`（640px）對齊：小於 640px 視為窄螢幕／手機優先版面 */
const NARROW_QUERY = '(max-width: 639px)';

export function useIsNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
