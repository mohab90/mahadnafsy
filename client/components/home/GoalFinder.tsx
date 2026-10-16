import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { Course, Currency } from '../../types';
import { formatPrice } from '../../../shared/priceFormat';
import type { Goal } from '../../../shared/homeGoals';

/**
 * «مش عارف تبدأ منين؟» — pick an interest, see the course most people take in
 * it with its price, and book it.
 */
const GoalFinder: React.FC<{
  goals: Goal[];
  goalId: string;
  onPick: (id: string) => void;
  course: Course | null;
  currency: Currency;
}> = ({ goals, goalId, onPick, course, currency }) => {
  if (goals.length === 0) return null;
  const blurb = (course?.shortDescription || '').replace(/<[^>]*>/g, '').trim();
  return (
    <div className="rounded-[32px] bg-white p-5 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-7">
      <div className="mb-1 flex items-center gap-2 text-primary-700">
        <Sparkles size={20} />
        <h2 className="text-2xl font-black text-ink">مش عارف تبدأ منين؟</h2>
      </div>
      <p className="mb-5 text-[15px] text-muted">اختار مجال اهتمامك وهنرشح لك الأنسب</p>

      <div role="radiogroup" aria-label="مجال الاهتمام" className="mb-5 grid gap-2.5 sm:grid-cols-2">
        {goals.map(goal => {
          const on = goal.id === goalId;
          return (
            <button
              key={goal.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(goal.id)}
              className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-2.5 text-right transition ${on ? 'border-primary-700 bg-primary-50/60' : 'border-line bg-white hover:border-line-deep'}`}
            >
              <span className={`relative h-5 w-5 flex-none rounded-full border-2 ${on ? 'border-primary-700' : 'border-line-deep'}`}>
                {on && <span className="absolute inset-[3px] rounded-full bg-primary-700" />}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-extrabold text-ink">{goal.label}</span>
                <span className="block text-[13px] leading-snug text-muted-soft">{goal.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {course && (
        <div key={course.id} className="rounded-[22px] bg-ink p-5 text-white motion-safe:animate-fade-in">
          <p className="mb-1 text-[13px] font-extrabold text-gold-light">الأنسب لك</p>
          <p className="text-xl font-black leading-snug">{course.title.trim()}</p>
          {blurb && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-white/65">{blurb}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-3xl font-black tabular-nums text-gold-pale">{formatPrice(course.price?.[currency], currency)}</span>
            <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-black text-ink transition hover:bg-primary-50">
              احجز مكانك
              <ArrowLeft size={17} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalFinder;
