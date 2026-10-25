'use strict';

// «تقييم الاستشارة» (25 Oct 2026): when a consultation is marked completed, the client gets a WhatsApp message with their
// own link to rate it from 1 to 5 — the same way a round's client is asked (lib/selfRating.js). The rating is the
// lecturer's, and shows in their portal's «التقييمات». The link carries a keyed token, so it names one consultation and
// nothing else; a consultation is rated once.

const { createHash, createHmac } = require('crypto');
const outbox = require('./outbox');
const { toDialable } = require('./phoneNumber');
const { uuidv4 } = require('./id');

const SITE = () => String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
const secret = () => process.env.JWT_SECRET || process.env.AUTH_SECRET || 'mahad-consultation-rating';

const ratingToken = consultationId => createHmac('sha256', secret()).update(`consultation-rate.${consultationId}`).digest('hex').slice(0, 32);
const ratingLink = consultationId => `${SITE()}/consultation-rating?id=${encodeURIComponent(consultationId)}&t=${ratingToken(consultationId)}`;

function validRatingToken(consultationId, token) {
  const a = createHash('sha256').update(String(token || '')).digest();
  const b = createHash('sha256').update(ratingToken(consultationId)).digest();
  return Boolean(consultationId) && a.equals(b);
}

/** WhatsApp the client their link, once per consultation. Returns whether a message was queued. */
async function inviteToRateConsultation(db, { tenantId, consultation, lecturerName = '' }) {
  const recipient = toDialable(consultation.client_phone);
  if (!recipient) return false;
  const doctor = lecturerName ? ` مع د. ${lecturerName}` : '';
  return Boolean(await outbox.enqueue({
    channel: 'whatsapp', recipient, tenantId, refType: 'consultation', refId: consultation.id,
    dedupeKey: `consultation-rating:${tenantId}:${consultation.id}`,
    payload: {
      message: `أهلاً ${consultation.client_name || ''} 💚\nشكراً لحضورك جلسة الاستشارة${doctor}.\nرأيك يهمنا — قيّم الجلسة من هنا (دقيقة واحدة): ${ratingLink(consultation.id)}\n— معهد الدراسات النفسية`,
      category: 'reminder',
    },
  }, db));
}

/** The client's one rating of one consultation; a second answer is refused, not overwritten. */
async function saveConsultationRating(db, { tenantId, consultation, rating, comment }) {
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw Object.assign(new Error('التقييم من 1 لـ 5 نجوم'), { statusCode: 400, code: 'RATING_RANGE' });
  }
  const [result] = await db.query(
    `INSERT IGNORE INTO consultation_ratings (id, tenant_id, consultation_id, therapist_id, rating, comment)
     VALUES (?,?,?,?,?,?)`,
    [uuidv4(), tenantId, consultation.id, consultation.therapist_id || null, stars, String(comment || '').trim().slice(0, 2000) || null]);
  if (!result.affectedRows) throw Object.assign(new Error('الجلسة دي اتقيّمت قبل كده'), { statusCode: 409, code: 'ALREADY_RATED' });
  return stars;
}

module.exports = { inviteToRateConsultation, ratingLink, ratingToken, saveConsultationRating, validRatingToken };
