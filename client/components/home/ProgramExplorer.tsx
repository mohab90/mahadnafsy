import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Flame, Users } from 'lucide-react';
import type { Course, Currency } from '../../types';
import { cdnImg } from '../../lib/img';
import { discountPercent, formatPrice, isDiscounted } from '../../../shared/priceFormat';
import { goalsFromCourses } from '../../../shared/homeGoals';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

const TYPE_LABEL: Record<string, string> = { Mix: 'مسجل + لايف', Live: 'بث مباشر', Recorded: 'مسجل' };
const SHOWN = 6;

const sellable = (course: Course, currency: Currency) => Number(course.price?.[currency]) > 0;
const plain = (html?: string) => (html || '').replace(/<[^>]*>/g, '').trim();

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
    <section id="programs" className="scroll-mt-24 bg-white pb-16 pt-16 sm:pb-24 sm:pt-24">
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
          {list.map((course, i) => {
            const price = course.price?.[currency];
            const was = course.originalPrice?.[currency];
            const off = isDiscounted(was, price) ? discountPercent(was, price) : 0;
            const href = `/c/${course.slug || course.id}`;
            return (
              <article key={course.id} className="group flex w-[82%] flex-none snap-start flex-col overflow-hidden rounded-[24px] border border-line bg-white transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] motion-safe:animate-fade-in-up sm:w-[60%] md:w-auto" style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}>
                <Link to={href} className="relative block aspect-[16/10] overflow-hidden bg-sand">
                  {course.thumbnail && <img src={cdnImg(course.thumbnail, 640)} alt={course.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />}
                  <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                    {course.id === topId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink/85 px-3 py-1 text-xs font-extrabold text-gold-pale backdrop-blur"><Flame size={13} /> الأكثر طلباً</span>
                    ) : <span />}
                    {off > 0 && <span className="rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">وفّر {off}%</span>}
                  </div>
                </Link>
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-bold text-muted">
                    {Number(course.students) > 0 && <span className="inline-flex items-center gap-1"><Users size={14} className="text-primary-700" />{Number(course.students).toLocaleString('ar-EG-u-nu-latn')} متدرب</span>}
                    {course.duration && <span className="inline-flex items-center gap-1"><BookOpen size={14} className="text-primary-700" />{course.duration}</span>}
                    {TYPE_LABEL[course.type] && <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12px] text-muted-strong ring-1 ring-line">{TYPE_LABEL[course.type]}</span>}
                  </div>
                  <h3 className="text-[19px] font-black leading-snug text-ink"><Link to={href} className="hover:text-primary-700">{course.title.trim()}</Link></h3>
                  {plain(course.shortDescription) && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{plain(course.shortDescription)}</p>}
                  <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                    <div>
                      {off > 0 && <s className="block text-sm text-muted-faint tabular-nums">{formatPrice(was, currency)}</s>}
                      <span className="whitespace-nowrap text-[22px] font-black leading-none text-ink tabular-nums sm:text-[26px]">{formatPrice(price, currency)}</span>
                    </div>
                    <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="inline-flex min-h-[46px] flex-none items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary-700 px-3.5 text-[15px] font-extrabold text-white transition hover:bg-primary-800">
                      احجز مكانك
                      <ArrowLeft size={17} />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
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
