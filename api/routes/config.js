'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool, cacheInvalidate } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { loadRoleOverrides } = require('../lib/rbacOverrides');
const { loadTemplates } = require('../lib/messageTemplates');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { invalidateFxCache } = require('../lib/finance');
const { redactSecrets, preserveStoredSecrets } = require('../lib/configSecrets');
const { loadTenantContext } = require('../lib/tenantScope');
const { publicLimiter, aiLimiter } = require('../middleware/rateLimits');
const { generateAdminAi } = require('../lib/adminAi');
const { writeAuditEvent } = require('../lib/auditTrail');

function contentBranches(content) {
  if (!Object.prototype.hasOwnProperty.call(content, 'institute.branches')) return null;
  let value = content['institute.branches'];
  try { if (typeof value === 'string') value = JSON.parse(value); } catch (_) {
    throw Object.assign(new Error('institute.branches must contain valid JSON'), { status: 400 });
  }
  if (!Array.isArray(value)) throw Object.assign(new Error('institute.branches must be an array'), { status: 400 });
  const seen = new Set();
  return value.map(raw => {
    const branchKey = String(raw?.id || raw?.key || '').trim();
    const label = String(raw?.label || '').trim();
    if (!/^[a-z0-9_-]{1,120}$/i.test(branchKey) || !label || label.length > 255) {
      throw Object.assign(new Error('Each branch needs a valid id and label'), { status: 400 });
    }
    const normalized = branchKey.toLowerCase();
    if (seen.has(normalized)) throw Object.assign(new Error(`Duplicate branch id: ${branchKey}`), { status: 400 });
    seen.add(normalized);
    return {
      branchKey,
      slug: normalized.replace(/_+/g, '-'),
      label,
      type: ['online', 'physical', 'hybrid', 'other'].includes(raw?.branch_type)
        ? raw.branch_type
        : (normalized.includes('online') ? 'online' : 'physical'),
      // Usable for job postings / staff assignment but excluded from the
      // public "الفرع الأقرب" picker (filtered client-side on the same flag,
      // read straight off this same content['institute.branches'] list) —
      // distinct from `is_active`, which already gates whether a job posting
      // may reference the branch at all.
      internalOnly: raw?.internal_only === true,
    };
  });
}

async function saveContentAndBranchCatalog(req, content) {
  const branches = contentBranches(content);
  if (branches) {
    const context = await loadTenantContext(req.tenantId);
    const limit = Number(context.planLimits?.branches);
    if (Number.isInteger(limit) && limit >= 0 && branches.length > limit) {
      throw Object.assign(new Error(`Tenant plan branches quota exceeded (${branches.length}/${limit})`), {
        status: 409, code: 'PLAN_QUOTA_EXCEEDED',
      });
    }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await setTenantSetting('content', content, {
      tenantId: req.tenantId,
      actorId: req.user?.uid || req.user?.email,
      db: conn,
    });
    if (branches) {
      await conn.query('UPDATE branches SET is_active=0 WHERE tenant_id=?', [req.tenantId]);
      for (const branch of branches) {
        await conn.query(
          `INSERT INTO branches
             (id, tenant_id, branch_key, slug, label, branch_type, timezone, currency, is_active, internal_only)
           VALUES (?,?,?,?,?,?, 'Africa/Cairo', 'EGP', 1, ?)
           ON DUPLICATE KEY UPDATE
             branch_key=VALUES(branch_key), slug=VALUES(slug),
             label=VALUES(label), branch_type=VALUES(branch_type), is_active=1,
             internal_only=VALUES(internal_only)`,
          [uuidv4(), req.tenantId, branch.branchKey, branch.slug, branch.label, branch.type, branch.internalOnly ? 1 : 0]);
      }
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  if (branches) cacheInvalidate(`branches:${req.tenantId}`);
}

// Settings (adminAiConfig, aiAgentConfig, messagingChannels, fbLeadAdsConfig)
router.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(redactSecrets(await getTenantSetting('settings', { tenantId: req.tenantId, fallback: {} })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    // The frontend saves one section at a time (e.g. { adminAiConfig: {...} }),
    // so this must merge into the existing blob rather than replace it wholesale
    // — setTenantSetting itself does a full REPLACE of the stored JSON, and a
    // naive `setTenantSetting('settings', req.body, ...)` would silently wipe
    // every other section (aiAgentConfig/messagingChannels/fbLeadAdsConfig)
    // on every single save. preserveStoredSecrets also guards against a
    // client echoing back a redacted ('') secret field (from the masked GET
    // response) and overwriting the real stored value with a blank.
    await conn.beginTransaction();
    const existing = await getTenantSetting('settings', { tenantId: req.tenantId, fallback: {}, db: conn });
    const merged = { ...existing, ...preserveStoredSecrets(existing, req.body || {}) };
    await setTenantSetting('settings', merged, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email, db: conn });
    await writeAuditEvent({
      action: 'admin.settings.updated',
      entityType: 'tenant_settings',
      entityId: 'settings',
      metadata: { sections: Object.keys(req.body || {}).slice(0, 50) },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── Email settings (sender, SMTP, template) — Admin → Settings → البريد ──────
const { getEmailConfig, invalidateEmailConfig } = require('../lib/email');

// GET current email config (password masked — never sent to the browser).
router.get('/api/admin/settings/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = await getEmailConfig(req.tenantId);
    res.json({ ...c, smtpPass: c.smtpPass ? '********' : '' });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT email config. Merges into the saved blob; only overwrites the password when
// a real (non-masked, non-empty) value is supplied.
router.put('/api/admin/settings/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allowed = ['smtpHost','smtpPort','smtpUser','smtpPass','senderName','senderAddress','brandColor','headerTitle','headerSubtitle','logoUrl','footerText'];
    const current = await getTenantSetting('email_config', { tenantId: req.tenantId, fallback: {} });
    const next = { ...current };
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'smtpPass' && (!req.body[k] || req.body[k] === '********')) continue; // keep existing password
      next[k] = k === 'smtpPort' ? parseInt(req.body[k]) || 465 : req.body[k];
    }
    const senderAddress = String(next.senderAddress || '').trim().toLowerCase();
    if (senderAddress) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderAddress)) {
        return res.status(400).json({ error: 'Invalid sender email address' });
      }
      const senderDomain = senderAddress.split('@')[1];
      const smtpDomain = String(next.smtpUser || '').toLowerCase().split('@')[1] || '';
      const [[verifiedDomain]] = await pool.query(
        "SELECT domain FROM tenant_domains WHERE tenant_id=? AND status='verified' LIMIT 1",
        [req.tenantId]
      ).catch(() => [[null]]);
      if (senderDomain !== smtpDomain && senderDomain !== verifiedDomain?.domain) {
        return res.status(400).json({
          error: 'Sender address must use the SMTP account domain or the verified tenant domain',
          code: 'UNVERIFIED_SENDER_DOMAIN',
        });
      }
    }
    await setTenantSetting('email_config', next, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateEmailConfig(req.tenantId);
    res.json({ ok: true });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST send a test email to verify the configured SMTP end-to-end.
router.post('/api/admin/settings/email/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = req.body?.to;
    if (!to) return res.status(400).json({ error: 'البريد المُستلِم مطلوب' });
    const { sendEmail: sendEmailBase } = require('../lib/email');
    const sendEmail = (toAddress, subject, html) => sendEmailBase(toAddress, subject, html, { tenantId: req.tenantId });
    await sendEmail(to, 'اختبار البريد — معهد الدراسات النفسية', '<p>لو وصلتك الرسالة دي يبقى إعدادات البريد شغّالة ✅</p>');
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: 'فشل الإرسال: ' + e.message }); }
});

// ── Customer-journey (lifecycle) settings + activity ────────────────────────
const lifecycle = require('../lib/lifecycle');

router.get('/api/admin/settings/lifecycle', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await lifecycle.describe(req.tenantId)); }
  catch (e) { logger.error('[lifecycle-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/settings/lifecycle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const enabled = req.body.enabled !== false;
    const steps = (req.body.steps && typeof req.body.steps === 'object') ? req.body.steps : {};
    await setTenantSetting('lifecycle', { enabled, steps }, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    lifecycle.invalidateConfig(req.tenantId);
    res.json({ ok: true });
  } catch (e) { logger.error('[lifecycle-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Recent journey activity (outbox feed) — shows the automation is alive.
router.get('/api/admin/lifecycle/activity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT channel, recipient, subject, status, attempts, created_at, sent_at
       FROM message_outbox WHERE tenant_id=? ORDER BY created_at DESC LIMIT 60`,
      [req.tenantId]
    ).catch(() => [[]]);
    const [[counts]] = await pool.query(
      `SELECT SUM(status='pending') AS pending, SUM(status='sent') AS sent, SUM(status IN ('failed','dead')) AS failed FROM message_outbox WHERE tenant_id=?`,
      [req.tenantId]
    ).catch(() => [[{ pending: 0, sent: 0, failed: 0 }]]);
    res.json({ counts, recent: rows });
  } catch (e) { logger.error('[lifecycle-activity]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Certificate Auto-Issue Settings
router.get('/api/admin/settings/certificate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [progress, payment] = await Promise.all([
      getTenantSetting('cert_auto_threshold_progress', { tenantId: req.tenantId, fallback: 70 }),
      getTenantSetting('cert_auto_threshold_payment', { tenantId: req.tenantId, fallback: 90 }),
    ]);
    res.json({
      progress: Number(progress ?? 70),
      payment: Number(payment ?? 90),
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings/certificate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = Math.min(100, Math.max(0, parseFloat(req.body.progress) || 70));
    const pay = Math.min(100, Math.max(0, parseFloat(req.body.payment) || 90));
    await Promise.all([
      setTenantSetting('cert_auto_threshold_progress', p, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email }),
      setTenantSetting('cert_auto_threshold_payment', pay, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email }),
    ]);
    res.json({ ok: true, progress: p, payment: pay });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Site Content (key-value store)
router.get('/api/admin/content', requireAuth, requireAdminOrStaff, requirePermission('manage_content'), async (req, res) => {
  try {
    res.json(await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/content', requireAuth, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : null;
    if (!incoming) return res.status(400).json({ error: 'Body must be the full content object' });

    // ── Anti-wipe guard ──────────────────────────────────────────────────────
    // PUT REPLACES the whole content blob. A caller that accidentally sends a
    // PARTIAL object would erase every other setting (branding, payments, RBAC,
    // templates...). Reject suspiciously-small payloads — callers should send the
    // full object (use PATCH for partial merges).
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const existingKeys = Object.keys(existing).length;
    const incomingKeys = Object.keys(incoming).length;
    if (existingKeys > 5 && incomingKeys < Math.ceil(existingKeys * 0.6)) {
      logger.warn(`[content] PUT rejected: would shrink ${existingKeys}→${incomingKeys} keys (partial-wipe guard)`);
      return res.status(409).json({
        error: `Refused: PUT would drop ${existingKeys - incomingKeys} settings keys (${existingKeys}→${incomingKeys}). Send the full content object, or use PATCH for partial updates.`,
      });
    }

    await saveContentAndBranchCatalog(req, incoming);
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    loadRoleOverrides(req.tenantId).catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates(req.tenantId).catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.patch('/api/admin/content', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const merged = { ...existing, ...req.body };
    await saveContentAndBranchCatalog(req, merged);
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    loadRoleOverrides(req.tenantId).catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates(req.tenantId).catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// FX Rates refresh
router.post('/api/admin/fx-rates/refresh', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/EGP', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch FX rates' });
    const data = await response.json();
    if (!data.rates || !data.rates.SAR || !data.rates.USD) {
      return res.status(502).json({ error: 'Invalid FX response' });
    }
    const sar_to_egp = parseFloat((1 / data.rates.SAR).toFixed(4));
    const usd_to_egp = parseFloat((1 / data.rates.USD).toFixed(4));
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const updatedAt = new Date().toISOString();
    const merged = {
      ...existing,
      'exchange.sar_to_egp': String(sar_to_egp),
      'exchange.usd_to_egp': String(usd_to_egp),
      'exchange.source': 'open.er-api.com',
      'exchange.updated_at': updatedAt,
    };
    await setTenantSetting('content', merged, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    res.json({ ok: true, sar_to_egp, usd_to_egp, updatedAt });
  } catch (e) {
    logger.error('[fx-rates]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Discounts
router.get('/api/discounts', publicLimiter, async (req, res) => {
  try {
    const rules = await getTenantSetting('discounts', { tenantId: req.tenantId, fallback: [] });
    const now = Date.now();
    res.json((Array.isArray(rules) ? rules : []).filter(rule => (
      rule?.active !== false && (!rule?.expiresAt || Date.parse(rule.expiresAt) >= now)
    )));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/ai/generate', requireAuth, requireAdminOrStaff, requirePermission('ask_ai'), aiLimiter, async (req, res) => {
  try {
    const settings = await getTenantSetting('settings', { tenantId: req.tenantId, fallback: {} });
    await writeAuditEvent({
      action: 'admin_ai.generate',
      entityType: 'ai_provider_request',
      metadata: {
        provider: settings.adminAiConfig?.provider || null,
        model: settings.adminAiConfig?.model || null,
        messageCount: Array.isArray(req.body?.messages) ? req.body.messages.length : 0,
        systemPromptLength: String(req.body?.systemPrompt || '').length,
      },
      req,
    });
    const text = await generateAdminAi(settings.adminAiConfig, req.body || {});
    if (!text) return res.status(502).json({ error: 'AI provider returned an empty response' });
    res.json({ text });
  } catch (error) {
    const status = Number(error.status);
    if (status >= 400 && status < 500) return res.status(status).json({ error: error.message });
    logger.error('[admin-ai]', { tenantId: req.tenantId, message: error.message });
    res.status(502).json({ error: 'AI provider request failed' });
  }
});

router.get('/api/admin/discounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getTenantSetting('discounts', { tenantId: req.tenantId, fallback: [] }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/discounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('discounts', req.body || [], { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function customerNotificationViewer(req) {
  const email = String(req.user?.email || '').trim().toLowerCase();
  const uid = String(req.user?.uid || '').trim();
  const [[subscriber]] = await pool.query(
    `SELECT id FROM subscribers
      WHERE tenant_id=? AND deleted_at IS NULL
        AND (firebase_uid=? OR LOWER(TRIM(email))=?)
      LIMIT 1`,
    [req.tenantId, uid, email]
  );
  if (!subscriber) throw Object.assign(new Error('Subscriber account not found'), { status: 404 });
  return `subscriber:${subscriber.id}`;
}

function activeBroadcasts(items) {
  const now = Date.now();
  return (Array.isArray(items) ? items : []).filter(item => (
    item?.active !== false && (!item?.expiresAt || Date.parse(item.expiresAt) >= now)
  ));
}

// Notification Settings (site_config JSON blob, separate from system notifications table)
router.get('/api/notifications/broadcasts', requireAuth, async (req, res) => {
  try {
    const notifications = activeBroadcasts(await getTenantSetting('notifications', { tenantId: req.tenantId, fallback: [] }));
    const viewerKey = await customerNotificationViewer(req);
    const ids = notifications.map(item => String(item.id || '')).filter(id => id && id.length <= 36);
    let readIds = [];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [reads] = await pool.query(
        `SELECT notification_id FROM notification_reads
          WHERE tenant_id=? AND viewer_key=? AND notification_id IN (${placeholders})`,
        [req.tenantId, viewerKey, ...ids]
      );
      readIds = reads.map(row => row.notification_id);
    }
    res.json({ notifications, readIds });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  }
});

router.patch('/api/notifications/broadcasts/:id/read', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 36) return res.status(400).json({ error: 'Invalid notification id' });
    const notifications = activeBroadcasts(await getTenantSetting('notifications', { tenantId: req.tenantId, fallback: [] }));
    if (!notifications.some(item => String(item.id) === id)) return res.status(404).json({ error: 'Notification not found' });
    const viewerKey = await customerNotificationViewer(req);
    await pool.query(
      `INSERT INTO notification_reads (notification_id, tenant_id, viewer_key, read_at)
       VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
      [id, req.tenantId, viewerKey]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  }
});

router.patch('/api/notifications/broadcasts/read-all', requireAuth, async (req, res) => {
  try {
    const notifications = activeBroadcasts(await getTenantSetting('notifications', { tenantId: req.tenantId, fallback: [] }));
    const ids = [...new Set(notifications.map(item => String(item.id || '')).filter(id => id && id.length <= 36))];
    if (!ids.length) return res.json({ ok: true });
    const viewerKey = await customerNotificationViewer(req);
    const values = ids.map(() => '(?,?,?,NOW())').join(',');
    await pool.query(
      `INSERT INTO notification_reads (notification_id, tenant_id, viewer_key, read_at)
       VALUES ${values} ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
      ids.flatMap(id => [id, req.tenantId, viewerKey])
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  }
});

router.get('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getTenantSetting('notifications', { tenantId: req.tenantId, fallback: [] }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('notifications', req.body || [], { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
