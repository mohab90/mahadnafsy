// ── Static content-field definitions for the site-content editor ─────────────
// Extracted from Dashboard.tsx (stage 1 of the Dashboard decomposition).
// Pure configuration: each entry maps a site_config content key to its Arabic
// editor label. No component state involved.

import { HERO_VARIANTS, type HeroText, type HeroVariantId } from '../../../shared/siteDesigns';
import type { EditorField } from './content-editor/types';
import type { TabKey } from './navigation';

/**
 * A key and how its editor draws it. Beyond key/label/multiline, an entry may
 * say its kind (`type`: number, toggle, select, youtube…), a one-line `hint`,
 * the `placeholder` the site shows while it is empty, and which `section` of a
 * sectioned page it sits in — see content-editor/types.ts.
 */
export interface ContentField extends EditorField {
  multiline: boolean;
}

export const aboutPageFields: ContentField[] = [
  { key: 'about.heroTitle', label: 'العنوان الكبير', multiline: false, section: 'أول الصفحة' },
  { key: 'about.heroSubtitle', label: 'السطر تحت العنوان', multiline: true, section: 'أول الصفحة' },
  { key: 'about.storyBadge', label: 'الكلمة الصغيرة فوق العنوان', multiline: false, section: 'قصة المعهد' },
  { key: 'about.storyTitle', label: 'عنوان القصة', multiline: false, section: 'قصة المعهد' },
  { key: 'about.storyParagraph1', label: 'الفقرة الأولى', multiline: true, section: 'قصة المعهد' },
  { key: 'about.storyParagraph2', label: 'الفقرة التانية', multiline: true, section: 'قصة المعهد' },
  { key: 'about.stats.graduates', label: 'عدد الخريجين', multiline: false, section: 'الأرقام' },
  { key: 'about.stats.programs', label: 'عدد البرامج', multiline: false, section: 'الأرقام' },
  { key: 'about.stats.countries', label: 'عدد الدول', multiline: false, section: 'الأرقام' },
  { key: 'about.stats.years', label: 'سنين الخبرة', multiline: false, section: 'الأرقام' },
  { key: 'about.team.title', label: 'عنوان القسم', multiline: false, section: 'فريق العمل' },
  { key: 'about.team.subtitle', label: 'الوصف', multiline: true, section: 'فريق العمل' },
];

// The home page, section by section in the order the site draws them — the
// `section` ids are the cards of «الصفحة الرئيسية» (DashboardHomeOfferPanel
// HOME_SECTIONS). The hero's headline, subtitle and buttons are per hero colour
// now and live in siteDesignFields below.
export const homeOfferFields: ContentField[] = [
  // ── Inside the hero ──
  { key: 'home.hero.certificateTitle', label: 'شارة الشهادة — السطر الأول', multiline: false, section: 'hero', hint: 'الشارة الصغيرة على صورة الخريج' },
  { key: 'home.hero.certificateSubtitle', label: 'شارة الشهادة — السطر التاني', multiline: false, section: 'hero' },
  { key: 'home.hero.trustCount', label: 'عدد الطلاب', multiline: false, section: 'hero', hint: 'بيظهر جنب صور الوشوش في الهيدر، وفوق معرض صور الخريجين' },
  { key: 'home.hero.trustLabel', label: 'الكلام اللي بعد عدد الطلاب', multiline: false, section: 'hero' },
  // ── The numbers under the hero ──
  { key: 'home.stats.graduates', label: 'عدد الخريجين', multiline: false, section: 'stats' },
  { key: 'home.stats.graduatesLabel', label: 'تحت عدد الخريجين', multiline: false, section: 'stats' },
  { key: 'home.stats.programs', label: 'عدد البرامج', multiline: false, section: 'stats' },
  { key: 'home.stats.programsLabel', label: 'تحت عدد البرامج', multiline: false, section: 'stats' },
  { key: 'home.stats.experts', label: 'عدد الخبراء', multiline: false, section: 'stats' },
  { key: 'home.stats.expertsLabel', label: 'تحت عدد الخبراء', multiline: false, section: 'stats' },
  { key: 'home.stats.rating', label: 'متوسط التقييم (من 5)', multiline: false, section: 'stats', hint: 'بيظهر كمان جنب «آراء العملاء»' },
  // ── Programmes ──
  { key: 'home.bestSellers.badge', label: 'اسم أول تبويب', multiline: false, section: 'programs', hint: 'التبويب اللي بيعرض الأكثر طلباً، وباقي التبويبات من تخصصات الكورسات' },
  { key: 'home.bestSellers.title', label: 'عنوان القسم', multiline: false, section: 'programs' },
  { key: 'home.bestSellers.viewAll', label: 'زرار «عرض الكل»', multiline: false, section: 'programs' },
  // ── A featured course at a special price ──
  { key: 'home.featured.courseId', label: 'الكورس المميز', multiline: false, section: 'featured', type: 'select', hint: 'سيبه فاضي عشان الشريط ده ميظهرش' },
  { key: 'home.featured.discountPercent', label: 'نسبة الخصم %', multiline: false, section: 'featured', type: 'number', min: 0, max: 99, placeholder: '0', hint: 'لازم تكون أكبر من صفر عشان الشريط يظهر' },
  // ── The 24h offer ──
  { key: 'home.offer.badge', label: 'الشارة فوق العنوان', multiline: false, section: 'offer' },
  { key: 'home.offer.title', label: 'عنوان العرض', multiline: false, section: 'offer', hint: 'بيتكتب لوحده لما تختار كورس فوق، وبيظهر كمان في الشريط اللي فوق الهيدر' },
  { key: 'home.offer.description', label: 'وصف العرض', multiline: true, section: 'offer' },
  { key: 'home.offer.oldPrice', label: 'السعر قبل الخصم (لو مش مربوط بكورس)', multiline: false, section: 'offer' },
  { key: 'home.offer.newPrice', label: 'السعر بعد الخصم (لو مش مربوط بكورس)', multiline: false, section: 'offer' },
  { key: 'home.offer.discount', label: 'كلمة الخصم', multiline: false, section: 'offer', hint: 'مثلاً «خصم 45%»' },
  // Read by Home.tsx to price the 24h offer (defaults to 45 when unset); the
  // course picker of this panel writes it, so it is not drawn as a field.
  { key: 'home.offer.discountPercent', label: 'نسبة الخصم رقمًا (مثال: 45) — تُحتسب في سعر العرض', multiline: false, section: 'offer', type: 'number' },
  { key: 'home.offer.validUntil', label: 'السطر تحت السعر', multiline: false, section: 'offer' },
  // ── The offer's booking form ──
  { key: 'home.offer.formBadge', label: 'عنوان الفورم', multiline: false, section: 'offerForm' },
  { key: 'home.offer.registerFor', label: 'اسم الكورس اللي بيسجل عليه', multiline: false, section: 'offerForm', hint: 'بيتكتب لوحده لما تختار كورس للعرض' },
  { key: 'home.offer.formNameLabel', label: 'عنوان خانة الاسم', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formNamePlaceholder', label: 'المكتوب جوه خانة الاسم', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formPhoneLabel', label: 'عنوان خانة الموبايل', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formPhonePlaceholder', label: 'المكتوب جوه خانة الموبايل', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchLabel', label: 'عنوان اختيار الفرع', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchPlaceholder', label: 'أول اختيار (اختر الفرع)', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchGiza', label: 'اختيار فرع الدقي', multiline: false, section: 'offerForm', hint: 'بيستخدم لما مفيش فروع متسجلة في إعدادات الفوتر' },
  { key: 'home.offer.formBranchCairo', label: 'اختيار فرع التجمع', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchOnline', label: 'اختيار أونلاين مصر', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchSaudi', label: 'اختيار أونلاين سعودي', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchAbroad', label: 'اختيار أونلاين دولي', multiline: false, section: 'offerForm' },
  { key: 'home.offer.formBranchOther', label: 'اختيار «أخرى»', multiline: false, section: 'offerForm' },
  { key: 'home.offer.registerButton', label: 'زرار الحجز', multiline: false, section: 'offerForm' },
  { key: 'home.offer.registerNote', label: 'الملاحظة تحت الزرار', multiline: true, section: 'offerForm' },
  // ── Why the institute + the tour video ──
  { key: 'home.video.url', label: 'رابط فيديو الجولة (يوتيوب)', multiline: false, section: 'why', type: 'youtube', hint: 'الفيديو المربع جنب «لماذا نختار المعهد»، ونفس الفيديو بيشتغل من زرار التشغيل في الهيدر' },
  { key: 'home.video.title', label: 'السطر الصغير فوق العنوان', multiline: false, section: 'why' },
  { key: 'home.video.subtitle', label: 'الوصف تحت العنوان', multiline: true, section: 'why' },
  { key: 'home.feature1.title', label: 'الميزة 1 — العنوان', multiline: false, section: 'why' },
  { key: 'home.feature1.desc', label: 'الميزة 1 — الوصف', multiline: true, section: 'why' },
  { key: 'home.feature2.title', label: 'الميزة 2 — العنوان', multiline: false, section: 'why' },
  { key: 'home.feature2.desc', label: 'الميزة 2 — الوصف', multiline: true, section: 'why' },
  { key: 'home.feature3.title', label: 'الميزة 3 — العنوان', multiline: false, section: 'why' },
  { key: 'home.feature3.desc', label: 'الميزة 3 — الوصف', multiline: true, section: 'why', hint: 'وهي كمان إجابة السؤال الخامس في الأسئلة الشائعة لو سبته فاضي' },
  { key: 'home.feature4.title', label: 'الميزة 4 — العنوان', multiline: false, section: 'why' },
  { key: 'home.feature4.desc', label: 'الميزة 4 — الوصف', multiline: true, section: 'why' },
  // ── Testimonials ──
  { key: 'home.testimonials.title', label: 'عنوان القسم', multiline: false, section: 'testimonials' },
  { key: 'home.testimonials.subtitle', label: 'الوصف تحت العنوان', multiline: false, section: 'testimonials' },
  // ── Learning paths ──
  { key: 'home.paths.badge', label: 'السطر الصغير فوق العنوان', multiline: false, section: 'paths' },
  { key: 'home.paths.title', label: 'عنوان القسم', multiline: false, section: 'paths' },
  { key: 'home.paths.subtitle', label: 'الوصف', multiline: true, section: 'paths' },
  { key: 'home.paths.viewAll', label: 'زرار «عرض جميع المسارات»', multiline: false, section: 'paths' },
  // ── Express consultation ──
  { key: 'home.express.title', label: 'عنوان القسم', multiline: false, section: 'express' },
  { key: 'home.express.subtitle', label: 'الوصف', multiline: true, section: 'express' },
  { key: 'home.express.note', label: 'الملاحظة تحت الزرار', multiline: false, section: 'express' },
  // ── Frequently asked questions ──
  { key: 'home.faq.q1', label: 'السؤال 1', multiline: false, section: 'faq', placeholder: 'هل الشهادة معتمدة؟ وأقدر أثبتها إزاي؟' },
  { key: 'home.faq.a1', label: 'إجابة السؤال 1', multiline: true, section: 'faq', placeholder: 'كل شهادة بتطلع من المعهد ليها كود تحقق خاص بيها، وأي جهة عمل تقدر تكتب الكود في صفحة التحقق على الموقع وتشوف بيانات الشهادة في ثواني.' },
  { key: 'home.faq.q2', label: 'السؤال 2', multiline: false, section: 'faq', placeholder: 'الدراسة أونلاين ولا حضور؟' },
  { key: 'home.faq.a2', label: 'إجابة السؤال 2', multiline: true, section: 'faq', placeholder: 'الاتنين. تقدر تحضر في فرع الدقي أو التجمع، أو تدرس أونلاين من أي مكان في مصر أو السعودية أو أي دولة.' },
  { key: 'home.faq.q3', label: 'السؤال 3', multiline: false, section: 'faq', placeholder: 'أقدر أقسّط؟' },
  { key: 'home.faq.a3', label: 'إجابة السؤال 3', multiline: true, section: 'faq', placeholder: 'أيوه. تقدر تدفع كاش بخصم … وتتفتح لك كل المحاضرات فوراً، أو تقسّط بخصم … وتبدأ بأول دفعة بس.', hint: 'وهي فاضية، الموقع بيكتب نسب خصم الكاش والتقسيط الحالية لوحده' },
  { key: 'home.faq.q4', label: 'السؤال 4', multiline: false, section: 'faq', placeholder: 'محتاج خلفية في علم النفس عشان أبدأ؟' },
  { key: 'home.faq.a4', label: 'إجابة السؤال 4', multiline: true, section: 'faq', placeholder: 'لأ. فيه برامج بتبدأ من الأساس لأي حد مهتم بالمجال، وبرامج متخصصة للأخصائيين والمعالجين. لو محتار، اختار مجال اهتمامك وهنرشح لك الأنسب.' },
  { key: 'home.faq.q5', label: 'السؤال 5', multiline: false, section: 'faq', placeholder: 'المحاضرات بتفضل متاحة بعد ما أخلص؟' },
  { key: 'home.faq.a5', label: 'إجابة السؤال 5', multiline: true, section: 'faq', hint: 'وهي فاضية بتاخد وصف «الميزة 3» من قسم «لماذا نختار المعهد»' },
];

export const pageCoursesFields: ContentField[] = [
  { key: 'courses.title', label: 'عنوان الصفحة (h1)', multiline: false },
  { key: 'courses.subtitle', label: 'وصف الصفحة', multiline: true },
  { key: 'courses.searchPlaceholder', label: 'Placeholder حقل البحث', multiline: false },
  { key: 'courses.filterLabel', label: 'نص التصفية', multiline: false },
  { key: 'courses.types.all', label: 'فلتر: كل الأنظمة', multiline: false },
  { key: 'courses.types.recorded', label: 'فلتر: مسجل', multiline: false },
  { key: 'courses.types.live', label: 'فلتر: بث مباشر', multiline: false },
  { key: 'courses.types.mix', label: 'فلتر: مختلط', multiline: false },
  { key: 'courses.categories.all', label: 'فلتر: كل التخصصات', multiline: false },
  { key: 'courses.categories.therapy', label: 'فلتر: علاج نفسي', multiline: false },
  { key: 'courses.categories.child', label: 'فلتر: أطفال ومراهقين', multiline: false },
  { key: 'courses.categories.diagnosis', label: 'فلتر: تشخيص', multiline: false },
  { key: 'courses.emptyState', label: 'رسالة عدم وجود نتائج', multiline: false },
];

export const pageBundlesFields: ContentField[] = [
  { key: 'bundles.title', label: 'عنوان الصفحة (h1)', multiline: false },
  { key: 'bundles.subtitle', label: 'وصف الصفحة', multiline: true },
  { key: 'bundles.info.pathsTitle', label: 'عنوان شرح المسارات', multiline: false },
  { key: 'bundles.info.pathsDesc', label: 'وصف المسارات', multiline: true },
  { key: 'bundles.info.bundlesTitle', label: 'عنوان شرح الباقات', multiline: false },
  { key: 'bundles.info.bundlesDesc', label: 'وصف الباقات', multiline: true },
  { key: 'bundles.card.badge', label: 'بادج بطاقة المسار', multiline: false },
  { key: 'bundles.card.oldPricePrefix', label: 'نص قبل السعر القديم', multiline: false },
  { key: 'bundles.card.detailsCta', label: 'نص زر التفاصيل', multiline: false },
  { key: 'bundles.card.journeyTitle', label: 'عنوان رحلة التعلم', multiline: false },
  { key: 'bundles.card.stationsLabel', label: 'كلمة "محطات"', multiline: false },
  { key: 'bundles.benefits.certificate', label: 'ميزة: شهادة المسار', multiline: false },
  { key: 'bundles.benefits.supervision', label: 'ميزة: إشراف مهني', multiline: false },
];

export const pageConsultationsFields: ContentField[] = [
  { key: 'consultations.heroTitle', label: 'العنوان الكبير', multiline: false, section: 'أول الصفحة' },
  { key: 'consultations.heroSubtitle', label: 'السطر تحت العنوان', multiline: true, section: 'أول الصفحة' },
  { key: 'consultations.heroSub', label: 'نص تعريفي ثانوي', multiline: false, section: 'أول الصفحة' },
  { key: 'consultations.ctaText', label: 'زرار الحجز', multiline: false, section: 'أول الصفحة' },
  { key: 'consultations.badge', label: 'الشارة', multiline: false, section: 'أول الصفحة' },
  { key: 'consultations.howTitle', label: 'عنوان القسم', multiline: false, section: 'إزاي بتشتغل' },
  { key: 'consultations.step1', label: 'الخطوة الأولى', multiline: false, section: 'إزاي بتشتغل' },
  { key: 'consultations.step2', label: 'الخطوة التانية', multiline: false, section: 'إزاي بتشتغل' },
  { key: 'consultations.step3', label: 'الخطوة التالتة', multiline: false, section: 'إزاي بتشتغل' },
  { key: 'express.price.EGP', label: 'بالجنيه', multiline: false, type: 'number', section: 'سعر الجلسة السريعة' },
  { key: 'express.price.SAR', label: 'بالريال', multiline: false, type: 'number', section: 'سعر الجلسة السريعة' },
  { key: 'express.price.USD', label: 'بالدولار', multiline: false, type: 'number', section: 'سعر الجلسة السريعة' },
];

export const pageInstructorsFields: ContentField[] = [
  { key: 'instructors.title', label: 'عنوان الصفحة (h1)', multiline: false },
  { key: 'instructors.subtitle', label: 'وصف الصفحة', multiline: true },
  { key: 'instructors.card.bioFallback', label: 'نص Bio الافتراضي', multiline: true },
  { key: 'instructors.card.experienceSuffix', label: 'لاحقة الخبرة (مثال: سنة خبرة)', multiline: false },
  { key: 'instructors.card.profileCta', label: 'نص زر الملف الشخصي', multiline: false },
];

export const pageContactFields: ContentField[] = [
  { key: 'contact.heroTitle', label: 'عنوان الهيرو', multiline: false },
  { key: 'contact.heroSubtitle', label: 'وصف الهيرو', multiline: true },
  { key: 'contact.form.title', label: 'عنوان نموذج التواصل', multiline: false },
  { key: 'contact.form.subtitle', label: 'وصف نموذج التواصل', multiline: false },
];

export const pageJoinUsFields: ContentField[] = [
  { key: 'joinus.heroTitle', label: 'العنوان الكبير', multiline: false, section: 'أول الصفحة' },
  { key: 'joinus.heroSubtitle', label: 'السطر تحت العنوان', multiline: true, section: 'أول الصفحة' },
  { key: 'joinus.heroBadge', label: 'الشارة', multiline: false, section: 'أول الصفحة' },
  { key: 'joinus.stats.students', label: 'عدد الطلاب', multiline: false, section: 'الأرقام' },
  { key: 'joinus.stats.countries', label: 'عدد الدول', multiline: false, section: 'الأرقام' },
  { key: 'joinus.stats.programs', label: 'عدد البرامج', multiline: false, section: 'الأرقام' },
  { key: 'joinus.benefits.title', label: 'عنوان القسم', multiline: false, section: 'المزايا' },
  { key: 'joinus.benefits.subtitle', label: 'الوصف', multiline: true, section: 'المزايا' },
  { key: 'joinus.form.title', label: 'عنوان النموذج', multiline: false, section: 'نموذج التقديم' },
  { key: 'joinus.form.subtitle', label: 'وصف النموذج', multiline: false, section: 'نموذج التقديم' },
];

export const pageCommunityFields: ContentField[] = [
  { key: 'community.heroTitle', label: 'عنوان الهيرو', multiline: false },
  // The page led with «847 عضو» hardcoded in the client's source. The number
  // the institute wants to state belongs to the institute, not to a build.
  { key: 'community.memberCount', label: 'عدد أعضاء المجتمع (يُضاف إليه عدد المشاركات)', multiline: false },
  { key: 'community.heroSubtitle', label: 'وصف الهيرو', multiline: true },
  { key: 'community.discussions.title', label: 'عنوان قسم النقاشات', multiline: false },
  { key: 'community.library.title', label: 'عنوان مكتبة الحالات', multiline: false },
  { key: 'community.events.title', label: 'عنوان الفعاليات', multiline: false },
  { key: 'community.videos.title', label: 'عنوان مقاطع الفيديو', multiline: false },
];

export const policySections: { title: string; fields: ContentField[] }[] = [
  {
    title: 'سياسة الخصوصية',
    fields: [
      { key: 'privacy.title', label: 'العنوان الرئيسي', multiline: false },
      { key: 'privacy.s1.title', label: 'عنوان القسم 1', multiline: false },
      { key: 'privacy.s1.body', label: 'نص القسم 1', multiline: true },
      { key: 'privacy.s2.title', label: 'عنوان القسم 2', multiline: false },
      { key: 'privacy.s2.item1', label: 'بند 2.1', multiline: true },
      { key: 'privacy.s2.item2', label: 'بند 2.2', multiline: true },
      { key: 'privacy.s2.item3', label: 'بند 2.3', multiline: true },
      { key: 'privacy.s3.title', label: 'عنوان القسم 3', multiline: false },
      { key: 'privacy.s3.body', label: 'نص القسم 3', multiline: true },
      { key: 'privacy.s4.title', label: 'عنوان القسم 4', multiline: false },
      { key: 'privacy.s4.lead', label: 'التمهيد (bold)', multiline: false },
      { key: 'privacy.s4.body', label: 'نص القسم 4', multiline: true },
      { key: 'privacy.s5.title', label: 'عنوان القسم 5', multiline: false },
      { key: 'privacy.s5.body', label: 'نص القسم 5', multiline: true },
    ],
  },
  {
    title: 'الشروط والأحكام',
    fields: [
      { key: 'terms.title', label: 'العنوان الرئيسي', multiline: false },
      { key: 'terms.s1.title', label: 'عنوان القسم 1', multiline: false },
      { key: 'terms.s1.body', label: 'نص القسم 1', multiline: true },
      { key: 'terms.s2.title', label: 'عنوان القسم 2', multiline: false },
      { key: 'terms.s2.body', label: 'نص القسم 2', multiline: true },
      { key: 'terms.s3.title', label: 'عنوان القسم 3', multiline: false },
      { key: 'terms.s3.item1', label: 'بند 3.1', multiline: true },
      { key: 'terms.s3.item2', label: 'بند 3.2', multiline: true },
      { key: 'terms.s3.item3', label: 'بند 3.3', multiline: true },
      { key: 'terms.s4.title', label: 'عنوان القسم 4', multiline: false },
      { key: 'terms.s4.body', label: 'نص القسم 4', multiline: true },
      { key: 'terms.s5.title', label: 'عنوان القسم 5', multiline: false },
      { key: 'terms.s5.body', label: 'نص القسم 5', multiline: true },
    ],
  },
];

// ── Course detail page ───────────────────────────────────────────────────────
// 68 keys this page reads that had no editor anywhere in the panel: every
// label, FAQ answer, guarantee line and lead-form string was a code default
// the owner could not reach.
export const pageCourseDetailsFields: ContentField[] = [
  { key: 'courseDetails.category.therapy', label: 'تصنيف — علاج نفسي', multiline: false },
  { key: 'courseDetails.category.general', label: 'تصنيف — صحة نفسية', multiline: false },
  { key: 'courseDetails.type.mix', label: 'نوع الكورس — هجين', multiline: false },
  { key: 'courseDetails.type.live', label: 'نوع الكورس — بث مباشر', multiline: false },
  { key: 'courseDetails.type.recorded', label: 'نوع الكورس — مسجل', multiline: false },
  { key: 'courseDetails.studentsSuffix', label: 'لاحقة عدد الطلاب', multiline: false },
  { key: 'courseDetails.certificateBadge', label: 'شارة الشهادة', multiline: false },
  { key: 'courseDetails.instructorLabel', label: 'تسمية المحاضر', multiline: false },
  { key: 'courseDetails.price.originalLabel', label: 'السعر — تسمية السعر الأصلي', multiline: false },
  { key: 'courseDetails.price.discountBadge', label: 'السعر — شارة الخصم', multiline: false },
  { key: 'courseDetails.price.cta', label: 'السعر — نص الزر', multiline: false },
  { key: 'courseDetails.price.feature1', label: 'السعر — ميزة 1', multiline: false },
  { key: 'courseDetails.price.feature2', label: 'السعر — ميزة 2', multiline: false },
  { key: 'courseDetails.price.feature3', label: 'السعر — ميزة 3', multiline: false },
  { key: 'courseDetails.guaranteeText', label: 'نص الضمان', multiline: false },
  { key: 'courseDetails.seatsNote', label: 'ملاحظة المقاعد', multiline: true },
  { key: 'courseDetails.actions.share', label: 'أزرار — زر المشاركة', multiline: false },
  { key: 'courseDetails.actions.whatsapp', label: 'أزرار — زر الواتساب', multiline: false },
  { key: 'courseDetails.gallery.title', label: 'المعرض — العنوان', multiline: false },
  { key: 'courseDetails.gallery.certificateTitle', label: 'المعرض — عنوان الشهادة', multiline: false },
  { key: 'courseDetails.gallery.certificateSubtitle', label: 'المعرض — وصف الشهادة', multiline: false },
  { key: 'courseDetails.gallery.previewCta', label: 'المعرض — زر المعاينة', multiline: false },
  { key: 'courseDetails.graduates.title', label: 'الخريجين — العنوان', multiline: false },
  { key: 'courseDetails.lead.title', label: 'نموذج الاهتمام — العنوان', multiline: false },
  { key: 'courseDetails.lead.subtitle', label: 'نموذج الاهتمام — الوصف', multiline: true },
  { key: 'courseDetails.lead.namePlaceholder', label: 'نموذج الاهتمام — Placeholder name', multiline: false },
  { key: 'courseDetails.lead.phonePlaceholder', label: 'نموذج الاهتمام — Placeholder phone', multiline: false },
  { key: 'courseDetails.lead.branchPlaceholder', label: 'نموذج الاهتمام — خيار الفرع: Placeholder', multiline: false },
  { key: 'courseDetails.lead.branchOnline', label: 'نموذج الاهتمام — خيار الفرع: Online', multiline: false },
  { key: 'courseDetails.lead.branchSaudi', label: 'نموذج الاهتمام — خيار الفرع: Saudi', multiline: false },
  { key: 'courseDetails.lead.branchAbroad', label: 'نموذج الاهتمام — خيار الفرع: Abroad', multiline: false },
  { key: 'courseDetails.lead.branchCairo', label: 'نموذج الاهتمام — خيار الفرع: Cairo', multiline: false },
  { key: 'courseDetails.lead.branchGiza', label: 'نموذج الاهتمام — خيار الفرع: Giza', multiline: false },
  { key: 'courseDetails.lead.branchAlex', label: 'نموذج الاهتمام — خيار الفرع: Alex', multiline: false },
  { key: 'courseDetails.lead.submit', label: 'نموذج الاهتمام — زر الإرسال', multiline: false },
  { key: 'courseDetails.player.lockedNotice', label: 'المشغّل — تنبيه المحاضرة المقفولة', multiline: false },
  { key: 'courseDetails.player.title', label: 'المشغّل — العنوان', multiline: false },
  { key: 'courseDetails.player.fullBadge', label: 'المشغّل — شارة الصلاحية الكاملة', multiline: false },
  { key: 'courseDetails.player.empty', label: 'المشغّل — رسالة القائمة الفارغة', multiline: false },
  { key: 'courseDetails.player.lockedTitle', label: 'المشغّل — عنوان المحاضرة المقفولة', multiline: false },
  { key: 'courseDetails.player.lockedHint', label: 'المشغّل — إرشاد الترقية', multiline: false },
  { key: 'courseDetails.player.limitedBadge', label: 'المشغّل — شارة الصلاحية المحدودة', multiline: false },
  { key: 'courseDetails.player.previewBadge', label: 'المشغّل — شارة المعاينة', multiline: false },
  { key: 'courseDetails.pain.title', label: 'قسم "هل دي ليك؟" — العنوان', multiline: false },
  { key: 'courseDetails.pain.leftTitle', label: 'قسم "هل دي ليك؟" — عنوان العمود الأيسر', multiline: false },
  { key: 'courseDetails.pain.left1', label: 'قسم "هل دي ليك؟" — بند يسار 1', multiline: false },
  { key: 'courseDetails.pain.left2', label: 'قسم "هل دي ليك؟" — بند يسار 2', multiline: false },
  { key: 'courseDetails.pain.left3', label: 'قسم "هل دي ليك؟" — بند يسار 3', multiline: false },
  { key: 'courseDetails.pain.rightTitle', label: 'قسم "هل دي ليك؟" — عنوان العمود الأيمن', multiline: false },
  { key: 'courseDetails.pain.right1', label: 'قسم "هل دي ليك؟" — بند يمين 1', multiline: false },
  { key: 'courseDetails.pain.right2', label: 'قسم "هل دي ليك؟" — بند يمين 2', multiline: false },
  { key: 'courseDetails.pain.right3', label: 'قسم "هل دي ليك؟" — بند يمين 3', multiline: false },
  { key: 'courseDetails.about.title', label: 'نبذة — العنوان', multiline: false },
  { key: 'courseDetails.about.extraParagraph', label: 'نبذة — فقرة إضافية', multiline: true },
  { key: 'courseDetails.promo.title', label: 'الفيديو التعريفي — العنوان', multiline: false },
  { key: 'courseDetails.promo.subtitle', label: 'الفيديو التعريفي — الوصف', multiline: false },
  { key: 'courseDetails.sidebar.title', label: 'العمود الجانبي — العنوان', multiline: false },
  { key: 'courseDetails.faq.title', label: 'أسئلة شائعة — العنوان', multiline: false },
  { key: 'courseDetails.faq.q1', label: 'أسئلة شائعة — سؤال 1', multiline: false },
  { key: 'courseDetails.faq.a1', label: 'أسئلة شائعة — إجابة 1', multiline: true },
  { key: 'courseDetails.faq.q2', label: 'أسئلة شائعة — سؤال 2', multiline: false },
  { key: 'courseDetails.faq.a2', label: 'أسئلة شائعة — إجابة 2', multiline: true },
  { key: 'courseDetails.reviews.title', label: 'الآراء — العنوان', multiline: false },
  { key: 'courseDetails.faqTitle', label: 'عنوان الأسئلة الشائعة', multiline: false },
  { key: 'courseDetails.faqList', label: 'قائمة الأسئلة (JSON)', multiline: false },
  { key: 'courseDetails.hero.badge', label: 'أول الصفحة — الشارة (التسجيل مفتوح)', multiline: false },
  { key: 'courseDetails.hero.primaryCta', label: 'أول الصفحة — زر الحجز', multiline: false },
  { key: 'courseDetails.hero.secondaryCta', label: 'أول الصفحة — زر تسجيل البيانات', multiline: false },
  { key: 'courseDetails.pain.subtitle', label: 'قسم "هل دي ليك؟" — الوصف', multiline: false },
  { key: 'courseDetails.about.subtitle', label: 'نبذة — الوصف تحت العنوان', multiline: false },
  { key: 'courseDetails.instructor.title', label: 'المدرب — العنوان', multiline: false },
  { key: 'courseDetails.instructor.fallback', label: 'المدرب — نبذة لو المدرب مالوش نبذة', multiline: true },
  { key: 'courseDetails.cert.title', label: 'الشهادة — العنوان', multiline: false },
  { key: 'courseDetails.value.title', label: 'العرض — عنوان "كل ده هتاخده"', multiline: false },
  { key: 'courseDetails.final.title', label: 'آخر الصفحة — العنوان', multiline: false },
  { key: 'courseDetails.final.subtitle', label: 'آخر الصفحة — الوصف', multiline: true },
  { key: 'courseDetails.promo.videoUrl', label: 'الفيديو التعريفي — رابط الفيديو', multiline: false, type: 'url' },
  { key: 'courseDetails.gallery.certificateUrl', label: 'المعرض — رابط صورة الشهادة', multiline: false, type: 'image' },
  { key: 'courseDetails.previewLectureLimit', label: 'عدد محاضرات المعاينة', multiline: false, type: 'number' },
];

// ── Bundle (learning path) detail page ───────────────────────────────────────
// Same story: 50 keys read by the page, none of them editable until now.
export const pageBundleDetailsFields: ContentField[] = [
  { key: 'bundleDetails.hero.badge', label: 'الهيرو — الشارة', multiline: false },
  { key: 'bundleDetails.hero.courseCount', label: 'الهيرو — كلمة عدد الدبلومات', multiline: false },
  { key: 'bundleDetails.hero.certBadge', label: 'الهيرو — شارة الشهادة المجمعة', multiline: false },
  { key: 'bundleDetails.hero.support', label: 'الهيرو — نص الإشراف', multiline: false },
  { key: 'bundleDetails.hero.ctaPay', label: 'الهيرو — نص زر الدفع', multiline: false },
  { key: 'bundleDetails.hero.ctaLead', label: 'الهيرو — نص زر التسجيل', multiline: false },
  { key: 'bundleDetails.video.label', label: 'الفيديو — التسمية', multiline: false },
  { key: 'bundleDetails.path.title', label: 'خريطة المسار — العنوان', multiline: false },
  { key: 'bundleDetails.path.stationPrefix', label: 'خريطة المسار — بادئة المحطة', multiline: false },
  { key: 'bundleDetails.path.finalTitle', label: 'خريطة المسار — عنوان إتمام المسار', multiline: false },
  { key: 'bundleDetails.path.finalDesc', label: 'خريطة المسار — وصف إتمام المسار', multiline: true },
  { key: 'bundleDetails.cert.previewBtn', label: 'الشهادة — زر معاينة الشهادة', multiline: false },
  { key: 'bundleDetails.why.jobsTitle', label: 'لماذا هذا المسار — عنوان فرص العمل', multiline: false },
  { key: 'bundleDetails.why.jobs1', label: 'لماذا هذا المسار — فرصة عمل 1', multiline: false },
  { key: 'bundleDetails.why.jobs2', label: 'لماذا هذا المسار — فرصة عمل 2', multiline: false },
  { key: 'bundleDetails.why.jobs3', label: 'لماذا هذا المسار — فرصة عمل 3', multiline: false },
  { key: 'bundleDetails.why.skillsTitle', label: 'لماذا هذا المسار — عنوان المهارات', multiline: false },
  { key: 'bundleDetails.why.skills1', label: 'لماذا هذا المسار — مهارة 1', multiline: false },
  { key: 'bundleDetails.why.skills2', label: 'لماذا هذا المسار — مهارة 2', multiline: false },
  { key: 'bundleDetails.why.skills3', label: 'لماذا هذا المسار — مهارة 3', multiline: false },
  { key: 'bundleDetails.graduates.title', label: 'الخريجين — العنوان', multiline: false },
  { key: 'bundleDetails.testimonials.title', label: 'آراء الطلاب — العنوان', multiline: false },
  { key: 'bundleDetails.form.title', label: 'النموذج — العنوان', multiline: false },
  { key: 'bundleDetails.form.subtitle', label: 'النموذج — الوصف', multiline: true },
  { key: 'bundleDetails.form.nameLabel', label: 'النموذج — تسمية name', multiline: false },
  { key: 'bundleDetails.form.namePlaceholder', label: 'النموذج — Placeholder name', multiline: false },
  { key: 'bundleDetails.form.phoneLabel', label: 'النموذج — تسمية phone', multiline: false },
  { key: 'bundleDetails.form.phonePlaceholder', label: 'النموذج — Placeholder phone', multiline: false },
  { key: 'bundleDetails.form.branchLabel', label: 'النموذج — خيار الفرع: Label', multiline: false },
  { key: 'bundleDetails.form.branchPlaceholder', label: 'النموذج — خيار الفرع: Placeholder', multiline: false },
  { key: 'bundleDetails.form.branchOnline', label: 'النموذج — خيار الفرع: Online', multiline: false },
  { key: 'bundleDetails.form.branchSaudi', label: 'النموذج — خيار الفرع: Saudi', multiline: false },
  { key: 'bundleDetails.form.branchAbroad', label: 'النموذج — خيار الفرع: Abroad', multiline: false },
  { key: 'bundleDetails.form.branchCairo', label: 'النموذج — خيار الفرع: Cairo', multiline: false },
  { key: 'bundleDetails.form.branchGiza', label: 'النموذج — خيار الفرع: Giza', multiline: false },
  { key: 'bundleDetails.form.submit', label: 'النموذج — زر الإرسال', multiline: false },
  { key: 'bundleDetails.sidebar.title', label: 'العمود الجانبي — العنوان', multiline: false },
  { key: 'bundleDetails.sidebar.cta', label: 'العمود الجانبي — نص الزر', multiline: false },
  { key: 'bundleDetails.sidebar.ctaLead', label: 'العمود الجانبي — نص زر التسجيل', multiline: false },
  { key: 'bundleDetails.sidebar.featureCoursesSuffix', label: 'العمود الجانبي — ميزة: لاحقة عدد الدبلومات', multiline: false },
  { key: 'bundleDetails.sidebar.featureCertificates', label: 'العمود الجانبي — ميزة: الشهادات', multiline: false },
  { key: 'bundleDetails.sidebar.featureSupervision', label: 'العمود الجانبي — ميزة: الإشراف', multiline: false },
  { key: 'bundleDetails.sidebar.featureAccess', label: 'العمود الجانبي — ميزة: مدة الوصول', multiline: false },
  { key: 'bundleDetails.sidebar.guarantee', label: 'العمود الجانبي — نص الضمان', multiline: false },
  { key: 'bundleDetails.cert.sampleName', label: 'الشهادة — اسم الطالب (نموذج)', multiline: false },
  { key: 'bundleDetails.cert.sampleNameEn', label: 'الشهادة — اسم الطالب بالإنجليزية (نموذج)', multiline: false },
  { key: 'bundleDetails.cert.instructorName', label: 'الشهادة — اسم الجهة على الشهادة', multiline: false },
  { key: 'bundleDetails.about.headline', label: 'نبذة — العنوان', multiline: false },
  { key: 'bundleDetails.about.text', label: 'نبذة — النص', multiline: false },
  { key: 'bundleDetails.about.subtitle', label: 'نبذة — الوصف تحت العنوان', multiline: false },
  { key: 'bundleDetails.path.subtitle', label: 'خريطة المسار — الوصف', multiline: false },
  { key: 'bundleDetails.why.title', label: 'ليه المسار؟ — العنوان', multiline: false },
  { key: 'bundleDetails.value.title', label: 'العرض — عنوان "كل ده في المسار"', multiline: false },
  { key: 'bundleDetails.final.title', label: 'آخر الصفحة — العنوان', multiline: false },
  { key: 'bundleDetails.final.subtitle', label: 'آخر الصفحة — الوصف', multiline: true },
  { key: 'bundleDetails.faqList', label: 'الأسئلة الشائعة (سطر لكل سؤال: السؤال :: الجواب)', multiline: true },
  { key: 'bundleDetails.gallery.motivational', label: 'المعرض — صورة تحفيزية', multiline: false, type: 'image' },
];

// ── Consultations, express session, payment note, favicon ────────────────────
// Scattered singles the site reads and the panel never exposed.
export const pageMiscFields: ContentField[] = [
  { key: 'institute.favicon', label: 'رابط أيقونة المتصفح (favicon)', multiline: false, type: 'image' },
  { key: 'consultation.expressImage', label: 'صورة قسم الجلسة السريعة', multiline: false, type: 'image' },
  { key: 'finance.payment_instructions', label: 'تعليمات الدفع المعروضة للعميل', multiline: true },
  { key: 'consult.express.badge', label: 'الجلسة السريعة — الشارة', multiline: false },
  { key: 'consult.express.desc', label: 'الجلسة السريعة — الوصف', multiline: true },
  { key: 'consult.express.timeLabel', label: 'الجلسة السريعة — تسمية الوقت', multiline: false },
  { key: 'consult.express.timeValue', label: 'الجلسة السريعة — قيمة الوقت', multiline: false },
  { key: 'consult.cancelPolicy', label: 'سياسة الإلغاء', multiline: true },
  { key: 'express.therapistId', label: 'المعالج اللي في قسم الجلسة السريعة (رقم المعالج)', multiline: false, hint: 'أسهل تختاره من «الاستشارات ← الإعدادات»' },
];

// ── Footer and contact ───────────────────────────────────────────────────────
export const footerFields: ContentField[] = [
  { key: 'institute.logo', label: 'رابط اللوجو', multiline: false, type: 'image', section: 'logo', hint: 'بيظهر في الهيدر والفوتر والشهادات' },
  { key: 'footer.phone', label: 'رقم التليفون', multiline: false, section: 'contact' },
  { key: 'footer.email', label: 'البريد الإلكتروني', multiline: false, section: 'contact' },
  { key: 'footer.whatsapp', label: 'رقم الواتساب', multiline: false, section: 'contact', hint: 'أرقام بس من غير + (مثلاً 2010xxxxxxxx)' },
  { key: 'footer.address', label: 'العنوان', multiline: false, section: 'contact' },
  { key: 'footer.description', label: 'وصف المعهد في الفوتر', multiline: true, section: 'contact' },
  { key: 'footer.facebook', label: 'فيسبوك', multiline: false, type: 'url', section: 'social' },
  { key: 'footer.instagram', label: 'إنستجرام', multiline: false, type: 'url', section: 'social' },
  { key: 'footer.youtube', label: 'يوتيوب', multiline: false, type: 'url', section: 'social', hint: 'رابط القناة (مش فيديو)' },
];

// ── Site design and the rotating home hero ───────────────────────────────────
// The lists themselves (DESIGNS, HERO_VARIANTS) are shared/siteDesigns.ts, read
// by the site too; these are only how the panel words each key.
export const HERO_TEXT_FIELDS: { field: keyof HeroText; label: string; multiline: boolean; hint?: string }[] = [
  { field: 'badge', label: 'الشارة الصغيرة فوق العنوان', multiline: false },
  { field: 'title', label: 'العنوان الرئيسي', multiline: true },
  { field: 'highlight', label: 'الكلمات الملونة من العنوان', multiline: false, hint: 'انسخها من العنوان زي ما هي بالظبط، وهتتلون وتتعلم بخط تحتها' },
  { field: 'subtitle', label: 'الوصف تحت العنوان', multiline: true },
  { field: 'primaryCta', label: 'زرار الحجز (الأساسي)', multiline: false },
  { field: 'secondaryCta', label: 'زرار البرامج (التاني)', multiline: false },
];

export const heroKey = (id: HeroVariantId, field: keyof HeroText | 'enabled') => `home.hero.${id}.${field}`;

// The hero of the classic design. Three of these are also the white hero's
// fallbacks while its own field is empty (LEGACY_WHITE in shared/siteDesigns.ts).
// home.heroTitle and home.hero.feature1/2 are read by neither design any more,
// so they are left to the raw table under «متقدم».
export const classicHeroFields: ContentField[] = [
  { key: 'home.hero.badge', label: 'الشارة فوق العنوان', multiline: false, section: 'classic', hint: 'ولو شارة الهيدر الأبيض فاضية، بتظهر دي مكانها' },
  { key: 'home.heroSubtitle', label: 'الوصف تحت العنوان', multiline: true, section: 'classic', hint: 'ولو وصف الهيدر الأبيض فاضي، بيظهر ده مكانه' },
  { key: 'home.hero.primaryCta', label: 'زرار الدبلومات', multiline: false, section: 'classic', hint: 'ولو زرار البرامج في الهيدر الأبيض فاضي، بيظهر ده مكانه' },
  { key: 'home.hero.secondaryCta', label: 'زرار الاستشارة', multiline: false, section: 'classic' },
];

export const siteDesignFields: ContentField[] = [
  { key: 'site.design', label: 'تصميم الصفحة الرئيسية', multiline: false, section: 'design' },
  { key: 'home.hero.mode', label: 'الهيدر اللي يظهر', multiline: false, section: 'heroMode' },
  ...HERO_VARIANTS.flatMap(variant => [
    { key: heroKey(variant.id, 'enabled'), label: 'يدخل في التبديل', multiline: false, type: 'toggle' as const, defaultOn: true,
      onLabel: 'بيظهر ضمن التبديل', offLabel: 'متشال من التبديل', section: `hero_${variant.id}`, wide: true },
    ...HERO_TEXT_FIELDS.map(text => ({
      key: heroKey(variant.id, text.field), label: text.label, multiline: text.multiline, hint: text.hint,
      section: `hero_${variant.id}`, wide: text.multiline,
    })),
  ]),
  ...classicHeroFields,
];

// ── One editor per key ────────────────────────────────────────────────────────
// The raw key/value table under "متقدم" can edit every key in the document,
// which meant anything with a proper editor had at least two places it could be
// changed from — footer text, page copy, the 24h offer — and edits made in one
// place were invisible in the other. This registry names the single owning
// editor for each key; the raw table defers to it and links there instead of
// offering a second input.
//
// Built from the field lists themselves, so it cannot drift from them.
export type ContentEditorHome = {
  /** Dashboard tab to open. */
  tab: TabKey;
  /** Sub-tab inside content_hub, when the editor lives there. */
  subTab?: TabKey;
  /** What the admin should look for once they arrive. */
  label: string;
};

const OWNED_KEYS: [ContentEditorHome, string[]][] = [
  [{ tab: 'content_hub', subTab: 'home_offer', label: 'المحتوى ← الصفحة الرئيسية والعرض' },
    homeOfferFields.map(f => f.key).concat(['offer.courseId', 'offer.timerStartedAt'])],
  [{ tab: 'content_hub', subTab: 'about_page', label: 'المحتوى ← صفحة عن المعهد' }, aboutPageFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_courses', label: 'المحتوى ← صفحة الكورسات' }, pageCoursesFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_bundles', label: 'المحتوى ← صفحة الباقات' }, pageBundlesFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_consultations', label: 'المحتوى ← صفحة الاستشارات' }, pageConsultationsFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_instructors', label: 'المحتوى ← صفحة المحاضرين' }, pageInstructorsFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_contact', label: 'المحتوى ← صفحة التواصل' }, pageContactFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_joinus', label: 'المحتوى ← صفحة انضم إلينا' }, pageJoinUsFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_community', label: 'المحتوى ← صفحة المجتمع' }, pageCommunityFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_course_details', label: 'المحتوى ← صفحة تفاصيل الكورس' }, pageCourseDetailsFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_bundle_details', label: 'المحتوى ← صفحة تفاصيل المسار' }, pageBundleDetailsFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'page_misc', label: 'المحتوى ← إعدادات متفرقة' }, pageMiscFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'policies', label: 'المحتوى ← السياسات القانونية' },
    policySections.flatMap(s => s.fields.map(f => f.key))],
  [{ tab: 'content_hub', subTab: 'footer_settings', label: 'المحتوى ← إعدادات الفوتر' }, footerFields.map(f => f.key)],
  [{ tab: 'content_hub', subTab: 'site_design', label: 'المحتوى ← تصميم الموقع' }, siteDesignFields.map(f => f.key)],
];

const KEY_OWNER = new Map<string, ContentEditorHome>();
for (const [home, keys] of OWNED_KEYS) {
  for (const key of keys) KEY_OWNER.set(key, home);
}

/** The one editor that owns this key, or null when the raw table is its home. */
export function contentEditorFor(key: string): ContentEditorHome | null {
  return KEY_OWNER.get(key) ?? null;
}

