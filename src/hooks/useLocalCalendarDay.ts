import { useEffect, useState } from 'react';

function currentLocalDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** PWA may stay mounted overnight; refresh derived ranges without reloading or clearing forms. */
export function useLocalCalendarDay(): string {
  const [day, setDay] = useState(currentLocalDay);
  useEffect(() => {
    const check = () => setDay(currentLocalDay());
    const timer = window.setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}
