// ── Static content-field definitions for the site-content editor ─────────────
// Extracted from Dashboard.tsx (stage 1 of the Dashboard decomposition).
// Pure configuration: each entry maps a site_config content key to its Arabic
// editor label. No component state involved.

import type { TabKey } from './navigation';

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
  { key: 'courseDetails.promo.videoUrl', label: 'الفيديو التعريفي — رابط الفيديو', multiline: false },
  { key: 'courseDetails.gallery.certificateUrl', label: 'المعرض — رابط صورة الشهادة', multiline: false },
  { key: 'courseDetails.previewLectureLimit', label: 'عدد محاضرات المعاينة', multiline: false },
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
  { key: 'bundleDetails.gallery.motivational', label: 'المعرض — صورة تحفيزية', multiline: false },
];

// ── Consultations, express session, payment note, favicon ────────────────────
// Scattered singles the site reads and the panel never exposed.
export const pageMiscFields: ContentField[] = [
  { key: 'institute.favicon', label: 'رابط أيقونة المتصفح (favicon)', multiline: false },
  { key: 'consultation.expressImage', label: 'صورة قسم الجلسة السريعة', multiline: false },
  { key: 'finance.payment_instructions', label: 'تعليمات الدفع المعروضة للعميل', multiline: true },
  { key: 'consult.express.badge', label: 'الجلسة السريعة — الشارة', multiline: false },
  { key: 'consult.express.desc', label: 'الجلسة السريعة — الوصف', multiline: true },
  { key: 'consult.express.timeLabel', label: 'الجلسة السريعة — تسمية الوقت', multiline: false },
  { key: 'consult.express.timeValue', label: 'الجلسة السريعة — قيمة الوقت', multiline: false },
  { key: 'consult.cancelPolicy', label: 'سياسة الإلغاء', multiline: true },
  { key: 'express.therapistId', label: 'therapistId', multiline: false },
  { key: 'home.featured.courseId', label: 'featured.courseId', multiline: false },
  { key: 'home.featured.discountPercent', label: 'featured.discountPercent', multiline: false },
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
