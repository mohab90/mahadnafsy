'use strict';
/**
 * Staff profile intelligence + the management↔employee message thread.
 *
 * Everything here is computed in SQL on purpose. The admin staff page used to
 * derive its numbers by scanning the full client-side `leads` + `subscribers`
 * arrays in the browser — which only works while those arrays are fully loaded
 * (they are ~13k rows and several MB at this tenant), can't reach data the
 * browser never loaded, and cannot produce a whole-employment-period monthly
 * series at all. These endpoints answer with just the aggregates the page
 * draws, so the page stays fast regardless of CRM size.
 */
const { Router } = require('express');
const router = Router();
const {
  requireAuth, requireAdminOrStaff, requirePermission, logger, pool, uuidv4,
  createNotification, _resolveStaffByUser,
} = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');

const MAX_BODY = 4000;

/**
 * "YYYY-MM-DD" from whatever the driver handed us. `datetime` columns come back
 * as JS Date objects (the pool only sets dateStrings for DATE), and
 * String(dateObject).slice(0,10) yields "Thu Apr 1" — which silently poisoned
 * both the month span and the SQL range filters. Normalise explicitly.
 */
function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Month keys from `from` (YYYY-MM) through the current month, inclusive. */
function monthSpan(fromIso) {
  const start = new Date(`${String(fromIso || '').slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const keys = [];
  const cursor = new Date(start);
  const now = new Date();
  // Hard ceiling so a bad joined_at (e.g. year 1900) can't spin out a huge array.
  for (let guard = 0; guard < 240; guard += 1) {
    keys.push(cursor.toISOString().slice(0, 7));
    if (cursor.getUTCFullYear() > now.getUTCFullYear()
      || (cursor.getUTCFullYear() === now.getUTCFullYear() && cursor.getUTCMonth() >= now.getUTCMonth())) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

// GET /api/admin/hr/staff/:id/profile — the whole professional profile in one call.
router.get('/api/admin/hr/staff/:id/profile', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { id } = req.params;
    const [[staff]] = await pool.query(
      `SELECT id, name, role, joined_at, created_at, commission_rate,
              monthly_target, monthly_target_type, monthly_bonus
         FROM staff
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1`,
      [id, req.tenantId]
    );
    if (!staff) return res.status(404).json({ error: 'Employee not found' });

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const since = toIsoDate(staff.joined_at) || toIsoDate(staff.created_at) || today;

    const [
      [monthlyMoney], [monthlyLeads], [monthlyCalls],
      [todayRow], [rankRows], [firsts], [taskRow],
    ] = await Promise.all([
      // Revenue + bookings per month (payments are the source of truth for money).
      pool.query(
        `SELECT DATE_FORMAT(date,'%Y-%m') ym, COUNT(*) bookings, COALESCE(SUM(amount_egp),0) revenue
           FROM payments
          WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL AND date>=?
          GROUP BY ym ORDER BY ym`,
        [req.tenantId, id, since]
      ),
      pool.query(
        `SELECT DATE_FORMAT(created_at,'%Y-%m') ym, COUNT(*) leads,
                SUM(status IN ('converted','won')) converted
           FROM leads
          WHERE tenant_id=? AND assigned_sales_id=? AND deleted_at IS NULL AND created_at>=?
          GROUP BY ym ORDER BY ym`,
        [req.tenantId, id, since]
      ),
      pool.query(
        `SELECT DATE_FORMAT(date,'%Y-%m') ym, COUNT(*) total,
                SUM(type='CALL') calls
           FROM communications
          WHERE tenant_id=? AND staff_id=? AND date>=?
          GROUP BY ym ORDER BY ym`,
        [req.tenantId, id, since]
      ),
      // Today's counters — the two the owner asked for, plus context.
      // Compared as a half-open range rather than DATE(col)=?: wrapping the
      // column in DATE() would defeat every index these tables have on it
      // (idx_pay_staff_date, the new idx_comm_tenant_staff_date) and turn each
      // of these into a full scan.
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM communications
             WHERE tenant_id=? AND staff_id=? AND type='CALL' AND date>=? AND date<?) AS calls_today,
           (SELECT COUNT(*) FROM communications
             WHERE tenant_id=? AND staff_id=? AND date>=? AND date<?) AS touches_today,
           (SELECT COUNT(*) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL AND date>=? AND date<?) AS bookings_today,
           (SELECT COALESCE(SUM(amount_egp),0) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL AND date>=? AND date<?) AS revenue_today,
           (SELECT COUNT(*) FROM leads
             WHERE tenant_id=? AND assigned_sales_id=? AND deleted_at IS NULL AND created_at>=? AND created_at<?) AS leads_today`,
        [req.tenantId, id, today, tomorrow, req.tenantId, id, today, tomorrow,
          req.tenantId, id, today, tomorrow, req.tenantId, id, today, tomorrow,
          req.tenantId, id, today, tomorrow]
      ),
      // Leaderboard over the current month — rank is computed across the whole
      // active team so "ترتيب نجاحه" is a real standing, not a self-comparison.
      pool.query(
        `SELECT s.id, s.name,
                COALESCE(p.revenue,0) revenue,
                COALESCE(p.bookings,0) bookings,
                COALESCE(c.calls,0) calls
           FROM staff s
           LEFT JOIN (SELECT staff_id, SUM(amount_egp) revenue, COUNT(*) bookings
                        FROM payments
                       WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL
                         AND date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')
                       GROUP BY staff_id) p ON p.staff_id=s.id
           LEFT JOIN (SELECT staff_id, COUNT(*) calls
                        FROM communications
                       WHERE tenant_id=? AND type='CALL'
                         AND date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')
                       GROUP BY staff_id) c ON c.staff_id=s.id
          WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
          ORDER BY revenue DESC, bookings DESC, calls DESC, s.name`,
        [req.tenantId, req.tenantId, req.tenantId]
      ),
      // Career firsts / bests — the "نجاحات" record.
      pool.query(
        `SELECT
           (SELECT MIN(date) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL) AS first_sale_at,
           (SELECT MAX(amount_egp) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL) AS biggest_sale,
           (SELECT COUNT(*) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL) AS lifetime_bookings,
           (SELECT COALESCE(SUM(amount_egp),0) FROM payments
             WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL) AS lifetime_revenue,
           (SELECT COUNT(*) FROM communications
             WHERE tenant_id=? AND staff_id=? AND type='CALL') AS lifetime_calls,
           (SELECT COUNT(*) FROM leads
             WHERE tenant_id=? AND assigned_sales_id=? AND deleted_at IS NULL) AS lifetime_leads,
           (SELECT COUNT(*) FROM leads
             WHERE tenant_id=? AND assigned_sales_id=? AND deleted_at IS NULL
               AND status IN ('converted','won')) AS lifetime_converted`,
        [req.tenantId, id, req.tenantId, id, req.tenantId, id, req.tenantId, id,
          req.tenantId, id, req.tenantId, id, req.tenantId, id]
      ),
      pool.query(
        `SELECT
           SUM(status='todo') todo,
           SUM(status='in_progress') in_progress,
           SUM(status='done') done,
           SUM(status<>'done' AND status<>'cancelled' AND due_date IS NOT NULL AND due_date<CURDATE()) overdue
           FROM tasks WHERE tenant_id=? AND assigned_to=?`,
        [req.tenantId, id]
      ),
    ]);

    // Stitch the three per-month aggregates onto one dense timeline so the
    // chart has a point for every month employed, including empty ones.
    const byMonth = new Map();
    for (const key of monthSpan(since)) {
      byMonth.set(key, { ym: key, revenue: 0, bookings: 0, leads: 0, converted: 0, calls: 0, touches: 0 });
    }
    const ensure = (key) => {
      if (!byMonth.has(key)) byMonth.set(key, { ym: key, revenue: 0, bookings: 0, leads: 0, converted: 0, calls: 0, touches: 0 });
      return byMonth.get(key);
    };
    for (const row of monthlyMoney) {
      const slot = ensure(row.ym);
      slot.revenue = Number(row.revenue || 0);
      slot.bookings = Number(row.bookings || 0);
    }
    for (const row of monthlyLeads) {
      const slot = ensure(row.ym);
      slot.leads = Number(row.leads || 0);
      slot.converted = Number(row.converted || 0);
    }
    for (const row of monthlyCalls) {
      const slot = ensure(row.ym);
      slot.calls = Number(row.calls || 0);
      slot.touches = Number(row.total || 0);
    }
    const timeline = [...byMonth.values()].sort((a, b) => a.ym.localeCompare(b.ym));

    const rankIndex = rankRows.findIndex(row => String(row.id) === String(id));
    const best = timeline.reduce(
      (acc, row) => (row.revenue > acc.revenue ? row : acc),
      { ym: null, revenue: 0 }
    );
    const record = firsts[0] || {};

    res.json({
      staff: {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        joinedAt: staff.joined_at || staff.created_at,
        commissionRate: Number(staff.commission_rate || 0),
        monthlyTarget: Number(staff.monthly_target || 0),
        monthlyTargetType: staff.monthly_target_type || 'egp',
        monthlyBonus: Number(staff.monthly_bonus || 0),
      },
      today: {
        date: today,
        calls: Number(todayRow[0]?.calls_today || 0),
        touches: Number(todayRow[0]?.touches_today || 0),
        bookings: Number(todayRow[0]?.bookings_today || 0),
        revenue: Number(todayRow[0]?.revenue_today || 0),
        leads: Number(todayRow[0]?.leads_today || 0),
      },
      timeline,
      lifetime: {
        firstSaleAt: record.first_sale_at || null,
        biggestSale: Number(record.biggest_sale || 0),
        bookings: Number(record.lifetime_bookings || 0),
        revenue: Number(record.lifetime_revenue || 0),
        calls: Number(record.lifetime_calls || 0),
        leads: Number(record.lifetime_leads || 0),
        converted: Number(record.lifetime_converted || 0),
        bestMonth: best.ym ? { ym: best.ym, revenue: best.revenue } : null,
      },
      rank: {
        position: rankIndex >= 0 ? rankIndex + 1 : null,
        outOf: rankRows.length,
        board: rankRows.slice(0, 10).map((row, index) => ({
          position: index + 1,
          id: row.id,
          name: row.name,
          revenue: Number(row.revenue || 0),
          bookings: Number(row.bookings || 0),
          calls: Number(row.calls || 0),
        })),
      },
      tasks: {
        todo: Number(taskRow[0]?.todo || 0),
        inProgress: Number(taskRow[0]?.in_progress || 0),
        done: Number(taskRow[0]?.done || 0),
        overdue: Number(taskRow[0]?.overdue || 0),
      },
    });
  } catch (e) {
    logger.error('[hr/staff-profile]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Management ↔ employee thread ─────────────────────────────────────────────

router.get('/api/admin/hr/staff/:id/messages', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, staff_id, author_staff_id, author_name, direction, body, read_at, created_at
         FROM staff_messages
        WHERE tenant_id=? AND staff_id=?
        ORDER BY created_at ASC LIMIT 300`,
      [req.tenantId, req.params.id]
    );
    // Opening the thread as management marks the employee's messages read.
    pool.query(
      `UPDATE staff_messages SET read_at=NOW()
        WHERE tenant_id=? AND staff_id=? AND direction='from_staff' AND read_at IS NULL`,
      [req.tenantId, req.params.id]
    ).catch(() => {});
    res.json(rows);
  } catch (e) {
    logger.error('[hr/staff-messages/list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/staff/:id/messages', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    if (body.length > MAX_BODY) return res.status(400).json({ error: 'الرسالة طويلة جدًا' });
    const [[staff]] = await pool.query(
      'SELECT id, name FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!staff) return res.status(404).json({ error: 'Employee not found' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff_messages (id, tenant_id, staff_id, author_staff_id, author_name, direction, body)
       VALUES (?,?,?,?,?, 'to_staff', ?)`,
      [id, req.tenantId, staff.id, req.staffRecord?.id || null,
        req.staffRecord?.name || req.user?.email || 'الإدارة', body]
    );
    // Surface it in the employee's normal notification bell too, so a message
    // sent here doesn't depend on them opening their HR page to be noticed.
    await createNotification(
      'info', 'رسالة من الإدارة', body.slice(0, 180),
      { staffMessageId: id }, req.tenantId, staff.id
    );
    await writeAuditEvent({
      action: 'hr.staff.message_sent', entityType: 'staff', entityId: staff.id,
      metadata: { messageId: id }, req,
    });
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[hr/staff-messages/send]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Employee side: read + reply on their own thread ──────────────────────────
// Deliberately keyed off the caller's own resolved staff row rather than an id
// in the URL, so an employee can only ever read or post to their own thread.

router.get('/api/staff/me/messages', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const [rows] = await pool.query(
      `SELECT id, author_name, direction, body, read_at, created_at
         FROM staff_messages
        WHERE tenant_id=? AND staff_id=?
        ORDER BY created_at ASC LIMIT 300`,
      [req.tenantId, me.id]
    );
    pool.query(
      `UPDATE staff_messages SET read_at=NOW()
        WHERE tenant_id=? AND staff_id=? AND direction='to_staff' AND read_at IS NULL`,
      [req.tenantId, me.id]
    ).catch(() => {});
    res.json(rows);
  } catch (e) {
    logger.error('[staff/me/messages/list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/staff/me/messages', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    if (body.length > MAX_BODY) return res.status(400).json({ error: 'الرسالة طويلة جدًا' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff_messages (id, tenant_id, staff_id, author_staff_id, author_name, direction, body)
       VALUES (?,?,?,?,?, 'from_staff', ?)`,
      [id, req.tenantId, me.id, me.id, me.name || '', body]
    );
    // Reaches HR/managers through the shared (recipient-less) notification feed.
    await createNotification(
      'hr', 'رسالة من موظف', `${me.name || ''}: ${body.slice(0, 160)}`,
      { staffMessageId: id, staffId: me.id }, req.tenantId
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[staff/me/messages/send]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
