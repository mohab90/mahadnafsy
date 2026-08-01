import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DiscountRule, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, SubscriberItem, CourseLectureItem, CourseChapterItem, TestimonialItem, CommunityComment, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlForms } from '../lib/mysqlapi';
import { useAuth } from './AuthContext';
import { useActivityLog } from './site-data-hooks/useActivityLog';
import { useCurrency } from './site-data-hooks/useCurrency';
import { useSiteContent } from './site-data-hooks/useSiteContent';
import { useDiscounts } from './site-data-hooks/useDiscounts';
import { useNotifications } from './site-data-hooks/useNotifications';
import { useLiveStreams } from './site-data-hooks/useLiveStreams';
import { useCourseCurriculum } from './site-data-hooks/useCourseCurriculum';
import { useCommunityData } from './site-data-hooks/useCommunityData';
import { useQuizzes } from './site-data-hooks/useQuizzes';
import { useClientAccountRuntime } from './site-data-hooks/useClientAccountRuntime';
import { readVersionedCache, writeVersionedCache } from '../../shared/siteDataCache';
import { useCatalogData } from './site-data-hooks/useCatalogData';

interface SiteDataShape {
  courses: Course[];
  bundles: Bundle[];
  therapists: Therapist[];
  testimonials: TestimonialItem[];
  subscribers: SubscriberItem[];
  isStaff: boolean;
  consultations: ConsultationItem[];
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];
  content: Record<string, string>;
  discounts: DiscountRule[];
  notifications: NotificationBroadcast[];
  notificationReadIds: string[];
  markBroadcastNotificationRead: (id: string) => Promise<boolean>;
  markAllBroadcastNotificationsRead: () => Promise<boolean>;
  addJoinUsApplication: (item: JoinUsApplication) => Promise<void>;
  addContactMessage: (item: ContactMessage) => Promise<void>;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  addCommunityPost: (item: CommunityPostItem) => Promise<void>;
  updateCommunityPost: (item: CommunityPostItem) => Promise<void>;
  deleteCommunityPost: (id: string) => Promise<void>;
  toggleCommunityPostLike: (id: string) => Promise<{ liked: boolean; likes: number }>;
  addCommunityPostComment: (id: string, body: string) => Promise<CommunityComment>;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  courseQuizzes: CourseQuiz[];
  quizAttempts: QuizAttempt[];
  submitQuizAttempt: (quiz: CourseQuiz, subscriberId: string, answers: number[]) => Promise<{ score: number; passed: boolean }>;
  liveStreams: LiveStream[];
  currency: Currency;
  setCurrency: (c: Currency) => void;
  authUser: AuthUser | null | undefined;
  isAdmin: boolean;
  remoteReady: boolean;
  mySubscriberLoaded: boolean;
  /** Subscriber the server resolved for this account; null when signed out or
   *  when the account has no subscriber record. Screens must use this instead
   *  of matching authUser.email, which is null for WhatsApp-only clients. */
  mySubscriberId: string | null;
  refreshMySubscriber: () => void;
  reloadLectures: () => Promise<void>;
  logout: () => void;
  refreshAuth: () => void;
}

const STORAGE_KEY = 'mahad-admin-site-data-v1';
const DATA_VERSION = 4; // v4 removes CRM/HR/finance/customer data from browser persistence


// Keys whose old values must be replaced with the new default — even if Firestore has the old value.

const defaultContent: Record<string, string> = {
  'home.hero.badge': 'مستقبلك المهني يبدأ من هنا',
  'home.heroTitle': 'رحلة علم ووعي تغير حياتك للأفضل',
  'home.heroSubtitle': 'المنصة الأكاديمية الأولى عربيا لتعليم الصحة النفسية والعلاج النفسي. دبلومات معتمدة، تدريب عملي، ونخبة من الخبراء.',
  'home.hero.primaryCta': 'تصفح الدبلومات',
  'home.hero.secondaryCta': 'استشارة أونلاين',
  'home.hero.feature1': 'اعتماد دولي ومحلي',
  'home.hero.feature2': 'مدربون خبراء',
  'home.hero.certificateTitle': 'شهادة معتمدة',
  'home.hero.certificateSubtitle': 'موثقة برقم تسلسلي',
  'home.hero.trustCount': '+12,000',
  'home.hero.trustLabel': 'طالب يثقون بنا',
  'home.stats.programs': '50+',
  'home.stats.programsLabel': 'برنامج تدريبي',
  'home.stats.experts': '30+',
  'home.stats.expertsLabel': 'خبير ومدرب',
  'home.stats.graduates': '12K',
  'home.stats.graduatesLabel': 'خريج',
  'home.stats.rating': '4.9',
  'home.paths.badge': 'الطريق المختصر للاحتراف',
  'home.paths.title': 'المسارات التعليمية الكاملة',
  'home.paths.subtitle': 'وفر وقتك ومالك مع باقاتنا المجمعة التي تضم مجموعة من الدبلومات في تخصص معين بخصومات تصل إلى 40%',
  'home.paths.viewAll': 'عرض جميع المسارات',
  'home.bestSellers.badge': 'الأكثر طلباً',
  'home.bestSellers.title': 'الدبلومات الأكثر مبيعاً',
  'home.bestSellers.viewAll': 'عرض الكل',
  'home.offer.badge': 'عرض لمدة 24 ساعة فقط',
  'home.offer.title': 'دبلومة العلاج السلوكي الجدلي (DBT)',
  'home.offer.description': 'احصل على الدبلومة الأكثر طلباً في سوق العمل بسعر لا يصدق. العرض يشمل الحقيبة التدريبية كاملة + 3 جلسات إشراف مجانية.',
  'home.offer.oldPrice': '4500 ج.م',
  'home.offer.newPrice': '2500 ج.م',
  'home.offer.discount': 'خصم 45%',
  'home.offer.validUntil': 'ساري حتى منتصف الليل',
  'home.offer.formBadge': 'سجل الآن واضمن السعر',
  'home.offer.registerFor': 'دبلومة العلاج السلوكي الجدلي (عرض 24س)',
  'home.offer.formNameLabel': 'الاسم الكامل',
  'home.offer.formNamePlaceholder': 'الاسم الثلاثي',
  'home.offer.formPhoneLabel': 'رقم الهاتف (واتساب)',
  'home.offer.formPhonePlaceholder': '01xxxxxxxxx',
  'home.offer.formBranchLabel': 'الفرع الأقرب',
  'home.offer.formBranchOnline': 'أونلاين (Zoom)',
  'home.offer.formBranchCairo': 'القاهرة - مصر الجديدة',
  'home.offer.formBranchGiza': 'الجيزة - الدقي',
  'home.offer.registerButton': 'حجز العرض الآن',
  'home.offer.registerNote': 'سيقوم فريق المبيعات بالتواصل معك لتأكيد الحجز والدفع',
  'home.video.title': 'جولة داخل المعهد',
  'home.video.subtitle': 'تعرف على بيئة التعلم، قاعات التدريب، وفلسفتنا في تقديم المحتوى العلمي.',
  'home.feature1.title': 'اعتماد مهني حقيقي',
  'home.feature1.desc': 'جميع برامجنا معتمدة مهنياً وتحمل شهادات تستحق وزناً حقيقياً في سوق العمل.',
  'home.feature2.title': 'تدريب تطبيقي مكثف',
  'home.feature2.desc': '70% من البرنامج تدريب عملي مع نماذج حالات حقيقية وجلسات إشراف مباشر.',
  'home.feature3.title': 'محتوى لمدى الحياة',
  'home.feature3.desc': 'بعد الاشتراك تحتفظ بوصول كامل لجميع المحاضرات والمراجع مدى الحياة بدون رسوم إضافية.',
  'home.feature4.title': 'مجتمع متخصصين',
  'home.feature4.desc': 'انضم لأكثر من 12ألف متخصص من جميع أنحاء الوطن العربي وتبادل الخبرات.',
  'footer.phone': '+20 100 000 0000',
  'footer.email': 'info@psy-institute.com',
  'footer.address': 'القاهرة، مصر الجديدة',
  'footer.facebook': '',
  'footer.instagram': '',
  'footer.youtube': '',
  'footer.whatsapp': '201096203090',
  'footer.description': 'نعمل تحت شعار “رحلة علم ووعي، تغير حياتك للأفضل”. نقدم دبلومات معتمدة في الصحة النفسية والعلاج النفسي.',
  'home.testimonials.title': 'ماذا يقول عملاؤنا؟',
  'home.testimonials.subtitle': 'قصص نجاح حقيقية من خريجي المعهد',
  'courses.title': 'الدبلومات والبرامج التدريبية',
  'courses.subtitle': 'استثمر في مستقبلك المهني مع أحدث البرامج التدريبية في علم النفس',
  'courses.searchPlaceholder': 'ابحث عن دبلومة...',
  'courses.filterLabel': 'تصفية حسب:',
  'courses.types.all': 'كل الأنظمة',
  'courses.types.recorded': 'مسجل',
  'courses.types.live': 'بث مباشر',
  'courses.types.mix': 'مختلط',
  'courses.categories.all': 'كل التخصصات',
  'courses.categories.therapy': 'علاج نفسي',
  'courses.categories.child': 'أطفال ومراهقين',
  'courses.categories.diagnosis': 'تشخيص',
  'courses.emptyState': 'لا توجد كورسات مطابقة لبحثك.',
  'instructors.title': 'نخبة المدربين والخبراء',
  'instructors.subtitle': 'تعلم على يد أفضل الأطباء والمعالجين النفسيين في الوطن العربي.',
  'instructors.card.bioFallback': 'خبير متخصص في مجاله مع سنوات عديدة من الخبرة الأكاديمية والعملية...',
  'instructors.card.experienceSuffix': 'سنة خبرة',
  'instructors.card.profileCta': 'عرض الملف الشخصي',
  'bundles.title': 'المسارات التعليمية والباقات',
  'bundles.subtitle': 'خطط دراسية متكاملة تأخذ بيدك من البداية وحتى الاحتراف.',
  'bundles.info.pathsTitle': 'مسارات التعلم (Learning Paths)',
  'bundles.info.pathsDesc': 'خطة منهجية مرتبة خطوة بخطوة. لا تحتاج للتفكير "بم أبدأ؟"، نحن نرسم لك الطريق لتصبح متخصصاً محترفاً.',
  'bundles.info.bundlesTitle': 'الباقات المجمعة (Bundles)',
  'bundles.info.bundlesDesc': 'مجموعة كورسات في تخصص معين بسعر مخفض جداً مقارنة بشراء كل كورس بمفرده.',
  'bundles.card.badge': 'مسار كامل',
  'bundles.card.oldPricePrefix': 'بدلاً من',
  'bundles.card.detailsCta': 'عرض تفاصيل المسار',
  'bundles.card.journeyTitle': 'رحلة التعلم',
  'bundles.card.stationsLabel': 'محطات',
  'bundles.benefits.certificate': 'شهادة مجمعة للمسار',
  'bundles.benefits.supervision': 'إشراف مهني مجاني',
  'courseDetails.notFound': 'الكورس غير موجود',
  'courseDetails.category.therapy': 'علاج نفسي',
  'courseDetails.category.general': 'صحة نفسية',
  'courseDetails.type.mix': 'نظام هجين (مسجل + لايف)',
  'courseDetails.type.live': 'بث مباشر تفاعلي',
  'courseDetails.type.recorded': 'مسجل بجودة عالية',
  'courseDetails.studentsSuffix': 'طالب مشترك',
  'courseDetails.certificateBadge': 'شهادة معتمدة',
  'courseDetails.instructorLabel': 'مدرب الدبلومة',
  'courseDetails.price.originalLabel': 'السعر الرسمي:',
  'courseDetails.price.discountBadge': 'خصم لفترة محدودة',
  'courseDetails.price.cta': 'احجز الآن واستفد بخصم إضافي',
  'courseDetails.price.feature1': 'وصول لمدة سنة واحدة للمحتوى',
  'courseDetails.price.feature2': 'شهادة إتمام موثقة برقم تسلسلي',
  'courseDetails.price.feature3': 'المادة العلمية + نماذج العمل',
  'courseDetails.actions.share': 'مشاركة',
  'courseDetails.actions.whatsapp': 'استفسار واتساب',
  'courseDetails.promo.title': 'شاهد مقدمة تعريفية',
  'courseDetails.promo.subtitle': 'تعرف على محتويات الدبلومة في دقيقتين',
  'courseDetails.pain.title': 'هل هذه الدبلومة لك؟',
  'courseDetails.pain.leftTitle': 'إذا كنت تعاني من:',
  'courseDetails.pain.left1': 'صعوبة في تطبيق النظريات عملياً داخل العيادة.',
  'courseDetails.pain.left2': 'عدم الثقة في التشخيص وصياغة الحالة.',
  'courseDetails.pain.left3': 'نقص الأدوات والفنيات العلاجية الحديثة.',
  'courseDetails.pain.rightTitle': 'فإن هذه الدبلومة ستمنحك:',
  'courseDetails.pain.right1': 'تدريب عملي مكثف ورول بلاي (Role Play).',
  'courseDetails.pain.right2': 'نماذج جاهزة لصياغة الحالة والتقييم.',
  'courseDetails.pain.right3': 'ثقة كاملة لإدارة الجلسات العلاجية.',
  'courseDetails.about.title': 'تفاصيل البرنامج التدريبي',
  'courseDetails.about.extraParagraph': 'تم تصميم هذا المنهج ليناسب المعايير الدولية في التدريب النفسي، حيث نركز على الجانب التطبيقي بنسبة 70% مقابل 30% للجانب النظري. ستحصل على حقيبة تدريبية كاملة تحتوي على المقاييس، استمارات التقييم، ودليل المعالج.',
  'courseDetails.curriculum.title': 'المنهج الدراسي (Modules)',
  'courseDetails.curriculum.item1': 'محتوى تفصيلي لهذا المديول يتضمن الشرح النظري.',
  'courseDetails.curriculum.item2': 'تطبيقات عملية وورش عمل تفاعلية.',
  'courseDetails.curriculum.item3': 'اختبار قصير للتأكد من استيعاب المعلومات.',
  'courseDetails.faq.title': 'أسئلة شائعة',
  'courseDetails.faq.q1': 'هل الشهادة معتمدة؟',
  'courseDetails.faq.a1': 'نعم، الشهادة معتمدة من المعهد وتحمل كود تحقق (QR Code). كما يمكن توثيقها من الخارجية وجهات دولية برسوم إضافية.',
  'courseDetails.faq.q2': 'هل يمكنني مشاهدة المحاضرات لاحقاً؟',
  'courseDetails.faq.a2': 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.',
  'courseDetails.gallery.title': 'معرض الخريجين والاعتمادات',
  'courseDetails.gallery.certificateSubtitle': 'شهادة موثقة قابلة للتحقق عبر QR Code',
  'courseDetails.gallery.previewCta': 'معاينة',
  'courseDetails.lead.title': 'لست متأكداً؟ سجل اهتمامك وسنتواصل معك',
  'courseDetails.lead.subtitle': 'املأ النموذج أدناه وسيقوم أحد مستشارينا الأكاديميين بالتواصل معك للإجابة على جميع استفساراتك.',
  'courseDetails.lead.namePlaceholder': 'الاسم الكامل',
  'courseDetails.lead.phonePlaceholder': 'رقم الهاتف',
  'courseDetails.lead.branchPlaceholder': 'اختر الفرع الأقرب إليك',
  'courseDetails.lead.branchOnline': 'أونلاين (عن بعد)',
  'courseDetails.lead.branchCairo': 'القاهرة - مصر الجديدة',
  'courseDetails.lead.branchGiza': 'الجيزة - الدقي',
  'courseDetails.lead.branchAlex': 'الإسكندرية',
  'courseDetails.lead.submit': 'إرسال الطلب',
  'courseDetails.sidebar.title': 'دبلومات قد تهمك',
  'courseDetails.mobile.oldPricePrefix': 'بدلاً من',
  'courseDetails.mobile.cta': 'احجز الآن واستفد بخصم',
  'bundleDetails.notFound': 'المسار غير موجود',
  'bundleDetails.hero.badge': 'مسار تعليمي شامل',
  'bundleDetails.path.title': 'خريطة المسار التعليمي',
  'bundleDetails.path.stationPrefix': 'المحطة',
  'bundleDetails.path.finalTitle': 'إتمام المسار والاعتماد',
  'bundleDetails.path.finalDesc': 'بعد إجتياز جميع الدبلومات والاختبارات، تحصل على شهادة "معالج نفسي ممارس" وتصبح مؤهلاً للعمل.',
  'bundleDetails.why.jobsTitle': 'فرص العمل',
  'bundleDetails.why.jobs1': 'العمل في العيادات والمراكز النفسية.',
  'bundleDetails.why.jobs2': 'العمل الحر (Freelance) كأخصائي أونلاين.',
  'bundleDetails.why.jobs3': 'العمل في المدارس والمؤسسات التعليمية.',
  'bundleDetails.why.skillsTitle': 'المهارات المكتسبة',
  'bundleDetails.why.skills1': 'التشخيص وصياغة الحالة بدقة.',
  'bundleDetails.why.skills2': 'تطبيق خطط العلاج النفسي الحديثة.',
  'bundleDetails.why.skills3': 'مهارات المقابلة العيادية وإدارة الجلسة.',
  'bundleDetails.form.title': 'انضم لهذا المسار التدريبي',
  'bundleDetails.form.subtitle': 'سجل بياناتك وسيتم التواصل معك لتوضيح تفاصيل الدفع والجدول الزمني',
  'bundleDetails.form.nameLabel': 'الاسم الكامل',
  'bundleDetails.form.namePlaceholder': 'الاسم كما يظهر في الشهادة',
  'bundleDetails.form.phoneLabel': 'رقم الهاتف',
  'bundleDetails.form.phonePlaceholder': 'موبايل / واتساب',
  'bundleDetails.form.branchLabel': 'الفرع المفضل',
  'bundleDetails.form.branchOnline': 'أونلاين (Zoom)',
  'bundleDetails.form.branchCairo': 'مقر المعهد (القاهرة)',
  'bundleDetails.form.submit': 'تسجيل طلب الالتحاق',
  'bundleDetails.sidebar.title': 'استثمارك في هذا المسار',
  'bundleDetails.sidebar.savePrefix': 'توفر',
  'bundleDetails.sidebar.cta': 'احجز الآن واستفد بخصم إضافي',
  'bundleDetails.sidebar.featureCoursesSuffix': 'دبلومات كاملة',
  'bundleDetails.sidebar.featureCertificates': 'شهادات فردية + شهادة مجمعة',
  'bundleDetails.sidebar.featureSupervision': 'إشراف مهني لمدة 3 أشهر',
  'about.heroTitle': 'عن المعهد',
  'about.heroSubtitle': 'رواد التعليم النفسي في الوطن العربي منذ عام 2010',
  'about.storyBadge': 'قصتنا',
  'about.storyTitle': 'كيف بدأت الرحلة؟',
  'about.storyParagraph1': 'تأسس معهد الدراسات النفسية في عام 2010 بجهود نخبة من أساتذة الطب النفسي وعلم النفس في مصر، بهدف سد الفجوة بين الدراسة النظرية في الجامعات والواقع العملي في العيادات والمستشفيات.',
  'about.storyParagraph2': 'بدأنا كمركز تدريب صغير، واليوم نفتخر بتخريج أكثر من 12,000 متخصص يعملون في كبرى المؤسسات العلاجية في الوطن العربي. نحن نؤمن بأن المعالج النفسي المحترف يحتاج إلى أكثر من مجرد كتب؛ يحتاج إلى تدريب حي وممارسة حقيقية.',
  'about.stats.graduates': '12K+',
  'about.stats.programs': '50+',
  'about.stats.countries': '15+',
  'about.stats.years': '13',
  'about.team.title': 'فريق العمل والإدارة',
  'about.team.subtitle': 'نخبة من القادة الأكاديميين والإداريين',
  'privacy.title': 'سياسة الخصوصية',
  'privacy.s1.title': '1. مقدمة',
  'privacy.s1.body': 'نحن في معهد الدراسات النفسية نولي اهتماماً كبيراً لخصوصية زوارنا وعملائنا. توضح هذه السياسة كيفية جمعنا واستخدامنا وحمايتنا لمعلوماتك الشخصية.',
  'privacy.s2.title': '2. المعلومات التي نجمعها',
  'privacy.s2.item1': 'المعلومات الشخصية (الاسم، البريد الإلكتروني، رقم الهاتف) عند التسجيل.',
  'privacy.s2.item2': 'بيانات الدفع (يتم معالجتها بشكل آمن عبر مزودي خدمة الدفع ولا يتم تخزينها لدينا).',
  'privacy.s2.item3': 'سجلات التعلم (الدورات المشاهدة، الشهادات، نتائج الاختبارات).',
  'privacy.s3.title': '3. كيف نستخدم معلوماتك',
  'privacy.s3.body': 'نستخدم المعلومات لتقديم خدماتنا التعليمية، إصدار الشهادات، التواصل معك بخصوص التحديثات، وتحسين تجربة المستخدم في الموقع.',
  'privacy.s4.title': '4. خصوصية الاستشارات النفسية',
  'privacy.s4.lead': 'نلتزم بأعلى معايير السرية المهنية.',
  'privacy.s4.body': 'جميع بيانات الجلسات الاستشارية (سواء النصية أو المرئية) مشفرة تماماً ولا يتم الاطلاع عليها من قبل أي طرف ثالث. الهوية يمكن أن تكون مجهولة في خدمة "الاستشارة السريعة".',
  'privacy.s5.title': '5. مشاركة البيانات',
  'privacy.s5.body': 'لا نقوم ببيع أو تأجير بياناتك الشخصية لأي طرف ثالث. قد نشارك البيانات فقط مع شركاء الخدمة الضروريين (مثل بوابات الدفع) لإتمام العمليات.',
  'terms.title': 'الشروط والأحكام',
  'terms.s1.title': '1. قبول الشروط',
  'terms.s1.body': 'باستخدامك لموقع معهد الدراسات النفسية، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق على أي جزء منها، فلا يحق لك استخدام الموقع.',
  'terms.s2.title': '2. حقوق الملكية الفكرية',
  'terms.s2.body': 'جميع المحتويات الموجودة على الموقع (نصوص، صور، فيديوهات، مواد تعليمية) هي ملكية حصرية للمعهد ومحمية بموجب قوانين حقوق النشر. يمنع نسخ أو توزيع أو بيع أي محتوى دون إذن كتابي.',
  'terms.s3.title': '3. سياسة الاسترجاع',
  'terms.s3.item1': 'يمكن استرداد رسوم الكورسات المسجلة خلال 14 يوم من الشراء بشرط عدم مشاهدة أكثر من 20% من المحتوى.',
  'terms.s3.item2': 'الدبلومات الأونلاين (Live): لا يمكن استرداد المبلغ بعد بدء الدراسة بأسبوع.',
  'terms.s3.item3': 'الاستشارات: يمكن إلغاء الحجز قبل الموعد بـ 24 ساعة لاسترداد المبلغ كاملاً.',
  'terms.s4.title': '4. سلوك المستخدم',
  'terms.s4.body': 'يجب استخدام مجتمع المعهد والمنتديات بشكل لائق. يحظر نشر أي محتوى مسيء، عنصري، أو ينتهك خصوصية الآخرين. يحتفظ المعهد بحق إيقاف حساب أي مستخدم يخالف هذه القواعد.',
  'terms.s5.title': '5. إخلاء المسؤولية',
  'terms.s5.body': 'المحتوى التعليمي المقدم هو لأغراض التدريب والتوعية. لا يعتبر بديلاً عن العلاج الطبي أو النفسي المتخصص في حالات الطوارئ الطبية.',
  'institute.gallery.title': 'معرض صور المعهد',
  'institute.gallery.subtitle': 'صور من القاعات، الفعاليات، والأنشطة التدريبية داخل المعهد.',
  'institute.gallery.images': JSON.stringify([]),
  'extra_cert_pricing': '{}',
  'express.therapistId': '',
  'express.price.EGP': '300',
  'express.price.SAR': '100',
  'express.price.USD': '20',
  'joinus.heroBadge': 'فرصة انضمام للنخبة',
  'joinus.heroTitle': 'انضم إلينا كمحاضر أو مستشار نفسي',
  'joinus.heroSubtitle': 'هل أنت خبير في مجال الصحة النفسية؟ شارك علمك مع الآلاف وكن جزءاً من مسيرة التغيير الحقيقي في مجال الصحة النفسية العربية.',
  'joinus.stats.students': '12K+',
  'joinus.stats.countries': '15+',
  'joinus.stats.programs': '50+',
  'joinus.benefits.title': 'مزايا الانضمام لفريقنا',
  'joinus.benefits.subtitle': 'نؤمن بأن الخبير الجيد يستحق بيئة تُبرز موهبته وتوصل علمه لأوسع شريحة.',
  'joinus.form.title': 'قدّم طلبك الآن',
  'joinus.form.subtitle': 'سيتواصل معك فريقنا خلال 3–5 أيام عمل لمراجعة طلبك.',
  'community.heroTitle': 'المجتمع النفسي المتخصص',
  'community.heroSubtitle': 'مساحة آمنة ومتخصصة لتبادل الخبرات ومناقشة الحالات والنمو المهني بين المتخصصين في الصحة النفسية',
  'community.discussions.title': 'ساحة النقاش',
  'community.library.title': 'المكتبة الرقمية',
  'community.events.title': 'الفعاليات',
  'community.videos.title': 'ورش ومحاضرات',
};

const defaultSubscribers: SubscriberItem[] = [];

const defaultConsultations: ConsultationItem[] = [];

const defaultLectures: CourseLectureItem[] = COURSES.flatMap((course) =>
  course.modules.map((moduleTitle, idx) => ({
    id: `lec-${course.id}-${idx + 1}`,
    courseId: course.id,
    title: moduleTitle,
    lectureType: 'recorded' as const,
    videoUrl: `https://example.com/lecture/${course.id}/${idx + 1}`,
    duration: '45 دقيقة',
    order: idx + 1,
  }))
);

const defaultCommunityPosts: CommunityPostItem[] = [];

const defaultCommunityLibraryItems: CommunityLibraryItem[] = [];

const defaultCommunityVideos: CommunityVideoItem[] = [];

const defaultCommunityEvents: CommunityEventItem[] = [];

// NOTE: seedData is used ONLY on the very first run when no saved data exists.
// Once real data is loaded from Firestore or localStorage, seedData is never used again.
// Do NOT add real production records here — they will be overwritten on next Firestore sync.
const seedData = {
  courses: COURSES,
  bundles: BUNDLES,
  therapists: THERAPISTS,
  testimonials: TESTIMONIALS,
  subscribers: defaultSubscribers,
  consultations: defaultConsultations,
  lectures: defaultLectures,
  chapters: [] as CourseChapterItem[],
  communityPosts: defaultCommunityPosts,
  communityLibraryItems: defaultCommunityLibraryItems,
  communityVideos: defaultCommunityVideos,
  communityEvents: defaultCommunityEvents,
  content: defaultContent,
  discounts: [] as DiscountRule[],
  notifications: [] as NotificationBroadcast[],
};

const SiteDataContext = createContext<SiteDataShape | null>(null);

export const SiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = (() => {
    const cached = readVersionedCache<typeof seedData>(STORAGE_KEY, DATA_VERSION);
    if (!cached) return seedData;
    return { ...seedData, ...cached, content: { ...defaultContent, ...(cached.content || {}) } };
  })();

  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initial.consultations || defaultConsultations);
  const { authUser, logout, refreshAuth } = useAuth();
  const isAdmin = Boolean(authUser?.isAdmin);
  const { track } = useActivityLog(authUser, []);
  const { currency, setCurrency } = useCurrency();
  const { content, mergeContent } = useSiteContent(initial.content);
  const { discounts } = useDiscounts((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || []);
  const { notifications, readIds: notificationReadIds, markRead: markBroadcastNotificationRead, markAllRead: markAllBroadcastNotificationsRead } = useNotifications(
    (initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [],
    authUser?.uid,
    isAdmin,
  );
  const { liveStreams } = useLiveStreams(
    (initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [],
    authUser?.uid,
    isAdmin,
  );
  const {
    setLectures, setChapters,
    getCourseChapters, getCourseLectures, reloadLectures,
  } = useCourseCurriculum(initial.lectures || defaultLectures, initial.chapters || []);
  const {
    communityPosts, setCommunityPosts, communityLibraryItems, setCommunityLibraryItems,
    communityVideos, setCommunityVideos, communityEvents, setCommunityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    toggleCommunityPostLike, addCommunityPostComment,
  } = useCommunityData(
    initial.communityPosts || defaultCommunityPosts,
    initial.communityLibraryItems || defaultCommunityLibraryItems,
    initial.communityVideos || defaultCommunityVideos,
    initial.communityEvents || defaultCommunityEvents,
    track,
  );
  const {
    courseQuizzes, quizAttempts, submitQuizAttempt,
  } = useQuizzes(
    (initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || [],
    (initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || [],
    authUser, isAdmin, subscribers, track,
  );
  const {
    courses, setCourses, bundles, therapists, testimonials,
    remoteReady,
  } = useCatalogData({
    initialCourses: initial.courses, initialBundles: initial.bundles,
    initialTherapists: initial.therapists, initialTestimonials: initial.testimonials,
    isAdmin, authUserUid: authUser?.uid, mergeContent,
    setLectures, setChapters,
    setCommunityPosts, setCommunityLibraryItems, setCommunityVideos, setCommunityEvents,
  });
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)



  const { mySubscriberLoaded, mySubscriberId, refreshMySubscriber, isStaff } = useClientAccountRuntime({
    authUser,
    isAdmin,
    setSubscribers,
    setCourses,
    setConsultations,
  });

  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      track('create', 'lead', item.name);
    } catch (error) {
      // Public forms must never report success for a lead that only exists in
      // browser memory. Surface the server failure to the page instead.
      throw error instanceof Error ? error : new Error('تعذر حفظ طلبك. حاول مرة أخرى.');
    }
  };


  // Updates local state only — no API call. Use for bulk auto-convert on mount.



  // Batch-assign client codes — write only the changed documents to their collections.





  // (Orders CRUD removed — orders are managed in the admin app; client checkout talks to the API directly)

  // (Expenses & Daqqi-rounds CRUD removed — admin-app-only features)

  const addJoinUsApplication = async (item: JoinUsApplication): Promise<void> => {
    await mysqlForms.submitJoinUs(item as unknown as Record<string, unknown>);
    track('create', 'joinUs', item.name);
  };

  const addContactMessage = async (item: ContactMessage): Promise<void> => {
    await mysqlForms.submitContact({
      name: item.name,
      email: item.email,
      phone: (item as ContactMessage & { phone?: string }).phone || '',
      subject: item.subject,
      message: item.message,
    } as unknown as Record<string, unknown>);
    track('create', 'contactMessage', item.name);
  };

  // ── Public catalog cache only. Customer/CRM/HR/finance data is server-owned
  // and must never be copied into localStorage where origin scripts can read it.
  useEffect(() => {
    const payloadObject = {
      courses,
      bundles,
      therapists,
      testimonials,
      communityPosts,
      communityLibraryItems,
      communityVideos,
      communityEvents,
      content,
      discounts,
      notifications,
      liveStreams,
    };
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      writeVersionedCache(STORAGE_KEY, DATA_VERSION, payloadObject);
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [courses, bundles, therapists, testimonials, communityPosts, communityLibraryItems, communityVideos, communityEvents, content, discounts, notifications, liveStreams]);

  // (AI/messaging settings persist removed — admin-app-only)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<SiteDataShape>(() => ({
    courses,
    bundles,
    therapists,
    testimonials,
    subscribers,
    isStaff,
    consultations,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    content,
    discounts,
    notifications,
    notificationReadIds,
    markBroadcastNotificationRead,
    markAllBroadcastNotificationsRead,
    addPublicLead,
    getCourseChapters,
    addCommunityPost,
    updateCommunityPost,
    deleteCommunityPost,
    toggleCommunityPostLike,
    addCommunityPostComment,
    getCourseLectures,
    courseQuizzes,
    quizAttempts,
    submitQuizAttempt,
    liveStreams,
    addJoinUsApplication,
    addContactMessage,
    currency,
    setCurrency,
    authUser,
    isAdmin,
    remoteReady,
    mySubscriberLoaded,
    mySubscriberId,
    refreshMySubscriber,
    reloadLectures,
    logout,
    refreshAuth,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [courses, bundles, therapists, testimonials, subscribers, isStaff, consultations,
    communityPosts, communityLibraryItems, communityVideos,
    communityEvents, content, discounts, notifications, notificationReadIds, courseQuizzes, quizAttempts,
    liveStreams, currency, authUser, isAdmin, isStaff, remoteReady,
    mySubscriberId, mySubscriberLoaded]);

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
};

export const useSiteData = () => {
  const ctx = useContext(SiteDataContext);
  if (!ctx) {
    throw new Error('useSiteData must be used inside SiteDataProvider');
  }
  return ctx;
};

