import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { mysqlAuth, mysqlClient } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';

const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
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

    // Redirect if already authenticated
    useEffect(() => {
        if (authUser === undefined) return; // still loading
        if (!authUser) return;
        if (isAdmin) { navigate('/dashboard'); return; }
        // Non-admin: check if this user is a staff member (sales, admin role, etc.)
        if (staffCheckDoneRef.current) return;
        staffCheckDoneRef.current = true;
        mysqlClient.checkIsStaff()
            .then(r => navigate(r.isStaff ? '/dashboard' : '/'))
            .catch(() => navigate('/'));
    }, [authUser, isAdmin, navigate]);

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
        if (twoFaCode.length !== 6) return;
        setLoading(true);
        setNotice(null);
        try {
            if (!twoFaTempToken) throw new Error('Missing 2FA session');
            const result = await mysqlAuth.verify2fa(twoFaTempToken, twoFaCode);
            localStorage.setItem('mahad-token', result.token);
            setTwoFaStep(false);
            setTwoFaCode('');
            setTwoFaTempToken('');
            refreshAuth();
        } catch {
            setNotice({ type: 'error', text: 'الرمز غير صحيح أو منتهي الصلاحية.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!email.trim() || !password.trim()) {
            setNotice({ type: 'error', text: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' });
            return;
        }        if (!isLogin) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                setNotice({ type: 'error', text: 'يرجى إدخال بريد إلكتروني صحيح (example@domain.com).' });
                return;
            }
            if (!fullName.trim()) {
                setNotice({ type: 'error', text: 'يرجى إدخال الاسم الكامل.' });
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
                const result = await mysqlAuth.login(email.trim(), password);
                if (result.totpRequired) {
                    if (!result.pendingToken) throw new Error('Missing 2FA session');
                    setTwoFaTempToken(result.pendingToken);
                    setTwoFaEmail(email.trim());
                    setTwoFaStep(true);
                    return;
                }
                if (!result.token) throw new Error('Login did not return a session token');
                localStorage.setItem('mahad-token', result.token); // keep for backward compat with existing sessions
                setNotice({ type: 'success', text: 'تم تسجيل الدخول بنجاح.' });
            } else {
                const result = await mysqlAuth.register({
                    email: email.trim(),
                    password,
                    name: fullName.trim(),
                    phone: phone.trim(),
                    country,
                    interest,
                });
                localStorage.setItem('mahad-token', result.token);
                setNotice({ type: 'success', text: 'تم إنشاء الحساب وتسجيل الدخول.' });
            }
            // Refresh auth state so isAdmin and authUser update immediately
            refreshAuth();
            // Navigation handled by useEffect above when authUser updates
        } catch (error) {
            const msg = error instanceof Error ? error.message : '';
            const arabicMessages: Record<string, string> = {
                'Email already registered': 'هذا البريد الإلكتروني مستخدم بالفعل، حاول تسجيل الدخول.',
                'Invalid credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
                'Email and password required': 'يرجى إدخال البريد الإلكتروني وكلمة المرور.',
                'Password must be at least 8 characters': 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.',
                'Login failed': 'حدث خطأ في الخادم، حاول مرة أخرى.',
            };
            const isRateLimit = msg.includes('محاولات كثيرة') || msg.includes('HTTP 429');
            const isDbDown = msg.includes('DB unavailable') || msg.includes('tunnel') || msg.includes('HTTP 503');
            const arabicText = isRateLimit
                ? 'محاولات كثيرة جداً — انتظر 15 دقيقة وحاول مرة أخرى'
                : isDbDown
                    ? 'الخادم غير متاح حالياً — يرجى المحاولة بعد قليل أو تواصل مع الدعم الفني.'
                    : (arabicMessages[msg] || 'تعذر إتمام العملية، حاول مرة أخرى.');
            setNotice({ type: 'error', text: arabicText });
        } finally {
            setLoading(false);
        }
    };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="text-center mb-8">
           <div className="w-12 h-12 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-xl mx-auto mb-4 animate-float">
              ن
           </div>
           <h2 className="text-2xl font-bold text-gray-900">
             {twoFaStep ? 'التحقق الثنائي' : forgotMode ? 'استعادة كلمة المرور' : isLogin ? 'تسجيل الدخول إلى حسابك' : 'إنشاء حساب جديد'}
           </h2>
           <p className="text-gray-500 text-sm mt-2">مرحباً بك في مجتمع معهد الدراسات النفسية</p>
        </div>

        {/* ── 2FA step (admin login) ── */}
        {twoFaStep ? (
          <form className="space-y-4 animate-fade-in" onSubmit={handleVerify2fa}>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <div className="text-3xl mb-2">🔐</div>
              <p className="text-amber-800 font-bold text-sm">أدخل الرمز من تطبيق المصادقة</p>
              <p className="text-amber-700 font-mono text-sm mt-1">{twoFaEmail}</p>
              <p className="text-xs text-gray-500 mt-1">هذا الحساب محمي بالتحقق الثنائي — افتح Google Authenticator أو تطبيق المصادقة المسجل</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رمز التحقق (6 أرقام)</label>
              <input
                type="text"
                value={twoFaCode}
                onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none text-center font-mono text-2xl tracking-widest"
                placeholder="000000"
                maxLength={6}
                autoFocus
                required
              />
            </div>
            {notice && (
              <div className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{notice.text}</div>
            )}
            <button type="submit" disabled={loading || twoFaCode.length !== 6} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg transition">
              {loading ? 'جارٍ التحقق...' : 'تأكيد الدخول'}
            </button>
            <button type="button" onClick={() => { setTwoFaStep(false); setTwoFaCode(''); setTwoFaTempToken(''); setNotice(null); }} className="w-full text-sm text-gray-500 hover:text-gray-700 py-2">← العودة لتسجيل الدخول</button>
          </form>
        ) : /* ── Forgot password mode ── */
        forgotMode ? (
          <div className="animate-fade-in">
            {forgotSent ? (
              /* ── Step 4: Success ── */
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-green-800 font-bold mb-2">تم تغيير كلمة المرور!</p>
                  <p className="text-sm text-gray-600">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
                </div>
                <button
                  onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(''); setOtpCode(''); setResetToken(''); setNewPassword(''); setOtpStep(0); setIsLogin(true); }}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-lg transition"
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            ) : otpStep === 0 ? (
              /* ── Step 1: Enter email ── */
              <form className="space-y-4" onSubmit={handleForgotPassword}>
                <p className="text-sm text-gray-600">أدخل بريدك الإلكتروني وسنُرسل لك كود التحقق.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="example@domain.com"
                    required
                  />
                </div>
                {notice && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading} className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg transition">
                  {loading ? 'جارٍ الإرسال...' : 'إرسال كود التحقق'}
                </button>
                <button type="button" onClick={() => { setForgotMode(false); setNotice(null); }} className="w-full text-sm text-gray-500 hover:text-gray-700 py-2">← العودة لتسجيل الدخول</button>
              </form>
            ) : otpStep === 1 ? (
              /* ── Step 2: Enter OTP ── */
              <form className="space-y-4" onSubmit={handleVerifyOtp}>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-3xl mb-2">📧</div>
                  <p className="text-blue-800 font-bold text-sm">تم إرسال كود مكون من 6 أرقام إلى</p>
                  <p className="text-blue-700 font-mono text-sm mt-1">{forgotEmail}</p>
                  <p className="text-xs text-gray-500 mt-1">تحقق من مجلد البريد المزعج (Spam) إذا لم تجده</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">كود التحقق</label>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-center font-mono text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
                {notice && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading || otpCode.length !== 6} className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg transition">
                  {loading ? 'جارٍ التحقق...' : 'تحقق من الكود'}
                </button>
                <button type="button" onClick={() => { setOtpStep(0); setOtpCode(''); setNotice(null); }} className="w-full text-sm text-gray-500 hover:text-gray-700 py-2">← تغيير البريد الإلكتروني</button>
              </form>
            ) : (
              /* ── Step 3: Enter new password ── */
              <form className="space-y-4" onSubmit={handleResetPassword}>
                <p className="text-sm text-gray-600 text-center">أدخل كلمة المرور الجديدة.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور الجديدة</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none pr-10"
                      placeholder="8 أحرف على الأقل"
                      required
                      minLength={6}
                    />
                    <button type="button" onClick={() => setShowNewPassword(v => !v)} className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {notice && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{notice.text}</div>
                )}
                <button type="submit" disabled={loading} className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg transition">
                  {loading ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <>
                <form className="space-y-4 animate-fade-in" onSubmit={handleSubmit}>
           {!isLogin && (
               <>
                   <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل</label>
                                             <input
                                                 type="text"
                                                 value={fullName}
                                                 onChange={(e) => setFullName(e.target.value)}
                                                 className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                                                 placeholder="الاسم الثلاثي"
                                             />
                   </div>
                   <div>
                       <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                       <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" placeholder="+20 10xxxxxxxxx" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">الدولة</label>
                            <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white">
                                <option>مصر</option>
                                <option>السعودية</option>
                                <option>الإمارات</option>
                                <option>الكويت</option>
                                <option>أخرى</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">الاهتمام</label>
                            <select value={interest} onChange={(e) => setInterest(e.target.value)} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white">
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
               <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني</label>
                             <input
                                 type="email"
                                 value={email}
                                 onChange={(e) => setEmail(e.target.value)}
                                 className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                             />
           </div>
           <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور</label>
               <div className="relative">
                 <input
                   type={showPassword ? 'text' : 'password'}
                   value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none pr-10"
                 />
                 <button
                   type="button"
                   onClick={() => setShowPassword(v => !v)}
                   className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 hover:text-gray-600"
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
                 className="text-sm text-primary-600 hover:underline"
               >
                 نسيت كلمة المرور؟
               </button>
             </div>
           )}

                     {notice && (
                         <div
                             className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
                         >
                             {notice.text}
                         </div>
                     )}
           
                     <button
                         type="submit"
                         disabled={loading}
                         className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition mt-4 shadow-lg shadow-primary-500/20"
                     >
                             {loading ? 'جاري التنفيذ...' : isLogin ? 'دخول' : 'تسجيل حساب جديد'}
           </button>
        </form>

        <div className="mt-6 text-center text-sm">
            <p className="text-gray-600">
                {isLogin ? 'ليس لديك حساب؟' : 'لديك حساب بالفعل؟'} {' '}
                <button onClick={() => setIsLogin(!isLogin)} className="text-primary-600 font-bold hover:underline">
                    {isLogin ? 'أنشئ حساباً' : 'سجل دخولك'}
                </button>
            </p>
        </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Auth;
