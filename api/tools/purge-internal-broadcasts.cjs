#!/usr/bin/env node
'use strict';
/**
 * Remove internal staff notices from the customer broadcast list.
 *
 * site_config.notifications is the list of announcements shown to every
 * signed-in customer. An admin screen that once mirrored the internal feed into
 * it (NOT-01, since rewired) left 100 entries behind: 53 naming each new
 * subscriber, 47 naming the salesperson a lead was assigned to. Not one entry
 * in the row was a real announcement.
 *
 * routes/config.js now filters these on read and refuses to store them on
 * write, so the leak is closed either way. This clears the data itself, which
 * the filter cannot do — the row is still listed on the admin's «الإشعارات
 * المرسلة» screen, and staff see the same 100 notices there.
 *
 * Writes a timestamped backup of the row before touching it. Dry by default:
 *   node tools/purge-internal-broadcasts.cjs           # report only
 *   node tools/purge-internal-broadcasts.cjs --commit  # apply
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../lib/db');

const CUSTOMER_BROADCAST_TYPES = new Set(['info', 'offer', 'update']);
const commit = process.argv.includes('--commit');

(async () => {
  const [[row]] = await pool.query('SELECT `value` AS v FROM site_config WHERE `key`=? LIMIT 1', ['notifications']);
  if (!row) { console.log('[purge] no notifications row; nothing to do'); return; }

  let before;
  try { before = JSON.parse(row.v); } catch { before = null; }
  if (!Array.isArray(before)) { console.log('[purge] row is not a list; leaving it untouched'); return; }

  const keep = before.filter(item => CUSTOMER_BROADCAST_TYPES.has(String((item && item.type) || '').toLowerCase()));
  const removed = before.length - keep.length;

  const byType = {};
  for (const item of before) {
    const type = String((item && item.type) || '(none)').toLowerCase();
    if (!CUSTOMER_BROADCAST_TYPES.has(type)) byType[type] = (byType[type] || 0) + 1;
  }
  console.log(`[purge] ${before.length} entries: keeping ${keep.length} broadcast(s), removing ${removed}`);
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`         ${count.toString().padStart(4)} × ${type}`);
  }

  if (!removed) { console.log('[purge] already clean'); return; }
  if (!commit) { console.log('[purge] dry run — pass --commit to apply'); return; }

  const backup = path.join(__dirname, `notifications-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(before, null, 2));
  console.log(`[purge] backed up the row to ${backup}`);

  await pool.query('UPDATE site_config SET `value`=? WHERE `key`=?', [JSON.stringify(keep), 'notifications']);

  const [[after]] = await pool.query('SELECT `value` AS v FROM site_config WHERE `key`=? LIMIT 1', ['notifications']);
  console.log(`[purge] done — the row now holds ${JSON.parse(after.v).length} entr(ies)`);
})()
  .catch(error => { console.error('[purge]', error.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
