'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/admin/ai/config', requireAuth, requireAdmin, (_req, res) => {
  res.json({
    provider: 'gemini',
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
});

router.get('/api/admin/server-status', requireAuth, requireAdmin, (_req, res) => {
  const mem = process.memoryUsage();
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
    time: new Date().toISOString(),
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
