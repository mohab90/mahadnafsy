import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { mysqlAuth } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';

/**
 * «أكّد بريدك»: a sign-up's email is not used to find the account, its client
 * record or its password reset until its owner proves it (api/lib/emailVerification.js).
 * The email sent at sign-up carries a link and a code; this takes the code, sends
 * a new email, and says how the link went when it lands back here (?emailVerified=).
 */
const EmailVerifyNotice: React.FC = () => {
  const { authUser } = useSiteData();
  const { search, pathname } = useLocation();
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [closed, setClosed] = useState(false);
  const linkResult = new URLSearchParams(search).get('emailVerified');

  useEffect(() => {
    if (!authUser?.uid) { setPending(false); return; }
    let cancelled = false;
    mysqlAuth.me()
      .then(me => { if (!cancelled) setPending(Boolean(me.email) && me.emailVerified === false); })
      .catch(() => { /* the notice is optional */ });
    return () => { cancelled = true; };
  }, [authUser?.uid, linkResult]);

  const verify = async () => {
    if (code.length !== 6) return;
    setWorking(true); setMessage('');
    try {
      await mysqlAuth.verifyEmailCode(code);
      setPending(false);
      setMessage('تم تأكيد بريدك ✅');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'الكود غير صحيح');
    } finally { setWorking(false); }
  };
  const resend = async () => {
    setWorking(true); setMessage('');
    try {
      const result = await mysqlAuth.resendEmailVerification();
      if (result.alreadyVerified) setPending(false);
      setMessage(result.alreadyVerified ? 'بريدك متأكد بالفعل' : 'بعتنالك رسالة جديدة');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'تعذّر الإرسال، حاول بعد شوية');
    } finally { setWorking(false); }
  };

  if (closed || pathname === '/auth') return null;
  if (!pending) {
    if (linkResult === null && !message) return null;
    const ok = message ? !/غير|تعذّر/.test(message) : linkResult === '1';
    return (
      <div className={`fixed top-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 sm:max-w-sm rounded-2xl shadow-lg p-3 text-sm ${ok ? 'bg-emerald-50 border border-emerald-300 text-emerald-800' : 'bg-red-50 border border-red-300 text-red-800'}`} dir="rtl" role="status">
        <button type="button" onClick={() => setClosed(true)} aria-label="إغلاق" className="float-left text-lg leading-none">×</button>
        {message || (linkResult === '1' ? 'تم تأكيد بريدك ✅' : 'رابط التأكيد غير صالح أو انتهت صلاحيته — اطلب رابط جديد من حسابك')}
      </div>
    );
  }
  return (
    <div className="fixed top-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 sm:max-w-sm bg-white border border-amber-300 rounded-2xl shadow-lg p-4 space-y-2" dir="rtl" role="alert">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm text-gray-800">
          <span className="block font-bold text-amber-700">أكّد بريدك الإلكتروني</span>
          بعتنالك رابط وكود على بريدك. لحد ما تأكده، ادخل برقم الواتساب.
        </p>
        <button type="button" onClick={() => setClosed(true)} aria-label="إغلاق" className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
          autoComplete="one-time-code" placeholder="الكود" className="flex-1 rounded-xl border px-3 py-1.5 text-center tracking-widest" />
        <button type="button" disabled={working || code.length !== 6} onClick={() => void verify()}
          className="rounded-xl bg-primary-600 text-white px-3 py-1.5 text-sm font-bold disabled:opacity-50">تأكيد</button>
      </div>
      <button type="button" disabled={working} onClick={() => void resend()} className="text-xs text-primary-700 underline">ابعتلي رسالة جديدة</button>
      {message && <p className="text-xs text-gray-700">{message}</p>}
    </div>
  );
};

export default EmailVerifyNotice;
