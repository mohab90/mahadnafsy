import React, { useCallback, useEffect, useState } from 'react';
import { mysqlAuth, type ActiveSession } from '../../../lib/mysqlapi';
import { cairoDateTime } from '../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', message: string) => void;

/**
 * Where this account is signed in, and «سجّل خروج من باقي الأجهزة»
 * (api/routes/auth/sessions.js). Staff may be signed in on several devices at
 * once; until now a laptop left signed in at a branch stayed so for its whole
 * session unless the password was changed.
 */
const ActiveSessionsSection: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    mysqlAuth.listSessions()
      .then(result => setSessions(result.sessions))
      .catch(() => setSessions([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const logoutOthers = async () => {
    setWorking(true);
    try {
      const result = await mysqlAuth.logoutOtherSessions();
      notify('success', result.signedOut ? `اتقفلت ${result.signedOut} جلسة تانية` : 'مفيش أجهزة تانية — كل الجلسات القديمة اتقفلت');
      load();
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'تعذّر تسجيل الخروج من الأجهزة الأخرى');
    } finally { setWorking(false); }
  };

  const others = (sessions || []).filter(s => !s.current).length;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-800">الأجهزة المسجّل عليها حسابك</h3>
        <button type="button" disabled={working} onClick={() => void logoutOthers()}
          className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50">
          {working ? 'جارٍ...' : `سجّل خروج من باقي الأجهزة${others ? ` (${others})` : ''}`}
        </button>
      </div>
      {sessions === null ? (
        <p className="text-sm text-gray-500">جارٍ التحميل...</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500">مفيش جلسات مسجّلة لسه — بتظهر من أول تسجيل دخول جديد.</p>
      ) : (
        <ul className="divide-y text-sm">
          {sessions.map(session => (
            <li key={session.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-gray-800">
                {session.device || 'جهاز غير معروف'}
                {session.current && <span className="mr-2 text-xs text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">الجهاز ده</span>}
              </span>
              <span className="text-gray-500 text-xs" dir="ltr">{session.ipHint || ''}</span>
              <span className="text-gray-500 text-xs">آخر استخدام: {cairoDateTime(session.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ActiveSessionsSection;
