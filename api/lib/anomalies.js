'use strict';

/**
 * Flags for what is out of the ordinary (7 Nov 2026), each judged against its own four-week baseline and worded in Arabic with the screen where it is acted on.
 * No outside service: a few queries and arithmetic.
 *
 *  - a collections drop:      yesterday's course money against the same weekday of the four weeks before it (halved or worse);
 *  - a lead surge:            one source's leads yesterday against that source on the same weekday of the four weeks before (twice or more, and a real number);
 *  - an employee idle:        in working hours, in the system for the last quarter hour with no real action for an hour, when over the last four weeks they act every working day;
 *  - an endpoint slower:      the newer half of its recent requests against its own older half (latency is not kept longer than that, so the baseline is since the server started).
 *
 * The judging is plain functions of numbers (exported, tested by hand figures); the queries only gather the numbers.
 */

const { pool, cached } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const perfMonitor = require('./performanceMonitor');
const { listPresence, statusOf } = require('./staffPresence');

const num = value => Number(value) || 0;
const mean = values => (values.length ? values.reduce((sum, v) => sum + num(v), 0) / values.length : 0);
const WEEKS = 4;
const COURSE_MONEY = "(p.payment_type IS NULL OR UPPER(p.payment_type) <> 'CERTIFICATE')";
// Egypt's working hours for the idle rule (Cairo clock), and the day off.
const WORK_FROM = 9;
const WORK_TO = 18;
const DAY_OFF = 5; // Friday

/** Money that halved or worse against a baseline worth speaking of. */
function judgeDrop(value, history, { ratio = 0.5, minBaseline = 1000 } = {}) {
  const baseline = mean(history);
  return baseline >= minBaseline && value <= baseline * ratio ? { value, baseline: Math.round(baseline) } : null;
}
/** A count that doubled (or more) against its baseline and is at least `minCount` leads. */
function judgeSurge(value, history, { ratio = 2, minCount = 20 } = {}) {
  const baseline = mean(history);
  return value >= minCount && value >= baseline * ratio ? { value, baseline: Math.round(baseline * 10) / 10 } : null;
}
/** Idle: normally acts every working day (at least `minPerDay` actions a day), was seen in the last quarter hour, yet has not acted for `gapMinutes`. */
function judgeIdle({ perDay, lastSeenAgoMs, lastActionAgoMs }, { minPerDay = 10, gapMinutes = 60 } = {}) {
  if (perDay < minPerDay || lastSeenAgoMs === null || lastSeenAgoMs >= 15 * 60 * 1000) return null;
  return lastActionAgoMs === null || lastActionAgoMs >= gapMinutes * 60 * 1000 ? { perDay: Math.round(perDay), idleMinutes: lastActionAgoMs === null ? null : Math.round(lastActionAgoMs / 60000) } : null;
}
/** Working hours in Cairo: Saturday to Thursday, 09:00 to 18:00. */
function inWorkingHours(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now));
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const weekday = parts.find(p => p.type === 'weekday').value;
  return weekday !== ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][DAY_OFF] && hour >= WORK_FROM && hour < WORK_TO;
}

const sameWeekdays = day => Array.from({ length: WEEKS }, (_, i) => addDaysToDateOnly(day, -7 * (i + 1)));
const rangeParams = days => days.flatMap(day => [cairoDayStartUtc(day), cairoDayStartUtc(addDaysToDateOnly(day, 1))]);
const rangeSql = (column, count) => Array.from({ length: count }, () => `(${column} >= ? AND ${column} < ?)`).join(' OR ');
const caseIndex = (column, count) => `CASE ${Array.from({ length: count }, (_, i) => `WHEN ${column} >= ? AND ${column} < ? THEN ${i}`).join(' ')} END`;
const fmt = value => Math.round(value).toLocaleString('en-US');

async function collectionsDrop(tenantId, yesterday) {
  const days = [yesterday, ...sameWeekdays(yesterday)];
  const [rows] = await pool.query(
    `SELECT ${caseIndex('p.date', days.length)} AS d, COALESCE(SUM(p.amount_egp), 0) AS money FROM payments p
      WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND (${rangeSql('p.date', days.length)}) GROUP BY d`,
    [...rangeParams(days), tenantId, ...rangeParams(days)]);
  const by = new Map(rows.map(row => [num(row.d), num(row.money)]));
  const judged = judgeDrop(by.get(0) || 0, days.slice(1).map((_, i) => by.get(i + 1) || 0));
  return judged ? [{ key: 'collections-drop', tone: 'rose', to: '/dashboard/financial',
    text: `التحصيل إمبارح ${fmt(judged.value)} ج — أقل من نص المعتاد لنفس اليوم في آخر ${WEEKS} أسابيع (${fmt(judged.baseline)} ج)` }] : [];
}

async function leadSurges(tenantId, yesterday) {
  const days = [yesterday, ...sameWeekdays(yesterday)];
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(l.source), ''), 'بدون مصدر') AS source, ${caseIndex('l.created_at', days.length)} AS d, COUNT(*) AS n FROM leads l
      WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND (${rangeSql('l.created_at', days.length)}) GROUP BY 1, 2`,
    [...rangeParams(days), tenantId, ...rangeParams(days)]);
  const sources = new Map();
  for (const row of rows) {
    const entry = sources.get(row.source) || Array(days.length).fill(0);
    entry[num(row.d)] = num(row.n);
    sources.set(row.source, entry);
  }
  return [...sources.entries()].flatMap(([source, counts]) => {
    const judged = judgeSurge(counts[0], counts.slice(1));
    return judged ? [{ key: `lead-surge:${source}`, tone: 'amber', to: '/dashboard/leads',
      text: `مصدر «${source}» جاب ${fmt(judged.value)} ليد إمبارح — المعتاد ${fmt(judged.baseline)} لنفس اليوم` }] : [];
  });
}

async function idleStaff(tenantId, now) {
  if (!inWorkingHours(now)) return [];
  const since = new Date(now - 28 * 24 * 3600 * 1000);
  const [[baseline], presence] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, COUNT(*) AS actions, COUNT(DISTINCT DATE(a.at)) AS days FROM activity_logs a JOIN staff s ON s.tenant_id = a.tenant_id AND s.email = a.actor
        WHERE a.tenant_id = ? AND a.at >= ? AND s.is_active = 1 AND s.deleted_at IS NULL GROUP BY s.id, s.name`, [tenantId, since]),
    listPresence(tenantId, { now }),
  ]);
  const seen = new Map(presence.map(p => [p.staffKey, p]));
  return baseline.flatMap(row => {
    const p = seen.get(String(row.id));
    if (!p || statusOf(p.lastSeenAt, now) === 'offline') return [];
    const judged = judgeIdle({ perDay: num(row.days) ? num(row.actions) / num(row.days) : 0, lastSeenAgoMs: now - p.lastSeenAt, lastActionAgoMs: p.lastActionAt ? now - p.lastActionAt : null });
    return judged ? [{ key: `idle:${row.id}`, tone: 'amber', to: '/dashboard/presence_now',
      text: `${row.name} فاتح السيستم ومفيش إجراء ${judged.idleMinutes === null ? 'النهارده' : `من ${judged.idleMinutes} دقيقة`} — المعتاد ${judged.perDay} إجراء في اليوم` }] : [];
  });
}

const slowerEndpoints = () => perfMonitor.regressions().slice(0, 3).map(row => ({
  key: `slower:${row.route}`, tone: 'sky', to: '/dashboard/security_center', text: `${row.route} بقى أبطأ: p95 من ${row.before} لـ ${row.now} مللي ثانية`,
}));

/**
 * The flags for a tenant now. `canSeeMonitor` and `canSeePresence` leave out what the caller may not read (the endpoints are the monitor's, the idle names presence's).
 * Held five minutes, not dropped by writes: they judge whole days.
 */
async function detectAnomalies(tenantId, { today = cairoToday(), now = Date.now(), canSeeMonitor = false, canSeePresence = false } = {}) {
  const yesterday = addDaysToDateOnly(today, -1);
  const key = `anomalies:${tenantId}:${today}:${canSeeMonitor}:${canSeePresence}`;
  return cached(key, 5 * 60 * 1000, async () => {
    const [drop, surges, idle] = await Promise.all([collectionsDrop(tenantId, yesterday), leadSurges(tenantId, yesterday), canSeePresence ? idleStaff(tenantId, now) : []]);
    return [...drop, ...surges, ...idle, ...(canSeeMonitor ? slowerEndpoints() : [])];
  });
}

module.exports = { detectAnomalies, judgeDrop, judgeSurge, judgeIdle, inWorkingHours };
