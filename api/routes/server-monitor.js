'use strict';

const express = require('express');
const router = express.Router();

const { pool, clockContract } = require('../lib/db');
const { cairoClock, cairoOffsetMinutes } = require('../lib/dates');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/admin/ai/config', requireAuth, requireAdmin, (_req, res) => {
  res.json({
    provider: 'gemini',
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
});

router.get('/api/admin/server-status', requireAuth, requireAdmin, async (_req, res) => {
  const mem = process.memoryUsage();
  const now = new Date();
  // «اتاكد ان التاريخ والوقت متطابق مع مصر»: what the institute's clock reads,
  // its offset today (+3 in summer, +2 in winter) and whether the process and
  // the database are on the UTC that storage assumes.
  const clock = { ...cairoClock(now), offsetMinutes: cairoOffsetMinutes(now), utc: now.toISOString(),
    ...(await clockContract().catch(() => ({}))) };
  const pm2Info = {
    status: 'online',
    uptime: Math.round(process.uptime() * 1000),
    restarts: 0,
    memory: mem.rss,
    cpu: 0,
    pid: process.pid,
  };

  res.json({
    ok: true,
    time: now.toISOString(),
    clock,
    pm2: pm2Info,
    processManager: process.env.PROCESS_MANAGER || 'external',
    restartManagedExternally: true,
    watchdogLog: [],
    crashHistory: [],
    stats: { totalCrashes: 0, totalStarts: 1, autoHeals: 0 },
    memNow: mem.rss,
    dbPool: { connectionLimit: pool.pool?.config?.connectionLimit ?? null },
  });
});

router.post('/api/admin/server-restart', requireAuth, requireAdmin, (_req, res) => {
  res.status(409).json({
    error: 'إعادة التشغيل تتم من منصة الاستضافة أو مدير العمليات فقط',
    code: 'MANAGED_RESTART_REQUIRED',
  });
});

module.exports = router;
