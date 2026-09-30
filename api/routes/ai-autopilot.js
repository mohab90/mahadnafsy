'use strict';

// «مركز الذكاء الاصطناعي»: what the daily autopilot does (lib/aiAutopilot.js),
// what it has done, and a way to run a task now.

const express = require('express');
const logger = require('../lib/logger').child({ module: 'ai-autopilot-route' });
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { setTenantSetting } = require('../lib/tenantSettings');
const { DEFAULTS, SECTION, autopilotSettings } = require('../lib/aiAutopilot');
const { cairoToday } = require('../lib/dates');

const router = express.Router();
const TASKS = ['seo', 'communityPosts', 'studyArticles', 'quizzes'];

router.get('/api/admin/ai/autopilot', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await autopilotSettings(req.tenantId);
    const [[courses]] = await pool.query(
      `SELECT SUM(is_published=1) AS published,
              SUM(is_published=1 AND (seo_title IS NULL OR seo_title='' OR seo_description IS NULL OR seo_description='')) AS missingSeo,
              SUM(is_published=1 AND NOT EXISTS (SELECT 1 FROM course_quizzes q WHERE q.tenant_id=c.tenant_id AND q.course_id=c.id)) AS withoutQuiz
         FROM courses c WHERE c.tenant_id=? AND c.deleted_at IS NULL`,
      [req.tenantId]
    );
    const [[posts]] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(status='pending') AS waiting FROM community_posts WHERE tenant_id=? AND author_role='فريق المعهد'",
      [req.tenantId]
    );
    const [runs] = await pool.query(
      "SELECT entity_id AS date, label, at FROM activity_logs WHERE tenant_id=? AND entity='ai-autopilot' ORDER BY at DESC LIMIT 10",
      [req.tenantId]
    );
    res.json({
      settings,
      status: {
        published: Number(courses?.published) || 0, missingSeo: Number(courses?.missingSeo) || 0,
        withoutQuiz: Number(courses?.withoutQuiz) || 0,
        aiPosts: Number(posts?.total) || 0, aiPostsWaiting: Number(posts?.waiting) || 0,
      },
      runs: runs.map(run => {
        let done = {};
        try { done = JSON.parse(run.label || '{}'); } catch { done = {}; }
        return { date: run.date, at: run.at, done };
      }),
    });
  } catch (error) {
    logger.error('[ai-autopilot]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/ai/autopilot', requireAuth, requireAdmin, async (req, res) => {
  try {
    const next = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, req.body?.[key] === true]));
    await setTenantSetting(SECTION, next, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true, settings: await autopilotSettings(req.tenantId) });
  } catch (error) {
    logger.error('[ai-autopilot]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Queued, not run in the request: a quiz takes the model a while, and three
// of them outlast the proxy's timeout.
router.post('/api/admin/ai/autopilot/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const only = TASKS.includes(req.body?.task) ? req.body.task : null;
    const queue = require('../lib/jobQueue');
    await queue.enqueue('ai_autopilot', { tenantId: req.tenantId, date: cairoToday(), only }, {
      tenantId: req.tenantId, maxAttempts: 1, dedupeKey: `ai_autopilot:manual:${only || 'all'}:${Date.now()}`,
    });
    res.json({ ok: true, queued: only || 'all' });
  } catch (error) {
    logger.error('[ai-autopilot]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
