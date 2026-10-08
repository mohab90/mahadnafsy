import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Star } from 'lucide-react';
import { mysqlClient } from '../lib/mysqlapi';
import { setCanonical } from '../lib/useSeo';

// «العميل يقيّم بنفسه بلينك واتساب بعد المحاضرة التالتة والأخيرة» (8 Oct 2026).
// The link in the client's WhatsApp (api/lib/selfRating.js): the four questions
// the branch asks, 1 to 10, and a note. No account needed — the link is theirs.
type Form = { name: string; course: string; lecturer: string; round: string; questions: { key: string; label: string }[]; alreadyRated: boolean };

const RateRound: React.FC = () => {
  const { roundId = '' } = useParams<{ roundId: string }>();
  const [params] = useSearchParams();
  const s = params.get('s') || '';
  const t = params.get('t') || '';
  const [form, setForm] = useState<Form | null>(null);
  const [failed, setFailed] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'قيّم الكورس | معهد الدراسات النفسية';
    setCanonical('/rate');
    mysqlClient.getSelfRating(roundId, s, t)
      .then(data => { setForm(data as unknown as Form); if ((data as unknown as Form).alreadyRated) setDone(true); })
      .catch(error => setFailed(error instanceof Error ? error.message : 'اللينك ده مش شغال'));
  }, [roundId, s, t]);

  const complete = form ? form.questions.every(question => scores[question.key]) : false;
  const send = async () => {
    setSending(true);
    setFailed('');
    try {
      await mysqlClient.sendSelfRating(roundId, { s, t, ...scores, note });
      setDone(true);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'تعذر الإرسال');
    } finally { setSending(false); }
  };

  return (
    <div className="bg-gray-50 min-h-screen py-10 px-4" dir="rtl">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        {!form && !failed && <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />}
        {!form && failed && <p className="py-8 text-center font-bold text-gray-600">{failed}</p>}
        {form && done && (
          <div className="py-8 text-center">
            <CheckCircle2 size={48} className="mx-auto mb-3 text-emerald-500" />
            <h1 className="text-xl font-extrabold text-gray-900">شكراً يا {form.name} 🌷</h1>
            <p className="mt-2 text-sm text-gray-500">تقييمك وصل للمعهد، وأي ملاحظة كتبتها بتوصل لخدمة العملاء.</p>
          </div>
        )}
        {form && !done && (
          <div className="space-y-5">
            <div className="text-center">
              <Star size={32} className="mx-auto mb-2 text-amber-500" />
              <h1 className="text-xl font-extrabold text-gray-900">أهلاً {form.name}، قيّم الكورس</h1>
              <p className="mt-1 text-sm text-gray-500">«{form.course}»{form.lecturer ? ` مع ${form.lecturer}` : ''}</p>
            </div>
            {form.questions.map(question => (
              <div key={question.key}>
                <p className="mb-1.5 text-sm font-bold text-gray-800">{question.label}</p>
                <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={question.label}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
                    <button key={value} type="button" role="radio" aria-checked={scores[question.key] === value}
                      onClick={() => setScores(current => ({ ...current, [question.key]: value }))}
                      className={`h-9 rounded-lg border text-sm font-bold transition ${scores[question.key] === value
                        ? value >= 8 ? 'border-emerald-600 bg-emerald-600 text-white' : value >= 5 ? 'border-amber-500 bg-amber-500 text-white' : 'border-rose-600 bg-rose-600 text-white'
                        : 'border-gray-200 bg-white text-gray-600'}`}>
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <p className="mb-1.5 text-sm font-bold text-gray-800">عندك ملاحظة أو مشكلة أو اقتراح؟</p>
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
            {failed && <p className="text-sm font-bold text-rose-600">{failed}</p>}
            <button disabled={!complete || sending} onClick={() => void send()}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-extrabold text-white hover:bg-primary-700 disabled:opacity-50">
              {sending ? '⏳…' : 'ابعت التقييم'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RateRound;
