'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/admin/ai/config', requireAuth, requireAdmin, (_req, res) => {
  res.json({ geminiKey: process.env.GEMINI_API_KEY || null });
});

router.get('/api/admin/server-status', requireAuth, requireAdmin, (_req, res) => {
  const path = require('path');
  const fs = require('fs');

  const mem = process.memoryUsage();
  const pm2Info = {
    status: 'online',
    uptime: Math.round(process.uptime() * 1000),
    restarts: 0,
    memory: mem.rss,
    cpu: 0,
    pid: process.pid,
  };

  let watchdogLog = [];
  try {
    const cronLogPath = path.join(__dirname, 'cron.log');
    const watchdogLogPath = path.join(__dirname, 'watchdog.log');
    const logPath = fs.existsSync(cronLogPath) ? cronLogPath : watchdogLogPath;
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      watchdogLog = lines.slice(-30);
    }
  } catch (_) {}

  let crashHistory = [];
  let totalCrashes = 0;
  let totalStarts = 0;
  let autoHeals = 0;
  try {
    const crashPath = path.join(__dirname, 'crash-history.log');
    if (fs.existsSync(crashPath)) {
      const lines = fs.readFileSync(crashPath, 'utf8').split('\n').filter(Boolean);
      totalCrashes = lines.filter(l => l.includes('[CRASH]')).length;
      totalStarts = lines.filter(l => l.includes('[START]')).length;
      autoHeals = lines.filter(l => l.includes('[AUTO-HEAL]')).length;
      crashHistory = lines.slice(-100);
    }
  } catch (_) {}

  res.json({
    ok: true,
    time: new Date().toISOString(),
    pm2: pm2Info,
    watchdogLog,
    crashHistory,
    stats: { totalCrashes, totalStarts, autoHeals },
    memNow: mem.rss,
    dbPool: { connectionLimit: pool.pool?.config?.connectionLimit ?? null },
  });
});

router.post('/api/admin/server-restart', requireAuth, requireAdmin, (_req, res) => {
  const { spawn } = require('child_process');
  const NODE2 = '/opt/alt/alt-nodejs22/root/usr/bin/node';
  const APP_DIR = __dirname;

  res.json({ ok: true, message: 'جاري إعادة التشغيل... سيعود خلال ثوانٍ' });

  setTimeout(() => {
    const child = spawn('/bin/bash', ['-c',
      `sleep 2 && for pid in $(ps aux | grep nodejs22 | grep -v grep | awk '{print $2}'); do kill -9 $pid 2>/dev/null; done; rm -f /tmp/mahad_supervisor.pid; sleep 2 && cd '${APP_DIR}' && nohup ${NODE2} supervisor.js >> '${APP_DIR}/server.log' 2>&1 &`
    ], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 500);
});

module.exports = router;
