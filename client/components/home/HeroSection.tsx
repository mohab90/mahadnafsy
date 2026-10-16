import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, PlayCircle, Star } from 'lucide-react';
import type { Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import Picture from '../Picture';
import { useCountUp, useInView } from './Reveal';

type Content = Record<string, string | undefined>;

// Real graduates of the institute, on graduation day, with their certificates.
// The background behind each one is blurred so the graduate stands out.
const HERO_GRADUATES = [
  { name: 'woman', alt: 'خريجة من معهد الدراسات النفسية تحمل شهاداتها' },
  { name: 'man', alt: 'خريج من معهد الدراسات النفسية بلبس التخرج يحمل شهاداته' },
  { name: 'cert', alt: 'خريجة من المعهد تحمل شهاداتها' },
];

const Stat: React.FC<{ value: string; label: string; run: boolean; star?: boolean }> = ({ value, label, run, star }) => {
  const shown = useCountUp(value, run);
  return (
    <div className="px-3 py-5 text-center sm:px-5 sm:py-6">
      <div dir="ltr" className="flex items-center justify-center gap-1.5 text-[30px] font-black leading-none tabular-nums text-ink sm:text-[38px]">
        {shown}
        {star && <Star size={22} className="text-gold" fill="currentColor" />}
      </div>
      <div className="mt-2 text-[13px] font-bold text-muted sm:text-sm">{label}</div>
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
      <section className="relative overflow-hidden bg-paper">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.13),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.16),transparent)]" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[.35]"
          style={{ backgroundImage: 'radial-gradient(rgba(26,15,18,.09) 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'linear-gradient(to bottom, black, transparent 85%)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)' }}
        />

        <div className="container relative mx-auto grid items-center gap-12 px-4 pb-28 pt-10 sm:pb-32 sm:pt-14 lg:grid-cols-[1.05fr_.95fr] lg:gap-12 lg:pb-36 lg:pt-16">
          <div className="text-center lg:text-right">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-[13px] font-extrabold text-primary-700 shadow-sm sm:text-sm">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary-600" /></span>
              {content['home.hero.badge'] || 'مستقبلك المهني يبدأ من هنا'}
            </span>

            <h1 className="mt-5 text-balance text-[29px] font-black leading-[1.45] text-ink sm:text-[40px] lg:text-[40px] xl:text-[46px] xl:leading-[1.4]">
              ابدأ مسارك المهني في <span className="relative whitespace-nowrap text-primary-700">الصحة النفسية<svg aria-hidden="true" viewBox="0 0 200 12" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-3 w-full text-gold"><path d="M2 9 C 50 2, 150 2, 198 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg></span> بتدريب نظري وعملي مع أفضل دكاترة علم النفس وبشهادة معتمدة
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-[1.9] text-muted-strong sm:text-lg lg:mx-0">
              {content['home.heroSubtitle'] || 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي. دبلومات معتمدة، وتدريب عملي مع نخبة الخبراء.'}
            </p>

            <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              <Link to="/enroll" className="group inline-flex min-h-[58px] items-center justify-center gap-3 rounded-2xl bg-primary-700 px-9 text-lg font-extrabold text-white shadow-[0_18px_40px_-14px_rgba(159,18,57,.75)] transition hover:-translate-y-0.5 hover:bg-primary-800">
                <span>احجز مكانك الآن</span>
                <ArrowLeft size={22} className="transition group-hover:-translate-x-1" />
              </Link>
              <Link to="/courses" className="inline-flex min-h-[58px] items-center justify-center rounded-2xl border-[1.5px] border-ink/15 bg-white px-8 text-lg font-bold text-ink transition hover:border-ink/40">
                {content['home.hero.primaryCta'] || 'تصفح الدبلومات'}
              </Link>
            </div>

            <div className="mx-auto mt-9 flex max-w-md flex-col items-center gap-4 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              {faces.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3 space-x-reverse">
                    {faces.map(t => (
                      <img key={t.id} src={cdnImg(t.image, 96)} alt={t.name} title={t.name} loading="lazy" className="h-11 w-11 rounded-full border-[3px] border-paper bg-sand object-cover" />
                    ))}
                  </div>
                  <span className="text-right text-[13px] leading-snug text-muted-strong">
                    <b className="block text-[15px] text-ink">نخبة من دكاترة علم النفس</b>
                    يدرّسون ويشرفون على التدريب بنفسهم
                  </span>
                </div>
              )}
              {hasVideo && (
                <button type="button" onClick={onPlay} className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-2 text-[15px] font-extrabold text-primary-700 transition hover:text-primary-800 sm:border-r sm:border-line sm:pr-5">
                  <PlayCircle size={26} />
                  شوف جولة داخل المعهد
                </button>
              )}
            </div>
          </div>

          {/* three of the institute's graduates, holding its certificates — nothing written over them */}
          <div className="relative mx-auto w-full max-w-[640px] lg:mx-0">
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[24%] rounded-[36px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] shadow-[0_40px_80px_-40px_rgba(76,5,25,.8)]" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[24%] rounded-[36px] opacity-[.14]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.8) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
            <div className="relative grid grid-cols-3 items-end gap-2.5 px-3 pt-8 sm:gap-4 sm:px-5">
              {HERO_GRADUATES.map((g, i) => (
                <Picture
                  key={g.name}
                  base={`brand/grads/hero-${g.name}`}
                  widths={[360, 640]}
                  sizes="(min-width: 1024px) 210px, 31vw"
                  alt={g.alt}
                  width={640}
                  height={1120}
                  priority
                  className={`aspect-[4/7] w-full rounded-[20px] object-cover object-top shadow-[0_30px_50px_-20px_rgba(26,15,18,.7)] ring-[3px] ring-white sm:rounded-[26px] sm:ring-4 ${i === 1 ? '-translate-y-6 sm:-translate-y-8' : ''}`}
                />
              ))}
            </div>
            <div className="relative flex flex-wrap items-center justify-center gap-2 px-3 pb-5 pt-5 sm:gap-3 sm:pb-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[13px] font-extrabold text-ink shadow-lg sm:text-sm">
                <Award size={17} className="text-primary-700" />
                {content['home.hero.certificateTitle'] || 'شهادة معتمدة'} · {content['home.hero.certificateSubtitle'] || 'موثقة برقم تسلسلي'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-ink/40 px-3.5 py-2 text-[13px] font-extrabold text-white ring-1 ring-white/25 sm:text-sm">
                <BadgeCheck size={17} className="text-gold-pale" />
                {content['home.hero.trustCount'] || '+12,000'} {content['home.hero.trustLabel'] || 'طالب يثقون بنا'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* the figures, in one card sitting on the edge of the hero */}
      <div className="container relative z-10 mx-auto -mt-14 px-4 sm:-mt-16">
        <div ref={statsRef} className="mx-auto grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-[28px] bg-line shadow-[0_30px_60px_-30px_rgba(26,15,18,.3)] ring-1 ring-line sm:grid-cols-4 [&>*]:bg-white">
          {stats.map(stat => <Stat key={stat.label} {...stat} run={statsSeen} />)}
        </div>
      </div>
    </>
  );
};

export default HeroSection;
