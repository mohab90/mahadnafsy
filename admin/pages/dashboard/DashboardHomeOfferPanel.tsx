import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, BookOpen, Clock, ClipboardList, HelpCircle, Home, Images, LayoutTemplate,
  Megaphone, MessageCircle, MessagesSquare, PlayCircle, Route, Sparkles, Tag, Timer, Users,
} from 'lucide-react';

import { DESIGNS, HERO_VARIANTS, siteDesign } from '../../../shared/siteDesigns';
import { useStaticData } from '../../context/siteDataSlices';
import { ContentEditor } from './content-editor/ContentEditor';
import type { EditorField, EditorSection } from './content-editor/types';

type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
type ContentField = EditorField & { multiline?: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Written by the course picker below, so not drawn as a field. */
const PICKER_KEYS = new Set(['home.offer.discountPercent']);

type HomeSection = {
  id: string;
  title: string;
  hint: string;
  icon: ReactNode;
  /** A screen elsewhere in the panel that holds the rest of this section. */
  link?: { label: string; to: string };
  keywords?: string;
};

// The home page from the top down, as the site draws it (client/pages/Home.tsx).
const HOME_SECTIONS: HomeSection[] = [
  { id: 'strip', title: 'شريط العرض فوق الهيدر', icon: <Megaphone size={18} />,
    hint: 'الشريط الغامق أعلى الصفحة. بيظهر لوحده طول ما عداد عرض الـ24 ساعة شغال، وبياخد اسم الكورس من «عرض الـ24 ساعة».' },
  { id: 'hero', title: 'الهيدر', icon: <LayoutTemplate size={18} />, keywords: 'هيرو عنوان رئيسي',
    hint: 'عنوان الهيدر ووصفه وأزراره — لكل لون من التلاتة — بتتعدل من «تصميم الموقع». هنا الشارات الصغيرة اللي جواه.',
    link: { label: 'عدّل كلام الهيدر من «تصميم الموقع»', to: '/dashboard/content_hub/site_design' } },
  { id: 'stats', title: 'الأرقام تحت الهيدر', icon: <BarChart3 size={18} />, keywords: 'احصائيات خريجين خبراء تقييم',
    hint: 'الأربع أرقام اللي تحت الهيدر على طول.' },
  { id: 'programs', title: 'الدبلومات الأكثر طلباً', icon: <BookOpen size={18} />, keywords: 'كورسات برامج',
    hint: 'كروت الدبلومات بتبويبات التخصصات — الكروت نفسها من شاشة الكورسات.' },
  { id: 'featured', title: 'كورس مميز بخصم', icon: <Sparkles size={18} />,
    hint: 'شريط صغير تحت الدبلومات لكورس واحد بخصم إضافي. بيظهر بس لما تختار كورس وتحط نسبة خصم.' },
  { id: 'offer', title: 'عرض الـ24 ساعة', icon: <Tag size={18} />, keywords: 'اوفر عداد سعر خصم',
    hint: 'الكورس اللي عليه العرض، والعداد، والكلام اللي في قسم العرض.' },
  { id: 'offerForm', title: 'فورم الحجز في العرض', icon: <ClipboardList size={18} />, keywords: 'تسجيل نموذج فرع',
    hint: 'الفورم اللي جنب العرض — كل اللي بيسجل منه بيوصل ليد للسيلز.' },
  { id: 'why', title: 'لماذا نختار المعهد + الفيديو', icon: <PlayCircle size={18} />, keywords: 'فيديو يوتيوب جولة مميزات',
    hint: 'فيديو الجولة المربع، والأربع مميزات اللي جنبه، وتحتهم خانة التحقق من الشهادة.' },
  { id: 'gallery', title: 'صور الخريجين وخطوات الدفع', icon: <Images size={18} />, keywords: 'حاسبة تقسيط كاش',
    hint: 'صور حفلات التخرج ثابتة في الموقع، والرقم اللي معاها هو «عدد الطلاب» من قسم الهيدر. حاسبة الدفع بتاخد نسب خصم الكاش والتقسيط من «التسويق ← عروض الموقع».',
    link: { label: 'نسب الكاش والتقسيط', to: '/dashboard/marketing_hub' } },
  { id: 'instructors', title: 'الخبراء', icon: <Users size={18} />, keywords: 'محاضرين دكاترة',
    hint: 'بيظهر الخبراء اللي ليهم صورة، واللي معلَّم عليهم «يظهر في الرئيسية» بييجوا الأول.',
    link: { label: 'شاشة الخبراء', to: '/dashboard/instructors' } },
  { id: 'testimonials', title: 'آراء العملاء', icon: <MessagesSquare size={18} />, keywords: 'تقييمات',
    hint: 'الآراء نفسها بتتضاف من شاشة «آراء العملاء»؛ هنا عنوان القسم. التقييم اللي جنبه هو «متوسط التقييم» من الأرقام.',
    link: { label: 'شاشة آراء العملاء', to: '/dashboard/testimonials' } },
  { id: 'paths', title: 'المسارات', icon: <Route size={18} />, keywords: 'باقات',
    hint: 'كروت المسارات من شاشة المسارات؛ هنا عنوان القسم وكلامه.' },
  { id: 'express', title: 'الاستشارة الفورية', icon: <MessageCircle size={18} />, keywords: 'جلسة سريعة معالج',
    hint: 'إظهار القسم أو إخفاؤه، وسعر الجلسة، والمعالج اللي صورته فيه — من «الاستشارات ← الإعدادات».',
    link: { label: 'إعدادات الاستشارات', to: '/dashboard/consultations' } },
  { id: 'faq', title: 'الأسئلة الشائعة', icon: <HelpCircle size={18} />, keywords: 'اسئلة FAQ مش عارف تبدأ منين',
    hint: 'الخمس أسئلة اللي جنب «مش عارف تبدأ منين؟» قبل آخر سلايد. الخانة الفاضية بيظهر فيها السؤال الأصلي (المكتوب باهت).' },
];

/**
 * «جزء اوفر 24 ساعه مش عارف اغيره منين اغير الكورس او الاوفر نفسه».
 *
 * The course picker and the timer lived on a tab no menu reached; the menu's
 * «الصفحة الرئيسية» opened a list of sixty text fields, the offer's among them,
 * with no way to choose the course. This panel is what that entry opens now,
 * and it says what decides what: the course chosen sets the price the site
 * shows (its own price, in each visitor's currency), the discount only draws
 * the struck-out price, and the countdown runs from «ابدأ العداد».
 *
 * The rest of the page's text is laid out in the order the site draws it, one
 * card per section, saved together from the bar at the bottom.
 *
 * Its state is its own — the selected course was held in Dashboard.tsx and
 * handed down with its setter to the one screen that used it.
 */
export function DashboardHomeOfferPanel({ fields, notify }: { fields: ContentField[]; notify: NotifyFn }) {
  const { content, courses, setContentValue, setContentValues } = useStaticData();
  const navigate = useNavigate();
  const [courseId, setCourseId] = useState(content['offer.courseId'] || '');
  const [discount, setDiscount] = useState(content['home.offer.discountPercent'] || '45');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setCourseId(content['offer.courseId'] || ''); }, [content]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const current = courses.find(course => course.id === content['offer.courseId']);
  const started = Date.parse(content['offer.timerStartedAt'] || '');
  const remaining = Number.isFinite(started) ? started + DAY_MS - now : null;
  const pct = Number(content['home.offer.discountPercent'] || 45);
  const shownPrice = current?.price?.EGP || 0;
  const struckPrice = shownPrice && pct > 0 && pct < 100 ? Math.round(shownPrice / (1 - pct / 100)) : 0;

  const timerLabel = useMemo(() => {
    if (remaining === null) return 'مش شغال — العداد مش ظاهر في الموقع';
    if (remaining <= 0) return 'خلص — العداد واقف على 00:00:00';
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    return `شغال — فاضل ${h} ساعة و${m} دقيقة`;
  }, [remaining]);

  const applyCourse = async () => {
    const selected = courses.find(course => course.id === courseId);
    if (!selected) return notify('error', 'اختار الكورس الأول.');
    const percent = Number(discount);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return notify('error', 'نسبة الخصم لازم تكون من 0 لـ 99.');
    const written: Record<string, string> = {
      'offer.courseId': selected.id,
      'home.offer.title': selected.title,
      'home.offer.description': (selected.shortDescription || selected.description?.slice(0, 200) || '')
        .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
      'home.offer.registerFor': `${selected.title} (عرض 24 ساعة)`,
      'home.offer.discountPercent': String(percent),
      'home.offer.discount': `خصم ${percent}%`,
    };
    const ok = await setContentValues(written);
    // What the picker just wrote replaces any unsaved edit of the same field.
    if (ok) setDrafts(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !(key in written))));
    notify(ok ? 'success' : 'error', ok ? `العرض بقى على «${selected.title}» — بسعره من صفحة الكورس.` : 'تعذر حفظ العرض.');
  };

  const unlinkCourse = async () => {
    const ok = await setContentValue('offer.courseId', '');
    notify(ok ? 'success' : 'error', ok ? 'العرض مش مربوط بكورس — الأسعار دلوقتي من الخانات تحت.' : 'تعذر الحفظ.');
  };

  const startTimer = async (value: string) => {
    const ok = await setContentValue('offer.timerStartedAt', value);
    notify(ok ? 'success' : 'error', ok ? (value ? 'العداد بدأ: 24 ساعة من دلوقتي.' : 'العداد اتقفل.') : 'تعذر الحفظ.');
  };

  const jumpToOffer = () => document.querySelector('[data-section="offer"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const offerPicker = (
    <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-amber-200 bg-white p-3">
          <div className="mb-1 font-bold text-amber-700">الكورس في العرض</div>
          <div className="font-bold text-gray-900">{current?.title || 'مش مربوط بكورس'}</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-3">
          <div className="mb-1 font-bold text-amber-700">السعر اللي بيظهر (مصر)</div>
          <div className="font-bold text-gray-900">
            {current
              ? <>{shownPrice.toLocaleString('ar-EG-u-nu-latn')} ج.م {struckPrice ? <span className="mr-1 text-gray-400 line-through">{struckPrice.toLocaleString('ar-EG-u-nu-latn')}</span> : null}</>
              : (content['home.offer.newPrice'] || '—')}
          </div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-3">
          <div className="mb-1 flex items-center gap-1 font-bold text-amber-700"><Timer size={12} /> العداد</div>
          <div className="font-bold text-gray-900">{timerLabel}</div>
        </div>
      </div>

      <p className="text-xs leading-5 text-amber-800">
        الكورس اللي تختاره هو اللي العميل بيسجل عليه، و<strong>سعره هو سعر العرض</strong> — عشان تغير السعر غيّره من صفحة الكورس،
        أو فك الربط وحط الأسعار يدوي في الخانات تحت. نسبة الخصم بتحسب السعر المشطوب بس.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-xs font-bold text-amber-800">اختار كورس العرض</span>
          <select value={courseId} onChange={event => setCourseId(event.target.value)}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm">
            <option value="">— اختر كورس —</option>
            {courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
        <label className="w-28">
          <span className="mb-1 block text-xs font-bold text-amber-800">الخصم %</span>
          <input type="number" min="0" max="99" value={discount} onChange={event => setDiscount(event.target.value)}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={() => void applyCourse()}
          className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-white hover:bg-amber-600">تطبيق على العرض</button>
        {current && (
          <button type="button" onClick={() => void unlinkCourse()}
            className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100">فك الربط بالكورس</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void startTimer(new Date().toISOString())}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700">
          <Clock size={13} /> ابدأ عداد 24 ساعة من دلوقتي
        </button>
        {remaining !== null && (
          <button type="button" onClick={() => void startTimer('')}
            className="rounded-lg border border-amber-300 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">إيقاف العداد</button>
        )}
      </div>
      <p className="text-[11px] text-amber-700">الاختيار والعداد بيتحفظوا على طول من الزراير دي؛ كلام العرض تحت بيتحفظ من شريط الحفظ.</p>
    </div>
  );

  const design = DESIGNS.find(d => d.id === siteDesign(content));
  const heroMode = content['home.hero.mode'];
  const heroSummary = HERO_VARIANTS.find(v => v.id === heroMode)?.label || 'بيتغير مع كل زيارة';

  const known = new Set(HOME_SECTIONS.map(section => section.id));
  const drawn = fields.filter(field => !PICKER_KEYS.has(field.key));
  const withOptions = (field: ContentField): ContentField => (field.key === 'home.featured.courseId'
    ? { ...field, options: courses.map(course => ({ value: course.id, label: course.title })), placeholder: 'من غير كورس مميز' }
    : field);

  const sections: EditorSection[] = HOME_SECTIONS.map(section => {
    const linkButton = section.link && (
      <button type="button" onClick={() => navigate(section.link!.to)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition hover:border-primary-200 hover:text-primary-700">
        {section.link.label} <ArrowLeft size={14} />
      </button>
    );
    let before: ReactNode = null;
    if (section.id === 'strip') {
      before = (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white">
          <span className="flex items-center gap-2 font-bold"><Timer size={15} className="text-amber-300" /> {timerLabel}</span>
          <button type="button" onClick={jumpToOffer} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20">روح لعرض الـ24 ساعة</button>
        </div>
      );
    } else if (section.id === 'hero') {
      before = (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
          <div className="text-xs leading-6 text-gray-600">
            <div>التصميم دلوقتي: <b className="text-gray-900">{design?.label}</b></div>
            <div>الهيدر: <b className="text-gray-900">{heroSummary}</b></div>
          </div>
          {linkButton}
        </div>
      );
    } else if (section.id === 'offer') {
      before = offerPicker;
    }
    return {
      id: section.id,
      title: section.title,
      hint: section.hint,
      icon: section.icon,
      keywords: section.keywords,
      fields: drawn.filter(field => field.section === section.id).map(withOptions),
      before,
      after: section.id !== 'hero' && linkButton ? linkButton : undefined,
    };
  });
  const loose = drawn.filter(field => !field.section || !known.has(field.section));
  if (loose.length) sections.push({ id: 'other', title: 'نصوص تانية في الصفحة', fields: loose, icon: <Home size={18} /> });

  return (
    <ContentEditor
      title="الصفحة الرئيسية"
      subtitle="كل أقسام الصفحة الرئيسية بنفس ترتيبها في الموقع من فوق لتحت. الخانة الفاضية بيظهر مكانها الكلام الأصلي المكتوب باهت."
      icon={<Home size={20} />}
      sections={sections}
      content={content}
      drafts={drafts}
      setDrafts={setDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      successMessage="اتحفظ — الصفحة الرئيسية اتحدثت."
    />
  );
}
