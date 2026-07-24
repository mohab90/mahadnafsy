import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DiscountRule, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, LeadStatus, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, AutomationWorkflow, AutomationTrigger, PaymentHistoryEntry, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlClient, mysqlForms, mysqlAdmin } from '../lib/mysqlapi';
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
import { useCatalogData } from './site-data-hooks/useCatalogData';

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
  submitQuizAttempt: (quiz: CourseQuiz, subscriberId: string, answers: number[]) => Promise<{ score: number; passed: boolean }>;
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
  const [joinUsApplications, setJoinUsApplications] = useState<JoinUsApplication[]>((initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || []);
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>((initial as typeof seedData & { contactMessages?: ContactMessage[] }).contactMessages || []);
  const [automationWorkflows, setAutomationWorkflows] = useState<AutomationWorkflow[]>((initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || []);
  const { authUser, logout, refreshAuth } = useAuth();
  const isAdmin = Boolean(authUser?.isAdmin);
  const { activityLogs, track, resetActivityLogs } = useActivityLog(authUser, initial.activityLogs);
  const { currency, setCurrency } = useCurrency();
  const { content, mergeContent, setContentValue, addContentKey, removeContentKey, resetContent } = useSiteContent(initial.content, defaultContent, track);
  const { discounts, addDiscount, updateDiscount, deleteDiscount, resetDiscounts } = useDiscounts((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || [], track);
  const { notifications, setNotifications, addNotification, updateNotification, deleteNotification, resetNotifications } = useNotifications((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [], track);
  const { liveStreams, addLiveStream, updateLiveStream, deleteLiveStream, resetLiveStreams } = useLiveStreams((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [], track);
  const {
    lectures, setLectures, chapters, setChapters,
    addLecture, updateLecture, deleteLecture,
    addChapter, updateChapter, deleteChapter,
    getCourseChapters, getCourseLectures, reloadLectures, resetCurriculum,
  } = useCourseCurriculum(initial.lectures || defaultLectures, initial.chapters || [], track);
  const {
    communityPosts, setCommunityPosts, communityLibraryItems, setCommunityLibraryItems,
    communityVideos, setCommunityVideos, communityEvents, setCommunityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
    resetCommunity,
  } = useCommunityData(
    initial.communityPosts || defaultCommunityPosts,
    initial.communityLibraryItems || defaultCommunityLibraryItems,
    initial.communityVideos || defaultCommunityVideos,
    initial.communityEvents || defaultCommunityEvents,
    isAdmin, track,
  );
  const {
    courseQuizzes, addCourseQuiz, updateCourseQuiz, deleteCourseQuiz,
    quizAttempts, submitQuizAttempt, deleteQuizAttempt, resetQuizzes,
  } = useQuizzes(
    (initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || [],
    (initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || [],
    authUser, isAdmin, subscribers, track,
  );
  const {
    courses, setCourses, bundles, therapists, testimonials,
    addCourse, updateCourse, deleteCourse,
    addTherapist, updateTherapist, deleteTherapist,
    addBundle, updateBundle, deleteBundle,
    addTestimonial, updateTestimonial, deleteTestimonial,
    remoteReady, isHydratingRef, resetCatalog,
  } = useCatalogData({
    initialCourses: initial.courses, initialBundles: initial.bundles,
    initialTherapists: initial.therapists, initialTestimonials: initial.testimonials,
    isAdmin, authUserUid: authUser?.uid, track, mergeContent,
    setLectures, setChapters,
    setCommunityPosts, setCommunityLibraryItems, setCommunityVideos, setCommunityEvents,
  });
  const [isStaff, setIsStaff] = useState(false);
  // Timestamp of last local CRM/config mutation
  const lastCRMWriteRef = useRef(0);
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round-robin counter for auto-assigning new leads to sales staff
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

  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)



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
    mysqlClient.getMyConsultations().then((list) => {
      if (cancelled) return;
      setConsultations((list as unknown as ConsultationItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // MySQL-only: subscriber data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };

  // MySQL-only: lead data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLeadToCollection = (_lead: LeadItem) => { /* MySQL */ };

  // MySQL-only: staff data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const persistAutomationWorkflowToCollection = (workflow: AutomationWorkflow) => {
    void mysqlAdmin.saveAutomationWorkflow(workflow as unknown as Record<string,unknown>).catch(() => {});
  };

  // ── CRM transactional persist helpers — PG-only, no Firestore writes ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistConsultationToCollection = (_item: ConsultationItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistJoinUsToCollection = (_item: JoinUsApplication) => { /* PG-only */ };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistContactMessageToCollection = (item: ContactMessage) => {
    // Was a no-op → contact-form submissions never reached the server (invisible to admin).
    // Persist to the contact_messages table via the public /api/contact endpoint.
    void mysqlForms.submitContact({
      name: item.name, email: item.email, phone: (item as unknown as { phone?: string }).phone || '',
      subject: item.subject, message: item.message,
    } as unknown as Record<string, unknown>).catch(() => {});
  };
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


  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      const { clientCode, id } = await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      const leadWithCode: LeadItem = { ...(item as LeadItem), id: id || (item as LeadItem).id, clientCode };
      // Update local state for instant UI feedback
      leadsRef.current = [leadWithCode, ...leadsRef.current];
      setLeads(prev => [leadWithCode, ...prev.filter(l => l.id !== leadWithCode.id)]);
      track('create', 'lead', leadWithCode.name);
    } catch (error) {
      // Public forms must never report success for a lead that only exists in
      // browser memory. Surface the server failure to the page instead.
      throw error instanceof Error ? error : new Error('تعذر حفظ طلبك. حاول مرة أخرى.');
    }
  };


  // Updates local state only — no API call. Use for bulk auto-convert on mount.



  // Batch-assign client codes — write only the changed documents to their collections.





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

  // (Orders CRUD removed — orders are managed in the admin app; client checkout talks to the API directly)

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
    resetCatalog({ courses: COURSES, bundles: BUNDLES, therapists: THERAPISTS, testimonials: TESTIMONIALS });
    setSubscribers(defaultSubscribers);
    setLeads(defaultLeads);
    setStaffMembers(defaultStaffMembers);
    setConsultations(defaultConsultations);
    resetCurriculum(defaultLectures);
    resetCommunity({ posts: defaultCommunityPosts, library: defaultCommunityLibraryItems, videos: defaultCommunityVideos, events: defaultCommunityEvents });
    resetContent();
    resetActivityLogs();
    resetDiscounts();
    resetNotifications();
    setJoinUsApplications([]);
    setContactMessages([]);
    setAutomationWorkflows([]);
    resetQuizzes();
    resetLiveStreams();
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
    submitQuizAttempt,
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

