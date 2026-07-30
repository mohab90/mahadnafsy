'use strict';

const { pool } = require('./db');
const { getNextClientCode } = require('./mappers');
const { branchIdForBranch } = require('./branches');
const { fetchFbLeadDetails, getFbLeadConfig } = require('./facebookLeadAds');
const { getNextSalesRep } = require('./leadAssignment');
const { logLeadEventStrict } = require('./crm');

const LEAD_TYPES = new Set(['COURSE', 'CONSULTATION', 'GENERAL']);

function leadFields(detail = {}) {
  const result = { name: '', phone: '', email: null };
  for (const field of detail.field_data || []) {
    const value = (field.values || [])[0] || '';
    const key = String(field.name || '').toLowerCase();
    if (key === 'full_name' || key === 'name') result.name = value;
    else if (key === 'phone_number' || key === 'phone') result.phone = value;
    else if (key === 'email') result.email = value;
  }
  return result;
}

async function processFacebookLeadEvent({ event, payload }, dependencies = {}) {
  const db = dependencies.pool || pool;
  const tenantId = event.tenant_id;
  const config = await (dependencies.getConfig || getFbLeadConfig)(tenantId);
  const pageAccessToken = config.pageAccessToken || process.env.FB_PAGE_TOKEN;
  let imported = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = String(change.value?.leadgen_id || '');
      const pageId = String(change.value?.page_id || '');
      if (!leadgenId || !pageId) continue;
      let fields = { name: `Facebook Lead #${leadgenId}`, phone: '', email: null };
      if (pageAccessToken) {
        const detail = await (dependencies.fetchDetails || fetchFbLeadDetails)(leadgenId, pageAccessToken);
        fields = { ...fields, ...leadFields(detail) };
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const leadId = `lead-fb-${leadgenId}`;
        const [[existing]] = await conn.query(
          'SELECT id FROM leads WHERE tenant_id=? AND (id=? OR fb_lead_id=?) LIMIT 1 FOR UPDATE',
          [tenantId, leadId, leadgenId]
        );
        if (existing) {
          await conn.commit();
          continue;
        }
        const branch = String(config.defaultBranch || '').toUpperCase() || null;
        let representative = null;
        if (config.defaultAssignedSalesId) {
          const [[configured]] = await conn.query(
            'SELECT id,name FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
            [tenantId, config.defaultAssignedSalesId]
          );
          representative = configured || null;
        }
        if (!representative) {
          representative = await (dependencies.assignSales || getNextSalesRep)(tenantId, conn, { branch });
        }
        const leadType = String(config.defaultLeadType || 'GENERAL').toUpperCase();
        const clientCode = await getNextClientCode(conn);
        const courseIds = config.defaultInterestedCourseId
          ? JSON.stringify([config.defaultInterestedCourseId])
          : null;
        await conn.query(
          `INSERT INTO leads
             (id,tenant_id,client_code,name,email,phone,source,status,interest_level,lead_type,
              branch,branch_id,interested_course_ids_json,notes,assigned_sales_id,
              assigned_sales_name,fb_lead_id,fb_form_id,hidden,created_at)
           VALUES (?,?,?,?,?,?,'facebook',?,'HIGH',?,?,?,?, '',?,?,?,?,0,NOW())`,
          [
            leadId, tenantId, clientCode, fields.name, fields.email, fields.phone,
            String(config.defaultStatus || 'new').toLowerCase(),
            LEAD_TYPES.has(leadType) ? leadType : 'GENERAL',
            branch, branchIdForBranch(branch), courseIds,
            representative?.id || null, representative?.name || null,
            leadgenId, String(change.value?.form_id || '') || null,
          ]
        );
        await logLeadEventStrict(
          leadId, 'created', 'Lead imported from Facebook Lead Ads',
          { provider: 'facebook', externalLeadId: leadgenId, pageId, connectorEventId: event.id },
          tenantId, conn
        );
        await conn.commit();
        imported += 1;
      } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
      } finally {
        conn.release();
      }
    }
  }
  return { imported };
}

module.exports = { LEAD_TYPES, leadFields, processFacebookLeadEvent };
