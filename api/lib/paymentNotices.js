'use strict';

// Tell the people behind a client when money moves on them.
//
// «لما عميل بيتقبل او بيترفض او حجز جديد لسيلز او تحصيل او غيره يروحله اشعار مهم» (18 Oct 2026). A rejected
// payment already tells whoever took it why (lib/paymentRejection.js); an accepted one and a booking made on a
// rep's client by someone else told nobody, so the rep learned it from the client or from the accounts page.
//
// Who is told is the same rule for all three: whoever recorded the payment and the client's rep and collector,
// without the person who just did it. An accepted payment or a new booking with nobody to name stays quiet (the
// managers already have their own line for a booking waiting for them); a rejection with nobody falls back to the
// managers' bell, as before.
//
// Marked `importance` so the bell shows them in «مهم» (admin/pages/dashboard/NotificationsBell.tsx): critical is
// red, high is green.

const logger = require('./logger');
const { recipientsOf } = require('./paymentRejection');

const KINDS = Object.freeze({
  approved: { title: '✅ دفعة اتقبلت', importance: 'high', verb: 'اتقبلت' },
  booked: { title: '🆕 حجز جديد على عميلك', importance: 'high', verb: 'اتسجّل' },
});

async function clientOf(db, tenantId, subscriberId) {
  if (!subscriberId) return null;
  const [[row]] = await db.query(
    'SELECT name, client_code, assigned_sales_id, assigned_cs_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
    [subscriberId, tenantId]).catch(() => [[null]]);
  return row || null;
}

/**
 * `outcome` is 'approved' or 'booked'. Called after the write has been committed; never throws, so a notification
 * that fails cannot undo or hide the payment. Returns how many people were told.
 */
async function notifyPaymentOutcome({
  outcome, tenantId, subscriberId, amount, currency, recordedBy, actorId, actorName, pending = false, kind = 'payment', itemTitle,
}, { db = require('./db').pool, notify = require('./notification').createNotification } = {}) {
  try {
    const spec = KINDS[outcome];
    if (!spec) return 0;
    const client = await clientOf(db, tenantId, subscriberId);
    const recipients = recipientsOf({
      recordedBy, assignedSalesId: client?.assigned_sales_id, assignedCsId: client?.assigned_cs_id, rejectedBy: actorId,
    });
    if (!recipients.length) return 0;
    const money = amount != null ? `${Number(amount).toLocaleString('en-US')} ${currency || 'EGP'}` : '';
    const message = `${client?.name || 'عميل'}${money ? ` — ${money}` : ''}${itemTitle ? ` · ${itemTitle}` : ''}`
      + `${pending ? ' · مستني الاعتماد' : ''}${actorName ? `\n${spec.verb} بواسطة ${actorName}` : ''}`;
    const data = {
      kind, outcome, importance: spec.importance, subscriberId: subscriberId || null, clientCode: client?.client_code || null, tab: 'orders',
    };
    await Promise.all(recipients.map(recipientStaffId => notify('payment', spec.title, message, data, tenantId, recipientStaffId)));
    return recipients.length;
  } catch (error) {
    logger.warn('[payment-notices] notify failed:', error.message);
    return 0;
  }
}

module.exports = { notifyPaymentOutcome };
