import { useEffect, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { cairoDateOnly } from '../../../shared/cairoDate';
import { getWeekDayKeyFromDate } from '../../lib/consultations';
import { errorText, lecturerApi, type Availability, type LecturerConsultation, type Notify } from './lecturerApi';
import { field, primaryButton, quietButton } from './ui';

/**
 * «تأجيل الاستشارة»: the lecturer proposes another day and one of their weekly hours — the client is asked on WhatsApp and nothing
 * moves until they accept (api/lib/consultationReschedule.js).
 */
export function RescheduleForm({ item, notify, onDone }: { item: LecturerConsultation; notify: Notify; onDone: () => void }) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [date, setDate] = useState('');
  const [slotId, setSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { lecturerApi.availability().then(setAvailability).catch(error => notify('error', errorText(error))); }, [notify]);

  const blocked = new Set((availability?.blocked || []).map(day => day.date));
  const weekday = date ? getWeekDayKeyFromDate(date) : null;
  const slots = (availability?.slots || []).filter(slot => slot.day === weekday);
  const closed = date ? blocked.has(date) : false;

  const send = async () => {
    setBusy(true);
    try {
      await lecturerApi.proposeReschedule(item.id, { date, slotId, reason });
      notify('success', 'اتبعت الاقتراح للعميل على الواتساب — مستني رده');
      onDone();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3">
      <p className="text-xs font-bold text-indigo-900">اقترح ميعاد تاني من مواعيدك الأسبوعية — الجلسة مش هتتنقل غير لما العميل يوافق.</p>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs font-bold text-gray-600">اليوم
          <input type="date" min={cairoDateOnly()} className={field} value={date} onChange={e => { setDate(e.target.value); setSlotId(''); }} /></label>
        <label className="text-xs font-bold text-gray-600">الساعة
          <select className={field} value={slotId} onChange={e => setSlotId(e.target.value)} disabled={!slots.length || closed}>
            <option value="">{!date ? 'اختار اليوم الأول' : closed ? 'اليوم ده مقفول' : slots.length ? 'اختار الساعة' : 'مفيش مواعيد في اليوم ده'}</option>
            {slots.map(slot => <option key={slot.id} value={slot.id}>{slot.startTime} – {slot.endTime}</option>)}
          </select></label>
        <label className="text-xs font-bold text-gray-600">السبب (اختياري)
          <input className={field} value={reason} onChange={e => setReason(e.target.value)} placeholder="ظرف طارئ…" /></label>
      </div>
      <div className="flex gap-2">
        <button type="button" className={primaryButton} disabled={busy || !date || !slotId} onClick={() => void send()}><Send size={14} /> ابعت الاقتراح</button>
        <button type="button" className={quietButton} onClick={onDone}><X size={14} /> إغلاق</button>
      </div>
    </div>
  );
}

/** A proposal waiting for an answer: the lecturer answers a client's, or sees that the client has not answered theirs yet. */
export function PendingReschedule({ item, notify, onDone }: { item: LecturerConsultation; notify: Notify; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const pending = item.pendingReschedule;
  if (!pending) return null;
  const answer = async (value: 'accept' | 'decline') => {
    setBusy(true);
    try {
      await lecturerApi.answerReschedule(pending.id, value);
      notify('success', value === 'accept' ? 'اتنقلت الجلسة واتبلّغ العميل' : 'اتبعت اعتذارك للعميل');
      onDone();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <span className="font-bold text-amber-900">
        {pending.by === 'client' ? `العميل بيطلب ينقل الجلسة إلى ${pending.at}` : `اقترحت تنقل الجلسة إلى ${pending.at} — مستني رد العميل`}
        {pending.reason && <span className="font-normal text-amber-800"> — {pending.reason}</span>}
      </span>
      {pending.by === 'client' && (
        <span className="flex gap-1.5">
          <button type="button" disabled={busy} onClick={() => void answer('accept')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Check size={13} /> موافق</button>
          <button type="button" disabled={busy} onClick={() => void answer('decline')} className="inline-flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"><X size={13} /> مش مناسب</button>
        </span>
      )}
    </div>
  );
}
