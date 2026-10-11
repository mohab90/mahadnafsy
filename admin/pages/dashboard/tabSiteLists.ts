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
};

/** The lists to load when `tab` opens: its own, or all of them for a screen nobody has listed. */
export function listsForTab(tab: string): readonly SiteList[] {
  return Object.prototype.hasOwnProperty.call(tabSiteLists, tab) ? tabSiteLists[tab] : SITE_LISTS;
}
