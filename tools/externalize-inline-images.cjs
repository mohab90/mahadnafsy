// Move the pictures stored inside rows as base64 text out to files.
//
// «أول كارت ظهر بعد ٥ ثواني … اتأكد من كل الصور إنها خفيفة جدا» (18 Oct 2026). GET /api/therapists was
// 92 KB for 13 people, 77 KB of it two photos pasted in as `data:image/...;base64,...` before uploads
// became files (lib/mediaImages.js). The home page downloads that on every visit, nothing caches it and
// the resize proxy cannot touch it. A picture that is a file is resized to its box, cached by the browser
// and costs the row nothing.
//
// What it does: for each column in WATCHED, every row whose value is an image data URL is stored with
// storeMediaImage (WebP, at most the kind's size, named by its content) and the column now holds
// /api/media/<tenant>/<name>.webp. Before any write the old values go to a JSON file next to the script's
// working directory, and each UPDATE is guarded by the value it read, so a row somebody edited meanwhile is
// left alone.
//
//   node tools/externalize-inline-images.cjs           # dry run: what would change, and by how much
//   node tools/externalize-inline-images.cjs --apply
//
// Run it on the VPS, where api/uploads/media is the directory the site serves (MEDIA_IMAGE_DIR if set).
require('dotenv').config({ path: process.env.ENV_FILE || '/var/www/mahad-api/.env' });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { storeMediaImage } = require('../api/lib/mediaImages');

const APPLY = process.argv.includes('--apply');

// [table, column, kind]. A table or column the database does not have is skipped, not an error.
const WATCHED = [
  ['therapists', 'image', 'photo'],
  ['testimonials', 'image', 'photo'],
  ['courses', 'thumbnail', 'cover'],
  ['bundles', 'thumbnail', 'cover'],
  ['community_events', 'image_url', 'cover'],
  ['community_videos', 'thumbnail', 'cover'],
  ['community_library', 'thumbnail', 'cover'],
];
const DATA_URL = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i;

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [present] = await db.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
  const has = new Set(present.map(row => `${row.t}.${row.c}`));

  const found = [];
  for (const [table, column, kind] of WATCHED) {
    if (!has.has(`${table}.${column}`) || !has.has(`${table}.id`)) { console.log(`skip ${table}.${column} (not in this database)`); continue; }
    const tenantSql = has.has(`${table}.tenant_id`) ? 'tenant_id' : "'tenant-default'";
    const [rows] = await db.query(
      `SELECT id, ${tenantSql} AS tenant_id, \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` LIKE 'data:image/%'`);
    for (const row of rows) if (DATA_URL.test(String(row.value || ''))) found.push({ table, column, kind, ...row });
  }

  console.log(`pictures stored inside rows: ${found.length}`);
  console.table(found.map(f => ({ table: f.table, column: f.column, id: String(f.id).slice(0, 12), KB: Math.round(f.value.length / 1024) })));
  const total = found.reduce((sum, f) => sum + f.value.length, 0);
  console.log(`total inside the rows: ${Math.round(total / 1024)} KB`);
  if (!found.length || !APPLY) {
    if (found.length) console.log('\ndry run -- nothing written. re-run with --apply');
    await db.end();
    return;
  }

  const backup = path.resolve(`inline-images-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(found, null, 1), { mode: 0o600 });
  console.log(`old values saved: ${backup}`);

  let failed = 0;
  for (const f of found) {
    try {
      const stored = await storeMediaImage({ tenantId: f.tenant_id, dataUrl: f.value, kind: f.kind });
      const [result] = await db.query(
        `UPDATE \`${f.table}\` SET \`${f.column}\` = ? WHERE id = ? AND \`${f.column}\` = ?`, [stored.url, f.id, f.value]);
      // affectedRows counts matches, not changes, so recount below.
      console.log(`${f.table}.${f.column} ${f.id}: ${Math.round(f.value.length / 1024)} KB -> ${Math.round(stored.size / 1024)} KB file (${result.affectedRows ? 'updated' : 'edited meanwhile, left alone'})`);
    } catch (error) {
      failed++;
      console.error(`${f.table}.${f.column} ${f.id}: ${error.message}`);
    }
  }
  for (const [table, column] of WATCHED) {
    if (!has.has(`${table}.${column}`)) continue;
    const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM \`${table}\` WHERE \`${column}\` LIKE 'data:image/%'`);
    if (n) console.log(`still inline in ${table}.${column}: ${n}`);
  }
  console.log(`done. failed: ${failed}. Check https://<site>/api/therapists is small now.`);
  await db.end();
})().catch(error => { console.error(error); process.exit(1); });
