import type { CustomerTimelineEvent } from '../../types';
import { RATING_QUESTIONS, ratingAverage, satisfactionOf, type RatingScores } from '../../lib/clientRatings';
import { cairoDay } from '../../../shared/cairoDate';

// «التقييمات دي تظهر في صفحة حساب العميل نفسه» (8 Oct 2026): the latest rating
// the client gave their round, each question's score, and how many there are.
// The ratings come with «رحلة العميل» (category 'rating'), so nothing more is fetched.
export function ClientSatisfactionCard({ events }: { events: CustomerTimelineEvent[] }) {
  const ratings = events.filter(event => event.category === 'rating');
  if (!ratings.length) return null;
  const latest = ratings[0];
  const scores = (latest.detail || {}) as Partial<RatingScores> & { note?: string; round?: string };
  const average = ratingAverage(scores);
  const mood = satisfactionOf(average);
  const overall = Math.round((ratings.reduce((sum, event) => sum + ratingAverage((event.detail || {}) as Partial<RatingScores>), 0) / ratings.length) * 10) / 10;
  return (
    <div className={`rounded-2xl border p-4 ${mood.cls}`} dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold">{mood.emoji} رضا العميل: {mood.label} — {average} من 10</p>
        <p className="text-[11px] font-semibold opacity-80">
          آخر تقييم {cairoDay(latest.occurred_at)}{scores.round ? ` · روند ${scores.round}` : ''}
          {ratings.length > 1 ? ` · متوسط ${ratings.length} تقييمات ${overall}` : ''}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RATING_QUESTIONS.map(({ key, label }) => {
          const value = Number(scores[key] || 0);
          return (
            <div key={key} className="rounded-xl bg-white/70 px-3 py-2">
              <p className="text-[11px] font-bold text-gray-600">{label}</p>
              <p className="text-lg font-black text-gray-800">{value}<span className="text-xs text-gray-400">/10</span></p>
              <div className="mt-1 h-1.5 rounded-full bg-gray-200"><div className={`h-1.5 rounded-full ${value >= 8 ? 'bg-emerald-500' : value >= 5 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${value * 10}%` }} /></div>
            </div>
          );
        })}
      </div>
      {scores.note && <p className="mt-2 text-xs font-semibold">ملاحظة العميل: {scores.note}</p>}
    </div>
  );
}
