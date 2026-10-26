import React, { Suspense } from 'react';
import { InSystemWhatsAppLinks } from './components/InSystemWhatsApp';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { SiteDataProvider, useSiteData } from './context/SiteDataContext';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from '../shared/ui/ErrorBoundary';
import { ToastProvider } from '../shared/ui/Toast';
import { useVisibleInterval } from '../shared/useVisibleInterval';
import { mysqlClient } from './lib/mysqlapi';
import { LECTURER_ROLES } from './constants/permissions';

// ── Lazily-loaded admin pages ────────────────────────────────────────────────
const Dashboard     = React.lazy(() => import('./pages/Dashboard'));
const StaffProfile  = React.lazy(() => import('./pages/StaffProfile'));
const ClientProfile = React.lazy(() => import('./pages/ClientProfile'));
const TherapistPortal = React.lazy(() => import('./pages/TherapistPortal'));
const LecturerPortal = React.lazy(() => import('./pages/LecturerPortal'));
const JoinUs        = React.lazy(() => import('./pages/JoinUs'));
const Auth          = React.lazy(() => import('./pages/Auth'));

const PageSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
  </div>
);

/**
 * «المحاضر مينفعش يدخل أبداً على صفحة الكورسات والمحتوى»: a lecturer, trainer, consultant or expert has the portal and nothing else —
 * wherever they open the dashboard they land there (the server refuses them the course and content routes as well).
 */
const NotForLecturers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAdmin, currentStaff } = useSiteData();
  if (!isAdmin && currentStaff && LECTURER_ROLES.includes(String(currentStaff.role || '').toLowerCase())) return <Navigate to="/lecturer-portal" replace />;
  return <>{children}</>;
};

/** Requires the user to be logged-in staff or admin. Otherwise shows Auth. */
const StaffRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authUser, isAdmin, staffMembers } = useSiteData();
  // Show spinner while auth resolves (cookie-based auth — no localStorage check needed)
  const [allowed, setAllowed] = React.useState<boolean | null>(null);

  // The identity this gate re-checks on: "loading" until auth resolves, then the
  // uid, then "guest". Extracted from the dependency array so it can be checked
  // statically instead of being an expression the rule has to skip over.
  const authGateKey = authUser === undefined ? 'loading' : (authUser?.uid ?? 'guest');

  React.useEffect(() => {
    if (authUser === undefined) return; // still loading auth
    if (!authUser) { setAllowed(false); return; }
    if (isAdmin) { setAllowed(true); return; }
    // Fast path: already in loaded staffMembers list
    const inContext = staffMembers.some(s => s.email.toLowerCase() === (authUser.email || '').toLowerCase());
    if (inContext) { setAllowed(true); return; }
    // Verify via /staff/me API (works for all staff roles).
    //
    // «في موظفين بيظهر عند تسجيل الدخول ريفريش سريع جدا لصفحة تسجيل الدخول ومش بيقدر يدخل»: the staff list is no longer
    // downloaded for every employee, so this one call is what lets them in — and a single failure of it (a slow mobile
    // connection, a server moment, the rate limiter) sent them straight back to the login page, where signing in
    // again hit the same race. It is asked up to three times before the answer is taken to be «no».
    let cancelled = false;
    const ask = async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const r: unknown = await mysqlClient.getStaffSelf();
          if (!cancelled) setAllowed(r !== null && r !== undefined);
          return;
        } catch {
          // The list may have loaded by now.
          if (staffMembers.some(s => s.email.toLowerCase() === (authUser.email || '').toLowerCase())) { if (!cancelled) setAllowed(true); return; }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
        }
      }
      if (!cancelled) setAllowed(false);
    };
    void ask();
    return () => { cancelled = true; };
    // authUser and staffMembers are read but deliberately not listed. The gate
    // re-checks per signed-in identity (authGateKey), not per object: authUser is
    // replaced on every token refresh, and staffMembers is re-fetched by the
    // context. Adding staffMembers here caused a confirmed re-run loop — the
    // effect's own /staff/me call feeds the list it would then depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authGateKey, isAdmin]);

  if (allowed === null) return <PageSpinner />;
  return allowed
    ? <>{children}</>
    : <Suspense fallback={<PageSpinner />}><Auth /></Suspense>;
};

/**
 * Where the page is when you leave it, and back there when you return.
 *
 * «في مشكلة عند الرجوع داخل السيستم بيرجع للصفحة الرئيسية مش مكان ما كنت موجود» (13 Oct
 * 2026). Back used to land on the top of the page (and, from a client's page, on the
 * overview): the list a client was opened from was found again at its first row. The
 * position is saved when the person acts on the page — before they leave it, not from
 * scroll events, which the browser fires again when a shorter page clamps the old one —
 * and put back on a BACK/FORWARD step, retried while the page's data arrives and given up
 * as soon as the person scrolls themselves.
 */
const ScrollToTop: React.FC = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { pathname } = location;
  const prev = React.useRef(pathname);
  const keyRef = React.useRef(location.key);
  const positions = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    const save = () => { positions.current.set(keyRef.current, window.scrollY); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'pagehide'] as const;
    events.forEach(name => window.addEventListener(name, save, { capture: true, passive: true }));
    return () => events.forEach(name => window.removeEventListener(name, save, { capture: true }));
  }, []);

  React.useEffect(() => {
    const p = prev.current;
    prev.current = pathname;
    keyRef.current = location.key;
    const isDashNav = p.startsWith('/dashboard') && pathname.startsWith('/dashboard');
    if (navigationType === 'POP') {
      const target = positions.current.get(location.key);
      if (!target) { if (!isDashNav) window.scrollTo(0, 0); return undefined; }
      let tries = 0;
      let stopped = false;
      const stop = () => { stopped = true; };
      const settle = () => {
        if (stopped) return;
        window.scrollTo(0, target);
        if (Math.abs(window.scrollY - target) > 4 && (tries += 1) < 40) window.setTimeout(settle, 60);
      };
      ['wheel', 'touchmove', 'keydown'].forEach(name => window.addEventListener(name, stop, { once: true, passive: true }));
      window.setTimeout(settle, 0);
      return () => { stopped = true; ['wheel', 'touchmove', 'keydown'].forEach(name => window.removeEventListener(name, stop)); };
    }
    if (!isDashNav) window.scrollTo(0, 0);
    return undefined;
    // One run per step of the history: the key says which one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  return null;
};

/** Server keepalive — pings /api/health every 5 minutes, while the tab is in front. */
const ServerKeepalive: React.FC = () => {
  const API = import.meta.env.VITE_API_URL || '/api';
  useVisibleInterval(
    () => { void fetch(`${API}/health`, { method: 'GET', cache: 'no-store' }).catch(() => {}); },
    5 * 60 * 1000,
  );
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
      {/* A click on any WhatsApp link opens that chat in the system's own WhatsApp (components/InSystemWhatsApp.tsx). */}
      <InSystemWhatsAppLinks />
      <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Root → redirect to dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Auth */}
            <Route path="/auth" element={<Auth />} />

            {/* Admin / Staff only */}
            <Route path="/dashboard" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            <Route path="/dashboard/:tab" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            <Route path="/dashboard/:tab/:param" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            {/* Backward-compatible URLs used by earlier admin deployments. */}
            <Route path="/mahad/admin" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            <Route path="/mahad/admin/:tab" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            <Route path="/mahad/admin/:tab/:param" element={
              <StaffRoute><NotForLecturers><Dashboard /></NotForLecturers></StaffRoute>
            } />
            <Route path="/staff/:id" element={
              <StaffRoute><StaffProfile /></StaffRoute>
            } />
            <Route path="/client/:code" element={
              <StaffRoute><NotForLecturers><ClientProfile /></NotForLecturers></StaffRoute>
            } />
            <Route path="/lecturer-portal" element={
              <StaffRoute><LecturerPortal /></StaffRoute>
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
