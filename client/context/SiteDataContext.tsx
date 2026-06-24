import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DiscountRule, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, LeadStatus, LeadType, BranchType, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, CourseAccessSetting, AutomationWorkflow, AutomationTrigger, PaymentHistoryEntry, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlCatalog, mysqlClient, mysqlForms, mysqlAdmin } from '../lib/mysqlapi';
import { useAuth } from './AuthContext';

interface SiteDataShape {
  courses: Course[];
  bundles: Bundle[];
  therapists: Therapist[];
  testimonials: TestimonialItem[];
  subscribers: SubscriberItem[];
  isStaff: boolean;
  consultations: ConsultationItem[];
  lectures: CourseLectureItem[];
  chapters: CourseChapterItem[];
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];
  content: Record<string, string>;
  activityLogs: ActivityLogItem[];
  discounts: DiscountRule[];
  notifications: NotificationBroadcast[];
  joinUsApplications: JoinUsApplication[];
  addJoinUsApplication: (item: JoinUsApplication) => void;
  updateJoinUsApplication: (item: JoinUsApplication) => void;
  deleteJoinUsApplication: (id: string) => void;
  contactMessages: ContactMessage[];
  addContactMessage: (item: ContactMessage) => void;
  updateContactMessage: (item: ContactMessage) => void;
  deleteContactMessage: (id: string) => void;
  addCourse: (course: Course) => void;
  updateCourse: (course: Course) => void;
  deleteCourse: (id: string) => void;
  addTherapist: (therapist: Therapist) => void;
  updateTherapist: (therapist: Therapist) => void;
  deleteTherapist: (id: string) => void;
  addBundle: (bundle: Bundle) => void;
  updateBundle: (bundle: Bundle) => void;
  deleteBundle: (id: string) => void;
  addTestimonial: (item: TestimonialItem) => void;
  updateTestimonial: (item: TestimonialItem) => void;
  deleteTestimonial: (id: number) => void;
  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (item: SubscriberItem) => void;
  deleteSubscriber: (id: string) => void;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  addConsultation: (item: ConsultationItem) => void;
  updateConsultation: (item: ConsultationItem) => void;
  deleteConsultation: (id: string) => void;
  addLecture: (item: CourseLectureItem) => void;
  updateLecture: (item: CourseLectureItem) => void;
  deleteLecture: (id: string) => void;
  addChapter: (item: CourseChapterItem) => void;
  updateChapter: (item: CourseChapterItem) => void;
  deleteChapter: (id: string) => void;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  addCommunityPost: (item: CommunityPostItem) => void;
  updateCommunityPost: (item: CommunityPostItem) => void;
  deleteCommunityPost: (id: string) => void;
  addCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  updateCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  deleteCommunityLibraryItem: (id: string) => void;
  addCommunityVideo: (item: CommunityVideoItem) => void;
  updateCommunityVideo: (item: CommunityVideoItem) => void;
  deleteCommunityVideo: (id: string) => void;
  addCommunityEvent: (item: CommunityEventItem) => void;
  updateCommunityEvent: (item: CommunityEventItem) => void;
  deleteCommunityEvent: (id: string) => void;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  setContentValue: (key: string, value: string) => void;
  mergeContent: (data: Record<string, string>) => void;
  addContentKey: (key: string, value: string) => void;
  removeContentKey: (key: string) => void;
  clearAllData: () => void;
  addDiscount: (item: DiscountRule) => void;
  updateDiscount: (item: DiscountRule) => void;
  deleteDiscount: (id: string) => void;
  addNotification: (item: NotificationBroadcast) => void;
  updateNotification: (item: NotificationBroadcast) => void;
  deleteNotification: (id: string) => void;
  courseQuizzes: CourseQuiz[];
  addCourseQuiz: (item: CourseQuiz) => void;
  updateCourseQuiz: (item: CourseQuiz) => void;
  deleteCourseQuiz: (id: string) => void;
  quizAttempts: QuizAttempt[];
  addQuizAttempt: (item: QuizAttempt) => void;
  deleteQuizAttempt: (id: string) => void;
  liveStreams: LiveStream[];
  addLiveStream: (item: LiveStream) => void;
  updateLiveStream: (item: LiveStream) => void;
  deleteLiveStream: (id: string) => void;
  automationWorkflows: AutomationWorkflow[];
  addAutomationWorkflow: (item: AutomationWorkflow) => void;
  updateAutomationWorkflow: (item: AutomationWorkflow) => void;
  deleteAutomationWorkflow: (id: string) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  authUser: AuthUser | null | undefined;
  issueClientCode: () => string;
  issueClientCodeAsync: () => Promise<string>;
  isAdmin: boolean;
  remoteReady: boolean;
  mySubscriberLoaded: boolean;
  refreshMySubscriber: () => void;
  reloadLectures: () => Promise<void>;
  logout: () => void;
  refreshAuth: () => void;
  triggerAutomation: (trigger: AutomationTrigger, data?: Record<string, unknown>) => void;
}

const STORAGE_KEY = 'mahad-admin-site-data-v1';
const DATA_VERSION = 3; // bumped to clear seed bundles b1/b2/b3 from localStorage cache

const _parseEnvList = (v: string | undefined) =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean);

// Keys whose old values must be replaced with the new default — even if Firestore has the old value.
const CONTENT_FORCED_UPDATES: Record<string, string> = {
  'courseDetails.price.cta': 'احجز الآن واستفد بخصم إضافي',
  'courseDetails.mobile.cta': 'احجز الآن واستفد بخصم',
  'bundleDetails.sidebar.cta': 'احجز الآن واستفد بخصم إضافي',
  'courseDetails.price.feature1': 'وصول لمدة سنة واحدة للمحتوى',
  'courseDetails.faq.a2': 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.',
};

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

const defaultLeads: LeadItem[] = [];

const defaultStaffMembers: StaffMember[] = [];

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
  leads: defaultLeads,
  staffMembers: defaultStaffMembers,
  consultations: defaultConsultations,
  lectures: defaultLectures,
  chapters: [] as CourseChapterItem[],
  communityPosts: defaultCommunityPosts,
  communityLibraryItems: defaultCommunityLibraryItems,
  communityVideos: defaultCommunityVideos,
  communityEvents: defaultCommunityEvents,
  content: defaultContent,
  activityLogs: [] as ActivityLogItem[],
  discounts: [] as DiscountRule[],
  notifications: [] as NotificationBroadcast[],
};

const SiteDataContext = createContext<SiteDataShape | null>(null);

function nowLabel() {
  return new Date().toLocaleString('ar-EG-u-nu-latn', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return seedData;
      }
      const parsed = JSON.parse(raw);
      // Reject stale Firebase-era cache — force fresh MySQL fetch
      if (parsed._dataVersion !== DATA_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        return seedData;
      }
      // Migrate old-format source strings to structured fields
      const migratedLeads: LeadItem[] = (parsed.leads || seedData.leads).map((lead: LeadItem) => {
        if (!lead.source) return lead;
        // Old format: "طلب كورس - {courseTitle} - {branch}"
        if (lead.source.startsWith('طلب كورس - ')) {
          const withoutPrefix = lead.source.replace('طلب كورس - ', '');
          const lastDash = withoutPrefix.lastIndexOf(' - ');
          const courseTitle = lastDash > 0 ? withoutPrefix.slice(0, lastDash) : withoutPrefix;
          const branchRaw = lastDash > 0 ? withoutPrefix.slice(lastDash + 3) : '';
          const matchedCourse = COURSES.find((c) => c.title === courseTitle);
          return {
            ...lead,
            source: 'تسجيل اهتمام',
            leadType: 'course' as const,
            enrolledCourseId: matchedCourse?.id || lead.enrolledCourseId || '',
            branch: (branchRaw as LeadItem['branch']) || lead.branch,
          };
        }
        // Old format: "عرض الرئيسية - {branch}"
        if (lead.source.startsWith('عرض الرئيسية - ')) {
          const branchRaw = lead.source.replace('عرض الرئيسية - ', '');
          return { ...lead, source: 'عرض 24 ساعة', branch: (branchRaw as LeadItem['branch']) || lead.branch };
        }
        // Old format: "تسجيل حساب - ..."
        if (lead.source.startsWith('تسجيل حساب - ')) {
          return { ...lead, source: 'تسجيل دخول' };
        }
        return lead;
      });
      // Security migration: strip loginPassword from all leads
      const sanitizedLeads = migratedLeads.map(({ loginPassword: _pw, ...rest }: LeadItem & { loginPassword?: string }) => rest as LeadItem);
      const filteredLeads = sanitizedLeads;
      const allSubs: SubscriberItem[] = parsed.subscribers || seedData.subscribers;
      const filteredSubs = allSubs;
      // ── clientCode: do NOT assign codes locally from localStorage.
      // Codes are assigned server-side atomically. We pass data through unchanged;
      // the "تخصيص كود" button in Dashboard triggers the server to assign missing codes.
      const codedSubs = filteredSubs;
      const codedLeads = filteredLeads;
      return {
        ...seedData,
        ...parsed,
        leads: codedLeads,
        subscribers: codedSubs,
        content: { ...defaultContent, ...(parsed.content || {}) },
      };
    } catch {
      return seedData;
    }
  })();

  const [courses, setCourses] = useState<Course[]>(initial.courses);
  const [bundles, setBundles] = useState<Bundle[]>(initial.bundles);
  const [therapists, setTherapists] = useState<Therapist[]>(initial.therapists);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(initial.testimonials);
  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const subscribersRef = useRef<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  subscribersRef.current = subscribers;
  const [leads, setLeads] = useState<LeadItem[]>(initial.leads || defaultLeads);
  const leadsRef = useRef<LeadItem[]>(initial.leads || defaultLeads);
  leadsRef.current = leads;
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(initial.staffMembers || defaultStaffMembers);
  const staffMembersRef = useRef<StaffMember[]>(initial.staffMembers || defaultStaffMembers);
  staffMembersRef.current = staffMembers;
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initial.consultations || defaultConsultations);
  const [lectures, setLectures] = useState<CourseLectureItem[]>(initial.lectures || defaultLectures);
  const [chapters, setChapters] = useState<CourseChapterItem[]>(initial.chapters || []);
  const [communityPosts, setCommunityPosts] = useState<CommunityPostItem[]>(initial.communityPosts || defaultCommunityPosts);
  const [communityLibraryItems, setCommunityLibraryItems] = useState<CommunityLibraryItem[]>(initial.communityLibraryItems || defaultCommunityLibraryItems);
  const [communityVideos, setCommunityVideos] = useState<CommunityVideoItem[]>(initial.communityVideos || defaultCommunityVideos);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>(initial.communityEvents || defaultCommunityEvents);
  const [content, setContent] = useState<Record<string, string>>(initial.content);
  const contentRef = useRef<Record<string, string>>(initial.content);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(initial.activityLogs);
  const [discounts, setDiscounts] = useState<DiscountRule[]>((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || []);
  const [notifications, setNotifications] = useState<NotificationBroadcast[]>((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || []);
  const [courseQuizzes, setCourseQuizzes] = useState<CourseQuiz[]>((initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || []);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>((initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || []);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || []);
  const [joinUsApplications, setJoinUsApplications] = useState<JoinUsApplication[]>((initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || []);
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>((initial as typeof seedData & { contactMessages?: ContactMessage[] }).contactMessages || []);
  const [automationWorkflows, setAutomationWorkflows] = useState<AutomationWorkflow[]>((initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || []);
  const [currency, setCurrencyState] = useState<Currency>('USD');
  const { authUser, setAuthUser, logout, refreshAuth } = useAuth();
  const [remoteReady, setRemoteReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const isHydratingRef = useRef(true);
  // Timestamp of last local CRM/config mutation
  const lastCRMWriteRef = useRef(0);
  const lastLocalConfigWriteRef = useRef(0);
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round-robin counter for auto-assigning new leads to sales staff
  const roundRobinIndexRef = useRef(0);
  // High-water mark for client codes (local fallback when MySQL unavailable)
  const isValidClientCodeFormat = (c: string | undefined): boolean =>
    !!c && /^C\d+$/.test(c) && parseInt(c.slice(1), 10) >= 10000;
  const highWaterCodeRef = useRef<number>((() => {
    const allInitial = [
      ...initial.leads.map((l: LeadItem) => l.clientCode),
      ...initial.subscribers.map((s: SubscriberItem) => s.clientCode),
    ].filter(isValidClientCodeFormat).map((c) => parseInt(c!.slice(1), 10));
    return allInitial.length > 0 ? Math.max(...allInitial) : 10000;
  })());

  // ── Client-code issuance (atomic via MySQL counter) ───────────────────────────
  const issueClientCodeAsync = async (): Promise<string> => {
    const next = Math.max(highWaterCodeRef.current, 10000) + 1;
    highWaterCodeRef.current = next;
    return `C${next}`;
  };

  const issueClientCode = (): string => {
    const liveNums = [
      ...subscribersRef.current.map(s => s.clientCode),
      ...leadsRef.current.map(l => l.clientCode),
    ].filter(isValidClientCodeFormat).map(c => parseInt(c!.slice(1), 10));
    const liveMax = liveNums.length > 0 ? Math.max(...liveNums) : 10000;
    const next = Math.max(highWaterCodeRef.current, liveMax) + 1;
    highWaterCodeRef.current = next;
    return `C${next}`;
  };
  const track = (action: string, entity: string, label: string) => {
    const actor = authUser?.email || authUser?.uid || 'unknown';
    const actorName = authUser?.email?.split('@')[0] || actor;
    // Auto-derive section from entity
    const sectionMap: Record<string, string> = {
      course: 'إدارة الأكاديمية', lecture: 'إدارة الأكاديمية', chapter: 'إدارة الأكاديمية',
      bundle: 'إدارة الأكاديمية', quiz: 'إدارة الأكاديمية', live_stream: 'إدارة الأكاديمية',
      institute_gallery: 'إدارة الأكاديمية', testimonial: 'إدارة الأكاديمية',
      subscriber: 'إدارة العملاء', lead: 'إدارة العملاء', clientCode: 'إدارة العملاء',
      consultation: 'الاستشارات', therapist: 'المحاضرون',
      order: 'المالية', financial: 'المالية', discount: 'المالية',
      staff: 'إدارة الفريق', content: 'إعدادات الموقع',
      community_post: 'المجتمع', community_library: 'المجتمع',
      community_video: 'المجتمع', community_event: 'المجتمع',
    };
    const section = sectionMap[entity] || 'عام';
    const newLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      entity,
      label,
      at: nowLabel(),
      actor,
      actorName,
      section,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
    persistActivityLogToCollection(newLog);
  };

  // Currency: respect localStorage override, otherwise auto-detect by country
  useEffect(() => {
    const stored = localStorage.getItem('mahad-currency') as Currency | null;
    if (stored && ['EGP', 'SAR', 'USD'].includes(stored)) {
      setCurrencyState(stored);
      return;
    }
    const countryToCurrency = (country?: string): Currency => {
      if (country === 'EG') return 'EGP';
      if (country === 'SA') return 'SAR';
      return 'USD';
    };
    const withTimeout = (url: string, ms = 4000) =>
      Promise.race([fetch(url), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]) as Promise<Response>;

    // Primary: api.country.is
    withTimeout('https://api.country.is/')
      .then(r => r.json())
      .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
      .catch(() =>
        // Fallback 1: ipapi.co
        withTimeout('https://ipapi.co/json/')
          .then(r => r.json())
          .then((d: { country_code?: string }) => { setCurrencyState(countryToCurrency(d.country_code)); })
          .catch(() =>
            // Fallback 2: ipinfo.io
            withTimeout('https://ipinfo.io/json?token=')
              .then(r => r.json())
              .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
              .catch(() => { setCurrencyState('USD'); })
          )
      );
  }, []);

  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)



  const setCurrency = (c: Currency) => {
    localStorage.setItem('mahad-currency', c);
    setCurrencyState(c);
  };

  const isAdmin = Boolean(authUser?.isAdmin);



  // ── Per-user subscriber loaded flag ─────────────────────────────────────────────────────────
  const [mySubscriberLoaded, setMySubscriberLoaded] = useState(false);

  // ── Per-user subscriber loader (for non-admin/staff clients) ─────────────────────────────────
  // extracting authUser email into a ref so the refresh closure doesn't need authUser in deps
  const _subEmailRef = React.useRef<string | null>(null);
  useEffect(() => { _subEmailRef.current = authUser?.email ?? null; }, [authUser?.email]);

  const _applySubscriberData = React.useCallback((mySub: unknown) => {
    const raw = mySub as unknown as SubscriberItem & { enrolledCoursesData?: Course[] };
    const typedSub = { ...raw, enrolledCourseIds: Array.isArray(raw.enrolledCourseIds) ? raw.enrolledCourseIds : [] };
    setSubscribers(prev => {
      const idx = prev.findIndex(s => s.id === typedSub.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...typedSub };
        return next;
      }
      const norm = (_subEmailRef.current || '').toLowerCase().trim();
      return [typedSub, ...prev.filter(s => s.email?.toLowerCase().trim() !== norm)];
    });
    // Merge enrolled course objects (may include unpublished courses not returned by /api/courses)
    if (Array.isArray(raw.enrolledCoursesData) && raw.enrolledCoursesData.length > 0) {
      setCourses(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const newCourses = (raw.enrolledCoursesData as Course[]).filter(c => !existingIds.has(c.id));
        return newCourses.length > 0 ? [...prev, ...newCourses] : prev;
      });
    }
    setMySubscriberLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silent refresh (no loading spinner) — used for polling & visibility change
  const refreshMySubscriber = React.useCallback(() => {
    if (!_subEmailRef.current) return;
    mysqlClient.getMySubscriber().then((mySub) => {
      if (mySub) _applySubscriberData(mySub);
    }).catch(() => {/* silent */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_applySubscriberData]);

  // Reload lectures + chapters from API (called when VideoPlayer opens without lectures loaded)
  const reloadLectures = React.useCallback(async () => {
    try {
      const [lRes, chRes] = await Promise.allSettled([
        mysqlCatalog.listLectures(2000),
        mysqlCatalog.listChapters(1000),
      ]);
      if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
        setLectures(lRes.value as unknown as CourseLectureItem[]);
      if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
        setChapters(chRes.value as unknown as CourseChapterItem[]);
    } catch { /* silent */ }
  }, []);

  const reloadLeads = React.useCallback(async () => { /* admin-only — no-op in client */ }, []);

  useEffect(() => {
    if (!authUser || isAdmin) return;
    setMySubscriberLoaded(false);
    let cancelled = false;
    let attempts = 0;
    const load = () => {
      attempts++;
      mysqlClient.getMySubscriber().then((mySub) => {
        if (cancelled) return;
        if (mySub) {
          _applySubscriberData(mySub);
        } else {
          // No subscriber record — user registered but not yet enrolled in any course
          setMySubscriberLoaded(true);
        }
      }).catch(() => {
        if (!cancelled) setMySubscriberLoaded(true);
      });
    };
    load();

    // Poll every 5 minutes so newly-granted courses appear without re-login
    const pollId = setInterval(() => { if (!cancelled) refreshMySubscriber(); }, 5 * 60 * 1000);

    // Refresh when the browser tab regains focus
    const onVisible = () => { if (!cancelled && document.visibilityState === 'visible') refreshMySubscriber(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // ── Per-user consultations loader ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.email || isAdmin) return;
    let cancelled = false;
    const email = authUser.email.toLowerCase().trim();
    mysqlClient.getMyConsultations().then((list) => {
      if (cancelled) return;
      setConsultations((list as unknown as ConsultationItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // ── Per-user quizAttempts loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.uid || isAdmin) return;
    let cancelled = false;
    const sub = subscribers.find(s => s.email?.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim());
    const sid = sub?.id ?? authUser.uid;
    mysqlClient.getMyQuizAttempts(sid).then((list) => {
      if (cancelled) return;
      setQuizAttempts((list as unknown as QuizAttempt[]).sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin, subscribers]);

  // ── Community + catalog loader (public, non-admin) ──────────────────────────
  // Admin catalog is loaded by the bootstrap above. Non-admin guests load via MySQL.
  useEffect(() => {
    isHydratingRef.current = false;
    setRemoteReady(true);

    // Load community content for all users (deferred 300ms to let critical auth/catalog load first)
    setTimeout(() => {
      Promise.allSettled([
        mysqlCatalog.listCommunityPosts(),
        mysqlCatalog.listCommunityLibrary(),
        mysqlCatalog.listCommunityVideos(),
        mysqlCatalog.listCommunityEvents(),
      ]).then(([pRes, lRes, vRes, eRes]) => {
        if (pRes.status === 'fulfilled' && pRes.value.length > 0)
          setCommunityPosts((pRes.value as unknown as CommunityPostItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
        if (lRes.status === 'fulfilled' && lRes.value.length > 0)
          setCommunityLibraryItems(lRes.value as unknown as CommunityLibraryItem[]);
        if (vRes.status === 'fulfilled' && vRes.value.length > 0)
          setCommunityVideos(vRes.value as unknown as CommunityVideoItem[]);
        if (eRes.status === 'fulfilled' && eRes.value.length > 0)
          setCommunityEvents((eRes.value as unknown as CommunityEventItem[]).sort((a, b) => (b.eventDate || b.dateLabel || '').localeCompare(a.eventDate || a.dateLabel || '')));
      }).catch(() => {});
    }, 300);

    // Load catalog for non-admin users in 2 sequential batches to avoid overwhelming DB connection pool.
    // Batch A (immediate): catalog data needed for home/courses pages.
    // Batch B (500ms later): lectures & chapters needed for course detail pages (lighter limit).
    if (!isAdmin) {
      // Load dynamic site content from API (hero text, page texts, etc.) — merge over defaults
      mysqlCatalog.getSiteContent().then((remote) => {
        if (remote && typeof remote === 'object' && Object.keys(remote).length > 0) {
          contentRef.current = { ...contentRef.current, ...remote };
          setContent(contentRef.current);
        }
      }).catch(() => { /* graceful — defaults remain */ });

      (async () => {
        try {
          // ── Batch A: courses/bundles/testimonials/therapists ──────────────────
          const [cRes, bRes, thRes, testRes] = await Promise.allSettled([
            mysqlCatalog.listCourses(200),
            mysqlCatalog.listBundles(100),
            mysqlCatalog.listTherapists(100),
            mysqlCatalog.listTestimonials(),
          ]);
          if (cRes.status === 'fulfilled' && cRes.value.length > 0)
            setCourses((cRes.value as unknown as Course[]).sort((a, b) => {
              const so = ((a as any).sortOrder ?? 9999) - ((b as any).sortOrder ?? 9999);
              if (so !== 0) return so;
              return (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '');
            }));
          if (bRes.status === 'fulfilled' && bRes.value.length > 0)
            setBundles(bRes.value as unknown as Bundle[]);
          if (thRes.status === 'fulfilled' && thRes.value.length > 0)
            setTherapists(thRes.value as unknown as Therapist[]);
          if (testRes.status === 'fulfilled' && testRes.value.length > 0)
            setTestimonials(testRes.value as unknown as TestimonialItem[]);

          // ── Batch B: lectures/chapters (deferred 500ms) ───────────────────────
          await new Promise(r => setTimeout(r, 500));
          const [lRes, chRes] = await Promise.allSettled([
            mysqlCatalog.listLectures(5000),
            mysqlCatalog.listChapters(),
          ]);
          if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
            setLectures(lRes.value as unknown as CourseLectureItem[]);
          if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
            setChapters(chRes.value as unknown as CourseChapterItem[]);
        } catch { /* ignore — graceful degradation */ }
      })();
    }

    // (Admin inbox loading removed — admin features live in the admin app only)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // Auto-refresh the catalog when the visitor returns to the tab, so courses/bundles
  // added or edited in the admin show up without a manual page reload. Throttled to ~15s.
  useEffect(() => {
    if (isAdmin) return;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 15000) return;
      last = Date.now();
      Promise.allSettled([mysqlCatalog.listCourses(200), mysqlCatalog.listBundles(100)]).then(([cRes, bRes]) => {
        if (cRes.status === 'fulfilled' && (cRes.value as unknown[]).length > 0)
          setCourses((cRes.value as unknown as Course[]).sort((a, b) => {
            const so = ((a as any).sortOrder ?? 9999) - ((b as any).sortOrder ?? 9999);
            if (so !== 0) return so;
            return (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '');
          }));
        if (bRes.status === 'fulfilled' && (bRes.value as unknown[]).length > 0)
          setBundles(bRes.value as unknown as Bundle[]);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [isAdmin]);



  const addCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    let resolvedCourse = course;
    setCourses((prev) => {
      if (course.courseCode) {
        resolvedCourse = course;
        return [course, ...prev];
      }
      const maxCode = prev
        .map((c) => parseInt(c.courseCode || '0', 10))
        .filter((n) => !isNaN(n) && n >= 3000);
      const nextCode = maxCode.length > 0 ? Math.max(...maxCode) + 1 : 3000;
      resolvedCourse = { ...course, courseCode: String(nextCode) };
      return [resolvedCourse, ...prev];
    });
    // Write after state update so resolvedCourse is fully set
    setTimeout(() => persistCourseToCollection(resolvedCourse), 0);
    void mysqlAdmin.saveCourse(resolvedCourse as unknown as Record<string,unknown>);
    track('create', 'course', resolvedCourse.title);
  };

  const updateCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    setCourses((prev) => prev.map((item) => (item.id === course.id ? course : item)));
    // Update all bundles that embed this course
    setBundles((prev) => {
      const updated = prev.map((bundle) => {
        const hasCourse = bundle.courses.some(c => c.id === course.id);
        if (!hasCourse) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.map((c) => (c.id === course.id ? course : c)) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
      return updated;
    });
    persistCourseToCollection(course);
    void mysqlAdmin.saveCourse(course as unknown as Record<string,unknown>);
    track('update', 'course', course.title);
  };

  const deleteCourse = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setCourses((prev) => prev.filter((item) => item.id !== id));
    void mysqlAdmin.deleteCourse(id);
    // Remove course from bundles that embed it
    setBundles((prev) => {
      return prev.map((bundle) => {
        if (!bundle.courses.some(c => c.id === id)) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.filter((c) => c.id !== id) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
    });
    track('delete', 'course', id);
  };

  const addTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const nextTherapists = [therapist, ...therapists];
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>);
    track('create', 'therapist', therapist.name);
  };

  const updateTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const old = therapists.find((item) => item.id === therapist.id);
    const nextTherapists = therapists.map((item) => (item.id === therapist.id ? therapist : item));
    if (old && old.name !== therapist.name) {
      setCourses((coursesPrev) => {
        const updated = coursesPrev.map((c) => (c.instructor === old.name ? { ...c, instructor: therapist.name } : c));
        // Persist any courses that changed instructor name to their collection documents
        updated.filter(c => c.instructor === therapist.name && coursesPrev.find(oc => oc.id === c.id)?.instructor === old.name)
          .forEach(c => persistCourseToCollection(c));
        return updated;
      });
    }
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>);
    track('update', 'therapist', therapist.name);
  };

  const deleteTherapist = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const target = therapists.find((item) => item.id === id);
    const nextTherapists = therapists.filter((item) => item.id !== id);
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.deleteTherapist(id);
    if (target) {
      track('delete', 'therapist', target.name);
    }
  };

  const bundleToServerPayload = (bundle: Bundle): Record<string, unknown> => ({
    id: bundle.id,
    title: bundle.title,
    title_en: bundle.titleEn || null,
    slug: bundle.slug || null,
    short_description: bundle.shortDescription || '',
    description: bundle.description,
    thumbnail: bundle.thumbnail || '',
    video_url: bundle.videoUrl || null,
    price_egp: bundle.price?.EGP || 0,
    price_sar: bundle.price?.SAR || 0,
    price_usd: bundle.price?.USD || 0,
    orig_price_egp: bundle.originalPrice?.EGP || 0,
    orig_price_sar: bundle.originalPrice?.SAR || 0,
    orig_price_usd: bundle.originalPrice?.USD || 0,
    details_content_json: bundle.detailsContent ? JSON.stringify(bundle.detailsContent) : null,
    is_published: bundle.isPublished !== false ? 1 : 0,
    sort_order: bundle.sortOrder ?? 0,
    course_ids: bundle.courses.map((c) => c.id),
  });

  const addBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => [bundle, ...prev]);
    persistBundleToCollection(bundle);
    void mysqlAdmin.saveBundle(bundleToServerPayload(bundle));
    track('create', 'bundle', bundle.title);
  };

  const updateBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => prev.map((item) => (item.id === bundle.id ? bundle : item)));
    persistBundleToCollection(bundle);
    void mysqlAdmin.saveBundle(bundleToServerPayload(bundle));
    track('update', 'bundle', bundle.title);
  };

  const deleteBundle = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => prev.filter((item) => item.id !== id));
    void mysqlAdmin.deleteBundle(id);
    track('delete', 'bundle', id);
  };

  const addTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...testimonials];
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>);
    track('create', 'testimonial', item.name);
  };

  const updateTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = testimonials.map((row) => (row.id === item.id ? item : row));
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>);
    track('update', 'testimonial', item.name);
  };

  const deleteTestimonial = (id: number) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = testimonials.filter((row) => row.id !== id);
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.deleteTestimonial(String(id));
    track('delete', 'testimonial', String(id));
  };

  // Write the full therapists array directly to siteData/config immediately.
  // Called from every therapist mutation so changes appear on the website without waiting
  // for the debounced config persist (which can be skipped by the echo-loop guard).
  // ── Direct-write helpers for siteData/config fields ──────────────────────────────────────────
  // Each of these writes a SINGLE field immediately on mutation, bypassing the debounce.
  // This ensures the website sees changes instantly even if the echo-loop guard skips the debounce.
  const _persistConfigField = (field: string, value: unknown) => {
    lastLocalConfigWriteRef.current = Date.now();
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>).catch(() => {});
  };
  const persistTherapistsToConfig = (updatedTherapists: Therapist[]) => _persistConfigField('therapists', updatedTherapists);
  const persistTestimonialsToConfig = (items: TestimonialItem[]) => _persistConfigField('testimonials', items);
  const persistContentToConfig = (c: Record<string, string>) => void mysqlAdmin.saveContent(c as Record<string,unknown>).catch(() => {});
  const persistDiscountsToConfig = (items: DiscountRule[]) => void mysqlAdmin.saveDiscounts(items as unknown[]).catch(() => {});
  const persistNotificationsToConfig = (items: NotificationBroadcast[]) => void mysqlAdmin.saveNotifications(items as unknown[]).catch(() => {});

  // MySQL-only: subscriber data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };

  // MySQL-only: lead data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLeadToCollection = (_lead: LeadItem) => { /* MySQL */ };

  // MySQL-only: staff data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistStaffMemberToCollection = (_member: StaffMember) => { /* MySQL */ };

  // Write a single course document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistCourseToCollection = (_course: Course) => { /* PG-only — no Firestore write */ };

  // Write a single bundle document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistBundleToCollection = (_bundle: Bundle) => { /* PG-only — no Firestore write */ };

  // Write a single lecture document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLectureToCollection = (_lecture: CourseLectureItem) => { /* PG-only — no Firestore write */ };

  // Write a single chapter document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistChapterToCollection = (_chapter: CourseChapterItem) => { /* PG-only — no Firestore write */ };

  // ── Community & Workflow collection persist helpers ──────────────────────────────────────────
  const persistCommunityPostToCollection = (post: CommunityPostItem) => {
    void mysqlAdmin.saveCommunityPost(post as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityLibraryItemToCollection = (item: CommunityLibraryItem) => {
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityVideoToCollection = (video: CommunityVideoItem) => {
    void mysqlAdmin.saveCommunityVideo(video as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityEventToCollection = (event: CommunityEventItem) => {
    void mysqlAdmin.saveCommunityEvent(event as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistAutomationWorkflowToCollection = (workflow: AutomationWorkflow) => {
    void mysqlAdmin.saveAutomationWorkflow(workflow as unknown as Record<string,unknown>).catch(() => {});
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistCourseQuizToCollection = (_quiz: CourseQuiz) => { /* PG-only — no Firestore write */ };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLiveStreamToCollection = (_stream: LiveStream) => { /* PG-only — no Firestore write */ };

  // ── CRM transactional persist helpers — PG-only, no Firestore writes ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistConsultationToCollection = (_item: ConsultationItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistActivityLogToCollection = (_item: ActivityLogItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistJoinUsToCollection = (_item: JoinUsApplication) => { /* PG-only */ };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistContactMessageToCollection = (_item: ContactMessage) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistQuizAttemptToCollection = (_item: QuizAttempt) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistPaymentHistoryToCollection = (_subscriberId: string, _entries: PaymentHistoryEntry[]) => { /* PG-only */ };

  const addSubscriber = async (item: SubscriberItem): Promise<boolean> => {
    const currentSubs = subscribersRef.current;
    const normPhone = item.phone.replace(/\D/g, '');
    const normEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists = currentSubs.some((s) => {
      const sp = s.phone.replace(/\D/g, '');
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (alreadyExists) return false;

    let finalItem = item;
    if (!item.clientCode) {
      // No code provided — issue fresh atomic code
      finalItem = { ...item, clientCode: await issueClientCodeAsync() };
    } else {
      // Code was provided (e.g. inherited from lead) — MUST verify it is not already
      // used by another subscriber OR any lead. If taken, issue a fresh code.
      const isValidFmt = isValidClientCodeFormat(item.clientCode);
      const codeUsedBySub = currentSubs.some(s => s.id !== item.id && s.clientCode === item.clientCode);
      const codeUsedByLead = leadsRef.current.some(l => l.clientCode === item.clientCode);
      if (!isValidFmt || codeUsedBySub || codeUsedByLead) {
        finalItem = { ...item, clientCode: await issueClientCodeAsync() };
      }
    }
    const nextSubscribers = [finalItem, ...currentSubs];
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(finalItem);
    // Await DB save so we can rollback if server rejects (e.g. duplicate phone already in DB)
    try {
      await mysqlAdmin.saveSubscriber(finalItem as unknown as Record<string,unknown>);
    } catch (saveErr) {
      // Rollback local state — the DB rejected the subscriber
      subscribersRef.current = currentSubs;
      lastCRMWriteRef.current = Date.now();
      setSubscribers(currentSubs);
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      throw new Error(msg); // propagate real error so UI shows correct message
    }
    // Auto-delete any leads with matching phone or email
    // NOTE: payment sync to payments table is handled server-side in POST /api/admin/subscribers
    const np = finalItem.phone.replace(/\D/g, '');
    const ne = (finalItem.email || '').toLowerCase().trim();
    setLeads((prev) => {
      const toRemove = prev.filter((l) => {
        const lp = l.phone.replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return (np.length >= 7 && lp === np) || (ne && le === ne);
      });
      toRemove.forEach(l => {
        void mysqlAdmin.deleteLead(l.id);
      });
      return prev.filter((l) => {
        const lp = l.phone.replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return !((np.length >= 7 && lp === np) || (ne && le === ne));
      });
    });
    if (finalItem.leadId) {
      setLeads((prev) => prev.map((l) => {
        if (l.id !== finalItem.leadId) return l;
        const updated = { ...l, status: 'converted' as LeadStatus };
        persistLeadToCollection(updated);
        void mysqlAdmin.saveLead(updated as unknown as Record<string,unknown>); // mark lead as 'converted'
        return updated;
      }));
    }
    // Sync initial enrollments handled via crm_json in saveSubscriber
    void 0;
    triggerAutomation('new_subscriber', { subscriberId: finalItem.id, name: finalItem.name });
    track('create', 'subscriber', finalItem.name);
    return true;
  };

  const updateSubscriber = (item: SubscriberItem) => {
    // Snapshot the old record BEFORE updating so we can diff.
    const oldSub = subscribersRef.current.find(r => r.id === item.id);
    const nextSubscribers = subscribersRef.current.map((row) => (row.id === item.id ? item : row));
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(item);
    // saveSubscriber sends the full crm_json to server — server auto-syncs paymentHistory → payments table
    // Pass updatedAt for OCC — server rejects with 409 if another write happened since last load
    const payload = { ...item, updatedAt: oldSub?.updatedAt ?? item.updatedAt };
    void mysqlAdmin.saveSubscriber(payload as unknown as Record<string,unknown>).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('تعارض') || msg.includes('conflict') || msg.includes('409')) {
        // OCC conflict: reload the latest version from server then re-apply non-payment changes
        void reloadLeads();
        mysqlAdmin.listAllSubscribers().then((fresh) => {
          const subs = (fresh as unknown as SubscriberItem[]).map(s => ({
            ...s,
            enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
          }));
          if (subs.length > 0) { subscribersRef.current = subs; setSubscribers(subs); }
        }).catch(() => {});
        console.warn('[OCC] Subscriber conflict — reloaded fresh data from server');
      }
    });
    persistPaymentHistoryToCollection(item.id, item.paymentHistory ?? []);

    track('update', 'subscriber', item.name);
  };

  // Helpers: add to blocked set AND persist to localStorage so deletions survive page refresh
  const deleteSubscriber = (id: string) => {
    const nextSubscribers = subscribersRef.current.filter((row) => row.id !== id);
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    void mysqlAdmin.deleteSubscriber(id);
    track('delete', 'subscriber', id);
  };

  const addLead = async (item: LeadItem): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    // Auto round-robin assignment if no sales person assigned yet
    let resolvedItem = item;
    if (!item.assignedSalesId) {
      const activeSales = staffMembers.filter((s) => s.role === 'sales' && s.status !== 'inactive');
      if (activeSales.length > 0) {
        const idx = roundRobinIndexRef.current % activeSales.length;
        const assigned = activeSales[idx];
        roundRobinIndexRef.current = idx + 1;
        resolvedItem = { ...item, assignedSalesId: assigned.id, assignedSalesName: assigned.name };
      }
    }
    // Assign clientCode upfront using atomic transaction so cross-session duplicates are impossible
    if (!resolvedItem.clientCode) {
      resolvedItem = { ...resolvedItem, clientCode: await issueClientCodeAsync() };
    }
    const normPhone = resolvedItem.phone.replace(/\D/g, '');
    const normEmail = (resolvedItem.email || '').toLowerCase().trim();
    // Block if a subscriber already exists with same phone/email
    const isSubscriber = subscribersRef.current.some((s) => {
      const sp = s.phone.replace(/\D/g, '');
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (isSubscriber) return;
    // If lead already exists with same phone/email → merge instead of duplicate
    const existingIdx = leadsRef.current.findIndex((l) => {
      const lp = l.phone.replace(/\D/g, '');
      const le = (l.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && lp === normPhone) || (normEmail && le === normEmail);
    });
    let leadToWrite: LeadItem;
    if (existingIdx !== -1) {
      const existing = leadsRef.current[existingIdx];
      leadToWrite = {
        ...existing,
        name: resolvedItem.name || existing.name,
        interestedCourseIds: [...new Set([...(existing.interestedCourseIds || []), ...(resolvedItem.interestedCourseIds || []), resolvedItem.enrolledCourseId || ''].filter(Boolean))],
        source: resolvedItem.source || existing.source,
      };
      const nextLeads = leadsRef.current.map((l, i) => i === existingIdx ? leadToWrite : l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    } else {
      leadToWrite = resolvedItem;
      const nextLeads = [resolvedItem, ...leadsRef.current];
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    }
    persistLeadToCollection(leadToWrite);
    void mysqlAdmin.saveLead(resolvedItem as unknown as Record<string,unknown>);
    track('create', 'lead', resolvedItem.name);
    // (Inbox auto-conversation removed — inbox is an admin-app feature; the server links leads to inbox)
    triggerAutomation('new_lead', { leadId: item.id, name: item.name, source: item.source || '' });
  };

  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      const { clientCode, id } = await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      const leadWithCode: LeadItem = { ...(item as LeadItem), id: id || (item as LeadItem).id, clientCode };
      // Update local state for instant UI feedback
      leadsRef.current = [leadWithCode, ...leadsRef.current];
      setLeads(prev => [leadWithCode, ...prev.filter(l => l.id !== leadWithCode.id)]);
      track('create', 'lead', leadWithCode.name);
    } catch {
      // Fallback: local only
      const code = item.clientCode || await issueClientCodeAsync();
      const leadWithCode: LeadItem = { ...(item as LeadItem), clientCode: code };
      await addLead(leadWithCode);
    }
  };

  const updateLead = (item: LeadItem) => {
    lastCRMWriteRef.current = Date.now();
    const nextLeads = leadsRef.current.map((row) => (row.id === item.id ? item : row));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    persistLeadToCollection(item);
    void mysqlAdmin.saveLead(item as unknown as Record<string,unknown>);
    triggerAutomation('lead_status_changed', { leadId: item.id, name: item.name, status: item.status || '' });
    track('update', 'lead', item.name);
  };

  // Updates local state only — no API call. Use for bulk auto-convert on mount.
  const markLeadsConverted = (ids: string[]) => {
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.map((l) =>
      idSet.has(l.id) ? { ...l, status: 'converted' as const, hidden: true } : l
    );
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
  };

  const deleteLead = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const nextLeads = leadsRef.current.filter((row) => row.id !== id);
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    void mysqlAdmin.deleteLead(id);
    track('delete', 'lead', id);
  };

  const bulkDeleteLeads = (ids: string[]) => {
    lastCRMWriteRef.current = Date.now();
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.filter((row) => !idSet.has(row.id));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    ids.forEach(id => void mysqlAdmin.deleteLead(id));
    track('delete', 'lead', `bulk:${ids.length}`);
  };

  // Batch-assign client codes — write only the changed documents to their collections.
  const bulkAssignClientCodes = (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => {
    lastCRMWriteRef.current = Date.now();
    if (updatedSubs.length > 0) {
      const subsMap = new Map(updatedSubs.map(s => [s.id, s]));
      const nextSubs = subscribersRef.current.map(s => subsMap.get(s.id) ?? s);
      subscribersRef.current = nextSubs;
      setSubscribers(nextSubs);
      // Write to BOTH Firestore and PostgreSQL so codes survive PG bootstrap on next reload
      updatedSubs.forEach(s => {
        persistSubscriberToCollection(s);
        void mysqlAdmin.saveSubscriber(s as unknown as Record<string,unknown>);
      });
    }
    if (updatedLeads.length > 0) {
      const leadsMap = new Map(updatedLeads.map(l => [l.id, l]));
      const nextLeads = leadsRef.current.map(l => leadsMap.get(l.id) ?? l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
      updatedLeads.forEach(l => {
        persistLeadToCollection(l);
        void mysqlAdmin.saveLead(l as unknown as Record<string,unknown>);
      });
    }
    track('update', 'clientCode', `bulk:${updatedSubs.length + updatedLeads.length}`);
  };

  const bulkRedistributeLeads = async (_mode: 'unassigned' | 'all'): Promise<number> => 0; // admin-only

  const addStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = [item, ...staffMembersRef.current];
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>).then(() => {
      persistStaffMemberToCollection(item);
    }).catch((err) => {
      console.error('[Staff] Failed to save staff to MySQL — rolling back:', err);
      const reverted = staffMembersRef.current.filter(s => s.id !== item.id);
      staffMembersRef.current = reverted;
      setStaffMembers(reverted);
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'staff', name: item.name } }));
    });
    track('create', 'staff', item.name);
  };

  const updateStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.map((row) => (row.id === item.id ? item : row));
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    persistStaffMemberToCollection(item);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>);
    track('update', 'staff', item.name);
  };

  const deleteStaffMember = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.filter((row) => row.id !== id);
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.deleteStaff(id);
    track('delete', 'staff', id);
  };

  const addConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    // Auto-create a lead if this consultation client is not already in the system
    const inPhone = (item.clientPhone || '').replace(/\D/g, '');
    const inEmail = (item.clientEmail || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && s.phone.replace(/\D/g, '') === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && l.phone.replace(/\D/g, '') === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.clientPhone || item.clientEmail)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-consult-${item.id}`,
          clientCode: newCode,
          name: item.clientName,
          email: item.clientEmail || '',
          phone: item.clientPhone || '',
          source: 'استشارة',
          status: 'new',
          leadType: 'consultation',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `حجز استشارة مع ${item.therapistName}`,
          createdAt: item.createdAt || nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    setConsultations((prev) => [item, ...prev]);
    persistConsultationToCollection(item);
    void mysqlAdmin.saveConsultation(item as unknown as Record<string,unknown>);
    triggerAutomation('new_consultation', { consultationId: item.id, therapistName: item.therapistName, clientName: item.clientName });
    track('create', 'consultation', item.clientName);
  };

  const updateConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    setConsultations((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistConsultationToCollection(item);
    void mysqlAdmin.updateConsultationStatus(item.id, item.status, item.notes, item.meetingLink);
    const consultTrigger: AutomationTrigger = item.status === 'confirmed' ? 'consultation_confirmed'
      : item.status === 'completed' ? 'consultation_completed'
      : item.status === 'cancelled' ? 'consultation_cancelled'
      : 'new_consultation';
    triggerAutomation(consultTrigger, { consultationId: item.id, therapistName: item.therapistName });
    track('update', 'consultation', item.clientName);
  };

  const deleteConsultation = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setConsultations((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteConsultation(id);
    track('delete', 'consultation', id);
  };

  const addLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => [item, ...prev]);
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>);
    track('create', 'lecture', item.title);
  };

  const updateLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>);
    track('update', 'lecture', item.title);
  };

  const deleteLecture = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteLecture(id);
    track('delete', 'lecture', id);
  };

  const addChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => [...prev, item]);
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>);
    track('create', 'chapter', item.title);
  };

  const updateChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>);
    track('update', 'chapter', item.title);
  };

  const deleteChapter = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteChapter(id);
    // Unlink lectures belonging to deleted chapter and persist updated lectures
    setLectures((prev) => {
      const updated = prev.map((row) => (row.chapterId === id ? { ...row, chapterId: undefined } : row));
      updated.filter(r => r.chapterId === undefined && prev.find(p => p.id === r.id)?.chapterId === id)
        .forEach(r => persistLectureToCollection(r));
      return updated;
    });
    track('delete', 'chapter', id);
  };

  const getCourseChapters = (courseId: string) =>
    chapters.filter((row) => row.courseId === courseId).sort((a, b) => a.order - b.order);

  // (Orders CRUD removed — orders are managed in the admin app; client checkout talks to the API directly)

  const addCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => [item, ...prev]);
    persistCommunityPostToCollection(item);
    track('create', 'community_post', item.title);
  };

  const updateCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityPostToCollection(item);
    track('update', 'community_post', item.title);
  };

  const deleteCommunityPost = (id: string) => {
    setCommunityPosts((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityPost(id).catch(() => {});
    track('delete', 'community_post', id);
  };

  const addCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => [item, ...prev]);
    persistCommunityLibraryItemToCollection(item);
    track('create', 'community_library', item.title);
  };

  const updateCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityLibraryItemToCollection(item);
    track('update', 'community_library', item.title);
  };

  const deleteCommunityLibraryItem = (id: string) => {
    setCommunityLibraryItems((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityLibraryItem(id).catch(() => {});
    track('delete', 'community_library', id);
  };

  const addCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => [item, ...prev]);
    persistCommunityVideoToCollection(item);
    track('create', 'community_video', item.title);
  };

  const updateCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityVideoToCollection(item);
    track('update', 'community_video', item.title);
  };

  const deleteCommunityVideo = (id: string) => {
    setCommunityVideos((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityVideo(id).catch(() => {});
    track('delete', 'community_video', id);
  };

  const addCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => [item, ...prev]);
    persistCommunityEventToCollection(item);
    track('create', 'community_event', item.title);
  };

  const updateCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityEventToCollection(item);
    track('update', 'community_event', item.title);
  };

  const deleteCommunityEvent = (id: string) => {
    setCommunityEvents((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityEvent(id).catch(() => {});
    track('delete', 'community_event', id);
  };

  const getCourseLectures = (courseId: string) => {
    const courseChapters = chapters.filter((c) => c.courseId === courseId);
    return lectures
      .filter((row) => row.courseId === courseId)
      .sort((a, b) => {
        // Sort by chapter order first, then by lecture order within the chapter.
        // This ensures limited-access slicing (first N videos) is always from the
        // beginning of the course, not interleaved across chapters.
        const chA = courseChapters.find((c) => c.id === a.chapterId)?.order ?? Infinity;
        const chB = courseChapters.find((c) => c.id === b.chapterId)?.order ?? Infinity;
        if (chA !== chB) return chA - chB;
        return a.order - b.order;
      });
  };

  const mergeContent = (incoming: Record<string, string>) => {
    contentRef.current = { ...contentRef.current, ...incoming };
    setContent(contentRef.current);
  };

  const setContentValue = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    // Use contentRef (not the stale `content` state) so that calling setContentValue
    // multiple times in the same event handler accumulates all keys correctly instead
    // of each call overwriting the previous one with the same stale base.
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    track('update', 'content', key);
  };

  const addContentKey = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    track('create', 'content', key);
  };

  const removeContentKey = (key: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = { ...contentRef.current };
    delete next[key];
    contentRef.current = next;
    setContent(next);
    persistContentToConfig(next);
    track('delete', 'content', key);
  };

  const addDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...discounts];
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('create', 'discount', item.label || `${item.discountPercent}%`);
  };

  const updateDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.map((d) => (d.id === item.id ? item : d));
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('update', 'discount', item.label || `${item.discountPercent}%`);
  };

  const deleteDiscount = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.filter((d) => d.id !== id);
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('delete', 'discount', id);
  };

  const addNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...notifications];
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('create', 'notification', item.title);
  };

  const updateNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.map((n) => (n.id === item.id ? item : n));
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('update', 'notification', item.title);
  };

  const deleteNotification = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.filter((n) => n.id !== id);
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('delete', 'notification', id);
  };

  const addCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => [item, ...prev.filter((q) => q.courseId !== item.courseId)]);
    persistCourseQuizToCollection(item);
    track('create', 'courseQuiz', item.title);
  };

  const updateCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => prev.map((q) => (q.id === item.id ? item : q)));
    persistCourseQuizToCollection(item);
    track('update', 'courseQuiz', item.title);
  };

  const deleteCourseQuiz = (id: string) => {
    setCourseQuizzes((prev) => prev.filter((q) => q.id !== id));
    track('delete', 'courseQuiz', id);
  };

  const addQuizAttempt = (item: QuizAttempt) => {
    setQuizAttempts((prev) => [item, ...prev]);
    persistQuizAttemptToCollection(item);
    track('create', 'quizAttempt', `${item.subscriberId} score ${item.score}%`);
  };

  const deleteQuizAttempt = (id: string) => {
    setQuizAttempts((prev) => prev.filter((a) => a.id !== id));
    track('delete', 'quizAttempt', id);
  };

  const addLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => [item, ...prev]);
    persistLiveStreamToCollection(item);
    track('create', 'liveStream', item.title);
  };

  const updateLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    persistLiveStreamToCollection(item);
    track('update', 'liveStream', item.title);
  };

  const deleteLiveStream = (id: string) => {
    setLiveStreams((prev) => prev.filter((s) => s.id !== id));
    track('delete', 'liveStream', id);
  };

  // (Expenses & Daqqi-rounds CRUD removed — admin-app-only features)

  const addJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => [item, ...prev]);
    persistJoinUsToCollection(item);
    // Auto-create a lead for the applicant if not already in system
    const inPhone = (item.phone || '').replace(/\D/g, '');
    const inEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && s.phone.replace(/\D/g, '') === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && l.phone.replace(/\D/g, '') === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.phone || item.email)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-joinus-${item.id}`,
          clientCode: newCode,
          name: item.name,
          email: item.email || '',
          phone: item.phone || '',
          source: 'طلب انضمام',
          status: 'new',
          leadType: 'general',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `طلب انضمام${item.specialty ? ` - تخصص: ${item.specialty}` : ''}`,
          createdAt: nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    track('create', 'joinUs', item.name);
  };
  const updateJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistJoinUsToCollection(item);
    track('update', 'joinUs', item.name);
  };
  const deleteJoinUsApplication = (id: string) => {
    setJoinUsApplications((prev) => prev.filter((x) => x.id !== id));
    track('delete', 'joinUs', id);
  };

  const addContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => [item, ...prev]);
    persistContactMessageToCollection(item);
    track('create', 'contactMessage', item.name);
  };
  const updateContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistContactMessageToCollection(item);
    track('update', 'contactMessage', item.name);
  };
  const deleteContactMessage = (id: string) => {
    setContactMessages((prev) => prev.filter((x) => x.id !== id));
    track('delete', 'contactMessage', id);
  };

  const addAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => [item, ...prev]);
    persistAutomationWorkflowToCollection(item);
    track('create', 'automation', item.name);
  };
  const updateAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistAutomationWorkflowToCollection(item);
    track('update', 'automation', item.name);
  };
  const deleteAutomationWorkflow = (id: string) => {
    setAutomationWorkflows((prev) => prev.filter((x) => x.id !== id));
    void mysqlAdmin.deleteAutomationWorkflow(id).catch(() => {});
    track('delete', 'automation', id);
  };

  // (AI/messaging configs & inbox CRUD removed — admin-app-only features)

  const triggerAutomation = (trigger: AutomationTrigger, data: Record<string, unknown> = {}) => {
    const enabledWorkflows = automationWorkflows.filter((w) => w.enabled && w.trigger === trigger);
    for (const workflow of enabledWorkflows) {
      if (workflow.conditions && workflow.conditions.length > 0) {
        const allMatch = workflow.conditions.every((cond) => {
          const fieldValue = String(data[cond.field] ?? '');
          switch (cond.operator) {
            case 'equals': return fieldValue === cond.value;
            case 'contains': return fieldValue.includes(cond.value);
            case 'greater_than': return Number(fieldValue) > Number(cond.value);
            case 'less_than': return Number(fieldValue) < Number(cond.value);
            case 'is_empty': return !fieldValue;
            case 'is_not_empty': return !!fieldValue;
            default: return true;
          }
        });
        if (!allMatch) continue;
      }
      const cfg = workflow.actionConfig || {};
      switch (workflow.action) {
        case 'notify_admin':
          setNotifications((prev) => [{
            id: `notif-auto-${Date.now()}`,
            title: cfg.title || workflow.name,
            body: cfg.message || `تم تفعيل الأتمتة: ${workflow.name}`,
            type: 'info',
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            active: true,
          }, ...prev]);
          break;
        case 'update_lead_status': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.status) {
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: cfg.status as LeadStatus } : l));
          }
          break;
        }
        case 'add_note': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.message) {
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, notes: l.notes ? `${l.notes}\n[أتمتة] ${cfg.message}` : `[أتمتة] ${cfg.message}` }
              : l));
          }
          break;
        }
        case 'add_followup_reminder': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.days) {
            const d = new Date();
            d.setDate(d.getDate() + Number(cfg.days));
            const dateStr = d.toISOString().slice(0, 10);
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, nextFollowUpDate: dateStr } : l));
          }
          break;
        }
        case 'assign_staff': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.staffId) {
            const staff = staffMembers.find((s) => s.id === cfg.staffId);
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, assignedSalesId: cfg.staffId, assignedSalesName: staff?.name || cfg.staffId }
              : l));
          }
          break;
        }
        default:
          // External API actions (WhatsApp, Email, etc.) — require backend, log only
          track('automation', 'workflow', `${workflow.name} → ${workflow.action}`);
      }
      setAutomationWorkflows((prev) => prev.map((w) => w.id === workflow.id
        ? { ...w, lastTriggeredAt: new Date().toISOString().slice(0, 16).replace('T', ' '), triggerCount: (w.triggerCount || 0) + 1 }
        : w));
    }
  };

  const clearAllData = () => {
    setCourses(COURSES);
    setBundles(BUNDLES);
    setTherapists(THERAPISTS);
    setTestimonials(TESTIMONIALS);
    setSubscribers(defaultSubscribers);
    setLeads(defaultLeads);
    setStaffMembers(defaultStaffMembers);
    setConsultations(defaultConsultations);
    setLectures(defaultLectures);
    setChapters([]);
    setCommunityPosts(defaultCommunityPosts);
    setCommunityLibraryItems(defaultCommunityLibraryItems);
    setCommunityVideos(defaultCommunityVideos);
    setCommunityEvents(defaultCommunityEvents);
    setContent(defaultContent);
    contentRef.current = defaultContent;
    setActivityLogs([]);
    setDiscounts([]);
    setNotifications([]);
    setJoinUsApplications([]);
    setContactMessages([]);
    setAutomationWorkflows([]);
    setCourseQuizzes([]);
    setQuizAttempts([]);
    setLiveStreams([]);
    // Clear all persisted state
    track('reset', 'system', 'restore defaults');
  };

  // ── localStorage persist (all data, fast debounce — keeps browser cache in sync always) ──────
  useEffect(() => {
    const payloadObject = {
      courses,
      bundles,
      therapists,
      testimonials,
      subscribers,
      leads,
      staffMembers,
      consultations,
      lectures,
      chapters,
      communityPosts,
      communityLibraryItems,
      communityVideos,
      communityEvents,
      content,
      activityLogs,
      discounts,
      notifications,
      joinUsApplications,
      contactMessages,
      automationWorkflows,
      courseQuizzes,
      quizAttempts,
      liveStreams,
    };

    // Strip loginPassword from leads before writing to localStorage (security)
    const safeLeadsForStorage = payloadObject.leads.map(({ loginPassword: _pw, ...rest }: LeadItem & { loginPassword?: string }) => rest);
    const safePayload = JSON.stringify({ ...payloadObject, leads: safeLeadsForStorage, _dataVersion: DATA_VERSION });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, safePayload);
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          // localStorage is full — strip base64 images from gallery/certificate/therapist and retry
          const stripped = JSON.parse(safePayload);
          if (Array.isArray(stripped.courses)) {
            stripped.courses = stripped.courses.map((c: Record<string, unknown>) => ({
              ...c,
              galleryImages: Array.isArray(c.galleryImages)
                ? (c.galleryImages as string[]).filter((img: string) => !img.startsWith('data:'))
                : [],
              certificateTemplateUrl: typeof c.certificateTemplateUrl === 'string' && c.certificateTemplateUrl.startsWith('data:') ? '' : c.certificateTemplateUrl,
            }));
          }
          if (Array.isArray(stripped.therapists)) {
            stripped.therapists = stripped.therapists.map((t: Record<string, unknown>) => ({
              ...t,
              image: typeof t.image === 'string' && t.image.startsWith('data:') ? '' : t.image,
            }));
          }
          if (stripped.content && typeof stripped.content['institute.gallery.images'] === 'string') {
            // Keep gallery images (including compressed base64 thumbnails) — do not strip
          }
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped)); } catch { /* give up */ }
        }
      }
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [courses, bundles, therapists, testimonials, subscribers, leads, staffMembers, consultations, lectures, chapters, communityPosts, communityLibraryItems, communityVideos, communityEvents, content, activityLogs, discounts, notifications, joinUsApplications, contactMessages, automationWorkflows, courseQuizzes, quizAttempts, liveStreams]);

  // ── Firestore CRM persist — all CRM arrays are now per-document collections ────────────────
  // consultations, orders, activityLogs, expenses, daqqiRounds, joinUsApplications,
  // contactMessages, quizAttempts each have their own persist* helper called at mutation time.
  // This effect is intentionally a no-op; retained only to avoid breaking dependency tracking.
  useEffect(() => {
    /* no-op: all CRM data now written per-doc via persist*ToCollection helpers */
  }, [remoteReady]);

  // ── MySQL Config persist — therapists, content, discounts, notifications ─────────────────
  useEffect(() => {
    if (!remoteReady || !isAdmin || isHydratingRef.current) return;
    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    configTimerRef.current = setTimeout(() => {
      void mysqlAdmin.saveSettings({ therapists, testimonials } as Record<string, unknown>).catch(() => {});
      void mysqlAdmin.saveContent(content as Record<string, unknown>).catch(() => {});
      void mysqlAdmin.saveDiscounts(discounts as unknown[]).catch(() => {});
      void mysqlAdmin.saveNotifications(notifications as unknown[]).catch(() => {});
    }, 1500);
    return () => { if (configTimerRef.current) clearTimeout(configTimerRef.current); };
  }, [therapists, testimonials, content, discounts, notifications, remoteReady, isAdmin]);

  // (AI/messaging settings persist removed — admin-app-only)

  // ── Staff check — loaded once on login, no admin token required ──────────────────────────
  useEffect(() => {
    if (!authUser?.uid) { setIsStaff(false); return; }
    if (isAdmin) { setIsStaff(false); return; }
    mysqlClient.checkIsStaff().then((r) => setIsStaff(r.isStaff)).catch(() => setIsStaff(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<SiteDataShape>(() => ({
    courses,
    bundles,
    therapists,
    testimonials,
    subscribers,
    isStaff,
    consultations,
    lectures,
    chapters,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    content,
    activityLogs,
    discounts,
    notifications,
    addCourse,
    updateCourse,
    deleteCourse,
    addTherapist,
    updateTherapist,
    deleteTherapist,
    addBundle,
    updateBundle,
    deleteBundle,
    addTestimonial,
    updateTestimonial,
    deleteTestimonial,
    addSubscriber,
    updateSubscriber,
    deleteSubscriber,
    addPublicLead,
    addConsultation,
    updateConsultation,
    deleteConsultation,
    addLecture,
    updateLecture,
    deleteLecture,
    addChapter,
    updateChapter,
    deleteChapter,
    getCourseChapters,
    addCommunityPost,
    updateCommunityPost,
    deleteCommunityPost,
    addCommunityLibraryItem,
    updateCommunityLibraryItem,
    deleteCommunityLibraryItem,
    addCommunityVideo,
    updateCommunityVideo,
    deleteCommunityVideo,
    addCommunityEvent,
    updateCommunityEvent,
    deleteCommunityEvent,
    getCourseLectures,
    setContentValue,
    mergeContent,
    addContentKey,
    removeContentKey,
    clearAllData,
    issueClientCode,
    issueClientCodeAsync,
    addDiscount,
    updateDiscount,
    deleteDiscount,
    addNotification,
    updateNotification,
    deleteNotification,
    courseQuizzes,
    addCourseQuiz,
    updateCourseQuiz,
    deleteCourseQuiz,
    quizAttempts,
    addQuizAttempt,
    deleteQuizAttempt,
    liveStreams,
    addLiveStream,
    updateLiveStream,
    deleteLiveStream,
    joinUsApplications,
    addJoinUsApplication,
    updateJoinUsApplication,
    deleteJoinUsApplication,
    contactMessages,
    addContactMessage,
    updateContactMessage,
    deleteContactMessage,
    automationWorkflows,
    addAutomationWorkflow,
    updateAutomationWorkflow,
    deleteAutomationWorkflow,
    currency,
    setCurrency,
    authUser,
    isAdmin,
    remoteReady,
    mySubscriberLoaded,
    refreshMySubscriber,
    reloadLectures,
    logout,
    refreshAuth,
    triggerAutomation,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [courses, bundles, therapists, testimonials, subscribers, isStaff, consultations,
    lectures, chapters, communityPosts, communityLibraryItems, communityVideos,
    communityEvents, content, activityLogs, discounts, notifications,
    joinUsApplications, contactMessages, automationWorkflows, courseQuizzes, quizAttempts,
    liveStreams, currency, authUser, isAdmin, isStaff, remoteReady]);

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
};

export const useSiteData = () => {
  const ctx = useContext(SiteDataContext);
  if (!ctx) {
    throw new Error('useSiteData must be used inside SiteDataProvider');
  }
  return ctx;
};


