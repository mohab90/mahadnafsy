import React from 'react';
import { ArrowLeft, Check, PlayCircle, Award, Users, Send, Share2, MessageCircle, ShieldCheck, Clock, CreditCard, QrCode, Star, Wallet } from 'lucide-react';
import type { Course } from '../../types';
import { SafeHtml } from '../../../shared/ui/SafeHtml';
import { cdnImg, cdnSrcSet } from '../../lib/img';
import { instituteWhatsApp } from '../../lib/whatsappLink';
import { discountPercent, formatAmount, isDiscounted, toAmount } from '../../../shared/priceFormat';

interface CourseHeroSectionProps {
  course: Course;
  content: Record<string, string>;
  currentPrice: number;
  oldPrice: number;
  discountedPrice: number | null;
  currencySymbol: string;
  applicableDiscount: { discountPercent: number; label?: string } | undefined;
  isSubscribed: boolean;
  onBuyNow: () => void;
  onPreviewCertificate: () => void;
  /** The course's real ratings, when it has any. */
  rating?: { avg: number; count: number } | null;
}

export const CourseHeroSection: React.FC<CourseHeroSectionProps> = ({
  course,
  content,
  currentPrice,
  oldPrice,
  discountedPrice,
  currencySymbol,
  applicableDiscount,
  isSubscribed,
  onBuyNow,
  onPreviewCertificate,
  rating,
}) => {
  // The share button rendered but did nothing on every course page. The native
  // sheet is the right thing on the phones most of this traffic comes from;
  // desktop browsers without it fall back to the clipboard, and a browser that
  // blocks that too still gets a visible URL to copy by hand.
  // Strike only a price the customer is actually saving against, and badge a
  // discount only when one exists. Rendered unconditionally, this struck out
  // «السعر الرسمي: 0» above the real price and stamped «خصم لفترة محدودة» on
  // courses that were never discounted.
  const strikePrice = discountedPrice !== null ? currentPrice : oldPrice;
  const payPrice = discountedPrice !== null ? discountedPrice : currentPrice;
  const [shareState, setShareState] = React.useState<'idle' | 'copied'>('idle');
  const shareCourse = async () => {
    const url = window.location.href;
    const shareData = { title: course.title, text: course.shortDescription || course.title, url };
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
  const students = Math.max(0, Number(course.students) || 0);
  const typeText = course.type === 'Mix' ? (content['courseDetails.type.mix'] || 'نظام هجين (مسجل + لايف)') : course.type === 'Live' ? (content['courseDetails.type.live'] || 'بث مباشر تفاعلي') : (content['courseDetails.type.recorded'] || 'مسجل بجودة عالية');
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-muted-strong ring-1 ring-line';

  return (
    <section className="relative overflow-hidden border-b border-line bg-paper">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.12),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.14),transparent)]" />

      <div className="container relative mx-auto px-4 py-8 sm:py-12 lg:py-14">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr] lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_440px]">
          {/* The picture — first on a phone, beside the title on a computer. */}
          <div className="lg:col-start-2 lg:row-start-1">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[28px] bg-sand shadow-[0_40px_80px_-45px_rgba(26,15,18,.55)] ring-1 ring-line">
              {course.thumbnail && (
                <img
                  fetchPriority="high"
                  decoding="async"
                  src={cdnImg(course.thumbnail, 800)}
                  srcSet={cdnSrcSet(course.thumbnail, [400, 640, 800, 1000])}
                  sizes="(min-width: 1280px) 440px, (min-width: 1024px) 400px, 100vw"
                  width={800}
                  height={500}
                  alt={course.title}
                  className="h-full w-full object-cover"
                />
              )}
              {off > 0 && <span className="absolute left-3 top-3 rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">وفّر {off}%</span>}
            </div>
          </div>

          {/* Title, what it is, who took it */}
          <div className="min-w-0 text-center lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:pt-2 lg:text-right">
            <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
              {course.level && <span className="rounded-full bg-ink px-3 py-1 text-xs font-extrabold text-gold-pale">{course.level}</span>}
              <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{course.category === 'Therapy' ? (content['courseDetails.category.therapy'] || 'علاج نفسي') : (content['courseDetails.category.general'] || 'صحة نفسية')}</span>
            </div>
            <h1 className="mt-4 text-balance text-3xl font-black leading-tight text-ink sm:text-4xl lg:text-[44px]">{course.title}</h1>
            <SafeHtml
              html={course.shortDescription || ''}
              className="mx-auto mt-4 max-w-2xl break-words text-base leading-relaxed text-muted-body sm:text-lg lg:mx-0"
            />

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[14px] font-bold text-muted-strong lg:justify-start">
              {rating && rating.count > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Star size={16} className="text-gold" fill="currentColor" />
                  <b className="font-black tabular-nums text-ink">{rating.avg.toFixed(1)}</b>
                  <span className="text-muted">({rating.count} تقييم)</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5"><Users size={16} className="text-primary-700" />{students.toLocaleString('ar-EG-u-nu-latn')} {content['courseDetails.studentsSuffix'] || 'طالب مشترك'}</span>
              {course.duration && <span className="inline-flex items-center gap-1.5"><Clock size={16} className="text-primary-700" />{course.duration}</span>}
              <span className="inline-flex items-center gap-1.5"><PlayCircle size={16} className="text-primary-700" />{typeText}</span>
            </div>

            {/* Trust chips: each one is said elsewhere on this page — the FAQ
                promises the verification code, the enrol link the two ways to pay. */}
            <div className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
              <span className={chip}><Award size={14} className="text-gold-deep" />{content['courseDetails.certificateBadge'] || 'شهادة معتمدة'}</span>
              <span className={chip}><QrCode size={14} className="text-gold-deep" />شهادة بكود تحقق</span>
              {!isSubscribed && priced && <span className={chip}><Wallet size={14} className="text-gold-deep" />كاش أو تقسيط</span>}
            </div>

            <div className="mx-auto mt-7 flex w-fit max-w-full items-center gap-3 rounded-2xl bg-white p-3 pl-5 text-right ring-1 ring-line lg:mx-0">
              <img loading="lazy" decoding="async" src={`https://ui-avatars.com/api/?name=${course.instructor}&background=f4ebe3&color=9f1239&bold=true`} width={48} height={48} className="h-12 w-12 flex-none rounded-full" alt={course.instructor} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-muted">{content['courseDetails.instructorLabel'] || 'مدرب الدبلومة'}</p>
                <p className="truncate text-lg font-black text-ink">{course.instructor}</p>
              </div>
            </div>
          </div>

          {/* Price and booking */}
          <div className="lg:col-start-2 lg:row-start-2 lg:self-start">
            <div className="rounded-[28px] border border-line bg-white p-5 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] sm:p-6">
              <div className="mb-5 border-b border-line pb-5 text-center lg:text-right">
                {priced ? (
                  <>
                    {isDiscounted(strikePrice, payPrice) && (
                      <s className="mb-1 block text-sm tabular-nums text-muted-faint">{content['courseDetails.price.originalLabel'] || 'السعر الرسمي:'} {formatAmount(strikePrice)} {currencySymbol}</s>
                    )}
                    <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-2 lg:justify-start">
                      <span className="text-[40px] font-black leading-none tabular-nums text-ink">{formatAmount(payPrice)} <span className="text-xl text-primary-700">{currencySymbol}</span></span>
                      {saving > 0 && <span className="pb-1 text-sm font-extrabold text-gold-deep">توفير {formatAmount(saving)} {currencySymbol}</span>}
                    </div>
                    {applicableDiscount ? (
                      <span className="mt-3 inline-block rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">
                        خصم {applicableDiscount.discountPercent}%{applicableDiscount.label ? ` — ${applicableDiscount.label}` : ''}
                      </span>
                    ) : isDiscounted(strikePrice, payPrice) ? (
                      <span className="mt-3 inline-block rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">{content['courseDetails.price.discountBadge'] || 'خصم لفترة محدودة'}</span>
                    ) : null}
                  </>
                ) : (
                  <p className="font-bold text-gold-deep">السعر غير متاح في دولتك حاليًا</p>
                )}
              </div>

              <div className="space-y-3">
                {isSubscribed ? (
                  <div className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-green-500 bg-green-50 text-lg font-black text-green-700">
                    <Check size={22} className="text-green-600" />
                    أنت مشترك في هذا الكورس
                  </div>
                ) : priced ? (
                  <>
                    {/* The paths carry this and the courses did not, so a customer
                        who wanted to pay in instalments could only find that option
                        by landing on a bundle first. */}
                    <a
                      href={`/enroll?course=${encodeURIComponent(course.id)}`}
                      className="flex min-h-[60px] w-full flex-col items-center justify-center rounded-2xl bg-primary-700 px-5 py-2.5 text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800"
                    >
                      <span className="inline-flex items-center gap-2 text-lg font-black">احجز مكانك <ArrowLeft size={20} /></span>
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-white/80"><CreditCard size={14} />ادفع أونلاين مباشرة (كاش أو قسط)</span>
                    </a>
                    <button onClick={onBuyNow} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-ink px-5 font-black text-white transition hover:bg-black">
                      {content['courseDetails.price.cta'] || 'احجز الآن واستفد بخصم إضافي'}
                      <Check size={20} />
                    </button>
                  </>
                ) : (
                  <div className="w-full rounded-2xl bg-paper px-4 py-3 text-center font-bold text-gold-deep ring-1 ring-line">
                    تواصل معنا لتجهيز سعر دولتك
                  </div>
                )}
                <button
                  onClick={() => setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100)}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-5 font-extrabold text-ink transition hover:border-ink/40"
                >
                  <Send size={18} />
                  سجل بياناتك للتواصل
                </button>
                {/* "شهادة إتمام موثقة" is listed as a feature right below. Being
                    able to look at it is what makes that a claim rather than a
                    line of copy — the paths have had it all along. */}
                <button
                  onClick={onPreviewCertificate}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-paper px-5 text-sm font-extrabold text-ink ring-1 ring-line transition hover:ring-ink/30"
                >
                  <Award size={17} className="text-gold-deep" />
                  {content['courseDetails.cert.previewBtn'] || 'معاينة الشهادة'}
                </button>
              </div>

              <ul className="mt-5 space-y-2.5 text-sm font-bold text-muted-strong">
                {[
                  content['courseDetails.price.feature1'] || 'وصول لمدة سنة واحدة للمحتوى',
                  content['courseDetails.price.feature2'] || 'شهادة إتمام موثقة برقم تسلسلي',
                  content['courseDetails.price.feature3'] || 'المادة العلمية + نماذج العمل',
                ].map((text, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={14} /></span>
                    {text}
                  </li>
                ))}
              </ul>

              {/* Trust strip — guarantee + limited seats (editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات) */}
              <div className="mt-5 space-y-2">
                <div className="flex items-start gap-2 rounded-xl bg-paper px-3 py-2.5 text-xs leading-relaxed text-muted-strong ring-1 ring-line">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-green-600" />
                  <span>{content['courseDetails.guaranteeText'] || 'ضمان استرداد خلال 14 يوم — بشرط عدم مشاهدة أكثر من 20% من المحتوى.'}</span>
                </div>
                <div className="flex items-start gap-2 rounded-xl bg-paper px-3 py-2.5 text-xs leading-relaxed text-muted-strong ring-1 ring-line">
                  <Clock size={15} className="mt-0.5 shrink-0 text-gold-deep" />
                  <span>{content['courseDetails.seatsNote'] || 'المقاعد محدودة لكل دفعة لضمان جودة المتابعة — احجز مكانك مبكراً.'}</span>
                </div>
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
        </div>
      </div>
    </section>
  );
};
