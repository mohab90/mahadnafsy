import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Undo2, X } from 'lucide-react';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { errorText, lecturerApi, type Notify, type RoundAttendance } from './lecturerApi';
import { Empty, Loading, primaryButton, quietButton } from './ui';

/**
 * «تسجيل الحضور» of the lecturer's own Dokki round: the students ticked are marked present at the session the round is on
 * (counted from its dates, as the desk's own button does). A wrong tap is taken back on the same row.
 */
export function LecturerAttendance({ roundId, notify, onClose }: { roundId: string; notify: Notify; onClose: () => void }) {
  const [data, setData] = useState<RoundAttendance | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    lecturerApi.roundAttendance(roundId).then(result => {
      setData(result);
      // Everyone not yet marked at this session starts ticked: taking attendance is mostly «all present».
      setTicked(new Set(result.attendees.filter(row => !row.sessions.includes(result.round.session)).map(row => row.subscriberId)));
    }).catch(error => notify('error', errorText(error, 'تعذر تحميل كشف الحضور')));
  }, [roundId, notify]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;
  const { round, attendees } = data;
  const finished = round.status === 'finished';

  const toggle = (id: string) => setTicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const mark = async () => {
    setBusy(true);
    try {
      const result = await lecturerApi.markAttendance(roundId, [...ticked]);
      notify('success', `اتسجل حضور ${result.marked} طالب${result.already ? ` · ${result.already} متسجلين قبل كده` : ''}${result.failed ? ` · ${result.failed} تعذر` : ''}`);
      load();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(false); }
  };
  const undo = async (subscriberId: string, session: number, name: string) => {
    if (!await confirmDialog(`إلغاء حضور ${name} في المحاضرة ${session}؟`)) return;
    try { await lecturerApi.unmarkAttendance(roundId, subscriberId, session); notify('success', 'اتلغى التسجيل'); load(); }
    catch (error) { notify('error', errorText(error)); }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-extrabold text-gray-900">حضور روند {round.code} — {round.course} · المحاضرة {round.session}</p>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-500 hover:bg-white"><X size={16} /></button>
      </div>
      {attendees.length === 0 ? <Empty>مفيش طلاب مسكّنين في الروند ده.</Empty> : (
        <>
          <ul className="divide-y divide-violet-100 rounded-xl border border-violet-100 bg-white">
            {attendees.map(row => {
              const here = row.sessions.includes(round.session);
              return (
                <li key={row.subscriberId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" disabled={here || finished} checked={here || ticked.has(row.subscriberId)} onChange={() => toggle(row.subscriberId)} />
                    <span className="font-bold text-gray-900">{row.name}</span>
                  </label>
                  <span className="text-xs text-gray-500">حضر {row.attended} محاضرة</span>
                  {here && (
                    <button type="button" onClick={() => void undo(row.subscriberId, round.session, row.name)} className="inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:underline">
                      <Undo2 size={12} /> إلغاء حضور اليوم
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy || finished || ticked.size === 0} onClick={() => void mark()}>
              <CheckCheck size={15} /> سجّل حضور المحدّدين ({ticked.size})
            </button>
            <button type="button" className={quietButton} onClick={() => setTicked(new Set(attendees.filter(row => !row.sessions.includes(round.session)).map(row => row.subscriberId)))}>تحديد الكل</button>
            <button type="button" className={quietButton} onClick={() => setTicked(new Set())}>مسح التحديد</button>
          </div>
          {finished && <p className="text-xs text-red-600">الروند خلص — مينفعش تسجيل حضور عليه.</p>}
        </>
      )}
    </div>
  );
}
