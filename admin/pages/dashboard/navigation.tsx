import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Clock,
  CreditCard,
  Database,
  FileText,
  FolderKanban,
  Globe,
  GraduationCap,
  Headphones,
  Image,
  LayoutDashboard,
  ListOrdered,
  Mail,
  Megaphone,
  MessageSquareText,
  Monitor,
  RotateCcw,
  Settings2,
  Shield,
  Star,
  Target,
  TrendingUp,
  User,
  UserCheck,
  UserPlus,
  Users,
  UserSearch,
  Video,
  Zap,
} from 'lucide-react';

export type TabKey =
  | 'overview'
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
  | 'branch_workspace'
  | 'hr_hub'
  | 'analytics_hub'
  | 'saas_settings'
  | 'rbac_settings'
  | 'activity'
  | 'footer_settings'
  | 'discounts'
  | 'notifications'
  | 'daqqi_attendance'
  | 'daqqi_schedule'
  | 'client'
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
  | 'live_streams'
  | 'staff_settings'
  | 'online_clients'
  | 'daqqi_clients'
  | 'my_clients'
  | 'refund_requests'
  | 'daqqi_accounting'
  | 'daqqi_stats'
  | 'sales_hub'
  | 'marketing_hub'
  | 'online_hub'
  | 'staff_performance'
  | 'retention'
  | 'cohort_analysis'
  | 'kpi_dashboard'
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
  | 'my_hr'
  | 'staff_applications'
  | 'lecturer_applications'
  | 'system_settings'
  | 'automation_dashboard'
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
      { key: 'ask_ai', label: 'مساعد AI', icon: Zap },
      { key: 'activity', label: 'سجل النشاط', icon: Activity },
      { key: 'tasks_board', label: 'لوحة المهام', icon: FileText },
      // التحليلات (مدمجة داخل الإدارة)
      { key: 'retention', label: 'الاستبقاء الشهري', icon: TrendingUp },
      { key: 'cohort_analysis', label: 'تحليل الكوهورت', icon: BarChart3 },
      { key: 'revenue_sources', label: 'مصادر الإيرادات', icon: TrendingUp },
      { key: 'expense_analytics', label: 'تحليل المصروفات', icon: BarChart3 },
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
      { key: 'tickets', label: 'تذاكر الدعم', icon: Mail },
      { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
      { key: 'cert_requests', label: 'طلبات الشهادات', icon: Star },
      { key: 'contacts', label: 'رسائل التواصل', icon: Mail },
      { key: 'consultations', label: 'الاستشارات', icon: CalendarCheck2 },
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
      { key: 'financial_reports', label: 'التقارير المالية', icon: BarChart3 },
      { key: 'analytics_hub', label: 'التحليلات والمؤشرات', icon: TrendingUp },
    ],
  },
  {
    key: 'hr_group',
    label: 'الموارد البشرية',
    icon: Briefcase,
    color: 'text-purple-600',
    items: [
      { key: 'hr_hub', label: 'الموارد البشرية والموظفون', icon: Briefcase },
      { key: 'instructors', label: 'المحاضرون والخبراء', icon: GraduationCap },
      { key: 'join_us', label: 'طلبات الانضمام', icon: GraduationCap },
    ],
  },
  {
    key: 'marketing',
    label: 'التسويق',
    icon: Megaphone,
    color: 'text-rose-600',
    items: [
      { key: 'marketing_hub', label: 'مركز التسويق الشامل', icon: Megaphone },
    ],
  },
  {
    key: 'site_content',
    label: 'المحتوى',
    icon: FileText,
    color: 'text-violet-600',
    items: [
      { key: 'courses', label: 'الكورسات والدبلومات', icon: BookOpen },
      { key: 'lectures', label: 'المحاضرات', icon: ListOrdered },
      { key: 'bundles', label: 'المسارات والباقات', icon: FolderKanban },
      { key: 'testimonials', label: 'آراء العملاء', icon: MessageSquareText },
      { key: 'quizzes', label: 'الاختبارات', icon: FileText },
      { key: 'live_streams', label: 'البث المباشر', icon: Video },
      { key: 'community', label: 'إدارة المجتمع', icon: MessageSquareText },
      { key: 'content_hub', label: 'صفحات الموقع', icon: Globe },
      { key: 'institute_gallery', label: 'معرض الصور', icon: Image },
    ],
  },
  {
    key: 'settings',
    label: 'الإعدادات',
    icon: Settings2,
    color: 'text-gray-600',
    items: [
      // All settings (general, finance, platform, AI, security, system) are now
      // consolidated inside this single page — see SystemSettingsTab sections.
      { key: 'system_settings', label: 'الإعدادات', icon: Settings2 },
    ],
  },
];
