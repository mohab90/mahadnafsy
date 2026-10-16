import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Briefcase, ChevronLeft, ChevronRight, GraduationCap, Sparkles, X } from 'lucide-react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { useSiteData } from '../context/SiteDataContext';
import { cdnImg } from '../lib/img';
import { isExpiryActive } from '../../shared/cairoDate';
import { offerHours, offerIsShown, offerRemainingMs } from '../../shared/siteOffers';
import { useSeo } from '../lib/useSeo';
import { VideoSurface } from '../components/VideoSurface';
import { goalsFromCourses, recommendedCourse } from '../../shared/homeGoals';
import HeroSection from '../components/home/HeroSection';
import ProgramExplorer from '../components/home/ProgramExplorer';
import OfferSpotlight from '../components/home/OfferSpotlight';
import WhyChooseSection from '../components/home/WhyChooseSection';
import CertificateCheck from '../components/home/CertificateCheck';
import GraduatesGallery, { GRADUATION_PHOTOS } from '../components/home/GraduatesGallery';
import PaymentPlanner from '../components/home/PaymentPlanner';
import InstructorsCarousel from '../components/home/InstructorsCarousel';
import TestimonialsSection from '../components/home/TestimonialsSection';
import PathsSection from '../components/home/PathsSection';
import ConsultationSection from '../components/home/ConsultationSection';
import GoalFinder from '../components/home/GoalFinder';
import HomeFaq from '../components/home/HomeFaq';

// Countdown for the timed offer, from the moment the marketing team started it
// (offer.timerStartedAt, «ابدأ العداد» in التسويق ← الخصومات) for as many hours
// as they set there (offer.durationHours, 24 unless changed). A countdown nobody
// set is not shown, and one that has run out takes the offer off the page.
function useOfferCountdown(content: Record<string, string | undefined>) {
  const calc = () => {
    const remaining = offerRemainingMs(content);
    if (remaining === null) return null;
    return {
      h: Math.floor(remaining / 3600000),
      m: Math.floor((remaining % 3600000) / 60000),
      s: Math.floor((remaining % 60000) / 1000),
    };
  };
  const startedAt = content['offer.timerStartedAt'] || '';
  const hours = offerHours(content);
  const [time, setTime] = useState(calc);
  useEffect(() => {
    setTime(calc());
    if (!startedAt) return undefined;
    const id = setInterval(() => { if (!document.hidden) setTime(calc()); }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, hours]);
  return time;
}

const two = (n: number) => String(n).padStart(2, '0');

type Lightbox = { kind: 'video' } | { kind: 'photo'; index: number } | null;

const HomeNew: React.FC = () => {
  const { courses, bundles, testimonials, therapists, addPublicLead, content, discounts, currency } = useSiteData();
  const timer = useOfferCountdown(content);
  const offerShown = offerIsShown(content);
  const videoUrl = content['home.video.url'] || '';

  // One lightbox for the tour video and the graduation photos, on the top level
  // of the shared stacking scale (z-[80]) like Modal's own.
  const [lightbox, setLightbox] = useState<Lightbox>(null);
  useEscapeKey(() => setLightbox(null), lightbox !== null);
  const step = useCallback((by: number) => setLightbox(box => (box?.kind === 'photo' ? { kind: 'photo', index: (box.index + by + GRADUATION_PHOTOS.length) % GRADUATION_PHOTOS.length } : box)), []);
  useEffect(() => {
    if (lightbox?.kind !== 'photo') return undefined;
    // Right-to-left: the left arrow moves on to the next photo.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') step(1); if (e.key === 'ArrowRight') step(-1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox?.kind, step]);

  // «مش عارف تبدأ منين؟» — interests and the recommended course both come from the course list.
  const goals = useMemo(() => goalsFromCourses(courses, 4), [courses]);
  const [goalPick, setGoalPick] = useState('');
  const goalId = goals.some(g => g.id === goalPick) ? goalPick : (goals[0]?.id || '');
  const goalCourse = useMemo(() => (goalId ? recommendedCourse(courses, goalId) : null), [courses, goalId]);

  useSeo({ title: 'الرئيسية | معهد الدراسات النفسية', path: '/', description: 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي — دبلومات معتمدة وتدريب عملي.' });
  // The new home page lives at /new beside the real one: never listed, and its canonical is «/».
  useEffect(() => {
    const robots = document.head.querySelector('meta[name="robots"]');
    const before = robots?.getAttribute('content') ?? null;
    robots?.setAttribute('content', 'noindex, nofollow');
    return () => { if (robots && before !== null) robots.setAttribute('content', before); };
  }, []);

  // «كورس مميز بخصم» (home.featured.*) with any discount rule running on it.
  // Expiry is a date judged in Cairo, not an instant — see isExpiryActive.
  const featured = (() => {
    const featuredId = content['home.featured.courseId'];
    const pct = Number(content['home.featured.discountPercent'] || 0);
    const course = featuredId ? courses.find(c => c.id === featuredId) : null;
    if (!course || !course.price || !pct) return null;
    const was = course.price[currency] ?? 0;
    const discounted = Math.round(was * (1 - pct / 100));
    const rule = discounts.find(d => d.active && d.type === 'course' && d.targetId === featuredId && isExpiryActive(d.expiresAt))
      ?? discounts.find(d => d.active && d.type === 'all_courses' && isExpiryActive(d.expiresAt));
    const now = rule ? Math.round(discounted * (1 - rule.discountPercent / 100)) : discounted;
    return { course, pct, was, now };
  })();
  const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  return (
    <div className="animate-fade-in bg-white">
      {/* ── Offer strip: the timed offer, with its countdown ── */}
      {offerShown && (
        <div className="bg-[#1a0f12] text-white">
          <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-center text-sm font-bold sm:text-[15px]">
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-[#e3b65a] opacity-70 motion-safe:animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#e3b65a]" /></span>
              عرض الـ{offerHours(content)} ساعة على {content['home.offer.title'] || 'دبلومة العلاج السلوكي الجدلي (DBT)'}
            </span>
            {timer && (
              <span dir="ltr" className="rounded-full bg-white/10 px-3 py-0.5 font-black tabular-nums text-[#f3c969]">
                {two(timer.h)} : {two(timer.m)} : {two(timer.s)}
              </span>
            )}
            <a href="#offer" className="rounded-full bg-primary-700 px-3.5 py-0.5 font-extrabold transition hover:bg-primary-600">احجز الآن</a>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <HeroSection content={content} therapists={therapists} hasVideo={!!videoUrl} onPlay={() => setLightbox({ kind: 'video' })} />

      {/* ── Programmes, by specialty ── */}
      <ProgramExplorer content={content} courses={courses} currency={currency} />

      {/* ── A featured course at a special price ── */}
      {featured && (
        <section className="bg-white px-4 pb-6">
          <div className="container mx-auto flex flex-col items-center gap-5 rounded-[28px] border border-[#ecdfd6] bg-[#fbf7f2] p-4 sm:flex-row sm:p-5">
            {featured.course.thumbnail && <img src={cdnImg(featured.course.thumbnail, 480)} alt={featured.course.title} loading="lazy" className="aspect-[16/10] w-full flex-none rounded-2xl object-cover sm:w-56" />}
            <div className="min-w-0 flex-1 text-center sm:text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white"><Sparkles size={13} /> عرض خاص — خصم {featured.pct}% إضافي</span>
              <h3 className="mt-2 text-xl font-black text-[#1a0f12] sm:text-2xl">{featured.course.title}</h3>
              <p className="mt-1 text-sm text-[#7a6a64]"><s className="tabular-nums">{featured.was} {sym}</s> <b className="mr-2 text-2xl font-black tabular-nums text-primary-700">{featured.now} {sym}</b></p>
            </div>
            <Link to={`/c/${featured.course.slug || featured.course.id}`} className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl bg-[#1a0f12] px-6 font-black text-white transition hover:bg-black">
              اشترك بالخصم <ArrowLeft size={18} />
            </Link>
          </div>
        </section>
      )}

      {/* ── The timed offer, with its registration form ── */}
      {offerShown && <OfferSpotlight content={content} courses={courses} currency={currency} timer={timer} addPublicLead={addPublicLead} />}

      {/* ── Why the institute — tour video + reasons, then the certificate check right under it ── */}
      <section id="why" className="scroll-mt-24 bg-white py-16 sm:py-24">
        <div className="container mx-auto px-4">
          <WhyChooseSection content={content} onPlay={() => setLightbox({ kind: 'video' })} />
          <CertificateCheck />
        </div>
      </section>

      {/* ── Real graduation photos ── */}
      <GraduatesGallery graduates={content['home.hero.trustCount'] || content['home.stats.graduates'] || '12,000'} onOpen={index => setLightbox({ kind: 'photo', index })} />

      {/* ── Four steps, and what is paid today ── */}
      <PaymentPlanner content={content} courses={courses} currency={currency} initialCourseId={goalCourse?.id} />

      {/* ── Instructors ── */}
      <InstructorsCarousel therapists={therapists} />

      {/* ── Testimonials ── */}
      <TestimonialsSection content={content} testimonials={testimonials} />

      {/* ── Learning paths ── */}
      <PathsSection content={content} bundles={bundles} currency={currency} />

      {/* ── Express consultation — «اعرض قسم الاستشارة في الرئيسية» ── */}
      {content['consultation.show_on_home'] !== 'false' && <ConsultationSection content={content} therapists={therapists} currency={currency} />}

      {/* ── «مش عارف تبدأ منين؟» and the questions people ask — right above the closing slide ── */}
      <section id="find" className="scroll-mt-24 bg-white py-16 sm:py-24">
        <div className="container mx-auto grid items-start gap-10 px-4 lg:grid-cols-2 lg:gap-14">
          <GoalFinder goals={goals} goalId={goalId} onPick={setGoalPick} course={goalCourse} currency={currency} />
          <HomeFaq content={content} />
        </div>
      </section>

      {/* Closing slide: book (red) and join the team (dark), with the graduates between them */}
      <section id="start" className="scroll-mt-24 bg-white px-4 pb-16 sm:pb-24">
        <div className="container mx-auto overflow-hidden rounded-[36px] shadow-[0_50px_90px_-40px_rgba(76,5,25,.7)]">
          <div className="grid lg:grid-cols-[1fr_minmax(260px,0.75fr)_1fr]">
            <div className="relative flex flex-col justify-center overflow-hidden bg-primary-700 px-6 py-12 text-center text-white sm:px-10 sm:py-14 lg:text-right">
              <div aria-hidden="true" className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary-600" />
              <div className="relative">
                <span className="text-sm font-extrabold text-[#f3c969]">احجز مكانك</span>
                <h2 className="mb-3.5 mt-2 text-3xl font-black leading-tight sm:text-4xl">جاهز تبدأ مسارك المهني؟</h2>
                <p className="mx-auto mb-7 max-w-md text-base leading-relaxed text-white/80 lg:mx-0">
                  اختار برنامجك واحجز مكانك الآن، كاش بخصم أكبر أو بالتقسيط. وفريقنا معاك في كل خطوة.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                  <Link to="/enroll" className="inline-flex min-h-[56px] items-center justify-center whitespace-nowrap rounded-2xl bg-white px-6 text-base font-black text-primary-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-primary-50 sm:text-lg">احجز مكانك الآن</Link>
                  <Link to="/courses" className="inline-flex min-h-[56px] items-center justify-center whitespace-nowrap rounded-2xl border-[1.5px] border-white/60 px-6 text-base font-extrabold text-white transition hover:bg-white/10 sm:text-lg">تصفح الكورسات</Link>
                </div>
              </div>
            </div>

            <div className="relative order-first min-h-[260px] lg:order-none lg:min-h-[440px]">
              <img
                src={`${import.meta.env.BASE_URL}brand/graduates.jpg`}
                alt="خريجو معهد الدراسات النفسية بشهاداتهم"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover object-top"
              />
              <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-16 bg-gradient-to-l from-primary-700/70 to-transparent lg:block" />
              <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-16 bg-gradient-to-r from-[#1a0f12]/80 to-transparent lg:block" />
              <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent lg:hidden" />
            </div>

            <div id="join" className="relative flex scroll-mt-24 flex-col justify-center overflow-hidden bg-[#1a0f12] px-6 py-12 text-center text-white sm:px-10 sm:py-14 lg:text-right">
              <div aria-hidden="true" className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-primary-900 opacity-70" />
              <div className="relative">
                <span className="text-sm font-extrabold text-[#e3b65a]">فرص العمل</span>
                <h2 className="mb-3.5 mt-2 text-3xl font-black leading-tight sm:text-4xl">انضم لفريق معهد الدراسات النفسية</h2>
                <p className="mx-auto mb-7 max-w-md text-base leading-relaxed text-white/70 lg:mx-0">
                  قدّم الآن كمحاضر أو كموظف، وفريقنا يراجع طلبك ويتواصل معك.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                  <Link to="/join" className="inline-flex min-h-[56px] items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#e3b65a] px-5 text-base font-black text-[#1a0f12] transition hover:-translate-y-0.5 hover:brightness-105">
                    <GraduationCap size={20} />
                    انضم إلينا كمحاضر
                  </Link>
                  <Link to="/join-us" className="inline-flex min-h-[56px] items-center justify-center gap-2 whitespace-nowrap rounded-2xl border-[1.5px] border-white/40 px-5 text-base font-bold text-white transition hover:bg-white/10">
                    <Briefcase size={20} />
                    انضم إلينا كموظف
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {lightbox && (lightbox.kind === 'photo' || videoUrl) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20" onClick={() => setLightbox(null)} aria-label="إغلاق">
            <X size={24} />
          </button>
          {lightbox.kind === 'video' ? (
            <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
              <div className="relative aspect-video overflow-hidden rounded-2xl shadow-2xl">
                <VideoSurface url={videoUrl} title="فيديو المعهد" autoplay />
              </div>
            </div>
          ) : (
            <>
              <img
                src={`${import.meta.env.BASE_URL}brand/grads/${GRADUATION_PHOTOS[lightbox.index].src}`}
                alt={GRADUATION_PHOTOS[lightbox.index].alt}
                loading="lazy"
                onClick={e => e.stopPropagation()}
                className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
              />
              <button type="button" onClick={e => { e.stopPropagation(); step(-1); }} aria-label="الصورة السابقة" className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 sm:right-6"><ChevronRight size={26} /></button>
              <button type="button" onClick={e => { e.stopPropagation(); step(1); }} aria-label="الصورة التالية" className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 sm:left-6"><ChevronLeft size={26} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default HomeNew;
