'use strict';

const { pool } = require('./db');
const { logLeadEventStrict } = require('./crm');

async function assignLead({ tenantId, leadId, salesId, actor = null, reason = 'Lead assigned', metadata = {} }, db = null) {
  if (!tenantId || !leadId || !salesId) {
    const error = new Error('tenantId, leadId and salesId are required');
    error.statusCode = 400;
    throw error;
  }
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[lead]] = await conn.query(
      'SELECT id,assigned_sales_id,assigned_sales_name FROM leads WHERE id=? AND tenant_id=? AND hidden=0 LIMIT 1 FOR UPDATE',
      [leadId, tenantId]
    );
    if (!lead) {
      const error = new Error('Lead not found');
      error.statusCode = 404;
      throw error;
    }
    const [[staff]] = await conn.query(
      "SELECT id,name FROM staff WHERE id=? AND tenant_id=? AND UPPER(role)='SALES' AND is_active=1 AND deleted_at IS NULL LIMIT 1",
      [salesId, tenantId]
    );
    if (!staff) {
      const error = new Error('Active sales staff not found');
      error.statusCode = 409;
      throw error;
    }
    if (String(lead.assigned_sales_id || '') === String(staff.id)) {
      if (ownsConnection) await conn.commit();
      return { changed: false, leadId, salesId: staff.id, salesName: staff.name };
    }
    await conn.query(
      'UPDATE leads SET assigned_sales_id=?,assigned_sales_name=?,updated_at=NOW() WHERE id=? AND tenant_id=?',
      [staff.id, staff.name, leadId, tenantId]
    );
    await logLeadEventStrict(leadId, 'assigned', reason, {
      fromSalesId: lead.assigned_sales_id || null,
      fromSalesName: lead.assigned_sales_name || null,
      salesId: staff.id,
      salesName: staff.name,
      actor,
      ...metadata,
    }, tenantId, conn);
    if (ownsConnection) await conn.commit();
    return { changed: true, leadId, salesId: staff.id, salesName: staff.name };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

module.exports = { assignLead };
