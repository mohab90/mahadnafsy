import React, { useCallback, useEffect, useState } from 'react';
import { mysqlAuth, type MfaRequirement } from '../lib/mysqlapi';

/**
 * Two-factor is mandatory for the accounts that see money or change
 * permissions (api/lib/mfaPolicy.js). After the password, such an account
 * without 2FA lands here:
 *   - during its grace period: the enrolment screen with a countdown, and
 *     «لاحقاً» to go on working (a thin reminder stays at the top);
 *   - after it: this screen alone — the server refuses its staff routes until
 *     it enrols, so the dashboard would only be a page of errors.
 * Anything else (enrolled, not required, the check failing) shows the panel:
 * the server enforces the policy whatever this screen shows.
 */
const DISMISS_KEY = 'mahad-mfa-enrol-later';

function timeLeft(until: string | null, now: number): string {
  if (!until) return '';
  const ms = Date.parse(until) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'انتهت المهلة';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days} يوم و${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة و${minutes} دقيقة`;
  return `${minutes} دقيقة`;
}

function readDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

const EnrolmentScreen: React.FC<{
  requirement: MfaRequirement;
  now: number;
  onLater?: () => void;
  onDone: () => void;
}> = ({ requirement, now, onLater, onDone }) => {
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setWorking(true); setError('');
    try {
      const result = await mysqlAuth.setup2fa();
      setQr(result.qrDataUrl);
      setSecret(result.secret);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذّر بدء الإعداد');
    } finally { setWorking(false); }
  };

  const confirm = async () => {
    if (code.length !== 6) return;
    setWorking(true); setError('');
    try {
      const result = await mysqlAuth.enable2fa(code);
      setCodes(result.recoveryCodes || []);
      if (!result.recoveryCodes?.length) onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'الرمز غير صحيح');
    } finally { setWorking(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir="rtl">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-lg font-bold text-gray-900">فعّل التحقق الثنائي</h1>
        <p className="text-sm text-gray-600">
          حسابك بيشوف فلوس أو بيغيّر صلاحيات، فلازم يبقى عليه رمز من تطبيق المصادقة
          (Google Authenticator أو Microsoft Authenticator) غير كلمة المرور.
        </p>
        {requirement.blocked ? (
          <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
            المهلة خلصت — الحساب مقفول لحد ما تفعّل التحقق الثنائي.
          </p>
        ) : (
          <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            فاضل على نهاية المهلة: {timeLeft(requirement.graceEndsAt, now)}
          </p>
        )}

        {codes.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              دي أكواد الاسترجاع — كل كود يدخّلك مرة واحدة لو التليفون ضاع. اكتبهم واحفظهم في مكان أمين؛ مش هيظهروا تاني.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-gray-50 rounded-xl p-3" dir="ltr">
              {codes.map(item => <span key={item}>{item}</span>)}
            </div>
            <button type="button" onClick={onDone}
              className="w-full rounded-xl bg-primary-600 text-white py-2 font-semibold">حفظتهم — كمّل</button>
          </div>
        ) : qr ? (
          <div className="space-y-3">
            <img src={qr} alt="QR" className="mx-auto w-44 h-44" />
            <p className="text-xs text-gray-500 text-center break-all" dir="ltr">{secret}</p>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="الرمز من التطبيق (6 أرقام)"
              className="w-full rounded-xl border px-3 py-2 text-center tracking-widest" />
            <button type="button" disabled={working || code.length !== 6} onClick={() => void confirm()}
              className="w-full rounded-xl bg-primary-600 text-white py-2 font-semibold disabled:opacity-50">
              {working ? 'جارٍ...' : 'تأكيد وتفعيل'}
            </button>
          </div>
        ) : (
          <button type="button" disabled={working} onClick={() => void start()}
            className="w-full rounded-xl bg-primary-600 text-white py-2 font-semibold disabled:opacity-50">
            {working ? 'جارٍ...' : 'ابدأ الإعداد'}
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-between text-sm pt-2">
          {onLater && !requirement.blocked && codes.length === 0
            ? <button type="button" onClick={onLater} className="text-gray-600 hover:underline">لاحقاً</button>
            : <span />}
          <button type="button" onClick={() => { mysqlAuth.logout(); window.location.assign('/auth'); }}
            className="text-gray-500 hover:underline">تسجيل الخروج</button>
        </div>
      </div>
    </div>
  );
};

export const MfaEnrolmentGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [requirement, setRequirement] = useState<MfaRequirement | null>(null);
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    mysqlAuth.get2faRequirement()
      .then(setRequirement)
      .catch(() => setRequirement(null))
      .finally(() => setChecked(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!checked) return null;
  const pending = Boolean(requirement?.required && !requirement.enrolled);
  if (!requirement || !pending) return <>{children}</>;

  const blocked = requirement.blocked || (requirement.graceEndsAt !== null && Date.parse(requirement.graceEndsAt) <= now);
  const done = () => { try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* private mode */ } load(); };
  if (blocked || !dismissed) {
    return (
      <EnrolmentScreen
        requirement={{ ...requirement, blocked }}
        now={now}
        onDone={done}
        onLater={blocked ? undefined : () => {
          try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
          setDismissed(true);
        }}
      />
    );
  }
  return (
    <>
      <div className="sticky top-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-900 text-sm px-4 py-2 flex items-center justify-between gap-2" dir="rtl">
        <span>فعّل التحقق الثنائي — فاضل {timeLeft(requirement.graceEndsAt, now)} وبعدها الحساب هيتقفل لحد ما تفعّله.</span>
        <button type="button" onClick={() => setDismissed(false)} className="font-semibold underline whitespace-nowrap">فعّل دلوقتي</button>
      </div>
      {children}
    </>
  );
};

export default MfaEnrolmentGate;
