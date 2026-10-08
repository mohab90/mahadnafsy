import { useCallback, useEffect, useState } from 'react';
import { Radio, Square, Users, Video } from 'lucide-react';
import { mysqlAdmin } from '../lib/mysqlapi';
import { cairoDateTime } from '../../shared/cairoDate';
import { promptDialog } from '../../shared/ui/promptDialog';

// «لايفاتي» (8 Oct 2026): «حساب لمحاضر يدخل علي السيستم بصلاحيه محاضر ويقدر يفتح
// اللايف». The lives the administration set with this lecturer's account: open
// the stream and mark it live, end it (with the recording, when there is one).
type MyLive = {
  id: string; title: string; scheduledAt: string; durationMinutes?: number; streamUrl: string;
  status: 'upcoming' | 'live' | 'ended'; attendees: number; recordingUrl?: string;
};

export function InstructorLivePanel() {
  const [lives, setLives] = useState<MyLive[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    mysqlAdmin.adminGet<MyLive[]>('/staff/me/live-streams')
      .then(rows => setLives(Array.isArray(rows) ? rows : []))
      .catch(() => setLives([]))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (live: MyLive, status: 'LIVE' | 'ENDED') => {
    let recordingUrl = '';
    if (status === 'ENDED') {
      const answer = await promptDialog({ title: 'إنهاء اللايف', message: 'لو في رابط تسجيل للايف حطه هنا (اختياري) — العملاء بيقدروا يتفرجوا عليه بعد كده.', placeholder: 'https://…', confirmLabel: 'إنهاء' });
      if (answer === null) return;
      recordingUrl = answer.trim();
    }
    setBusy(live.id);
    setError('');
    try {
      await mysqlAdmin.adminPatch(`/staff/me/live-streams/${encodeURIComponent(live.id)}/status`, { status, recordingUrl });
      if (status === 'LIVE') window.open(live.streamUrl, '_blank', 'noopener');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر التحديث');
    } finally { setBusy(''); }
  };

  if (!loaded || !lives.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <Video size={18} className="text-red-600" />
        <h2 className="text-xl font-bold text-gray-900">لايفاتي</h2>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {lives.map(live => (
        <div key={live.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${live.status === 'live' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50/60'}`}>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900">{live.title}</p>
            <p className="text-xs text-gray-500">
              {cairoDateTime(live.scheduledAt)}{live.durationMinutes ? ` · ${live.durationMinutes} دقيقة` : ''}
              {' · '}<Users size={11} className="inline" /> {live.attendees} حضروا
            </p>
          </div>
          {live.status === 'upcoming' && (
            <button disabled={busy === live.id} onClick={() => void setStatus(live, 'LIVE')}
              className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
              <Radio size={14} /> ابدأ اللايف
            </button>
          )}
          {live.status === 'live' && (
            <>
              <a href={live.streamUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700">ادخل البث</a>
              <button disabled={busy === live.id} onClick={() => void setStatus(live, 'ENDED')}
                className="inline-flex items-center gap-1 rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-50">
                <Square size={13} /> إنهاء
              </button>
            </>
          )}
          {live.status === 'ended' && <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-bold text-gray-600">انتهى</span>}
        </div>
      ))}
    </div>
  );
}
