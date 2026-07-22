'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ lib: 'abandoned-checkout' });
const { sendWhatsApp } = require('./whatsapp');

function buildMessage(order) {
  const title = order.item_title || 'طلبك';
  const amount = Number(order.amount || 0).toLocaleString('ar-EG');
  const currency = order.currency || 'EGP';
  return `مرحبًا ${order.customer_name || ''}
لاحظنا أن طلبك لم يكتمل بعد:
${title}
القيمة: ${amount} ${currency}

يمكنك الرجوع لإكمال الدفع أو التواصل معنا لو احتجت مساعدة.
- معهد الدراسات النفسية`;
}

async function findAbandonedOrders(options = {}) {
  const hours = Math.min(Math.max(parseInt(options.hours || '24', 10) || 24, 1), 168);
  const limit = Math.min(Math.max(parseInt(options.limit || '100', 10) || 100, 1), 500);
  const [rows] = await pool.query(
    `SELECT o.id, o.tenant_id, o.item_title, o.amount, o.currency,
            o.customer_name, o.customer_phone, o.customer_email, o.created_at
     FROM orders o
     LEFT JOIN checkout_reminders cr
       ON cr.order_id = o.id AND cr.channel = 'whatsapp'
     WHERE LOWER(o.status) = 'pending'
       AND o.created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND cr.id IS NULL
       AND (o.customer_phone IS NOT NULL AND o.customer_phone <> '')
     ORDER BY o.created_at ASC
     LIMIT ?`,
    [hours, limit]
  );
  return rows;
}

async function markReminder(order, status, reason) {
  await pool.query(
    `INSERT INTO checkout_reminders
       (id, tenant_id, order_id, customer_phone, customer_email, channel, status, reason)
     VALUES (?, ?, ?, ?, ?, 'whatsapp', ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason), sent_at = NOW()`,
    [
      uuidv4(),
      order.tenant_id || null,
      order.id,
      order.customer_phone || null,
      order.customer_email || null,
      status,
      reason || null,
    ]
  );
}

async function sendAbandonedCheckoutReminders(options = {}) {
  const orders = await findAbandonedOrders(options);
  const stats = { scanned: orders.length, sent: 0, failed: 0, skipped: 0 };

  for (const order of orders) {
    try {
      const phone = String(order.customer_phone || '').replace(/[^\d+]/g, '');
      if (!phone) {
        await markReminder(order, 'skipped', 'missing phone');
        stats.skipped += 1;
        continue;
      }

      await sendWhatsApp(phone, buildMessage(order), { tenantId: order.tenant_id });
      await markReminder(order, 'sent', null);
      stats.sent += 1;
      if (options.delayMs !== 0) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs || 1200));
      }
    } catch (error) {
      logger.warn('abandoned checkout reminder failed', { orderId: order.id, error: error.message });
      await markReminder(order, 'failed', String(error.message || 'send failed').slice(0, 255)).catch(() => {});
      stats.failed += 1;
    }
  }

  return stats;
}

module.exports = {
  findAbandonedOrders,
  sendAbandonedCheckoutReminders,
};
