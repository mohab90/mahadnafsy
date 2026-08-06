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

/**
 * The report windows the owner asked for. Each returns a half-open [from, to)
 * range so every query stays sargable against the date indexes.
 */
const PERIODS = {
  today:   { label: 'اليوم',        days: 0 },
  yesterday: { label: 'أمس',       days: 1, shift: 1 },
  week:    { label: 'آخر 7 أيام',   days: 7 },
  days15:  { label: 'آخر 15 يوم',   days: 15 },
  month:   { label: 'آخر 30 يوم',   days: 30 },
  months3: { label: 'آخر 3 شهور',   days: 90 },
};

function periodRange(key) {
  const spec = PERIODS[key] || PERIODS.month;
  const dayMs = 86400000;
  const startOfToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
  if (key === 'yesterday') {
    return {
      from: new Date(startOfToday - dayMs).toISOString().slice(0, 10),
      to: new Date(startOfToday).toISOString().slice(0, 10),
      label: spec.label,
    };
  }
  if (key === 'today') {
    return {
      from: new Date(startOfToday).toISOString().slice(0, 10),
      to: new Date(startOfToday + dayMs).toISOString().slice(0, 10),
      label: spec.label,
    };
  }
  return {
    from: new Date(startOfToday - (spec.days - 1) * dayMs).toISOString().slice(0, 10),
    to: new Date(startOfToday + dayMs).toISOString().slice(0, 10),
    label: spec.label,
  };
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

/**
 * GET /api/admin/hr/staff/:id/report?period=today|yesterday|week|days15|month|months3
 * A period-scoped scorecard. Separate from /profile so switching the period
 * re-fetches only the numbers that change, not the whole tenure series.
 */
async function buildStaffReport(tenantId, id, key) {
  const { from, to, label } = periodRange(key);

  const [[money], [leadRow], [commRow], [taskRow], [payRows], [callRows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) bookings, COALESCE(SUM(amount_egp),0) revenue,
              COALESCE(MAX(amount_egp),0) biggest
         FROM payments
        WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL
          AND date>=? AND date<?`,
      [tenantId, id, from, to]
    ),
    pool.query(
      `SELECT COUNT(*) leads, SUM(status IN ('converted','won')) converted,
              SUM(status='lost') lost, SUM(status='new') untouched
         FROM leads
        WHERE tenant_id=? AND assigned_sales_id=? AND deleted_at IS NULL
          AND created_at>=? AND created_at<?`,
      [tenantId, id, from, to]
    ),
    pool.query(
      `SELECT COUNT(*) touches, SUM(type='CALL') calls, SUM(type='WHATSAPP') whatsapp,
              SUM(type='MEETING') meetings
         FROM communications
        WHERE tenant_id=? AND staff_id=? AND date>=? AND date<?`,
      [tenantId, id, from, to]
    ),
    pool.query(
      `SELECT SUM(status='done') done,
              SUM(status<>'done' AND status<>'cancelled') open
         FROM tasks
        WHERE tenant_id=? AND assigned_to=? AND created_at>=? AND created_at<?`,
      [tenantId, id, from, to]
    ),
    // Raw rows for the day-by-day breakdown, folded into days in JS below.
    // Kept as two flat sargable reads (both hit idx_pay_staff_date /
    // idx_comm_tenant_staff_date) rather than grouping by a date-truncating
    // function on the indexed column, which would defeat those indexes. For
    // one employee over at most 90 days the row count is trivial to fold.
    pool.query(
      `SELECT date, amount_egp FROM payments
        WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL
          AND date>=? AND date<?`,
      [tenantId, id, from, to]
    ),
    pool.query(
      `SELECT date FROM communications
        WHERE tenant_id=? AND staff_id=? AND type='CALL' AND date>=? AND date<?`,
      [tenantId, id, from, to]
    ),
  ]);

  // Dense day series across the window so the chart has no holes.
  const days = new Map();
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime();
    t < new Date(`${to}T00:00:00.000Z`).getTime(); t += 86400000) {
    days.set(new Date(t).toISOString().slice(0, 10), { day: new Date(t).toISOString().slice(0, 10), bookings: 0, revenue: 0, calls: 0 });
  }
  const bump = (raw, apply) => {
    const dayKey = toIsoDate(raw);
    if (!dayKey) return;
    if (!days.has(dayKey)) days.set(dayKey, { day: dayKey, bookings: 0, revenue: 0, calls: 0 });
    apply(days.get(dayKey));
  };
  for (const row of payRows) {
    bump(row.date, slot => { slot.bookings += 1; slot.revenue += Number(row.amount_egp || 0); });
  }
  for (const row of callRows) bump(row.date, slot => { slot.calls += 1; });

  const leads = Number(leadRow[0]?.leads || 0);
  const converted = Number(leadRow[0]?.converted || 0);
  return {
    period: { key, label, from, to },
    revenue: Number(money[0]?.revenue || 0),
    bookings: Number(money[0]?.bookings || 0),
    biggestSale: Number(money[0]?.biggest || 0),
    leads,
    converted,
    lost: Number(leadRow[0]?.lost || 0),
    untouched: Number(leadRow[0]?.untouched || 0),
    conversionRate: leads > 0 ? Math.round((converted / leads) * 100) : 0,
    touches: Number(commRow[0]?.touches || 0),
    calls: Number(commRow[0]?.calls || 0),
    whatsapp: Number(commRow[0]?.whatsapp || 0),
    meetings: Number(commRow[0]?.meetings || 0),
    tasksDone: Number(taskRow[0]?.done || 0),
    tasksOpen: Number(taskRow[0]?.open || 0),
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

router.get('/api/admin/hr/staff/:id/report', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const key = String(req.query.period || 'month');
    if (!PERIODS[key]) return res.status(400).json({ error: 'period غير مدعوم' });
    res.json(await buildStaffReport(req.tenantId, req.params.id, key));
  } catch (e) {
    logger.error('[hr/staff-report]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Management ↔ employee thread ─────────────────────────────────────────────

router.get('/api/admin/hr/staff/:id/messages', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, staff_id, author_staff_id, author_name, direction,
              broadcast_id, broadcast_label, body, read_at, created_at
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

// ── Broadcasts: management → a whole team, a role, a branch, or a set ────────

const ROLE_LABEL_AR = {
  SALES: 'المبيعات', COLLECTION: 'التحصيل', SUPPORT: 'خدمة العملاء',
  ACCOUNTANT: 'الحسابات', HR: 'الموارد البشرية', MANAGER: 'المديرين',
  ADMIN: 'الإدارة', INSTRUCTOR: 'المحاضرين', TRAINER: 'المدربين',
  CONSULTANT: 'الاستشاريين', EXPERT: 'الخبراء', RECEPTION_DAQQI: 'ريسبشن الدقي',
  DAQQI_MANAGER: 'مديري الدقي', ONLINE_MANAGER: 'مديري الأونلاين',
  SALES_COLLECTION_MANAGER: 'مديري المبيعات والتحصيل', OTHER: 'أخرى',
};

/**
 * Resolve a broadcast target into recipients + a human label. Every branch is
 * tenant-scoped and active-only, so a broadcast can never reach another
 * tenant's staff or a deactivated/deleted account.
 */
async function resolveAudience(req, body) {
  const target = String(body?.target || '').trim();
  if (target === 'all') {
    const [rows] = await pool.query(
      'SELECT id, name FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL',
      [req.tenantId]
    );
    return { rows, label: 'كل الفريق' };
  }
  if (target === 'role') {
    const role = String(body?.role || '').trim().toUpperCase();
    if (!role) return { error: 'الدور مطلوب' };
    const [rows] = await pool.query(
      'SELECT id, name FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND UPPER(role)=?',
      [req.tenantId, role]
    );
    return { rows, label: `فريق ${ROLE_LABEL_AR[role] || role}` };
  }
  if (target === 'branch') {
    const branchValue = String(body?.branchId || '').trim();
    if (!branchValue) return { error: 'الفرع مطلوب' };
    const [[branch]] = await pool.query(
      `SELECT id, label FROM branches
        WHERE tenant_id=? AND is_active=1 AND (id=? OR branch_key=? OR slug=?) LIMIT 1`,
      [req.tenantId, branchValue, branchValue, branchValue]
    );
    if (!branch) return { error: 'الفرع غير موجود' };
    const [rows] = await pool.query(
      'SELECT id, name FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND branch_id=?',
      [req.tenantId, branch.id]
    );
    return { rows, label: `فرع ${branch.label}` };
  }
  if (target === 'staff') {
    const ids = Array.isArray(body?.staffIds) ? body.staffIds.filter(Boolean).slice(0, 200) : [];
    if (ids.length === 0) return { error: 'اختر موظفًا واحدًا على الأقل' };
    const [rows] = await pool.query(
      `SELECT id, name FROM staff
        WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL
          AND id IN (${ids.map(() => '?').join(',')})`,
      [req.tenantId, ...ids]
    );
    return { rows, label: rows.length === 1 ? `${rows[0].name}` : `${rows.length} موظفين محددين` };
  }
  return { error: 'نوع الإرسال غير مدعوم' };
}

/** Fan a body out to an audience as one thread row + one notification each. */
async function fanOut({ req, audience, label, body, direction, authorId, authorName, notifTitle }) {
  const broadcastId = uuidv4();
  const rows = audience.map(person => [
    uuidv4(), req.tenantId, person.id, authorId || null, authorName,
    direction, broadcastId, label, body,
  ]);
  await pool.query(
    `INSERT INTO staff_messages
       (id, tenant_id, staff_id, author_staff_id, author_name, direction, broadcast_id, broadcast_label, body)
     VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`,
    rows.flat()
  );
  // Notifications are best-effort and must not fail the send.
  await Promise.all(audience.map(person => createNotification(
    'info', notifTitle, body.slice(0, 180),
    { broadcastId, broadcastLabel: label }, req.tenantId, person.id
  ).catch(() => {})));
  return broadcastId;
}

router.post('/api/admin/hr/staff/broadcast', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    if (body.length > MAX_BODY) return res.status(400).json({ error: 'الرسالة طويلة جدًا' });
    const audience = await resolveAudience(req, req.body);
    if (audience.error) return res.status(400).json({ error: audience.error });
    if (!audience.rows.length) return res.status(400).json({ error: 'لا يوجد موظفون مطابقون لهذا الاختيار' });

    const broadcastId = await fanOut({
      req, audience: audience.rows, label: audience.label, body,
      direction: 'to_staff',
      authorId: req.staffRecord?.id || null,
      authorName: req.staffRecord?.name || req.user?.email || 'الإدارة',
      notifTitle: 'رسالة من الإدارة',
    });
    await writeAuditEvent({
      action: 'hr.staff.broadcast_sent', entityType: 'staff_broadcast', entityId: broadcastId,
      metadata: { label: audience.label, recipients: audience.rows.length }, req,
    });
    res.json({ ok: true, broadcastId, label: audience.label, recipients: audience.rows.length });
  } catch (e) {
    logger.error('[hr/staff-broadcast]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Audience options for the composer — roles/branches that actually have staff. */
router.get('/api/admin/hr/staff/broadcast-audiences', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [[roles], [branches], [[total]]] = await Promise.all([
      pool.query(
        `SELECT UPPER(role) role, COUNT(*) count FROM staff
          WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL
          GROUP BY UPPER(role) ORDER BY count DESC`,
        [req.tenantId]
      ),
      pool.query(
        `SELECT b.id, b.label, COUNT(s.id) count
           FROM branches b
           LEFT JOIN staff s ON s.branch_id=b.id AND s.tenant_id=b.tenant_id
                            AND s.is_active=1 AND s.deleted_at IS NULL
          WHERE b.tenant_id=? AND b.is_active=1
          GROUP BY b.id, b.label HAVING count>0 ORDER BY count DESC`,
        [req.tenantId]
      ),
      pool.query(
        'SELECT COUNT(*) total FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL',
        [req.tenantId]
      ),
    ]);
    res.json({
      total: Number(total?.total || 0),
      // A staff row with a blank role still has to be reachable, so it is kept
      // and given a readable label rather than rendering as an empty option.
      roles: roles.map(r => ({
        role: r.role,
        label: ROLE_LABEL_AR[r.role] || r.role || 'بدون دور محدد',
        count: Number(r.count),
      })),
      branches: branches.map(b => ({ id: b.id, label: b.label, count: Number(b.count) })),
    });
  } catch (e) {
    logger.error('[hr/broadcast-audiences]', e.message);
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
      `SELECT id, author_name, direction, broadcast_id, broadcast_label,
              body, read_at, created_at
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
    // 'team' = broadcast to everyone sharing my role; anything else replies to
    // management on my own thread (the default, and the original behaviour).
    const scope = String(req.body?.scope || 'management');

    if (scope === 'team') {
      const [[myRole]] = await pool.query(
        'SELECT UPPER(role) role FROM staff WHERE id=? AND tenant_id=? LIMIT 1',
        [me.id, req.tenantId]
      );
      const role = myRole?.role || '';
      const [teammates] = await pool.query(
        `SELECT id, name FROM staff
          WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND UPPER(role)=? AND id<>?`,
        [req.tenantId, role, me.id]
      );
      const label = `فريق ${ROLE_LABEL_AR[role] || role}`;
      // The sender's own copy is 'from_staff' (they authored it, and it shows on
      // their thread as outgoing); teammates get 'peer_broadcast' so their view
      // attributes it to a colleague rather than to management.
      const broadcastId = teammates.length
        ? await fanOut({
          req, audience: teammates, label, body,
          direction: 'peer_broadcast', authorId: me.id, authorName: me.name || '',
          notifTitle: `رسالة جماعية من ${me.name || 'زميل'}`,
        })
        : uuidv4();
      await pool.query(
        `INSERT INTO staff_messages
           (id, tenant_id, staff_id, author_staff_id, author_name, direction, broadcast_id, broadcast_label, body)
         VALUES (?,?,?,?,?, 'from_staff', ?,?,?)`,
        [uuidv4(), req.tenantId, me.id, me.id, me.name || '', broadcastId, label, body]
      );
      // Management still gets visibility on team chatter.
      await createNotification(
        'hr', 'رسالة جماعية من موظف', `${me.name || ''} → ${label}: ${body.slice(0, 140)}`,
        { broadcastId, staffId: me.id }, req.tenantId
      ).catch(() => {});
      return res.json({ ok: true, broadcastId, label, recipients: teammates.length });
    }

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

// ── Bell-style inbox: unread counts + a flat recent feed ─────────────────────
// The thread endpoints above are per-employee. These two back the messages icon
// in the header, which has to answer "is there anything new" without loading a
// thread first.

router.get('/api/staff/me/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.json({ unread: 0 });
    const [[row]] = await pool.query(
      `SELECT COUNT(*) n FROM staff_messages
        WHERE tenant_id=? AND staff_id=? AND direction<>'from_staff' AND read_at IS NULL`,
      [req.tenantId, me.id]
    );
    res.json({ unread: Number(row?.n || 0) });
  } catch (e) {
    logger.error('[staff/me/messages/unread]', e.message);
    res.json({ unread: 0 });
  }
});

router.get('/api/admin/hr/staff-messages/inbox', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.staff_id, m.author_name, m.body, m.read_at, m.created_at,
              s.name staff_name, s.role
         FROM staff_messages m
         LEFT JOIN staff s ON s.id = m.staff_id AND s.tenant_id = m.tenant_id
        WHERE m.tenant_id=? AND m.direction='from_staff'
        ORDER BY m.created_at DESC LIMIT 60`,
      [req.tenantId]
    );
    const [[unread]] = await pool.query(
      `SELECT COUNT(*) n FROM staff_messages
        WHERE tenant_id=? AND direction='from_staff' AND read_at IS NULL`,
      [req.tenantId]
    );
    res.json({ unread: Number(unread?.n || 0), messages: rows });
  } catch (e) {
    logger.error('[hr/staff-messages/inbox]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/staff-messages/mark-read', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE staff_messages SET read_at=NOW()
        WHERE tenant_id=? AND direction='from_staff' AND read_at IS NULL`,
      [req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[hr/staff-messages/mark-read]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Employee side: their own scorecard, targets and resignation ──────────────
// Same rule as the thread above: the staff row is resolved from the caller, so
// there is no id to tamper with and no permission to grant. An employee seeing
// their own numbers needs no HR permission — requiring `view_hr` here would
// have meant granting reps read access to the whole HR module.

router.get('/api/staff/me/report', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const key = String(req.query.period || 'month');
    if (!PERIODS[key]) return res.status(400).json({ error: 'period غير مدعوم' });
    res.json(await buildStaffReport(req.tenantId, me.id, key));
  } catch (e) {
    logger.error('[staff/me/report]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * The last 12 months of target vs. actual. The employee asked "what was my
 * target last month and did I hit it" — a single current-month number cannot
 * answer that, so the series is returned whole and the UI picks the window.
 */
router.get('/api/staff/me/targets', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const oldest = `${months[months.length - 1]}-01`;
    const [[targets], [actuals]] = await Promise.all([
      pool.query(
        `SELECT period, revenue_target revenueTarget, leads_target leadsTarget
           FROM sales_targets WHERE tenant_id=? AND staff_id=? AND period>=?`,
        [req.tenantId, me.id, months[months.length - 1]]
      ),
      // Half-open range on the indexed date column — no DATE_FORMAT in the
      // WHERE clause, so idx_pay_staff_date still applies. Bucketing by month
      // happens on the (small) result set.
      pool.query(
        `SELECT date, amount_egp FROM payments
          WHERE tenant_id=? AND staff_id=? AND status='paid' AND deleted_at IS NULL
            AND date>=?`,
        [req.tenantId, me.id, oldest]
      ),
    ]);
    const targetBy = new Map(targets.map(t => [t.period, t]));
    const actualBy = new Map();
    for (const row of actuals) {
      const iso = toIsoDate(row.date);
      if (!iso) continue;
      const period = iso.slice(0, 7);
      actualBy.set(period, (actualBy.get(period) || 0) + Number(row.amount_egp || 0));
    }
    res.json(months.map(period => {
      const target = Number(targetBy.get(period)?.revenueTarget || 0);
      const actual = actualBy.get(period) || 0;
      return {
        period,
        revenueTarget: target,
        leadsTarget: Number(targetBy.get(period)?.leadsTarget || 0),
        actualRevenue: actual,
        achievedPct: target > 0 ? Math.round((actual / target) * 100) : null,
      };
    }));
  } catch (e) {
    logger.error('[staff/me/targets]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * The employee's HR file as an HR officer would look at it: the pay trajectory
 * (is it going up, and by how much), the documents on file, and — the part a
 * self-service portal usually omits — what is *missing*, so the employee can
 * chase it instead of discovering the gap when payroll or a contract renewal
 * hits.
 */
router.get('/api/staff/me/hr-file', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });

    const [[profileRows], [payrollRows], [docRows], [structureRows]] = await Promise.all([
      pool.query(
        `SELECT s.id, s.name, s.email, s.phone, s.role, s.image, s.employment_type,
                s.joined_at, s.hire_date, s.commission_rate, s.branch_id,
                d.name department_name
           FROM staff s
           LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
          WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL LIMIT 1`,
        [req.tenantId, me.id]
      ),
      pool.query(
        `SELECT pr.year, pr.month, pi.net_salary, pi.base_salary, pi.total_allowances,
                pi.commission, pi.bonus,
                (COALESCE(pi.late_deductions,0)+COALESCE(pi.absence_deductions,0)
                 +COALESCE(pi.advance_deductions,0)) deductions
           FROM payroll_items pi
           JOIN payroll_runs pr ON pr.id=pi.payroll_run_id AND pr.tenant_id=pi.tenant_id
          WHERE pi.tenant_id=? AND pi.staff_id=? AND pr.status IN ('APPROVED','PAID')
          ORDER BY pr.year DESC, pr.month DESC LIMIT 18`,
        [req.tenantId, me.id]
      ),
      pool.query(
        `SELECT id, title, category, file_name, expiry_date, created_at
           FROM employee_documents
          WHERE staff_id=? AND tenant_id=? AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 50`,
        [me.id, req.tenantId]
      ),
      pool.query(
        `SELECT base_salary, housing_allowance, transport_allowance, effective_from, status
           FROM salary_structures
          WHERE tenant_id=? AND staff_id=? ORDER BY effective_from DESC LIMIT 10`,
        [req.tenantId, me.id]
      ),
    ]);

    const profile = profileRows[0] || null;
    // Oldest-first so a chart reads left→right in time order.
    const payroll = payrollRows.slice().reverse().map(r => ({
      period: `${r.year}-${String(r.month).padStart(2, '0')}`,
      net: Number(r.net_salary || 0),
      base: Number(r.base_salary || 0),
      allowances: Number(r.total_allowances || 0),
      commission: Number(r.commission || 0),
      bonus: Number(r.bonus || 0),
      deductions: Number(r.deductions || 0),
    }));

    // Trend over the payslips we actually have — first vs last, not a guess.
    let trend = null;
    if (payroll.length >= 2) {
      const first = payroll[0].net;
      const last = payroll[payroll.length - 1].net;
      trend = {
        direction: last > first ? 'up' : last < first ? 'down' : 'flat',
        changePct: first > 0 ? Math.round(((last - first) / first) * 100) : null,
        from: payroll[0].period, to: payroll[payroll.length - 1].period,
        fromNet: first, toNet: last,
      };
    }

    const REQUIRED_DOCS = [
      { category: 'contract', label: 'عقد العمل' },
      { category: 'id', label: 'صورة البطاقة' },
      { category: 'certificate', label: 'المؤهل الدراسي' },
    ];
    const have = new Set(docRows.map(d => d.category));
    const today = new Date().toISOString().slice(0, 10);

    const gaps = [];
    for (const doc of REQUIRED_DOCS) {
      if (!have.has(doc.category)) gaps.push({ kind: 'document', label: doc.label, severity: 'high' });
    }
    for (const doc of docRows) {
      const exp = toIsoDate(doc.expiry_date);
      if (exp && exp < today) gaps.push({ kind: 'expired', label: `${doc.title} — منتهي في ${exp}`, severity: 'high' });
    }
    if (!profile?.phone) gaps.push({ kind: 'field', label: 'رقم الهاتف', severity: 'medium' });
    if (!profile?.email) gaps.push({ kind: 'field', label: 'البريد الإلكتروني', severity: 'medium' });
    if (!profile?.image) gaps.push({ kind: 'field', label: 'الصورة الشخصية', severity: 'low' });
    if (!profile?.department_name) gaps.push({ kind: 'field', label: 'القسم', severity: 'low' });
    if (!profile?.joined_at && !profile?.hire_date) gaps.push({ kind: 'field', label: 'تاريخ التعيين', severity: 'medium' });
    if (!structureRows.some(s => s.status === 'APPROVED')) {
      gaps.push({ kind: 'salary', label: 'هيكل راتب معتمد', severity: 'high' });
    }

    // Completeness over a fixed denominator so the number means the same thing
    // for everyone: 3 required documents + 5 profile fields + a salary structure.
    const CHECKS = REQUIRED_DOCS.length + 5 + 1;
    const completeness = Math.max(0, Math.round(((CHECKS - gaps.length) / CHECKS) * 100));

    res.json({
      profile,
      payroll,
      trend,
      documents: docRows.map(d => ({ ...d, expiry_date: toIsoDate(d.expiry_date) })),
      salaryStructures: structureRows.map(s => ({ ...s, effective_from: toIsoDate(s.effective_from) })),
      gaps,
      completeness,
    });
  } catch (e) {
    logger.error('[staff/me/hr-file]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/staff/me/resignation', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const [rows] = await pool.query(
      `SELECT id, last_working_day, reason_note, status, hr_note, created_at, decided_at
         FROM staff_resignations
        WHERE tenant_id=? AND staff_id=? ORDER BY created_at DESC LIMIT 20`,
      [req.tenantId, me.id]
    );
    res.json(rows);
  } catch (e) {
    logger.error('[staff/me/resignation/list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * A resignation *request*, not an offboarding. staff_offboarding deliberately
 * refuses to let an employee start their own exit process — that stays HR's
 * call. This is the notice that reaches HR so they can start it.
 */
router.post('/api/staff/me/resignation', requireAuth, async (req, res) => {
  try {
    const me = await _resolveStaffByUser(req);
    if (!me) return res.status(404).json({ error: 'Staff record not found' });
    const note = String(req.body?.reasonNote || '').trim();
    const lastDay = String(req.body?.lastWorkingDay || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return res.status(400).json({ error: 'آخر يوم عمل مطلوب' });
    if (note.length > MAX_BODY) return res.status(400).json({ error: 'النص طويل جدًا' });
    const [[pending]] = await pool.query(
      `SELECT id FROM staff_resignations
        WHERE tenant_id=? AND staff_id=? AND status='pending' LIMIT 1`,
      [req.tenantId, me.id]
    );
    if (pending) return res.status(409).json({ error: 'لديك طلب استقالة قيد المراجعة بالفعل' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff_resignations
         (id, tenant_id, staff_id, staff_name, last_working_day, reason_note)
       VALUES (?,?,?,?,?,?)`,
      [id, req.tenantId, me.id, me.name || '', lastDay, note || null]
    );
    await createNotification(
      'hr', 'طلب استقالة', `${me.name || ''} — آخر يوم عمل ${lastDay}`,
      { resignationId: id, staffId: me.id }, req.tenantId
    ).catch(() => {});
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[staff/me/resignation/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── HR side: see and decide on resignation requests ──────────────────────────

router.get('/api/admin/hr/resignations', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.staff_id, r.staff_name, r.last_working_day, r.reason_note,
              r.status, r.hr_note, r.created_at, r.decided_at, s.role
         FROM staff_resignations r
         LEFT JOIN staff s ON s.id = r.staff_id AND s.tenant_id = r.tenant_id
        WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 200`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (e) {
    logger.error('[hr/resignations/list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/hr/resignations/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!['accepted', 'declined', 'withdrawn'].includes(status)) {
      return res.status(400).json({ error: 'status غير مدعوم' });
    }
    const [result] = await pool.query(
      `UPDATE staff_resignations SET status=?, hr_note=?, decided_by=?, decided_at=NOW()
        WHERE id=? AND tenant_id=? AND status='pending'`,
      [status, String(req.body?.hrNote || '').slice(0, MAX_BODY) || null,
        req.staffRecord?.id || null, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'الطلب غير موجود أو تم البت فيه' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[hr/resignations/decide]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
