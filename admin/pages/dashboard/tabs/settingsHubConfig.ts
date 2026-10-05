// Every setting in the system, by the part of the institute it belongs to.
//
// «نقوي ونعيد ترتيب صفحه الاعدادات للنظام بالكام … ويبقي في تعديل لكل جزء في
// الموقع والسيسيتم». The hub used to be a flat wall of seventeen cards, five of
// them pointing at routes that only redirect, and nothing for the site's pages,
// the course prices, HR policy or the price of a certificate. Here each entry is
// one thing someone comes to change, opening the exact screen or section that
// changes it:
//   /dashboard/system_settings/<section>   systemSettingsSchema.tsx SECTIONS
//   /dashboard/integrations/<section>      IntegrationsTab.tsx
//   /dashboard/security_center/<section>   SecurityCenterTab.tsx
//   /dashboard/content_hub/<page>          contentHubConfig.ts CONTENT_HUB_TABS
//   /dashboard/hr/<section>                HRTab.tsx HR_SECTIONS
//   /dashboard/campaigns/<section>         CampaignsTab.tsx
// `tab` is the screen's TabKey, read against TAB_PERMISSION_MAP so an entry is
// listed only to someone who can open it; `permission` overrides it where the
// entry is one section of a screen that gates its sections separately.
import type { StaffPermission } from '../../../types';
import type { TabKey } from '../navigation';

export interface SettingsEntry {
  title: string;
  desc: string;
  href: string;
  tab: TabKey;
  permission?: StaffPermission;
  /** Extra words the search should find this by. */
  keywords?: string;
  /** Sub-pages listed under the entry, each its own link. */
  links?: { label: string; href: string }[];
}

export interface SettingsGroup {
  key: string;
  title: string;
  blurb: string;
  /** Tailwind tone for the group's marker. */
  tone: string;
  entries: SettingsEntry[];
}

const S = (section: string) => `/dashboard/system_settings/${section}`;
const PAGE = (page: string) => `/dashboard/content_hub/${page}`;

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    key: 'institute',
    title: 'المعهد والهوية',
    blurb: 'اسم المعهد وشكله، الفروع، والدول والعملات اللي بيشتغل بيها.',
    tone: 'bg-indigo-500',
    entries: [
      { title: 'بيانات المعهد والهوية', desc: 'الاسم بالعربي والإنجليزي، اللوجو والأيقونة، الألوان، أرقام وبريد الدعم، العنوان، المنطقة الزمنية وأيام العمل.', href: S('general'), tab: 'system_settings', keywords: 'لوجو شعار ألوان واتساب الدعم تليفون ايميل' },
      { title: 'الفروع وتفعيل فرع التجمع', desc: 'الفروع اللي بتظهر في الحجز والدفع والاهتمام بالكورسات. فرع التجمع بيتفتح من هنا، وقسمه في القائمة بيظهر أول ما يتفعّل.', href: '/dashboard/branches_settings', tab: 'branches_settings', keywords: 'الدقي التجمع أونلاين سعودي فرع جديد' },
      { title: 'مساحات عمل الفروع', desc: 'الصفحات والوظائف اللي تظهر لكل فرع في لوحة الإدارة.', href: '/dashboard/branch_workspaces', tab: 'branch_workspaces' },
      { title: 'الدول والجنسيات', desc: 'الدول وأكوادها، والجنسيات اللي بتظهر في بيانات العميل.', href: S('countries'), tab: 'system_settings', links: [{ label: 'الدول', href: S('countries') }, { label: 'الجنسيات', href: S('nationalities') }] },
      { title: 'العملات وأسعار الصرف', desc: 'العملات المفعّلة، وسعر الريال والدولار بالجنيه اللي بتتحسب بيه التقارير.', href: S('currencies'), tab: 'system_settings', keywords: 'ريال دولار جنيه تحويل', links: [{ label: 'العملات', href: S('currencies') }, { label: 'أسعار الصرف', href: S('exchange_rates') }] },
    ],
  },
  {
    key: 'site',
    title: 'الموقع الإلكتروني',
    blurb: 'كل صفحة في الموقع ونصوصها، من الرئيسية للفوتر.',
    tone: 'bg-violet-500',
    entries: [
      { title: 'الصفحة الرئيسية والعرض', desc: 'كورس العرض، العدّاد، ونصوص الصفحة الرئيسية.', href: PAGE('home_offer'), tab: 'content_hub', keywords: 'هيرو عرض عداد' },
      { title: 'نصوص صفحات الموقع', desc: 'العناوين والأوصاف والأسئلة الشائعة في كل صفحة.', href: PAGE('page_courses'), tab: 'content_hub', keywords: 'صفحة نصوص عناوين',
        links: [
          { label: 'الكورسات', href: PAGE('page_courses') },
          { label: 'المسارات', href: PAGE('page_bundles') },
          { label: 'تفاصيل الكورس', href: PAGE('page_course_details') },
          { label: 'تفاصيل المسار', href: PAGE('page_bundle_details') },
          { label: 'الاستشارات', href: PAGE('page_consultations') },
          { label: 'المجتمع', href: PAGE('page_community') },
          { label: 'الخبراء', href: PAGE('page_instructors') },
          { label: 'التواصل', href: PAGE('page_contact') },
          { label: 'انضم إلينا', href: PAGE('page_joinus') },
          { label: 'متفرقة', href: PAGE('page_misc') },
        ] },
      { title: 'عن المعهد', desc: 'صفحة «عن المعهد» ورسالته وأرقامه.', href: PAGE('about_page'), tab: 'content_hub' },
      { title: 'الشروط والسياسات', desc: 'الخصوصية، الاسترداد، والشروط والأحكام.', href: PAGE('policies'), tab: 'content_hub', keywords: 'خصوصية استرداد استرجاع' },
      { title: 'الفوتر وبيانات التواصل', desc: 'روابط الفوتر، السوشيال ميديا، وعناوين الفروع في الموقع.', href: PAGE('footer_settings'), tab: 'content_hub', keywords: 'فيسبوك انستجرام سوشيال' },
      { title: 'آراء العملاء', desc: 'الشهادات المعروضة في الموقع.', href: '/dashboard/testimonials', tab: 'testimonials', keywords: 'تقييمات' },
      { title: 'معرض الصور', desc: 'صور المعهد والفعاليات.', href: '/dashboard/institute_gallery', tab: 'institute_gallery', keywords: 'جاليري' },
      { title: 'الأسئلة الشائعة', desc: 'قاعدة الأسئلة اللي بيرد منها الموقع وخدمة العملاء.', href: '/dashboard/faq_manager', tab: 'faq_manager', keywords: 'FAQ' },
      { title: 'كل نصوص الموقع (متقدم)', desc: 'أي نص في الموقع بالمفتاح بتاعه، لو مش لاقيه في الصفحات فوق.', href: PAGE('hub_advanced'), tab: 'content_hub' },
    ],
  },
  {
    key: 'catalog',
    title: 'الكورسات والأسعار',
    blurb: 'أسعار كل فرع، الخصومات، الشهادات، ومكافآت الحجز.',
    tone: 'bg-emerald-500',
    entries: [
      { title: 'أسعار الكورسات حسب الفرع ومكافآت الحجز', desc: 'لكل كورس: سعر الدقي، التجمع، الأونلاين للمصريين ولغير المصريين، السعودي والدولي، وسعر الخصم، ومكافأة السيلز والريسبشن والمحاضر — وتقييم SEO للصفحة.', href: '/dashboard/courses', tab: 'courses', keywords: 'سعر خصم مكافأة عمولة SEO' },
      { title: 'المسارات وأسعارها', desc: 'نفس الأسعار والمكافآت وتقييم SEO للمسارات.', href: '/dashboard/bundles', tab: 'bundles', keywords: 'باقات' },
      { title: 'أسعار الشهادات', desc: 'سعر كل شهادة للمصري والمقيم والأجنبي.', href: '/dashboard/cert_pricing', tab: 'cert_pricing', keywords: 'شهادة تضامن عين شمس' },
      { title: 'الخصومات والكوبونات', desc: 'أكواد الخصم ومدتها وعلى أنهي كورسات.', href: '/dashboard/discounts', tab: 'discounts', keywords: 'كوبون كود' },
      { title: 'أنواع الجلسات', desc: 'أنواع جلسات الاستشارة ومدتها.', href: S('session_types'), tab: 'system_settings' },
    ],
  },
  {
    key: 'sales',
    title: 'المبيعات والليدز',
    blurb: 'منين بييجي الليد، يتوزع إزاي، وقد إيه يستنى.',
    tone: 'bg-blue-500',
    entries: [
      { title: 'مصادر الليد والداتا', desc: 'فيسبوك ليدز، جوجل شيت، مصادر API، وتوزيع الليدز على السيلز.', href: '/dashboard/lead_sources_settings', tab: 'lead_sources_settings', keywords: 'فيسبوك شيت توزيع' },
      { title: 'قائمة مصادر الليدات', desc: 'المصادر اللي بيختار منها الموظف وهو بيضيف ليد.', href: S('lead_sources'), tab: 'system_settings' },
      { title: 'مهلة المتابعة والأرشفة', desc: 'كام ساعة قبل ما الليد يتأخر، وبعد كام يوم يتأرشف لوحده.', href: S('financial'), tab: 'system_settings', keywords: 'SLA أرشفة' },
      { title: 'الأتمتة والقواعد', desc: 'التوزيع التلقائي، التذكيرات، وتغيير الحالات لوحدها.', href: '/dashboard/automation', tab: 'automation' },
    ],
  },
  {
    key: 'finance',
    title: 'الحسابات والدفع',
    blurb: 'الخزن، بوابات الدفع، الفواتير والتقسيط.',
    tone: 'bg-amber-500',
    entries: [
      { title: 'الإعدادات المالية', desc: 'الضريبة، بادئة الفاتورة، مقدّم ومدة التقسيط، وسعر الاستشارة.', href: S('financial'), tab: 'system_settings', keywords: 'ضريبة فاتورة تقسيط قسط' },
      { title: 'خزائن المعهد ووسائل الدفع', desc: 'الخزن اللي بيختار منها الموظف وهو بيسجل دفعة، وطرق الدفع اليدوي المتاحة للعميل في الموقع.', href: S('payment_methods'), tab: 'system_settings', keywords: 'فودافون كاش انستاباي خزنة كاش' },
      { title: 'بوابات الدفع', desc: 'Paymob والدفع اليدوي وتعليماته.', href: '/dashboard/integrations/payment', tab: 'integrations', permission: 'manage_settings', keywords: 'paymob فيزا' },
      { title: 'فئات المصاريف', desc: 'البنود اللي بتتسجل عليها المصاريف.', href: S('expense_categories'), tab: 'system_settings' },
    ],
  },
  {
    key: 'people',
    title: 'الموظفين والصلاحيات',
    blurb: 'الأدوار، الصلاحيات، الحضور والمرتبات.',
    tone: 'bg-purple-500',
    entries: [
      { title: 'الموظفين وصلاحياتهم', desc: 'إضافة موظف، دوره، فرعه، وصلاحياته.', href: '/dashboard/hr/directory', tab: 'hr', keywords: 'صلاحية موظف جديد' },
      { title: 'أدوار الموظفين', desc: 'الأدوار اللي بتظهر في اختيار دور الموظف.', href: S('staff_roles'), tab: 'system_settings' },
      { title: 'سياسة الحضور والخصومات', desc: 'مواعيد العمل، التأخير، الغياب، وخصم كل حالة — وشيت البصمة الشهري.', href: '/dashboard/hr/attendance', tab: 'hr', keywords: 'بصمة تأخير غياب خصم' },
      { title: 'المرتبات', desc: 'الراتب الأساسي والتارجت والعمولات لكل موظف.', href: '/dashboard/hr/payroll', tab: 'hr', keywords: 'راتب تارجت عمولة' },
    ],
  },
  {
    key: 'channels',
    title: 'التواصل والرسائل',
    blurb: 'واتساب الشركة والماسنجر، البريد، والرسائل النصية.',
    tone: 'bg-teal-500',
    entries: [
      { title: 'واتساب وماسنجر وانستجرام', desc: 'ربط رقم الشركة والصفحة والحساب، والحملات وصحة الرسايل.', href: '/dashboard/campaigns/messaging', tab: 'campaigns', permission: 'manage_channel_settings', keywords: 'whatsapp messenger instagram' },
      { title: 'البريد الإلكتروني', desc: 'سيرفر الإرسال واسم المُرسِل.', href: '/dashboard/integrations/email', tab: 'integrations', permission: 'manage_settings', keywords: 'SMTP ايميل' },
      { title: 'الرسائل النصية SMS', desc: 'مزوّد الرسائل واسم المُرسِل والرصيد.', href: '/dashboard/integrations/sms', tab: 'integrations', permission: 'manage_channel_settings' },
      { title: 'أكواد الدخول', desc: 'كود الدخول بيتبعت منين: واتساب ثم البريد ثم SMS.', href: '/dashboard/integrations/otp', tab: 'integrations', permission: 'manage_security', keywords: 'OTP كود تحقق' },
      { title: 'صندوق الإشعارات', desc: 'الإشعارات اللي بتوصل للعملاء والموظفين.', href: '/dashboard/notif_inbox', tab: 'notif_inbox' },
    ],
  },
  {
    key: 'ai',
    title: 'الذكاء الاصطناعي والأتمتة',
    blurb: 'مزوّد AI، بوت الرد على العملاء، والربط بأنظمة تانية.',
    tone: 'bg-fuchsia-500',
    entries: [
      { title: 'بوت الرد على العملاء', desc: 'رد آلي بالذكاء الاصطناعي على الواتساب والماسنجر والانستجرام: إمتى يرد، بيعرف إيه من الكورسات والأسعار، وإمتى يحوّل للفريق — وتجربه قبل ما تشغله.', href: '/dashboard/integrations/bot', tab: 'integrations', permission: 'manage_channel_settings', keywords: 'شات بوت chatbot ذكاء اصطناعي' },
      { title: 'مساعد الموقع AI', desc: 'المساعد اللي بيرد على زوار الموقع وصفحات الطالب.', href: '/dashboard/integrations/agent', tab: 'integrations', permission: 'manage_channel_settings' },
      { title: 'إعدادات AI', desc: 'المزوّد (Claude / OpenAI / Gemini) ومفتاحه.', href: '/dashboard/integrations/ai', tab: 'integrations', permission: 'manage_ai_settings', keywords: 'claude openai gemini' },
      { title: 'النمو والأتمتة', desc: 'المهام الدورية: تذكيرات، متابعة، وتقارير يومية.', href: S('growth'), tab: 'system_settings' },
      { title: 'Webhooks', desc: 'ربط أنظمة خارجية بأحداث النظام.', href: '/dashboard/integrations/webhooks', tab: 'integrations', permission: 'manage_settings' },
    ],
  },
  {
    key: 'security',
    title: 'الأمان والصيانة',
    blurb: 'الدخول، النسخ الاحتياطي، وحالة السيرفر.',
    tone: 'bg-slate-500',
    entries: [
      { title: 'التحقق بخطوتين', desc: 'تفعيل 2FA لحسابات الإدارة.', href: S('security'), tab: 'system_settings', keywords: '2FA' },
      { title: 'لوحة الأمان وقائمة IP', desc: 'محاولات الدخول، والعناوين المسموح لها تفتح لوحة الإدارة.', href: '/dashboard/security_center/dashboard', tab: 'security_center', permission: 'view_security', links: [{ label: 'لوحة الأمان', href: '/dashboard/security_center/dashboard' }, { label: 'قائمة IP', href: '/dashboard/security_center/ip' }] },
      { title: 'النسخ الاحتياطية', desc: 'آخر نسخة احتياطية لقاعدة البيانات وتشغيل نسخة جديدة.', href: S('backups'), tab: 'system_settings', keywords: 'باك اب backup' },
      { title: 'مراقبة السيرفر', desc: 'حالة التشغيل والذاكرة وإعادة التشغيل.', href: '/dashboard/security_center/server', tab: 'security_center', permission: 'view_security' },
      { title: 'سجل النشاط', desc: 'مين عمل إيه وإمتى.', href: '/dashboard/activity', tab: 'activity', keywords: 'لوج' },
    ],
  },
];

/** Arabic as typed: no tashkeel, one alef, ه for ة, ي for ى. */
export function normalizeQuery(value: string): string {
  return value.toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

/** Entries matching every word of the query, by title, description, keywords or sub-page. */
export function searchSettings(groups: SettingsGroup[], query: string): SettingsGroup[] {
  const words = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map(group => ({
      ...group,
      entries: group.entries.filter(entry => {
        const text = normalizeQuery([group.title, entry.title, entry.desc, entry.keywords || '', ...(entry.links || []).map(l => l.label)].join(' '));
        return words.every(word => text.includes(word));
      }),
    }))
    .filter(group => group.entries.length);
}
