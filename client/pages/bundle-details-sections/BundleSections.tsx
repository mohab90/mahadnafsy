import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, Briefcase, Check, ChevronLeft, Clock, Layers, Phone, PiggyBank, Play, PlayCircle, Route, ShieldCheck, TrendingUp, Users, Wallet } from 'lucide-react';
import type { Bundle, Course, Currency } from '../../types';
import { cdnImg, cdnSrcSet } from '../../lib/img';
import { VideoSurface } from '../../components/VideoSurface';
import { youtubeEmbedUrl } from '../../lib/lectureVideo';
import { formatAmount, formatPrice, isDiscounted } from '../../../shared/priceFormat';
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel } from '../../../shared/enrollmentPricing';
import { SectionHead } from '../course-details-sections/PainPointsAndAboutSection';
import { scrollToLeadForm } from '../course-details-sections/CourseHeroSection';

type Content = Record<string, string>;

const plain = (raw: string) => String(raw || '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

/** One station of the path: the bundle's own entry, with the full course laid over it when the catalog has it. */
export type Station = Bundle['courses'][number] & { full?: Course };

export const bundleEnrollHref = (bundle: Bundle) => `/enroll?bundle=${encodeURIComponent(bundle.id)}`;

/** The first screen: the promise, the courses it is made of, the proof, the two ways in. */
export const BundleHero: React.FC<{
  bundle: Bundle;
  content: Content;
  stations: Station[];
  students: number;
  savePct: number;
  priceAvailable: boolean;
}> = ({ bundle, content, stations, students, savePct, priceAvailable }) => {
  const [playing, setPlaying] = React.useState(false);
  const video = bundle.videoUrl && bundle.videoUrl !== 'None' ? bundle.videoUrl : '';
  const videoId = video ? youtubeEmbedUrl(video).split('/embed/')[1]?.split('?')[0] : '';
  const blurb = plain(bundle.shortDescription || bundle.description || '');
  const tiles = stations.filter(s => s.thumbnail || s.full?.thumbnail).slice(0, 4);
  const stats = [
    { icon: Layers, value: String(stations.length), label: content['bundleDetails.hero.courseCount'] ? `${content['bundleDetails.hero.courseCount']} في المسار` : 'دبلومات في مسار واحد' },
    students > 0 && { icon: Users, value: `+${students.toLocaleString('ar-EG-u-nu-latn')}`, label: 'متدرب درسوا دبلوماته' },
    { icon: Award, value: `${stations.length + 1}`, label: 'شهادات (لكل دبلومة + المسار)' },
    savePct > 0 && { icon: PiggyBank, value: `${savePct}%`, label: 'توفير على السعر الرسمي' },
  ].filter(Boolean) as { icon: typeof Users; value: string; label: string }[];

  return (
    <section className="relative overflow-hidden bg-ink text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.45),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-56 -left-40 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.22),transparent)]" />
      <div className="container relative mx-auto px-4 pb-10 pt-6 sm:pb-14 sm:pt-8 lg:pb-16">
        <nav aria-label="مسار الصفحة" className="mb-6 flex flex-wrap items-center gap-1 text-[13px] font-bold text-white/55">
          <Link to="/" className="inline-flex min-h-[36px] items-center hover:text-white">الرئيسية</Link>
          <ChevronLeft size={14} />
          <Link to="/bundles" className="inline-flex min-h-[36px] items-center hover:text-white">المسارات</Link>
          <ChevronLeft size={14} />
          <span className="truncate text-white/80">{bundle.title}</span>
        </nav>

        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
          <div className="min-w-0 text-center lg:text-right">
            <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-light px-3 py-1 text-xs font-black text-ink"><Route size={14} />{content['bundleDetails.hero.badge'] || 'مسار تعليمي متكامل'}</span>
              {savePct > 0 && <span className="rounded-full bg-primary-600/25 px-3 py-1 text-xs font-extrabold text-primary-100 ring-1 ring-primary-400/40">وفّر {savePct}%</span>}
            </div>
            <h1 className="mt-4 text-balance text-[30px] font-black leading-[1.2] sm:text-5xl lg:text-[50px]">{bundle.title}</h1>
            {bundle.titleEn && <p className="mt-2 text-lg font-bold text-gold-pale" dir="ltr">{bundle.titleEn}</p>}
            {blurb && <p className="mx-auto mt-4 line-clamp-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg lg:mx-0">{blurb}</p>}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {priceAvailable && (
                <Link to={bundleEnrollHref(bundle)} className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-lg font-black text-white shadow-[0_20px_40px_-14px_rgba(225,29,72,.75)] transition hover:bg-primary-500">
                  {content['bundleDetails.hero.ctaPay'] || 'احجز مكانك في المسار'} <ArrowLeft size={20} />
                </Link>
              )}
              <button type="button" onClick={scrollToLeadForm} className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-white/10 px-7 text-base font-extrabold text-white ring-1 ring-white/25 transition hover:bg-white/15">
                <Phone size={18} /> {content['bundleDetails.hero.ctaLead'] || 'سجّل بياناتك ونكلمك'}
              </button>
            </div>

            <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] font-bold text-white/65 lg:justify-start">
              <li className="inline-flex items-center gap-1.5"><Award size={15} className="text-gold-light" />{content['bundleDetails.hero.certBadge'] || 'شهادة مجمعة معتمدة'}</li>
              <li className="inline-flex items-center gap-1.5"><BadgeCheck size={15} className="text-gold-light" />{content['bundleDetails.hero.support'] || 'إشراف مهني شامل'}</li>
              <li className="inline-flex items-center gap-1.5"><Wallet size={15} className="text-gold-light" />كاش أو تقسيط</li>
            </ul>
          </div>

          {/* The trailer when there is one; otherwise the programmes the path is made of. */}
          <div className="relative mx-auto w-full max-w-[640px]">
            <div aria-hidden="true" className="absolute -inset-3 rounded-[34px] bg-gradient-to-br from-primary-600/40 via-transparent to-gold/30 blur-2xl" />
            {video ? (
              <div className="relative aspect-video overflow-hidden rounded-[28px] bg-black ring-1 ring-white/15">
                {playing ? (
                  <VideoSurface url={video} title={bundle.title} autoplay />
                ) : (
                  <button type="button" onClick={() => setPlaying(true)} aria-label={content['bundleDetails.video.label'] || 'شاهد نبذة عن هذا المسار التدريبي'} className="group absolute inset-0 flex items-center justify-center">
                    {videoId && <img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt="" width={480} height={360} decoding="async" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover opacity-75" />}
                    <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary-600 text-white shadow-2xl ring-[10px] ring-white/20 transition group-hover:scale-110 motion-reduce:transform-none"><Play size={32} fill="currentColor" className="ml-1" /></span>
                    <span className="absolute inset-x-5 bottom-4 text-right text-lg font-black">{content['bundleDetails.video.label'] || 'شاهد نبذة عن هذا المسار التدريبي'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="relative grid aspect-[16/11] grid-cols-2 gap-2 overflow-hidden rounded-[28px] bg-white/5 p-2 ring-1 ring-white/15">
                {(tiles.length ? tiles : stations.slice(0, 4)).map((s, i) => {
                  const img = s.thumbnail || s.full?.thumbnail || '';
                  return (
                    <div key={s.id} className={`relative overflow-hidden rounded-[20px] bg-white/10 ${tiles.length === 3 && i === 0 ? 'row-span-2' : ''} ${tiles.length === 1 ? 'col-span-2 row-span-2' : ''}`}>
                      {img && <img src={cdnImg(img, 500)} srcSet={cdnSrcSet(img, [320, 500, 640])} sizes="(min-width: 1024px) 310px, 48vw" alt={s.title} width={500} height={340} decoding="async" fetchPriority={i < 2 ? 'high' : undefined} className="h-full w-full object-cover" />}
                      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                      <span className="absolute bottom-2 right-2 left-2 flex items-center gap-1.5 text-right text-[12px] font-extrabold leading-tight sm:text-sm">
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-light text-[11px] font-black text-ink">{i + 1}</span>
                        <span className="line-clamp-2">{s.title}</span>
                      </span>
                    </div>
                  );
                })}
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-ink/90 px-4 py-2 text-sm font-black text-gold-pale shadow-xl ring-1 ring-white/15 backdrop-blur">
                  {stations.length} دبلومات في مسار واحد
                </span>
              </div>
            )}
          </div>
        </div>

        <dl className={`mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[24px] bg-white/10 ring-1 ring-white/10 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-3 bg-ink/60 px-4 py-4 sm:px-6 sm:py-5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-white/10 text-gold-light"><s.icon size={22} /></span>
              <div className="min-w-0">
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-xl font-black leading-tight tabular-nums sm:text-2xl">{s.value}</dd>
                <dd className="text-xs font-bold leading-snug text-white/60 sm:text-sm">{s.label}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};

/** «خريطة المسار» — each programme as a station, ending at the path's own certificate. */
export const PathMap: React.FC<{ content: Content; stations: Station[]; currency: Currency; onPreviewCertificate: () => void }> = ({ content, stations, currency, onPreviewCertificate }) => (
  <section id="path" className="scroll-mt-32">
    <SectionHead
      kicker="المحطات"
      title={content['bundleDetails.path.title'] || 'خريطة المسار التعليمي'}
      subtitle={content['bundleDetails.path.subtitle'] || 'ترتيب مدروس: كل دبلومة بتبني على اللي قبلها، لحد ما توصل لمرحلة الممارسة.'}
    />
    <ol>
      {stations.map((s, idx) => {
        const img = s.thumbnail || s.full?.thumbnail || '';
        const desc = plain(s.shortDescription || s.full?.shortDescription || '');
        const worth = Number(s.full?.price?.[currency]) || 0;
        const students = Number(s.full?.students) || 0;
        const duration = s.duration || s.full?.duration || '';
        return (
          <li key={s.id} className="flex gap-3 sm:gap-4">
            <div className="flex flex-none flex-col items-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-base font-black text-gold-pale shadow-lg">{idx + 1}</span>
              <span aria-hidden="true" className="my-1.5 w-0.5 flex-1 bg-gradient-to-b from-line-deep to-line" />
            </div>
            <div className="min-w-0 flex-1 pb-5">
              <Link to={`/c/${s.slug || s.id}`} className="group flex flex-col overflow-hidden rounded-[22px] border border-line bg-white transition hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-28px_rgba(26,15,18,.4)] sm:flex-row">
                {img && (
                  <span className="relative aspect-[16/9] flex-none overflow-hidden bg-sand sm:aspect-auto sm:w-48">
                    <img loading="lazy" decoding="async" src={cdnImg(img, 400)} srcSet={cdnSrcSet(img, [240, 400])} sizes="(min-width: 640px) 192px, 90vw" width={400} height={240} alt={s.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  </span>
                )}
                <span className="block min-w-0 flex-1 p-4 sm:p-5">
                  <span className="block text-xs font-extrabold text-gold-deep">{content['bundleDetails.path.stationPrefix'] || 'المحطة'} {idx + 1}</span>
                  <span className="mt-0.5 block text-lg font-black leading-snug text-ink transition group-hover:text-primary-700">{s.title}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {duration && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-extrabold text-muted-strong ring-1 ring-line"><Clock size={12} />{duration}</span>}
                    {students > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-extrabold text-muted-strong ring-1 ring-line"><Users size={12} />{students.toLocaleString('ar-EG-u-nu-latn')} متدرب</span>}
                    {s.instructor && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-extrabold text-muted-strong ring-1 ring-line"><BadgeCheck size={12} />{s.instructor}</span>}
                    {worth > 0 && <span className="rounded-full bg-green-50 px-2.5 py-1 font-extrabold text-green-700 ring-1 ring-green-200">لوحدها بـ {formatPrice(worth, currency)}</span>}
                  </span>
                  {desc && <span className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-muted-body">{desc}</span>}
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-extrabold text-primary-700">تفاصيل الدبلومة <ArrowLeft size={15} /></span>
                </span>
              </Link>
            </div>
          </li>
        );
      })}
      <li className="flex gap-3 sm:gap-4">
        <div className="flex flex-none flex-col items-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-light text-ink shadow-lg"><Award size={20} /></span>
        </div>
        <div className="min-w-0 flex-1 rounded-[22px] bg-ink p-5 text-white sm:p-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <h3 className="mb-2 text-xl font-black text-gold-light">{content['bundleDetails.path.finalTitle'] || 'إتمام المسار والاعتماد'}</h3>
              <p className="max-w-lg text-sm leading-relaxed text-white/70">{content['bundleDetails.path.finalDesc'] || 'بعد إجتياز جميع الدبلومات والاختبارات، تحصل على شهادة المسار المجمعة وتصبح مؤهلاً للعمل في مجالك.'}</p>
            </div>
            <button type="button" onClick={onPreviewCertificate} className="inline-flex min-h-[48px] flex-none items-center gap-2 rounded-2xl bg-gold-light px-5 text-sm font-black text-ink transition hover:brightness-105">
              <Award size={16} />{content['bundleDetails.cert.previewBtn'] || 'معاينة الشهادة'}
            </button>
          </div>
        </div>
      </li>
    </ol>
  </section>
);

/** «ليه المسار؟» — what it saves against buying the courses one by one, and where it takes you. */
export const WhyPathSection: React.FC<{ content: Content; separateTotal: number; pathPrice: number; currencySymbol: string; count: number }> = ({ content, separateTotal, pathPrice, currencySymbol, count }) => {
  const saving = separateTotal > pathPrice && pathPrice > 0 ? separateTotal - pathPrice : 0;
  const list = (items: string[], dark?: boolean) => (
    <ul className="space-y-2.5 text-[15px]">
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-2.5 ${dark ? 'text-white/85' : 'text-muted-body'}`}>
          <span className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${dark ? 'bg-gold-light text-ink' : 'bg-green-50 text-green-700'}`}><Check size={13} strokeWidth={3} /></span>
          {item}
        </li>
      ))}
    </ul>
  );
  return (
    <section id="why" className="scroll-mt-32">
      <SectionHead kicker="ليه المسار؟" title={content['bundleDetails.why.title'] || 'ليه المسار أقوى من دبلومة لوحدها؟'} />
      {saving > 0 && (
        <div className="mb-5 grid overflow-hidden rounded-[26px] border border-line bg-white sm:grid-cols-3">
          <div className="p-5 text-center sm:p-6">
            <p className="text-sm font-extrabold text-muted">لو اشتريت الـ {count} دبلومات لوحدهم</p>
            <s className="mt-1 block text-2xl font-black tabular-nums text-muted-faint">{formatAmount(separateTotal)} {currencySymbol}</s>
          </div>
          <div className="border-y border-line bg-paper p-5 text-center sm:border-x sm:border-y-0 sm:p-6">
            <p className="text-sm font-extrabold text-muted">في المسار</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-ink">{formatAmount(pathPrice)} {currencySymbol}</p>
          </div>
          <div className="bg-green-600 p-5 text-center text-white sm:p-6">
            <p className="text-sm font-extrabold text-white/85">هتوفّر</p>
            <p className="mt-1 text-2xl font-black tabular-nums">{formatAmount(saving)} {currencySymbol}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[24px] bg-ink p-5 text-white sm:p-6">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-gold-light"><Briefcase size={24} /></span>
          <h3 className="mb-3 text-lg font-black text-gold-light">{content['bundleDetails.why.jobsTitle'] || 'فرص العمل'}</h3>
          {list([
            content['bundleDetails.why.jobs1'] || 'العمل في العيادات والمراكز النفسية.',
            content['bundleDetails.why.jobs2'] || 'العمل الحر كمستقل وخبير أونلاين.',
            content['bundleDetails.why.jobs3'] || 'العمل في المدارس والمؤسسات التعليمية.',
          ], true)}
        </div>
        <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700"><TrendingUp size={24} /></span>
          <h3 className="mb-3 text-lg font-black text-ink">{content['bundleDetails.why.skillsTitle'] || 'المهارات المكتسبة'}</h3>
          {list([
            content['bundleDetails.why.skills1'] || 'التشخيص وصياغة الحالة بدقة.',
            content['bundleDetails.why.skills2'] || 'تطبيق خطط العلاج النفسي الحديثة.',
            content['bundleDetails.why.skills3'] || 'مهارات المقابلة العيادية وإدارة الجلسة.',
          ])}
        </div>
      </div>
    </section>
  );
};

/** «كل ده في المسار» — everything in the price, cash and instalments, and the guarantee. */
export const BundleValueSection: React.FC<{
  bundle: Bundle;
  content: Content;
  count: number;
  currentPrice: number;
  oldPrice: number;
  currencySymbol: string;
  priceAvailable: boolean;
}> = ({ bundle, content, count, currentPrice, oldPrice, currencySymbol, priceAvailable }) => {
  const rates = enrollmentRates(content);
  const items = [
    { icon: PlayCircle, text: `${count} ${content['bundleDetails.sidebar.featureCoursesSuffix'] || 'دبلومات كاملة'}` },
    { icon: Award, text: content['bundleDetails.sidebar.featureCertificates'] || 'شهادات فردية + شهادة مجمعة' },
    { icon: BadgeCheck, text: content['bundleDetails.sidebar.featureSupervision'] || 'إشراف مهني لمدة 3 أشهر' },
    { icon: Clock, text: content['bundleDetails.sidebar.featureAccess'] || 'وصول لمدة سنتين للمحتوى' },
    { icon: Route, text: 'ترتيب دراسة مدروس من الأساس للممارسة' },
    { icon: ShieldCheck, text: 'دعم ومتابعة طول المسار' },
  ];
  return (
    <section id="pricing" className="scroll-mt-32 overflow-hidden rounded-[30px] border-2 border-primary-700/15 bg-white">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <div className="p-5 sm:p-8">
          <SectionHead kicker="العرض" title={content['bundleDetails.value.title'] || 'كل ده هتاخده في المسار'} />
          <ul className="space-y-3">
            {items.map(i => (
              <li key={i.text} className="flex items-center gap-3 text-[15px] font-bold text-ink">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-green-50 text-green-700"><i.icon size={18} /></span>
                {i.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-center bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 p-5 text-center text-white sm:p-8">
          {priceAvailable ? (
            <>
              {isDiscounted(oldPrice, currentPrice) && <s className="text-base tabular-nums text-white/55">بدل {formatAmount(oldPrice)} {currencySymbol}</s>}
              <p className="text-[52px] font-black leading-none tabular-nums">{formatAmount(currentPrice)} <span className="text-2xl text-gold-pale">{currencySymbol}</span></p>
              <div className="mx-auto mt-4 w-full max-w-xs space-y-1.5 rounded-2xl bg-white/10 p-3 text-sm font-bold ring-1 ring-white/15">
                <p className="flex justify-between gap-2"><span>كاش (خصم {percentLabel(rates.cash)}%)</span><b className="tabular-nums">{formatAmount(amountDueNow(currentPrice, 'cash', rates))} {currencySymbol}</b></p>
                <p className="flex justify-between gap-2"><span>تقسيط (إجمالي)</span><b className="tabular-nums">{formatAmount(installmentTotal(currentPrice, rates))} {currencySymbol}</b></p>
                <p className="flex justify-between gap-2 text-gold-pale"><span>تبدأ بأول دفعة</span><b className="tabular-nums">{formatAmount(amountDueNow(currentPrice, 'installment', rates))} {currencySymbol}</b></p>
              </div>
              <div className="mt-5 space-y-2.5">
                <Link to={bundleEnrollHref(bundle)} className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-white px-5 text-lg font-black text-primary-800 shadow-xl transition hover:bg-paper">
                  احجز مكانك في المسار <ArrowLeft size={20} />
                </Link>
                <button type="button" onClick={scrollToLeadForm} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-5 font-extrabold text-white ring-1 ring-white/30 transition hover:bg-white/10">
                  <Phone size={17} /> عايز أسأل الأول
                </button>
              </div>
            </>
          ) : (
            <p className="text-lg font-black">السعر غير متاح في دولتك حالياً — سجّل بياناتك ونجهزلك العرض</p>
          )}
          <p className="mt-5 flex items-start justify-center gap-2 text-xs leading-relaxed text-white/75">
            <ShieldCheck size={16} className="mt-0.5 flex-none text-gold-pale" />
            {content['bundleDetails.sidebar.guarantee'] || 'ضمان استرداد خلال 14 يوم — بشرط عدم مشاهدة أكثر من 20% من المحتوى'}
          </p>
        </div>
      </div>
    </section>
  );
};

/** Other paths, after the closing call. */
export const OtherBundles: React.FC<{ bundles: Bundle[]; currentId: string; currency: Currency }> = ({ bundles, currentId, currency }) => {
  const list = bundles.filter(b => b.id !== currentId && Number(b.price?.[currency]) > 0).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <section className="bg-paper py-14 sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <SectionHead kicker="مسارات تانية" title="ممكن يعجبك كمان" />
          <Link to="/bundles" className="mb-7 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-primary-700 hover:text-primary-800">كل المسارات <ArrowLeft size={16} /></Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(b => (
            <Link key={b.id} to={`/bundle/${b.slug || b.id}`} className="group flex flex-col rounded-[24px] border border-line bg-white p-5 transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-extrabold text-gold-pale"><Layers size={13} />{b.courses.length} دبلومات</span>
              <h3 className="mt-3 text-lg font-black leading-snug text-ink group-hover:text-primary-700">{b.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{plain(b.shortDescription || '')}</p>
              <span className="mt-auto flex items-end justify-between gap-3 pt-5">
                <span>
                  {isDiscounted(b.originalPrice?.[currency], b.price?.[currency]) && <s className="block text-sm tabular-nums text-muted-faint">{formatPrice(b.originalPrice[currency], currency)}</s>}
                  <b className="text-2xl font-black tabular-nums text-ink">{formatPrice(b.price[currency], currency)}</b>
                </span>
                <span className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-primary-700 px-3.5 text-sm font-extrabold text-white">التفاصيل <ArrowLeft size={16} /></span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};
