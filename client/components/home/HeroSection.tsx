import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, PlayCircle, Star } from 'lucide-react';
import type { Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import { useCountUp, useInView } from './Reveal';

type Content = Record<string, string | undefined>;

// Real graduates of the institute, on graduation day, with their certificates.
const HERO_GRADUATES = [
  { src: 'grad-woman.jpg', alt: 'خريجة من معهد الدراسات النفسية تحمل شهاداتها', focus: '50% 20%' },
  { src: 'grad-man.jpg', alt: 'خريج من معهد الدراسات النفسية بلبس التخرج يحمل شهاداته', focus: '50% 15%' },
  { src: 'grad-cert.jpg', alt: 'خريجة من المعهد تستلم شهاداتها', focus: '60% 20%' },
];

const Stat: React.FC<{ value: string; label: string; run: boolean; star?: boolean }> = ({ value, label, run, star }) => {
  const shown = useCountUp(value, run);
  return (
    <div className="px-3 py-5 text-center sm:px-5 sm:py-6">
      <div dir="ltr" className="flex items-center justify-center gap-1.5 text-[30px] font-black leading-none tabular-nums text-[#1a0f12] sm:text-[38px]">
        {shown}
        {star && <Star size={22} className="text-[#c8962e]" fill="currentColor" />}
      </div>
      <div className="mt-2 text-[13px] font-bold text-[#7a6a64] sm:text-sm">{label}</div>
    </div>
  );
};

/**
 * The first screen: one promise, one booking button, and the proof right
 * beside it — the graduates holding the institute's certificate, the faces of
 * the instructors who teach, and the figures marketing keeps up to date.
 */
const HeroSection: React.FC<{ content: Content; therapists: Therapist[]; hasVideo: boolean; onPlay: () => void }> = ({ content, therapists, hasVideo, onPlay }) => {
  const [statsRef, statsSeen] = useInView<HTMLDivElement>('0px');
  const faces = therapists.filter(t => t.image).sort((a, b) => Number(!!b.showOnHome) - Number(!!a.showOnHome) || (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).slice(0, 4);
  const stats = [
    { value: content['home.stats.graduates'] || '12K', label: content['home.stats.graduatesLabel'] || 'خريج' },
    { value: content['home.stats.programs'] || '50+', label: content['home.stats.programsLabel'] || 'برنامج تدريبي' },
    { value: content['home.stats.experts'] || '30+', label: content['home.stats.expertsLabel'] || 'خبير ومدرب' },
    { value: content['home.stats.rating'] || '4.9', label: 'تقييم الطلاب', star: true },
  ];

  return (
    <>
      <section className="relative overflow-hidden bg-[#fbf7f2]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.13),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.16),transparent)]" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[.35]"
          style={{ backgroundImage: 'radial-gradient(rgba(26,15,18,.09) 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'linear-gradient(to bottom, black, transparent 85%)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)' }}
        />

        <div className="container relative mx-auto grid items-center gap-12 px-4 pb-28 pt-10 sm:pb-32 sm:pt-14 lg:grid-cols-[1.2fr_.8fr] lg:gap-12 lg:pb-36 lg:pt-16">
          <div className="text-center lg:text-right">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#ecdfd6] bg-white px-4 py-1.5 text-[13px] font-extrabold text-primary-700 shadow-sm sm:text-sm">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary-600" /></span>
              {content['home.hero.badge'] || 'مستقبلك المهني يبدأ من هنا'}
            </span>

            <h1 className="mt-5 text-balance text-[29px] font-black leading-[1.45] text-[#1a0f12] sm:text-[40px] lg:text-[40px] xl:text-[46px] xl:leading-[1.4]">
              ابدأ مسارك المهني في <span className="relative whitespace-nowrap text-primary-700">الصحة النفسية<svg aria-hidden="true" viewBox="0 0 200 12" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-3 w-full text-[#c8962e]"><path d="M2 9 C 50 2, 150 2, 198 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg></span> بتدريب نظري وعملي مع أفضل دكاترة علم النفس وبشهادة معتمدة
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-[1.9] text-[#5b4b46] sm:text-lg lg:mx-0">
              {content['home.heroSubtitle'] || 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي. دبلومات معتمدة، وتدريب عملي مع نخبة الخبراء.'}
            </p>

            <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              <Link to="/enroll" className="group inline-flex min-h-[58px] items-center justify-center gap-3 rounded-2xl bg-primary-700 px-9 text-lg font-extrabold text-white shadow-[0_18px_40px_-14px_rgba(159,18,57,.75)] transition hover:-translate-y-0.5 hover:bg-primary-800">
                <span>احجز مكانك الآن</span>
                <ArrowLeft size={22} className="transition group-hover:-translate-x-1" />
              </Link>
              <Link to="/courses" className="inline-flex min-h-[58px] items-center justify-center rounded-2xl border-[1.5px] border-[#1a0f12]/15 bg-white px-8 text-lg font-bold text-[#1a0f12] transition hover:border-[#1a0f12]/40">
                {content['home.hero.primaryCta'] || 'تصفح الدبلومات'}
              </Link>
            </div>

            <div className="mx-auto mt-9 flex max-w-md flex-col items-center gap-4 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              {faces.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3 space-x-reverse">
                    {faces.map(t => (
                      <img key={t.id} src={cdnImg(t.image, 96)} alt={t.name} title={t.name} loading="lazy" className="h-11 w-11 rounded-full border-[3px] border-[#fbf7f2] bg-[#f4ebe3] object-cover" />
                    ))}
                  </div>
                  <span className="text-right text-[13px] leading-snug text-[#5b4b46]">
                    <b className="block text-[15px] text-[#1a0f12]">نخبة من دكاترة علم النفس</b>
                    يدرّسون ويشرفون على التدريب بنفسهم
                  </span>
                </div>
              )}
              {hasVideo && (
                <button type="button" onClick={onPlay} className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-2 text-[15px] font-extrabold text-primary-700 transition hover:text-primary-800 sm:border-r sm:border-[#ecdfd6] sm:pr-5">
                  <PlayCircle size={26} />
                  شوف جولة داخل المعهد
                </button>
              )}
            </div>
          </div>

          {/* three of the institute's graduates, holding its certificates */}
          <div className="relative mx-auto w-full max-w-[560px] pt-6 lg:mx-0">
            <div aria-hidden="true" className="absolute inset-x-6 bottom-2 top-16 rounded-[40px] bg-gradient-to-br from-primary-700 to-[#4c0519]" />
            <div aria-hidden="true" className="absolute -left-2 top-2 h-24 w-24 rounded-full border-2 border-dashed border-[#c8962e]/60" />
            <div className="relative grid grid-cols-3 items-end gap-2.5 px-1 sm:gap-4">
              {HERO_GRADUATES.map((g, i) => (
                <img
                  key={g.src}
                  src={`${import.meta.env.BASE_URL}brand/grads/${g.src}`}
                  alt={g.alt}
                  fetchPriority={i === 1 ? 'high' : 'auto'}
                  width={600}
                  height={900}
                  className={`aspect-[2/3] w-full rounded-[22px] object-cover shadow-[0_30px_60px_-25px_rgba(26,15,18,.6)] ring-4 ring-white sm:rounded-[28px] ${i === 1 ? '-translate-y-8 sm:-translate-y-10' : ''}`}
                  style={{ objectPosition: g.focus }}
                />
              ))}
            </div>
            <div className="absolute -bottom-7 right-3 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_20px_40px_-16px_rgba(26,15,18,.35)] ring-1 ring-[#ecdfd6] sm:right-6 motion-safe:animate-float-slow">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-700 text-white"><Award size={22} /></span>
              <span className="text-right leading-tight">
                <b className="block text-[15px] text-[#1a0f12]">{content['home.hero.certificateTitle'] || 'شهادة معتمدة'}</b>
                <span className="text-[13px] text-[#7a6a64]">{content['home.hero.certificateSubtitle'] || 'موثقة برقم تسلسلي'}</span>
              </span>
            </div>
            <div className="absolute -top-5 left-3 hidden items-center gap-2 rounded-2xl bg-[#1a0f12] px-4 py-2.5 text-white shadow-xl sm:left-6 sm:flex">
              <BadgeCheck size={20} className="text-[#e3b65a]" />
              <span className="text-sm font-extrabold">{content['home.hero.trustCount'] || '+12,000'} {content['home.hero.trustLabel'] || 'طالب يثقون بنا'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* the figures, in one card sitting on the edge of the hero */}
      <div className="container relative z-10 mx-auto -mt-14 px-4 sm:-mt-16">
        <div ref={statsRef} className="mx-auto grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-[28px] bg-[#ecdfd6] shadow-[0_30px_60px_-30px_rgba(26,15,18,.3)] ring-1 ring-[#ecdfd6] sm:grid-cols-4 [&>*]:bg-white">
          {stats.map(stat => <Stat key={stat.label} {...stat} run={statsSeen} />)}
        </div>
      </div>
    </>
  );
};

export default HeroSection;
