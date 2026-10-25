'use strict';

// «يوصل للمحاضر إشعار بكل استشارة جديدة على السيستم وعلى الواتساب» (25 Oct 2026).
//
// A consultation booked with a lecturer tells the lecturer: a notification in their portal and a WhatsApp message to
// the number on their staff file, with the day and hour (or «عاجلة خلال 60 دقيقة» when it is an express session).
// Queued with the booking in the outbox, one per consultation, and best-effort: a failure here never fails the booking.

const outbox = require('./outbox');
const { insertNotification } = require('./notification');
const { toDialable } = require('./phoneNumber');
const logger = require('./logger');

const when = row => {
  const raw = String(row.sessionAt || '').replace('T', ' ');
  return raw.length >= 10 ? raw.slice(0, 16).replace(/ 00:00$/, '') : '';
};

/** The words the lecturer reads: who, urgent or scheduled, and when. */
function consultationNotice({ clientName, source, sessionAt, sessionType }) {
  const urgent = source === 'site_express';
  const kind = { individual: 'فردية', couple: 'زوجية', family: 'أسرية' }[String(sessionType || '').toLowerCase()] || '';
  const timing = urgent ? '⚡ عاجلة — التواصل مع العميل خلال 60 دقيقة' : `📅 استشارة بموعد: ${when({ sessionAt }) || 'الموعد هيتحدد'}`;
  return {
    title: urgent ? '⚡ استشارة عاجلة جديدة' : '📅 استشارة جديدة',
    message: [`العميل: ${clientName || 'عميل'}`, kind ? `النوع: ${kind}` : '', timing].filter(Boolean).join(' — '),
    whatsapp: [urgent ? '⚡ *استشارة عاجلة جديدة*' : '📅 *استشارة جديدة*', `العميل: ${clientName || 'عميل'}`, kind ? `النوع: ${kind}` : '', timing,
      'افتح بوابة المحاضر لتأكيدها أو متابعتها.'].filter(Boolean).join('\n'),
  };
}

/**
 * Tell the lecturer behind a therapist profile. `db` is the booking's connection (the outbox row joins its transaction).
 * @returns {Promise<{ notified: boolean, whatsapp: boolean }>}
 */
async function tellLecturerOfConsultation(db, { tenantId, consultationId, therapistId, clientName, source, sessionAt, sessionType }) {
  try {
    const [[lecturer]] = await db.query(
      `SELECT s.id, s.name, s.phone FROM therapists t JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id
        WHERE t.id=? AND t.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL LIMIT 1`, [therapistId, tenantId]);
    if (!lecturer) return { notified: false, whatsapp: false };
    const notice = consultationNotice({ clientName, source, sessionAt, sessionType });
    await insertNotification(db, 'consultation', notice.title, notice.message, { consultationId, urgent: source === 'site_express' }, tenantId, lecturer.id);
    const recipient = toDialable(lecturer.phone);
    let whatsapp = false;
    if (recipient) {
      whatsapp = Boolean(await outbox.enqueue({
        channel: 'whatsapp', recipient, tenantId, refType: 'consultation', refId: consultationId,
        dedupeKey: `consultation-lecturer:${tenantId}:${consultationId}`,
        payload: { message: `أهلاً د. ${lecturer.name} 👋\n${notice.whatsapp}`, category: 'reminder' },
      }, db));
    }
    return { notified: true, whatsapp };
  } catch (error) {
    logger.warn('[consultation] the lecturer was not told:', error.message);
    return { notified: false, whatsapp: false };
  }
}

module.exports = { consultationNotice, tellLecturerOfConsultation };
