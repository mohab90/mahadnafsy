'use strict';
const logger = require('./logger');
const { uuidv4 } = require('./id');
const { pool } = require('./db');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

let notificationsTableReady = false;

async function ensureNotificationsTable() {
  if (notificationsTableReady) return;
  await pool.query('SELECT 1 FROM notifications LIMIT 1');
  notificationsTableReady = true;
}

async function insertNotification(db, type, title, message, data = {}, tenantId = DEFAULT_TENANT, recipientStaffId = null) {
  await db.query(
    `INSERT INTO notifications
       (id, tenant_id, recipient_staff_id, type, title, message, data_json)
     VALUES (?,?,?,?,?,?,?)`,
    [uuidv4(), tenantId, recipientStaffId || null, type || 'info', title || null, message || null, JSON.stringify(data)]
  );
}

/**
 * Fold a notification into the same one still unread from the last few
 * minutes, and say how many there are. A rep handed seven leads got seven
 * rows in one second — 1,182 lead rows in a week — and a failing channel wrote
 * one alert per message. Returns false when there is nothing to fold into.
 */
async function coalesceNotification(db, { type, title, data, tenantId, recipientStaffId, minutes, summarize }) {
  const [[row]] = await db.query(
    `SELECT n.id, n.data_json FROM notifications n
      WHERE n.tenant_id=? AND n.type=? AND n.title=? AND n.recipient_staff_id <=> ? AND n.read_at IS NULL
        AND n.created_at >= NOW() - INTERVAL ? MINUTE
        AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.tenant_id=n.tenant_id)
      ORDER BY n.created_at DESC LIMIT 1`,
    [tenantId, type, title, recipientStaffId || null, minutes]
  );
  if (!row) return false;
  let previous = {};
  try { previous = JSON.parse(row.data_json || '{}') || {}; } catch { previous = {}; }
  const count = (Number(previous.count) || 1) + 1;
  await db.query(
    'UPDATE notifications SET message=?, data_json=?, created_at=NOW() WHERE id=? AND tenant_id=?',
    [summarize(count, data), JSON.stringify({ ...previous, ...data, count }), row.id, tenantId]
  );
  return true;
}

/**
 * Non-fatal convenience for secondary notifications outside a business
 * transaction.
 *
 * options.coalesceMinutes + options.summarize(count, data): a burst of the same
 * notification becomes one line with a count («اتعين ليك 7 ليدز») instead of
 * one row each.
 */
async function createNotification(type, title, message, data = {}, tenantId = DEFAULT_TENANT, recipientStaffId = null, options = {}) {
  try {
    await ensureNotificationsTable();
    if (options.coalesceMinutes && typeof options.summarize === 'function') {
      const folded = await coalesceNotification(pool, {
        type, title, data, tenantId, recipientStaffId,
        minutes: options.coalesceMinutes, summarize: options.summarize,
      });
      if (folded) return;
      data = { ...data, count: 1 };
    }
    await insertNotification(pool, type, title, message, data, tenantId, recipientStaffId);
  } catch (e) {
    logger.warn('[notify] createNotification error:', e.message);
  }
}

module.exports = { coalesceNotification, createNotification, insertNotification, ensureNotificationsTable };
