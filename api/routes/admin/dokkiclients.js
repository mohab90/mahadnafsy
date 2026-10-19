'use strict';

// The Dokki (and Tagamoa) screens' clients, chosen on the server (lib/dokkiClients.js):
//   GET /api/admin/dokki/overview    { clients, waiting } — the strip above «جدول الدقي»
//   GET /api/admin/dokki/candidates  the clients a round's pickers offer, a page at a time, with every matching id
// The schedule used to stream the branch's whole client list with payments into the browser to work these out.

const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const logger = require('../../lib/logger');
const { parseLimit, parseOffset, sendRouteError } = require('../../lib/helpers');
const { ADMIN_EMAILS, requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { requireDaqqiAccess } = require('../../lib/daqqiAccess');
const { requestedBranch } = require('../../lib/physicalBranches');
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

module.exports = router;
