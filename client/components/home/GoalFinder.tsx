import React from 'react';
import { Link } from 'react-router-dom';
import { Award } from 'lucide-react';
import type { Course, Currency } from '../../types';
import { formatPrice } from '../../../shared/priceFormat';
import type { Goal } from '../../../shared/homeGoals';

/**
 * «مش عارف تبدأ منين؟» — the card that sits where the hero photo used to be.
 * Pick an interest, see the course most people take in it, book it.
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
    <div className="relative w-full max-w-[480px] mx-auto lg:mx-0 pb-4">
      <div aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-4 rotate-[2.2deg] rounded-[30px] bg-secondary-500" />
      <div aria-hidden="true" className="absolute inset-0 -translate-x-2 translate-y-2 -rotate-[1.8deg] rounded-[30px] bg-primary-600" />
      <div aria-hidden="true" className="absolute -top-8 left-2 z-30 flex h-20 w-20 sm:h-[104px] sm:w-[104px] flex-col items-center justify-center rounded-full border-[3px] border-[#1b0a12] bg-secondary-500 text-center text-xs sm:text-[15px] font-black leading-tight text-[#1b0a12] animate-float">
        <Award size={24} />
        شهادة<br />معتمدة
      </div>

      <div className="relative z-20 rounded-[28px] bg-[#fffaf5] p-5 sm:p-6 text-gray-900 shadow-[0_40px_80px_-24px_rgba(0,0,0,.65)]">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="rounded-full bg-[#1b0a12] px-3 py-1 text-xs font-extrabold text-amber-300">٣ ثواني بس</span>
          <span className="h-1 flex-1 rounded bg-gradient-to-l from-primary-600 from-[66%] to-gray-200 to-[66%]" />
        </div>
        <h2 className="text-2xl font-black leading-tight">مش عارف تبدأ منين؟</h2>
        <p className="mb-4 mt-1 text-sm text-gray-500">اختار مجال اهتمامك وهنرشح لك الأنسب</p>

        <div role="radiogroup" aria-label="مجال الاهتمام" className="mb-4 flex flex-col gap-2.5">
          {goals.map(goal => {
            const on = goal.id === goalId;
            return (
              <button
                key={goal.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(goal.id)}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 text-right transition ${on ? 'border-primary-600 bg-primary-600 text-white shadow-lg shadow-primary-600/30' : 'border-[#eadfd8] bg-white text-gray-900 hover:border-primary-500'}`}
              >
                <span className={`relative h-[22px] w-[22px] flex-none rounded-full border-2 ${on ? 'border-white bg-white' : 'border-[#d9c7bf]'}`}>
                  {on && <span className="absolute inset-1 rounded-full bg-primary-600" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-extrabold">{goal.label}</span>
                  <span className={`block text-[13px] ${on ? 'text-white/80' : 'text-gray-500'}`}>{goal.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {course && (
          <div className="rounded-[18px] border-[1.5px] border-dashed border-primary-600 bg-white p-4">
            <p className="mb-1.5 text-[13px] font-extrabold text-primary-700">الأنسب لك</p>
            <p className="mb-1.5 text-[19px] font-black leading-snug">{course.title}</p>
            {blurb && <p className="mb-3.5 line-clamp-2 text-sm leading-relaxed text-gray-500">{blurb}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-3xl font-black text-primary-700 tabular-nums">{formatPrice(course.price?.[currency], currency)}</span>
              <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="inline-flex min-h-[46px] items-center rounded-xl bg-[#1b0a12] px-5 text-[15px] font-extrabold text-white transition hover:bg-black">
                احجز مكانك
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoalFinder;
