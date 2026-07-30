'use strict';

const { pool } = require('./db');

const failureStatuses = new Set(['failed', 'yellowcard', 'noaccount', 'notingroup']);
const allowedStatuses = new Set(['accepted', 'sent', 'delivered', 'read', 'failed']);

function normalizeDeliveryStatus(status) {
  const normalized = String(status || '').replace(/[^a-z]/gi, '').toLowerCase();
  if (failureStatuses.has(normalized)) return 'failed';
  return allowedStatuses.has(normalized) ? normalized : null;
}

function eventDate(timestamp) {
  const numeric = Number(timestamp);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(timestamp || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function applyDeliveryStatus({
  provider,
  messageId,
  status,
  timestamp,
  error,
}, db = pool) {
  const normalized = normalizeDeliveryStatus(status);
  if (!provider || !messageId || !normalized) return false;
  const at = eventDate(timestamp);
  const [result] = await db.query(
    `UPDATE message_outbox
        SET delivery_status=CASE
              WHEN ?='failed' THEN 'failed'
              WHEN delivery_status='failed' THEN delivery_status
              WHEN FIELD(?, 'accepted','sent','delivered','read')
                   >= FIELD(COALESCE(delivery_status,'accepted'), 'accepted','sent','delivered','read')
                THEN ?
              ELSE delivery_status
            END,
            provider_status_at=CASE
              WHEN provider_status_at IS NULL OR provider_status_at<=? THEN ?
              ELSE provider_status_at
            END,
            delivered_at=IF(? IN ('delivered','read'),COALESCE(delivered_at,?),delivered_at),
            read_at=IF(?='read',COALESCE(read_at,?),read_at),
            delivery_failed_at=IF(?='failed',COALESCE(delivery_failed_at,?),delivery_failed_at),
            provider_error=IF(?='failed',?,provider_error)
      WHERE channel='whatsapp' AND provider=? AND provider_message_id=?`,
    [
      normalized,
      normalized,
      normalized,
      at,
      at,
      normalized,
      at,
      normalized,
      at,
      normalized,
      at,
      normalized,
      error ? String(error).slice(0, 1000) : null,
      provider,
      String(messageId),
    ]
  );
  return result.affectedRows > 0;
}

module.exports = { applyDeliveryStatus, eventDate, normalizeDeliveryStatus };
