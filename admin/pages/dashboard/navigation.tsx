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
    ],
  },
  {
    // Its own heading rather than an item under الإدارة: ask_ai is granted to
    // sales reps and support, and hanging it off the management group made an
    // "الإدارة" section appear for people who have no management pages at all.
    key: 'assistant',
    label: 'مساعد AI',
    icon: Zap,
    color: 'text-fuchsia-600',
    items: [
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
      // خطط التقسيط is a tab inside التقارير المالية المتقدمة; the route still works.
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
      // The five reports that used to be listed here individually — balance sheet,
      // cash flow, recurring expenses, budget-vs-actual and revenue forecast — are
      // tabs *inside* التقارير المالية المتقدمة (see FinancialReportsHub, which
      // lazy-loads the exact same components). Listing them here as well meant the
      // same screen appeared twice in the sidebar under two different entries.
      // Their routes still work, so bookmarks and deep links are unaffected; they
      // are simply no longer duplicated in the menu.
      { key: 'financial_reports', label: 'التقارير المالية المتقدمة', icon: BarChart3 },
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
      // مركز الإعدادات already lists every one of these as a card, and it says so
      // itself: "نقطة الدخول الموحدة للإعدادات ... بدل التنقل بين صفحات متفرقة".
      // Repeating all fourteen in the sidebar was the exact fragmentation the hub
      // was built to remove, and it made الإعدادات the largest group in the menu.
      // Every route still resolves, so links and bookmarks keep working.
      { key: 'settings_hub', label: 'مركز الإعدادات', icon: Settings2 },
      // Kept out of the hub-only rule on purpose: this one is looked at while
      // something is actively wrong, so it should not cost an extra click.
      { key: 'server_monitor', label: 'مراقبة السيرفر', icon: Activity },
    ],
  },
];

/**
 * Runtime guard for a tab name that arrived as a plain string.
 *
 * Several panels type their navigation callback as `(tab: string) => void`
 * because they build the name from data rather than from a literal. Handing them
 * `setActiveTabState` directly does not type-check, and rightly so: it accepts
 * only TabKey, so any of them could set the dashboard to a tab that does not
 * exist and blank the screen. Checking against the menu the sidebar is built
 * from means the two can never disagree.
 */
const KNOWN_TAB_KEYS: ReadonlySet<string> = new Set(
  DASHBOARD_MENU_GROUPS.flatMap(group => group.items.map(item => item.key)),
);

export function isTabKey(value: string): value is TabKey {
  return KNOWN_TAB_KEYS.has(value);
}
