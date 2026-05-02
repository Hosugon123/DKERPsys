import { useEffect, useMemo, useState } from 'react';
import { getAllSupplyItems, userRoleToSupplyRetailView } from '../lib/supplyCatalog';
import type { UserRole } from '../views/Orders';

/** 品名／單價有本機覆寫時會隨事件更新；零售參考依身分與加盟專庫分開。 */
export function useSupplyCatalogItems(userRole: UserRole) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener('supplyCatalogUpdated', h);
    return () => window.removeEventListener('supplyCatalogUpdated', h);
  }, []);
  const view = useMemo(() => userRoleToSupplyRetailView(userRole), [userRole]);
  return useMemo(() => getAllSupplyItems(view), [tick, view]);
}
