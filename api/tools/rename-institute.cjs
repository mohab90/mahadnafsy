#!/usr/bin/env node
'use strict';
// Renames the institute everywhere it is stored as a setting: «مهاد» → «معهد الدراسات النفسية».
//
//   node api/tools/rename-institute.cjs            ← shows what would change
//   node api/tools/rename-institute.cjs --apply    ← writes a backup JSON, then changes it
//
// The code no longer carries the old name, but the admin-edited copies do:
// tenants.name, tenant_settings.config_json (branding, content, WhatsApp
// templates, email header) and the legacy site_config rows. Logs and sent
// messages are history and are left as they were.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

const APPLY = process.argv.includes('--apply');
const NEW_NAME = 'معهد الدراسات النفسية';
// Longest first, so «معهد مهاد للدراسات النفسية» does not become «معهد الدراسات النفسية للدراسات النفسية».
const RENAMES = [
  'معهد مهاد للدراسات النفسية',
  'مهاد للدراسات النفسية',
  'معهد مهاد',
  'مهاد النفسي',
  'مهاد نفسي',
];

const renameText = text => RENAMES.reduce((out, from) => out.split(from).join(NEW_NAME), text);

function renameValue(value) {
  if (typeof value === 'string') return renameText(value);
  if (Array.isArray(value)) return value.map(renameValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameValue(v)]));
  }
  return value;
}

// JSON is parsed and walked, so a name stored as \u escapes is still found.
function renameStored(raw) {
  if (raw == null) return raw;
  try { return JSON.stringify(renameValue(JSON.parse(raw))); } catch { return renameText(raw); }
}
// Re-stringifying turns \u escapes back into the letters they stand for.
const unescaped = raw => { try { return JSON.stringify(JSON.parse(raw)); } catch { return String(raw); } };
const sameJson = (a, b) => { try { return JSON.stringify(JSON.parse(a)) === b; } catch { return a === b; } };

(async () => {
  const [tenants] = await pool.query('SELECT id, name FROM tenants');
  const [settings] = await pool.query('SELECT id, tenant_id, section, config_json FROM tenant_settings WHERE is_secret=0');
  const [siteConfig] = await pool.query('SELECT `key`, value FROM site_config');

  const rows = [
    ...tenants.map(t => ({ table: 'tenants', id: t.id, label: `tenant ${t.id}`, before: t.name, after: renameText(t.name) })),
    ...settings.map(s => ({ table: 'tenant_settings', id: s.id, label: `${s.tenant_id} / ${s.section}`, before: s.config_json, after: renameStored(s.config_json) })),
    ...siteConfig.map(c => ({ table: 'site_config', id: c.key, label: `site_config ${c.key}`, before: c.value, after: renameStored(c.value) })),
  ];
  const changes = rows.filter(row => !sameJson(row.before, row.after));

  console.log(`Rows to rename: ${changes.length}`);
  for (const ch of changes) {
    const hits = RENAMES.filter(from => unescaped(ch.before).includes(from));
    console.log(`  ${ch.table.padEnd(16)} ${ch.label}  ${hits.map(h => `«${h}»`).join(' ')}`);
  }
  // A bare «مهاد» that is not one of the known phrases is reported, not guessed at.
  const leftovers = rows.filter(row => row.after != null && unescaped(row.after).includes('مهاد')).map(row => row.label);
  if (leftovers.length) console.log(`\nStill says «مهاد» after renaming (check by hand): ${leftovers.join(', ')}`);

  if (!APPLY) {
    console.log('\nNothing was changed. Run again with --apply to rename these rows.');
    return;
  }
  if (!changes.length) return;

  const backup = path.resolve(`rename-institute-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(changes.map(({ table, id, before }) => ({ table, id, before })), null, 2));
  console.log(`\nBackup: ${backup}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const ch of changes) {
      if (ch.table === 'tenants') await conn.query('UPDATE tenants SET name=? WHERE id=?', [ch.after, ch.id]);
      else if (ch.table === 'tenant_settings') await conn.query('UPDATE tenant_settings SET config_json=? WHERE id=?', [ch.after, ch.id]);
      else await conn.query('UPDATE site_config SET value=? WHERE `key`=?', [ch.after, ch.id]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  console.log(`Renamed ${changes.length} row(s). Restart the API so cached settings and templates reload.`);
})().catch(error => { console.error('rename-institute:', error.message); process.exit(2); }).finally(() => pool.end().catch(() => {}));
