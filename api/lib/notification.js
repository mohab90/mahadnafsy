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

// Non-fatal: notification failure must not break the business action that triggered it.
async function createNotification(type, title, message, data = {}, tenantId = DEFAULT_TENANT) {
  try {
    await ensureNotificationsTable();
    await pool.query(
      `INSERT INTO notifications (id, tenant_id, type, title, message, data_json) VALUES (?,?,?,?,?,?)`,
      [uuidv4(), tenantId, type || 'info', title || null, message || null, JSON.stringify(data)]
    );
  } catch (e) {
    logger.warn('[notify] createNotification error:', e.message);
  }
}

module.exports = { createNotification, ensureNotificationsTable };
