'use strict';
/**
 * Managing sending identities.
 *
 * Two audiences with deliberately different powers:
 *   • an admin manages the company's channels and can see every staff channel's
 *     state (connected / erroring / how much of today's budget is spent)
 *   • a staff member manages exactly one thing: their own WhatsApp
 *
 * A staff member must never be able to read or write another's credentials, so
 * every /me/ route is scoped by the caller's own staff id rather than by an id
 * in the URL.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'messaging-channels' });
const { pool } = require('../lib/db');
const channels = require('../lib/messagingChannels');
const { sendWhatsApp } = require('../lib/whatsapp');
const { verifyMessengerCredentials } = require('../lib/messenger');
const { verifyWapilot, listWapilotInstances } = require('../lib/whatsappWapilot');
const { toDialable } = require('../lib/phoneNumber');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_settings')];
const view = [requireAuth, requireAdminOrStaff, requirePermission('view_dashboard')];
// Self-scoped routes still name a permission: view_dashboard is the baseline
// every staff member holds, and an unnamed staff route is exactly what the
// permission matrix exists to catch.
const selfChannel = [requireAuth, requireAdminOrStaff, requirePermission('view_dashboard')];

function fail(res, error, message) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

/** The caller's own staff id — the only identity a /me/ route may act on. */
function selfStaffId(req) {
  return req.staffRecord?.id || null;
}

// ── Admin: every channel ─────────────────────────────────────────────────────

router.get('/api/admin/messaging/channels', ...view, async (req, res) => {
  try {
    const list = await channels.listChannels({
      tenantId: req.tenantId,
      kind: req.query.kind || null,
    });
    // Staff names, so the admin sees "واتساب أحمد" rather than a uuid.
    const staffIds = [...new Set(list.map(c => c.owner_staff_id).filter(Boolean))];
    let names = {};
    if (staffIds.length) {
      const [rows] = await pool.query(
        `SELECT id, name FROM staff WHERE tenant_id=? AND id IN (${staffIds.map(() => '?').join(',')})`,
        [req.tenantId, ...staffIds]
      );
      names = Object.fromEntries(rows.map(r => [r.id, r.name]));
    }
    res.json(list.map(c => ({ ...c, ownerName: c.owner_staff_id ? (names[c.owner_staff_id] || null) : null })));
  } catch (error) { fail(res, error, 'channel list failed'); }
});

router.post('/api/admin/messaging/channels', ...manage, async (req, res) => {
  try {
    const { kind, provider, label, displayNumber, credentials, ownerStaffId, dailySendLimit, makeDefault } = req.body || {};
    const channel = await channels.createChannel({
      tenantId: req.tenantId,
      kind, provider, label, displayNumber, credentials,
      ownerStaffId: ownerStaffId || null,
      dailySendLimit,
      makeDefault: Boolean(makeDefault),
      createdBy: req.user?.email || req.staffRecord?.name || 'admin',
    });
    // A freshly-saved channel used to sit at status='pending' until someone
    // separately remembered to press "اختبار الاتصال" — and getSendableChannel's
    // default-channel lookup only ever considers status='connected' ones, so a
    // channel could go unused for hours (this one did — created 2026-08-04
    // 22:08, the underlying Wapilot session was WORKING the whole time, but
    // every OTP/notification send silently found no sendable default channel
    // until a manual test call the next morning finally verified it). Testing
    // what was just entered, right when it's entered, closes that window —
    // it is not "trusting saved credentials without proof" (the thing the
    // pending-by-default design was guarding against): it's the exact same
    // live-session check the manual test button runs, just no longer
    // dependent on someone remembering to click it.
    if (kind === 'whatsapp' && provider === 'wapilot' && credentials) {
      const check = await verifyWapilot(credentials);
      if (check.ok) {
        await channels.markChannelConnected(req.tenantId, channel.id, pool, check.number);
      } else {
        await channels.markChannelError(req.tenantId, channel.id,
          typeof check.reason === 'string' ? check.reason : 'تعذّر التحقق من الجلسة عند الحفظ');
      }
    }
    const fresh = await channels.getChannelById(req.tenantId, channel.id);
    res.status(201).json(fresh || channel);
  } catch (error) { fail(res, error, 'channel create failed'); }
});

router.patch('/api/admin/messaging/channels/:id', ...manage, async (req, res) => {
  try {
    const existing = await channels.getChannelById(req.tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'القناة غير موجودة' });
    const updated = await channels.updateChannel(req.tenantId, req.params.id, req.body || {});
    res.json(updated);
  } catch (error) { fail(res, error, 'channel update failed'); }
});

router.post('/api/admin/messaging/channels/:id/default', ...manage, async (req, res) => {
  try {
    const existing = await channels.getChannelById(req.tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'القناة غير موجودة' });
    if (existing.owner_staff_id) {
      return res.status(409).json({ error: 'قناة موظف لا تصلح كقناة افتراضية للشركة' });
    }
    res.json(await channels.setDefaultChannel(req.tenantId, req.params.id, existing.kind));
  } catch (error) { fail(res, error, 'channel default failed'); }
});

router.delete('/api/admin/messaging/channels/:id', ...manage, async (req, res) => {
  try {
    const removed = await channels.deleteChannel(req.tenantId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'القناة غير موجودة' });
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'channel delete failed'); }
});

/**
 * POST /api/admin/messaging/wapilot/instances — what this key can see.
 *
 * Lets the admin pick an instance rather than typing its unique name, which is
 * a string like "instance5000" that is easy to get subtly wrong and produces a
 * channel that verifies as broken for no visible reason.
 *
 * POST rather than GET because the key travels in the body — a key in a query
 * string ends up in access logs.
 */
router.post('/api/admin/messaging/wapilot/instances', ...manage, bulkOperationLimiter, async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'مفتاح الـAPI مطلوب' });
    const result = await listWapilotInstances(apiKey);
    if (!result.ok) {
      return res.status(502).json({
        error: 'المفتاح مرفوض من Wapilot',
        reason: typeof result.reason === 'string' ? result.reason : undefined,
      });
    }
    res.json({ ok: true, instances: result.instances });
  } catch (error) { fail(res, error, 'wapilot instances failed'); }
});

// ── Staff: my own WhatsApp ───────────────────────────────────────────────────

router.get('/api/staff/me/whatsapp-channel', ...selfChannel, async (req, res) => {
  try {
    const staffId = selfStaffId(req);
    if (!staffId) return res.status(403).json({ error: 'حساب موظف مطلوب' });
    const [mine] = await channels.listChannels({
      tenantId: req.tenantId, kind: 'whatsapp', ownerStaffId: staffId,
    });
    res.json(mine || null);
  } catch (error) { fail(res, error, 'my channel fetch failed'); }
});

/**
 * Connect (or reconnect) my own WhatsApp.
 *
 * Deliberately upsert-shaped: a rep whose credentials expired reconnects by
 * saving again, which is what they will actually try to do. The unique index on
 * (tenant, owner, kind) is what makes that safe.
 */
router.put('/api/staff/me/whatsapp-channel', ...selfChannel, async (req, res) => {
  try {
    const staffId = selfStaffId(req);
    if (!staffId) return res.status(403).json({ error: 'حساب موظف مطلوب' });
    const { provider, label, displayNumber, credentials } = req.body || {};
    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ error: 'بيانات الاتصال مطلوبة' });
    }

    const [existing] = await channels.listChannels({
      tenantId: req.tenantId, kind: 'whatsapp', ownerStaffId: staffId,
    });
    const saved = existing
      ? await channels.updateChannel(req.tenantId, existing.id, {
        label: label || existing.label, displayNumber, credentials,
      })
      : await channels.createChannel({
        tenantId: req.tenantId, kind: 'whatsapp',
        provider: provider || 'green-api',
        ownerStaffId: staffId,
        label: label || `واتساب ${req.staffRecord?.name || 'موظف'}`,
        displayNumber, credentials,
        createdBy: req.user?.email || null,
      });
    res.json(saved);
  } catch (error) { fail(res, error, 'my channel save failed'); }
});

router.delete('/api/staff/me/whatsapp-channel', ...selfChannel, async (req, res) => {
  try {
    const staffId = selfStaffId(req);
    if (!staffId) return res.status(403).json({ error: 'حساب موظف مطلوب' });
    const [existing] = await channels.listChannels({
      tenantId: req.tenantId, kind: 'whatsapp', ownerStaffId: staffId,
    });
    if (!existing) return res.status(404).json({ error: 'لا توجد قناة مرتبطة' });
    await channels.deleteChannel(req.tenantId, existing.id);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'my channel delete failed'); }
});

/**
 * Send a test message to prove the credentials work.
 *
 * This is the only honest connection check: the provider's own "is my instance
 * up" endpoints differ between providers and lie about whether a *send* will be
 * accepted. Rate limited because it is a send.
 */
router.post('/api/messaging/channels/:id/test', requireAuth, requireAdminOrStaff, bulkOperationLimiter, async (req, res) => {
  try {
    const channel = await channels.getChannelById(req.tenantId, req.params.id);
    if (!channel) return res.status(404).json({ error: 'القناة غير موجودة' });

    // A staff member may only test their own channel; an admin may test any.
    const isAdmin = req.staffRecord?.role === 'ADMIN' || req.user?.role === 'admin';
    if (channel.owner_staff_id && channel.owner_staff_id !== selfStaffId(req) && !isAdmin) {
      return res.status(403).json({ error: 'غير مصرح باختبار قناة موظف آخر' });
    }
    // Messenger cannot be verified by sending: it has no addressable recipient
    // until a customer writes in first. Rejecting it here left a Messenger
    // channel stuck at 'pending' forever, and since sending requires
    // 'connected', it could never send at all. Ask Graph who the token belongs
    // to instead — the same proof, without messaging a stranger.
    if (channel.kind === 'messenger') {
      const resolved = await channels.getSendableChannel({
        tenantId: req.tenantId, channelId: channel.id, kind: 'messenger',
      });
      if (!resolved) return res.status(409).json({ error: 'بيانات الاتصال غير محفوظة' });
      const check = await verifyMessengerCredentials(resolved.credentials);
      if (!check.ok) {
        await channels.markChannelError(req.tenantId, channel.id,
          typeof check.reason === 'string' ? check.reason : 'تعذّر التحقق من التوكن');
        return res.status(502).json({
          error: 'التوكن مرفوض من فيسبوك — راجع بيانات الصفحة',
          reason: typeof check.reason === 'string' ? check.reason : undefined,
        });
      }
      await channels.markChannelConnected(req.tenantId, channel.id);
      return res.json({ ok: true, pageName: check.pageName || null });
    }

    // Wapilot exposes a real session-status endpoint, so a channel can be proven
    // live without messaging anyone. That is strictly better than a test send:
    // it also catches a session that is logged out but still configured, which a
    // send would only reveal by failing at the customer's expense.
    if (channel.provider === 'wapilot') {
      const resolved = await channels.getSendableChannel({
        tenantId: req.tenantId, channelId: channel.id, kind: 'whatsapp',
      });
      if (!resolved) return res.status(409).json({ error: 'بيانات الاتصال غير محفوظة' });
      const check = await verifyWapilot(resolved.credentials);
      if (!check.ok) {
        await channels.markChannelError(req.tenantId, channel.id,
          typeof check.reason === 'string' ? check.reason : 'تعذّر التحقق من الجلسة');
        return res.status(502).json({
          error: 'الجلسة مش شغالة — راجع النسخة في لوحة Wapilot',
          reason: typeof check.reason === 'string' ? check.reason : undefined,
        });
      }
      await channels.markChannelConnected(req.tenantId, channel.id, pool, check.number);
      return res.json({ ok: true, sessionStatus: check.status, number: check.number, name: check.name });
    }

    const to = toDialable(req.body?.to || channel.display_number);
    if (!to) return res.status(400).json({ error: 'أدخل رقماً صالحاً للاختبار' });

    const result = await sendWhatsApp(
      to,
      req.body?.message || 'رسالة اختبار من منصة معهد الدراسات النفسية ✅',
      { tenantId: req.tenantId, channelId: channel.id }
    );
    if (!result.ok) {
      return res.status(502).json({
        error: 'لم يتم الإرسال — راجع بيانات الاتصال',
        reason: typeof result.reason === 'string' ? result.reason : undefined,
      });
    }
    res.json({ ok: true, messageId: result.idMessage || null });
  } catch (error) { fail(res, error, 'channel test failed'); }
});

module.exports = router;
