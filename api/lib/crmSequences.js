'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMINAL_STATUSES = new Set(['completed', 'unenrolled', 'failed', 'unsubscribed']);

function normalizeSequenceSteps(input) {
  if (!Array.isArray(input) || input.length > 30) {
    const error = new Error('Sequence steps must be an array with at most 30 items');
    error.statusCode = 400;
    throw error;
  }
  return input.map((raw, index) => {
    const delayDays = Number(raw?.delay_days);
    const subject = String(raw?.subject || '').trim();
    const bodyHtml = String(raw?.body_html || '').trim();
    if (!Number.isFinite(delayDays) || delayDays < 0 || delayDays > 365 || !subject || !bodyHtml) {
      const error = new Error(`Invalid sequence step at index ${index}`);
      error.statusCode = 400;
      throw error;
    }
    return {
      delay_days: Math.round(delayDays * 100) / 100,
      subject: subject.slice(0, 500),
      body_html: bodyHtml.slice(0, 100000),
    };
  });
}

function assertTimezone(value) {
  const timezone = String(value || 'Africa/Cairo').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    const error = new Error('Invalid IANA timezone');
    error.statusCode = 400;
    throw error;
  }
  return timezone;
}

function assertEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    const error = new Error('A valid CRM email is required');
    error.statusCode = 400;
    throw error;
  }
  return email;
}

async function stopSequencesOnReply({ tenantId, leadId = null, subscriberId = null, reason = 'reply_received' }, db) {
  if (!tenantId || Boolean(leadId) === Boolean(subscriberId)) return 0;
  const [result] = await db.query(
    `UPDATE drip_enrollments de
      JOIN drip_sequences ds ON ds.id=de.sequence_id AND ds.tenant_id=de.tenant_id
        SET de.status='unenrolled',de.unenrolled_at=NOW(),de.exit_reason=?,
            de.last_activity_at=NOW()
      WHERE de.tenant_id=? AND de.status IN ('active','paused')
        AND ds.exit_on_reply=1
        AND ${leadId ? 'de.lead_id=?' : 'de.subscriber_id=?'}`,
    [String(reason).slice(0, 100), tenantId, leadId || subscriberId]
  );
  return Number(result.affectedRows || 0);
}

module.exports = {
  TERMINAL_STATUSES,
  normalizeSequenceSteps,
  assertTimezone,
  assertEmail,
  stopSequencesOnReply,
};
