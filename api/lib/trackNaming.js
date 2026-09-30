'use strict';

// «في عملاء حاجه علم نفس متكامل ظاهر في الجدول الكورسات الداخليه كل كورس
// واحدة … مدام حاجز كل الكورسات يظهر مسار فقط». A client holding every course
// of a track holds the track: 238 held all three courses of «دبلومة علم النفس
// المتكامل» with no track on them — enrolled course by course, mostly by the
// sheet imports — and every screen listed the three.
//
// Named here, on the enrolments, so the table, «صلاحية الكورسات», the payment
// dialog and the client's own page all say the same thing. Biggest track first:
// «المعالج النفسي المحترف» holds the courses of two smaller tracks, and a client
// in it is in it, not in those. A course already under a track stays there.
//
// The money comes along: «مدفوع قبل السيستم» for the courses adds up on the
// track, their payments count for the track, and their agreed prices become the
// track's only when every course had one (else the track's catalogue price).

const { itemKey } = require('./agreedPrice');
const { logClientEvent } = require('./clientHistory');

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

async function loadTracks(db, tenantId) {
  const [rows] = await db.query(
    `SELECT b.id, b.title, bc.course_id FROM bundles b
       JOIN bundle_courses bc ON bc.bundle_id=b.id AND bc.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND b.deleted_at IS NULL`, [tenantId]);
  const tracks = new Map();
  for (const row of rows) {
    const track = tracks.get(row.id) || { id: row.id, title: row.title, courses: [] };
    track.courses.push(row.course_id);
    tracks.set(row.id, track);
  }
  // One course is not a track, and the biggest wins.
  return [...tracks.values()].filter(track => track.courses.length > 1)
    .sort((a, b) => b.courses.length - a.courses.length || String(a.id).localeCompare(String(b.id)));
}

/** Which tracks this client completes: [{ track, enrolmentIds }]. */
function planTracks(tracks, enrolments) {
  const free = new Map(enrolments.map(row => [String(row.course_id), row.id]));
  const plan = [];
  for (const track of tracks) {
    if (!track.courses.every(courseId => free.has(String(courseId)))) continue;
    plan.push({ track, enrolmentIds: track.courses.map(courseId => free.get(String(courseId))) });
    track.courses.forEach(courseId => free.delete(String(courseId)));
  }
  return plan;
}

/**
 * Names every track this client holds all the courses of. Inside the caller's
 * transaction. `dryRun` reports the plan and writes nothing.
 */
async function nameCompletedTracks(db, { tenantId, subscriberId, actor = null, dryRun = false, tracks = null }) {
  const [enrolments] = await db.query(
    `SELECT id, course_id FROM enrollments
      WHERE tenant_id=? AND subscriber_id=? AND status='active' AND bundle_id IS NULL AND course_id IS NOT NULL`,
    [tenantId, subscriberId]);
  if (!Array.isArray(enrolments) || enrolments.length < 2) return [];
  const plan = planTracks(tracks || await loadTracks(db, tenantId), enrolments);
  if (!plan.length || dryRun) return plan.map(({ track }) => ({ trackId: track.id, title: track.title, courses: track.courses.length }));

  const [[subscriber]] = await db.query(
    'SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [subscriberId, tenantId]);
  const crm = parseCrm(subscriber?.crm_json);
  const customPrices = { ...(crm.customPrices || {}) };
  const priorPaid = { ...(crm.priorPaid || {}) };
  const done = [];
  for (const { track, enrolmentIds } of plan) {
    await db.query(
      `UPDATE enrollments SET bundle_id=?, updated_at=NOW()
        WHERE tenant_id=? AND id IN (${enrolmentIds.map(() => '?').join(',')})`,
      [track.id, tenantId, ...enrolmentIds]);
    const [moved] = await db.query(
      `UPDATE payments SET bundle_id=?, course_expected=NULL
        WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND bundle_id IS NULL
          AND payment_type IN ('COURSE','BUNDLE') AND course_id IN (${track.courses.map(() => '?').join(',')})`,
      [track.id, tenantId, subscriberId, ...track.courses]);

    const key = itemKey({ bundleId: track.id });
    const coursePrices = track.courses.map(courseId => Number(customPrices[courseId]) || 0);
    const prior = track.courses.reduce((sum, courseId) => sum + (Number(priorPaid[courseId]) || 0), 0);
    if (!(Number(customPrices[key]) > 0) && coursePrices.every(price => price > 0)) {
      customPrices[key] = coursePrices.reduce((sum, price) => sum + price, 0);
    }
    if (prior > 0) priorPaid[key] = (Number(priorPaid[key]) || 0) + prior;
    const dropped = track.courses.filter(courseId => Number(customPrices[courseId]) > 0);
    track.courses.forEach(courseId => { delete customPrices[courseId]; delete priorPaid[courseId]; });

    await logClientEvent(db, {
      tenantId, subscriberId, action: 'track_named', actor: actor || 'السيستم',
      label: `اتجمعت كورسات «${track.title}» في المسار — العميل حاجز كل كورساته (${track.courses.length})`
        + (moved.affectedRows ? ` · ${moved.affectedRows} دفعة اتحسبت على المسار` : '')
        + (prior > 0 ? ` · مدفوع قبل السيستم ${prior}` : '')
        + (dropped.length && !(Number(customPrices[key]) > 0) ? ' · أسعار الكورسات اتشالت والمسار بسعر الكتالوج' : ''),
    });
    done.push({ trackId: track.id, title: track.title, courses: track.courses.length, paymentsMoved: moved.affectedRows || 0 });
  }
  crm.customPrices = customPrices;
  crm.priorPaid = priorPaid;
  await db.query('UPDATE subscribers SET crm_json=? WHERE id=? AND tenant_id=?', [JSON.stringify(crm), subscriberId, tenantId]);
  return done;
}

module.exports = { loadTracks, nameCompletedTracks, planTracks };
