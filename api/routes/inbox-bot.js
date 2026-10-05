'use strict';
/**
 * The inbox bot's settings, a console to try it, and what it knows
 * (lib/inboxBot.js). On manage_channel_settings, like the channels it answers on.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'inbox-bot-route' });
const { pool } = require('../lib/db');
const { getTenantSetting } = require('../lib/tenantSettings');
const { resolveAiConfig } = require('../lib/adminAi');
const { loadSettings, saveSettings, normalizeSettings, composeReply, buildKnowledge } = require('../lib/inboxBot');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const guard = [requireAuth, requireAdminOrStaff, requirePermission('manage_channel_settings')];

function fail(res, error, where) {
  if (error?.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Which AI the bot would run on — the provider and model, never the key. */
async function aiStatus(tenantId) {
  const settings = await getTenantSetting('settings', { tenantId, fallback: {} }).catch(() => ({}));
  const config = resolveAiConfig(settings, 'agent');
  return config ? { configured: true, provider: config.provider, model: config.model } : { configured: false };
}

router.get('/api/admin/inbox-bot', ...guard, async (req, res) => {
  try {
    res.json({ settings: await loadSettings(req.tenantId), ai: await aiStatus(req.tenantId) });
  } catch (error) { fail(res, error, '[inbox-bot get]'); }
});

router.put('/api/admin/inbox-bot', ...guard, async (req, res) => {
  try {
    const settings = await saveSettings(req.tenantId, req.body?.settings || req.body || {});
    res.json({ ok: true, settings });
  } catch (error) { fail(res, error, '[inbox-bot save]'); }
});

/**
 * POST /api/admin/inbox-bot/test { settings?, messages: [{role, content}], platform? }
 * The answer the bot would give, with the settings on screen (saved or not).
 * Nothing is sent.
 */
router.post('/api/admin/inbox-bot/test', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    const settings = normalizeSettings({ ...(req.body?.settings || await loadSettings(req.tenantId)), enabled: true });
    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-14)
      .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content || '').slice(0, 2000) }))
      .filter(m => m.content.trim());
    if (!messages.length || messages.at(-1).role !== 'user') return res.status(400).json({ error: 'اكتب رسالة العميل' });
    const result = await composeReply({ tenantId: req.tenantId, settings, messages, platform: req.body?.platform || 'whatsapp' }, { db: pool });
    if (!result.reply && result.reason === 'no_ai_key') {
      return res.status(409).json({ error: 'لسه مفيش مفتاح ذكاء اصطناعي — حطه في «التكاملات ← إعدادات AI»', reason: 'no_ai_key' });
    }
    res.json(result);
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ error: 'مفتاح الذكاء الاصطناعي مش متظبط صح' });
    if (error?.providerStatus) return res.status(502).json({ error: `مزوّد الذكاء الاصطناعي رفض: ${String(error.message || '').slice(0, 200)}` });
    fail(res, error, '[inbox-bot test]');
  }
});

/** What the bot reads before it answers, with the settings on screen. */
router.post('/api/admin/inbox-bot/knowledge', ...guard, async (req, res) => {
  try {
    const settings = normalizeSettings(req.body?.settings || await loadSettings(req.tenantId));
    const knowledge = await buildKnowledge(req.tenantId, settings);
    res.json({ knowledge, characters: knowledge.length });
  } catch (error) { fail(res, error, '[inbox-bot knowledge]'); }
});

module.exports = router;
