import React, { useEffect, useState } from 'react';
import { Star, CheckCircle } from 'lucide-react';

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

  const id = new URLSearchParams(window.location.search).get('id') || '';
  const token = new URLSearchParams(window.location.search).get('token') || '';

  useEffect(() => {
    document.title = 'تقييم الدعم | معهد الدراسات النفسية';
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
    try {
      const r = await fetch(`/api/ticket-csat/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment }),
      });
      if (r.ok) setDone(true);
    } catch { /* ignore */ }
    finally { setSubmitting(false); }
  };

  const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center py-16 px-4" dir="rtl">
      <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-8 w-full max-w-md text-center">{children}</div>
    </div>
  );

  if (loading) return <Card><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" /></Card>;
  if (notFound) return <Card><p className="text-gray-500">الرابط غير صالح أو انتهت صلاحيته.</p></Card>;
  if (done || alreadyRated) return (
    <Card>
      <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3" />
      <h1 className="text-xl font-bold text-gray-900">شكراً لتقييمك 💚</h1>
      <p className="text-gray-500 mt-2">رأيك يساعدنا على تحسين خدمتنا.</p>
    </Card>
  );

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">كيف كان حلّ تذكرتك؟</h1>
      {subject && <p className="text-sm text-gray-500 mt-1">{subject}</p>}
      <div className="flex justify-center gap-2 my-6">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setScore(n)}
            className="transition-transform hover:scale-110">
            <Star size={38} className={(hover || score) >= n ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
        placeholder="ملاحظة (اختياري)..."
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none mb-4" />
      <button onClick={submit} disabled={score < 1 || submitting}
        className="w-full bg-primary-600 text-white py-2.5 rounded-xl font-semibold hover:bg-primary-700 disabled:opacity-40 transition">
        {submitting ? 'جارٍ الإرسال...' : 'إرسال التقييم'}
      </button>
    </Card>
  );
};

export default TicketRating;
