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
// 13 Nov 2026 («مينفعش انت تروح محولهم لمسار العلاج الكامل»): only courses NO booked track covers are named. A client booked in «التشخيص» and later in
// «العلاج» keeps those two even when together they hold every course of a bigger track; a track was booked when a payment, a price, money paid before the
// system or an enrolment names it (the same evidence as lib/heldTracks.js reads). Before this, an enrolment of a booked track that had lost its track id
// was named into the bigger one.
//
// The money comes along: «مدفوع قبل السيستم» for the courses adds up on the
// track and their payments count for the track. Nobody's balance moves: when
// any of the courses carried money — a price, a booking, a payment — the track
// costs what the courses were agreed at together; a client with none of that
// takes the track's catalogue price.

const { itemBalances, itemKey } = require('./agreedPrice');
const { moneyOf, replaceItemMoney } = require('./itemMoney');
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
  const [covered] = await db.query(
    `SELECT DISTINCT bc.course_id FROM bundle_courses bc
      WHERE bc.tenant_id=? AND bc.bundle_id IN (
        SELECT bundle_id FROM payments WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND bundle_id IS NOT NULL
        UNION SELECT bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active' AND bundle_id IS NOT NULL
        UNION SELECT SUBSTRING(item_key, 8) FROM client_item_money WHERE tenant_id=? AND subscriber_id=? AND item_key LIKE 'bundle:%')`,
    [tenantId, tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId]);
  const booked = new Set((Array.isArray(covered) ? covered : []).map(row => String(row.course_id)));
  const loose = enrolments.filter(row => !booked.has(String(row.course_id)));
  if (loose.length < 2) return [];
  const plan = planTracks(tracks || await loadTracks(db, tenantId), loose);
  if (!plan.length || dryRun) return plan.map(({ track }) => ({ trackId: track.id, title: track.title, courses: track.courses.length }));

  // What each course costs them now, before any of it moves.
  const balances = await itemBalances(db, { tenantId, subscriberId, foldTracks: false });
  await db.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [subscriberId, tenantId]);
  const held = await moneyOf(db, { tenantId, subscriberId });
  const customPrices = { ...held.customPrices };
  const priorPaid = { ...held.priorPaid };
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
    const prior = track.courses.reduce((sum, courseId) => sum + (Number(priorPaid[courseId]) || 0), 0);
    const courseBalances = track.courses.map(courseId => balances.get(String(courseId)) || {});
    const carriedMoney = track.courses.some((courseId, index) => Number(customPrices[courseId]) > 0
      || Number(courseBalances[index].booked) > 0 || Number(courseBalances[index].paid) > 0 || Number(courseBalances[index].priorPaid) > 0);
    let priced = Number(customPrices[key]) > 0 ? 'kept' : 'catalogue';
    if (priced === 'catalogue' && carriedMoney) {
      const together = courseBalances.reduce((sum, balance) => sum + (Number(balance.expected) || 0), 0);
      if (together > 0) { customPrices[key] = together; priced = 'together'; }
    }
    if (prior > 0) priorPaid[key] = (Number(priorPaid[key]) || 0) + prior;
    track.courses.forEach(courseId => { delete customPrices[courseId]; delete priorPaid[courseId]; });

    await logClientEvent(db, {
      tenantId, subscriberId, action: 'track_named', actor: actor || 'السيستم',
      label: `اتجمعت كورسات «${track.title}» في المسار — العميل حاجز كل كورساته (${track.courses.length})`
        + (moved.affectedRows ? ` · ${moved.affectedRows} دفعة اتحسبت على المسار` : '')
        + (prior > 0 ? ` · مدفوع قبل السيستم ${prior}` : '')
        + (priced === 'together' ? ` · سعر المسار ${customPrices[key]} = أسعار كورساته زي ما كانت` : priced === 'catalogue' ? ' · المسار بسعر الكتالوج' : ''),
    });
    done.push({ trackId: track.id, title: track.title, courses: track.courses.length, paymentsMoved: moved.affectedRows || 0 });
  }
  await replaceItemMoney(db, { tenantId, subscriberId, customPrices, priorPaid });
  return done;
}

module.exports = { loadTracks, nameCompletedTracks, planTracks };
