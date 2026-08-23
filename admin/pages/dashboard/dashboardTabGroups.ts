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

/**
 * Screens that read every lead or subscriber row, not just a page of them.
 *
 * The full tables used to be pulled one second after login for everyone, on
 * every page load — 26,878 leads and 1,353 subscribers whether the session ever
 * opened one of these or not. Reception, HR, the accountant and the instructors
 * never do.
 *
 * Membership is decided by "does this screen scan the whole table", which is why
 * duplicate review, scoring and segmentation are here while the Dokki screens
 * are not: they work from their own scoped lists. When in doubt, add the tab —
 * loading data nobody looks at is slow, but a screen computing over a partial
 * array is wrong, and wrong is worse.
 */
/** Sub-tabs of the leads screen that genuinely need every lead in memory.
 *
 *  The screen itself is deliberately not in `fullCrmDataTabs` any more. Its
 *  landing view is the table, which is paginated and searched on the server, and
 *  the reminder / performance / analytics panels now read server aggregates. Only
 *  These still scan the array: the pipeline board renders every card, the
 *  duplicate finder compares every pair, and the four archive-family views
 *  (localNew, dawliNew, dawliOld, archive) filter the whole table — the archive
 *  specifically lists hidden rows, which the paged fetch never returns at all.
 *
 *  LeadsTab calls loadFullCrmData() when one of these opens, so the 26,878-row
 *  fetch happens on the screens that need it and nowhere else. */
export const fullLeadArraySubTabs = new Set<string>([
  'pipeline',
  'duplicates',
  'communications',
  'localNew',
  'dawliNew',
  'dawliOld',
  'archive',
]);

/**
 * Which whole table a screen needs, split three ways.
 *
 * There used to be one list and one loader, so every screen on it paid for both
 * tables. The client screens read subscribers and never touch a lead; the
 * scoring and reminder screens are the exact opposite. Opening the online-client
 * list downloaded 26,878 leads it does not render, and opening lead scoring
 * downloaded every subscriber it does not render.
 *
 * Screens absent from all three sets need neither. That is not an oversight:
 *
 *   kpi_dashboard, cohort_analysis, automation — render from their own
 *     endpoints and receive nothing from SiteDataContext. <KpiDashboardTab
 *     notify={notify} /> is the whole call site.
 *
 *   archived_clients — fetches /admin/subscribers/archived itself, with its own
 *     search. It never reads the context array, so pulling one for it was pure
 *     waste.
 *
 *   email_campaigns, sms_campaigns — wanted both tables to render two numbers
 *     in an audience dropdown: "المشتركون (1,353)" and "الليدات (26,878)".
 *     Both now come from leadStats and /admin/subscribers/stats.
 *
 *   leads — its landing table is paginated and its panels read aggregates; see
 *     fullLeadArraySubTabs above for the sub-tabs that still scan the array.
 */

/** Reads every lead, no subscribers. */
export const fullLeadTabs = new Set<string>([
  'lead_scoring',        // scores and sorts every lead
  'followup_reminders',  // buckets every lead by follow-up date
  'revenue_sources',
  'staff_performance',   // per-rep counts over a date range
]);

/** Reads every subscriber, no leads. */
export const fullSubscriberTabs = new Set<string>([
  'online_clients',
]);

/** Genuinely reads both tables. */
export const fullCrmDataTabs = new Set<string>([
  'analytics',
  'marketing',          // segmentation builds audiences from both tables
  'drip_campaigns',     // enrolment picker lists real people, needs rows
  'ask_ai',
  'crm_settings',
]);
