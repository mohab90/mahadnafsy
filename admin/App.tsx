import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SiteDataProvider, useSiteData } from './context/SiteDataContext';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from '../shared/ui/ErrorBoundary';
import { ToastProvider } from '../shared/ui/Toast';
import { mysqlClient } from './lib/mysqlapi';

// ── Lazily-loaded admin pages ────────────────────────────────────────────────
const Dashboard     = React.lazy(() => import('./pages/Dashboard'));
const StaffProfile  = React.lazy(() => import('./pages/StaffProfile'));
const ClientProfile = React.lazy(() => import('./pages/ClientProfile'));
const TherapistPortal = React.lazy(() => import('./pages/TherapistPortal'));
const JoinUs        = React.lazy(() => import('./pages/JoinUs'));
const Auth          = React.lazy(() => import('./pages/Auth'));
const UnifiedClientPage = React.lazy(() => import('./pages/UnifiedClientPage'));

const PageSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
  </div>
);

/** Requires the user to be logged-in staff or admin. Otherwise shows Auth. */
const StaffRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authUser, isAdmin, staffMembers } = useSiteData();
  // Show spinner while auth resolves (cookie-based auth — no localStorage check needed)
  const [allowed, setAllowed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (authUser === undefined) return; // still loading auth
    if (!authUser) { setAllowed(false); return; }
    if (isAdmin) { setAllowed(true); return; }
    // Fast path: already in loaded staffMembers list
    const inContext = staffMembers.some(s => s.email.toLowerCase() === (authUser.email || '').toLowerCase());
    if (inContext) { setAllowed(true); return; }
    // Verify via /staff/me API (works for all staff roles)
    Promise.resolve().then(() => {
      const api = mysqlClient;
      api.getStaffSelf()
        .then((r: unknown) => setAllowed(r !== null && r !== undefined))
        .catch(() => {
          // Fallback: accept if found in staffMembers (may have loaded by now)
          const fallback = staffMembers.some(s => s.email.toLowerCase() === (authUser.email || '').toLowerCase());
          setAllowed(fallback);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser === undefined ? 'loading' : (authUser?.uid ?? 'guest'), isAdmin]); // ⚠️ do NOT add staffMembers.length — causes re-run loop

  if (allowed === null) return <PageSpinner />;
  return allowed
    ? <>{children}</>
    : <Suspense fallback={<PageSpinner />}><Auth /></Suspense>;
};

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  const prev = React.useRef(pathname);
  React.useEffect(() => {
    const p = prev.current;
    prev.current = pathname;
    const isDashNav = p.startsWith('/dashboard') && pathname.startsWith('/dashboard');
    if (!isDashNav) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

/** Server keepalive — pings /api/health every 5 minutes */
const ServerKeepalive: React.FC = () => {
  const API = import.meta.env.VITE_API_URL || 'https://admin.mahadnafsy.com/api';
  React.useEffect(() => {
    const ping = () => fetch(`${API}/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
    ping();
    const id = setInterval(ping, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return null;
};

const NotFound: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-4" dir="rtl">
    <p className="text-6xl font-bold text-gray-300">404</p>
    <p className="text-gray-500">الصفحة غير موجودة</p>
    <a href="/dashboard" className="text-primary-600 hover:underline text-sm">العودة للداشبورد</a>
  </div>
);

const AppShell: React.FC = () => {
  const location = useLocation();
  return (
    <>
      <ScrollToTop />
      <ServerKeepalive />
      <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Root → redirect to dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Auth */}
            <Route path="/auth" element={<Auth />} />

            {/* Admin / Staff only */}
            <Route path="/dashboard" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            <Route path="/dashboard/:tab" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            <Route path="/dashboard/:tab/:param" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            {/* Backward-compatible URLs used by earlier admin deployments. */}
            <Route path="/mahad/admin" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            <Route path="/mahad/admin/:tab" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            <Route path="/mahad/admin/:tab/:param" element={
              <StaffRoute><Dashboard /></StaffRoute>
            } />
            <Route path="/staff/:id" element={
              <StaffRoute><StaffProfile /></StaffRoute>
            } />
            <Route path="/client/:code" element={
              <StaffRoute><ClientProfile /></StaffRoute>
            } />
            <Route path="/therapist-portal" element={
              <StaffRoute><TherapistPortal /></StaffRoute>
            } />
            <Route path="/join" element={<JoinUs />} />

            {/* Legacy redirects */}
            <Route path="/lead/:id"       element={<Navigate to="/dashboard" replace />} />
            <Route path="/subscriber/:id" element={<Navigate to="/dashboard" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
};

const App: React.FC = () => (
  <Router basename={import.meta.env.VITE_ROUTER_BASENAME || '/'}>
    <AuthProvider>
      <SiteDataProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </SiteDataProvider>
    </AuthProvider>
  </Router>
);

export default App;
