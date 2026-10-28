'use strict';

// A consultation was marked completed (by the lecturer, the administration or the old therapist screen): the lecturer's
// fee is recorded for the accounts team to approve (lib/instructorPay.js) and the client is asked to rate the session
// (lib/consultationRating.js). Idempotent — the fee is keyed on the consultation and the invitation has a dedupe key —
// so every route that completes one simply calls this, whether or not the status was already COMPLETED.

const logger = require('./logger');
const { recordConsultationFee } = require('./instructorPay');
const { inviteToRateConsultation } = require('./consultationRating');

async function onConsultationCompleted(db, { tenantId, consultationId, actor = null }) {
  try {
    const [[consultation]] = await db.query(
      `SELECT c.id, c.status, c.therapist_id, c.client_name, c.client_phone, c.amount, c.currency, c.session_duration_minutes,
              t.name AS therapist_name
         FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
        WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL LIMIT 1`, [consultationId, tenantId]);
    if (!consultation || consultation.status !== 'COMPLETED') return { fee: false, invited: false };
    const fee = await recordConsultationFee(db, { tenantId, consultation, actor });
    const invited = await inviteToRateConsultation(db, { tenantId, consultation, lecturerName: consultation.therapist_name || '' });
    return { fee: fee.recorded, invited };
  } catch (error) {
    // Completing a session must never fail because the money or the invitation could not be written.
    logger.warn('[consultation-completed] follow-ups failed:', error.message);
    return { fee: false, invited: false };
  }
}

module.exports = { onConsultationCompleted };
