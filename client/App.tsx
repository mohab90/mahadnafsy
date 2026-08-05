import React, { useEffect, useState, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';

// ── Lazily-loaded pages ────────────────────────────────────────────────────────
const UserDashboard = React.lazy(() => import('./pages/UserDashboard'));
const Community = React.lazy(() => import('./pages/Community'));
const Checkout = React.lazy(() => import('./pages/Checkout'));
const StandalonePayment = React.lazy(() => import('./pages/StandalonePayment'));
const Auth = React.lazy(() => import('./pages/Auth'));
const CourseDetails = React.lazy(() => import('./pages/CourseDetails'));
const Bundles = React.lazy(() => import('./pages/Bundles'));
const BundleDetails = React.lazy(() => import('./pages/BundleDetails'));
const Consultations = React.lazy(() => import('./pages/Consultations'));
const PaymentSuccess = React.lazy(() => import('./pages/PaymentSuccess'));
const Instructors = React.lazy(() => import('./pages/Instructors'));
const InstructorDetails = React.lazy(() => import('./pages/InstructorDetails'));
const AboutUs = React.lazy(() => import('./pages/AboutUs'));
const Policies = React.lazy(() => import('./pages/Policies'));
const InstituteGallery = React.lazy(() => import('./pages/InstituteGallery'));
const Contact = React.lazy(() => import('./pages/Contact'));
const Faq = React.lazy(() => import('./pages/Faq'));
const TicketRating = React.lazy(() => import('./pages/TicketRating'));
const JoinTeaching = React.lazy(() => import('./pages/JoinTeaching'));
const JoinStaff = React.lazy(() => import('./pages/JoinStaff'));
const Enrollment = React.lazy(() => import('./pages/Enrollment'));
const Courses = React.lazy(() => import('./pages/Courses'));
const CertificateVerify = React.lazy(() => import('./pages/CertificateVerify'));
const AiTutorWidget = React.lazy(() => import('./components/AiTutorWidget'));

/** Minimal spinner shown while lazy pages load */
const PageSpinner: React.FC = () => (
  <div className="min-h-[40vh] flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
  </div>
);

const lazyPage = (element: React.ReactNode) => (
  <Suspense fallback={<PageSpinner />}>{element}</Suspense>
);
import { SiteDataProvider, useSiteData } from './context/SiteDataContext';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from '../shared/ui/ErrorBoundary';
import { ToastProvider } from '../shared/ui/Toast';
import { mysqlForms } from './lib/mysqlapi';
import { toDialable } from './lib/whatsappLink';

/** Lead Capture Widget — floating "استفسر الآن" form for public visitors */
const LeadCaptureWidget: React.FC = () => {
  const { isAdmin, authUser } = useSiteData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Only show for non-admin, non-logged-in visitors
  if (isAdmin || authUser) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setBusy(true);
    setSubmitError('');
    try {
      await mysqlForms.submitLead({ name: name.trim(), phone: phone.trim(), notes: msg.trim(), source: 'chatbot' });
      setSent(true);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'تعذر إرسال طلبك حاليًا. حاول مرة أخرى أو تواصل معنا عبر واتساب.');
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="استفسر الآن"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-2xl font-bold text-sm transition-transform hover:scale-105">
        💬 استفسر الآن
      </button>

      {/* Slide-up card */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" dir="rtl">
          <div className="bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-3 flex items-center justify-between">
            <p className="text-white font-bold text-sm">💬 هل لديك استفسار؟ ابعت لنا</p>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none">×</button>
          </div>
          <div className="p-4">
            {sent ? (
              <div className="text-center py-6">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold text-gray-800 mb-1">شكراً! تم استلام طلبك</p>
                <p className="text-xs text-gray-500">سيتواصل معك فريقنا في أقرب وقت</p>
                <button onClick={() => { setOpen(false); setSent(false); setName(''); setPhone(''); setMsg(''); }}
                  className="mt-4 text-xs text-primary-600 hover:underline">إغلاق</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {submitError && <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{submitError}</p>}
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم *</label>
                  <input required value={name} onChange={e => setName(e.target.value)}
                    placeholder="اسمك الكريم"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-primary-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف *</label>
                  <input required value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX" dir="ltr"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-primary-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">رسالتك (اختياري)</label>
                  <textarea value={msg} onChange={e => setMsg(e.target.value)}
                    rows={2} placeholder="ماذا تريد أن تعرف؟"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:border-primary-400 outline-none" />
                </div>
                <button type="submit" disabled={busy}
                  className="w-full bg-primary-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-primary-700 transition disabled:opacity-60">
                  {busy ? 'جاري الإرسال...' : 'أرسل استفساري'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/** WhatsApp floating button — visible for non-staff/non-admin users only */

const WaFloat: React.FC = () => {
  const { content, isStaff, isAdmin } = useSiteData();
  const phone = (content['footer.whatsapp'] || '201096203090').replace(/\D/g, '');
  if (isAdmin || isStaff) return null;
  return (
    <a
      href={`https://wa.me/${toDialable(phone)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل عبر واتساب"
      className="fixed bottom-6 left-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110"
    >
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </a>
  );
};

/** 404 Not Found page */
const NotFound: React.FC = () => (
  <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
    <p className="text-8xl font-black text-primary-200 mb-4">404</p>
    <h1 className="text-2xl font-bold text-gray-800 mb-2">الصفحة غير موجودة</h1>
    <p className="text-gray-500 mb-8">الرابط الذي تطلبته غير موجود أو تم حذفه.</p>
    <div className="flex gap-3 flex-wrap justify-center">
      <Link to="/" className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-6 py-3 rounded-xl transition">الرئيسية</Link>
      <Link to="/courses" className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold px-6 py-3 rounded-xl transition">تصفح الكورسات</Link>
    </div>
  </div>
);

/** Legacy locale URLs redirect only; the server owns customer currency. */
const LocaleRoute: React.FC<{ locale: 'EGP' | 'SAR' | 'USD' }> = () => <Navigate to="/" replace />;

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const prevPathnameRef = React.useRef(pathname);
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (prev !== pathname) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

/** Server keepalive — silently pings /api/health every 5 minutes to prevent Hostinger shared
 *  hosting from suspending the Node.js process between requests */
const ServerKeepalive: React.FC = () => {
  const API = import.meta.env.VITE_API_URL || '/api';
  useEffect(() => {
    const ping = () => {
      fetch(`${API}/health`, { method: 'GET', cache: 'no-store' })
        .catch(() => { /* silent — watchdog will restart if truly down */ });
    };
    ping(); // immediate ping on mount
    const id = setInterval(ping, 5 * 60 * 1000); // then every 5 min
    return () => clearInterval(id);
  }, []);
  return null;
};

/** Routes where a minimal 2-line footer is shown (no distraction during payment) */
const MINI_FOOTER_ROUTES = ['/enroll', '/checkout', '/success'];

/** Session Timeout Warning — shows banner 5 min before JWT expiry */
const SessionTimeoutWarner: React.FC = () => {
  const [showWarning, setShowWarning] = React.useState(false);
  const [countdown, setCountdown] = React.useState(300);
  const { logout } = useSiteData();

  useEffect(() => {
    const check = () => {
      const token = localStorage.getItem('mahad-token');
      if (!token) { setShowWarning(false); return; }
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expiresIn = payload.exp * 1000 - Date.now();
        if (expiresIn <= 0) { setShowWarning(false); return; }
        if (expiresIn <= 5 * 60 * 1000) { // 5 minutes
          setShowWarning(true);
          setCountdown(Math.floor(expiresIn / 1000));
        } else {
          setShowWarning(false);
        }
      } catch { setShowWarning(false); }
    };
    check();
    const id = setInterval(check, 30000); // check every 30s
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!showWarning) return;
    const id = setInterval(() => setCountdown(c => {
      if (c <= 1) { clearInterval(id); return 0; }
      return c - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [showWarning]);

  if (!showWarning) return null;
  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-amber-50 border border-amber-300 rounded-2xl shadow-lg p-4 max-w-xs" dir="rtl">
      <p className="text-amber-800 font-bold text-sm mb-1">⚠️ ستنتهي جلستك قريباً</p>
      <p className="text-amber-700 text-xs mb-3">
        الجلسة تنتهي خلال {mins > 0 ? `${mins} دقيقة و` : ''}{secs} ثانية
      </p>
      <div className="flex gap-2">
        <button onClick={() => window.location.reload()}
          className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 rounded-lg transition">
          تجديد الجلسة
        </button>
        <button onClick={() => { logout(); setShowWarning(false); }}
          className="flex-1 bg-white border border-amber-300 text-amber-700 text-xs font-bold py-1.5 rounded-lg hover:bg-amber-50 transition">
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
};

const useMiniFooter = () => {
  const { pathname } = useLocation();
  return MINI_FOOTER_ROUTES.some(r => pathname === r || pathname.startsWith(r));
};


// Applies the tenant's own uploaded favicon (SaaS setup wizard, ARC-07) over the
// static default in index.html — every tenant otherwise shared the same icon
// regardless of what they uploaded in Settings.
const useTenantFavicon = () => {
  const { content } = useSiteData();
  const faviconUrl = content['institute.favicon'];
  useEffect(() => {
    if (!faviconUrl) return;
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]');
    const previous = Array.from(links).map(link => link.href);
    links.forEach(link => { link.href = faviconUrl; });
    return () => { links.forEach((link, i) => { link.href = previous[i]; }); };
  }, [faviconUrl]);
};

const AppShell: React.FC = () => {
  const miniFooter = useMiniFooter();
  const location = useLocation();
  useTenantFavicon();

  return (
    <>
      <ScrollToTop />
      <ServerKeepalive />
      <ErrorBoundary key={location.pathname}>
        <div className="min-h-screen flex flex-col font-sans">
          <Header />
          <main className="flex-grow">
            <Routes>
              <Route path="/eg" element={<LocaleRoute locale="EGP" />} />
              <Route path="/sa" element={<LocaleRoute locale="SAR" />} />
              <Route path="/usd" element={<LocaleRoute locale="USD" />} />
              <Route path="/" element={<Home />} />
              <Route path="/about" element={lazyPage(<AboutUs />)} />
              <Route path="/courses" element={lazyPage(<Courses />)} />
              <Route path="/course/:id" element={lazyPage(<CourseDetails />)} />
              <Route path="/c/:slug" element={lazyPage(<CourseDetails />)} />
              <Route path="/bundles" element={lazyPage(<Bundles />)} />
              <Route path="/bundle/:id" element={lazyPage(<BundleDetails />)} />
              <Route path="/consultations" element={lazyPage(<Consultations />)} />
              <Route path="/community" element={lazyPage(<Community />)} />
              <Route path="/institute-gallery" element={lazyPage(<InstituteGallery />)} />
              <Route path="/instructors" element={lazyPage(<Instructors />)} />
              <Route path="/instructor/:id" element={lazyPage(<InstructorDetails />)} />
              <Route path="/therapist-portal" element={<Navigate to="/" replace />} />
              <Route path="/lead/:id" element={<Navigate to="/" replace />} />
              <Route path="/subscriber/:id" element={<Navigate to="/" replace />} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/dashboard/:tab" element={<Navigate to="/" replace />} />
              <Route path="/staff/:id" element={<Navigate to="/" replace />} />
              <Route path="/client/:code" element={<Navigate to="/" replace />} />
              <Route path="/auth" element={lazyPage(<Auth />)} />
              <Route path="/my-account" element={lazyPage(<UserDashboard />)} />
              <Route path="/checkout" element={lazyPage(<Checkout />)} />
              <Route path="/pay" element={lazyPage(<StandalonePayment />)} />
              <Route path="/payments" element={lazyPage(<StandalonePayment />)} />
              <Route path="/standalone-payment" element={lazyPage(<StandalonePayment />)} />
              <Route path="/success" element={lazyPage(<PaymentSuccess />)} />
              <Route path="/policies" element={lazyPage(<Policies />)} />
              <Route path="/privacy" element={<Navigate to="/policies" replace />} />
              <Route path="/terms" element={<Navigate to="/policies" replace />} />
              <Route path="/contact" element={lazyPage(<Contact />)} />
              <Route path="/faq" element={lazyPage(<Faq />)} />
              <Route path="/ticket-rating" element={lazyPage(<TicketRating />)} />
              <Route path="/join" element={lazyPage(<JoinTeaching />)} />
              <Route path="/join-us" element={lazyPage(<JoinStaff />)} />
              <Route path="/enroll" element={lazyPage(<Enrollment />)} />
              <Route path="/certificate/:code" element={lazyPage(<CertificateVerify />)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer mini={miniFooter} />
          <LeadCaptureWidget />
          <Suspense fallback={null}><AiTutorWidget /></Suspense>
          <WaFloat />
          <SessionTimeoutWarner />
        </div>
      </ErrorBoundary>
    </>
  );
};

const routerBasename = import.meta.env.VITE_ROUTER_BASENAME || '/';

const App: React.FC = () => (
  <Router basename={routerBasename}>
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
