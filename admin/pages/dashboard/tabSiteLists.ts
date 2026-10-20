import { SITE_LISTS, type SiteList } from '../../context/site-data-hooks/siteLists';

/**
 * Which of the on-demand lists (context/site-data-hooks/siteLists.ts) each
 * screen reads, for the screens someone has read through.
 *
 * A screen that is not here gets every list, the moment it opens. That is what
 * every screen had before the lists stopped coming with the panel (11 Oct 2026),
 * only later — so a screen nobody has checked cannot open on an empty array
 * that it takes for "the institute has none". A screen joins this map once each
 * file it draws has been read and what it needs is written down; from then on it
 * opens without the 1.5 MB. api/tests/adminLoadsWhatTheScreenReads.test.js walks
 * the imports of every screen here and fails on a context read it does not list.
 *
 * Keys are tab keys, the same as dashboardTabGroups.ts — a key that names no
 * screen is reported by tools/dashboard-tab-audit.mjs.
 */
export const tabSiteLists: Readonly<Record<string, readonly SiteList[]>> = {
  // الرئيسية: every count on it comes from leads/stats, subscribers/stats and
  // overview/revenue. The newest leads and the lists behind each card are
  // fetched when they are shown; «التقارير التفصيلية» loads its own lists when
  // it is opened (AnalyticsTab calls useEnsureSiteLists).
  overview: [],
  // Server reports end to end (/admin/reports/*, /admin/kpi/*).
  management_reports: [],
  kpi_dashboard: [],
  // Reads /admin/consultations itself; the consultations list it shares comes
  // with the panel.
  consultations: [],

  // ── Read through on 12 Oct 2026, every file each screen draws, the lazy
  // sections and popups among them, and the props Dashboard.tsx hands it. ──

  // العملاء: the table is the context's clients (the full table for الأونلاين,
  // the branch's pages for الدقي — both loaded in Dashboard.tsx); the housing
  // column reads the rounds. A staff-built tab asks for the leads it lists
  // (SectionCustomTabs), the refund popup reads the clients.
  online_clients: ['subscribers', 'daqqiRounds'],
  // The Dokki clients page from the server (GET /api/admin/dokki/clients) for everyone.
  daqqi_clients: ['daqqiRounds'],
  // The accounts: the orders, and the clients the ?branch= filter and the
  // refund popup match them against. The finance screens add the expenses.
  orders: ['orders', 'subscribers'],
  financial: ['orders', 'subscribers', 'expenses'],
  // The branch's books: the expenses; its clients' plans, the payments waiting for review and the person a payment is for
  // come from the server (FinancialBranchTab).
  daqqi_accounting: ['expenses'],
  // The books and statements read their own endpoints; «الميزانية مقابل الفعلي» takes the month's revenue from the server
  // (GET /api/admin/analytics-hub/month-revenue).
  financial_reports: [],
  recurring_expenses: [],
  // قاعدة العملاء searches the server; «حجز» finds the row it booked among the
  // loaded clients and leads (Dashboard.tsx handleClientDbBook).
  client: ['subscribers', 'leads'],
  refund_requests: ['subscribers'],
  installment_plans: ['subscribers'],
  subscriptions: ['subscribers'],
  archived_clients: [],
  // The leads table, the board and the reminders read the server; the
  // performance strip and the conversion popup still read the loaded rows.
  leads: ['leads', 'subscribers'],
  sales_hub: ['leads', 'orders', 'subscribers'],
  sales_team: ['leads', 'orders'],
  sales_reports: ['leads', 'orders'],
  sales_planning: ['leads', 'orders'],
  staff_performance: ['leads', 'orders'],
  sales_daqqi_schedule: [],
  marketing_hub: ['leads', 'subscribers', 'orders', 'discounts', 'joinUsApplications'],
  campaigns: ['leads', 'subscribers'],
  online_team: ['leads', 'subscribers'],
  online_hub: [],
  // The four analyses (retention, cohort, revenue sources, expenses) are counted by the server (GET /api/admin/analytics-hub/*).
  analytics_hub: [],
  // AnalyticsTab, drawn whole here, with the branch's weekly panel.
  // The orders, leads and clients are counted by the server (GET /api/admin/analytics-summary).
  daqqi_stats: ['discounts', 'contactMessages'],
  ask_ai: ['leads', 'subscribers', 'orders', 'settings'],
  automation: ['automationWorkflows'],
  // The Dokki screens: the rounds and their attendees. The clients a round's
  // pickers offer, and the few it looks up, come from the server
  // (api/lib/dokkiClients.js), not from the context's list.
  daqqi_schedule: ['daqqiRounds'],
  daqqi_team: ['daqqiRounds'],
  daqqi_attendance: [],
  // HR, the inboxes and the service desks read their own endpoints.
  hr: [],
  hr_analytics: [],
  branch_hr: [],
  enps_dashboard: [],
  offboarding: [],
  interviews: [],
  team_inbox: [],
  whatsapp_web: [],
  customer_inbox: [],
  tickets: [],
  ratings: [],
  tasks_board: [],
  registrations: [],
  waitlist: [],
  course_waitlist: [],
  faq_manager: [],
  notif_inbox: [],
  staff_announcements: [],
  notifications: [],
  cx_team: [],
  consultation_calendar: [],
  service_hub: ['contactMessages', 'subscribers'],
  nps_dashboard: ['subscribers'],
  contacts: ['contactMessages'],
  // Both applications pages read their own 50 from the server (join-us/ApplicationsBoard.tsx),
  // not the shared list — it is what the analytics screens count, and nothing here asks for it.
  join_us: [],
  lecturer_applications: [],
  // سجل النظام searches the log on the server; the full backup it offers
  // writes out the loaded lists.
  activity: ['testimonials', 'subscribers', 'leads', 'orders', 'discounts'],
  // The academy (CoursesTab): each view asks for what it reads as well.
  courses: ['subscribers'],
  lectures: ['subscribers'],
  instructors: [],
  bundles: [],
  testimonials: ['testimonials'],
  discounts: ['discounts'],
  quizzes: ['courseQuizzes'],
  live_streams: ['liveStreams'],
  community: [],
  // The site's pages and settings: content, which comes with the panel.
  content_hub: [],
  footer_settings: [],
  policies: [],
  about_page: [],
  home_offer: [],
  institute_gallery: [],
  cert_pricing: [],
  cert_requests: [],
  page_courses: [],
  page_bundles: [],
  page_consultations: [],
  page_instructors: [],
  page_contact: [],
  page_joinus: [],
  page_community: [],
  page_course_details: [],
  page_bundle_details: [],
  page_misc: [],
  settings_hub: [],
  system_settings: [],
  branches_settings: [],
  branch_workspaces: [],
  lead_sources_settings: [],
  integrations: ['settings'],
  // The security log; the database move asks for every list itself (PgMigrateTab).
  security_center: ['activityLogs'],
  // ملفي: the desk's «اليوم» and «أدائي» read the server's own figures (GET /api/staff/home-summary).
  staff_home: [],
  staff_settings: [],
  my_hr: [],
};

/** The lists to load when `tab` opens: its own, or all of them for a screen nobody has listed. */
export function listsForTab(tab: string): readonly SiteList[] {
  return Object.prototype.hasOwnProperty.call(tabSiteLists, tab) ? tabSiteLists[tab] : SITE_LISTS;
}
