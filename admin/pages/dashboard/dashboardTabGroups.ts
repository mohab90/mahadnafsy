export const directContentTabs = new Set<string>([
  'content',
  'policies',
  'about_page',
  'home_offer',
  'institute_gallery',
  'cert_pricing',
  'cert_requests',
  'page_courses',
  'page_bundles',
  'page_consultations',
  'page_instructors',
  'page_contact',
  'page_joinus',
  'page_community',
]);

export const contentHubRouteTabs = new Set<string>([
  'content_hub',
  'footer_settings',
  'customer_inbox',
  'service_hub',
  'tasks_board',
  'followup_reminders',
  'installment_plans',
  'tickets',
  'nps_dashboard',
  'daqqi_team',
  'daqqi_accounting',
  'daqqi_stats',
  'financial_reports',
  'balance_sheet',
  'cash_flow',
  'recurring_expenses',
  'budget_tracker',
  'revenue_forecast',
  'hr',
  'staff_management',
  'webhooks',
  'security_dashboard',
  'staff_performance',
  'retention',
  'forecast',
  'sales_team',
  'sales_reports',
  'sales_goals',
  'online_team',
  'subscriptions',
  'lead_scoring',
  'consultation_calendar',
  'expense_analytics',
  'revenue_sources',
  'my_hr',
  'settings_hub',
  'ip_whitelist',
  'payment_settings',
  'lead_sources_settings',
  'otp_settings',
  'branch_workspaces',
  'sms_settings',
  'notif_inbox',
  'email_campaigns',
  'sms_campaigns',
  'drip_campaigns',
  'waitlist',
  'system_settings',
  'staff_applications',
  'lecturer_applications',
  // These four are registered in GeneralDashboardTabs' notifyTabs but were
  // never added here, so Dashboard.tsx's `contentHubRouteTabs.has(activeTab)`
  // gate never mounted <DashboardContentHubRoutes> for them: the nav item
  // switched activeTab, but nothing rendered (confirmed live — clicking
  // "قاعدة المعرفة (FAQ)", "تقارير وتحليلات HR", "رضا الموظفين (eNPS)" or
  // "إنهاء الخدمة" showed just the empty shell). registrations is the new
  // تسجيلات tab, added here so it doesn't ship with the same gap.
  'faq_manager',
  'hr_analytics',
  'enps_dashboard',
  'offboarding',
  'registrations',
  'interviews',
]);

export const growthOpsTabs = new Set<string>([
  'leads',
  'daqqi_schedule',
  'sales_hub',
  'marketing_hub',
  // DashboardGrowthOpsTabs.tsx has always handled activeTab === 'messaging_hub'
  // (renders MessagingHubTab), but this Set never listed it, so the mount
  // gate at Dashboard.tsx (`growthOpsTabs.has(activeTab)`) always skipped it —
  // clicking "الواتساب والماسنجر" rendered nothing. Confirmed live.
  'messaging_hub',
  'online_hub',
]);

export const saasOpsTabs = new Set<string>([
  'ask_ai',
  'automation',
  'messaging_agent',
  'admin_ai_settings',
  'pg_migrate',
  'server_monitor',
]);
