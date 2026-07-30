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

// Non-fatal convenience for secondary notifications outside a business transaction.
async function createNotification(type, title, message, data = {}, tenantId = DEFAULT_TENANT, recipientStaffId = null) {
  try {
    await ensureNotificationsTable();
    await insertNotification(pool, type, title, message, data, tenantId, recipientStaffId);
  } catch (e) {
    logger.warn('[notify] createNotification error:', e.message);
  }
}

module.exports = { createNotification, insertNotification, ensureNotificationsTable };
