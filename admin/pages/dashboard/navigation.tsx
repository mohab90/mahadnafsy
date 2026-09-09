import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Archive,
  AlarmClock,
  Building2,
  BarChart3,
  Bell,
  Mail,
  BookOpen,
  Bot,
  Briefcase,
  CalendarCheck2,
  CalendarDays,
  Smile,
  UserMinus,
  Clock,
  CreditCard,
  Database,
  FileText,
  FolderKanban,
  Globe,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Monitor,
  RotateCcw,
  Settings2,
  Shield,
  Star,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  UserSearch,
  Video,
  Zap,
} from 'lucide-react';

export type TabKey =
  // Each of these holds several screens that were their own menu entries; the
  // retired keys redirect into the matching section. See tabs/SectionedTab.tsx.
  | 'analytics_hub'
  | 'campaigns'
  | 'sales_planning'
  | 'overview'
  | 'kpi_dashboard'
  | 'policies'
  | 'about_page'
  | 'home_offer'
  | 'page_courses'
  | 'page_bundles'
  | 'page_consultations'
  | 'page_community'
  | 'page_instructors'
  | 'page_contact'
  | 'page_joinus'
  | 'page_course_details'
  | 'page_bundle_details'
  | 'page_misc'
  | 'courses'
  | 'lectures'
  | 'instructors'
  | 'bundles'
  | 'testimonials'
  | 'leads'
  | 'consultations'
  | 'community'
  | 'institute_gallery'
  | 'cert_pricing'
  | 'cert_requests'
  | 'orders'
  | 'financial'
  | 'financial_reports'
  | 'activity'
  | 'footer_settings'
  | 'discounts'
  | 'notifications'
  | 'daqqi_schedule'
  | 'client'
  | 'archived_clients'
  | 'registrations'
  | 'customer_inbox'
  | 'service_hub'
  | 'join_us'
  | 'contacts'
  | 'analytics'
  | 'ask_ai'
  | 'ai_dev'
  | 'automation'
  // لوحة الأمان، قائمة IP، مراقبة السيرفر، ترحيل القاعدة — أقسام داخله الآن.
  | 'security_center'
  | 'quizzes'
  | 'course_waitlist'
  | 'live_streams'
  | 'staff_settings'
  | 'online_clients'
  | 'daqqi_clients'
  | 'refund_requests'
  | 'daqqi_accounting'
  | 'daqqi_stats'
  | 'daqqi_attendance'
  | 'sales_hub'
  | 'marketing_hub'
  | 'online_hub'
  | 'staff_performance'
  | 'tasks_board'
  | 'sales_team'
  | 'sales_reports'
  | 'online_team'
  | 'subscriptions'
  | 'installment_plans'
  | 'tickets'
  | 'faq_manager'
  | 'nps_dashboard'
  | 'consultation_calendar'
  | 'daqqi_team'
  | 'recurring_expenses'
  | 'hr'
  | 'hr_analytics'
  | 'my_hr'
  | 'enps_dashboard'
  | 'offboarding'
  | 'lecturer_applications'
  | 'interviews'
  | 'settings_hub'
  | 'system_settings'
  // One key for what were seven: payment gateways, OTP, email, SMS, the AI
  // messaging agent, AI settings and webhooks are sections of it now.
  | 'integrations'
  | 'lead_sources_settings'
  | 'branch_workspaces'
  | 'branches_settings'
  | 'notif_inbox'
  | 'content_hub'
  | 'hub_advanced'
  | 'waitlist'
  | 'staff_home';

export type DashboardMenuItem = {
  key: TabKey;
  label: string;
  icon: LucideIcon;
};

export type DashboardMenuGroup = {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: DashboardMenuItem[];
};

export const DASHBOARD_MENU_GROUPS: DashboardMenuGroup[] = [
  {
    key: 'admin',
    label: 'الإدارة',
    icon: LayoutDashboard,
    color: 'text-slate-700',
    items: [
      { key: 'kpi_dashboard', label: 'لوحة KPI للمدير', icon: BarChart3 },
      { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
      { key: 'activity', label: 'سجل النشاط', icon: Activity },
      { key: 'tasks_board', label: 'لوحة المهام', icon: FileText },
      // Four analyses of the same months, all on view_reports: retention,
      // cohort, revenue sources, expenses. Reading one against another meant
      // navigating between them. See tabs/AnalyticsHubTab.tsx.
      { key: 'analytics_hub', label: 'التحليلات', icon: TrendingUp },
      // Sits under الإدارة by request. It previously had its own heading
      // because ask_ai is also granted to sales and support, so for those roles
      // an "الإدارة" heading now appears carrying this single item — the menu
      // renders a group whenever any of its items is permitted.
      { key: 'ask_ai', label: 'مساعد AI', icon: Zap },
    ],
  },
  {
    key: 'sales',
    label: 'المبيعات',
    icon: TrendingUp,
    color: 'text-emerald-600',
    items: [
      { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
      { key: 'sales_hub', label: 'فريق المبيعات والتقارير', icon: Users },
      // Four entries around one pipeline: two about working it — follow-ups and
      // scoring — and two about where it is heading. The rep checking today and
      // the manager setting next month sat in different corners of the menu
      // from the forecast that connects them.
      //
      // Two of them were only ever reachable by typing the URL until they were
      // listed here, and sales_goals is the only screen that can set a rep's
      // monthly target — the sales hub's "الأهداف" sub-tab merely displays it.
      // They carry four different permissions, kept per section.
      // See tabs/SalesPlanningTab.tsx.
      { key: 'sales_planning', label: 'التخطيط والمتابعة', icon: Target },
    ],
  },
  {
    key: 'online',
    label: 'الأونلاين',
    icon: Monitor,
    color: 'text-blue-600',
    items: [
      { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
      { key: 'client', label: 'قاعدة العملاء', icon: UserSearch },
      // Deleting a customer archives them rather than erasing them, but until
      // now nothing could show what was in there or bring one back.
      { key: 'archived_clients', label: 'أرشيف العملاء', icon: Archive },
      { key: 'online_hub', label: 'فريق الأونلاين والتحصيل', icon: Monitor },
      { key: 'installment_plans', label: 'خطط التقسيط', icon: CreditCard },
      { key: 'subscriptions', label: 'الاشتراكات المتكررة', icon: RotateCcw },
    ],
  },
  {
    key: 'daqqi',
    label: 'الدقي',
    icon: CalendarDays,
    color: 'text-teal-600',
    items: [
      { key: 'daqqi_schedule', label: 'الجدول والعملاء', icon: CalendarDays },
      { key: 'daqqi_clients', label: 'عملاء الدقي', icon: Users },
      { key: 'daqqi_team', label: 'فريق الدقي', icon: Users },
      { key: 'daqqi_accounting', label: 'محاسبة الدقي', icon: CreditCard },
      { key: 'daqqi_stats', label: 'الإحصائيات والحضور', icon: BarChart3 },
      { key: 'waitlist', label: 'قائمة الانتظار', icon: Clock },
    ],
  },
  {
    key: 'cx_group',
    label: 'خدمة العملاء',
    icon: Headphones,
    color: 'text-rose-500',
    items: [
      { key: 'customer_inbox', label: 'Inbox خدمة العملاء', icon: Headphones },
      // Was 8 items (tickets/faq_manager/refund_requests/cert_requests/
      // contacts/consultations/nps_dashboard each a separate page) — all
      // moved into ServiceHubTab as subtabs, unchanged, so nothing lost.
      { key: 'service_hub', label: 'الدعم والجودة', icon: Star },
      // Refunds and consultations were subtabs buried inside الدعم والجودة as
      // well as being their own workflows; they are money and calendar
      // decisions people go to directly, so they sit at this level and appear
      // in exactly one place. Consultations now carries its own calendar.
      { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
      { key: 'consultations', label: 'الاستشارات', icon: CalendarDays },
      // Certificates are a customer request workflow, not site content — they were
      // under المحتوى, which meant seeing them required manage_content and the
      // whole page-editor section with it.
      { key: 'cert_requests', label: 'طلبات الشهادات', icon: FileText },
    ],
  },
  {
    key: 'finance',
    label: 'الحسابات',
    icon: CreditCard,
    color: 'text-amber-600',
    items: [
      { key: 'financial', label: 'النظام المحاسبي', icon: BarChart3 },
      { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
      // FinancialReportsHub already holds the balance sheet, cash flow,
      // recurring expenses, budget tracker and revenue forecast — along with
      // the chart of accounts and the journal, which were never listed here.
      // The menu was repeating its contents as five more entries beside it.
      { key: 'financial_reports', label: 'التقارير المالية', icon: BarChart3 },
    ],
  },
  {
    key: 'hr_group',
    label: 'الموارد البشرية',
    icon: Briefcase,
    color: 'text-purple-600',
    items: [
      // 'نظام HR' and 'الموظفون' were two menu items rendering the identical
      // component with identical props (HrTab, whose default sub-tab is the staff
      // directory) — the same page twice. One entry, named for both jobs, and the
      // staff_management key is gone now that the links into it point here.
      { key: 'hr', label: 'نظام HR والموظفون', icon: Briefcase },
      { key: 'hr_analytics', label: 'تقارير وتحليلات HR', icon: BarChart3 },
      { key: 'enps_dashboard', label: 'رضا الموظفين (eNPS)', icon: Smile },
      { key: 'offboarding', label: 'إنهاء الخدمة', icon: UserMinus },
      { key: 'instructors', label: 'المحاضرون والخبراء', icon: GraduationCap },
      { key: 'join_us', label: 'طلبات الانضمام', icon: GraduationCap },
      { key: 'interviews', label: 'الانترفيوهات', icon: CalendarCheck2 },
    ],
  },
  {
    key: 'marketing',
    label: 'التسويق',
    icon: Megaphone,
    color: 'text-rose-600',
    items: [
      { key: 'marketing_hub', label: 'مركز التسويق الشامل', icon: Megaphone },
      // The same job down four pipes — WhatsApp/Messenger, email, SMS, drip.
      // Choosing a channel for a segment meant opening all four to see what
      // each had sent. All on manage_channel_settings. See tabs/CampaignsTab.tsx.
      { key: 'campaigns', label: 'الحملات', icon: Megaphone },
      { key: 'notif_inbox', label: 'إدارة صندوق الإشعارات', icon: Bell },
    ],
  },
  {
    key: 'site_content',
    label: 'المحتوى',
    icon: FileText,
    color: 'text-violet-600',
    items: [
      { key: 'content_hub', label: 'صفحات الموقع', icon: Globe },
      { key: 'courses', label: 'الكورسات والدبلومات', icon: BookOpen },
      { key: 'lectures', label: 'المحاضرات', icon: ListOrdered },
      { key: 'bundles', label: 'المسارات والباقات', icon: FolderKanban },
      { key: 'quizzes', label: 'الاختبارات', icon: FileText },
      { key: 'course_waitlist', label: 'قوائم الانتظار', icon: Clock },
      { key: 'live_streams', label: 'البث المباشر', icon: Video },
      { key: 'community', label: 'إدارة المجتمع', icon: MessageSquareText },
    ],
  },
  {
    key: 'settings',
    label: 'الإعدادات',
    icon: Settings2,
    color: 'text-gray-600',
    items: [
      { key: 'settings_hub', label: 'مركز الإعدادات', icon: Settings2 },
      { key: 'system_settings', label: 'إعدادات الإدارة', icon: Settings2 },
      // Seven entries — payment gateways, OTP, email, SMS, the AI messaging
      // agent, AI settings, webhooks — behind one, each still its own section.
      // Setting the institute up meant visiting all seven, with no way to see
      // which were configured without opening each in turn. The retired routes
      // redirect to the matching section; see tabs/IntegrationsTab.tsx.
      { key: 'integrations', label: 'التكاملات', icon: Zap },
      { key: 'lead_sources_settings', label: 'مصادر الليد والداتا', icon: UserPlus },
      // The branch list itself — what appears in booking, payment and course
      // interest. Distinct from مساحات عمل الفروع, which arranges the dashboard
      // per branch rather than defining which branches exist.
      { key: 'branches_settings', label: 'الفروع', icon: Building2 },
      { key: 'branch_workspaces', label: 'مساحات عمل الفروع', icon: FolderKanban },
      { key: 'automation', label: 'الأتمتة والقواعد', icon: Zap },
      // لوحة الأمان and قائمة IP المسموحة answer the same question from two
      // sides — what happened, and who is allowed in — and مراقبة السيرفر with
      // ترحيل قاعدة البيانات are that pairing for the machine underneath.
      // Four entries, one place. See tabs/SecurityCenterTab.tsx.
      { key: 'security_center', label: 'الأمان والصيانة', icon: Shield },
    ],
  },
];
