import type { SiteList } from '../../context/site-data-hooks/siteLists';

/**
 * The screens an employee (not an administrator) opens that page, filter and count on the server.
 *
 * An employee's panel used to download every lead and client in their scope, with the clients' payments (37,000 leads
 * and 5,000 clients for one sales rep on the production-scale lab), at sign-in, after every write, every two minutes
 * and at every return to the tab, and drew most of its screens out of them. Those screens now ask the server for the
 * page, the figures and the counts they show: the landing page (GET /api/staff/home-summary), «عملائي»
 * (/api/staff/subscribers?paged=1), the leads (/api/staff/leads-kpis and /api/admin/leads/…), the accounts desks
 * (/api/staff/payments), «إحصائياتي» (/api/staff/overview-summary) and the online manager's badges
 * (/api/staff/online-manager-summary). Nothing downloads the lists any more, and
 * api/tests/staffListsWaitForTheScreen.test.js fails if a file starts reading them again.
 */
const SERVER_PAGES: ReadonlySet<string> = new Set(['staff_home', 'staff_settings', 'my_hr', 'online_clients', 'leads', 'orders']);

/**
 * «عملائي» pages from the server for every employee (OnlineClientsTab, useStaffClientsPage), the online manager
 * included, so for them the context's full client list is not loaded when it opens.
 */
export const staffClientsArePaged = (tab: string, isNonAdminStaff: boolean, isOnlineManager: boolean): boolean =>
  tab === 'online_clients' && (isNonAdminStaff || isOnlineManager);

/**
 * The screens that read nothing from the context's lists either: a write there has no list to reload, so the
 * dashboard's reloadSubscribers only announces it (lib/crmChanged.ts). The other screens read the context's lists,
 * and a write there reloads them.
 */
export const staffScreenPagesFromServer = (tab: string): boolean => SERVER_PAGES.has(tab);

/**
 * The context's on-demand lists (siteLists.ts) an employee's session does not ask for on a screen that pages from the
 * server: the administration's version of the screen reads them, theirs does not.
 */
export const staffSkipsSiteLists = (tab: string): readonly SiteList[] =>
  tab === 'online_clients' ? ['subscribers'] : tab === 'orders' ? ['orders', 'subscribers'] : [];
