'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'facebook-leads-webhook-route' });
const { pool } = require('../lib/db');
const { getNextClientCode } = require('../lib/mappers');
const { branchIdForBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { fetchFbLeadDetails, getFbLeadConfig } = require('../lib/facebookLeadAds');
const { getNextSalesRep } = require('../lib/leadAssignment');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

router.get('/api/webhooks/facebook-leads', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const fbConfig = await getFbLeadConfig(scopedTenantId(req)).catch(() => ({}));
  const verifyToken = fbConfig.verifyToken || FB_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('✅ Facebook webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Verification failed' });
  }
});

router.post('/api/webhooks/facebook-leads', async (req, res) => {
  const tenantId = scopedTenantId(req);
  const fbConfig = await getFbLeadConfig(tenantId).catch(() => ({}));
  const FB_APP_SECRET = fbConfig.appSecret || process.env.FB_APP_SECRET;
  if (FB_APP_SECRET) {
    const sigHeader = (req.headers['x-hub-signature-256'] || '').toString();
    if (!sigHeader) {
      logger.warn('[FB] Missing X-Hub-Signature-256 — rejecting webhook');
      return res.sendStatus(403);
    }
    const expectedSig = 'sha256=' + crypto.createHmac('sha256', FB_APP_SECRET)
      .update(req.rawBody || Buffer.alloc(0)).digest('hex');
    let valid = false;
    try {
      const a = Buffer.from(sigHeader);
      const b = Buffer.from(expectedSig);
      valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { valid = false; }
    if (!valid) {
      logger.warn('[FB] Invalid X-Hub-Signature-256 — rejecting webhook');
      return res.sendStatus(403);
    }
  }
  try {
    res.sendStatus(200);
    const body = req.body;
    if (body.object !== 'page') return;

    const pageAccessToken = fbConfig.pageAccessToken || process.env.FB_PAGE_TOKEN;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        const pageId = change.value?.page_id;
        if (!leadgenId || !pageId) continue;

        const id = `lead-fb-${leadgenId}`;
        const [existing] = await pool.execute('SELECT id FROM leads WHERE tenant_id=? AND id=?', [tenantId, id]);
        if (existing.length > 0) continue;

        let name = `Facebook Lead #${leadgenId}`;
        let phone = '';
        let email = null;

        if (pageAccessToken) {
          try {
            const fbLead = await fetchFbLeadDetails(leadgenId, pageAccessToken);
            for (const f of (fbLead.field_data || [])) {
              const val = (f.values || [])[0] || '';
              const key = (f.name || '').toLowerCase();
              if (key === 'full_name' || key === 'name') name = val;
              else if (key === 'phone_number' || key === 'phone') phone = val;
              else if (key === 'email') email = val;
            }
          } catch (err) {
            logger.error('FB lead fetch error:', err.message);
          }
        }

        let rep = null;
        if (fbConfig.defaultAssignedSalesId) {
          const [repRows] = await pool.execute('SELECT id, name FROM staff WHERE tenant_id=? AND id=? AND is_active=1', [tenantId, fbConfig.defaultAssignedSalesId]);
          if (repRows.length) rep = repRows[0];
        }
        if (!rep) rep = await getNextSalesRep(tenantId);

        const branchVal = fbConfig.defaultBranch ? fbConfig.defaultBranch.toUpperCase() : null;
        const interestCourseIds = fbConfig.defaultInterestedCourseId ? JSON.stringify([fbConfig.defaultInterestedCourseId]) : null;

        let fbCode = null;
        const fbConn = await pool.getConnection();
        try { fbCode = await getNextClientCode(fbConn); } catch (_) {} finally { fbConn.release(); }

        await pool.execute(
          `INSERT INTO leads (id, tenant_id, client_code, name, email, phone, source, status, interest_level, lead_type, branch, branch_id, interested_course_ids_json, notes, assigned_sales_id, assigned_sales_name, hidden, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'facebook', ?, 'high', ?, ?, ?, ?, '', ?, ?, 0, NOW())`,
          [
            id, tenantId, fbCode, name, email || null, phone,
            (fbConfig.defaultStatus || 'new').toLowerCase(),
            fbConfig.defaultLeadType || 'general',
            branchVal,
            branchIdForBranch(branchVal),
            interestCourseIds,
            rep ? rep.id : null,
            rep ? rep.name : null,
          ]
        );
        logger.info(`📥 FB lead saved: ${name} | ${phone} | branch=${branchVal} | course=${fbConfig.defaultInterestedCourseId || 'none'} | assigned→${rep?.name || 'unassigned'}`);
      }
    }
  } catch (e) { logger.error('FB webhook error:', e.message); }
});

module.exports = router;
