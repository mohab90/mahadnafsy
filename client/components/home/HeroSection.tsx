import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, PlayCircle, Star } from 'lucide-react';
import type { Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import Picture from '../Picture';
import { useCountUp, useInView } from './Reveal';
import { heroText, type HeroVariantId } from '../../../shared/siteDesigns';

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

type Theme = {
  section: string;
  glow: React.ReactNode;
  title: string;
  accent: string;
  underline: string;
  subtitle: string;
  badge: string;
  dot: string;
  primary: string;
  secondary: string;
  faceRing: string;
  facesTitle: string;
  facesText: string;
  play: string;
};

const THEMES: Record<HeroVariantId, Theme> = {
  white: {
    section: 'bg-paper',
    glow: (
      <>
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.13),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.16),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.35]" style={{ backgroundImage: 'radial-gradient(rgba(26,15,18,.09) 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'linear-gradient(to bottom, black, transparent 85%)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)' }} />
      </>
    ),
    title: 'text-ink',
    accent: 'text-primary-700',
    underline: 'text-gold',
    subtitle: 'text-muted-strong',
    badge: 'border border-line bg-white text-primary-700 shadow-sm',
    dot: 'bg-primary-600',
    primary: 'bg-primary-700 text-white shadow-[0_18px_40px_-14px_rgba(159,18,57,.75)] hover:bg-primary-800',
    secondary: 'border-ink/15 bg-white text-ink hover:border-ink/40',
    faceRing: 'border-paper',
    facesTitle: 'text-ink',
    facesText: 'text-muted-strong',
    play: 'text-primary-700 hover:text-primary-800 sm:border-line',
  },
  red: {
    section: 'bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519]',
    glow: (
      <>
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(243,201,105,.22),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.1]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
      </>
    ),
    title: 'text-white',
    accent: 'text-gold-pale',
    underline: 'text-white/70',
    subtitle: 'text-white/80',
    badge: 'bg-white/10 text-gold-pale ring-1 ring-white/20',
    dot: 'bg-gold-pale',
    primary: 'bg-white text-primary-700 shadow-[0_18px_40px_-14px_rgba(0,0,0,.45)] hover:bg-primary-50',
    secondary: 'border-white/45 bg-transparent text-white hover:bg-white/10',
    faceRing: 'border-primary-800',
    facesTitle: 'text-white',
    facesText: 'text-white/70',
    play: 'text-gold-pale hover:text-white sm:border-white/20',
  },
  dark: {
    section: 'bg-ink',
    glow: (
      <>
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.32),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 bottom-0 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.18),transparent)]" />
      </>
    ),
    title: 'text-white',
    accent: 'text-gold-light',
    underline: 'text-primary-500',
    subtitle: 'text-white/70',
    badge: 'bg-white/[.06] text-gold-light ring-1 ring-gold-light/30',
    dot: 'bg-gold-light',
    primary: 'bg-gold-light text-ink shadow-[0_18px_40px_-14px_rgba(227,182,90,.55)] hover:brightness-105',
    secondary: 'border-white/25 bg-transparent text-white hover:bg-white/10',
    faceRing: 'border-ink',
    facesTitle: 'text-white',
    facesText: 'text-white/60',
    play: 'text-gold-light hover:text-white sm:border-white/15',
  },
};

/** The title, with the words the panel marked drawn in the accent colour and underlined. */
const Title: React.FC<{ text: string; highlight: string; theme: Theme }> = ({ text, highlight, theme }) => {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className={`relative whitespace-nowrap ${theme.accent}`}>
        {highlight}
        <svg aria-hidden="true" viewBox="0 0 200 12" preserveAspectRatio="none" className={`absolute -bottom-1 left-0 h-3 w-full ${theme.underline}`}><path d="M2 9 C 50 2, 150 2, 198 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
      </span>
      {text.slice(at + highlight.length)}
    </>
  );
};

/** Labels under the photos, never over them. */
const ProofChips: React.FC<{ content: Content; light: boolean }> = ({ content, light }) => (
  <div className="relative flex flex-wrap items-center justify-center gap-2 px-3 pb-5 pt-5 sm:gap-3 sm:pb-6">
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[13px] font-extrabold text-ink shadow-lg sm:text-sm">
      <Award size={17} className="text-primary-700" />
      {content['home.hero.certificateTitle'] || 'شهادة معتمدة'} · {content['home.hero.certificateSubtitle'] || 'موثقة برقم تسلسلي'}
    </span>
    <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-extrabold ring-1 sm:text-sm ${light ? 'bg-ink/40 text-white ring-white/25' : 'bg-white/10 text-white ring-white/20'}`}>
      <BadgeCheck size={17} className="text-gold-pale" />
      {content['home.hero.trustCount'] || '+12,000'} {content['home.hero.trustLabel'] || 'طالب يثقون بنا'}
    </span>
  </div>
);

/** White: three graduates side by side on a burgundy panel. */
const TrioVisual: React.FC<{ content: Content }> = ({ content }) => (
  <div className="relative mx-auto w-full max-w-[640px] lg:mx-0">
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[24%] rounded-[36px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] shadow-[0_40px_80px_-40px_rgba(76,5,25,.8)]" />
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[24%] rounded-[36px] opacity-[.14]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.8) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
    <div className="relative grid grid-cols-3 items-end gap-2.5 px-3 pt-8 sm:gap-4 sm:px-5">
      {HERO_GRADUATES.map((g, i) => (
        <Picture
          key={g.name}
          photo={`hero-${g.name}`}
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
    <ProofChips content={content} light />
  </div>
);

/**
 * Red and dark: one graduate in a tall arch, a second photo from graduation
 * day beside it. The arch carries a ring in the variant's accent.
 */
const ArchVisual: React.FC<{ content: Content; main: string; mainAlt: string; side: string; sideAlt: string; ring: string; halo: string }> = ({ content, main, mainAlt, side, sideAlt, ring, halo }) => (
  <div className="relative mx-auto w-full max-w-[520px] lg:mx-0">
    <div className="relative">
    <div className="relative mx-auto w-[80%] sm:w-[72%] lg:me-0 lg:ms-auto">
      <div aria-hidden="true" className={`absolute -inset-4 rounded-t-[999px] rounded-b-[44px] ${halo}`} />
      <Picture
        photo={main}
        widths={[360, 640]}
        sizes="(min-width: 1024px) 380px, 72vw"
        alt={mainAlt}
        width={640}
        height={1120}
        priority
        className={`relative aspect-[4/5] w-full rounded-t-[999px] rounded-b-[36px] object-cover object-top shadow-[0_40px_80px_-30px_rgba(0,0,0,.7)] ${ring}`}
      />
    </div>
    <div className="absolute -bottom-3 left-0 w-[44%] sm:w-[40%]">
      <Picture
        photo={side}
        widths={[480]}
        sizes="(min-width: 1024px) 210px, 40vw"
        alt={sideAlt}
        width={480}
        height={360}
        priority
        className="aspect-[4/3] w-full rounded-[22px] object-cover shadow-[0_30px_50px_-20px_rgba(0,0,0,.7)] ring-4 ring-white"
      />
    </div>
    </div>
    <div className="pt-4"><ProofChips content={content} light={false} /></div>
  </div>
);

/**
 * The first screen: one promise, one booking button, and the proof right
 * beside it. It comes in three looks (shared/siteDesigns.ts HERO_VARIANTS) —
 * white, red and dark, each with its own text and photos — and the home page
 * shows a different one on each visit unless the panel fixes one.
 */
const HeroSection: React.FC<{ content: Content; therapists: Therapist[]; hasVideo: boolean; onPlay: () => void; variant: HeroVariantId }> = ({ content, therapists, hasVideo, onPlay, variant }) => {
  const [statsRef, statsSeen] = useInView<HTMLDivElement>('0px');
  const theme = THEMES[variant];
  const text = heroText(content, variant);
  const faces = therapists.filter(t => t.image).sort((a, b) => Number(!!b.showOnHome) - Number(!!a.showOnHome) || (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).slice(0, 4);
  const stats = [
    { value: content['home.stats.graduates'] || '12K', label: content['home.stats.graduatesLabel'] || 'خريج' },
    { value: content['home.stats.programs'] || '50+', label: content['home.stats.programsLabel'] || 'برنامج تدريبي' },
    { value: content['home.stats.experts'] || '30+', label: content['home.stats.expertsLabel'] || 'خبير ومدرب' },
    { value: content['home.stats.rating'] || '4.9', label: 'تقييم الطلاب', star: true },
  ];

  return (
    <>
      <section data-hero={variant} className={`relative overflow-hidden ${theme.section}`}>
        {theme.glow}

        <div className="container relative mx-auto grid items-center gap-12 px-4 pb-28 pt-10 sm:pb-32 sm:pt-14 lg:grid-cols-[1.05fr_.95fr] lg:gap-12 lg:pb-36 lg:pt-16">
          <div className="text-center lg:text-right">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-extrabold sm:text-sm ${theme.badge}`}>
              <span className="relative flex h-2 w-2"><span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${theme.dot}`} /><span className={`relative inline-flex h-2 w-2 rounded-full ${theme.dot}`} /></span>
              {text.badge}
            </span>

            <h1 className={`mt-5 text-balance text-[29px] font-black leading-[1.45] sm:text-[40px] lg:text-[40px] xl:text-[46px] xl:leading-[1.4] ${theme.title}`}>
              <Title text={text.title} highlight={text.highlight} theme={theme} />
            </h1>

            <p className={`mx-auto mt-5 max-w-xl text-base leading-[1.9] sm:text-lg lg:mx-0 ${theme.subtitle}`}>{text.subtitle}</p>

            <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              <Link to="/enroll" className={`group inline-flex min-h-[58px] items-center justify-center gap-3 rounded-2xl px-9 text-lg font-extrabold transition hover:-translate-y-0.5 ${theme.primary}`}>
                <span>{text.primaryCta}</span>
                <ArrowLeft size={22} className="transition group-hover:-translate-x-1" />
              </Link>
              <Link to="/courses" className={`inline-flex min-h-[58px] items-center justify-center rounded-2xl border-[1.5px] px-8 text-lg font-bold transition ${theme.secondary}`}>
                {text.secondaryCta}
              </Link>
            </div>

            <div className="mx-auto mt-9 flex max-w-md flex-col items-center gap-4 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              {faces.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3 space-x-reverse">
                    {faces.map(t => (
                      <img key={t.id} src={cdnImg(t.image, 120)} alt={t.name} title={t.name} loading="lazy" width={44} height={44} className={`h-11 w-11 rounded-full border-[3px] bg-sand object-cover ${theme.faceRing}`} />
                    ))}
                  </div>
                  <span className={`text-right text-[13px] leading-snug ${theme.facesText}`}>
                    <b className={`block text-[15px] ${theme.facesTitle}`}>نخبة من دكاترة علم النفس</b>
                    يدرّسون ويشرفون على التدريب بنفسهم
                  </span>
                </div>
              )}
              {hasVideo && (
                <button type="button" onClick={onPlay} className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-2 text-[15px] font-extrabold transition sm:border-r sm:pr-5 ${theme.play}`}>
                  <PlayCircle size={26} />
                  شوف جولة داخل المعهد
                </button>
              )}
            </div>
          </div>

          {variant === 'white' && <TrioVisual content={content} />}
          {variant === 'red' && (
            <ArchVisual content={content} main="hero-cert" mainAlt="خريجة من معهد الدراسات النفسية تحمل شهاداتها" side="celebration" sideAlt="خريجات المعهد يحتفلن بشهاداتهن" ring="ring-[6px] ring-gold-pale/80" halo="bg-[radial-gradient(closest-side,rgba(243,201,105,.35),transparent)]" />
          )}
          {variant === 'dark' && (
            <ArchVisual content={content} main="hero-man" mainAlt="خريج من معهد الدراسات النفسية بلبس التخرج يحمل شهاداته" side="women-group" sideAlt="دفعة من خريجات المعهد بلبس التخرج" ring="ring-[6px] ring-gold-light" halo="bg-[radial-gradient(closest-side,rgba(190,18,60,.55),transparent)]" />
          )}
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
