/**
 * Which screens an employee (not an admin) opens that read the person's own lists of leads and clients.
 *
 * Those lists — every lead and client in the role's scope, with the clients' payments — were downloaded at sign-in
 * for every role, again after every write, every two minutes and at every return to the tab (37,000 leads for one
 * sales rep on the production-scale lab). The screens below read the server's own figures instead
 * (GET /api/staff/home-summary and /api/staff/payments), so the download waits for the first screen that is not
 * on this list: the landing page, the person's own pages, their payments and their leads no longer start it.
 * The leads screen pages its table and board from the server and asks for its strip, its follow-ups drawer, its
 * contact search, its export and its client lookups one figure at a time (GET /api/staff/leads-kpis and
 * /api/admin/leads/{table,board,followups-panel,clients}).
 *
 * A screen not named here is assumed to need the lists, so a screen nobody has checked cannot open on an empty
 * array that it takes for "no clients". api/tests/staffListsWaitForTheScreen.test.js holds this list to what the
 * files below really read.
 */
const OWN_PAGES: ReadonlySet<string> = new Set(['staff_home', 'staff_settings', 'my_hr', 'leads']);

/** Accounts roles keep the accounts screen (OrdersTab), which reads the loaded clients. */
const KEEPS_THE_ACCOUNTS = ['accountant', 'support'];

export function staffScreenReadsLists(tab: string, role: string | undefined, isOnlineManager: boolean): boolean {
  // The online manager's header badges count installments and new payments out of the clients.
  if (isOnlineManager) return true;
  if (OWN_PAGES.has(tab)) return false;
  if (tab === 'orders') return KEEPS_THE_ACCOUNTS.includes(String(role || '').toLowerCase());
  return true;
}
