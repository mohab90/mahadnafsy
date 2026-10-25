'use strict';

// «طلب تأجيل الاستشارة» (25 Oct 2026): either side can ask to move a consultation instead of cancelling it.
//   the lecturer proposes a day and one of their weekly hours → the client gets a WhatsApp link to accept or say it does not suit;
//   the client asks for another day and hour from the lecturer's open ones (their own link, in the reminder) → the lecturer
//   answers in the portal.
// Nothing moves until the other side accepts. The proposal is checked like a booking is — a day in the booking window, an hour
// the lecturer works, not a day they closed, nobody else in that hour — and checked again at the moment it is accepted.

const { createHash, createHmac } = require('crypto');
const outbox = require('./outbox');
const { insertNotification } = require('./notification');
const { toDialable } = require('./phoneNumber');
const { uuidv4 } = require('./id');
const { bookingRuleError, findSlot } = require('./consultationRequests');
const { isDayBlocked } = require('./therapistAvailability');

const SITE = () => String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
const secret = () => process.env.JWT_SECRET || process.env.AUTH_SECRET || 'mahad-consultation-reschedule';
const mac = text => createHmac('sha256', secret()).update(text).digest('hex').slice(0, 32);
const same = (a, b) => createHash('sha256').update(String(a || '')).digest().equals(createHash('sha256').update(String(b || '')).digest());

const respondToken = requestId => mac(`resched.respond.${requestId}`);
const requestToken = consultationId => mac(`resched.new.${consultationId}`);
const rescheduleRespondLink = requestId => `${SITE()}/consultation-reschedule?r=${encodeURIComponent(requestId)}&t=${respondToken(requestId)}`;
const rescheduleRequestLink = consultationId => `${SITE()}/consultation-reschedule?c=${encodeURIComponent(consultationId)}&t=${requestToken(consultationId)}`;
const validRespondToken = (requestId, token) => Boolean(requestId) && same(token, respondToken(requestId));
const validRequestToken = (consultationId, token) => Boolean(consultationId) && same(token, requestToken(consultationId));

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { statusCode, code });
const hour12 = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; };
/** «2026-11-02 · 6:30 م» from 'YYYY-MM-DD HH:MM:SS'. */
const humanAt = at => `${at.slice(0, 10)} · ${hour12(at.slice(11, 16))}`;

async function activeConsultation(db, { tenantId, consultationId }) {
  const [[row]] = await db.query(
    `SELECT c.id, c.tenant_id, c.therapist_id, c.status, c.client_name, c.client_phone, c.slot_id,
            DATE_FORMAT(c.session_date, '%Y-%m-%d %H:%i:00') AS at, t.name AS therapist_name, t.staff_id
       FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
      WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL LIMIT 1`, [consultationId, tenantId]);
  if (!row) throw fail('الاستشارة مش موجودة', 'CONSULTATION_NOT_FOUND', 404);
  if (!['PENDING', 'CONFIRMED'].includes(row.status)) throw fail('الاستشارة دي خلصت أو اتلغت — مينفعش تتأجل', 'CONSULTATION_CLOSED', 409);
  return row;
}

/** The hour the proposal names must be free: not closed by the lecturer, and nobody else booked in it. */
async function assertOpen(db, { tenantId, consultation, date, at }) {
  if (await isDayBlocked(db, { tenantId, therapistId: consultation.therapist_id, date })) throw fail('المحاضر مش متاح في اليوم ده', 'THERAPIST_DAY_BLOCKED', 409);
  const [[taken]] = await db.query(
    `SELECT 1 AS ok FROM consultations WHERE tenant_id=? AND therapist_id=? AND id<>? AND deleted_at IS NULL
        AND status IN ('PENDING','CONFIRMED') AND session_date = ? LIMIT 1`, [tenantId, consultation.therapist_id, consultation.id, at]);
  if (taken) throw fail('الميعاد ده محجوز لحد تاني — اختار ميعاد تاني', 'SLOT_TAKEN', 409);
}

/** Records a proposal from `by` ('lecturer' | 'client') and tells the other side. */
async function proposeReschedule(db, { tenantId, consultationId, by, date, slotId, reason = '', settings, now = new Date() }) {
  const consultation = await activeConsultation(db, { tenantId, consultationId });
  const slot = await findSlot(db, { tenantId, therapistId: consultation.therapist_id, slotId });
  if (!slot) throw fail('اختار ميعاد من مواعيد المحاضر', 'SLOT_REQUIRED');
  const refused = bookingRuleError({ sessionDate: date, slot, settings, now });
  if (refused) throw fail(refused.error, refused.code);
  const at = `${date} ${String(slot.start_time).slice(0, 5)}:00`;
  if (at === consultation.at) throw fail('ده نفس الميعاد الحالي', 'SAME_TIME');
  await assertOpen(db, { tenantId, consultation, date, at });
  await db.query("UPDATE consultation_reschedules SET status='cancelled', decided_at=NOW() WHERE tenant_id=? AND consultation_id=? AND status='pending'", [tenantId, consultation.id]);
  const id = uuidv4();
  await db.query(
    `INSERT INTO consultation_reschedules (id, tenant_id, consultation_id, proposed_by, old_session_at, new_session_at, new_slot_id, reason)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, tenantId, consultation.id, by, consultation.at, at, slot.id, String(reason || '').trim().slice(0, 500) || null]);
  if (by === 'lecturer') {
    const recipient = toDialable(consultation.client_phone);
    if (recipient) {
      await outbox.enqueue({
        channel: 'whatsapp', recipient, tenantId, refType: 'consultation', refId: consultation.id, dedupeKey: `consultation-reschedule:${id}:client`,
        payload: {
          message: `أهلاً ${consultation.client_name || ''} 👋\nد. ${consultation.therapist_name || ''} بيقترح يأجّل جلستك من ${humanAt(consultation.at)} إلى ${humanAt(at)}${reason ? `\nالسبب: ${reason}` : ''}\nوافق أو اعتذر من هنا: ${rescheduleRespondLink(id)}`,
          category: 'reminder',
        },
      }, db);
    }
  } else if (consultation.staff_id) {
    await insertNotification(db, 'consultation', '🔁 عميل بيطلب تأجيل جلسة',
      `${consultation.client_name || 'العميل'} بيطلب ينقل الجلسة من ${humanAt(consultation.at)} إلى ${humanAt(at)}${reason ? ` — ${reason}` : ''}. ردّ عليه من «الاستشارات».`,
      { consultationId: consultation.id, rescheduleId: id }, tenantId, consultation.staff_id);
  }
  return { id, at, consultationId: consultation.id };
}

/** The other side answers: accepting moves the consultation, declining leaves it where it was. */
async function decideReschedule(db, { tenantId, id, by, answer, note = '' }) {
  const [[request]] = await db.query('SELECT * FROM consultation_reschedules WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [id, tenantId]);
  if (!request) throw fail('الطلب مش موجود', 'RESCHEDULE_NOT_FOUND', 404);
  if (request.status !== 'pending') throw fail('الطلب ده اتردّ عليه قبل كده أو اتلغى', 'RESCHEDULE_DECIDED', 409);
  if (request.proposed_by === by) throw fail('الطرف التاني هو اللي يرد على الطلب', 'RESCHEDULE_OWN', 403);
  const consultation = await activeConsultation(db, { tenantId, consultationId: request.consultation_id });
  const proposedAt = new Date(request.new_session_at);
  const at = `${proposedAt.getUTCFullYear()}-${String(proposedAt.getUTCMonth() + 1).padStart(2, '0')}-${String(proposedAt.getUTCDate()).padStart(2, '0')} ${String(proposedAt.getUTCHours()).padStart(2, '0')}:${String(proposedAt.getUTCMinutes()).padStart(2, '0')}:00`;
  const cleanNote = String(note || '').trim().slice(0, 500) || null;
  if (answer === 'accept') {
    await assertOpen(db, { tenantId, consultation, date: at.slice(0, 10), at });
    await db.query('UPDATE consultations SET session_date=?, slot_id=? WHERE id=? AND tenant_id=?', [at, request.new_slot_id, consultation.id, tenantId]);
  } else if (answer !== 'decline') {
    throw fail('الرد لازم يكون موافقة أو اعتذار', 'RESCHEDULE_ANSWER');
  }
  await db.query("UPDATE consultation_reschedules SET status=?, decided_at=NOW(), decision_note=? WHERE id=? AND tenant_id=?",
    [answer === 'accept' ? 'accepted' : 'declined', cleanNote, id, tenantId]);
  // The one who asked hears the answer.
  const verdict = answer === 'accept' ? `اتوافق على النقل — الجلسة بقت ${humanAt(at)}` : `الطرف التاني اعتذر عن الميعاد المقترح${cleanNote ? ` — ${cleanNote}` : ''}`;
  if (request.proposed_by === 'client' && consultation.client_phone) {
    const recipient = toDialable(consultation.client_phone);
    if (recipient) {
      await outbox.enqueue({ channel: 'whatsapp', recipient, tenantId, refType: 'consultation', refId: consultation.id, dedupeKey: `consultation-reschedule:${id}:answer`,
        payload: { message: answer === 'accept' ? `✅ د. ${consultation.therapist_name || ''} وافق — جلستك بقت ${humanAt(at)}` : `الميعاد اللي طلبته مش مناسب للدكتور${cleanNote ? ` (${cleanNote})` : ''} — جلستك لسه في ميعادها ${humanAt(consultation.at)}`, category: 'reminder' } }, db);
    }
  } else if (consultation.staff_id) {
    await insertNotification(db, 'consultation', answer === 'accept' ? '✅ العميل وافق على التأجيل' : '↩️ العميل اعتذر عن الميعاد المقترح',
      `${consultation.client_name || 'العميل'}: ${verdict}`, { consultationId: consultation.id, rescheduleId: id }, tenantId, consultation.staff_id);
  }
  return { status: answer === 'accept' ? 'accepted' : 'declined', at, consultationId: consultation.id };
}

module.exports = {
  decideReschedule, humanAt, proposeReschedule, rescheduleRequestLink, rescheduleRespondLink, respondToken, requestToken, validRequestToken, validRespondToken,
};
