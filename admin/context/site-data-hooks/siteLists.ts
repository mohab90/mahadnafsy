/**
 * The lists the panel loads when a screen reads them, not at sign-in.
 *
 * Measured on 11 Oct 2026 against the local copy of production (520,005 leads,
 * 53,001 clients): opening the panel made 40 requests and pulled 1.56 MB before
 * anyone had clicked anything — 842 KB of it the 500 newest clients, 350 KB the
 * 500 newest leads and 277 KB the 500 newest orders. The landing screen, الرئيسية,
 * shows counts the database already answers (leads/stats, subscribers/stats,
 * overview/revenue), so every one of those rows was carried for nothing.
 *
 * The small lists every screen leans on — staff, the catalogue, content, the
 * consultations and the broadcast settings behind the menu's badge — still come
 * with the panel. Everything here comes when a screen asks: Dashboard.tsx asks
 * for the lists of the tab on screen (pages/dashboard/tabSiteLists.ts), and a
 * page or a popup outside the tabs asks with useEnsureSiteLists().
 *
 * No imports, so api/tests/adminLoadsWhatTheScreenReads.test.js can load it.
 */
export const SITE_LISTS = [
  'subscribers', 'leads', 'orders', 'expenses', 'activityLogs',
  'testimonials', 'courseQuizzes', 'liveStreams',
  'joinUsApplications', 'contactMessages', 'daqqiRounds',
  'automationWorkflows', 'discounts', 'settings',
] as const;

export type SiteList = typeof SITE_LISTS[number];

/**
 * The context keys each list fills. A screen that reads one of these keys from
 * useSiteData() and friends needs that list loaded, or it renders an empty
 * array as if the institute had none.
 */
export const SITE_LIST_KEYS: Readonly<Record<SiteList, readonly string[]>> = {
  subscribers: ['subscribers'],
  leads: ['leads'],
  orders: ['orders'],
  expenses: ['expenses'],
  activityLogs: ['activityLogs'],
  testimonials: ['testimonials'],
  courseQuizzes: ['courseQuizzes'],
  liveStreams: ['liveStreams'],
  joinUsApplications: ['joinUsApplications'],
  contactMessages: ['contactMessages'],
  daqqiRounds: ['daqqiRounds'],
  automationWorkflows: ['automationWorkflows'],
  discounts: ['discounts'],
  // One request (/admin/settings) answers all four.
  settings: ['adminAiConfig', 'aiAgentConfig', 'messagingChannels', 'fbLeadAdsConfig'],
};

/** The list a context key belongs to, or null for a key the panel loads at sign-in. */
export function listOfKey(key: string): SiteList | null {
  for (const list of SITE_LISTS) if (SITE_LIST_KEYS[list].includes(key)) return list;
  return null;
}
