import type { TabKey } from './navigation';

/**
 * What a tab is called in the address bar, when that differs from its key.
 *
 * عملائي is every client an employee is responsible for — online, Daqqi, Saudi,
 * international — so `online_clients` describes a filter the screen no longer
 * applies. The URL says what the screen is; the key stays as it is because it
 * is referenced in twelve places (loading sets, permission gates, notification
 * targets, three role bars) and renaming it everywhere would be a much larger
 * change than the one being asked for.
 *
 * `subscribers` is an older spelling that has been redirecting here for a while.
 */
const TAB_TO_URL: Partial<Record<TabKey, string>> = {
  online_clients: 'my_clients',
};

const URL_TO_TAB: Record<string, TabKey> = {
  my_clients: 'online_clients',
  subscribers: 'online_clients',
  online_clients: 'online_clients',
  // Keys of screens since merged into a hub. Opened by an old link they drew
  // an empty page; they land on the screen that holds them now.
  // Pages removed on 5 Nov 2026 (analytics, sales planning, sales reports, the clients' archive, online management, instalment plans): an old link or bookmark
  // lands on the screen that now holds what it showed.
  analytics: 'kpi_dashboard', analytics_hub: 'kpi_dashboard', retention: 'kpi_dashboard', cohort_analysis: 'kpi_dashboard', revenue_sources: 'kpi_dashboard', expense_analytics: 'kpi_dashboard',
  sales_planning: 'sales_hub', sales_reports: 'sales_hub', followup_reminders: 'sales_hub', lead_scoring: 'sales_hub', forecast: 'sales_hub', sales_goals: 'sales_hub', revenue_forecast: 'sales_hub',
  archived_clients: 'client', online_team: 'online_hub', installment_plans: 'online_clients',
  ai_dev: 'ask_ai',
  hub_advanced: 'content_hub',
  site_design: 'content_hub',
};

/** The address-bar spelling for a tab key. */
export const urlForTab = (tab: TabKey): string => TAB_TO_URL[tab] || tab;

/** The tab key a URL segment names, or the segment itself when it is already one. */
export const tabForUrl = (segment: string | undefined): TabKey =>
  (segment && URL_TO_TAB[segment]) || (segment as TabKey);

/**
 * The canonical URL segment for whatever the address bar currently says.
 * When it differs from what was typed, the caller rewrites the URL — so
 * /dashboard/online_clients lands on /dashboard/my_clients and old links keep
 * working.
 */
export const urlToTabAlias = (segment: string | undefined): string | undefined =>
  segment ? urlForTab(tabForUrl(segment)) : segment;
