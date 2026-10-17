import React, { useState, useEffect } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Check, Award, ArrowLeft, PlayCircle, Briefcase, TrendingUp,
  Send, Star, Clock, Shield, X, Play, CreditCard,
} from 'lucide-react';
import { BranchType } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCertificate from '../components/CourseCertificate';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { discountPercent } from '../../shared/priceFormat';
import { useSeo, seoSummary } from '../lib/useSeo';
import { youtubeEmbedUrl } from '../lib/lectureVideo';
import { VideoSurface } from '../components/VideoSurface';

// Strip HTML tags + Word-style markup and return clean Arabic text
function stripHtml(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// The bundle's trailer. It was the one player left on plain youtube.com with
// the full chrome: the title bar, the related videos at the end and «Watch on
// YouTube» are each a link to the channel, and the channel lists the lectures.
// A trailer is not worth protecting; the way out of it is.
const toEmbedUrl = (url: string): string => youtubeEmbedUrl(url);

const BundleDetails: React.FC = () => {
  const { bundles, addPublicLead, content: globalContent, currency, testimonials } = useSiteData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bundleLeadName, setBundleLeadName] = useState('');
  const [bundleLeadPhone, setBundleLeadPhone] = useState('');
  const [bundleLeadBranch, setBundleLeadBranch] = useState('');
  const [bundleLeadNotice, setBundleLeadNotice] = useState('');

  const [certModalOpen, setCertModalOpen] = useState(false);
  // A certificate on a dark ground is a viewer, not a dialog — a white panel
  // with a header row would be wrong. Escape is right for both.
  useEscapeKey(() => setCertModalOpen(false), certModalOpen);
  const [videoModalOpen, setVideoModalOpen] = useState(false);

  // Match by id OR slug
  const bundle = bundles.find(b => b.id === id || b.slug === id);
  // A bundle priced in EGP only rendered a bold "0" to a visitor browsing in
  // USD, with a live checkout button under it.
  const priceAvailable = (bundle?.price?.[currency] ?? 0) > 0;
  useSeo({
    title: (bundle?.seo_title || (bundle?.title ? `${bundle.title} — مسار` : 'المسارات والباقات')) + ' | معهد الدراسات النفسية',
    path: bundle?.id ? `/bundle/${bundle.id}` : '/bundles',
    description: seoSummary(bundle?.seo_description || bundle?.shortDescription || bundle?.description,
      'مسار تعليمي متكامل من معهد الدراسات النفسية.'),
    image: bundle?.thumbnail || bundle?.courses?.[0]?.thumbnail,
    type: bundle ? 'article' : 'website',
  });
  if (!bundle) return <div className="bg-paper px-4 py-24 text-center text-lg font-bold text-muted">{globalContent['bundleDetails.notFound'] || 'المسار غير موجود'}</div>;

  const content = { ...globalContent, ...(bundle.detailsContent || {}) };
  const currentPrice = bundle.price?.[currency] ?? 0;
  const oldPrice = bundle.originalPrice?.[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const savePct = String(discountPercent(oldPrice, currentPrice));
  const embedUrl = bundle.videoUrl ? toEmbedUrl(bundle.videoUrl) : '';

  const handleBundleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bundleLeadName.trim() || !bundleLeadPhone.trim()) {
      setBundleLeadNotice('يرجى إدخال الاسم ورقم الهاتف.');
      return;
    }
    const generatedEmail = `${bundleLeadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
    const payload = {
      id: `l-${Date.now()}`,
      name: bundleLeadName.trim(),
      email: generatedEmail,
      phone: bundleLeadPhone.trim(),
      branch: bundleLeadBranch as BranchType,
      source: `طلب مسار - ${bundle.title}`,
      status: 'new' as const,
      leadType: 'course' as const,
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    try {
      await addPublicLead(payload);
      setBundleLeadName('');
      setBundleLeadPhone('');
      setBundleLeadBranch('');
      setBundleLeadNotice('تم تسجيل بياناتك وسيتم التواصل معك خلال 48 ساعة من خدمة العملاء.');
    } catch {
      setBundleLeadNotice('تعذر تسجيل بياناتك حاليًا. حاول مرة أخرى أو تواصل معنا على واتساب.');
    }
  };

  let galleryImgs: string[] = [];
  try { galleryImgs = JSON.parse(content['institute.gallery.images'] || '[]'); } catch {}

  const field = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const sectionCard = 'rounded-[28px] border border-line bg-white p-5 sm:p-8';
  const sectionTitle = 'text-2xl font-black leading-tight text-ink sm:text-[28px]';

  return (
    <div className="min-h-screen bg-paper" dir="rtl">

      {/* ──────────────── HERO ──────────────── */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.35),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -right-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.18),transparent)]" />

        <div className="container relative mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
          <div className={`grid items-center gap-10 lg:gap-14 ${embedUrl ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]' : ''}`}>

            {/* Text, price and the way in */}
            <div className={`min-w-0 text-center lg:text-right ${embedUrl ? '' : 'max-w-3xl'}`}>
              <span className="inline-flex rounded-full bg-gold-light px-4 py-1.5 text-sm font-black text-ink">
                {content['bundleDetails.hero.badge'] || 'مسار تعليمي متكامل'}
              </span>
              <h1 className="mt-4 text-balance text-3xl font-black leading-tight sm:text-4xl lg:text-5xl">
                {bundle.title}
              </h1>
              {bundle.titleEn && (
                <p className="mt-2 text-lg font-bold text-gold-pale">{bundle.titleEn}</p>
              )}
              {(bundle.shortDescription || bundle.description) && (
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg lg:mx-0">
                  {bundle.shortDescription || bundle.description}
                </p>
              )}

              {/* Quick stats */}
              <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-sm font-bold ring-1 ring-white/15">
                  <PlayCircle size={16} className="text-gold-light" />
                  {bundle.courses.length} {content['bundleDetails.hero.courseCount'] || 'دبلوم'}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-sm font-bold ring-1 ring-white/15">
                  <Award size={16} className="text-gold-light" />
                  {content['bundleDetails.hero.certBadge'] || 'شهادة مجمعة معتمدة'}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-sm font-bold ring-1 ring-white/15">
                  <Shield size={16} className="text-gold-light" />
                  {content['bundleDetails.hero.support'] || 'إشراف مهني شامل'}
                </span>
              </div>

              {priceAvailable && (
                <div className="mt-7 flex flex-wrap items-end justify-center gap-x-4 gap-y-2 lg:justify-start">
                  <span className="text-5xl font-black leading-none tabular-nums">
                    {currentPrice.toLocaleString('ar-EG-u-nu-latn')} <span className="text-xl text-gold-light">{currencySymbol}</span>
                  </span>
                  {oldPrice > currentPrice && (
                    <span className="pb-0.5 text-right leading-tight">
                      <s className="block text-lg text-white/45 tabular-nums">{oldPrice.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</s>
                      {Number(savePct) > 0 && <span className="text-sm font-extrabold text-gold-pale">توفر {savePct}%</span>}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
                {/* Gated on the price the way the sidebar already was. A bundle
                    priced in EGP only still showed a visitor browsing in USD
                    the big «احجز مكانك الآن» here — and checkout then disabled
                    its own pay button on a zero price with nothing said. The
                    sidebar said «السعر غير متاح في دولتك حالياً»; the hero,
                    which is what people actually click, did not. */}
                {priceAvailable && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                      className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-gold-light px-8 text-lg font-black text-ink transition hover:brightness-105"
                    >
                      {content['bundleDetails.hero.ctaPay'] || 'احجز مكانك الآن'}
                      <ArrowLeft size={20} />
                    </button>
                    {/* Link, not <a href>: a raw anchor leaves the router, so it
                        reloads the whole app and re-fetches every list on the
                        way to a page this build already has. */}
                    <Link
                      to={`/enroll?bundle=${bundle.id}`}
                      className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-white/30 px-6 text-base font-extrabold text-white transition hover:border-white/70"
                    >
                      <CreditCard size={18} /> ادفع أونلاين مباشرة
                    </Link>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => document.getElementById('register-form')?.scrollIntoView({ behavior: 'smooth' })}
                  className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl px-6 text-base font-extrabold text-white/80 ring-1 ring-white/15 transition hover:text-white hover:ring-white/40"
                >
                  <Send size={17} />
                  {content['bundleDetails.hero.ctaLead'] || 'أرسل بياناتك للتواصل'}
                </button>
              </div>
            </div>

            {/* Video: a poster until it is asked for */}
            {embedUrl && (
              <div className="w-full min-w-0">
                <div className="relative aspect-video overflow-hidden rounded-[28px] bg-black shadow-[0_40px_80px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/10">
                  {videoModalOpen ? (
                    // The raw URL, not embedUrl: VideoSurface builds its own
                    // embed. This used to append «?autoplay=1&rel=0» to a URL
                    // that already had a query string, which made the second
                    // «?» part of the last parameter's value.
                    <VideoSurface url={bundle.videoUrl || ''} title={bundle.title} autoplay />
                  ) : (
                    <button
                      type="button"
                      aria-label={content['bundleDetails.video.label'] || 'شاهد نبذة عن هذا المسار التدريبي'}
                      className="group absolute inset-0 flex cursor-pointer items-center justify-center"
                      onClick={() => setVideoModalOpen(true)}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${embedUrl.split('/embed/')[1]?.split('?')[0]}/hqdefault.jpg`}
                        alt="video thumbnail"
                        width={480}
                        height={360}
                        decoding="async"
                        fetchPriority="high"
                        className="absolute inset-0 h-full w-full object-cover opacity-70"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-primary-700 shadow-2xl transition group-hover:bg-primary-600 motion-safe:group-hover:scale-105">
                        <Play size={32} className="ml-1 text-white" fill="white" />
                      </span>
                    </button>
                  )}
                </div>
                <p className="mt-3 text-center text-sm font-bold text-white/65">
                  {content['bundleDetails.video.label'] || 'شاهد نبذة عن هذا المسار التدريبي'}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ──────────────── MAIN CONTENT + SIDEBAR ──────────────── */}
      <div className="container mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">

          {/* ── MAIN COLUMN ── */}
          <div className="min-w-0 space-y-6 sm:space-y-8">

            {/* ── BUNDLE DESCRIPTION ── */}
            <section className={sectionCard}>
              {content['bundleDetails.about.headline'] && (
                <h2 className={`${sectionTitle} mb-4`}>{content['bundleDetails.about.headline']}</h2>
              )}
              <p className="whitespace-pre-line text-base leading-relaxed text-muted-body sm:text-[17px]">
                {content['bundleDetails.about.text'] || bundle.description}
              </p>
            </section>

            {/* ── COURSE PATH MAP ── */}
            <section className={sectionCard}>
              <h2 className={`${sectionTitle} mb-6 sm:mb-8`}>
                {content['bundleDetails.path.title'] || 'خريطة المسار التعليمي'}
              </h2>
              <ol>
                {bundle.courses.map((course, idx) => {
                  const cleanDesc = stripHtml(course.shortDescription || '');
                  return (
                    <li key={course.id} className="flex gap-3 sm:gap-4">
                      {/* Step number and the line to the next one */}
                      <div className="flex flex-none flex-col items-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-base font-black text-gold-pale">{idx + 1}</span>
                        <span aria-hidden="true" className="my-1.5 w-0.5 flex-1 bg-line" />
                      </div>
                      <div className="min-w-0 flex-1 pb-5">
                        <div className="group rounded-[20px] border border-line bg-paper p-4 transition hover:border-line-deep hover:bg-white sm:p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <span className="block text-xs font-extrabold text-gold-deep">
                                {content['bundleDetails.path.stationPrefix'] || 'المحطة'} {idx + 1}
                              </span>
                              <h3 className="mt-0.5 text-lg font-black leading-snug text-ink transition group-hover:text-primary-700">{course.title}</h3>
                              {(course.duration || course.level) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                  {course.duration && <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-extrabold text-muted-strong ring-1 ring-line"><Clock size={12} /> {course.duration}</span>}
                                  {course.level && <span className="rounded-full bg-white px-2.5 py-1 font-extrabold text-muted-strong ring-1 ring-line">{course.level}</span>}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate(`/c/${course.slug || course.id}`)}
                              className="inline-flex min-h-[44px] flex-none items-center justify-center self-start rounded-xl bg-primary-700 px-4 text-sm font-black text-white transition hover:bg-primary-800"
                            >
                              افتح »
                            </button>
                          </div>
                          {cleanDesc && (
                            <p className="mt-3 text-sm leading-relaxed text-muted-body">{cleanDesc}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}

                {/* Completion station */}
                <li className="flex gap-3 sm:gap-4">
                  <div className="flex flex-none flex-col items-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-light text-ink"><Award size={20} /></span>
                  </div>
                  <div className="min-w-0 flex-1 rounded-[20px] bg-ink p-5 text-white sm:p-6">
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="min-w-0">
                        <h3 className="mb-2 text-xl font-black text-gold-light">
                          {content['bundleDetails.path.finalTitle'] || 'إتمام المسار والاعتماد'}
                        </h3>
                        <p className="max-w-lg text-sm leading-relaxed text-white/65">
                          {content['bundleDetails.path.finalDesc'] || 'بعد إجتياز جميع الدبلومات والاختبارات، تحصل على شهادة المسار المجمعة وتصبح مؤهلاً للعمل في مجالك.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCertModalOpen(true)}
                        className="inline-flex min-h-[48px] flex-none items-center gap-2 rounded-2xl bg-gold-light px-5 text-sm font-black text-ink transition hover:brightness-105"
                      >
                        <Award size={16} />
                        {content['bundleDetails.cert.previewBtn'] || 'معاينة الشهادة'}
                      </button>
                    </div>
                  </div>
                </li>
              </ol>
            </section>

            {/* ── WHY THIS PATH ── */}
            <section className="grid gap-4 sm:grid-cols-2 sm:gap-5">
              <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-gold-pale">
                  <Briefcase size={24} />
                </span>
                <h3 className="mb-3 text-lg font-black text-ink">{content['bundleDetails.why.jobsTitle'] || 'فرص العمل'}</h3>
                <ul className="space-y-2.5 text-[15px] text-muted-body">
                  {[
                    content['bundleDetails.why.jobs1'] || 'العمل في العيادات والمراكز النفسية.',
                    content['bundleDetails.why.jobs2'] || 'العمل الحر كمستقل وخبير أونلاين.',
                    content['bundleDetails.why.jobs3'] || 'العمل في المدارس والمؤسسات التعليمية.',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                  <TrendingUp size={24} />
                </span>
                <h3 className="mb-3 text-lg font-black text-ink">{content['bundleDetails.why.skillsTitle'] || 'المهارات المكتسبة'}</h3>
                <ul className="space-y-2.5 text-[15px] text-muted-body">
                  {[
                    content['bundleDetails.why.skills1'] || 'التشخيص وصياغة الحالة بدقة.',
                    content['bundleDetails.why.skills2'] || 'تطبيق خطط العلاج النفسي الحديثة.',
                    content['bundleDetails.why.skills3'] || 'مهارات المقابلة العيادية وإدارة الجلسة.',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ── PRE-GALLERY MOTIVATIONAL ── */}
            {content['bundleDetails.gallery.motivational'] && (
              <section className="rounded-[28px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] p-6 text-center text-white sm:p-8">
                <p className="whitespace-pre-line text-xl font-black leading-relaxed">
                  {content['bundleDetails.gallery.motivational']}
                </p>
              </section>
            )}

            {/* ── GRADUATE GALLERY ── */}
            {galleryImgs.length > 0 && (
              <section className={sectionCard}>
                <h2 className={`${sectionTitle} mb-6`}>
                  {content['bundleDetails.graduates.title'] || 'معرض صور الخريجين'}
                </h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {galleryImgs.slice(0, 8).map((img, i) => (
                    <div key={i} className="aspect-square overflow-hidden rounded-2xl bg-sand">
                      <img loading="lazy" decoding="async" src={cdnImg(img, 400)} srcSet={cdnSrcSet(img, [240, 400])} sizes="(min-width: 768px) 180px, 45vw" width={200} height={200} alt="خريج" className="h-full w-full object-cover transition duration-500 motion-safe:hover:scale-105" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── TESTIMONIALS ── */}
            {testimonials.length > 0 && (
              <section className={sectionCard}>
                <h2 className={`${sectionTitle} mb-6`}>
                  {content['bundleDetails.testimonials.title'] || 'آراء الطلاب والخريجين'}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {testimonials.slice(0, 4).map((t) => (
                    <figure key={t.id} className="flex flex-col rounded-[20px] bg-paper p-5 ring-1 ring-line">
                      <div className="mb-3 flex gap-1">
                        {[1, 2, 3, 4, 5].map(s => <Star key={s} size={14} className="fill-gold-light text-gold-light" />)}
                      </div>
                      <blockquote className="mb-4 flex-1 text-[15px] leading-relaxed text-muted-body">"{t.text}"</blockquote>
                      <figcaption className="flex items-center gap-3">
                        {t.image ? (
                          <img loading="lazy" decoding="async" src={cdnImg(t.image, 120)} width={40} height={40} alt={t.name} className="h-10 w-10 rounded-full object-cover ring-1 ring-line" />
                        ) : (
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-sm font-black text-primary-700">{t.name.charAt(0)}</span>
                        )}
                        <span className="min-w-0">
                          <b className="block text-sm font-black text-ink">{t.name}</b>
                          <span className="block text-xs text-muted">{t.role}</span>
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {/* ── REGISTRATION FORM ── */}
            <section className="scroll-mt-24 rounded-[28px] bg-white p-5 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-8" id="register-form">
              <h3 className="text-center text-2xl font-black text-ink">{content['bundleDetails.form.title'] || 'انضم لهذا المسار التدريبي'}</h3>
              <p className="mx-auto mb-7 mt-2 max-w-lg text-center text-[15px] leading-relaxed text-muted-body">{content['bundleDetails.form.subtitle'] || 'سجل بياناتك وسيتم التواصل معك لتوضيح تفاصيل الدفع والجدول الزمني'}</p>
              <form className="mx-auto max-w-lg space-y-4" onSubmit={handleBundleLeadSubmit}>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['bundleDetails.form.nameLabel'] || 'الاسم الكامل'}</span>
                  <input type="text" value={bundleLeadName} onChange={(e) => setBundleLeadName(e.target.value)} autoComplete="name" className={field} placeholder={content['bundleDetails.form.namePlaceholder'] || 'الاسم كما يظهر في الشهادة'} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['bundleDetails.form.phoneLabel'] || 'رقم الهاتف'}</span>
                  <input type="tel" dir="ltr" value={bundleLeadPhone} onChange={(e) => setBundleLeadPhone(e.target.value)} autoComplete="tel" className={`${field} text-right`} placeholder={content['bundleDetails.form.phonePlaceholder'] || 'موبايل / واتساب'} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['bundleDetails.form.branchLabel'] || 'الفرع المفضل'}</span>
                  {(() => {
                    let dynBranches: { id: string; label: string; internal_only?: boolean }[] = [];
                    try { dynBranches = JSON.parse(content['institute.branches'] || '[]'); } catch {}
                    dynBranches = dynBranches.filter(b => !b.internal_only);
                    return (
                      <select value={bundleLeadBranch} onChange={(e) => setBundleLeadBranch(e.target.value)} className={field}>
                        <option value="">{content['bundleDetails.form.branchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                        {dynBranches.length > 0
                          ? dynBranches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                          : (
                            <>
                              <option value="online-egypt">{content['bundleDetails.form.branchOnline'] || 'أونلاين محلي'}</option>
                              <option value="online-saudi">{content['bundleDetails.form.branchSaudi'] || 'أونلاين سعودي'}</option>
                              <option value="online-abroad">{content['bundleDetails.form.branchAbroad'] || 'أونلاين دولي'}</option>
                              <option value="tagamoa">{content['bundleDetails.form.branchCairo'] || 'فرع التجمع'}</option>
                              <option value="daqqi">{content['bundleDetails.form.branchGiza'] || 'فرع الدقي'}</option>
                              <option value="other">أخرى</option>
                            </>
                          )
                        }
                      </select>
                    );
                  })()}
                </label>
                {bundleLeadNotice && <div role="status" className="rounded-xl bg-paper px-4 py-3 text-sm font-bold text-ink ring-1 ring-line">{bundleLeadNotice}</div>}
                <button type="submit" className="mt-2 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800">
                  <Send size={18} />
                  {content['bundleDetails.form.submit'] || 'تسجيل طلب الالتحاق'}
                </button>
              </form>
            </section>
          </div>

          {/* ── STICKY SIDEBAR ── */}
          <aside className="w-full lg:sticky lg:top-24">
            <div className="rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line">
              <h3 className="mb-4 text-center text-base font-black text-muted-strong">{content['bundleDetails.sidebar.title'] || 'استثمارك في هذا المسار'}</h3>
              <div className="mb-5 text-center">
                {priceAvailable ? (
                  <>
                    {oldPrice > currentPrice && (
                      <s className="mb-1 block text-sm text-muted-faint tabular-nums">{oldPrice.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</s>
                    )}
                    <div className="text-4xl font-black tabular-nums text-ink">{currentPrice.toLocaleString('ar-EG-u-nu-latn')}</div>
                    <div className="text-base font-bold text-primary-700">{currencySymbol}</div>
                    {Number(savePct) > 0 && (
                      <span className="mt-2 inline-block rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">توفر {savePct}%</span>
                    )}
                  </>
                ) : (
                  <p className="rounded-xl bg-paper px-3 py-2.5 font-bold text-muted-strong ring-1 ring-line">السعر غير متاح في دولتك حالياً</p>
                )}
              </div>

              {priceAvailable && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                    className="mb-2.5 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white transition hover:bg-primary-800"
                  >
                    {content['bundleDetails.sidebar.cta'] || 'احجز الآن'}
                    <ArrowLeft size={18} />
                  </button>
                  <Link
                    to={`/enroll?bundle=${bundle.id}`}
                    className="mb-2.5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-3 text-sm font-extrabold text-ink transition hover:border-ink/40"
                  >
                    <CreditCard size={17} /> ادفع أونلاين مباشرة (كاش أو قسط)
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={() => document.getElementById('register-form')?.scrollIntoView({ behavior: 'smooth' })}
                className="mb-5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-primary-700 ring-1 ring-line transition hover:bg-primary-50"
              >
                {content['bundleDetails.sidebar.ctaLead'] || 'سجل بياناتك للتواصل'}
              </button>

              <ul className="space-y-3 text-sm font-bold text-muted-strong">
                <li className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span><span>{bundle.courses.length} {content['bundleDetails.sidebar.featureCoursesSuffix'] || 'دبلومات كاملة'}</span></li>
                <li className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span><span>{content['bundleDetails.sidebar.featureCertificates'] || 'شهادات فردية + شهادة مجمعة'}</span></li>
                <li className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span><span>{content['bundleDetails.sidebar.featureSupervision'] || 'إشراف مهني لمدة 3 أشهر'}</span></li>
                <li className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={12} strokeWidth={3} /></span><span>{content['bundleDetails.sidebar.featureAccess'] || 'وصول لمدة سنتين للمحتوى'}</span></li>
              </ul>

              <div className="mt-5 border-t border-line pt-4">
                <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-muted-soft"><Shield size={13} className="mt-0.5 flex-none" />{content['bundleDetails.sidebar.guarantee'] || 'ضمان استرداد خلال 14 يوم — بشرط عدم مشاهدة أكثر من 20% من المحتوى'}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ──────────────── CERTIFICATE PREVIEW MODAL ──────────────── */}
      {certModalOpen && (
        <CourseCertificate
          studentName={content['bundleDetails.cert.sampleName'] || 'اسم الطالب'}
          studentNameEn={content['bundleDetails.cert.sampleNameEn'] || 'Student Name'}
          courseName={bundle.title}
          courseNameEn={bundle.titleEn}
          instructorName={content['bundleDetails.cert.instructorName'] || 'معهد الدراسات النفسية'}
          certNumber="SAMPLE-2025"
          issuedAt={new Date().toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
          onClose={() => setCertModalOpen(false)}
          sample
        />
      )}
    </div>
  );
};

export default BundleDetails;
