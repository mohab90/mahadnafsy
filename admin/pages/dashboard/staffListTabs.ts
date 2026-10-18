import type { SiteList } from '../../context/site-data-hooks/siteLists';
import { tabSiteLists } from './tabSiteLists';

/**
 * Which screens an employee (not an admin) opens that read the person's own lists of leads and clients.
 *
 * Those lists — every lead and client in the role's scope, with the clients' payments — were downloaded at sign-in
 * for every role, again after every write, every two minutes and at every return to the tab (37,000 leads for one
 * sales rep on the production-scale lab). A screen that reads them gets them (useStaffOwnData); every other screen
 * opens without the download.
 *
 * What reads them is named in READS_OWN_LISTS, which api/tests/staffListsWaitForTheScreen.test.js holds to the files
 * that really touch the lists (salesOwn* props, the context's staffScoped* lists): a screen that starts reading them
 * fails that test until it is named here. The rest — the landing page, the person's own pages, their payments,
 * their clients, their leads, the service desks, the inboxes, the settings — read the server's own figures or pages
 * (GET /api/staff/home-summary, /api/staff/payments, /api/staff/subscribers?paged=1, /api/staff/leads-kpis, …).
 *
 * A screen nobody has listed anywhere (neither here nor in tabSiteLists.ts) is assumed to need the lists, so a
 * screen nobody has checked cannot open on an empty array that it takes for "no clients".
 */
const OWN_PAGES: ReadonlySet<string> = new Set(['staff_home', 'staff_settings', 'my_hr', 'online_clients', 'leads', 'orders']);

/** The screens that still read the person's own lists (the files are listed in the test). */
const READS_OWN_LISTS: ReadonlySet<string> = new Set([
  'overview', 'client', 'daqqi_schedule', 'daqqi_clients',
]);

/**
 * «عملائي» pages from the server for every employee (OnlineClientsTab, useStaffClientsPage), the online manager
 * included — his header badges and their panels read GET /api/staff/online-manager-summary — so for them neither the
 * staff list nor the context's full client list is loaded when it opens.
 */
export const staffClientsArePaged = (tab: string, isNonAdminStaff: boolean, isOnlineManager: boolean): boolean =>
  tab === 'online_clients' && (isNonAdminStaff || isOnlineManager);

/**
 * The context's on-demand lists (siteLists.ts) an employee's session does not ask for on a screen that pages from the
 * server: the administration's version of the screen reads them, theirs does not.
 */
export const staffSkipsSiteLists = (tab: string): readonly SiteList[] =>
  tab === 'online_clients' ? ['subscribers'] : tab === 'orders' ? ['orders', 'subscribers'] : [];

export function staffScreenReadsLists(tab: string): boolean {
  if (OWN_PAGES.has(tab)) return false;
  if (READS_OWN_LISTS.has(tab)) return true;
  // A screen that tabSiteLists.ts lists has been read through, and none of it touches the person's own lists.
  return !Object.prototype.hasOwnProperty.call(tabSiteLists, tab);
}
