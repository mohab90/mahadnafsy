'use strict';

// The Dokki (and Tagamoa) screens' clients, chosen on the server (lib/dokkiClients.js):
//   GET /api/admin/dokki/overview    { clients, waiting } — the strip above «جدول الدقي»
//   GET /api/admin/dokki/candidates  the clients a round's pickers offer, a page at a time, with every matching id
//   GET /api/admin/dokki/clients     «عملاء الدقي» a page at a time: { rows, total, tabCounts, followCounts, figures }
//   GET /api/admin/dokki/installment-clients  «حسابات الدقي» ← الأقساط: the branch's clients who hold an instalment plan
// The schedule and «عملاء الدقي» used to stream the branch's whole client list with payments into the browser.

const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const logger = require('../../lib/logger');
const { parseLimit, parseOffset, sendRouteError, ymd } = require('../../lib/helpers');
const { ADMIN_EMAILS, requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { requireDaqqiAccess } = require('../../lib/daqqiAccess');
const { requestedBranch, roundsScopeSql } = require('../../lib/physicalBranches');
const { ownOrPlaced } = require('../../lib/coursePlacement');
const { cairoToday, addDaysToDateOnly } = require('../../lib/dates');
const { buildView, readFilters } = require('../../lib/staffClientsView');
const { readBranchFacts, overviewOf, candidatesOf } = require('../../lib/dokkiClients');
const { staffClientTools } = require('./stafflists');

const guards = [requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess];

/**
 * The branch's clients this person may see, as a condition on `subscribers s`: the same population the schedule's
 * branch list held (active clients, not staff, inside the person's data scope — GET /api/admin/subscribers?branch=).
 * null for a role that sees no clients.
 */
function branchClients(req) {
  const scope = staffClientTools.subscriberScope(req);
  if (scope.none) return null;
  if (scope.forbidden) throw Object.assign(new Error('Staff record required'), { statusCode: 403 });
  const adminExclusions = ADMIN_EMAILS.length > 0
    ? ` AND (s.email IS NULL OR s.email NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
    : '';
  return {
    where: `s.deleted_at IS NULL AND s.is_active = 1 AND (${scope.clause}) AND NOT EXISTS (
      SELECT 1 FROM staff st WHERE st.tenant_id = s.tenant_id AND st.email = s.email AND st.is_active = 1
    )${adminExclusions}`,
    params: [...scope.params, ...ADMIN_EMAILS.map(email => email.toLowerCase())],
  };
}

// The facts both answers read, held 15 s and dropped by the next write (the `figures:` family, lib/httpApp.js).
async function branchFacts(req, branch) {
  const base = branchClients(req);
  if (!base) return { clients: [], courses: new Map(), rounds: [] };
  const who = req.staffRecord?.id || req.user?.uid || 'admin';
  return cached(`figures:dokki-facts:${req.tenantId}:${branch}:${who}`, 15 * 1000, () => readBranchFacts(pool, req.tenantId, base, branch));
}

router.get('/api/admin/dokki/overview', ...guards, async (req, res) => {
  try {
    res.json(overviewOf(await branchFacts(req, requestedBranch(req))));
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/dokki/overview]', e.message); sendRouteError(res, e); }
});

router.get('/api/admin/dokki/candidates', ...guards, async (req, res) => {
  try {
    const text = key => String(req.query[key] ?? '').trim();
    const housing = ['unhoused', 'housed'].includes(text('housing')) ? text('housing') : 'any';
    const matches = candidatesOf(await branchFacts(req, requestedBranch(req)), {
      enrolled: text('enrolled').slice(0, 80), housing, housedFor: text('housedFor').slice(0, 80),
      roundId: text('roundId').slice(0, 80), q: text('q').slice(0, 100),
    });
    const ids = matches.map(client => client.id);
    const limit = parseLimit(req.query.limit, 100, 300);
    const offset = parseOffset(req.query.offset || 0);
    // The page in full (payments, courses, prices — what the picker's rows show); every matching id, for «تحديد الكل».
    res.json({
      rows: await staffClientTools.loadShapedByIds(req.tenantId, ids.slice(offset, offset + limit)),
      total: ids.length, ids: ids.slice(0, 5000),
    });
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/dokki/candidates]', e.message); sendRouteError(res, e); }
});

// The rounds the screen reads for housing, the round and reception filters and the booking years — the schedule's own
// list (newest first, at most 500, a branch desk's branch only) with who sits in each.
async function dokkiRounds(req) {
  const scope = roundsScopeSql(req);
  const who = req.staffRecord?.id || req.user?.uid || 'admin';
  return cached(`figures:dokki-rounds:${req.tenantId}:${who}`, 15 * 1000, async () => {
    const [rounds] = await pool.query(
      `SELECT id, course_id, reception_id, status FROM daqqi_rounds WHERE tenant_id = ?${scope.sql} ORDER BY created_at DESC LIMIT 500`,
      [req.tenantId, ...scope.params]
    );
    const [seats] = rounds.length ? await pool.query(
      `SELECT da.round_id, da.subscriber_id, da.booked_at FROM daqqi_attendees da
        WHERE da.tenant_id = ? AND da.round_id IN (${rounds.map(() => '?').join(',')})`,
      [req.tenantId, ...rounds.map(round => round.id)]
    ) : [[]];
    const byRound = new Map(rounds.map(round => [round.id, {
      id: round.id, courseId: round.course_id, receptionId: round.reception_id || '',
      finished: String(round.status || '').toLowerCase() === 'finished', attendees: [],
    }]));
    for (const seat of seats) byRound.get(seat.round_id)?.attendees.push({ subscriberId: seat.subscriber_id, bookedAt: ymd(seat.booked_at) });
    return rounds.map(round => byRound.get(round.id));
  });
}

router.get('/api/admin/dokki/clients', ...guards, async (req, res) => {
  try {
    const branch = requestedBranch(req);
    const base = branchClients(req);
    const filters = { ...readFilters(req.query, { dokki: true }), branch: '' };
    const limit = parseLimit(req.query.limit, 24, 500);
    const offset = parseOffset(req.query.offset || 0);
    if (!base) {
      return res.json({ rows: [], total: 0, tabCounts: {}, followCounts: { overdue: 0, today: 0, tomorrow: 0 }, figures: { total: 0, active: 0, finished: 0, paused: 0, today: 0, week: 0, month: 0, remaining: 0, unassigned: 0 } });
    }
    // The branch's clients, those with a course placed in it included (the schedule's branch list).
    const scope = { where: `${base.where} AND ${ownOrPlaced([branch])}`, params: [...base.params, branch, branch] };
    const [{ rows, clients, catalogue }, rounds] = await Promise.all([staffClientTools.loadScopeClients(req, scope), dokkiRounds(req)]);
    const today = cairoToday();
    const view = buildView(clients, filters, {
      today, catalogue, dokki: { branch, rounds },
      weekStart: addDaysToDateOnly(today, -new Date(`${today}T00:00:00Z`).getUTCDay()),
      monthStart: `${today.slice(0, 7)}-01`,
    });
    const rowById = new Map(rows.map(row => [row.id, row]));
    const pageRows = view.ids.slice(offset, offset + limit).map(id => rowById.get(id));
    res.json({
      rows: await staffClientTools.shapeStaffSubscribers(req.tenantId, pageRows),
      total: view.ids.length, tabCounts: view.tabCounts, followCounts: view.followCounts, figures: view.figures,
      unassignedMatching: view.unassignedMatching, assignedCounts: view.assignedCounts,
    });
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/dokki/clients]', e.message); sendRouteError(res, e); }
});

// «حسابات الدقي» ← «الأقساط»: the branch's clients with an instalment plan, in full (the plans, the payments), for the
// screen's lists and its due-date exports. The accounts screen held the branch's whole client list to find them.
router.get('/api/admin/dokki/installment-clients', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const branch = requestedBranch(req);
    const base = branchClients(req);
    if (!base) return res.json([]);
    const [rows] = await pool.query(
      `SELECT s.id FROM subscribers s
        WHERE s.tenant_id = ? AND (${base.where}) AND s.branch = ?
          AND EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.tenant_id = s.tenant_id AND ip.subscriber_id = s.id)
        ORDER BY s.created_at DESC, s.id DESC LIMIT 1000`,
      [req.tenantId, ...base.params, branch]
    );
    res.json(await staffClientTools.loadShapedByIds(req.tenantId, rows.map(row => row.id)));
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/dokki/installment-clients]', e.message); sendRouteError(res, e); }
});

module.exports = router;
