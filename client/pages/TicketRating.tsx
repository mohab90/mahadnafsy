import React, { useEffect, useState } from 'react';
import { Star, CheckCircle } from 'lucide-react';
import { setCanonical } from '../lib/useSeo';

// Declared here, not inside TicketRating. React compares element types by
// identity: a component defined in another component's body is a new function
// on every render, so React unmounted this whole card and mounted a fresh one
// each time — and the note field is inside it, which meant typing a comment
// lost focus and the cursor after every single character.
const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-14 sm:py-20" dir="rtl">
    <div className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 text-center shadow-[0_40px_80px_-50px_rgba(26,15,18,.45)] sm:p-8">{children}</div>
  </div>
);

const TicketRating: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const id = new URLSearchParams(window.location.search).get('id') || '';
  const token = new URLSearchParams(window.location.search).get('token') || '';

  useEffect(() => {
    document.title = 'تقييم الدعم | معهد الدراسات النفسية';
    // Without this the canonical stays on whichever page loaded first.
    setCanonical('/ticket-rating');
    if (!id || !token) { setNotFound(true); setLoading(false); return; }
    fetch(`/api/ticket-csat/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { setSubject(d.subject || ''); setAlreadyRated(!!d.rated); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, token]);

  const submit = async () => {
    if (score < 1) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/ticket-csat/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment }),
      });
      // A failed submit used to do nothing at all: the spinner stopped, the
      // page stayed as it was, and the rating the customer just gave was
      // gone with no way to tell.
      if (r.ok) setDone(true);
      else setError('تعذّر إرسال التقييم. حاول مرة أخرى.');
    } catch { setError('تعذّر الاتصال بالخادم. تأكد من اتصالك وحاول مرة أخرى.'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Card><div className="mx-auto h-8 w-8 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" /></Card>;
  if (notFound) return <Card><p className="py-4 text-base text-muted-body">الرابط غير صالح أو انتهت صلاحيته.</p></Card>;
  if (done || alreadyRated) return (
    <Card>
      <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600">
        <CheckCircle size={44} />
      </span>
      <h1 className="mt-5 text-2xl font-black text-ink">شكراً لتقييمك 💚</h1>
      <p className="mt-2 text-muted-body">رأيك يساعدنا على تحسين خدمتنا.</p>
    </Card>
  );

  return (
    <Card>
      <span className="text-sm font-extrabold text-gold-deep">تقييم الدعم</span>
      <h1 className="mt-1 text-2xl font-black leading-tight text-ink">كيف كان حلّ تذكرتك؟</h1>
      {subject && <p className="mt-2 inline-block max-w-full break-words rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{subject}</p>}
      <div className="my-6 flex justify-center gap-0.5 sm:gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setScore(n)}
            aria-label={`${n} / 5`} aria-pressed={score === n}
            className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform motion-safe:hover:scale-110">
            <Star size={36} className={(hover || score) >= n ? 'fill-gold-light text-gold-light' : 'text-line-deep'} />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
        placeholder="ملاحظة (اختياري)..."
        className="mb-4 w-full resize-none rounded-xl border border-line-strong bg-paper px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10" />
      {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
      <button onClick={submit} disabled={score < 1 || submitting}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? 'جارٍ الإرسال...' : 'إرسال التقييم'}
      </button>
    </Card>
  );
};

export default TicketRating;
