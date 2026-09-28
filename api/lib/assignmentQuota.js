'use strict';

/**
 * How many new leads a rep may receive in a period.
 *
 * crm_assignment_members already carried max_open_leads — how many live leads a
 * person is holding. That does not limit intake: a rep who closes quickly never
 * reaches it and can be handed an unlimited stream. This is the other half, a
 * cap on what arrives rather than on what is held.
 *
 * Windows are calendar-aligned rather than rolling, because a rep asking "how
 * many more do I get today" wants an answer that resets at a moment they can
 * name. The fortnight is the 1st–15th and the 16th–end of the month, which
 * keeps it aligned to the month rather than drifting.
 *
 * Counted in Africa/Cairo, so "today" means the day the desk is having.
 */

const { cairoDayStartUtc, zonedDateTimeParts } = require('./dates');

const PERIODS = new Set(['day', 'week', 'fortnight', 'month']);
const TIME_ZONE = 'Africa/Cairo';

/**
 * The inclusive start of the current window: Cairo's midnight on the window's
 * first day, as the UTC instant 'YYYY-MM-DD HH:MM:SS' that leads.assigned_at is
 * compared with — that column is written with NOW(), in UTC.
 *
 * This returned Cairo's midnight as a bare string, and against a UTC column that
 * string means UTC midnight, 02:00 or 03:00 in Cairo. From Cairo's midnight
 * until then the window began in the future and every rep counted zero, so the
 * cap did nothing at all: on 27 September the sheet sync handed Rodina seven
 * leads between 00:06 and 02:36 against a limit of five. And whatever arrived in
 * those hours never counted towards the rest of the day.
 *
 * @param {'day'|'week'|'fortnight'|'month'} period
 * @param {Date} [now]
 */
function periodStart(period, now = new Date()) {
  const { year, month, day } = zonedDateTimeParts(now, TIME_ZONE);
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const at = (y, m, d) => cairoDayStartUtc(`${pad(y, 4)}-${pad(m)}-${pad(d)}`);

  if (period === 'month') return at(year, month, 1);
  if (period === 'fortnight') return at(year, month, day <= 15 ? 1 : 16);
  if (period === 'week') {
    // From Saturday, the first day of the working week here.
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7));
    return at(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return at(year, month, day);
}

/** A label for the window, for the UI to show next to the count. */
function periodLabel(period) {
  if (period === 'month') return 'هذا الشهر';
  if (period === 'fortnight') return 'هذه الفترة (نصف شهر)';
  if (period === 'week') return 'هذا الأسبوع';
  return 'اليوم';
}

/**
 * How many leads each rep has been given inside their own window.
 *
 * Each rep can be on a different period, so this groups the work by period and
 * runs one query per distinct window rather than one per rep.
 *
 * @param {string} tenantId
 * @param {Array<{staff_id: string, intake_period: string}>} members
 * @param {import('mysql2/promise').Pool} db
 * @param {Date} [now]
 * @returns {Promise<Map<string, number>>} staff id → leads received this window
 */
async function intakeByStaff(tenantId, members, db, now = new Date()) {
  const counts = new Map();
  const byPeriod = new Map();
  for (const member of members || []) {
    const staffId = String(member.staff_id || member.id || '');
    if (!staffId) continue;
    const period = PERIODS.has(member.intake_period) ? member.intake_period : 'day';
    if (!byPeriod.has(period)) byPeriod.set(period, []);
    byPeriod.get(period).push(staffId);
  }

  for (const [period, staffIds] of byPeriod) {
    const since = periodStart(period, now);
    const [rows] = await db.query(
      `SELECT assigned_sales_id AS staff_id, COUNT(*) AS taken
         FROM leads
        WHERE tenant_id=? AND assigned_at IS NOT NULL AND assigned_at >= ?
          AND assigned_sales_id IN (${staffIds.map(() => '?').join(',')})
        GROUP BY assigned_sales_id`,
      [tenantId, since, ...staffIds]
    );
    for (const row of rows) counts.set(String(row.staff_id), Number(row.taken) || 0);
  }
  return counts;
}

/**
 * Whether this rep has room for one more.
 * No limit set means no rate cap, which is the state every rep starts in.
 */
function hasRoom(member, taken) {
  const limit = Number(member?.intake_limit);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  return (Number(taken) || 0) < limit;
}

module.exports = { PERIODS, TIME_ZONE, periodStart, periodLabel, intakeByStaff, hasRoom };
