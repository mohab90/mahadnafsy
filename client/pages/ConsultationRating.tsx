import React, { useEffect, useState } from 'react';
import { CheckCircle, Star } from 'lucide-react';
import { setCanonical } from '../lib/useSeo';

// «تقييم الاستشارة»: the page a client's own WhatsApp link opens after a completed consultation
// (api/lib/consultationRating.js). The link names one consultation by a keyed token; it is rated once.

// Declared outside the page: a component defined inside another is a new type on every render, which would remount the
// card — and its note field — on every keystroke.
const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-14 sm:py-20" dir="rtl">
    <div className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 text-center shadow-[0_40px_80px_-50px_rgba(26,15,18,.45)] sm:p-8">{children}</div>
  </div>
);

const ConsultationRating: React.FC = () => {
  const [doctor, setDoctor] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';
  const token = params.get('t') || '';
  const endpoint = `/api/public/consultation-rating/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;

  useEffect(() => {
    document.title = 'تقييم الاستشارة | معهد الدراسات النفسية';
    setCanonical('/consultation-rating');
    if (!id || !token) { setNotFound(true); setLoading(false); return; }
    fetch(endpoint)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { setDoctor(d.therapistName || ''); setAlreadyRated(Boolean(d.rated)); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, token, endpoint]);

  const submit = async () => {
    if (score < 1) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: score, comment }) });
      if (r.ok) setDone(true);
      else if (r.status === 409) setAlreadyRated(true);
      else setError('تعذّر إرسال التقييم. حاول مرة أخرى.');
    } catch { setError('تعذّر الاتصال بالخادم. تأكد من اتصالك وحاول مرة أخرى.'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Card><div className="mx-auto h-8 w-8 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" /></Card>;
  if (notFound) return <Card><p className="py-4 text-base text-muted-body">الرابط غير صالح أو انتهت صلاحيته.</p></Card>;
  if (done || alreadyRated) return (
    <Card>
      <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600"><CheckCircle size={44} /></span>
      <h1 className="mt-5 text-2xl font-black text-ink">شكراً لتقييمك 💚</h1>
      <p className="mt-2 text-muted-body">رأيك يساعدنا نقدّم لك خدمة أحسن.</p>
    </Card>
  );

  return (
    <Card>
      <span className="text-sm font-extrabold text-gold-deep">تقييم الاستشارة</span>
      <h1 className="mt-1 text-2xl font-black leading-tight text-ink">إزاي كانت جلستك؟</h1>
      {doctor && <p className="mt-2 inline-block max-w-full break-words rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">مع د. {doctor}</p>}
      <div className="my-6 flex justify-center gap-0.5 sm:gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setScore(n)}
            aria-label={`${n} من 5`} aria-pressed={score === n}
            className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform motion-safe:hover:scale-110">
            <Star size={36} className={(hover || score) >= n ? 'fill-gold-light text-gold-light' : 'text-line-deep'} />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="ملاحظة (اختياري)..."
        className="mb-4 w-full resize-none rounded-xl border border-line-strong bg-paper px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10" />
      {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
      <button onClick={submit} disabled={score < 1 || submitting}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? 'جارٍ الإرسال...' : 'إرسال التقييم'}
      </button>
    </Card>
  );
};

export default ConsultationRating;
