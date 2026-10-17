import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, CalendarClock, Check, ChevronLeft, Clock, CreditCard, MessageCircle, Phone, PlayCircle, QrCode, Share2, ShieldCheck, Star, Users, Wallet } from 'lucide-react';
import type { Course } from '../../types';
import { cdnImg, cdnSrcSet } from '../../lib/img';
import { instituteWhatsApp } from '../../lib/whatsappLink';
import { discountPercent, formatAmount, isDiscounted, toAmount } from '../../../shared/priceFormat';
import { amountDueNow, enrollmentRates, percentLabel } from '../../../shared/enrollmentPricing';
import { CAIRO_TIME_ZONE } from '../../../shared/cairoDate';

const plain = (html: string) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const scrollToLeadForm = () => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

interface CourseHeroSectionProps {
  course: Course;
  content: Record<string, string>;
  lectureCount: number;
  promoVideoUrl: string;
  onPlayPromo: () => void;
  isSubscribed: boolean;
  /** The course's real ratings, when it has any. */
  rating?: { avg: number; count: number } | null;
}

/**
 * The first screen of a course: what it is, the promise, the proof, and the
 * two ways forward — book, or leave a number. The video sits beside it, because
 * two minutes of the instructor sell the course better than any paragraph.
 */
export const CourseHeroSection: React.FC<CourseHeroSectionProps> = ({
  course,
  content,
  lectureCount,
  promoVideoUrl,
  onPlayPromo,
  isSubscribed,
  rating,
}) => {
  const students = Math.max(0, Number(course.students) || 0);
  const blurb = plain(course.shortDescription);
  const typeText = course.type === 'Mix' ? (content['courseDetails.type.mix'] || 'نظام هجين (مسجل + لايف)') : course.type === 'Live' ? (content['courseDetails.type.live'] || 'بث مباشر تفاعلي') : (content['courseDetails.type.recorded'] || 'مسجل بجودة عالية');
  const stats = [
    students > 0 && { icon: Users, value: `+${students.toLocaleString('ar-EG-u-nu-latn')}`, label: content['courseDetails.studentsSuffix'] || 'متدرب اشترك' },
    rating && rating.count > 0 && { icon: Star, value: rating.avg.toFixed(1), label: `تقييم (${rating.count})` },
    // The duration the desk wrote («14 محاضرة») reads truer than the count of video parts.
    (course.duration || lectureCount > 0) && { icon: PlayCircle, value: course.duration || String(lectureCount), label: course.duration ? 'مدة البرنامج' : 'فيديو' },
    { icon: QrCode, value: 'QR', label: 'شهادة بكود تحقق' },
  ].filter(Boolean) as { icon: typeof Users; value: string; label: string }[];

  return (
    <section className="relative overflow-hidden bg-ink text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.45),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-56 -left-40 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.22),transparent)]" />

      <div className="container relative mx-auto px-4 pb-10 pt-6 sm:pb-14 sm:pt-8 lg:pb-16">
        <nav aria-label="مسار الصفحة" className="mb-6 flex flex-wrap items-center gap-1 text-[13px] font-bold text-white/55">
          <Link to="/" className="hover:text-white">الرئيسية</Link>
          <ChevronLeft size={14} />
          <Link to="/courses" className="hover:text-white">الدبلومات</Link>
          <ChevronLeft size={14} />
          <span className="truncate text-white/80">{course.title}</span>
        </nav>

        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
          <div className="min-w-0 text-center lg:text-right">
            <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-600/25 px-3 py-1 text-xs font-extrabold text-primary-100 ring-1 ring-primary-400/40">
                <span className="h-2 w-2 rounded-full bg-green-400 motion-safe:animate-pulse" />
                {content['courseDetails.hero.badge'] || 'التسجيل مفتوح للدفعة الجديدة'}
              </span>
              {course.level && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-extrabold text-gold-pale ring-1 ring-white/15">{course.level}</span>}
            </div>

            <h1 className="mt-4 text-balance text-[32px] font-black leading-[1.15] sm:text-5xl lg:text-[54px]">{course.title}</h1>
            {blurb && <p className="mx-auto mt-4 line-clamp-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg lg:mx-0">{blurb}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-bold text-white/80 lg:justify-start">
              <span className="inline-flex items-center gap-1.5"><BadgeCheck size={17} className="text-gold-light" />{course.instructor}</span>
              <span className="inline-flex items-center gap-1.5"><PlayCircle size={17} className="text-gold-light" />{typeText}</span>
              {course.duration && <span className="inline-flex items-center gap-1.5"><Clock size={17} className="text-gold-light" />{course.duration}</span>}
            </div>

            {!isSubscribed && (
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link
                  to={`/enroll?course=${encodeURIComponent(course.id)}`}
                  className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-lg font-black text-white shadow-[0_20px_40px_-14px_rgba(225,29,72,.75)] transition hover:bg-primary-500"
                >
                  {content['courseDetails.hero.primaryCta'] || 'احجز مكانك الآن'} <ArrowLeft size={20} />
                </Link>
                <button
                  type="button"
                  onClick={scrollToLeadForm}
                  className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-white/10 px-7 text-base font-extrabold text-white ring-1 ring-white/25 transition hover:bg-white/15"
                >
                  <Phone size={18} /> {content['courseDetails.hero.secondaryCta'] || 'سجّل بياناتك ونكلمك'}
                </button>
              </div>
            )}

            <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] font-bold text-white/65 lg:justify-start">
              <li className="inline-flex items-center gap-1.5"><Award size={15} className="text-gold-light" />{content['courseDetails.certificateBadge'] || 'شهادة معتمدة'}</li>
              <li className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-gold-light" />ضمان استرداد 14 يوم</li>
              <li className="inline-flex items-center gap-1.5"><Wallet size={15} className="text-gold-light" />كاش أو تقسيط</li>
            </ul>
          </div>

          {/* The promo video: the thumbnail until it is asked for, so the page stays light. */}
          <div className="relative mx-auto w-full max-w-[640px]">
            <div aria-hidden="true" className="absolute -inset-3 rounded-[34px] bg-gradient-to-br from-primary-600/40 via-transparent to-gold/30 blur-2xl" />
            <button
              type="button"
              onClick={() => promoVideoUrl && onPlayPromo()}
              disabled={!promoVideoUrl}
              aria-label={promoVideoUrl ? 'شغّل الفيديو التعريفي' : course.title}
              className="group relative block aspect-video w-full overflow-hidden rounded-[28px] bg-black/40 ring-1 ring-white/15 disabled:cursor-default"
            >
              {course.thumbnail && (
                <img
                  fetchPriority="high"
                  decoding="async"
                  src={cdnImg(course.thumbnail, 800)}
                  srcSet={cdnSrcSet(course.thumbnail, [400, 640, 800, 1000])}
                  sizes="(min-width: 1024px) 620px, 100vw"
                  width={800}
                  height={450}
                  alt={course.title}
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                />
              )}
              {promoVideoUrl && (
                <>
                  <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                  <span className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary-600 text-white shadow-[0_18px_40px_-10px_rgba(225,29,72,.9)] ring-[10px] ring-white/20 transition duration-300 group-hover:scale-110 motion-reduce:transform-none">
                    <PlayCircle size={40} strokeWidth={1.75} />
                  </span>
                  <span className="absolute inset-x-4 bottom-4 text-right sm:inset-x-6 sm:bottom-5">
                    <b className="block text-lg font-black sm:text-xl">{content['courseDetails.promo.title'] || 'شاهد مقدمة تعريفية'}</b>
                    <span className="text-sm text-white/75">{content['courseDetails.promo.subtitle'] || 'تعرف على محتويات الدبلومة في دقيقتين'}</span>
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* The proof, in numbers. */}
        <dl className={`mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[24px] bg-white/10 ring-1 ring-white/10 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-3 bg-ink/60 px-4 py-4 sm:px-6 sm:py-5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-white/10 text-gold-light"><s.icon size={22} /></span>
              <div className="min-w-0">
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-xl font-black leading-tight tabular-nums sm:text-2xl">{s.value}</dd>
                <dd className="truncate text-xs font-bold text-white/60 sm:text-sm">{s.label}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};

interface CourseBookingCardProps {
  /** A course, or a path (bundle): anything with an id, a title and a blurb. */
  course: { id: string; title: string; shortDescription?: string };
  content: Record<string, string>;
  /** Where «احجز مكانك» goes; a course's enrol link unless given. */
  enrollHref?: string;
  /** The three ticks under the buttons; the course page's own unless given. */
  features?: string[];
  /** A line under the price (the path page: what it saves against buying the courses one by one). */
  extra?: React.ReactNode;
  currentPrice: number;
  oldPrice: number;
  discountedPrice: number | null;
  currencySymbol: string;
  applicableDiscount?: { discountPercent: number; label?: string; expiresAt?: string };
  isSubscribed: boolean;
  onBuyNow: () => void;
  onPreviewCertificate: () => void;
}

/**
 * The booking card: the price against the official one, what cash and
 * instalments cost today (the rates marketing sets, the same ones /enroll
 * charges), the two buttons, and the reasons not to wait. It follows the reader
 * down the page on a computer.
 */
export const CourseBookingCard: React.FC<CourseBookingCardProps> = ({
  course,
  content,
  enrollHref,
  features,
  extra,
  currentPrice,
  oldPrice,
  discountedPrice,
  currencySymbol,
  applicableDiscount,
  isSubscribed,
  onBuyNow,
  onPreviewCertificate,
}) => {
  const bookHref = enrollHref || `/enroll?course=${encodeURIComponent(course.id)}`;
  // Strike only a price the customer is actually saving against, and badge a
  // discount only when one exists. Rendered unconditionally, this struck out
  // «السعر الرسمي: 0» above the real price and stamped «خصم لفترة محدودة» on
  // courses that were never discounted.
  const strikePrice = discountedPrice !== null ? currentPrice : oldPrice;
  const payPrice = discountedPrice !== null ? discountedPrice : currentPrice;
  // The share button rendered but did nothing on every course page. The native
  // sheet is the right thing on the phones most of this traffic comes from;
  // desktop browsers without it fall back to the clipboard, and a browser that
  // blocks that too still gets a visible URL to copy by hand.
  const [shareState, setShareState] = React.useState<'idle' | 'copied'>('idle');
  const shareCourse = async () => {
    const url = window.location.href;
    const shareData = { title: course.title, text: plain(course.shortDescription || '') || course.title, url };
    if (navigator.share) {
      // A user who dismisses the sheet raises AbortError — not a failure.
      try { await navigator.share(shareData); return; } catch { return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareState('copied');
      window.setTimeout(() => setShareState('idle'), 2000);
    } catch {
      window.prompt('انسخ رابط الدورة', url);
    }
  };

  const priced = currentPrice > 0;
  const onSale = priced && isDiscounted(strikePrice, payPrice);
  const off = onSale ? discountPercent(strikePrice, payPrice) : 0;
  const saving = onSale ? toAmount(strikePrice) - toAmount(payPrice) : 0;
  const rates = enrollmentRates(content);
  const cashToday = amountDueNow(toAmount(currentPrice), 'cash', rates);
  const firstInstalment = amountDueNow(toAmount(currentPrice), 'installment', rates);
  const until = applicableDiscount?.expiresAt
    ? new Date(`${String(applicableDiscount.expiresAt).slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', timeZone: CAIRO_TIME_ZONE })
    : '';

  return (
    <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-[0_40px_80px_-45px_rgba(26,15,18,.55)]">
      {onSale && (
        <div className="flex items-center justify-between gap-2 bg-primary-700 px-5 py-2.5 text-sm font-black text-white">
          <span>{applicableDiscount ? `خصم ${applicableDiscount.discountPercent}%${applicableDiscount.label ? ` — ${applicableDiscount.label}` : ''}` : (content['courseDetails.price.discountBadge'] || 'خصم لفترة محدودة')}</span>
          {until ? <span className="inline-flex items-center gap-1 text-white/85"><CalendarClock size={15} />لحد {until}</span> : <span className="rounded-full bg-white/15 px-2 py-0.5">وفّر {off}%</span>}
        </div>
      )}
      <div className="p-5 sm:p-6">
        {priced ? (
          <div className="text-center lg:text-right">
            {isDiscounted(strikePrice, payPrice) && (
              <s className="block text-sm tabular-nums text-muted-faint">{content['courseDetails.price.originalLabel'] || 'السعر الرسمي:'} {formatAmount(strikePrice)} {currencySymbol}</s>
            )}
            <div className="mt-1 flex flex-wrap items-end justify-center gap-x-3 gap-y-1 lg:justify-start">
              <span className="text-[44px] font-black leading-none tabular-nums text-ink">{formatAmount(payPrice)} <span className="text-xl text-primary-700">{currencySymbol}</span></span>
              {saving > 0 && <span className="pb-1.5 text-sm font-extrabold text-green-700">هتوفّر {formatAmount(saving)} {currencySymbol}</span>}
            </div>
          </div>
        ) : (
          <p className="text-center font-bold text-gold-deep">السعر غير متاح في دولتك حاليًا</p>
        )}
        {priced && extra}

        {priced && !isSubscribed && (
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-paper px-2 py-3 ring-1 ring-line">
              <p className="text-[12px] font-extrabold text-muted">كاش (خصم {percentLabel(rates.cash)}%)</p>
              <p className="mt-0.5 text-lg font-black tabular-nums text-ink">{formatAmount(cashToday)} <span className="text-xs text-muted">{currencySymbol}</span></p>
            </div>
            <div className="rounded-2xl bg-paper px-2 py-3 ring-1 ring-line">
              <p className="text-[12px] font-extrabold text-muted">تقسيط — أول دفعة</p>
              <p className="mt-0.5 text-lg font-black tabular-nums text-ink">{formatAmount(firstInstalment)} <span className="text-xs text-muted">{currencySymbol}</span></p>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          {isSubscribed ? (
            <div className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-green-500 bg-green-50 text-lg font-black text-green-700">
              <Check size={22} className="text-green-600" />
              أنت مشترك في هذا الكورس
            </div>
          ) : priced ? (
            <Link
              to={bookHref}
              className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-5 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800"
            >
              احجز مكانك الآن <ArrowLeft size={20} />
            </Link>
          ) : (
            <div className="w-full rounded-2xl bg-paper px-4 py-3 text-center font-bold text-gold-deep ring-1 ring-line">
              تواصل معنا لتجهيز سعر دولتك
            </div>
          )}
          {!isSubscribed && (
            <button
              type="button"
              onClick={scrollToLeadForm}
              className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-5 font-extrabold text-ink transition hover:border-ink/40"
            >
              <Phone size={18} />
              سجّل بياناتك ومستشار يكلمك
            </button>
          )}
          {priced && !isSubscribed && (
            <button type="button" onClick={onBuyNow} className="flex min-h-[44px] w-full items-center justify-center gap-1.5 text-sm font-extrabold text-primary-700 transition hover:text-primary-800">
              <CreditCard size={16} /> {content['courseDetails.price.cta'] || 'أو ادفع أونلاين مباشرة'}
            </button>
          )}
        </div>

        <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-sm font-bold text-muted-strong">
          {(features || [
            content['courseDetails.price.feature1'] || 'وصول لمدة سنة واحدة للمحتوى',
            content['courseDetails.price.feature2'] || 'شهادة إتمام موثقة برقم تسلسلي',
            content['courseDetails.price.feature3'] || 'المادة العلمية + نماذج العمل',
          ]).map((text, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-green-50 text-green-700"><Check size={14} strokeWidth={3} /></span>
              {text}
            </li>
          ))}
        </ul>

        {/* "شهادة إتمام موثقة" is listed just above. Being able to look at it is
            what makes that a claim rather than a line of copy. */}
        <button
          type="button"
          onClick={onPreviewCertificate}
          className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-paper px-5 text-sm font-extrabold text-ink ring-1 ring-line transition hover:ring-ink/30"
        >
          <Award size={17} className="text-gold-deep" />
          {content['courseDetails.cert.previewBtn'] || 'معاينة الشهادة'}
        </button>

        <div className="mt-4 space-y-2">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-strong">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-green-600" />
            <span>{content['courseDetails.guaranteeText'] || 'ضمان استرداد خلال 14 يوم — بشرط عدم مشاهدة أكثر من 20% من المحتوى.'}</span>
          </p>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-strong">
            <Clock size={15} className="mt-0.5 shrink-0 text-gold-deep" />
            <span>{content['courseDetails.seatsNote'] || 'المقاعد محدودة لكل دفعة لضمان جودة المتابعة — احجز مكانك مبكراً.'}</span>
          </p>
        </div>

        <div className="mt-4 flex justify-center gap-2 border-t border-line pt-3">
          <button type="button" onClick={shareCourse}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${shareState === 'copied' ? 'text-green-600' : 'text-muted hover:text-primary-700'}`}>
            <Share2 size={16} /> {shareState === 'copied' ? 'تم نسخ الرابط' : (content['courseDetails.actions.share'] || 'مشاركة')}
          </button>
          <a href={`https://wa.me/${instituteWhatsApp(content)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-muted transition hover:text-green-600">
            <MessageCircle size={16} /> {content['courseDetails.actions.whatsapp'] || 'استفسار واتساب'}
          </a>
        </div>
      </div>
    </div>
  );
};
