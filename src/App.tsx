/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setSupplyCatalogRetailView(userRoleToSupplyRetailView(userRole));
  }, [userRole]);

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
    <div className="flex h-[100dvh] bg-[#0d0d0d] text-[#f5f2ed] font-sans overflow-hidden selection:bg-amber-600/30">
       <Sidebar 
         currentView={currentView} 
         setCurrentView={setCurrentView} 
         isOpen={isMobileMenuOpen} 
         setIsOpen={setIsMobileMenuOpen} 
         userRole={userRole}
       />
       <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
         <Topbar 
           setIsMobileMenuOpen={setIsMobileMenuOpen} 
           userRole={userRole} 
           setUserRole={setUserRole} 
         />
         <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
           {renderView()}
         </main>
       </div>
    </div>
  );
}
