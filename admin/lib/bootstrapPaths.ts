import { cairoDateOnly, cairoMonthOnly } from '../../shared/cairoDate';

/**
 * The paths the accounts screens and «إحصائيات الدقي» ask for when they open, exactly as they send them, so the panel's one request to /admin/bootstrap can answer them
 * (api/routes/admin-bootstrap.js: `set=accounting` with an optional `branch`, and `set=dokki`; a test holds these lists to the server's).
 * A path is served from a set only on the screen that asks for it: the same reads from another screen go to the network as before.
 */

/** «الحسابات» (branch '') or a branch's accounts ('daqqi' | 'tagamoa'). */
export function accountingPaths(branch: string, today = cairoDateOnly(), month = cairoMonthOnly()): string[] {
  if (branch) {
    return [
      '/admin/receipts/gaps', `/admin/finance/boxes?branch=${branch}`,
      `/admin/payments/review?status=pending&limit=1&branch=${branch}`, `/admin/dokki/installment-clients?branch=${branch}`, '/admin/subscribers/stats',
      '/admin/expense-categories', `/admin/payment-proofs?branch=${branch}`, `/admin/financial/pnl?from=2000-01-01&to=${today}&branch=${branch}`,
    ];
  }
  return [
    '/admin/receipts/gaps', '/admin/subscribers/stats', '/admin/expense-categories', '/admin/expenses/page?limit=1&offset=0', '/admin/payment-proofs',
    `/admin/finance/revenue-breakdown?month=${month}`, `/admin/financial/pnl?from=2000-01-01&to=${today}`,
  ];
}

/** «إحصائيات الدقي». */
export function dokkiStatsPaths(today = cairoDateOnly()): string[] {
  return [
    '/admin/daqqi/weekly-report?branch=DAQQI', '/admin/daqqi/automation', '/admin/daqqi/daily-brief?branch=DAQQI',
    `/admin/reports/teams/daqqi?from=${today}&to=${today}`, '/admin/discounts', '/admin/contact-messages', '/admin/analytics-summary?range=all', '/admin/join-us/counts',
  ];
}

/**
 * The bootstrap set that answers `path` on the screen at `where` (location.pathname), or null: 'accounting:' (the books), 'accounting:daqqi', 'accounting:tagamoa'
 * or 'dokki'.
 */
export function screenSetOf(path: string, where: string): string | null {
  const branch = /\/dashboard\/(daqqi|tagamoa)_accounting(\/|$)/.exec(where)?.[1];
  if (branch) return accountingPaths(branch).includes(path) ? `accounting:${branch}` : null;
  if (/\/dashboard\/financial(\/|$)/.test(where)) return accountingPaths('').includes(path) ? 'accounting:' : null;
  if (/\/dashboard\/daqqi_stats(\/|$)/.test(where)) return dokkiStatsPaths().includes(path) ? 'dokki' : null;
  return null;
}
