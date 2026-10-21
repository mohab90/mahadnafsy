import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { mysqlAuth, mysqlClient } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import { adminDashboardUrl } from '../lib/adminDashboard';
import { useSeo } from '../lib/useSeo';
import { trackCompleteRegistration } from '../lib/tracking';

const Auth: React.FC = () => {
  useSeo({ title: 'تسجيل الدخول | معهد الدراسات النفسية', path: '/auth' });
  // Someone arriving on a referral link is by definition a new visitor, so open
  // on the create-account form rather than making them find the toggle first.
  const [isLogin, setIsLogin] = useState(() => !new URLSearchParams(window.location.search).get('ref'));
  // WhatsApp sign-in: step 0 = enter number, step 1 = enter the code.
  // Default OFF: most existing customers only ever had an email account, so
  // the identifier + password form (which now also accepts a phone number in
  // the same field) is what they land on. WhatsApp sign-in/registration stays
  // one tap away via "الدخول برقم الواتساب".
  const [waMode, setWaMode] = useState(false);
  const [waStep, setWaStep] = useState(0);
  const [waPhone, setWaPhone] = useState('');
  const [waCode, setWaCode] = useState('');
  // «إعادة الإرسال» opens after the same minute the API keeps the code it just
  // sent (lib/whatsappOtp.js RESEND_COOLDOWN_SECONDS); before, the only way to
  // ask again was going back a step and typing the number over.
  const RESEND_AFTER_SECONDS = 60;
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);
  const [waName, setWaName] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  // OTP flow: 0=enter email, 1=enter OTP code, 2=enter new password
  const [otpStep, setOtpStep] = useState(0);
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  // 2FA state (admin login)
  const [twoFaStep, setTwoFaStep] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaTempToken, setTwoFaTempToken] = useState('');
  const [twoFaEmail, setTwoFaEmail] = useState('');
  // «استخدم كود استرجاع»: the phone with the authenticator is not at hand, so
  // one of the one-time codes shown when 2FA was switched on stands in — the
  // same door the admin login has (admin/pages/Auth.tsx).
  const [twoFaRecovery, setTwoFaRecovery] = useState(false);
    const [fullName, setFullName] = useState('');
        const [phone, setPhone] = useState('');
        const [country, setCountry] = useState('مصر');
        const [interest, setInterest] = useState('علاج نفسي');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);  const [showPassword, setShowPassword] = useState(false);    const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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
    const referralCode = (queryParams.get('ref') || '').trim().toUpperCase().slice(0, 32);

    // Redirect if already authenticated
    useEffect(() => {
        if (authUser === undefined) return; // still loading
        if (!authUser) return;
        if (safeRedirect) { navigate(safeRedirect, { replace: true }); return; }
        // The dashboard is a separate app on a separate host, so it is a page
        // load, not a route change. navigate('/dashboard') stayed inside this
        // router — which registers /dashboard as `<Navigate to="/" replace />`
        // — so every staff member who signed in here was bounced silently to
        // the home page. The check that identified them worked; the
        // destination was simply not somewhere this router could go.
        if (isAdmin) { window.location.assign(adminDashboardUrl()); return; }
        // Non-admin: check if this user is a staff member (sales, admin role, etc.)
        if (staffCheckDoneRef.current) return;
        staffCheckDoneRef.current = true;
        mysqlClient.checkIsStaff()
            .then(r => { if (r.isStaff) window.location.assign(adminDashboardUrl()); else navigate('/'); })
            .catch(() => navigate('/'));
    }, [authUser, isAdmin, navigate, safeRedirect]);

    const handleWaRequest = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!waPhone.trim()) return;
        setLoading(true);
        setNotice(null);
        try {
            await mysqlAuth.requestWaOtp(waPhone.trim());
            setWaStep(1);
            setResendIn(RESEND_AFTER_SECONDS);
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: msg || 'تعذّر إرسال الرمز. تأكد من الرقم وحاول مرة أخرى.' });
        } finally {
            setLoading(false);
        }
    };

    const handleWaResend = async () => {
        if (resendIn > 0 || loading) return;
        setLoading(true);
        setNotice(null);
        setWaCode('');
        try {
            await mysqlAuth.requestWaOtp(waPhone.trim());
            setResendIn(RESEND_AFTER_SECONDS);
            setNotice({ type: 'success', text: 'بعتنا رمز جديد — استخدم آخر رمز وصلك.' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: msg || 'تعذّر إرسال الرمز. حاول مرة أخرى.' });
        } finally {
            setLoading(false);
        }
    };

    const handleWaVerify = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (waCode.length !== 6) return;
        setLoading(true);
        setNotice(null);
        try {
            // The session itself lives in the httpOnly cookie the API just set —
            // nothing to stash here. `created` is still read from the body to
            // greet a brand-new customer differently from a returning one.
            const result = await mysqlAuth.verifyWaOtp(waPhone.trim(), waCode, waName.trim() || undefined);
            setNotice({
                type: 'success',
                text: result.created ? 'أهلاً بك! تم إنشاء حسابك.' : 'تم تسجيل الدخول.',
            });
            refreshAuth();   // navigation is handled by the effect watching authUser
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: msg || 'الرمز غير صحيح أو منتهي الصلاحية.' });
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!forgotEmail.trim()) return;
        setLoading(true);
        setNotice(null);
        try {
            await mysqlAuth.forgotPassword(forgotEmail.trim());
            setOtpStep(1);
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: msg || 'حدث خطأ، تأكد من البريد الإلكتروني وحاول مرة أخرى.' });
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!otpCode.trim()) return;
        setLoading(true);
        setNotice(null);
        try {
            const res = await mysqlAuth.verifyOtp(forgotEmail.trim(), otpCode.trim());
            setResetToken(res.resetToken);
            setOtpStep(2);
        } catch {
            setNotice({ type: 'error', text: 'الكود غير صحيح أو منتهي الصلاحية.' });
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (newPassword.length < 8) { setNotice({ type: 'error', text: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' }); return; }
        setLoading(true);
        setNotice(null);
        try {
            await mysqlAuth.resetPassword(resetToken, newPassword);
            setForgotSent(true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: msg || 'حدث خطأ، حاول مرة أخرى.' });
        } finally {
            setLoading(false);
        }
    };

    const handleVerify2fa = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (twoFaRecovery ? twoFaCode.replace(/[^A-Za-z0-9]/g, '').length !== 12 : twoFaCode.length !== 6) return;
        setLoading(true);
        setNotice(null);
        try {
            if (!twoFaTempToken) throw new Error('Missing 2FA session');
            if (twoFaRecovery) await mysqlAuth.verify2faRecovery(twoFaTempToken, twoFaCode);
            else await mysqlAuth.verify2fa(twoFaTempToken, twoFaCode);
            setTwoFaStep(false);
            setTwoFaCode('');
            setTwoFaTempToken('');
            setTwoFaRecovery(false);
            refreshAuth();
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            setNotice({ type: 'error', text: twoFaRecovery ? (msg || 'كود الاسترجاع غير صحيح أو اتستخدم قبل كده.') : 'الرمز غير صحيح أو منتهي الصلاحية.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isLogin) {
            if (!email.trim() || !password.trim()) {
                setNotice({ type: 'error', text: 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور.' });
                return;
            }
        } else {
            // Phone (WhatsApp) is the required identity at signup — email and
            // name are optional. Matches login, which already accepts email or
            // phone as the same identifier field.
            if (!phone.trim() || !password.trim()) {
                setNotice({ type: 'error', text: 'يرجى إدخال رقم الهاتف (واتساب) وكلمة المرور.' });
                return;
            }
            if (email.trim()) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email.trim())) {
                    setNotice({ type: 'error', text: 'البريد الإلكتروني غير صحيح (example@domain.com) — أو اتركه فارغاً.' });
                    return;
                }
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
                const result = await mysqlAuth.login(email.trim(), password);
                if (result.totpRequired) {
                    if (!result.pendingToken) throw new Error('Missing 2FA session');
                    setTwoFaTempToken(result.pendingToken);
                    setTwoFaEmail(email.trim());
                    setTwoFaStep(true);
                    return;
                }
                setNotice({ type: 'success', text: 'تم تسجيل الدخول بنجاح.' });
            } else {
                await mysqlAuth.register({
                    email: email.trim(),
                    password,
                    name: fullName.trim(),
                    phone: phone.trim(),
                    country,
                    interest,
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
            // Handle needsPasswordReset — subscriber exists but no password set yet
            if (msg.includes('نسيت كلمة المرور') || msg.includes('needsPasswordReset') || (error as any)?.needsPasswordReset) {
                setNotice({ type: 'error', text: 'لم يتم تعيين كلمة مرور لهذا الحساب بعد. يرجى الضغط على "نسيت كلمة المرور" أدناه لتعيين كلمة مرور جديدة.' });
                return;
            }
            const arabicMessages: Record<string, string> = {
                'Email already registered': 'هذا البريد الإلكتروني مستخدم بالفعل، حاول تسجيل الدخول.',
                // 211 failed sign-ins in a week were addresses with no account,
                // about seven tries each — mostly clients who joined by phone.
                // One wording for both failures, so it says nothing of which.
                // The server gives this one answer for an unknown account, a wrong
                // password and an account with no password yet, so it names every
                // way in.
                'Invalid credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. لو اشتركت برقم موبايلك، ادخل من «💬 الدخول برقم الواتساب» تحت، ولو لسه معندكش كلمة مرور اضغط «نسيت كلمة المرور».',
                'Email and password required': 'يرجى إدخال البريد الإلكتروني وكلمة المرور.',
                'Password must be at least 8 characters': 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.',
                'Login failed': 'حدث خطأ في الخادم، حاول مرة أخرى.',
            };
            const isRateLimit = msg.includes('محاولات كثيرة') || msg.includes('HTTP 429');
            // The account's own rules — a third device, or a freeze for use
            // from many networks — arrive in Arabic and say what to do; the
            // generic «تعذر إتمام العملية» hid them.
            const isAccountRule = ['DEVICE_LIMIT', 'ACCOUNT_SHARING_LOCKED'].includes((error as { code?: string })?.code || '');
            const showsServerText = isAccountRule || msg.includes('لم يتم تعيين كلمة مرور');
            const isDbDown = msg.includes('DB unavailable') || msg.includes('tunnel') || msg.includes('HTTP 503');
            // Same distinction the admin sign-in makes: a request that never
            // reached the server is not a rejected sign-in. Telling a customer
            // "تعذر إتمام العملية" for a dropped connection sends them to reset a
            // password that was never wrong.
            const isTimeout = (error instanceof DOMException && error.name === 'AbortError')
                || msg.includes('aborted');
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-8">
        <div className="text-center mb-8">
           <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-2xl font-black text-gold-pale">
              ن
           </div>
           <h2 className="text-2xl font-black text-ink sm:text-[28px]">
             {twoFaStep ? 'التحقق الثنائي' : forgotMode ? 'استعادة كلمة المرور' : isLogin ? 'تسجيل الدخول إلى حسابك' : 'إنشاء حساب جديد'}
           </h2>
           <p className="mt-2 text-sm text-muted-body">مرحباً بك في مجتمع معهد الدراسات النفسية</p>
        </div>

        {/* ── 2FA step (admin login) ── */}
        {twoFaStep ? (
          <form className="space-y-4 animate-fade-in" onSubmit={handleVerify2fa}>
            <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
              <div className="text-3xl mb-2">🔐</div>
              {/* This said «تم إرسال رمز التحقق إلى {email}» — nothing is sent.
                  The second line, telling them to open their authenticator, was
                  right; the headline above it had people waiting for an email
                  that was never going to arrive. */}
              <p className="text-sm font-black text-ink">{twoFaRecovery ? 'أدخل كود من أكواد الاسترجاع' : 'هذا الحساب محمي بالتحقق الثنائي'}</p>
              <p className="mt-1 font-mono text-sm text-primary-700">{twoFaEmail}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {twoFaRecovery
                  ? 'الأكواد اللي ظهرتلك لما فعّلت التحقق الثنائي — كل كود بيشتغل مرة واحدة بس'
                  : 'افتح تطبيق المصادقة (Google Authenticator أو ما شابه) وأدخل الرمز المعروض الآن'}
              </p>
            </div>
            <div>
              {twoFaRecovery ? (
                <>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">كود الاسترجاع</label>
                  <input
                    key="recovery"
                    type="text"
                    dir="ltr"
                    value={twoFaCode}
                    onChange={e => setTwoFaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14))}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-center font-mono text-xl tracking-wider"
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    autoFocus
                    required
                  />
                </>
              ) : (
                <>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">رمز التحقق (6 أرقام)</label>
                  <input
                    key="totp"
                    type="text"
                    value={twoFaCode}
                    onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-center font-mono text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                    required
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => { setTwoFaRecovery(!twoFaRecovery); setTwoFaCode(''); setNotice(null); }}
                className="mt-2 min-h-[36px] text-xs font-bold text-primary-700 underline underline-offset-4 hover:text-primary-800"
              >
                {twoFaRecovery ? 'استخدم رمز التطبيق' : 'استخدم كود استرجاع'}
              </button>
            </div>
            {notice && (
              <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
            )}
            <button type="submit" disabled={loading || (twoFaRecovery ? twoFaCode.replace(/[^A-Z0-9]/g, '').length !== 12 : twoFaCode.length !== 6)} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'جارٍ التحقق...' : 'تأكيد الدخول'}
            </button>
            <button type="button" onClick={() => { setTwoFaStep(false); setTwoFaCode(''); setTwoFaTempToken(''); setTwoFaRecovery(false); setNotice(null); }} className="min-h-[44px] w-full text-sm font-bold text-muted hover:text-ink">← العودة لتسجيل الدخول</button>
          </form>
        ) : /* ── Forgot password mode ── */
        forgotMode ? (
          <div className="animate-fade-in">
            {forgotSent ? (
              /* ── Step 4: Success ── */
              <div className="space-y-4">
                <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-green-800 font-bold mb-2">تم تغيير كلمة المرور!</p>
                  <p className="text-sm leading-relaxed text-muted-body">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
                </div>
                <button
                  onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(''); setOtpCode(''); setResetToken(''); setNewPassword(''); setOtpStep(0); setIsLogin(true); }}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            ) : otpStep === 0 ? (
              /* ── Step 1: Enter identifier ── */
              <form className="space-y-4" onSubmit={handleForgotPassword}>
                <p className="text-sm leading-relaxed text-muted-body">أدخل بريدك الإلكتروني أو رقم هاتفك وسنُرسل لك كود التحقق.</p>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">البريد الإلكتروني أو رقم الهاتف</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10"
                    placeholder="example@domain.com أو 01012345678"
                    required
                  />
                </div>
                {notice && (
                  <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? 'جارٍ الإرسال...' : 'إرسال كود التحقق'}
                </button>
                <button type="button" onClick={() => { setForgotMode(false); setNotice(null); }} className="min-h-[44px] w-full text-sm font-bold text-muted hover:text-ink">← العودة لتسجيل الدخول</button>
              </form>
            ) : otpStep === 1 ? (
              /* ── Step 2: Enter OTP ── */
              <form className="space-y-4" onSubmit={handleVerifyOtp}>
                <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
                  <div className="text-3xl mb-2">🔐</div>
                  {/* Worded conditionally, and channel-neutral, on purpose: the
                      API deliberately returns success even when no account
                      matches (so it can't be used to discover which accounts
                      exist), and it never reveals whether the code went out
                      over WhatsApp or email. */}
                  <p className="text-sm font-black text-ink">إذا كان هناك حساب مسجّل، فقد أرسلنا كوداً من 6 أرقام على واتساب أو البريد الإلكتروني</p>
                  <p className="mt-1 font-mono text-sm text-primary-700" dir="ltr">{forgotEmail}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">تحقق من واتساب، أو من مجلد البريد المزعج (Spam). إذا لم يصلك الكود خلال دقائق، فغالباً لا يوجد حساب بهذه البيانات — جرّب بيانات أخرى أو تواصل مع الدعم.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">كود التحقق</label>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-center font-mono text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
                {notice && (
                  <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading || otpCode.length !== 6} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? 'جارٍ التحقق...' : 'تحقق من الكود'}
                </button>
                <button type="button" onClick={() => { setOtpStep(0); setOtpCode(''); setNotice(null); }} className="min-h-[44px] w-full text-sm font-bold text-muted hover:text-ink">← تغيير البيانات</button>
              </form>
            ) : (
              /* ── Step 3: Enter new password ── */
              <form className="space-y-4" onSubmit={handleResetPassword}>
                <p className="text-center text-sm text-muted-body">أدخل كلمة المرور الجديدة.</p>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">كلمة المرور الجديدة</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 pl-12"
                      placeholder="8 أحرف على الأقل"
                      required
                      minLength={8}
                    />
                    <button type="button" onClick={() => setShowNewPassword(v => !v)} className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-muted-soft hover:text-ink" tabIndex={-1}>
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {notice && (
                  <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}
                </button>
              </form>
            )}
          </div>
        ) : waMode ? (
          /* ── WhatsApp number + code ──────────────────────────────────────
             This is registration and sign-in at once: a number with no account
             gets one on verification, so the customer never has to decide which
             they are doing. Email + password stays reachable as a fallback. */
          <div className="space-y-4 animate-fade-in">
            {waStep === 0 ? (
              <form className="space-y-4" onSubmit={handleWaRequest}>
                <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
                  <div className="text-3xl mb-1">💬</div>
                  <p className="text-sm font-black text-ink">هنبعتلك رمز على واتساب</p>
                  <p className="mt-1 text-xs text-muted">جديد أو عندك حساب — نفس الخطوة</p>
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">رقم الواتساب</label>
                  <input
                    type="tel" inputMode="tel" dir="ltr" value={waPhone}
                    onChange={e => setWaPhone(e.target.value)}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-left"
                    placeholder="01012345678"
                  />
                  <p className="mt-1 text-xs text-muted-soft">اكتب الرقم بأي صيغة — 01… أو ‎+20…</p>
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">
                    الاسم <span className="font-normal text-muted-soft">(لو حساب جديد)</span>
                  </label>
                  {/* Collected here rather than after verification so a new
                      customer is never stopped mid-flow to be asked. It is
                      ignored for a returning number, so a stale value can
                      never rename anyone. */}
                  <input
                    type="text" value={waName}
                    onChange={e => setWaName(e.target.value)}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10"
                    placeholder="اسمك"
                  />
                </div>
                {notice && (
                  <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
                )}
                <button
                  type="submit" disabled={loading || !waPhone.trim()}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'جاري الإرسال...' : 'إرسال الرمز'}
                </button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={handleWaVerify}>
                <div className="rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
                  {/* Says the same thing whether or not the number is
                      registered — the API deliberately answers identically, so
                      the wording must not give away what it withholds. */}
                  <p className="text-sm font-black text-ink">بعتنا رمز من 6 أرقام على واتساب</p>
                  <p className="mt-1 font-mono text-sm text-primary-700" dir="ltr">{waPhone}</p>
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-bold text-muted-strong">رمز التحقق</label>
                  <input
                    type="text" inputMode="numeric" dir="ltr" value={waCode}
                    onChange={e => setWaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-center font-mono text-lg tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>
                {/* Without this the step failed in total silence: the code was
                    accepted, the error was swallowed, and nothing on screen
                    changed. Every other form in this file already shows it. */}
                {notice && (
                  <div className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
                )}
                <button
                  type="submit" disabled={loading || waCode.length !== 6}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'جاري التحقق...' : 'دخول'}
                </button>
                <button
                  type="button" onClick={() => { void handleWaResend(); }} disabled={loading || resendIn > 0}
                  className="min-h-[44px] w-full text-sm font-bold text-primary-700 hover:text-primary-800 disabled:text-muted-faint"
                >
                  {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : 'إعادة إرسال الرمز'}
                </button>
                <button
                  type="button" onClick={() => { setWaStep(0); setWaCode(''); setResendIn(0); }}
                  className="min-h-[44px] w-full text-sm font-bold text-muted hover:text-ink"
                >
                  تغيير الرقم
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => { setWaMode(false); setWaStep(0); setWaCode(''); setNotice(null); }}
              className="min-h-[44px] w-full text-sm font-bold text-primary-700 hover:underline"
            >
              الدخول بالبريد الإلكتروني أو رقم الهاتف بدلاً من ذلك
            </button>
          </div>
        ) : (
          <>
                <form className="space-y-4 animate-fade-in" onSubmit={handleSubmit}>
           {!isLogin && (
               <>
                   <div>
                       <label className="mb-1 block text-[13px] font-bold text-muted-strong">الاسم الكامل <span className="font-normal text-muted-soft">(اختياري)</span></label>
                                             <input
                                                 type="text"
                                                 value={fullName}
                                                 onChange={(e) => setFullName(e.target.value)}
                                                 className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10"
                                                 placeholder="الاسم الثلاثي"
                                             />
                   </div>
                   <div>
                       <label className="mb-1 block text-[13px] font-bold text-muted-strong">رقم الهاتف (واتساب)</label>
                       <input type="tel" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 text-left" placeholder="01012345678" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1 block text-[13px] font-bold text-muted-strong">الدولة</label>
                            <select value={country} onChange={(e) => setCountry(e.target.value)} className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10">
                                <option>مصر</option>
                                <option>السعودية</option>
                                <option>الإمارات</option>
                                <option>الكويت</option>
                                <option>أخرى</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[13px] font-bold text-muted-strong">الاهتمام</label>
                            <select value={interest} onChange={(e) => setInterest(e.target.value)} className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10">
                                <option>علاج نفسي</option>
                                <option>إرشاد أسري</option>
                                <option>أطفال</option>
                                <option>تطوير ذات</option>
                            </select>
                        </div>
                   </div>
               </>
           )}
           <div>
               <label className="mb-1 block text-[13px] font-bold text-muted-strong">
                 {isLogin ? 'البريد الإلكتروني أو رقم الهاتف' : <>البريد الإلكتروني <span className="font-normal text-muted-soft">(اختياري)</span></>}
               </label>
                             <input
                                 type={isLogin ? 'text' : 'email'}
                                 dir={isLogin ? 'ltr' : undefined}
                                 value={email}
                                 onChange={(e) => setEmail(e.target.value)}
                                 placeholder={isLogin ? 'example@domain.com أو 01012345678' : undefined}
                                 className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10"
                             />
           </div>
           <div>
               <label className="mb-1 block text-[13px] font-bold text-muted-strong">كلمة المرور</label>
               <div className="relative">
                 <input
                   type={showPassword ? 'text' : 'password'}
                   value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   className="min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10 pl-12"
                 />
                 <button
                   type="button"
                   onClick={() => setShowPassword(v => !v)}
                   className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-muted-soft hover:text-ink"
                   tabIndex={-1}
                 >
                   {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                 </button>
               </div>
           </div>
           {isLogin && (
             <div className="text-left">
               <button
                 type="button"
                 onClick={() => { setForgotMode(true); setNotice(null); }}
                 className="min-h-[36px] text-sm font-bold text-primary-700 hover:underline"
               >
                 نسيت كلمة المرور؟
               </button>
             </div>
           )}

           {isLogin && (
             <div className="pt-1">
               <div className="relative my-2 text-center">
                 <span className="relative z-10 bg-white px-3 text-xs font-bold text-muted-soft">أو</span>
                 <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
               </div>
               <button
                 type="button"
                 onClick={() => { setWaMode(true); setWaStep(0); setWaCode(''); setNotice(null); }}
                 className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white font-extrabold text-ink transition hover:border-ink/40"
               >
                 💬 الدخول برقم الواتساب
               </button>
             </div>
           )}

                     {notice && (
                         <div
                             className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${notice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
                         >
                             {notice.text}
                         </div>
                     )}
           
                     <button
                         type="submit"
                         disabled={loading}
                         className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60 mt-4 shadow-[0_16px_30px_-14px_rgba(159,18,57,.8)]"
                     >
                             {loading ? 'جاري التنفيذ...' : isLogin ? 'دخول' : 'تسجيل حساب جديد'}
           </button>
        </form>
          </>
        )}
        {/* Fixed on the login page regardless of which mode (email/phone or
            WhatsApp) is showing — only hidden mid-verification (2FA / password
            reset), where switching to registration mid-flow makes no sense. */}
        {!twoFaStep && !forgotMode && (
          <div className="mt-6 text-center text-sm">
              <p className="text-muted-body">
                  {isLogin ? 'ليس لديك حساب؟' : 'لديك حساب بالفعل؟'} {' '}
                  <button onClick={() => { setIsLogin(!isLogin); setWaMode(false); setNotice(null); }} className="inline-flex min-h-[44px] items-center font-black text-primary-700 hover:underline">
                      {isLogin ? 'أنشئ حساباً' : 'سجل دخولك'}
                  </button>
              </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;
