#!/usr/bin/env node
'use strict';
/**
 * Move the files already on this server's disk to the S3-compatible bucket
 * (lib/objectStorage.js), and back again for a rollback.
 *
 * New uploads move by themselves once STORAGE_DRIVER=s3; this is for what was
 * here before: lecture videos (VIDEO_UPLOAD_DIR), the site's pictures
 * (MEDIA_IMAGE_DIR) and, with --include-proofs, payment receipts kept as data
 * URLs inside payment_proofs rows.
 *
 * Every file is hashed, uploaded with its SHA-256 declared (the store refuses
 * a body that does not match), then HEADed and compared again; only then is it
 * recorded as `both` in storage_objects. Nothing local is deleted unless
 * --delete-local is given, and even then each file's bucket copy is checked
 * once more first. Stop it at any point and run it again: verified files are
 * skipped, an upload that finished but was not recorded is adopted after its
 * hash is compared. The bucket settings are read from the API's .env
 * (STORAGE_S3_*), whatever STORAGE_DRIVER says. deploy/CLOUD_STORAGE.md.
 *
 *   node tools/move-uploads-to-storage.cjs --dry-run           # what it would do
 *   node tools/move-uploads-to-storage.cjs                     # copy + verify, keep local
 *   node tools/move-uploads-to-storage.cjs --delete-local      # ... then free the disk
 *   node tools/move-uploads-to-storage.cjs --to-local          # rollback: bring files back
 *
 * Options: --only=videos,media,proofs  --include-proofs  --limit=N  --log-file=PATH
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_RULES = Object.freeze({
  videos: { pattern: /^media-[a-f0-9-]{36}\.(mp4|mov|webm|ogv|mpeg|mp3|wav|ogg)$/i },
  media: { pattern: /^[a-f0-9]{24}\.webp$/ },
});
const PROOF_EXT = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' });

function parseArgs(argv) {
  const value = name => argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const options = {
    dryRun: argv.includes('--dry-run'),
    deleteLocal: argv.includes('--delete-local'),
    toLocal: argv.includes('--to-local'),
    includeProofs: argv.includes('--include-proofs'),
    limit: value('limit') ? Math.max(1, Number(value('limit'))) : Infinity,
    logFile: value('log-file') || null,
    only: new Set(String(value('only') || 'videos,media,proofs').split(',').map(part => part.trim()).filter(Boolean)),
  };
  for (const kind of options.only) if (!['videos', 'media', 'proofs'].includes(kind)) throw new Error(`--only takes videos, media, proofs (got ${kind})`);
  if (options.toLocal && options.deleteLocal) throw new Error('--to-local and --delete-local cannot be combined');
  if (!options.includeProofs) options.only.delete('proofs');
  return options;
}

function contentTypeFor(prefix, filename) {
  if (prefix === 'media') return 'image/webp';
  const { VIDEO_TYPES } = require('../lib/uploadSafety');
  const extension = path.extname(filename).slice(1).toLowerCase();
  return Object.values(VIDEO_TYPES).find(type => type.extension === extension)?.contentType || 'application/octet-stream';
}

/** The files under each root as `<prefix>/<tenant>/<file>` keys (temporary and stray files skipped). */
async function listLocalFiles(roots, only) {
  const out = [];
  for (const prefix of ['videos', 'media']) {
    if (!only.has(prefix) || !roots[prefix]) continue;
    let tenants = [];
    try { tenants = await fs.promises.readdir(roots[prefix], { withFileTypes: true }); } catch { continue; }
    for (const tenant of tenants.filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]{1,64}$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const entries = await fs.promises.readdir(path.join(roots[prefix], tenant.name), { withFileTypes: true });
      for (const entry of entries.filter(item => item.isFile() && FILE_RULES[prefix].pattern.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({
          key: `${prefix}/${tenant.name}/${entry.name}`,
          localPath: path.join(roots[prefix], tenant.name, entry.name),
          contentType: contentTypeFor(prefix, entry.name),
        });
      }
    }
  }
  return out;
}

function decodeProof(dataUrl) {
  const match = /^data:(image\/[a-z]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const contentType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!PROOF_EXT[contentType]) return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return { contentType, buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

const sameObject = (remote, size, sha256) => Boolean(remote) && Number(remote.size) === Number(size) && remote.sha256 === sha256;

// ── payment receipts kept in their rows ──────────────────────────────────────
async function proofIds(db) {
  const ids = [];
  let after = '';
  for (;;) {
    const [rows] = await db.query(
      `SELECT id, tenant_id FROM payment_proofs
        WHERE proof_image LIKE 'data:image/%' AND id > ? ORDER BY id LIMIT 200`, [after]);
    if (!rows.length) return ids;
    ids.push(...rows.map(row => ({ id: row.id, tenantId: row.tenant_id })));
    after = rows[rows.length - 1].id;
  }
}

async function loadProof(db, { id, tenantId }) {
  const [[row]] = await db.query('SELECT proof_image FROM payment_proofs WHERE id=? AND tenant_id=? LIMIT 1', [id, tenantId]);
  return row?.proof_image || null;
}

async function moveProof({ db, client, ledger, proof, options }) {
  const dataUrl = await loadProof(db, proof);
  const decoded = decodeProof(dataUrl);
  if (!decoded) return { key: `proofs/${proof.tenantId}/${proof.id}`, action: 'skipped', reason: 'not an image data URL' };
  const key = `proofs/${proof.tenantId}/${proof.id}.${PROOF_EXT[decoded.contentType]}`;
  const size = decoded.buffer.length;
  const row = await ledger.get(key);
  let result = { key, action: 'already-copied', size };
  if (!(row && row.location !== 'local' && row.sha256 === decoded.sha256)) {
    if (options.dryRun) return { key, action: 'would-copy', size };
    const existing = await client.head(key);
    result.action = sameObject(existing, size, decoded.sha256) ? 'adopted' : 'copied';
    if (result.action === 'copied') {
      await client.put(key, { buffer: decoded.buffer, contentType: decoded.contentType, cacheControl: 'private, no-store' });
      if (!sameObject(await client.head(key), size, decoded.sha256)) throw new Error(`${key}: bucket copy does not match after upload`);
    }
    await ledger.record(key, { location: 'both', size, sha256: decoded.sha256, contentType: decoded.contentType });
  }
  if (!options.deleteLocal) return result;
  // The row's own copy is replaced by the reference only if it is still the
  // picture that was verified, and the bucket still holds it.
  if (!sameObject(await client.head(key), size, decoded.sha256)) return { key, action: 'kept', reason: 'the bucket copy no longer matches' };
  if (options.dryRun) return { key, action: 'would-delete', size };
  const [update] = await db.query(
    'UPDATE payment_proofs SET proof_image=? WHERE id=? AND tenant_id=? AND proof_image=?',
    [`storage:${key}`, proof.id, proof.tenantId, dataUrl]);
  if (!update.affectedRows) return { key, action: 'kept', reason: 'the row changed meanwhile' };
  await ledger.setLocation(key, 'remote');
  return { key, action: 'deleted-local', size };
}

async function restoreProof({ db, client, ledger, row, options }) {
  if (options.dryRun) return { key: row.key, action: 'would-restore', size: row.size };
  const object = await client.getBuffer(row.key, { maxBytes: 16 * 1024 * 1024 });
  if (!object) throw new Error(`${row.key}: not in the bucket`);
  const sha256 = crypto.createHash('sha256').update(object.buffer).digest('hex');
  if (sha256 !== row.sha256 || object.buffer.length !== row.size) throw new Error(`${row.key}: downloaded copy does not match the ledger`);
  const id = row.key.split('/')[2].replace(/\.[a-z]+$/, '');
  const dataUrl = `data:${row.contentType || 'image/jpeg'};base64,${object.buffer.toString('base64')}`;
  const [update] = await db.query(
    'UPDATE payment_proofs SET proof_image=? WHERE id=? AND tenant_id=? AND proof_image=?',
    [dataUrl, id, row.tenantId, `storage:${row.key}`]);
  if (!update.affectedRows) return { key: row.key, action: 'skipped', reason: 'the row no longer points at the bucket' };
  await ledger.setLocation(row.key, 'both');
  return { key: row.key, action: 'restored', size: row.size };
}

/**
 * The whole run. `client` is the bucket (lib/objectStorage.js createS3Client),
 * `ledger` storage_objects (lib/storageLedger.js), `db` a pool for the proofs.
 */
async function runMove({ client, ledger, db = null, roots, options, log = () => {} }) {
  const { copyToBucket, deleteLocalCopy, restoreToLocal } = require('../lib/storageOffload');
  const summary = { total: 0, failed: 0, bytes: 0, actions: {} };
  const count = (result) => {
    summary.actions[result.action] = (summary.actions[result.action] || 0) + 1;
    if (['copied', 'adopted', 'restored'].includes(result.action)) summary.bytes += Number(result.size || 0);
  };
  const localPathOf = key => {
    const [prefix, tenant, filename] = key.split('/');
    return roots[prefix] ? path.join(roots[prefix], tenant, filename) : null;
  };
  const step = async (index, total, key, work) => {
    summary.total += 1;
    try {
      const result = await work();
      count(result);
      log(`[${index}/${total}] ${result.action} ${key}${result.size != null ? ` ${result.size}B` : ''}${result.reason ? ` (${result.reason})` : ''}`);
    } catch (error) {
      summary.failed += 1;
      count({ action: 'failed' });
      await ledger.noteError(key, error.message).catch(() => {});
      log(`[${index}/${total}] FAILED ${key}: ${error.message}`);
    }
  };

  if (options.toLocal) {
    const kinds = [];
    if (options.only.has('videos')) kinds.push('video');
    if (options.only.has('media')) kinds.push('image');
    if (options.only.has('proofs') && db) kinds.push('proof');
    const rows = kinds.length ? (await ledger.inLocation('remote', { kinds })).slice(0, options.limit) : [];
    log(`restoring ${rows.length} file(s) from the bucket${options.dryRun ? ' (dry run)' : ''}`);
    let index = 0;
    for (const row of rows) {
      index += 1;
      await step(index, rows.length, row.key, () => (row.kind === 'proof'
        ? restoreProof({ db, client, ledger, row, options })
        : restoreToLocal({ key: row.key, localPath: localPathOf(row.key), client, ledger, dryRun: options.dryRun })));
    }
    return summary;
  }

  const files = (await listLocalFiles(roots, options.only)).slice(0, options.limit);
  const proofs = options.only.has('proofs') && db ? (await proofIds(db)).slice(0, options.limit) : [];
  if (options.only.has('proofs') && !db) log('proofs skipped: no database');
  const total = files.length + proofs.length;
  log(`${total} item(s): ${files.length} file(s), ${proofs.length} receipt(s)${options.dryRun ? ' (dry run)' : ''}${options.deleteLocal ? ', deleting verified local copies' : ''}`);
  let index = 0;
  for (const file of files) {
    index += 1;
    await step(index, total, file.key, async () => {
      const copied = await copyToBucket({ key: file.key, localPath: file.localPath, client, ledger, contentType: file.contentType, dryRun: options.dryRun });
      if (!options.deleteLocal || copied.action === 'missing-local') return copied;
      // A dry run has nothing verified to delete yet unless an earlier run did.
      if (options.dryRun && copied.action === 'would-copy') return copied;
      return deleteLocalCopy({ key: file.key, localPath: file.localPath, client, ledger, dryRun: options.dryRun });
    });
  }
  for (const proof of proofs) {
    index += 1;
    await step(index, total, `proofs/${proof.tenantId}/${proof.id}`, () => moveProof({ db, client, ledger, proof, options }));
  }
  return summary;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const options = parseArgs(process.argv.slice(2));
  const { createS3Client, storageConfig } = require('../lib/objectStorage');
  const config = storageConfig();
  if (!config.s3) {
    console.error(`[move-uploads] the bucket is not configured: ${config.problems.join('; ') || 'set STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY'}`);
    process.exit(2);
  }
  const { pool } = require('../lib/db');
  const { createDbLedger } = require('../lib/storageLedger');
  const roots = { videos: require('../lib/uploadSafety').VIDEO_ROOT, media: require('../lib/mediaImages').ROOT };
  const logStream = options.logFile ? fs.createWriteStream(options.logFile, { flags: 'a' }) : null;
  const log = line => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    logStream?.write(`${stamped}\n`);
  };
  log(`bucket ${config.s3.bucket} at ${config.s3.endpoint}${config.s3.prefix ? ` under ${config.s3.prefix}/` : ''}; videos ${roots.videos}; pictures ${roots.media}`);
  let summary;
  try {
    summary = await runMove({ client: createS3Client(config.s3), ledger: createDbLedger(pool), db: pool, roots, options, log });
  } finally {
    await pool.end().catch(() => {});
  }
  log(`done: ${summary.total} item(s), ${summary.failed} failed, ${(summary.bytes / 1024 / 1024).toFixed(1)} MB moved — ${JSON.stringify(summary.actions)}`);
  if (summary.failed) log('run it again to retry the failed ones; verified files are skipped');
  logStream?.end();
  process.exit(summary.failed ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => { console.error('[move-uploads] fatal:', error.message); process.exit(1); });
}

module.exports = { decodeProof, listLocalFiles, parseArgs, runMove };
