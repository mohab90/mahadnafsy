import React, { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Award, BookOpenCheck, Eye, EyeOff, KeyRound, Lock, Mail, MessageCircle, Phone, ShieldCheck, User } from 'lucide-react';
import { mysqlAuth, mysqlClient } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import { adminDashboardUrl } from '../lib/adminDashboard';
import { useSeo } from '../lib/useSeo';
import { trackCompleteRegistration } from '../lib/tracking';
import { EmailCodeStep } from '../../shared/ui/EmailCodeStep';

// The referral code a visitor arrived with (/auth?ref=CODE). Kept for the visit,
// so wandering off to read a course page and coming back to sign up through
// the header's «تسجيل الدخول» (which carries no ?ref) still credits it.
const REFERRAL_KEY = 'mahad-referral';
function rememberedReferral(fromUrl: string): string {
  try {
    if (fromUrl) { window.sessionStorage.setItem(REFERRAL_KEY, fromUrl); return fromUrl; }
    return window.sessionStorage.getItem(REFERRAL_KEY) || '';
  } catch { return fromUrl; /* storage blocked: the URL is all there is */ }
}

type Mode = 'login' | 'register' | 'forgot';
type Notice = { type: 'success' | 'error'; text: string } | null;

// What a typed identifier is, so the screen can say where a code will go before it is sent.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const identifierKind = (value: string): 'email' | 'phone' | null => {
  const text = value.trim();
  if (!text) return null;
  if (text.includes('@')) return 'email';
  return text.replace(/\D/g, '').length >= 8 ? 'phone' : null;
};

const RESEND_AFTER_SECONDS = 60;

const inputClass = 'min-h-[52px] w-full rounded-2xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
const primaryButton = 'flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white shadow-[0_14px_28px_-16px_rgba(159,18,57,.7)] transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60';
const linkButton = 'inline-flex min-h-[44px] items-center justify-center font-black text-primary-700 hover:underline';

const Field: React.FC<{ label: string; icon: ReactNode; hint?: string; children: ReactNode }> = ({ label, icon, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-muted-strong"><span className="text-primary-700" aria-hidden="true">{icon}</span>{label}</span>
    {children}
    {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
  </label>
);

const NoticeBox: React.FC<{ notice: Notice }> = ({ notice }) => (notice ? (
  <div role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-sm font-bold leading-relaxed ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
) : null);

const Auth: React.FC = () => {
  useSeo({ title: 'تسجيل الدخول | معهد الدراسات النفسية', path: '/auth', noindex: true });
  // Someone arriving on a referral link is by definition a new visitor, so open
  // on the create-account form rather than making them find the toggle first.
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(window.location.search).get('ref') ? 'register' : 'login'));
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sign in: an email OR a WhatsApp number, with the password.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // Create an account: the name, and BOTH ways in.
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Forgotten password: 0 = who, 1 = the code, 2 = the new password, 3 = done.
  const [forgotStep, setForgotStep] = useState(0);
  const [forgotId, setForgotId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // The emailed sign-in code (api/lib/loginEmailCode.js): set once the password has been accepted for an important account.
  const [codeStep, setCodeStep] = useState<{ pendingToken: string; hint: string; resendAfterSeconds: number } | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const navigate = useNavigate();
  const { authUser, isAdmin, refreshAuth } = useSiteData();
  const staffCheckDoneRef = useRef(false);

  // Where to land after signing in. Checkout sends customers here with
  // ?redirect=... when they try to buy while signed out; before this, that
  // parameter was written but never read, so anyone who signed in to complete
  // a purchase was dropped on the home page and the order was abandoned.
  // Only same-site paths are honoured — an absolute URL, or a protocol-relative
  // "//evil.com" (and "/\evil.com", which some browsers normalise to the same
  // thing), would otherwise turn this into an open redirect.
  const queryParams = new URLSearchParams(window.location.search);
  const redirectParam = queryParams.get('redirect') || '';
  const safeRedirect = /^\/[^/\\]/.test(redirectParam) ? redirectParam : '';
  const referralCode = rememberedReferral((queryParams.get('ref') || '').trim().toUpperCase().slice(0, 32));
  // Without a page to go back to, a signed-in customer lands on their own
  // courses, not the home page they would then have to find them from.
  // The header sends "/" from the home page; that is no preference either.
  const landing = safeRedirect && safeRedirect !== '/' ? safeRedirect : '/my-account';

  // Redirect if already authenticated
  useEffect(() => {
    if (authUser === undefined) return; // still loading
    if (!authUser) return;
    if (safeRedirect && safeRedirect !== '/') { navigate(safeRedirect, { replace: true }); return; }
    // The dashboard is a separate app on a separate host, so it is a page
    // load, not a route change. navigate('/dashboard') stayed inside this
    // router — which registers /dashboard as `<Navigate to="/" replace />` —
    // so every staff member who signed in here was bounced silently to the
    // home page. The check that identified them worked; the destination was
    // simply not somewhere this router could go.
    if (isAdmin) { window.location.assign(adminDashboardUrl()); return; }
    // Non-admin: check if this user is a staff member (sales, admin role, etc.)
    if (staffCheckDoneRef.current) return;
    staffCheckDoneRef.current = true;
    mysqlClient.checkIsStaff()
      .then(r => { if (r.isStaff) window.location.assign(adminDashboardUrl()); else navigate(landing, { replace: true }); })
      .catch(() => navigate(landing, { replace: true }));
  }, [authUser, isAdmin, navigate, safeRedirect, landing]);

  const goTo = (next: Mode) => { setMode(next); setNotice(null); setShowPassword(false); };

  const startForgot = (prefill = '') => {
    setForgotStep(0);
    setForgotId(prefill || identifier);
    setOtpCode('');
    setResetToken('');
    setNewPassword('');
    setResendIn(0);
    goTo('forgot');
  };

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!forgotId.trim()) return;
    if (!identifierKind(forgotId)) {
      setNotice({ type: 'error', text: 'اكتب الإيميل بالشكل الصحيح (example@domain.com) أو رقم الواتساب.' });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      await mysqlAuth.forgotPassword(forgotId.trim());
      setForgotStep(1);
      setResendIn(RESEND_AFTER_SECONDS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setNotice({ type: 'error', text: msg || 'حدث خطأ، تأكد من البيانات وحاول مرة أخرى.' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    setNotice(null);
    setOtpCode('');
    try {
      await mysqlAuth.forgotPassword(forgotId.trim());
      setResendIn(RESEND_AFTER_SECONDS);
      setNotice({ type: 'success', text: 'بعتنا كود جديد — استخدم آخر كود وصلك.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setNotice({ type: 'error', text: msg || 'تعذّر إرسال الكود. حاول مرة أخرى.' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!otpCode.trim()) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await mysqlAuth.verifyOtp(forgotId.trim(), otpCode.trim());
      setResetToken(res.resetToken);
      setForgotStep(2);
    } catch {
      setNotice({ type: 'error', text: 'الكود غير صحيح أو منتهي الصلاحية.' });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) { setNotice({ type: 'error', text: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' }); return; }
    setLoading(true);
    setNotice(null);
    try {
      await mysqlAuth.resetPassword(resetToken, newPassword);
      setForgotStep(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setNotice({ type: 'error', text: msg || 'حدث خطأ، حاول مرة أخرى.' });
    } finally {
      setLoading(false);
    }
  };

  const finishCodeStep = async (code: string) => {
    if (!codeStep) return;
    await mysqlAuth.verifyLoginEmailCode(codeStep.pendingToken, code);
    // The session lives in the httpOnly cookie the API just set. Nothing to stash here.
    setCodeStep(null);
    refreshAuth();
  };

  const resendLoginCode = async () => {
    if (!codeStep) return 45;
    const result = await mysqlAuth.resendLoginEmailCode(codeStep.pendingToken);
    return result.resendAfterSeconds ?? 45;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const isLogin = mode === 'login';
    if (isLogin) {
      if (!identifier.trim() || !password.trim()) {
        setNotice({ type: 'error', text: 'اكتب الإيميل أو رقم الواتساب وكلمة المرور.' });
        return;
      }
    } else {
      // Both ways in are asked for at sign-up: the email is where a code goes when the person signs in or forgets with it, the number is
      // where it goes when they use that.
      if (!fullName.trim() || !email.trim() || !phone.trim() || !password.trim()) {
        setNotice({ type: 'error', text: 'اكتب الاسم والإيميل ورقم الواتساب وكلمة المرور.' });
        return;
      }
      if (!EMAIL_SHAPE.test(email.trim())) {
        setNotice({ type: 'error', text: 'الإيميل غير صحيح (example@domain.com).' });
        return;
      }
      if (phone.replace(/\D/g, '').length < 8) {
        setNotice({ type: 'error', text: 'رقم الواتساب غير صحيح، اكتبه مع كود الدولة لو من خارج مصر.' });
        return;
      }
      if (password.length < 8) {
        setNotice({ type: 'error', text: 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.' });
        return;
      }
    }

    setLoading(true);
    setNotice(null);
    try {
      if (isLogin) {
        const result = await mysqlAuth.login(identifier.trim(), password);
        if (result.emailCodeRequired) {
          if (!result.pendingToken) throw new Error('Missing sign-in session');
          setCodeStep({ pendingToken: result.pendingToken, hint: result.emailHint || '', resendAfterSeconds: result.resendAfterSeconds ?? 45 });
          return;
        }
        setNotice({ type: 'success', text: 'تم تسجيل الدخول بنجاح.' });
      } else {
        await mysqlAuth.register({
          email: email.trim(),
          password,
          name: fullName.trim(),
          phone: phone.trim(),
          // The referral link a student shares is /auth?ref=CODE, and
          // the API has always credited it — but this page never read
          // the parameter, so every referred signup was recorded as
          // having come from nowhere.
          ...(referralCode ? { ref: referralCode } : {}),
        });
        trackCompleteRegistration();
        setNotice({ type: 'success', text: 'تم إنشاء الحساب وتسجيل الدخول.' });
      }
      // Refresh auth state so isAdmin and authUser update immediately
      refreshAuth();
      // Navigation handled by useEffect above when authUser updates
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      const code = (error as { code?: string })?.code || '';
      const arabicMessages: Record<string, string> = {
        'Email already registered': 'الإيميل ده عليه حساب بالفعل. ادخل بيه، ولو نسيت كلمة المرور اضغط «نسيت كلمة المرور».',
        // The server gives this one answer for an unknown account, a wrong password and an account with no password yet, so it names every way in.
        'Invalid credentials': 'الإيميل/رقم الواتساب أو كلمة المرور غير صحيحة. لو دي أول مرة تدخل الموقع أو نسيت كلمة المرور اضغط «نسيت كلمة المرور» وهيوصلك كود على الإيميل أو الواتساب حسب اللي كتبته.',
        'Email and password required': 'اكتب الإيميل أو رقم الواتساب وكلمة المرور.',
        'Password must be at least 8 characters': 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.',
        'Login failed': 'حدث خطأ في الخادم، حاول مرة أخرى.',
      };
      const isRateLimit = msg.includes('محاولات كثيرة') || msg.includes('HTTP 429');
      // The account's own rules — a third device, or a freeze for use
      // from many networks — arrive in Arabic and say what to do; the
      // generic «تعذر إتمام العملية» hid them.
      const isAccountRule = ['DEVICE_LIMIT', 'ACCOUNT_SHARING_LOCKED'].includes(code);
      // A sign-up that meets an account or a client already on file says so in Arabic and says how to get in; a generic line sent people round in circles.
      const isSignupRule = ['PHONE_ALREADY_REGISTERED', 'EMAIL_BELONGS_TO_CLIENT', 'STAFF_INVITATION_REQUIRED'].includes(code);
      const showsServerText = isAccountRule || isSignupRule || msg.includes('لم يتم تعيين كلمة مرور');
      const isDbDown = msg.includes('DB unavailable') || msg.includes('tunnel') || msg.includes('HTTP 503');
      // Same distinction the admin sign-in makes: a request that never
      // reached the server is not a rejected sign-in. Telling a customer
      // "تعذر إتمام العملية" for a dropped connection sends them to reset a
      // password that was never wrong.
      const isTimeout = (error instanceof DOMException && error.name === 'AbortError') || msg.includes('aborted');
      const isUnreachable = error instanceof TypeError || msg.includes('Failed to fetch');
      const isServerFault = /HTTP 5\d\d/.test(msg);
      const arabicText = isRateLimit
        ? 'محاولات كثيرة جداً — انتظر 15 دقيقة وحاول مرة أخرى'
        : showsServerText
          ? msg
          : isDbDown
            ? 'الموقع غير متاح حالياً، يرجى المحاولة بعد قليل.'
            : isTimeout
              ? 'الخادم لم يستجب في الوقت المحدد. بياناتك سليمة — تحقق من الاتصال وحاول مرة أخرى.'
              : isUnreachable
                ? 'تعذر الوصول إلى الموقع. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.'
                : isServerFault
                  ? 'حدث خطأ في الخادم أثناء محاولة الدخول. حاول بعد قليل.'
                  : (arabicMessages[msg] || 'تعذر إتمام العملية، حاول مرة أخرى.');
      setNotice({ type: 'error', text: arabicText });
    } finally {
      setLoading(false);
    }
  };

  const kind = identifierKind(forgotId);
  const channelWord = kind === 'phone' ? 'واتساب' : kind === 'email' ? 'الإيميل' : 'الواتساب أو الإيميل';

  const heading = codeStep ? 'كود الدخول'
    : mode === 'forgot' ? (forgotStep === 3 ? 'تم تغيير كلمة المرور' : 'استعادة كلمة المرور')
      : mode === 'login' ? 'أهلاً بعودتك' : 'إنشاء حساب جديد';
  const subheading = codeStep ? 'أرسلنا لك كوداً على إيميلك لتأكيد الدخول.'
    : mode === 'forgot' ? 'اكتب إيميلك أو رقم الواتساب وهنبعتلك كود التحقق.'
      : mode === 'login' ? 'ادخل بإيميلك أو رقم الواتساب مع كلمة المرور.' : 'سجّل بالإيميل ورقم الواتساب معاً — بيهمونا الاتنين.';

  return (
    <div className="min-h-screen bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[32px] bg-white shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line lg:grid-cols-[1fr_1.05fr]">
        {/* ── the institute, beside the form on a wide screen ── */}
        <aside className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary-700/40 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-gold-pale/10 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl font-black text-gold-pale ring-1 ring-white/15">ن</div>
            <h2 className="text-3xl font-black leading-snug">معهد الدراسات النفسية</h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/70">حسابك واحد: كورساتك ومحاضراتك وشهاداتك ومتابعة تقدمك في مكان واحد.</p>
          </div>
          <ul className="relative mt-10 space-y-5 text-sm">
            <li className="flex items-start gap-3"><BookOpenCheck size={20} className="mt-0.5 shrink-0 text-gold-pale" aria-hidden="true" /><span className="leading-relaxed text-white/85">كل محاضراتك مفتوحة طول مدة اشتراكك، من أي جهاز من أجهزتك.</span></li>
            <li className="flex items-start gap-3"><Award size={20} className="mt-0.5 shrink-0 text-gold-pale" aria-hidden="true" /><span className="leading-relaxed text-white/85">اختباراتك وشهاداتك بتتسجل على حسابك وتقدر تتحقق منها.</span></li>
            <li className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-gold-pale" aria-hidden="true" /><span className="leading-relaxed text-white/85">لو نسيت كلمة المرور، كود بيوصلك على الإيميل أو الواتساب اللي سجلت بيهم.</span></li>
          </ul>
        </aside>

        {/* ── the form ── */}
        <section className="p-6 sm:p-10">
          <div className="mb-7 text-center lg:text-right">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-2xl font-black text-gold-pale lg:hidden">ن</div>
            <h1 className="text-2xl font-black text-ink sm:text-[28px]">{heading}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-body">{subheading}</p>
          </div>

          {codeStep ? (
            /* ── the code sent to the email (important accounts) ── */
            <EmailCodeStep
              hint={codeStep.hint}
              initialResendIn={codeStep.resendAfterSeconds}
              onVerify={finishCodeStep}
              onResend={resendLoginCode}
              onCancel={() => { setCodeStep(null); setNotice(null); }}
            />
          ) : mode === 'forgot' ? (
            <div className="space-y-4">
              {forgotStep === 3 ? (
                <>
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
                    <div className="mb-2 text-4xl" aria-hidden="true">✅</div>
                    <p className="mb-1 font-black text-green-800">تم تغيير كلمة المرور!</p>
                    <p className="text-sm leading-relaxed text-muted-body">تقدر دلوقتي تدخل بكلمة المرور الجديدة.</p>
                  </div>
                  <button type="button" onClick={() => { setIdentifier(forgotId); setPassword(''); goTo('login'); }} className={primaryButton}>الدخول لحسابي</button>
                </>
              ) : forgotStep === 0 ? (
                <form className="space-y-4" onSubmit={handleForgotPassword}>
                  <Field label="الإيميل أو رقم الواتساب" icon={kind === 'phone' ? <Phone size={15} /> : <Mail size={15} />}
                    hint={kind ? `هيوصلك الكود على ${channelWord}.` : 'لو كتبت الإيميل الكود بيوصل على الإيميل، ولو كتبت الرقم بيوصل على واتساب.'}>
                    <input type="text" dir="ltr" autoComplete="username" value={forgotId} onChange={e => setForgotId(e.target.value)} className={inputClass} placeholder="example@domain.com أو 01012345678" required />
                  </Field>
                  <NoticeBox notice={notice} />
                  <button type="submit" disabled={loading} className={primaryButton}>{loading ? 'جارٍ الإرسال...' : `إرسال الكود على ${channelWord}`}</button>
                  <button type="button" onClick={() => goTo('login')} className="min-h-[44px] w-full text-sm font-bold text-muted hover:text-ink">← العودة لتسجيل الدخول</button>
                </form>
              ) : forgotStep === 1 ? (
                <form className="space-y-4" onSubmit={handleVerifyOtp}>
                  {/* Worded conditionally on purpose: the API answers «ok» even when no account matches, so a guess cannot find out which accounts exist. */}
                  <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
                    <div className="mb-2 flex justify-center text-primary-700" aria-hidden="true">{kind === 'phone' ? <MessageCircle size={30} /> : <Mail size={30} />}</div>
                    <p className="text-sm font-black text-ink">لو في حساب بالبيانات دي، بعتنا كود من 6 أرقام على {channelWord}</p>
                    <p className="mt-1 font-mono text-sm text-primary-700" dir="ltr">{forgotId}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{kind === 'email' ? 'لو مش لاقيه شوف مجلد الرسائل المزعجة (Spam). ' : ''}لو الكود ما وصلش خلال دقيقتين فغالباً مفيش حساب بالبيانات دي — جرّب الإيميل أو الرقم التاني أو كلّم الدعم.</p>
                  </div>
                  <Field label="كود التحقق" icon={<KeyRound size={15} />}>
                    <input type="text" inputMode="numeric" dir="ltr" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))} className={`${inputClass} text-center text-xl font-black tracking-[0.5em]`} placeholder="000000" required />
                  </Field>
                  <NoticeBox notice={notice} />
                  <button type="submit" disabled={loading || otpCode.length < 4} className={primaryButton}>{loading ? 'جارٍ التحقق...' : 'تأكيد الكود'}</button>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" onClick={() => { void handleResendCode(); }} disabled={loading || resendIn > 0} className="min-h-[44px] font-bold text-primary-700 hover:underline disabled:cursor-not-allowed disabled:text-muted-faint disabled:no-underline">
                      {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ثانية` : 'إعادة إرسال الكود'}
                    </button>
                    <button type="button" onClick={() => { setForgotStep(0); setOtpCode(''); setNotice(null); }} className="min-h-[44px] font-bold text-muted hover:text-ink">تغيير الإيميل أو الرقم</button>
                  </div>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={handleResetPassword}>
                  <Field label="كلمة المرور الجديدة" icon={<Lock size={15} />} hint="8 أحرف على الأقل.">
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={`${inputClass} pl-12`} placeholder="8 أحرف على الأقل" required />
                      <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} className="absolute left-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted hover:text-ink">{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                    </div>
                  </Field>
                  <NoticeBox notice={notice} />
                  <button type="submit" disabled={loading} className={primaryButton}>{loading ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}</button>
                </form>
              )}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div role="tablist" aria-label="تسجيل الدخول أو إنشاء حساب" className="grid grid-cols-2 gap-1 rounded-2xl bg-paper p-1 ring-1 ring-line">
                <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => goTo('login')} className={`min-h-[44px] rounded-xl text-sm font-black transition ${mode === 'login' ? 'bg-white text-primary-700 shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'}`}>تسجيل الدخول</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => goTo('register')} className={`min-h-[44px] rounded-xl text-sm font-black transition ${mode === 'register' ? 'bg-white text-primary-700 shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'}`}>حساب جديد</button>
              </div>

              {mode === 'register' ? (
                <>
                  <Field label="الاسم" icon={<User size={15} />}>
                    <input type="text" autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClass} placeholder="الاسم الثلاثي" required />
                  </Field>
                  <Field label="الإيميل" icon={<Mail size={15} />} hint="بنبعت عليه كود استعادة كلمة المرور لو دخلت بيه.">
                    <input type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="example@domain.com" required />
                  </Field>
                  <Field label="رقم الواتساب" icon={<Phone size={15} />} hint="لو من خارج مصر اكتبه مع كود الدولة (مثال: 966501234567).">
                    <input type="tel" dir="ltr" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputClass} placeholder="01012345678" required />
                  </Field>
                </>
              ) : (
                <Field label="الإيميل أو رقم الواتساب" icon={identifierKind(identifier) === 'phone' ? <Phone size={15} /> : <Mail size={15} />}>
                  <input type="text" dir="ltr" autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} className={inputClass} placeholder="example@domain.com أو 01012345678" required />
                </Field>
              )}

              <Field label="كلمة المرور" icon={<Lock size={15} />}>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} className={`${inputClass} pl-12`} placeholder={mode === 'login' ? undefined : '8 أحرف على الأقل'} required />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} className="absolute left-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted hover:text-ink">{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                </div>
              </Field>

              <NoticeBox notice={notice} />

              <button type="submit" disabled={loading} className={primaryButton}>
                {loading ? 'جارٍ المعالجة...' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
                {!loading ? <ArrowRight size={18} className="rotate-180" aria-hidden="true" /> : null}
              </button>

              {mode === 'login' ? (
                <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
                  <button type="button" onClick={() => startForgot()} className={linkButton}>نسيت كلمة المرور؟</button>
                  <p className="text-xs leading-relaxed text-muted">لو دي أول مرة تدخل الموقع وإنت مشترك معانا، اضغط «نسيت كلمة المرور» واكتب إيميلك أو رقم الواتساب اللي اشتركت بيه، وهيوصلك كود تحط بيه كلمة مرور.</p>
                </div>
              ) : (
                <p className="text-center text-xs leading-relaxed text-muted">لو إنت مشترك معانا بالفعل بنفس الإيميل أو الرقم، استخدم «نسيت كلمة المرور» بدل إنشاء حساب جديد — نفس حسابك وكورساتك هتظهر لك.</p>
              )}
              {mode === 'register' && notice?.type === 'error' && /عليه حساب|مسجّل|مسجل|الواتساب/.test(notice.text) ? (
                <button type="button" onClick={() => startForgot(phone.trim() || email.trim())} className={`${linkButton} w-full`}>استعادة كلمة المرور بالرقم أو الإيميل ده</button>
              ) : null}
            </form>
          )}
        </section>
      </div>
    </div>
  );
};

export default Auth;
