'use strict';
/**
 * WhatsApp marketing campaigns.
 *
 * The important route here is the dry run. A WhatsApp blast cannot be recalled
 * and a bad one costs the number its reputation, so the composer can always ask
 * "who exactly would receive this, and who wouldn't, and why" before committing
 * — and the preview is computed by the same function the send uses, so the two
 * can never disagree.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'whatsapp-campaigns' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { tryJson } = require('../lib/helpers');
const campaigns = require('../lib/whatsappCampaigns');
const channelsLib = require('../lib/messagingChannels');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_dashboard')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_settings')];

function fail(res, error, message) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

const COLUMNS = `id, name, message_template, channel_id, audience, audience_filter,
  throttle_per_minute, status, scheduled_at, sent_at, recipient_count, sent_count,
  fail_count, skipped_count, created_by, created_at, updated_at`;

router.get('/api/admin/whatsapp-campaigns', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${COLUMNS} FROM whatsapp_campaigns WHERE tenant_id=?
        ORDER BY created_at DESC LIMIT 200`, [req.tenantId]
    );
    res.json(rows.map(row => ({
      ...row,
      audience_filter: tryJson(row.audience_filter, {}),
      variables: campaigns.templateVariables(row.message_template),
    })));
  } catch (error) { fail(res, error, 'campaign list failed'); }
});

router.post('/api/admin/whatsapp-campaigns', ...manage, async (req, res) => {
  try {
    const { name, messageTemplate, audience, audienceFilter, channelId, throttlePerMinute, scheduledAt } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'اسم الحملة مطلوب' });
    if (!String(messageTemplate || '').trim()) return res.status(400).json({ error: 'نص الرسالة مطلوب' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO whatsapp_campaigns
         (id, tenant_id, name, message_template, channel_id, audience, audience_filter,
          throttle_per_minute, scheduled_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, String(name).trim().slice(0, 200), String(messageTemplate).trim(),
        channelId || null,
        ['leads', 'subscribers', 'all', 'manual', 'segment'].includes(audience) ? audience : 'leads',
        audienceFilter ? JSON.stringify(audienceFilter) : null,
        Math.max(campaigns.MIN_THROTTLE, Math.min(Number(throttlePerMinute) || 60, campaigns.MAX_THROTTLE)),
        scheduledAt || null,
        req.user?.email || req.staffRecord?.name || 'admin',
      ]
    );
    const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM whatsapp_campaigns WHERE id=? AND tenant_id=?`, [id, req.tenantId]);
    res.status(201).json({ ...row, audience_filter: tryJson(row.audience_filter, {}) });
  } catch (error) { fail(res, error, 'campaign create failed'); }
});

router.patch('/api/admin/whatsapp-campaigns/:id', ...manage, async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      'SELECT id, status FROM whatsapp_campaigns WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!existing) return res.status(404).json({ error: 'الحملة غير موجودة' });
    // Editing a campaign mid-flight would mean some recipients got the old text
    // and some the new one, with no record of which.
    if (!['draft', 'scheduled', 'failed'].includes(existing.status)) {
      return res.status(409).json({ error: 'لا يمكن تعديل حملة بدأ إرسالها' });
    }
    const { name, messageTemplate, audience, audienceFilter, channelId, throttlePerMinute, scheduledAt } = req.body || {};
    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push('name=?'); params.push(String(name).trim().slice(0, 200)); }
    if (messageTemplate !== undefined) { sets.push('message_template=?'); params.push(String(messageTemplate).trim()); }
    if (audience !== undefined) { sets.push('audience=?'); params.push(audience); }
    if (audienceFilter !== undefined) { sets.push('audience_filter=?'); params.push(audienceFilter ? JSON.stringify(audienceFilter) : null); }
    if (channelId !== undefined) { sets.push('channel_id=?'); params.push(channelId || null); }
    if (throttlePerMinute !== undefined) {
      sets.push('throttle_per_minute=?');
      params.push(Math.max(campaigns.MIN_THROTTLE, Math.min(Number(throttlePerMinute) || 60, campaigns.MAX_THROTTLE)));
    }
    if (scheduledAt !== undefined) { sets.push('scheduled_at=?'); params.push(scheduledAt || null); }
    if (!sets.length) return res.json({ ok: true, unchanged: true });
    params.push(req.params.id, req.tenantId);
    await pool.query(`UPDATE whatsapp_campaigns SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, params);
    const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM whatsapp_campaigns WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
    res.json({ ...row, audience_filter: tryJson(row.audience_filter, {}) });
  } catch (error) { fail(res, error, 'campaign update failed'); }
});

router.delete('/api/admin/whatsapp-campaigns/:id', ...manage, async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM whatsapp_campaigns WHERE id=? AND tenant_id=? AND status IN ('draft','scheduled','cancelled','failed')",
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(409).json({ error: 'لا يمكن حذف حملة تم إرسالها' });
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'campaign delete failed'); }
});

/**
 * Dry run: exactly who would receive this, and who would not.
 * Costs nothing and sends nothing — this is what makes a blast reviewable.
 */
router.post('/api/admin/whatsapp-campaigns/:id/preview', ...view, bulkOperationLimiter, async (req, res) => {
  try {
    const [[campaign]] = await pool.query(
      `SELECT ${COLUMNS} FROM whatsapp_campaigns WHERE id=? AND tenant_id=? LIMIT 1`,
      [req.params.id, req.tenantId]
    );
    if (!campaign) return res.status(404).json({ error: 'الحملة غير موجودة' });

    const { recipients, skipped, capReached } = await campaigns.buildAudience({
      tenantId: req.tenantId,
      audience: campaign.audience,
      filter: tryJson(campaign.audience_filter, {}),
    });

    const perMinute = campaign.throttle_per_minute || 60;
    res.json({
      recipientCount: recipients.length,
      skippedCount: skipped.length,
      capReached,
      estimatedMinutes: Math.ceil(recipients.length / perMinute),
      // A handful of rendered examples — enough to catch a broken placeholder
      // without shipping the whole customer list into the browser.
      samples: recipients.slice(0, 5).map(person => ({
        name: person.name,
        phone: person.dialable,
        message: campaigns.renderTemplate(campaign.message_template, {
          name: person.name || '', clientCode: person.client_code || '', status: person.status || '',
        }),
      })),
      skipReasons: skipped.slice(0, 20).map(s => ({ name: s.name, phone: s.phone, reason: s.reason })),
    });
  } catch (error) { fail(res, error, 'campaign preview failed'); }
});

/** Queue it. Paced by the outbox; nothing is sent inline. */
router.post('/api/admin/whatsapp-campaigns/:id/send', ...manage, bulkOperationLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[campaign]] = await conn.query(
      `SELECT ${COLUMNS} FROM whatsapp_campaigns WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!campaign) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'الحملة غير موجودة' }); }
    // FOR UPDATE plus this check is what stops a double-clicked send from
    // queueing the campaign twice.
    if (!['draft', 'scheduled', 'failed'].includes(campaign.status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'الحملة قيد الإرسال أو تم إرسالها' });
    }

    // Refuse rather than fall back: an admin who picked a rep's WhatsApp and got
    // the company number instead would only find out from a customer.
    if (campaign.channel_id) {
      const channel = await channelsLib.getChannelById(req.tenantId, campaign.channel_id, conn);
      if (!channel || !channel.is_active || channel.status !== 'connected') {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({ error: 'القناة المختارة غير متصلة — اختبرها أولاً' });
      }
    }

    const { recipients, skipped } = await campaigns.buildAudience({
      tenantId: req.tenantId,
      audience: campaign.audience,
      filter: tryJson(campaign.audience_filter, {}),
    }, conn);

    if (!recipients.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يوجد مستقبلون لهذه الحملة', skippedCount: skipped.length });
    }

    const { queued, estimatedMinutes } = await campaigns.queueCampaign({
      tenantId: req.tenantId, campaign, recipients, channelId: campaign.channel_id,
    }, conn);
    await campaigns.recordSkipped({ tenantId: req.tenantId, campaignId: campaign.id, skipped }, conn);

    await conn.query(
      `UPDATE whatsapp_campaigns
          SET status='sending', recipient_count=?, skipped_count=?, sent_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [queued, skipped.length, campaign.id, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, queued, skipped: skipped.length, estimatedMinutes });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    fail(res, error, 'campaign send failed');
  } finally { conn.release(); }
});

/** Stop a campaign mid-flight — the pacing is what makes this useful. */
router.post('/api/admin/whatsapp-campaigns/:id/cancel', ...manage, async (req, res) => {
  try {
    const [[campaign]] = await pool.query(
      'SELECT id, status FROM whatsapp_campaigns WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!campaign) return res.status(404).json({ error: 'الحملة غير موجودة' });
    if (campaign.status !== 'sending' && campaign.status !== 'scheduled') {
      return res.status(409).json({ error: 'لا يوجد إرسال جارٍ لإيقافه' });
    }
    // Only messages that have not gone out yet. Anything already delivered
    // cannot be recalled, and pretending otherwise would misreport the result.
    const [stopped] = await pool.query(
      `UPDATE message_outbox SET status='dead', last_error='أُلغيت الحملة'
        WHERE tenant_id=? AND ref_type='whatsapp_campaign' AND ref_id=? AND status='pending'`,
      [req.tenantId, campaign.id]
    );
    await pool.query(
      "UPDATE whatsapp_campaigns SET status='cancelled' WHERE id=? AND tenant_id=?",
      [campaign.id, req.tenantId]
    );
    res.json({ ok: true, stopped: stopped.affectedRows });
  } catch (error) { fail(res, error, 'campaign cancel failed'); }
});

/** Per-recipient outcome — answers "why didn't Ahmed get it?". */
router.get('/api/admin/whatsapp-campaigns/:id/recipients', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.subject_type, r.subject_id, r.phone, r.name, r.status, r.skip_reason,
              o.status AS delivery_status, o.delivery_status AS provider_status, o.last_error
         FROM whatsapp_campaign_recipients r
         LEFT JOIN message_outbox o ON o.id = r.outbox_id
        WHERE r.tenant_id=? AND r.campaign_id=?
        ORDER BY r.status, r.created_at LIMIT 2000`,
      [req.tenantId, req.params.id]
    );
    res.json(rows);
  } catch (error) { fail(res, error, 'campaign recipients failed'); }
});

module.exports = router;
