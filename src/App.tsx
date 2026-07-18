/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, useDeferredValue, lazy, Suspense, type ReactNode } from 'react';
import DeployUpdateBanner from './components/DeployUpdateBanner';
import PullToRefresh from './components/PullToRefresh';
import { useIsNarrowScreen } from './hooks/useIsNarrowScreen';
import { useMobileSidebarSwipe } from './hooks/useMobileSidebarSwipe';
import {
  APP_PAGE_REFRESH_EVENT,
  PULL_RELOAD_QUERY_KEY,
  refreshAppPageData,
} from './lib/appRefresh';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import type { DashboardViewAsTarget } from './views/Dashboard';
const Dashboard = lazy(() => import('./views/Dashboard'));
import LoginScreen from './views/LoginScreen';
const Products = lazy(() => import('./views/Products'));
const Permissions = lazy(() => import('./views/Permissions'));
const Procurement = lazy(() => import('./views/Procurement'));
const Orders = lazy(() => import('./views/Orders'));
import type { UserRole } from './views/Orders';
const StallInventory = lazy(() => import('./views/StallInventory'));
const SalesRecord = lazy(() => import('./views/SalesRecord'));
const Accounting = lazy(() => import('./views/Accounting'));
const DataHub = lazy(() => import('./views/DataHub'));
import { migrateLegacyFranchiseeRetailToAllOwners } from './lib/franchiseeRetailState';
import { resolveSupplyRetailViewForSession, setSupplyCatalogRetailView } from './lib/supplyCatalog';
import {
  AUTH_SESSION_CHANGED_EVENT,
  clearSession,
  ensureAuthBootstrap,
  isSuperAdminSession,
  readSession,
  validateSession,
  type AuthSession,
} from './lib/authSession';
import { getDefaultLandingViewForRole } from './lib/sidebarNavConfig';
import {
  initRemoteSyncOnAppLoad,
  refreshRemoteBundleVersionIfStale,
} from './services/apiService';
import { getStorageMode } from './services/storageMode';
import { ensureRemoteImportDraftPolicy } from './lib/remoteImportDraftPolicy';
import { reportPerfMetric, timeAsync, timeSync } from './lib/performanceDebug';

ensureRemoteImportDraftPolicy();

function ViewLoadingFallback() {
  return <div className="text-sm text-zinc-500">載入中...</div>;
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('employee');
  const [currentView, setCurrentView] = useState('dashboard');
  const deferredView = useDeferredValue(currentView);
  /** 總部以加盟主視角檢視（view-as）的目標；非 dashboard 頁時自動清除 */
  const [viewAsFranchisee, setViewAsFranchisee] = useState<DashboardViewAsTarget | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);
  const isNarrow = useIsNarrowScreen();
  const scrollLockYRef = useRef(0);
  const sidebarSwipe = useMobileSidebarSwipe({
    enabled: isNarrow,
    isOpen: isMobileMenuOpen,
    setIsOpen: setIsMobileMenuOpen,
  });

  const isSuperAdmin = session ? isSuperAdminSession(session.loginId) : false;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(PULL_RELOAD_QUERY_KEY)) {
      url.searchParams.delete(PULL_RELOAD_QUERY_KEY);
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(null, '', next);
    }
  }, []);

  useEffect(() => {
    if (getStorageMode() !== 'remote') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshRemoteBundleVersionIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    void (async () => {
      timeSync('auth.bootstrap', () => ensureAuthBootstrap());
      const s = timeSync('auth.read-session', () => readSession());
      if (s && validateSession(s)) setSession(s);
      else {
        clearSession({ notify: false });
        setSession(null);
      }
      setAuthReady(true);
      reportPerfMetric({ name: 'app.auth-ready', durationMs: performance.now() });
      if (getStorageMode() === 'remote') {
        void timeAsync('remote.init-on-app-load', () => initRemoteSyncOnAppLoad());
      }
    })();
  }, []);

  useEffect(() => {
    const onAuth = () => {
      const s = readSession();
      if (s && validateSession(s)) setSession(s);
      else {
        clearSession({ notify: false });
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
    // 切換登入狀態時開啟主選單排序後的第一頁（與側邊欄「調整導覽列順序」一致）
    if (!session) {
      setCurrentView('dashboard');
      return;
    }
    setCurrentView(getDefaultLandingViewForRole(session.role));
  }, [session]);

  useEffect(() => {
    migrateLegacyFranchiseeRetailToAllOwners();
    setSupplyCatalogRetailView(resolveSupplyRetailViewForSession());
  }, [userRole, session?.userId]);

  useEffect(() => {
    const onPageRefresh = () => setPageRefreshKey((k) => k + 1);
    window.addEventListener(APP_PAGE_REFRESH_EVENT, onPageRefresh);
    return () => window.removeEventListener(APP_PAGE_REFRESH_EVENT, onPageRefresh);
  }, []);

  const handlePullRefresh = useCallback(async () => {
    await refreshAppPageData({ reloadShell: true });
  }, []);

  useEffect(() => {
    if (userRole !== 'admin' && currentView === 'permissions') {
      setCurrentView(getDefaultLandingViewForRole(userRole));
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

  const wrapView = (node: ReactNode) => (
    <Suspense fallback={<ViewLoadingFallback />}>{node}</Suspense>
  );

  const renderView = (view: string) => {
    if (!session) return null;
    switch (view) {
      case 'dashboard':
        return wrapView(
          <Dashboard
            userRole={userRole}
            viewAsFranchisee={viewAsFranchisee}
            onSelectFranchisee={(target) => setViewAsFranchisee(target)}
            onExitViewAs={() => setViewAsFranchisee(null)}
          />,
        );
      case 'orders':
        return wrapView(<Orders userRole={userRole} />);
      case 'products':
        return wrapView(<Products />);
      case 'permissions':
        return wrapView(<Permissions userRole={userRole} sessionLoginId={session.loginId} />);
      case 'procurement':
        return wrapView(<Procurement userRole={userRole} />);
      case 'stallInventory':
        return wrapView(<StallInventory userRole={userRole} />);
      case 'salesRecord':
        return wrapView(<SalesRecord userRole={userRole} />);
      case 'accounting':
        return wrapView(<Accounting userRole={userRole} />);
      case 'dataHub':
        return wrapView(<DataHub userRole={userRole} />);
      default:
        return wrapView(<Dashboard userRole={userRole} />);
    }
  };
  if (!authReady) {
    return (
      <>
        <div className="flex min-h-[100dvh] items-center justify-center bg-ds-root text-ds-muted">
          載入中…
        </div>
        <DeployUpdateBanner />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <LoginScreen
          onSuccess={() => {
            const s = readSession();
            if (s && validateSession(s)) setSession(s);
          }}
        />
        <DeployUpdateBanner />
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-ds-root font-sans text-ds-primary overflow-hidden selection:bg-amber-600/30">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        isOpen={isMobileMenuOpen}
        setIsOpen={setIsMobileMenuOpen}
        userRole={userRole}
        isSuperAdmin={isSuperAdmin}
        onLogout={handleLogout}
        overlaySwipe={isNarrow ? sidebarSwipe : undefined}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          loginId={session.loginId}
          userRole={userRole}
          onLogout={handleLogout}
          sidebarSwipe={isNarrow ? sidebarSwipe : undefined}
        />
        <PullToRefresh
          enabled={isNarrow}
          onRefresh={handlePullRefresh}
          sidebarSwipe={isNarrow ? sidebarSwipe : undefined}
          className="uio-touch-host min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pt-4 md:px-6 md:pb-6 md:pt-6 lg:px-8 lg:pb-8 lg:pt-8"
        >
          <div key={`${deferredView}-${pageRefreshKey}`}>{renderView(deferredView)}</div>
        </PullToRefresh>
      </div>
      <DeployUpdateBanner />
    </div>
  );
}
