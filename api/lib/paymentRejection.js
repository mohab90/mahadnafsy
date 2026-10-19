'use strict';

// A rejected payment says WHY, and whoever took it is told.
//
// «في صفحة المدفوعات لما المحاسب يرفض دفعة لازم نسأله عن السبب ويروح اتوماتيك
// اشعار للسيلز او التحصيل يتقاله الدفعة اترفضت ليه» (13 Oct 2026). A payment was
// rejected with one click: no reason was asked, none was kept, and the rep or
// collector who had taken the money found out when the client rang.
//
// Three roads reject money — a desk payment (PATCH /admin/payments/:id/status),
// a website order (PATCH /admin/orders/:id) and a transfer receipt
// (PATCH /admin/payment-proofs/:id). Each asks for the reason here and tells
// the people behind the payment here.

const logger = require('./logger');

const MIN_REASON_LENGTH = 3;

const REASON_REQUIRED = Object.freeze({
  status: 400,
  body: { error: 'اكتب سبب رفض الدفعة — هيوصل للموظف اللي سجّلها.', code: 'REJECT_REASON_REQUIRED' },
});

/** The reason as typed, trimmed and bounded; '' when there is none worth keeping. */
function reasonOf(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (text) return text;
  }
  return '';
}

const hasReason = reason => String(reason || '').length >= MIN_REASON_LENGTH;

/** Who is told: whoever recorded it, and the client's rep and collector. The rejecter is not told of their own act. */
function recipientsOf({ recordedBy, assignedSalesId, assignedCsId, rejectedBy }) {
  return [...new Set([recordedBy, assignedSalesId, assignedCsId].map(id => String(id || '').trim()).filter(Boolean))]
    .filter(id => id !== String(rejectedBy || ''));
}

/**
 * Tell them, after the rejection has been committed. Never throws: a notification
 * that fails must not undo or hide a rejection.
 */
async function notifyPaymentRejected({
  tenantId, reason, amount, currency, clientName, clientCode, subscriberId,
  recordedBy, assignedSalesId, assignedCsId, rejectedBy, rejectedByName, kind = 'payment',
}, {
  notify = require('./notification').createNotification,
  message: sendMessage = (input) => require('./staffMessages').sendStaffMessage(require('./db').pool, input),
} = {}) {
  try {
    const recipients = recipientsOf({ recordedBy, assignedSalesId, assignedCsId, rejectedBy });
    const money = amount != null ? `${Number(amount).toLocaleString('en-US')} ${currency || 'EGP'}` : '';
    const title = '❌ دفعة اترفضت';
    const text = `${clientName || 'عميل'}${clientCode ? ` (${clientCode})` : ''}${money ? ` — ${money}` : ''}${rejectedByName ? ` · رفضها ${rejectedByName}` : ''}\nالسبب: ${reason}`;
    if (recipients.length) {
      // «خليها في رسالة مش اشعار» (19 Oct 2026): whoever took the payment, and the client's rep and collector, get it as a
      // message in their inbox, with the reason, and it stays there until it is read.
      await Promise.all(recipients.map(staffId => sendMessage({
        tenantId, staffId, authorId: rejectedBy || null, authorName: rejectedByName || 'المحاسبة', body: `${title}\n${text}`,
      })));
      return recipients.length;
    }
    // Nobody to tell by name: the managers' bell (no recipient) carries it.
    // importance: the bell shows it in «مهم», in red (lib/paymentNotices.js says who else is told what).
    const data = { kind, reason, importance: 'critical', subscriberId: subscriberId || null, clientCode: clientCode || null, tab: 'orders' };
    await notify('payment', title, text, data, tenantId, null);
    return 1;
  } catch (error) {
    logger.warn('[payment-rejection] notify failed:', error.message);
    return 0;
  }
}

module.exports = { MIN_REASON_LENGTH, REASON_REQUIRED, hasReason, reasonOf, recipientsOf, notifyPaymentRejected };
