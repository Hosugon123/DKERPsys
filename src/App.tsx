/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard, { type DashboardViewAsTarget } from './views/Dashboard';
import LoginScreen from './views/LoginScreen';
import Products from './views/Products';
import Permissions from './views/Permissions';
import Procurement from './views/Procurement';
import Orders from './views/Orders';
import { UserRole } from './views/Orders';
import StallInventory from './views/StallInventory';
import SalesRecord from './views/SalesRecord';
import Accounting from './views/Accounting';
import DataHub from './views/DataHub';
import { setSupplyCatalogRetailView, userRoleToSupplyRetailView } from './lib/supplyCatalog';
import {
  AUTH_SESSION_CHANGED_EVENT,
  clearSession,
  ensureAuthBootstrap,
  isSuperAdminSession,
  readSession,
  validateSession,
  type AuthSession,
} from './lib/authSession';
import { serializeDongshanDataBundle } from './lib/appDataBundle';
import { initRemoteSyncOnAppLoad, pushRemoteIfLocalBundleChangedSince } from './services/apiService';
import { getStorageMode } from './services/storageMode';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('employee');
  const [currentView, setCurrentView] = useState('dashboard');
  /** 總部以加盟主視角檢視（view-as）的目標；非 dashboard 頁時自動清除 */
  const [viewAsFranchisee, setViewAsFranchisee] = useState<DashboardViewAsTarget | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const scrollLockYRef = useRef(0);

  const isSuperAdmin = session ? isSuperAdminSession(session.loginId) : false;

  useEffect(() => {
    void (async () => {
      if (getStorageMode() === 'remote') {
        await initRemoteSyncOnAppLoad();
      }
      const bundleBeforeAuth = serializeDongshanDataBundle();
      ensureAuthBootstrap();
      if (getStorageMode() === 'remote') {
        await pushRemoteIfLocalBundleChangedSince(bundleBeforeAuth);
      }
      const s = readSession();
      if (s && validateSession(s)) setSession(s);
      else {
        clearSession();
        setSession(null);
      }
      setAuthReady(true);
    })();
  }, []);

  useEffect(() => {
    const onAuth = () => {
      const s = readSession();
      if (s && validateSession(s)) setSession(s);
      else {
        clearSession();
        setSession(null);
      }
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onAuth);
  }, []);

  useEffect(() => {
    if (!session) return;
    setUserRole(session.role);
  }, [session]);

  useEffect(() => {
    // 切換登入狀態時重置頁面：員工預設進訂單管理，其餘角色進儀表板。
    if (!session) {
      setCurrentView('dashboard');
      return;
    }
    setCurrentView(session.role === 'employee' ? 'orders' : 'dashboard');
  }, [session]);

  useEffect(() => {
    setSupplyCatalogRetailView(userRoleToSupplyRetailView(userRole));
  }, [userRole]);

  useEffect(() => {
    if (userRole !== 'admin' && currentView === 'permissions') {
      setCurrentView('dashboard');
    }
  }, [userRole, currentView]);

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
    if (currentView === 'orderHistory') {
      setCurrentView('orders');
    }
  }, [userRole, currentView]);

  useEffect(() => {
    if (currentView !== 'dashboard' && viewAsFranchisee) {
      setViewAsFranchisee(null);
    }
  }, [currentView, viewAsFranchisee]);

  useEffect(() => {
    if (userRole !== 'admin' && viewAsFranchisee) {
      setViewAsFranchisee(null);
    }
  }, [userRole, viewAsFranchisee]);

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setCurrentView('dashboard');
  };

  const renderView = () => {
    if (!session) return null;
    switch (currentView) {
      case 'dashboard':
        return (
          <Dashboard
            userRole={userRole}
            viewAsFranchisee={viewAsFranchisee}
            onSelectFranchisee={(target) => setViewAsFranchisee(target)}
            onExitViewAs={() => setViewAsFranchisee(null)}
          />
        );
      case 'orders':
        return <Orders userRole={userRole} />;
      case 'products':
        return <Products />;
      case 'permissions':
        return <Permissions userRole={userRole} sessionLoginId={session.loginId} />;
      case 'procurement':
        return <Procurement userRole={userRole} />;
      case 'stallInventory':
        return <StallInventory userRole={userRole} />;
      case 'salesRecord':
        return <SalesRecord userRole={userRole} />;
      case 'accounting':
        return <Accounting userRole={userRole} />;
      case 'dataHub':
        return <DataHub userRole={userRole} />;
      default:
        return <Dashboard userRole={userRole} />;
    }
  };

  if (!authReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0d0d0d] text-zinc-500">
        載入中…
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onSuccess={() => {
          const s = readSession();
          if (s && validateSession(s)) setSession(s);
        }}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-[#0d0d0d] font-sans text-[#f5f2ed] overflow-hidden selection:bg-amber-600/30">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        isOpen={isMobileMenuOpen}
        setIsOpen={setIsMobileMenuOpen}
        userRole={userRole}
        isSuperAdmin={isSuperAdmin}
        onLogout={handleLogout}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          loginId={session.loginId}
          userRole={userRole}
          onLogout={handleLogout}
        />
        <main className="uio-touch-host min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pt-4 md:px-6 md:pb-6 md:pt-6 lg:px-8 lg:pb-8 lg:pt-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
