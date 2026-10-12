import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import type { JoinUsApplication } from '../../../../types';
import { FIRST_CALL_TAGS } from './joinUsUi';

const RATING_WORDS = ['', 'ضعيف', 'مقبول', 'كويس', 'كويس جدًا', 'ممتاز'];

/**
 * «لازم يكون في زر تقييم اول مكالمه» (12 Oct 2026). How the first call went, in a
 * form small enough to fill while the call is still fresh: 1–5, a few quick tags
 * and notes. Saved on the application and written to its history.
 */
const FirstCallModal: React.FC<{
  app: JoinUsApplication;
  busy: boolean;
  onSubmit: (value: { rating: number; tags: string[]; notes: string }) => void;
  onCancel: () => void;
}> = ({ app, busy, onSubmit, onCancel }) => {
  const [rating, setRating] = useState<number>(app.firstCallRating || 0);
  const [tags, setTags] = useState<string[]>(app.firstCallTags || []);
  const [notes, setNotes] = useState(app.firstCallNotes || '');
  const [error, setError] = useState('');

  const toggle = (tag: string) => setTags(current => (current.includes(tag)
    ? current.filter(t => t !== tag) : [...current, tag]));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!rating) { setError('اختار تقييم من 1 لـ 5'); return; }
    onSubmit({ rating, tags, notes: notes.trim() });
  };

  return (
    <Modal open onClose={onCancel} title={`تقييم أول مكالمة — ${app.name}`} subtitle="بيتسجّل باسمك ووقته في سجل الطلب" tone="amber" size="md">
      <form onSubmit={submit} className="space-y-4" dir="rtl">
        <div>
          <span className="mb-1.5 block text-xs font-bold text-gray-600">التقييم</span>
          <div className="flex items-center gap-1" dir="ltr">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => { setRating(n); setError(''); }}
                aria-label={`${n} من 5`}
                className="rounded-lg p-1 transition hover:scale-110">
                <Star size={28} className={n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
              </button>
            ))}
            {rating > 0 && <span className="mr-2 text-sm font-black text-amber-700" dir="rtl">{rating}/5 — {RATING_WORDS[rating]}</span>}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-bold text-gray-600">نقاط سريعة</span>
          <div className="flex flex-wrap gap-1.5">
            {FIRST_CALL_TAGS.map(tag => {
              const on = tags.includes(tag);
              return (
                <button key={tag} type="button" onClick={() => toggle(tag)} aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                    on ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300'}`}>
                  {on ? '✓ ' : ''}{tag}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-gray-600">ملاحظات</span>
          <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3}
            placeholder="مثال: صوته واضح، متاح الصبح بس، طالب مرتب أعلى من المتوقع"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'جاري الحفظ…' : 'حفظ التقييم'}
          </button>
          <button type="button" onClick={onCancel}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
        </div>
      </form>
    </Modal>
  );
};

export default FirstCallModal;
