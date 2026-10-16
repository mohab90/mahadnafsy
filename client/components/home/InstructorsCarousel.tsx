import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, GraduationCap, Star } from 'lucide-react';
import type { Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import { Reveal } from './Reveal';

const MAX = 10;

/**
 * «المدربون والخبراء» — the faces behind the programmes. The ones marked for the
 * home page come first, then the rest who have a photo; the row slides with
 * the arrows on a computer and with a swipe on a phone.
 */
const InstructorsCarousel: React.FC<{ therapists: Therapist[] }> = ({ therapists }) => {
  const row = useRef<HTMLDivElement>(null);
  const list = therapists
    .filter(t => t.image)
    .sort((a, b) => Number(!!b.showOnHome) - Number(!!a.showOnHome) || (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
    .slice(0, MAX);
  if (list.length === 0) return null;

  // In a right-to-left row «next» moves left, so scrollBy takes a negative step.
  const slide = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = el.querySelector('article');
    el.scrollBy({ left: -dir * ((card?.clientWidth || 280) + 20), behavior: 'smooth' });
  };

  return (
    <section id="instructors" className="scroll-mt-24 bg-white py-16 sm:py-24">
      <div className="container mx-auto px-4">
        <Reveal className="mb-8 flex flex-col items-center gap-5 text-center sm:mb-10 lg:flex-row lg:items-end lg:justify-between lg:text-right">
          <div className="max-w-2xl">
            <span className="text-sm font-extrabold text-[#a87a1c]">نخبة الخبراء</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-[#1a0f12] sm:text-4xl lg:text-[44px]">هتتعلم على إيد مين؟</h2>
            <p className="mt-3 text-base leading-relaxed text-[#6b5b55] sm:text-lg">دكاترة ومعالجين نفسيين بيشتغلوا في المجال، وبيدرّسوا وبيشرفوا على تدريبك العملي بنفسهم.</p>
          </div>
          <div className="hidden gap-2 lg:flex">
            <button type="button" onClick={() => slide(-1)} aria-label="السابق" className="flex h-12 w-12 items-center justify-center rounded-full border border-[#e6d8cf] bg-[#fbf7f2] text-[#1a0f12] transition hover:border-[#1a0f12]"><ChevronRight size={22} /></button>
            <button type="button" onClick={() => slide(1)} aria-label="التالي" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a0f12] text-white transition hover:bg-black"><ChevronLeft size={22} /></button>
          </div>
        </Reveal>

        <div ref={row} className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-4 pb-3 [scrollbar-width:none] lg:mx-0 lg:px-0">
          {list.map(t => (
            <article key={t.id} className="w-[68%] flex-none snap-start sm:w-[42%] md:w-[31%] lg:w-[calc((100%-60px)/4)]">
              <Link to={`/instructor/${t.id}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[26px] bg-[#f4ebe3]">
                  <img src={cdnImg(t.image, 520)} alt={t.name} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#1a0f12]/85 to-transparent" />
                  <span className="absolute inset-x-4 bottom-4 text-white">
                    <b className="block text-lg font-black leading-snug">{t.name}</b>
                    <span className="line-clamp-1 text-[13px] text-white/80">{t.title || t.specialty}</span>
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between px-1 text-[13px] font-bold text-[#7a6a64]">
                  {Number(t.experience) > 0 ? <span className="inline-flex items-center gap-1"><GraduationCap size={15} className="text-primary-700" />{t.experience} سنة خبرة</span> : <span />}
                  {Number(t.rating) > 0 && <span className="inline-flex items-center gap-1 text-[#a87a1c]"><Star size={14} fill="currentColor" />{t.rating}</span>}
                </div>
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link to="/instructors" className="inline-flex min-h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-[#1a0f12]/15 px-8 text-base font-extrabold text-[#1a0f12] transition hover:border-[#1a0f12]/40">
            كل الخبراء والمدربين
            <ArrowLeft size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default InstructorsCarousel;
