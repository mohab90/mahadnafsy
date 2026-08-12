import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlarmClock,
  BarChart3,
  Bell,
  Mail,
  Tag,
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
  | 'overview'
  | 'kpi_dashboard'
  | 'content'
  | 'staff_management'
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
  | 'registrations'
  | 'customer_inbox'
  | 'service_hub'
  | 'join_us'
  | 'contacts'
  | 'analytics'
  | 'ask_ai'
  | 'ai_dev'
  | 'messaging_agent'
  | 'automation'
  | 'admin_ai_settings'
  | 'pg_migrate'
  | 'server_monitor'
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
  | 'messaging_hub'
  | 'online_hub'
  | 'staff_performance'
  | 'retention'
  | 'cohort_analysis'
  | 'forecast'
  | 'tasks_board'
  | 'sales_team'
  | 'sales_reports'
  | 'sales_goals'
  | 'followup_reminders'
  | 'online_team'
  | 'subscriptions'
  | 'installment_plans'
  | 'tickets'
  | 'faq_manager'
  | 'lead_scoring'
  | 'nps_dashboard'
  | 'consultation_calendar'
  | 'daqqi_team'
  | 'balance_sheet'
  | 'cash_flow'
  | 'recurring_expenses'
  | 'budget_tracker'
  | 'revenue_forecast'
  | 'expense_analytics'
  | 'revenue_sources'
  | 'hr'
  | 'hr_analytics'
  | 'my_hr'
  | 'enps_dashboard'
  | 'offboarding'
  | 'staff_applications'
  | 'lecturer_applications'
  | 'interviews'
  | 'settings_hub'
  | 'system_settings'
  | 'payment_settings'
  | 'lead_sources_settings'
  | 'otp_settings'
  | 'branch_workspaces'
  | 'webhooks'
  | 'ip_whitelist'
  | 'security_dashboard'
  | 'sms_settings'
  | 'notif_inbox'
  | 'email_campaigns'
  | 'sms_campaigns'
  | 'drip_campaigns'
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
      { key: 'retention', label: 'تحليل الاستبقاء', icon: TrendingUp },
      { key: 'cohort_analysis', label: 'تحليل Cohort', icon: Users },
      { key: 'revenue_sources', label: 'مصادر الإيراد', icon: BarChart3 },
      { key: 'expense_analytics', label: 'تحليل المصروفات', icon: BarChart3 },
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
      { key: 'followup_reminders', label: 'تذكيرات المتابعة', icon: Bell },
      // Built, wired to a renderer, and reachable from nothing — only by typing
      // the URL. Surfaced here so the pages that exist can actually be opened.
      { key: 'lead_scoring', label: 'تقييم وترتيب الليدز', icon: TrendingUp },
      { key: 'forecast', label: 'توقعات المبيعات', icon: BarChart3 },
      // Not dead code, despite being unreachable: the sales hub's own "الأهداف"
      // sub-tab only *displays* targets, so this is the only screen in the panel
      // that can set a rep's monthly target. Unreachable meant nobody could.
      { key: 'sales_goals', label: 'تحديد أهداف المبيعات', icon: Target },
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
      { key: 'consultation_calendar', label: 'تقويم الاستشارات', icon: CalendarDays },
      // Certificates are a customer request workflow, not site content — they were
      // under المحتوى, which meant seeing them required manage_content and the
      // whole page-editor section with it.
      { key: 'cert_requests', label: 'طلبات الشهادات', icon: FileText },
      { key: 'cert_pricing', label: 'أسعار الشهادات الإضافية', icon: Tag },
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
      { key: 'financial_reports', label: 'التقارير المالية المتقدمة', icon: BarChart3 },
      { key: 'balance_sheet', label: 'الميزانية العمومية', icon: BarChart3 },
      { key: 'cash_flow', label: 'التدفق النقدي', icon: TrendingUp },
      { key: 'recurring_expenses', label: 'المصاريف المتكررة', icon: RotateCcw },
      { key: 'budget_tracker', label: 'الميزانية مقابل الفعلي', icon: Target },
      { key: 'revenue_forecast', label: 'توقعات الإيرادات', icon: TrendingUp },
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
      // directory) — the same page twice. One entry, named for both jobs. The
      // staff_management key still routes, so links into it keep working.
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
      { key: 'messaging_hub', label: 'الواتساب والماسنجر', icon: MessageCircle },
      { key: 'email_campaigns', label: 'حملات البريد', icon: Mail },
      { key: 'sms_campaigns', label: 'حملات SMS', icon: MessageSquareText },
      { key: 'drip_campaigns', label: 'حملات التنقيط (Drip)', icon: AlarmClock },
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
      { key: 'payment_settings', label: 'بوابات الدفع', icon: CreditCard },
      { key: 'lead_sources_settings', label: 'مصادر الليد والداتا', icon: UserPlus },
      { key: 'otp_settings', label: 'OTP والقنوات', icon: Shield },
      { key: 'sms_settings', label: 'إعدادات SMS', icon: MessageSquareText },
      { key: 'branch_workspaces', label: 'مساحات عمل الفروع', icon: FolderKanban },
      { key: 'automation', label: 'الأتمتة والقواعد', icon: Zap },
      { key: 'ip_whitelist', label: 'قائمة IP المسموحة', icon: Shield },
      { key: 'messaging_agent', label: 'عميل المراسلة AI', icon: Bot },
      { key: 'admin_ai_settings', label: 'إعدادات AI', icon: Settings2 },
      { key: 'server_monitor', label: 'مراقبة السيرفر', icon: Activity },
      { key: 'webhooks', label: 'Webhooks', icon: Zap },
      { key: 'security_dashboard', label: 'لوحة الأمان', icon: Shield },
      { key: 'pg_migrate', label: 'ترحيل قاعدة البيانات', icon: Database },
    ],
  },
];
