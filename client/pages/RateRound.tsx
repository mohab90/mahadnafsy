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
    <div className="min-h-screen bg-paper px-4 py-10 sm:py-16" dir="rtl">
      <div className="mx-auto w-full max-w-lg rounded-[28px] border border-line bg-white p-5 shadow-[0_40px_80px_-50px_rgba(26,15,18,.45)] sm:p-8">
        {!form && !failed && <div className="mx-auto h-8 w-8 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" />}
        {!form && failed && <p className="py-8 text-center font-bold text-muted-strong">{failed}</p>}
        {form && done && (
          <div className="py-8 text-center">
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600">
              <CheckCircle2 size={44} />
            </span>
            <h1 className="mt-5 text-2xl font-black text-ink">شكراً يا {form.name} 🌷</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-body">تقييمك وصل للمعهد، وأي ملاحظة كتبتها بتوصل لخدمة العملاء.</p>
          </div>
        )}
        {form && !done && (
          <div className="space-y-6">
            <div className="border-b border-line pb-5 text-center">
              <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-paper text-gold ring-1 ring-line">
                <Star size={28} className="fill-gold-light text-gold-light" />
              </span>
              <h1 className="text-2xl font-black leading-tight text-ink">أهلاً {form.name}، قيّم الكورس</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-body">«{form.course}»{form.lecturer ? ` مع ${form.lecturer}` : ''}</p>
            </div>
            {form.questions.map(question => (
              <div key={question.key}>
                <p className="mb-2 text-[15px] font-extrabold leading-snug text-ink">{question.label}</p>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10 sm:gap-1" role="radiogroup" aria-label={question.label}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
                    <button key={value} type="button" role="radio" aria-checked={scores[question.key] === value}
                      onClick={() => setScores(current => ({ ...current, [question.key]: value }))}
                      className={`h-11 rounded-xl border text-sm font-black tabular-nums transition ${scores[question.key] === value
                        ? value >= 8 ? 'border-green-600 bg-green-600 text-white' : value >= 5 ? 'border-gold-light bg-gold-light text-ink' : 'border-red-600 bg-red-600 text-white'
                        : 'border-line bg-paper text-muted-strong hover:border-line-deep'}`}>
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <p className="mb-2 text-[15px] font-extrabold text-ink">عندك ملاحظة أو مشكلة أو اقتراح؟</p>
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000}
                className="w-full resize-none rounded-xl border border-line-strong bg-paper px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10" />
            </div>
            {failed && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{failed}</p>}
            <button disabled={!complete || sending} onClick={() => void send()}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? '⏳…' : 'ابعت التقييم'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RateRound;
