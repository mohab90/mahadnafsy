'use strict';

// How full the server's disks are, and a WhatsApp to the owner when one passes
// DISK_ALERT_PERCENT (80 by default).
//
// One VM holds the database, its nightly dumps, the API with every uploaded
// lecture, staging, and each deploy's rollback archives. Nothing watched the
// disk, and a full disk does not announce itself: MariaDB stops writing, the
// dump fails, uploads fail — all at once, and in that order of discovery the
// last one is the one somebody notices. The health output now carries the
// figure for the deploy and the monitors, and the owner hears about it on the
// same numbers the daily report goes to, at most once a week per disk.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { addDaysToDateOnly, cairoToday } = require('./dates');

const API_ROOT = path.join(__dirname, '..');
const thresholdPercent = () => {
  const value = Number(process.env.DISK_ALERT_PERCENT);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : 80;
};

// The places that grow: the release (and staging and /staging beside it on the
// same filesystem), uploaded videos when they live elsewhere, and the backups.
function watchedPaths() {
  const { VIDEO_ROOT } = require('./uploadSafety');
  return [API_ROOT, VIDEO_ROOT, process.env.MAHAD_BACKUP_DIR || '/var/backups/mahad-db'];
}

/** Usage of each distinct filesystem under the watched paths. Never throws. */
function diskUsage(paths = watchedPaths()) {
  if (typeof fs.statfsSync !== 'function') return [];
  const seen = new Set();
  const disks = [];
  for (const candidate of paths) {
    try {
      const device = fs.statSync(candidate).dev;
      if (seen.has(device)) continue;
      seen.add(device);
      const stats = fs.statfsSync(candidate);
      const total = stats.blocks * stats.bsize;
      if (!total) continue;
      // bavail, not bfree: the blocks reserved for root are not space the API,
      // running as a service user, can write into.
      const free = stats.bavail * stats.bsize;
      disks.push({
        path: candidate,
        usedPercent: Math.round(((total - free) / total) * 1000) / 10,
        freeGb: Math.round((free / 1024 ** 3) * 10) / 10,
      });
    } catch { /* a path that does not exist here is not a disk to watch */ }
  }
  return disks;
}

/** For /api/health: each disk, and whether any is past the threshold. */
function diskHealth() {
  const threshold = thresholdPercent();
  const disks = diskUsage();
  return { thresholdPercent: threshold, warning: disks.some(disk => disk.usedPercent >= threshold), disks };
}

// Monday of the Cairo week — one alert per disk per week, however many times
// the scheduler looks and however many instances look.
function weekStart(today = cairoToday()) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDaysToDateOnly(today, -((weekday + 6) % 7));
}

function composeDiskAlert(disk, threshold) {
  return [
    '⚠️ *تنبيه: مساحة السيرفر قربت تخلص*',
    `القرص (${disk.path}) مليان ${disk.usedPercent}% — الحد ${threshold}% — والمتاح ${disk.freeGb} جيجا بس.`,
    'لو القرص اتملى، قاعدة البيانات والباك اب ورفع الفيديوهات بيقفوا مرة واحدة.',
    'محتاج تنظيف (نسخ قديمة، فيديوهات، لوجز) أو مساحة أكبر.',
  ].join('\n');
}

/** Scheduler tick: queue a staff_alert WhatsApp to the owner-report numbers for each full disk. */
async function alertOnFullDisks({ pool, logger, disks = diskUsage(), today = cairoToday() }) {
  const threshold = thresholdPercent();
  const full = disks.filter(disk => disk.usedPercent >= threshold);
  if (!full.length) return 0;
  logger?.warn?.(`[disk] ${full.map(disk => `${disk.path} ${disk.usedPercent}%`).join(', ')} — at or past ${threshold}%`);
  const { SECTION, ownerReportSettings } = require('./ownerDailyReport');
  const outbox = require('./outbox');
  const week = weekStart(today);
  const [rows] = await pool.query('SELECT DISTINCT tenant_id FROM tenant_settings WHERE section=?', [SECTION]);
  let queued = 0;
  for (const { tenant_id: tenantId } of rows) {
    const { phones } = await ownerReportSettings(tenantId, pool);
    for (const disk of full) {
      for (const phone of phones) {
        const id = await outbox.enqueue({
          channel: 'whatsapp', recipient: phone, tenantId,
          // dedupe_key is 150 characters; a path is not bounded, its digest is.
          dedupeKey: `disk-alert:${week}:${crypto.createHash('sha1').update(disk.path).digest('hex').slice(0, 12)}:${phone}`,
          refType: 'disk_alert', refId: week,
          payload: { message: composeDiskAlert(disk, threshold), category: 'staff_alert' },
        }, pool);
        if (id) queued += 1;
      }
    }
  }
  return queued;
}

module.exports = { alertOnFullDisks, composeDiskAlert, diskHealth, diskUsage, weekStart };
