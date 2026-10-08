import { useState } from 'react';
import { Modal } from '../../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { RATING_QUESTIONS, ratingAverage, satisfactionOf, type RatingScores } from '../../../../lib/clientRatings';

// «زر اسمه تقييم … اقدر اسجل فيه تقييم العميل من 1 الي 10 في المحاضر وفي المادة
// العلميه وفي توصيل المعلومه وفي مسئولين الفرع ,, ويكون في مكان لو عنده ملاحظه
// او مشكله او تطوير نسجله» (8 Oct 2026). For a client housed in this round.
export function ClientRatingModal({ roundId, roundCode, subscriberId, subscriberName, onClose, onSaved, notify }: {
  roundId: string;
  roundCode: string;
  subscriberId: string;
  subscriberName: string;
  onClose: () => void;
  onSaved: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [scores, setScores] = useState<Partial<RatingScores>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const complete = RATING_QUESTIONS.every(({ key }) => scores[key]);
  const average = complete ? ratingAverage(scores) : null;

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/daqqi-rounds/${encodeURIComponent(roundId)}/ratings`, { subscriberId, ...scores, note });
      notify('success', `اتسجل تقييم ${subscriberName}`);
      onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ التقييم');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`تقييم ${subscriberName}`} subtitle={`روند ${roundCode}`} size="sm">
      <div className="space-y-3">
        {RATING_QUESTIONS.map(({ key, label }) => (
          <div key={key}>
            <p className="mb-1 text-sm font-bold text-gray-700">{label}</p>
            <div className="flex gap-1" role="radiogroup" aria-label={label}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
                <button key={value} type="button" role="radio" aria-checked={scores[key] === value}
                  onClick={() => setScores(current => ({ ...current, [key]: value }))}
                  className={`h-8 flex-1 rounded-lg border text-xs font-bold transition ${scores[key] === value
                    ? value >= 8 ? 'border-emerald-600 bg-emerald-600 text-white' : value >= 5 ? 'border-amber-500 bg-amber-500 text-white' : 'border-rose-600 bg-rose-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-1 text-sm font-bold text-gray-700">ملاحظة أو مشكلة أو اقتراح تطوير</p>
          <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000}
            placeholder="اكتب اللي قاله العميل"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
        </div>
        {average !== null && (() => {
          const mood = satisfactionOf(average);
          return <p className={`rounded-xl border px-3 py-2 text-sm font-bold ${mood.cls}`}>{mood.emoji} المتوسط {average} من 10 — {mood.label}</p>;
        })()}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm hover:bg-gray-50">إلغاء</button>
          <button disabled={!complete || saving} onClick={() => void save()}
            className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">
            {saving ? '⏳…' : 'حفظ التقييم'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
