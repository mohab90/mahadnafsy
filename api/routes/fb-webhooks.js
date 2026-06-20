'use strict';
const logger = require('../lib/logger');
const crypto = require('crypto');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { logLeadEvent } = require('../lib/crm');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getNextClientCode } = require('../lib/mappers');
const { createNotification } = require('../lib/notification');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'mahad_fb_verify_2024';

// ── Facebook Lead Ads Webhook ─────────────────────────────────────────────────
if (!process.env.FB_VERIFY_TOKEN) logger.warn('[FB] FB_VERIFY_TOKEN not set — using built-in default token');

/** Fetch Facebook Lead Ads config from site_config */
async function getFbLeadConfig() {
  const [rows] = await pool.query("SELECT `key`, `value` FROM site_config WHERE `key` IN ('facebook_lead_ads', 'settings')");
  let cfg = {};
  for (const row of rows) {
    const data = tryJson(row.value, {});
    if (row.key === 'facebook_lead_ads') {
      Object.assign(cfg, data);
    } else if (row.key === 'settings' && data.fbLeadAdsConfig) {
      const fb = data.fbLeadAdsConfig;
      if (fb.defaultInterestedCourseId && !cfg.defaultInterestedCourseId) cfg.defaultInterestedCourseId = fb.defaultInterestedCourseId;
      if (fb.defaultBranch && !cfg.defaultBranch) cfg.defaultBranch = fb.defaultBranch;
      if (fb.defaultAssignedSalesId && !cfg.defaultAssignedSalesId) cfg.defaultAssignedSalesId = fb.defaultAssignedSalesId;
    }
  }
  return cfg;
}

/** Fetch full lead details from Facebook Graph API */
async function fetchFbLeadDetails(leadgenId, pageAccessToken) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${pageAccessToken}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FB Graph API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

/** Round-robin: get next sales rep ID */
async function getNextSalesRep() {
  const [reps] = await pool.execute(
    `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`
  );
  if (!reps.length) return null;
  // Pick rep with fewest assigned leads
  const [counts] = await pool.execute(
    `SELECT assigned_sales_id, COUNT(*) as cnt FROM leads WHERE hidden=0 AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`
  );
  const countMap = {};
  for (const c of counts) countMap[c.assigned_sales_id] = Number(c.cnt);
  // Sort reps by load ascending
  reps.sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0));
  return reps[0];
}


// GET /api/webhooks/facebook-leads  — verification handshake
router.get('/api/webhooks/facebook-leads', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    logger.info('✅ Facebook webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Verification failed' });
  }
});

// POST /api/webhooks/facebook-leads — receive lead data
router.post('/api/webhooks/facebook-leads', async (req, res) => {
  // Verify X-Hub-Signature-256 if FB_APP_SECRET is configured
  const FB_APP_SECRET = process.env.FB_APP_SECRET;
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
    res.sendStatus(200); // Acknowledge immediately
    const body = req.body;
    if (body.object !== 'page') return;

    const fbConfig = await getFbLeadConfig();
    const pageAccessToken = fbConfig.pageAccessToken || process.env.FB_PAGE_TOKEN;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        const pageId = change.value?.page_id;
        if (!leadgenId || !pageId) continue;

        const id = `lead-fb-${leadgenId}`;
        // Skip duplicates
        const [existing] = await pool.execute(`SELECT id FROM leads WHERE id=?`, [id]);
        if (existing.length > 0) continue;

        // Fetch full lead details from FB Graph API
        let name = `Facebook Lead #${leadgenId}`;
        let phone = '';
        let email = null;
        let rawFields = {};

        if (pageAccessToken) {
          try {
            const fbLead = await fetchFbLeadDetails(leadgenId, pageAccessToken);
            rawFields = fbLead;
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

        // Auto-assign: use configured default sales rep, otherwise round-robin
        let rep = null;
        if (fbConfig.defaultAssignedSalesId) {
          const [repRows] = await pool.execute(`SELECT id, name FROM staff WHERE id=? AND is_active=1`, [fbConfig.defaultAssignedSalesId]);
          if (repRows.length) rep = repRows[0];
        }
        if (!rep) rep = await getNextSalesRep();

        const branchVal = fbConfig.defaultBranch ? fbConfig.defaultBranch.toUpperCase() : null;
        const interestCourseIds = fbConfig.defaultInterestedCourseId ? JSON.stringify([fbConfig.defaultInterestedCourseId]) : null;

        // Assign sequential client code
        let fbCode = null;
        const fbConn = await pool.getConnection();
        try { fbCode = await getNextClientCode(fbConn); } catch (_) {} finally { fbConn.release(); }

        await pool.execute(
          `INSERT INTO leads (id, client_code, name, email, phone, source, status, interest_level, lead_type, branch, interested_course_ids_json, notes, assigned_sales_id, assigned_sales_name, hidden, created_at)
           VALUES (?, ?, ?, ?, ?, 'facebook', ?, 'high', ?, ?, ?, '', ?, ?, 0, NOW())`,
          [
            id, fbCode, name, email || null, phone,
            (fbConfig.defaultStatus || 'new').toLowerCase(),
            fbConfig.defaultLeadType || 'general',
            branchVal,
            interestCourseIds,
            rep ? rep.id : null,
            rep ? rep.name : null,
          ]
        );
        logger.info(`📥 FB lead saved: ${name} | ${phone} | branch=${branchVal} | course=${fbConfig.defaultInterestedCourseId||'none'} | assigned→${rep?.name || 'unassigned'}`);
      }
    }
  } catch (e) { logger.error('FB webhook error:', e.message); }
});

// ── Static frontend serving (when STATIC_DIR env is set — single-domain mode) ──
// All /api/* routes that didn't match fall through and get a 404 here.
// Everything else serves index.html so React Router handles client-side routes.
const _STATIC_DIR = process.env.STATIC_DIR || null;
if (_STATIC_DIR) {
  router.use(express.static(_STATIC_DIR));
}


module.exports = router;
// Shared by whatsapp-admin.js (reads the same FB Lead Ads config from site_config).
module.exports.getFbLeadConfig = getFbLeadConfig;
