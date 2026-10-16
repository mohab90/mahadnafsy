import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Quote, Star } from 'lucide-react';
import type { TestimonialItem } from '../../types';
import { cdnImg } from '../../lib/img';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

const initial = (name: string) => (name || '?').trim().charAt(0);

/**
 * «ماذا يقول عملاؤنا؟» — one story at a time, large, turning by itself every
 * few seconds (and holding while the visitor reads or picks one).
 */
const TestimonialsSection: React.FC<{ content: Content; testimonials: TestimonialItem[] }> = ({ content, testimonials }) => {
  const list = testimonials.filter(t => (t.text || '').trim());
  const [at, setAt] = useState(0);
  const [hold, setHold] = useState(false);
  const count = list.length;
  useEffect(() => {
    if (hold || count < 2) return undefined;
    const id = setInterval(() => { if (!document.hidden) setAt(i => (i + 1) % count); }, 7000);
    return () => clearInterval(id);
  }, [hold, count]);
  if (count === 0) return null;
  const current = list[at % count];
  const go = (step: number) => setAt(i => (i + step + count) % count);

  return (
    <section className="relative overflow-hidden bg-[#1a0f12] py-16 text-white sm:py-24">
      <img src={`${import.meta.env.BASE_URL}brand/grads/celebration.jpg`} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-[.12]" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#1a0f12] via-[#1a0f12]/80 to-[#1a0f12]" />

      <div className="container relative mx-auto grid items-center gap-10 px-4 lg:grid-cols-[.8fr_1.2fr] lg:gap-16">
        <Reveal className="text-center lg:text-right">
          <span className="text-sm font-extrabold text-[#e3b65a]">قصص نجاح</span>
          <h2 className="mt-2 text-3xl font-black leading-tight sm:text-4xl lg:text-[44px]">{content['home.testimonials.title'] || 'ماذا يقول عملاؤنا؟'}</h2>
          <p className="mt-3 text-base leading-relaxed text-white/65 sm:text-lg">{content['home.testimonials.subtitle'] || 'قصص نجاح حقيقية من خريجي المعهد'}</p>
          <div className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-white/[.06] px-5 py-3 ring-1 ring-white/10">
            <span dir="ltr" className="text-3xl font-black tabular-nums">{content['home.stats.rating'] || '4.9'}</span>
            <span className="text-right">
              <span className="flex gap-0.5 text-[#e3b65a]">{[0, 1, 2, 3, 4].map(i => <Star key={i} size={16} fill="currentColor" />)}</span>
              <span className="text-[13px] text-white/60">تقييم الطلاب</span>
            </span>
          </div>
        </Reveal>

        <Reveal delay={100}>
          <figure
            onMouseEnter={() => setHold(true)}
            onMouseLeave={() => setHold(false)}
            className="relative rounded-[32px] bg-white p-6 text-[#1a0f12] shadow-[0_40px_80px_-30px_rgba(0,0,0,.6)] sm:p-10"
          >
            <Quote aria-hidden="true" size={64} className="absolute -top-7 right-8 rounded-2xl bg-primary-700 p-3.5 text-white shadow-xl" />
            <blockquote key={current.id} aria-live="polite" className="min-h-[110px] pt-6 text-lg font-bold leading-[2] motion-safe:animate-fade-in sm:min-h-[120px] sm:text-xl">
              «{current.text.trim()}»
            </blockquote>
            <figcaption className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#ecdfd6] pt-5">
              <span className="flex items-center gap-3">
                {current.image
                  ? <img src={cdnImg(current.image, 120)} alt={current.name} loading="lazy" className="h-12 w-12 rounded-full object-cover" />
                  : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-lg font-black text-primary-700">{initial(current.name)}</span>}
                <span>
                  <b className="block text-base">{current.name}</b>
                  <span className="text-[13px] text-[#7a6a64]">{current.role || 'خريج المعهد'}</span>
                </span>
              </span>
              {count > 1 && (
                <span className="flex items-center gap-2">
                  <button type="button" onClick={() => go(-1)} aria-label="السابق" className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e6d8cf] transition hover:border-[#1a0f12]"><ChevronRight size={20} /></button>
                  <span className="min-w-[44px] text-center text-sm font-bold tabular-nums text-[#7a6a64]" dir="ltr">{(at % count) + 1} / {count}</span>
                  <button type="button" onClick={() => go(1)} aria-label="التالي" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1a0f12] text-white transition hover:bg-black"><ChevronLeft size={20} /></button>
                </span>
              )}
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
};

export default TestimonialsSection;
