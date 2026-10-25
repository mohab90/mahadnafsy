import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle } from 'lucide-react';
import { setCanonical } from '../lib/useSeo';

// «تأجيل الاستشارة»: the page the client's own WhatsApp link opens (api/lib/consultationReschedule.js).
//   ?r=…&t=…  the lecturer proposed another day and hour — accept it, or say it does not suit;
//   ?c=…&t=…  the client asks for another day and hour from the lecturer's open ones.
// Nothing moves until the other side accepts. The links are keyed: each names one proposal or one consultation.

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-14 sm:py-20" dir="rtl">
    <div className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 text-center shadow-[0_40px_80px_-50px_rgba(26,15,18,.45)] sm:p-8">{children}</div>
  </div>
);

type Proposal = { therapistName: string; current: string; proposed: string; reason: string; status: string };
type Open = {
  therapistName: string; current: string; bookingWindowDays: number;
  slots: Array<{ id: string; day: string; startTime: string; endTime: string }>; blockedDates: string[];
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const input = 'w-full rounded-xl border border-line-strong bg-paper px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
const button = 'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-7 font-black transition disabled:cursor-not-allowed disabled:opacity-40';

const ConsultationReschedule: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get('r') || '';
  const consultationId = params.get('c') || '';
  const token = params.get('t') || '';
  const mode = requestId ? 'respond' : 'request';
  const endpoint = `/api/public/consultation-reschedule/${mode}/${encodeURIComponent(requestId || consultationId)}?t=${encodeURIComponent(token)}`;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [date, setDate] = useState('');
  const [slotId, setSlotId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'تأجيل الاستشارة | معهد الدراسات النفسية';
    setCanonical('/consultation-reschedule');
    if ((!requestId && !consultationId) || !token) { setNotFound(true); setLoading(false); return; }
    fetch(endpoint)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => (mode === 'respond' ? setProposal(data) : setOpen(data)))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [requestId, consultationId, token, endpoint, mode]);

  const today = new Date().toISOString().slice(0, 10);
  const weekday = date ? WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] : '';
  const slots = useMemo(() => (open?.slots || []).filter(slot => slot.day === weekday), [open, weekday]);
  const closed = Boolean(date && open?.blockedDates.includes(date));

  const send = async (body: Record<string, unknown>, thanks: (data: { status?: string; at?: string }) => string) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setDone(thanks(data));
      else setError(data.error || 'تعذّر إرسال ردك. حاول مرة أخرى.');
    } catch { setError('تعذّر الاتصال بالخادم. تأكد من اتصالك وحاول مرة أخرى.'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Card><div className="mx-auto h-8 w-8 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" /></Card>;
  if (notFound) return <Card><p className="py-4 text-base text-muted-body">الرابط غير صالح أو انتهت صلاحيته.</p></Card>;
  if (done) {
    return (
      <Card>
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600"><CheckCircle size={44} /></span>
        <h1 className="mt-5 text-2xl font-black text-ink">تمام 💚</h1>
        <p className="mt-2 text-muted-body">{done}</p>
      </Card>
    );
  }

  if (mode === 'respond' && proposal) {
    if (proposal.status !== 'pending') return <Card><p className="py-4 text-base text-muted-body">الطلب ده اتردّ عليه قبل كده أو اتلغى.</p></Card>;
    return (
      <Card>
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-700"><CalendarClock size={28} /></span>
        <h1 className="mt-3 text-2xl font-black leading-tight text-ink">اقتراح تأجيل جلستك</h1>
        <p className="mt-2 text-muted-body">د. {proposal.therapistName} بيقترح ينقل جلستك:</p>
        <div className="my-4 space-y-1 rounded-2xl bg-paper p-4 text-sm font-bold ring-1 ring-line">
          <p className="text-muted">من: <span className="text-ink">{proposal.current}</span></p>
          <p className="text-muted">إلى: <span className="text-primary-700">{proposal.proposed}</span></p>
          {proposal.reason && <p className="pt-1 text-xs font-normal text-muted-body">السبب: {proposal.reason}</p>}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)..." className={`${input} mb-3 resize-none`} />
        {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
        <div className="space-y-2">
          <button onClick={() => void send({ answer: 'accept', note }, data => `اتأجلت جلستك إلى ${data.at || proposal.proposed}.`)} disabled={submitting} className={`${button} bg-primary-700 text-white hover:bg-primary-800`}>موافق على الميعاد الجديد</button>
          <button onClick={() => void send({ answer: 'decline', note }, () => 'بلّغنا الدكتور إن الميعاد مش مناسب — جلستك لسه في ميعادها.')} disabled={submitting} className={`${button} border-[1.5px] border-ink/15 bg-white text-ink hover:border-ink/40`}>الميعاد ده مش مناسب</button>
        </div>
      </Card>
    );
  }

  if (!open) return null;
  return (
    <Card>
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-700"><CalendarClock size={28} /></span>
      <h1 className="mt-3 text-2xl font-black leading-tight text-ink">عايز تأجل جلستك؟</h1>
      <p className="mt-2 text-muted-body">جلستك مع د. {open.therapistName}: <b className="text-ink">{open.current}</b></p>
      <p className="mt-1 text-xs text-muted-body">اختار يوم وساعة من مواعيد الدكتور — الجلسة مش هتتنقل غير لما الدكتور يوافق.</p>
      <div className="my-4 space-y-3 text-right">
        <label className="block text-xs font-bold text-muted-strong">اليوم
          <input type="date" min={today} className={input} value={date} onChange={e => { setDate(e.target.value); setSlotId(''); }} /></label>
        <label className="block text-xs font-bold text-muted-strong">الساعة
          <select className={input} value={slotId} onChange={e => setSlotId(e.target.value)} disabled={!slots.length || closed}>
            <option value="">{!date ? 'اختار اليوم الأول' : closed ? 'الدكتور مش متاح في اليوم ده' : slots.length ? 'اختار الساعة' : 'مفيش مواعيد في اليوم ده'}</option>
            {slots.map(slot => <option key={slot.id} value={slot.id}>{slot.startTime} – {slot.endTime}</option>)}
          </select></label>
        <label className="block text-xs font-bold text-muted-strong">السبب (اختياري)
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={`${input} resize-none`} /></label>
      </div>
      {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
      <button onClick={() => void send({ date, slotId, reason: note }, data => `بعتنا طلبك للدكتور لنقل الجلسة إلى ${data.at || ''} — هنبلغك أول ما يرد.`)} disabled={submitting || !date || !slotId} className={`${button} bg-primary-700 text-white hover:bg-primary-800`}>
        {submitting ? 'جارٍ الإرسال...' : 'ابعت طلب التأجيل'}
      </button>
    </Card>
  );
};

export default ConsultationReschedule;
