import React, { FormEvent, useEffect, useState } from 'react';

/**
 * The second step of an important account's sign-in: the six-digit code that was sent to its email (api/lib/loginEmailCode.js).
 * Shared by the admin panel and the public site, which both sign the same accounts in.
 *
 * `onVerify` resolves when the session is open (the cookie is set by the API) and rejects with the message to show; `onResend` asks for
 * a new code and resolves with how long to wait before asking again.
 */
export interface EmailCodeStepProps {
  hint: string;
  initialResendIn?: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<number>;
  onCancel: () => void;
}

export const EmailCodeStep: React.FC<EmailCodeStepProps> = ({ hint, initialResendIn = 45, onVerify, onResend, onCancel }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(initialResendIn);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== 6 || loading) return;
    setLoading(true);
    setNotice(null);
    try {
      await onVerify(code);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error && error.message ? error.message : 'الكود غير صحيح أو منتهي الصلاحية.' });
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    setNotice(null);
    try {
      setResendIn(await onResend());
      setCode('');
      setNotice({ type: 'success', text: 'بعتنالك كود جديد على البريد.' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error && error.message ? error.message : 'تعذّر إرسال كود جديد، جرّب بعد شوية.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit} dir="rtl">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
        <div className="mb-2 text-3xl">📧</div>
        <p className="text-sm font-bold text-amber-800">اكتب الكود اللي وصلك على البريد الإلكتروني</p>
        <p className="mt-1 font-mono text-sm text-amber-700" dir="ltr">{hint}</p>
        <p className="mt-1 text-xs text-gray-500">الحساب ده محمي — الكود صالح 10 دقايق ولمرة واحدة</p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">كود الدخول (6 أرقام)</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="w-full rounded-lg border px-4 py-3 text-center font-mono text-2xl tracking-widest outline-none focus:ring-2 focus:ring-amber-500"
          placeholder="000000"
          maxLength={6}
          autoFocus
          required
        />
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendIn > 0 || loading}
          className="mt-2 text-xs text-amber-700 underline hover:text-amber-900 disabled:text-gray-400 disabled:no-underline"
        >
          {resendIn > 0 ? `إرسال كود جديد بعد ${resendIn} ثانية` : 'ماوصلنيش الكود — ابعت كود جديد'}
        </button>
      </div>
      {notice && (
        <div className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
      )}
      <button type="submit" disabled={loading || code.length !== 6} className="w-full rounded-lg bg-amber-600 py-3 font-bold text-white transition hover:bg-amber-700 disabled:opacity-60">
        {loading ? 'جارٍ التحقق...' : 'تأكيد الدخول'}
      </button>
      <button type="button" onClick={onCancel} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">← العودة لتسجيل الدخول</button>
    </form>
  );
};

export default EmailCodeStep;
