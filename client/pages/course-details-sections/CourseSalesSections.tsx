import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Award, BadgeCheck, BookOpen, Briefcase, Check, FileText, Globe2, GraduationCap, Headphones, MessageCircle, Phone, PlayCircle, QrCode, Quote, ShieldCheck, Star, Users } from 'lucide-react';
import type { Course, Currency, TestimonialItem, Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import { instituteWhatsApp } from '../../lib/whatsappLink';
import Picture from '../../components/Picture';
import CourseCard from '../../components/CourseCard';
import CertificateSheet, { CERT_H, CERT_W } from '../../components/CertificateSheet';
import { GRADUATION_PHOTOS } from '../../components/home/GraduatesGallery';
import { formatAmount, isDiscounted } from '../../../shared/priceFormat';
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel } from '../../../shared/enrollmentPricing';
import { SectionHead } from './PainPointsAndAboutSection';
import { scrollToLeadForm } from './CourseHeroSection';

type Content = Record<string, string>;

const NAV = [
  { id: 'for-you', label: 'ليك؟' },
  { id: 'about', label: 'المحتوى' },
  { id: 'curriculum', label: 'المنهج' },
  { id: 'instructor', label: 'المدرب' },
  { id: 'certificate', label: 'الشهادة' },
  { id: 'reviews', label: 'الآراء' },
  { id: 'pricing', label: 'السعر' },
  { id: 'faq', label: 'الأسئلة' },
];

/** The page's chapters, pinned under the site header, marking the one being read. */
export const SectionNav: React.FC<{ showBook: boolean; courseId: string }> = ({ showBook, courseId }) => {
  const [top, setTop] = useState(64);
  const [active, setActive] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const header = document.querySelector('header');
    if (header) setTop(header.getBoundingClientRect().height);
    const present = NAV.map(n => n.id).filter(id => document.getElementById(id));
    setIds(present);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => seen.set(e.target.id, e.isIntersecting));
      const first = present.find(id => seen.get(id));
      if (first) setActive(first);
    }, { rootMargin: '-35% 0px -55% 0px' });
    present.forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const items = NAV.filter(n => ids.includes(n.id));
  if (items.length < 3) return null;
  return (
    <div className="sticky z-40 border-b border-line bg-white/95 backdrop-blur" style={{ top }}>
      <div className="container mx-auto flex items-center gap-3 px-4">
        <nav aria-label="أقسام الصفحة" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {items.map(n => (
            <button key={n.id} type="button" onClick={() => go(n.id)}
              className={`min-h-[40px] flex-none whitespace-nowrap rounded-xl px-3.5 text-sm font-extrabold transition ${active === n.id ? 'bg-ink text-white' : 'text-muted-strong hover:bg-paper hover:text-ink'}`}>
              {n.label}
            </button>
          ))}
        </nav>
        {showBook && (
          <Link to={`/enroll?course=${encodeURIComponent(courseId)}`} className="hidden min-h-[42px] flex-none items-center gap-1.5 rounded-xl bg-primary-700 px-4 text-sm font-black text-white transition hover:bg-primary-800 md:inline-flex">
            احجز مكانك <ArrowLeft size={16} />
          </Link>
        )}
      </div>
    </div>
  );
};

const bare = (name: string) => String(name || '').replace(/^(د\s*[/.]\s*|دكتور[ةه]?\s+|أ\s*[/.]\s*|Dr\.?\s+)/i, '').replace(/\s+/g, ' ').trim();

/** «هتتعلم على إيد مين؟» — the course's instructor, from the instructors list when they are on it. */
export const InstructorSection: React.FC<{ course: Course; therapists: Therapist[]; content: Content }> = ({ course, therapists, content }) => {
  const name = bare(course.instructor);
  const match = therapists.find(t => (course.instructorId && t.id === course.instructorId))
    || (name ? therapists.find(t => bare(t.name) === name || bare(t.name).includes(name) || name.includes(bare(t.name))) : undefined);
  if (!course.instructor && !match) return null;
  const bio = (match?.bio || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const facts = [
    match?.experience ? { icon: Briefcase, text: `${match.experience} سنة خبرة` } : null,
    match?.specialty ? { icon: BadgeCheck, text: match.specialty } : null,
    { icon: Users, text: `بيدرّس ${Math.max(0, Number(course.students) || 0).toLocaleString('ar-EG-u-nu-latn')} متدرب في البرنامج ده` },
  ].filter(Boolean) as { icon: typeof Users; text: string }[];

  return (
    <section id="instructor" className="scroll-mt-32">
      <SectionHead kicker="المدرب" title={content['courseDetails.instructor.title'] || 'هتتعلم على إيد مين؟'} />
      <div className="grid gap-5 overflow-hidden rounded-[28px] border border-line bg-paper p-5 sm:grid-cols-[200px_1fr] sm:p-7">
        <div className="mx-auto aspect-[4/5] w-44 overflow-hidden rounded-[22px] bg-sand ring-4 ring-white sm:w-full">
          {match?.image ? (
            <img loading="lazy" decoding="async" src={cdnImg(match.image, 400)} width={400} height={500} alt={match.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-6xl font-black text-primary-700">{(name || course.instructor).charAt(0)}</span>
          )}
        </div>
        <div className="min-w-0 text-center sm:text-right">
          <h3 className="text-2xl font-black text-ink">{match?.name || course.instructor}</h3>
          {match?.title && <p className="mt-1 font-bold text-primary-700">{match.title}</p>}
          <ul className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {facts.map(f => (
              <li key={f.text} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-extrabold text-muted-strong ring-1 ring-line"><f.icon size={14} className="text-gold-deep" />{f.text}</li>
            ))}
          </ul>
          <p className="mt-4 line-clamp-5 text-[15px] leading-loose text-muted-body">
            {bio || content['courseDetails.instructor.fallback'] || 'من نخبة الدكاترة والمعالجين اللي بيمارسوا المهنة فعلاً، وبيشرف بنفسه على التدريب العملي والحالات طول البرنامج.'}
          </p>
          {match?.qualifications && match.qualifications.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {match.qualifications.slice(0, 4).map(q => (
                <li key={q} className="flex gap-2 text-sm font-bold text-muted-strong"><GraduationCap size={16} className="mt-0.5 flex-none text-primary-700" />{q}</li>
              ))}
            </ul>
          )}
          {match && (
            <Link to={`/instructor/${match.id}`} className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-extrabold text-ink ring-1 ring-line transition hover:ring-ink/30">
              الملف الكامل للمدرب <ArrowLeft size={16} />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};

/** The certificate itself, as the graduate receives it — with this course's name on it. */
export const CertificateShowcase: React.FC<{ course: Course; content: Content; onPreview: () => void }> = ({ course, content, onPreview }) => {
  const english = /[A-Za-z]/.test(course.titleEn || '') && !/[؀-ۿ]/.test(course.titleEn || '') ? course.titleEn!.trim() : 'Course Title';
  const scale = 0.42;
  const points = [
    { icon: QrCode, title: 'كود تحقق على كل شهادة', text: 'أي جهة شغل تقدر تتأكد من شهادتك من موقع المعهد في ثواني.' },
    { icon: Award, title: content['courseDetails.gallery.certificateTitle'] || 'شهادة إتمام معتمدة', text: content['courseDetails.gallery.certificateSubtitle'] || 'باسمك بالإنجليزي واسم البرنامج وعدد الساعات التدريبية.' },
    { icon: Globe2, title: 'قابلة للتوثيق', text: 'تقدر توثقها من الخارجية وجهات دولية (برسوم إضافية).' },
  ];
  return (
    <section id="certificate" className="scroll-mt-32 overflow-hidden rounded-[30px] bg-ink p-5 text-white sm:p-8">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <SectionHead light kicker="الشهادة" title={content['courseDetails.cert.title'] || 'شهادة تفتح لك باب الشغل'} subtitle="في آخر البرنامج بتستلم شهادة المعهد باسمك — ودي شكلها بالظبط." />
          <ul className="space-y-4">
            {points.map(p => (
              <li key={p.title} className="flex gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-white/10 text-gold-light"><p.icon size={21} /></span>
                <span>
                  <b className="block font-black">{p.title}</b>
                  <span className="text-sm leading-relaxed text-white/65">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" onClick={onPreview} aria-label={content['courseDetails.cert.previewBtn'] || 'معاينة الشهادة'} className="group relative mx-auto block rotate-[-2.5deg] rounded-md shadow-[0_40px_70px_-30px_rgba(0,0,0,.8)] ring-4 ring-white/10 transition hover:rotate-0">
          <span dir="ltr" className="block overflow-hidden rounded-md" style={{ width: CERT_W * scale, height: CERT_H * scale }}>
            <span className="block" style={{ width: CERT_W, height: CERT_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <CertificateSheet lazy certName="STUDENT NAME" certCourse={english} duration={course.hours ? `${course.hours} Hours` : ''} trainer={course.instructor} certNumber="SAMPLE" issuedAt="" qrUrl="" />
            </span>
          </span>
          <span className="absolute inset-x-3 bottom-3 rounded-xl bg-ink/85 px-3 py-2 text-center text-xs font-black text-white opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">اضغط للمعاينة بالحجم الكامل</span>
        </button>
      </div>
    </section>
  );
};

/** «خريجينا بيتكلموا» — the rating, the students' own words, and their graduation day. */
export const ProofSection: React.FC<{ content: Content; testimonials: TestimonialItem[]; rating: { avg: number; count: number } | null; students: number }> = ({ content, testimonials, rating, students }) => {
  const list = testimonials.filter(t => (t.text || '').trim()).slice(0, 6);
  return (
    <section id="reviews" className="scroll-mt-32">
      <SectionHead kicker="آراء حقيقية" title={content['courseDetails.reviews.title'] || 'خريجينا بيتكلموا'} subtitle={students > 0 ? `أكتر من ${students.toLocaleString('ar-EG-u-nu-latn')} متدرب اشتركوا في البرنامج ده. شوف قالوا إيه.` : undefined} />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GRADUATION_PHOTOS.slice(0, 5).map((p, i) => (
          <div key={p.src} className={`relative overflow-hidden rounded-[18px] bg-sand ${i === 0 ? 'col-span-2 aspect-[16/10] sm:row-span-2 sm:aspect-auto' : 'aspect-[4/3]'}`}>
            <Picture photo={p.src.replace('.jpg', '')} widths={p.widths} sizes={i === 0 ? '(min-width: 1024px) 380px, 100vw' : '(min-width: 1024px) 190px, 50vw'} alt={p.alt} width={480} height={360} className="h-full w-full object-cover" />
          </div>
        ))}
      </div>

      {rating && rating.count > 0 && (
        <div className="mb-5 flex items-center gap-4 rounded-[22px] bg-paper p-4 ring-1 ring-line">
          <p className="text-4xl font-black tabular-nums text-ink">{rating.avg.toFixed(1)}</p>
          <div>
            <div className="flex gap-0.5 text-gold">{[1, 2, 3, 4, 5].map(s => <Star key={s} size={18} fill="currentColor" className={s <= Math.round(rating.avg) ? '' : 'opacity-25'} />)}</div>
            <p className="mt-1 text-sm font-bold text-muted">متوسط تقييم المتدربين ({rating.count} تقييم)</p>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
          {list.map(t => (
            <figure key={t.id} className="relative w-[85%] flex-none snap-start rounded-[22px] border border-line bg-white p-5 md:w-auto">
              <Quote size={30} className="absolute left-4 top-4 text-primary-100" />
              <div className="mb-2 flex gap-0.5 text-gold">{[...Array(5)].map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
              <blockquote className="line-clamp-5 text-[15px] leading-relaxed text-muted-body">{t.text}</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                {t.image ? (
                  <img loading="lazy" decoding="async" src={cdnImg(t.image, 120)} width={44} height={44} alt={t.name} className="h-11 w-11 flex-none rounded-full object-cover ring-2 ring-line" />
                ) : (
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary-50 text-lg font-black text-primary-700">{t.name.charAt(0)}</span>
                )}
                <span className="min-w-0">
                  <b className="block truncate text-sm font-black text-ink">{t.name}</b>
                  <span className="block truncate text-xs text-muted">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
};

interface ValueStackProps {
  course: Course;
  content: Content;
  lectureCount: number;
  currentPrice: number;
  oldPrice: number;
  discountedPrice: number | null;
  currencySymbol: string;
  isSubscribed: boolean;
}

/** «كل ده هتاخده» — everything in the price, the price against the official one, and the guarantee. */
export const ValueStackSection: React.FC<ValueStackProps> = ({ course, content, lectureCount, currentPrice, oldPrice, discountedPrice, currencySymbol, isSubscribed }) => {
  const strike = discountedPrice !== null ? currentPrice : oldPrice;
  const pay = discountedPrice !== null ? discountedPrice : currentPrice;
  const rates = enrollmentRates(content);
  const items = [
    { icon: PlayCircle, text: `${course.duration || (lectureCount > 0 ? `${lectureCount} فيديو` : 'محاضرات البرنامج كاملة')} — ${course.type === 'Mix' ? 'مسجلة + لايف' : course.type === 'Live' ? 'لايف تفاعلي' : 'مسجلة بجودة عالية'}` },
    { icon: BookOpen, text: content['courseDetails.price.feature3'] || 'المادة العلمية + نماذج العمل' },
    { icon: Award, text: content['courseDetails.price.feature2'] || 'شهادة إتمام موثقة برقم تسلسلي' },
    { icon: FileText, text: 'تدريب عملي ونماذج لصياغة الحالة والتقييم' },
    { icon: Headphones, text: 'دعم ومتابعة طول البرنامج على واتساب والمجتمع' },
    { icon: ShieldCheck, text: content['courseDetails.price.feature1'] || 'وصول لمدة سنة واحدة للمحتوى' },
  ];
  return (
    <section id="pricing" className="scroll-mt-32 overflow-hidden rounded-[30px] border-2 border-primary-700/15 bg-white">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <div className="p-5 sm:p-8">
          <SectionHead kicker="العرض" title={content['courseDetails.value.title'] || 'كل ده هتاخده لما تحجز'} />
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
          {currentPrice > 0 ? (
            <>
              {isDiscounted(strike, pay) && <s className="text-base tabular-nums text-white/55">بدل {formatAmount(strike)} {currencySymbol}</s>}
              <p className="text-[52px] font-black leading-none tabular-nums">{formatAmount(pay)} <span className="text-2xl text-gold-pale">{currencySymbol}</span></p>
              <div className="mx-auto mt-4 w-full max-w-xs space-y-1.5 rounded-2xl bg-white/10 p-3 text-sm font-bold ring-1 ring-white/15">
                <p className="flex justify-between gap-2"><span>كاش (خصم {percentLabel(rates.cash)}%)</span><b className="tabular-nums">{formatAmount(amountDueNow(currentPrice, 'cash', rates))} {currencySymbol}</b></p>
                <p className="flex justify-between gap-2"><span>تقسيط (إجمالي)</span><b className="tabular-nums">{formatAmount(installmentTotal(currentPrice, rates))} {currencySymbol}</b></p>
                <p className="flex justify-between gap-2 text-gold-pale"><span>تبدأ بأول دفعة</span><b className="tabular-nums">{formatAmount(amountDueNow(currentPrice, 'installment', rates))} {currencySymbol}</b></p>
              </div>
            </>
          ) : (
            <p className="text-lg font-black">تواصل معنا لتجهيز سعر دولتك</p>
          )}
          {!isSubscribed && (
            <div className="mt-5 space-y-2.5">
              <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-white px-5 text-lg font-black text-primary-800 shadow-xl transition hover:bg-paper">
                احجز مكانك الآن <ArrowLeft size={20} />
              </Link>
              <button type="button" onClick={scrollToLeadForm} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-5 font-extrabold text-white ring-1 ring-white/30 transition hover:bg-white/10">
                <Phone size={17} /> عايز أسأل الأول
              </button>
            </div>
          )}
          <p className="mt-5 flex items-start justify-center gap-2 text-xs leading-relaxed text-white/75">
            <ShieldCheck size={16} className="mt-0.5 flex-none text-gold-pale" />
            {content['courseDetails.guaranteeText'] || 'ضمان استرداد خلال 14 يوم — بشرط عدم مشاهدة أكثر من 20% من المحتوى.'}
          </p>
        </div>
      </div>
    </section>
  );
};

/** The last screen before the footer: one more, clear invitation. */
export const FinalCtaSection: React.FC<{ course: Course; content: Content; isSubscribed: boolean }> = ({ course, content, isSubscribed }) => {
  if (isSubscribed) return null;
  return (
    <section className="relative overflow-hidden bg-ink py-14 text-white sm:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.45),transparent)]" />
      <div className="container relative mx-auto px-4 text-center">
        <GraduationCap size={44} className="mx-auto text-gold-light" />
        <h2 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-black leading-tight sm:text-[44px]">{content['courseDetails.final.title'] || 'مكانك في الدفعة الجاية مستنيك'}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">{content['courseDetails.final.subtitle'] || `ابدأ ${course.title} النهارده، وخلّي الشهادة الجاية في ملفك تكون شهادتك.`}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-9 text-lg font-black text-white shadow-[0_20px_40px_-14px_rgba(225,29,72,.75)] transition hover:bg-primary-500">
            احجز مكانك الآن <ArrowLeft size={20} />
          </Link>
          <a href={`https://wa.me/${instituteWhatsApp(content)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-2xl bg-white/10 px-7 text-base font-extrabold text-white ring-1 ring-white/25 transition hover:bg-white/15">
            <MessageCircle size={18} /> كلّمنا واتساب
          </a>
        </div>
      </div>
    </section>
  );
};

/** Other programmes, as the same cards the rest of the site uses. */
export const RelatedCoursesSection: React.FC<{ content: Content; courses: Course[]; currentCourseId: string; currency: Currency }> = ({ content, courses, currentCourseId, currency }) => {
  const list = courses.filter(c => c.id !== currentCourseId).sort((a, b) => (Number(b.students) || 0) - (Number(a.students) || 0)).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <section className="bg-paper py-14 sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <SectionHead kicker="كمّل طريقك" title={content['courseDetails.sidebar.title'] || 'دبلومات قد تهمك'} />
          <Link to="/courses" className="mb-7 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-primary-700 hover:text-primary-800">كل الدبلومات <ArrowLeft size={16} /></Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(c => <CourseCard key={c.id} course={c} currency={currency} />)}
        </div>
      </div>
    </section>
  );
};
