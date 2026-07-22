'use strict';
const logger = require('./logger');
const { uuidv4 } = require('./id');
const { pool } = require('./db');

async function logLeadEventStrict(leadId, eventType, description, meta = {}, tenantId = 'tenant-default', db = pool) {
  await db.query(
    `INSERT INTO lead_timeline (id, tenant_id, lead_id, event_type, description, meta_json, at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [uuidv4(), tenantId, leadId, eventType, description, JSON.stringify(meta)]
  );
}

// Best-effort timeline writer for non-critical notifications and historical callers.
async function logLeadEvent(leadId, eventType, description, meta = {}, tenantId = 'tenant-default', db = pool) {
  try {
    await logLeadEventStrict(leadId, eventType, description, meta, tenantId, db);
  } catch (e) {
    logger.warn('[lead_timeline] log error:', e.message);
  }
}

module.exports = { logLeadEvent, logLeadEventStrict };
