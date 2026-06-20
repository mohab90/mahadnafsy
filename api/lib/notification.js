'use strict';
const { uuidv4 } = require('./id');
const { pool } = require('./db');

let notificationsTableReady = false;

async function ensureNotificationsTable() {
  if (notificationsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(36) PRIMARY KEY,
      subscriber_id VARCHAR(100) DEFAULT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      title VARCHAR(255) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      data_json TEXT DEFAULT NULL,
      read_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_created (created_at),
      INDEX idx_notifications_read (read_at),
      INDEX idx_notifications_subscriber (subscriber_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL AFTER id').catch(() => {});
  await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT DEFAULT NULL AFTER message').catch(() => {});
  await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at DATETIME DEFAULT NULL AFTER data_json').catch(() => {});
  await pool.query('ALTER TABLE notifications MODIFY title VARCHAR(255) DEFAULT NULL').catch(() => {});
  notificationsTableReady = true;
}

// Non-fatal: notification failure must not break the business action that triggered it.
async function createNotification(type, title, message, data = {}) {
  try {
    await ensureNotificationsTable();
    await pool.query(
      `INSERT INTO notifications (id, type, title, message, data_json) VALUES (?,?,?,?,?)`,
      [uuidv4(), type || 'info', title || null, message || null, JSON.stringify(data)]
    );
  } catch (e) {
    console.warn('[notify] createNotification error:', e.message);
  }
}

module.exports = { createNotification, ensureNotificationsTable };
