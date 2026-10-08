'use strict';

/**
 * «العميل يقيّم بنفسه بلينك واتساب بعد المحاضرة التالتة والأخيرة» (8 Oct 2026,
 * from the suggestions the owner chose). A client marked present at their third
 * lecture, and every client of a round when it is marked finished, gets a
 * WhatsApp message with their own link to the rating page on the site: the same
 * four questions the desk asks (lib/clientRatings.js), kept as theirs, and a low
 * one opens a ticket like any other.
 */

const { createHash, createHmac } = require('crypto');
const outbox = require('./outbox');

const SITE = () => String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
const secret = () => process.env.JWT_SECRET || process.env.AUTH_SECRET || 'mahad-rating';

const ratingToken = (roundId, subscriberId) =>
  createHmac('sha256', secret()).update(`rate.${roundId}.${subscriberId}`).digest('hex').slice(0, 32);
const ratingLink = (roundId, subscriberId) =>
  `${SITE()}/rate/${encodeURIComponent(roundId)}?s=${encodeURIComponent(subscriberId)}&t=${ratingToken(roundId, subscriberId)}`;
function validRating(roundId, subscriberId, token) {
  const a = createHash('sha256').update(String(token || '')).digest();
  const b = createHash('sha256').update(ratingToken(roundId, subscriberId)).digest();
  return Boolean(subscriberId) && a.equals(b);
}

const STAGE_TEXT = {
  third: 'خلصت 3 محاضرات', final: 'خلص الكورس',
};

/** WhatsApp each client their link; once per client, round and stage. */
async function inviteToRate(db, { tenantId, roundId, subscriberIds, stage }) {
  if (!subscriberIds.length) return 0;
  const [[round]] = await db.query(
    `SELECT r.id, r.code, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id
      WHERE r.id=? AND r.tenant_id=? LIMIT 1`, [roundId, tenantId]);
  if (!round) return 0;
  const [clients] = await db.query(
    `SELECT id, name, phone FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND id IN (${subscriberIds.map(() => '?').join(',')})`,
    [tenantId, ...subscriberIds]);
  let invited = 0;
  for (const client of clients) {
    if (!client.phone) continue;
    await outbox.enqueue({
      channel: 'whatsapp', recipient: client.phone, tenantId, refType: 'daqqi_round', refId: round.id,
      dedupeKey: `rate:${tenantId}:${round.id}:${client.id}:${stage}`,
      payload: {
        category: 'reminder',
        message: `أهلاً ${client.name || ''} 🌷\n${STAGE_TEXT[stage] || ''} في «${round.course_title || 'الكورس'}» — يهمنا رأيك.\nقيّم المحاضر والمادة وتوصيل المعلومة ومسئولين الفرع من 1 لـ 10 (دقيقة واحدة):\n${ratingLink(round.id, client.id)}\n— معهد الدراسات النفسية`,
      },
    }, db);
    invited += 1;
  }
  return invited;
}

module.exports = { inviteToRate, ratingLink, ratingToken, validRating };
