export const directContentTabs = new Set<string>([
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
  // Both of these are registered in GeneralDashboardTabs, which renders only
  // inside DashboardContentHubRoutes, which renders only when activeTab is in
  // this set. Missing from it, they changed the URL and drew nothing: no
  // content, no request, no error, and their chunk was never fetched. The nav
  // offered both to every admin and neither would open.
  // The merged screens. Each holds several that used to be listed here
  // individually; their keys redirect into the matching section.
  'integrations',
  'security_center',
  'analytics_hub',
  'campaigns',
  'sales_planning',
  'archived_clients',
  'cx_team',
  'branches_settings',
  'content_hub',
  'footer_settings',
  'customer_inbox',
  'service_hub',
  'tasks_board',
  'installment_plans',
  'tickets',
  'nps_dashboard',
  'daqqi_team',
  'daqqi_accounting',
  'daqqi_stats',
  'financial_reports',
  'recurring_expenses',
  'hr',
  'staff_performance',
  'sales_team',
  'sales_reports',
  'online_team',
  'subscriptions',
  'consultation_calendar',
  'my_hr',
  'settings_hub',
  'lead_sources_settings',
  'branch_workspaces',
  'notif_inbox',
  'waitlist',
  'system_settings',
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
  'online_hub',
]);

export const saasOpsTabs = new Set<string>([
  'ask_ai',
  'automation',
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
 *  The screen itself is not in `fullCrmDataTabs`; the reminder / performance /
 *  analytics panels read server aggregates instead. These sub-tabs still scan
 *  the array: the pipeline board renders every card, the duplicate finder
 *  compares every pair, and the four archive-family views (localNew, dawliNew,
 *  dawliOld, archive) filter the whole table — the archive specifically lists
 *  hidden rows, which the paged fetch never returns at all.
 *
 *  'table' is here because the claim that used to stand in this comment — that
 *  the landing table is "paginated and searched on the server" — was not true of
 *  the code. LeadTable slices its `rows` prop 100 at a time in the browser, and
 *  `rows` is whatever the array holds, which on this screen was the 500-row
 *  bootstrap page. So the table read "500 عميل — عرض 1–100" against 30,964 real
 *  leads, and the desk could not see, search or distribute the other 30,464. One
 *  rep alone holds 2,613. Until the table genuinely pages against the server it
 *  has to hold the table it claims to be showing — the rule at the top of this
 *  file: a screen computing over a partial array is wrong, and wrong is worse.
 *
 *  LeadsTab calls loadFullCrmData() when one of these opens, so the 30,964-row
 *  fetch happens on the screens that need it and nowhere else. */
export const fullLeadArraySubTabs = new Set<string>([
  'pipeline',
  'duplicates',
  'communications',
  'localNew',
  'dawliNew',
  'dawliOld',
  'archive',
  'table',
  // 'reminders' builds two of its queues — never contacted, and promised to pay
  // — by scanning the array, because no server aggregate answers either one.
  // Left out, it scanned the 500-row bootstrap page: the board showed a handful
  // of rows and looked unchanged no matter what was added to it, while 14,795
  // untouched leads and every open payment promise sat outside the slice.
  'reminders',
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

/** Reads every lead, no subscribers.
 *
 *  Empty, and kept rather than deleted: it is the hook a future lead-scanning
 *  screen should reach for instead of quietly adding itself to fullCrmDataTabs
 *  and pulling the subscriber table it does not want as well.
 *
 *  What used to be here, and what replaced it:
 *
 *    lead_scoring        → GET /admin/leads/scored
 *    followup_reminders  → the reminders half of /admin/leads/crm-insights
 *    staff_performance   → GET /admin/leads/staff-performance
 *    revenue_sources     → the orders list now carries the lead's source, so
 *                          the browser-side lookup it needed the table for is
 *                          gone. That lookup never worked: orders has no
 *                          lead_id column and the mapper never set leadId, so
 *                          every order fell into the 'مباشر' bucket. */
export const fullLeadTabs = new Set<string>([
  // These two were unreachable until they were put in the menu, and both count
  // per-rep leads out of the array: sales_team builds the monthly table from
  // l.assignedSalesId, sales_reports the status breakdown and the range filter.
  // Reachable and unlisted, they would have counted the 500-row bootstrap page
  // and shown it as the pipeline — the fault this file already documents for
  // marketing_hub and analytics_hub.
  //
  // Listed rather than rewritten: the direction above is toward server
  // aggregates, and both are candidates for it — sales_reports wants a status
  // breakdown, sales_team a per-rep monthly roll-up, and the staff-performance
  // endpoint already returns byStatus per rep. Until someone does that, they
  // read the table, which is at least true.
  'sales_reports',
  'sales_team',
]);

/** Reads every subscriber, no leads. */
export const fullSubscriberTabs = new Set<string>([
  'online_clients',
  // retention buckets every subscriber into the month they joined and the month
  // they finished, twelve months at a time, then averages across all of them.
  // That genuinely needs the table — unlike the dashboard tile, a count would
  // not do. It was in no loading set at all, so it read the 500-row bootstrap
  // page and reported "500 إجمالي المشتركين" against 1,371.
  //
  // Named as the tab rather than as 'retention', because retention is a section
  // of تبويب التحليلات now and this set is keyed on what the URL says.
  'analytics_hub',
  // فريق الأونلاين builds each collection officer's overdue-instalment list by
  // filtering the subscribers array, and the أقساط متأخرة KPI from the same
  // filter. It was in no loading set, so it worked from the 500-row bootstrap
  // page — and that page is ordered newest first, so the rows it omitted were
  // the oldest clients, who are precisely the ones carrying arrears. A
  // collection officer was working a list missing the debts it exists to chase.
  'online_hub',
]);

/** Genuinely reads both tables. */
export const fullCrmDataTabs = new Set<string>([
  // Every key here has to name a screen. One that names nothing is silent: the
  // effect loading the data never fires, and the screen counts the 500-row
  // bootstrap page while presenting it as the table.
  //
  // Three of the five were wrong. 'marketing' is the nav group header above the
  // screen, whose key is 'marketing_hub' — so the marketing hub reported
  // "500 ليدات جديدة" against 27,000. 'analytics' and 'crm_settings' name
  // nothing at all: AnalyticsTab renders under 'daqqi_stats', and no screen
  // answers to crm_settings.
  'daqqi_stats',        // renders AnalyticsTab, which filters both tables by date
  'marketing_hub',      // segmentation builds audiences from both tables
  // Was 'drip_campaigns', whose enrolment picker lists real people and needs
  // the rows. That screen is a section of تبويب الحملات now, and this set is
  // keyed on the tab the URL names, so it has to name the tab.
  'campaigns',
  'ask_ai',
  // Assignment and workload rather than money: who carries which leads and which
  // subscribers. It reads both tables and filters each by branch, so both have
  // to be the real ones.
  'online_team',
]);
