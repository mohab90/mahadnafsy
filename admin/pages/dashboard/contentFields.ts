// ── Static content-field definitions for the site-content editor ─────────────
// Extracted from Dashboard.tsx (stage 1 of the Dashboard decomposition).
// Pure configuration: each entry maps a site_config content key to its Arabic
// editor label. No component state involved.

export interface ContentField {
  key: string;
  label: string;
  multiline: boolean;
}

export const aboutPageFields: ContentField[] = [
  { key: 'about.heroTitle', label: 'عنوان الهيرو', multiline: false },
  { key: 'about.heroSubtitle', label: 'وصف الهيرو', multiline: true },
  { key: 'about.storyBadge', label: 'بادج القصة', multiline: false },
  { key: 'about.storyTitle', label: 'عنوان القصة', multiline: false },
  { key: 'about.storyParagraph1', label: 'فقرة القصة 1', multiline: true },
  { key: 'about.storyParagraph2', label: 'فقرة القصة 2', multiline: true },
  { key: 'about.stats.graduates', label: 'إحصائية الخريجين', multiline: false },
  { key: 'about.stats.programs', label: 'إحصائية البرامج', multiline: false },
  { key: 'about.stats.countries', label: 'إحصائية الدول', multiline: false },
  { key: 'about.stats.years', label: 'إحصائية سنوات الخبرة', multiline: false },
  { key: 'about.team.title', label: 'عنوان فريق العمل', multiline: false },
  { key: 'about.team.subtitle', label: 'وصف فريق العمل', multiline: true },
];

export const homeOfferFields: ContentField[] = [
  { key: 'home.hero.badge', label: 'Hero: الشارة العلوية', multiline: false },
  { key: 'home.heroTitle', label: 'Hero: العنوان الرئيسي', multiline: false },
  { key: 'home.heroSubtitle', label: 'Hero: الوصف', multiline: true },
  { key: 'home.hero.primaryCta', label: 'Hero: نص زر الكورسات', multiline: false },
  { key: 'home.hero.secondaryCta', label: 'Hero: نص زر الاستشارة', multiline: false },
  { key: 'home.hero.feature1', label: 'Hero: نقطة الثقة 1', multiline: false },
  { key: 'home.hero.feature2', label: 'Hero: نقطة الثقة 2', multiline: false },
  { key: 'home.hero.certificateTitle', label: 'Hero: عنوان بطاقة الشهادة', multiline: false },
  { key: 'home.hero.certificateSubtitle', label: 'Hero: وصف بطاقة الشهادة', multiline: false },
  { key: 'home.hero.trustCount', label: 'Hero: رقم الثقة', multiline: false },
  { key: 'home.hero.trustLabel', label: 'Hero: نص الثقة', multiline: false },
  { key: 'home.stats.programs', label: 'عدد البرامج', multiline: false },
  { key: 'home.stats.programsLabel', label: 'وصف عدد البرامج', multiline: false },
  { key: 'home.stats.experts', label: 'عدد الخبراء', multiline: false },
  { key: 'home.stats.expertsLabel', label: 'وصف عدد الخبراء', multiline: false },
  { key: 'home.stats.graduates', label: 'عدد الخريجين', multiline: false },
  { key: 'home.stats.graduatesLabel', label: 'وصف عدد الخريجين', multiline: false },
  { key: 'home.stats.rating', label: 'متوسط التقييم', multiline: false },
  { key: 'home.paths.badge', label: 'المسارات: الشارة', multiline: false },
  { key: 'home.paths.title', label: 'المسارات: العنوان', multiline: false },
  { key: 'home.paths.subtitle', label: 'المسارات: الوصف', multiline: true },
  { key: 'home.paths.viewAll', label: 'المسارات: زر عرض الكل', multiline: false },
  { key: 'home.bestSellers.badge', label: 'الأكثر مبيعاً: الشارة', multiline: false },
  { key: 'home.bestSellers.title', label: 'الأكثر مبيعاً: العنوان', multiline: false },
  { key: 'home.bestSellers.viewAll', label: 'الأكثر مبيعاً: زر عرض الكل', multiline: false },
  { key: 'home.offer.badge', label: 'بادج العرض', multiline: false },
  { key: 'home.offer.title', label: 'عنوان العرض', multiline: false },
  { key: 'home.offer.description', label: 'وصف العرض', multiline: true },
  { key: 'home.offer.oldPrice', label: 'السعر قبل الخصم', multiline: false },
  { key: 'home.offer.newPrice', label: 'السعر الحالي', multiline: false },
  { key: 'home.offer.discount', label: 'نسبة الخصم', multiline: false },
  // Read by Home.tsx to price the 24h offer (defaults to 45 when unset) and had
  // no editor at all, so the discount could not be changed from the panel.
  { key: 'home.offer.discountPercent', label: 'نسبة الخصم رقمًا (مثال: 45) — تُحتسب في سعر العرض', multiline: false },
  { key: 'home.offer.validUntil', label: 'صلاحية العرض', multiline: false },
  { key: 'home.offer.formBadge', label: 'نموذج العرض: الشارة', multiline: false },
  { key: 'home.offer.registerFor', label: 'نص التسجيل لـ', multiline: false },
  { key: 'home.offer.formNameLabel', label: 'نموذج العرض: تسمية الاسم', multiline: false },
  { key: 'home.offer.formNamePlaceholder', label: 'نموذج العرض: Placeholder الاسم', multiline: false },
  { key: 'home.offer.formPhoneLabel', label: 'نموذج العرض: تسمية الهاتف', multiline: false },
  { key: 'home.offer.formPhonePlaceholder', label: 'نموذج العرض: Placeholder الهاتف', multiline: false },
  { key: 'home.offer.formBranchLabel', label: 'نموذج العرض: تسمية الفرع', multiline: false },
  { key: 'home.offer.formBranchOnline', label: 'نموذج العرض: خيار أونلاين', multiline: false },
  { key: 'home.offer.formBranchCairo', label: 'نموذج العرض: خيار القاهرة', multiline: false },
  { key: 'home.offer.formBranchGiza', label: 'نموذج العرض: خيار الجيزة', multiline: false },
  { key: 'home.offer.formBranchSaudi', label: 'نموذج العرض: خيار سعودي', multiline: false },
  { key: 'home.offer.formBranchAbroad', label: 'نموذج العرض: خيار دولي', multiline: false },
  { key: 'home.offer.formBranchOther', label: 'نموذج العرض: خيار أخرى', multiline: false },
  { key: 'home.offer.formBranchPlaceholder', label: 'نموذج العرض: اختر الفرع (placeholder)', multiline: false },
  { key: 'home.offer.registerButton', label: 'نص زر التسجيل', multiline: false },
  { key: 'home.offer.registerNote', label: 'ملاحظة ما بعد التسجيل', multiline: true },
  { key: 'home.video.title', label: 'الفيديو: العنوان', multiline: false },
  { key: 'home.video.subtitle', label: 'الفيديو: الوصف', multiline: true },
  { key: 'home.video.url', label: 'الفيديو: رابط يوتيوب (لماذا نختار المعهد)', multiline: false },
  { key: 'home.testimonials.title', label: 'الآراء: العنوان', multiline: false },
  { key: 'home.testimonials.subtitle', label: 'الآراء: الوصف', multiline: false },
  { key: 'home.express.title', label: 'الاستشارة السريعة: العنوان', multiline: false },
  { key: 'home.express.subtitle', label: 'الاستشارة السريعة: الوصف', multiline: true },
  { key: 'home.express.note', label: 'الاستشارة السريعة: ملاحظة أسفل الزر', multiline: false },
  { key: 'home.feature1.title', label: 'ميزة 1: العنوان', multiline: false },
  { key: 'home.feature1.desc', label: 'ميزة 1: الوصف', multiline: true },
  { key: 'home.feature2.title', label: 'ميزة 2: العنوان', multiline: false },
  { key: 'home.feature2.desc', label: 'ميزة 2: الوصف', multiline: true },
  { key: 'home.feature3.title', label: 'ميزة 3: العنوان', multiline: false },
  { key: 'home.feature3.desc', label: 'ميزة 3: الوصف', multiline: true },
  { key: 'home.feature4.title', label: 'ميزة 4: العنوان', multiline: false },
  { key: 'home.feature4.desc', label: 'ميزة 4: الوصف', multiline: true },
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
  { key: 'consultations.heroTitle', label: 'عنوان الهيرو', multiline: false },
  { key: 'consultations.heroSubtitle', label: 'وصف الهيرو', multiline: true },
  { key: 'consultations.heroSub', label: 'نص تعريفي ثانوي', multiline: false },
  { key: 'consultations.ctaText', label: 'نص زر الحجز', multiline: false },
  { key: 'consultations.badge', label: 'نص الشارة', multiline: false },
  { key: 'consultations.howTitle', label: 'عنوان قسم "كيف يعمل"', multiline: false },
  { key: 'consultations.step1', label: 'الخطوة الأولى', multiline: false },
  { key: 'consultations.step2', label: 'الخطوة الثانية', multiline: false },
  { key: 'consultations.step3', label: 'الخطوة الثالثة', multiline: false },
  { key: 'express.price.EGP', label: 'سعر الجلسة السريعة (جنيه)', multiline: false },
  { key: 'express.price.SAR', label: 'سعر الجلسة السريعة (ريال)', multiline: false },
  { key: 'express.price.USD', label: 'سعر الجلسة السريعة (دولار)', multiline: false },
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
  { key: 'joinus.heroTitle', label: 'عنوان الهيرو', multiline: false },
  { key: 'joinus.heroSubtitle', label: 'وصف الهيرو', multiline: true },
  { key: 'joinus.heroBadge', label: 'نص الشارة', multiline: false },
  { key: 'joinus.stats.students', label: 'إحصائية الطلاب', multiline: false },
  { key: 'joinus.stats.countries', label: 'إحصائية الدول', multiline: false },
  { key: 'joinus.stats.programs', label: 'إحصائية البرامج', multiline: false },
  { key: 'joinus.benefits.title', label: 'عنوان قسم المزايا', multiline: false },
  { key: 'joinus.benefits.subtitle', label: 'وصف قسم المزايا', multiline: true },
  { key: 'joinus.form.title', label: 'عنوان النموذج', multiline: false },
  { key: 'joinus.form.subtitle', label: 'وصف النموذج', multiline: false },
];

export const pageCommunityFields: ContentField[] = [
  { key: 'community.heroTitle', label: 'عنوان الهيرو', multiline: false },
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
  tab: string;
  /** Sub-tab inside content_hub, when the editor lives there. */
  subTab?: string;
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
  [{ tab: 'content_hub', subTab: 'policies', label: 'المحتوى ← السياسات القانونية' },
    policySections.flatMap(s => s.fields.map(f => f.key))],
  [{ tab: 'content_hub', subTab: 'footer_settings', label: 'المحتوى ← إعدادات الفوتر' },
    ['footer.description', 'footer.phone', 'footer.email', 'footer.whatsapp', 'footer.address',
      'footer.facebook', 'footer.instagram', 'footer.youtube', 'institute.logo']],
];

const KEY_OWNER = new Map<string, ContentEditorHome>();
for (const [home, keys] of OWNED_KEYS) {
  for (const key of keys) KEY_OWNER.set(key, home);
}

/** The one editor that owns this key, or null when the raw table is its home. */
export function contentEditorFor(key: string): ContentEditorHome | null {
  return KEY_OWNER.get(key) ?? null;
}

/** Every key that has a dedicated editor — used by tests and the raw table. */
export const OWNED_CONTENT_KEYS: ReadonlySet<string> = new Set(KEY_OWNER.keys());
