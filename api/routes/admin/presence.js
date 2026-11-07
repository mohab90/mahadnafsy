'use strict';
// «مين فاتح السيستم دلوقتي»: the staff in the panel now (lib/staffPresence.js) and the clients on their account page now (lib/onlineUsers.js).
//
// POST /api/staff/presence is the panel's beat — any signed-in member of staff, the owner included. The reading is the owner's and the managers' by default
// (view_presence, which the wildcard roles carry and no other role's defaults do); it holds names, screens and times, and no address or device anywhere.

const logger = require('../../lib/logger');
const express = require('express');
const router = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission, requirePermissionOrOwnRows } = require('../../middleware/auth');
const { listOnlineUsers } = require('../../lib/onlineUsers');
const { statusOf, whoIs, notePresence, listPresence, ONLINE_MS, IDLE_MS } = require('../../lib/staffPresence');

const SCREEN = /^[a-z0-9_-]{1,64}$/i;
const STATUS_RANK = { online: 0, idle: 1, offline: 2 };
const CLIENTS_SHOWN = 200;

// The panel's beat: which screen is open, and `opened` when it has just been opened (that counts as an action).
router.post('/api/staff/presence', requireAuth, requireAdminOrStaff, requirePermissionOrOwnRows('view_presence'), async (req, res) => {
  const screen = SCREEN.test(String(req.body?.screen || '')) ? String(req.body.screen) : null;
  await notePresence(whoIs(req), { screen, action: screen && req.body?.opened === true ? { kind: 'screen', label: screen } : null });
  res.json({ ok: true });
});

async function staffNow(tenantId, now) {
  const [staffRows, presence] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.role, s.branch_id, COALESCE(b.label, s.branch_id) AS branch_name
         FROM staff s LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
        WHERE s.tenant_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL`, [tenantId]).then(([rows]) => rows),
    listPresence(tenantId, { now }),
  ]);
  const seen = new Map(presence.map(row => [row.staffKey, row]));
  const rows = staffRows.map(person => {
    const p = seen.get(String(person.id)) || null;
    seen.delete(String(person.id));
    return { id: person.id, name: person.name, role: person.role, branchId: person.branch_id, branchName: person.branch_name, p };
  });
  // The owner signs in without a staff row: whoever was seen and is not in the staff list is shown as they introduced themselves.
  for (const p of seen.values()) rows.push({ id: p.staffKey, name: p.name || 'المالك', role: p.role || 'OWNER', branchId: null, branchName: null, p });
  return rows.map(({ p, ...person }) => ({
    ...person,
    status: statusOf(p?.lastSeenAt, now),
    screen: p?.screen || null,
    lastSeenAt: p ? new Date(p.lastSeenAt).toISOString() : null,
    lastActionAt: p?.lastActionAt ? new Date(p.lastActionAt).toISOString() : null,
    lastActionKind: p?.lastActionKind || null,
    lastActionLabel: p?.lastActionLabel || null,
    firstSeenToday: p?.firstSeenToday ? new Date(p.firstSeenToday).toISOString() : null,
  })).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')) || String(a.name).localeCompare(String(b.name), 'ar'));
}

async function clientsNow(tenantId) {
  const online = await listOnlineUsers(tenantId);
  const ids = [...new Set(online.map(user => user.courseId).filter(Boolean))];
  const titles = new Map();
  if (ids.length) {
    const [courses] = await pool.query('SELECT id, COALESCE(NULLIF(title_ar, \'\'), title) AS title FROM courses WHERE tenant_id = ? AND id IN (?)', [tenantId, ids]);
    for (const course of courses) titles.set(course.id, course.title);
  }
  const list = online.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, CLIENTS_SHOWN).map(user => ({
    uid: user.uid, name: user.name || user.email.split('@')[0] || '—', page: user.page || null,
    courseId: user.courseId || null, courseTitle: user.courseId ? titles.get(user.courseId) || null : null,
    lastSeenAt: new Date(user.lastSeen).toISOString(),
  }));
  return { count: online.length, list };
}

router.get('/api/admin/presence/now', requireAuth, requireAdminOrStaff, requirePermission('view_presence'), async (req, res) => {
  try {
    const now = Date.now();
    const [staff, clients] = await Promise.all([staffNow(req.tenantId, now), clientsNow(req.tenantId)]);
    res.set('Cache-Control', 'no-store');
    res.json({
      generatedAt: new Date(now).toISOString(), thresholds: { onlineSeconds: ONLINE_MS / 1000, idleSeconds: IDLE_MS / 1000 },
      counts: { online: staff.filter(s => s.status === 'online').length, idle: staff.filter(s => s.status === 'idle').length, offline: staff.filter(s => s.status === 'offline').length },
      staff, clients,
    });
  } catch (error) {
    logger.error('[presence/now]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
