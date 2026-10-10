'use strict';

/**
 * «الواتساب يتابع لوحده أي عميل غاب محاضرتين … بس نوقفها شوية لحد ما نظبط واتس
 * اب الفرع علي السيسيتم بس نجهزها» (9 Oct 2026). Ready, and off: nothing is sent
 * until the branch manager switches it on (tenant setting `daqqi_automation`).
 *
 * A client of a running round who missed two of the lectures its attendance was
 * taken for (the most any client of the round was marked — lib/clientsAtRisk.js
 * counts the same way) gets one message, and one more each further lecture missed.
 */

const outbox = require('./outbox');
const { getTenantSetting } = require('./tenantSettings');

const SECTION = 'daqqi_automation';
const MISSED = 2;
// Signed with the round's own branch — a Tagamoa client was told «فرع الدقي».
const BRANCH_LABEL = { DAQQI: 'الدقي', TAGAMOA: 'التجمع' };

async function dokkiAutomationSettings(tenantId) {
  const saved = await getTenantSetting(SECTION, { tenantId, fallback: {} }).catch(() => ({})) || {};
  return { absenceFollowUp: saved.absenceFollowUp === true, weeklyReport: saved.weeklyReport !== false };
}

async function runAbsenceFollowUp(db, { tenantId, force = false }) {
  if (!force && !(await dokkiAutomationSettings(tenantId)).absenceFollowUp) return 0;
  const [rows] = await db.query(
    `SELECT da.round_id, da.subscriber_id, da.attended_lectures, r.code, r.branch, s.name, s.phone,
            COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title,
            (SELECT MAX(x.attended_lectures) FROM daqqi_attendees x WHERE x.tenant_id = da.tenant_id AND x.round_id = da.round_id) AS sessions
       FROM daqqi_attendees da
       JOIN daqqi_rounds r ON r.id = da.round_id AND r.tenant_id = da.tenant_id AND r.status <> 'FINISHED'
       JOIN subscribers s ON s.id = da.subscriber_id AND s.tenant_id = da.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      WHERE da.tenant_id = ?`, [tenantId]);
  let queued = 0;
  for (const row of rows) {
    const missed = Math.max(0, Number(row.sessions) - Number(row.attended_lectures));
    if (missed < MISSED || !row.phone) continue;
    await outbox.enqueue({
      channel: 'whatsapp', recipient: row.phone, tenantId, refType: 'daqqi_round', refId: row.round_id,
      dedupeKey: `absence:${tenantId}:${row.round_id}:${row.subscriber_id}:${missed}`,
      payload: {
        category: 'reminder',
        message: `أهلاً ${row.name || ''} 🌷\nوحشتنا في محاضرات «${row.course_title || 'الكورس'}» — فاتك ${missed} محاضرات.\nلو في أي ظرف أو حاجة نقدر نساعدك فيها، ردّ علينا هنا ونرتبلك تعويض.\n— معهد الدراسات النفسية، فرع ${BRANCH_LABEL[String(row.branch || '').toUpperCase()] || 'الدقي'}`,
      },
    }, db);
    queued += 1;
  }
  return queued;
}

module.exports = { MISSED, SECTION, dokkiAutomationSettings, runAbsenceFollowUp };
