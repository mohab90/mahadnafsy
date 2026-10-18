/**
 * Which screens an employee (not an admin) opens that read the person's own lists of leads and clients.
 *
 * Those lists — every lead and client in the role's scope, with the clients' payments — were downloaded at sign-in
 * for every role, again after every write, every two minutes and at every return to the tab (37,000 leads for one
 * sales rep on the production-scale lab). The screens below read the server's own figures instead
 * (GET /api/staff/home-summary and /api/staff/payments), «عملائي» reads the clients a page at a time with the server
 * filtering and counting them (GET /api/staff/subscribers?paged=1), and the leads screen pages its table and board from
 * the server and asks for its strip, its follow-ups drawer, its contact search, its export and its client lookups one
 * figure at a time (GET /api/staff/leads-kpis and /api/admin/leads/{table,board,followups-panel,clients}), so the
 * download waits for the first screen that is not on this list: the landing page, the person's own pages, their
 * payments, their clients and their leads no longer start it.
 *
 * A screen not named here is assumed to need the lists, so a screen nobody has checked cannot open on an empty
 * array that it takes for "no clients". api/tests/staffListsWaitForTheScreen.test.js holds this list to what the
 * files below really read.
 */
const OWN_PAGES: ReadonlySet<string> = new Set(['staff_home', 'staff_settings', 'my_hr', 'online_clients', 'leads']);

/** Accounts roles keep the accounts screen (OrdersTab), which reads the loaded clients. */
const KEEPS_THE_ACCOUNTS = ['accountant', 'support'];

/**
 * «عملائي» pages from the server for every employee (OnlineClientsTab, useStaffClientsPage), the online manager
 * included — his header badges and their panels read GET /api/staff/online-manager-summary — so for them neither the
 * staff list nor the context's full client list is loaded when it opens.
 */
export const staffClientsArePaged = (tab: string, isNonAdminStaff: boolean, isOnlineManager: boolean): boolean =>
  tab === 'online_clients' && (isNonAdminStaff || isOnlineManager);

export function staffScreenReadsLists(tab: string, role: string | undefined, isOnlineManager: boolean): boolean {
  if (OWN_PAGES.has(tab)) return false;
  // The accounts screen (OrdersTab) reads the loaded clients: the accounts roles' and the online manager's.
  if (tab === 'orders') return isOnlineManager || KEEPS_THE_ACCOUNTS.includes(String(role || '').toLowerCase());
  return true;
}
