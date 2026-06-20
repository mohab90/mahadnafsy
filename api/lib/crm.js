'use strict';
const logger = require('./logger');
const { uuidv4 } = require('./id');
const { pool } = require('./db');

// Appends an event row to lead_timeline for audit/history tracking.
async function logLeadEvent(leadId, eventType, description, meta = {}) {
  try {
    await pool.query(
      `INSERT INTO lead_timeline (id, lead_id, event_type, description, meta_json, at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [uuidv4(), leadId, eventType, description, JSON.stringify(meta)]
    );
  } catch (e) {
    logger.warn('[lead_timeline] log error:', e.message);
  }
}

module.exports = { logLeadEvent };
