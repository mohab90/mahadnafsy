'use strict';

/**
 * GET /api/admin/bootstrap — what the admin panel asks for the moment it opens, in one request (5 Nov 2026).
 *
 * The panel used to open with 26 requests: the staff, the texts, the courses, tracks, consultations, therapists, notification settings, the community's four lists, the
 * inbox, branches, the header's notifications and receipts count, the online team and the month's sales targets. Each of them is a route of its own, with its own
 * permission, and this one runs those very routes (lib/internalRoute.js runRoute): every guard and every handler, against the request that asked. An account that may
 * not read a piece gets `null` for it — the panel then asks that route itself and receives its own refusal — and nothing here is a copy of what a route answers.
 *
 * `?set=overview` is the overview page's figures instead. The answer is keyed by the exact path the panel would have asked (admin/lib/mysqlapi.ts), so the panel serves its own call from it, once, and any call it does not
 * find here goes to the network as before. `?period=YYYY-MM` is the month whose sales targets are wanted.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { runRoute } = require('../lib/internalRoute');
const { cairoToday } = require('../lib/dates');
const logger = require('../lib/logger').child({ route: 'admin-bootstrap' });

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// [the path the panel asks, module that owns the route, the route's own path, the query the panel sends]
const CORE = period => [
  ['/admin/staff', '../routes/staff', '/api/admin/staff', {}],
  ['/admin/content', '../routes/config', '/api/admin/content', {}],
  ['/admin/consultations?limit=500', '../routes/core/staffacct', '/api/admin/consultations', { limit: '500' }],
  ['/admin/courses?limit=500', '../routes/admin/catalog', '/api/admin/courses', { limit: '500' }],
  ['/admin/bundles?limit=500', '../routes/core/catalog', '/api/admin/bundles', { limit: '500' }],
  ['/admin/therapists', '../routes/core/catalog', '/api/admin/therapists', {}],
  ['/admin/notification-settings', '../routes/config', '/api/admin/notification-settings', {}],
  ['/admin/community/posts', '../routes/community', '/api/admin/community/posts', {}],
  ['/community/library', '../routes/community', '/api/community/library', {}],
  ['/community/videos', '../routes/community', '/api/community/videos', {}],
  ['/community/events', '../routes/community', '/api/community/events', {}],
  ['/admin/inbox', '../routes/inbox', '/api/admin/inbox', {}],
  ['/branches', '../routes/public', '/api/branches', {}],
  ['/staff/announcements/pending', '../routes/staff-announcements', '/api/staff/announcements/pending', {}],
  ['/admin/hr/staff-messages/inbox', '../routes/hr/staffprofile', '/api/admin/hr/staff-messages/inbox', {}],
  ['/admin/notifications', '../routes/notifications', '/api/admin/notifications', {}],
  ['/admin/payment-proofs?status=PENDING', '../routes/payment-proofs', '/api/admin/payment-proofs', { status: 'PENDING' }],
  ['/admin/online-users', '../routes/admin/catalog', '/api/admin/online-users', {}],
  ...(period ? [[`/admin/sales-targets?period=${encodeURIComponent(period)}`, '../routes/analytics/sales', '/api/admin/sales-targets', { period }]] : []),
];

// The figures the overview page shows; they are slower than the rest, so the panel asks for them as a second request, at the same time, only when it opens that page.
const OVERVIEW = () => [
  ['/admin/leads/stats', '../routes/admin/leads/stats', '/api/admin/leads/stats', {}],
  ['/admin/leads/followups-due', '../routes/admin/leads/stats', '/api/admin/leads/followups-due', {}],
  ['/admin/subscribers/stats?overview=1', '../routes/admin/stafflists', '/api/admin/subscribers/stats', { overview: '1' }],
  ['/admin/overview/revenue', '../routes/analytics/dashboard', '/api/admin/overview/revenue', {}],
];

// The accounts screens (7 Nov 2026): what «الحسابات» (no branch) or a branch's accounts («حسابات الدقي» / «حسابات التجمع», ?branch=daqqi|tagamoa) ask for when they
// open — the keys are the exact paths and queries they send (today's date is the one the panel computes, in Cairo).
const BRANCHES = new Set(['daqqi', 'tagamoa']);
const ACCOUNTING = (today, month, branch) => (branch ? [
  ['/admin/receipts/gaps', '../routes/misc/receiptGaps', '/api/admin/receipts/gaps', {}],
  [`/admin/finance/boxes?branch=${branch}`, '../routes/finance/budgets', '/api/admin/finance/boxes', { branch }],
  [`/admin/payments/review?status=pending&limit=1&branch=${branch}`, '../routes/payments', '/api/admin/payments/review', { status: 'pending', limit: '1', branch }],
  [`/admin/dokki/installment-clients?branch=${branch}`, '../routes/admin/dokkiclients', '/api/admin/dokki/installment-clients', { branch }],
  ['/admin/subscribers/stats', '../routes/admin/stafflists', '/api/admin/subscribers/stats', {}],
  ['/admin/expense-categories', '../routes/admin-operations', '/api/admin/expense-categories', {}],
  [`/admin/payment-proofs?branch=${branch}`, '../routes/payment-proofs', '/api/admin/payment-proofs', { branch }],
  [`/admin/financial/pnl?from=2000-01-01&to=${today}&branch=${branch}`, '../routes/analytics/financial', '/api/admin/financial/pnl', { from: '2000-01-01', to: today, branch }],
] : [
  ['/admin/receipts/gaps', '../routes/misc/receiptGaps', '/api/admin/receipts/gaps', {}],
  ['/admin/subscribers/stats', '../routes/admin/stafflists', '/api/admin/subscribers/stats', {}],
  ['/admin/expense-categories', '../routes/admin-operations', '/api/admin/expense-categories', {}],
  ['/admin/expenses/page?limit=1&offset=0', '../routes/admin-operations', '/api/admin/expenses/page', { limit: '1', offset: '0' }],
  ['/admin/payment-proofs', '../routes/payment-proofs', '/api/admin/payment-proofs', {}],
  [`/admin/finance/revenue-breakdown?month=${month}`, '../routes/finance-payments-register', '/api/admin/finance/revenue-breakdown', { month }],
  [`/admin/financial/pnl?from=2000-01-01&to=${today}`, '../routes/analytics/financial', '/api/admin/financial/pnl', { from: '2000-01-01', to: today }],
]);

// «إحصائيات الدقي»: the reads the screen opens with through the panel's own call (the attendance report and the payment boxes are plain fetch() calls and not part of it).
const DOKKI_STATS = today => [
  ['/admin/daqqi/weekly-report?branch=DAQQI', '../routes/dokkiReports', '/api/admin/daqqi/weekly-report', { branch: 'DAQQI' }],
  ['/admin/daqqi/automation', '../routes/dokkiReports', '/api/admin/daqqi/automation', {}],
  ['/admin/daqqi/daily-brief?branch=DAQQI', '../routes/dokkiReports', '/api/admin/daqqi/daily-brief', { branch: 'DAQQI' }],
  [`/admin/reports/teams/daqqi?from=${today}&to=${today}`, '../routes/management-reports', '/api/admin/reports/teams/:team', { from: today, to: today }, { team: 'daqqi' }],
  ['/admin/discounts', '../routes/config', '/api/admin/discounts', {}],
  ['/admin/contact-messages', '../routes/admin-operations', '/api/admin/contact-messages', {}],
  ['/admin/analytics-summary?range=all', '../routes/admin/analyticssummary', '/api/admin/analytics-summary', { range: 'all' }],
  ['/admin/join-us/counts', '../routes/admin-operations', '/api/admin/join-us/counts', {}],
];

const SETS = ['core', 'overview', 'accounting', 'dokki'];
const piecesOf = (set, period, branch = null) => {
  if (set === 'overview') return OVERVIEW();
  const today = cairoToday();
  if (set === 'accounting') return ACCOUNTING(today, today.slice(0, 7), branch);
  if (set === 'dokki') return DOKKI_STATS(today);
  return CORE(period);
};

/** The paths this route answers for a set and a month; the panel's own list of what to look for must be this one (a test holds them together). */
const PIECE_PATHS = (set, period, branch = null) => piecesOf(set, period, branch).map(([key]) => key);

// Signed in is all this route asks: it holds no data of its own, and every piece runs behind its own route's guards (requireAdminOrStaff and its permission), so an
// account that is not staff receives a set of nulls — the same refusal each route would give it.
router.get('/api/admin/bootstrap', requireAuth, async (req, res) => {
  try {
    const set = SETS.includes(req.query.set) ? req.query.set : 'core';
    const branch = BRANCHES.has(req.query.branch) ? req.query.branch : null;
    const period = PERIOD.test(String(req.query.period || '')) ? String(req.query.period) : null;
    const entries = await Promise.all(piecesOf(set, period, branch).map(async ([key, modulePath, routePath, query, params]) => {
      try { return [key, await runRoute(require(modulePath), routePath, req, query, { params })]; }
      catch (error) { logger.warn('[admin-bootstrap] piece failed', key, error.message); return [key, null]; }
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ pieces: Object.fromEntries(entries) });
  } catch (error) {
    logger.error('[admin-bootstrap] failed', error.message);
    res.status(500).json({ error: 'Failed to load' });
  }
});

module.exports = router;
module.exports.PIECE_PATHS = PIECE_PATHS;
