/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './views/Dashboard';
import Products from './views/Products';
import Permissions from './views/Permissions';
import Procurement from './views/Procurement';
import Orders from './views/Orders';
import { UserRole } from './views/Orders';
import OrderHistory from './views/OrderHistory';
import StallInventory from './views/StallInventory';
import SalesRecord from './views/SalesRecord';
import Accounting from './views/Accounting';
import DataHub from './views/DataHub';
import { setSupplyCatalogRetailView, userRoleToSupplyRetailView } from './lib/supplyCatalog';

export default function App() {
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [currentView, setCurrentView] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const scrollLockYRef = useRef(0);

  useEffect(() => {
    setSupplyCatalogRetailView(userRoleToSupplyRetailView(userRole));
  }, [userRole]);

  /** 手機側欄開啟時鎖定背景捲動（iOS Safari 用 fixed + 還原 scrollY） */
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    scrollLockYRef.current = window.scrollY;
    const y = scrollLockYRef.current;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.left = prev.left;
      document.body.style.right = prev.right;
      document.body.style.width = prev.width;
      window.scrollTo(0, y);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (userRole === 'employee' && currentView === 'accounting') {
      setCurrentView('orders');
    }
  }, [userRole, currentView]);

  const renderView = () => {
    switch(currentView) {
      case 'dashboard': return <Dashboard userRole={userRole} />;
      case 'orders': return <Orders userRole={userRole} />;
      case 'products': return <Products />;
      case 'permissions': return <Permissions userRole={userRole} />;
      case 'procurement': return <Procurement userRole={userRole} />;
      case 'orderHistory': return <OrderHistory userRole={userRole} />;
      case 'stallInventory': return <StallInventory userRole={userRole} />;
      case 'salesRecord': return <SalesRecord userRole={userRole} />;
      case 'accounting': return <Accounting userRole={userRole} />;
      case 'dataHub': return <DataHub userRole={userRole} />;
      default: return <Dashboard userRole={userRole} />;
    }
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-[#0d0d0d] text-[#f5f2ed] font-sans overflow-hidden selection:bg-amber-600/30">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        isOpen={isMobileMenuOpen}
        setIsOpen={setIsMobileMenuOpen}
        userRole={userRole}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          userRole={userRole}
          setUserRole={setUserRole}
        />
        <main className="uio-touch-host min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6 md:pt-6 lg:px-8 lg:pb-8 lg:pt-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
