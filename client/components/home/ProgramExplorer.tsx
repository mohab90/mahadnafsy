import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { Course, Currency } from '../../types';
import CourseCard from '../CourseCard';
import { goalsFromCourses } from '../../../shared/homeGoals';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

const SHOWN = 6;

const sellable = (course: Course, currency: Currency) => Number(course.price?.[currency]) > 0;

/**
 * «الدبلومات الأكثر طلباً» as something to explore: a tab per specialty (the
 * specialties that actually have courses), the six most-taken programmes in
 * it, each with its price, its saving, and a button straight to booking.
 * On a phone the cards slide sideways instead of stacking six screens deep.
 */
const ProgramExplorer: React.FC<{ content: Content; courses: Course[]; currency: Currency }> = ({ content, courses, currency }) => {
  const tabs = useMemo(() => [{ id: 'top', label: content['home.bestSellers.badge'] || 'الأكثر طلباً' }, ...goalsFromCourses(courses, 4).map(g => ({ id: g.id, label: g.label }))], [courses, content]);
  const [tab, setTab] = useState('top');
  const active = tabs.some(t => t.id === tab) ? tab : 'top';
  const list = useMemo(() => courses
    .filter(c => sellable(c, currency) && (active === 'top' || c.category === active))
    .sort((a, b) => (Number(b.students) || 0) - (Number(a.students) || 0))
    .slice(0, SHOWN), [courses, currency, active]);
  const topId = useMemo(() => [...courses].sort((a, b) => (Number(b.students) || 0) - (Number(a.students) || 0))[0]?.id, [courses]);

  if (courses.length === 0) return null;

  return (
    <section id="programs" className="cv-auto scroll-mt-24 bg-white pb-16 pt-16 sm:pb-24 sm:pt-24">
      <div className="container mx-auto px-4">
        <Reveal className="mb-8 flex flex-col gap-6 lg:mb-10">
          <div className="max-w-2xl text-center lg:text-right">
            <span className="text-sm font-extrabold text-gold-deep">اختار برنامجك</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl lg:text-[44px]">{content['home.bestSellers.title'] || 'الدبلومات الأكثر مبيعاً'}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">برامج بيختارها آلاف المتدربين كل سنة، بأسعار واضحة وخصم حقيقي.</p>
          </div>
          <div role="tablist" aria-label="التخصص" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {tabs.map(t => {
              const on = t.id === active;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t.id)}
                  className={`min-h-[44px] flex-none whitespace-nowrap rounded-full border px-5 text-[15px] font-extrabold transition ${on ? 'border-ink bg-ink text-white shadow-lg' : 'border-line bg-paper text-muted-strong hover:border-ink/30'}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Reveal>

        <div key={active} className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:gap-6 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
          {list.map((course, i) => (
            <CourseCard
              key={course.id}
              course={course}
              currency={currency}
              topSeller={course.id === topId}
              className="w-[82%] flex-none snap-start motion-safe:animate-fade-in-up sm:w-[60%] md:w-auto"
            />
          ))}
        </div>

        <div className="mt-8 text-center sm:mt-10">
          <Link to="/courses" className="inline-flex min-h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-ink/15 px-8 text-base font-extrabold text-ink transition hover:border-ink/40">
            شوف كل الدبلومات ({courses.filter(c => sellable(c, currency)).length})
            <ArrowLeft size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default ProgramExplorer;
