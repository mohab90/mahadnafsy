'use strict';

// Moving files from this server's disk to the bucket, and back, without ever
// losing the only copy. Used by tools/move-uploads-to-storage.cjs for the
// files that were already here, and by the API for each new upload while the
// s3 driver is on (offloadPendingUploads, from routes/upload.js and the
// background scheduler).
//
// The order is what makes it safe to stop at any point and run again:
//   1. hash the local file (streamed);
//   2. if the bucket already holds the same size and SHA-256, adopt it (a run
//      that died between the upload and the ledger write); otherwise upload it
//      with the hash declared, so the store refuses a body that does not match;
//   3. HEAD it and compare size and SHA-256 again before writing `both`;
//   4. only when asked, HEAD once more, delete the local copy, write `remote`.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { localPathForKey, sha256OfFile } = require('./objectStorage');

class VerificationError extends Error {}

function sameObject(remote, size, sha256) {
  return Boolean(remote) && Number(remote.size) === Number(size) && remote.sha256 === sha256;
}

/** Copy one local file to the bucket and verify it; the local copy stays. */
async function copyToBucket({ key, localPath = localPathForKey(key), client, ledger, contentType, dryRun = false, pendingOffload }) {
  if (!localPath) throw new Error(`No local path for ${key}`);
  const row = await ledger.get(key);
  let stat;
  try { stat = await fs.promises.stat(localPath); } catch { return { key, action: 'missing-local' }; }
  if (row && ['both', 'remote'].includes(row.location) && row.sha256 && row.size === stat.size) {
    // Copied and verified on an earlier run. A row left at `remote` while the
    // file is back on the disk (a restore) is `both` again.
    if (row.location === 'remote' && !dryRun) await ledger.setLocation(key, 'both');
    return { key, action: 'already-copied', size: stat.size };
  }
  const { sha256, size } = await sha256OfFile(localPath);
  if (dryRun) return { key, action: 'would-copy', size };
  let action = 'copied';
  const existing = await client.head(key);
  if (sameObject(existing, size, sha256)) action = 'adopted';
  else {
    await client.put(key, { filePath: localPath, size, sha256, contentType: contentType || row?.contentType || 'application/octet-stream' });
    const stored = await client.head(key);
    if (!sameObject(stored, size, sha256)) {
      throw new VerificationError(`${key}: the bucket holds ${stored ? `${stored.size} bytes / ${stored.sha256 || 'no hash'}` : 'nothing'}, expected ${size} bytes / ${sha256}`);
    }
  }
  await ledger.record(key, {
    location: 'both', size, sha256,
    contentType: contentType || row?.contentType || existing?.contentType || null,
    pendingOffload: pendingOffload ?? row?.pendingOffload ?? false,
  });
  return { key, action, size, sha256 };
}

/** Delete the local copy of a file the bucket verifiably holds. */
async function deleteLocalCopy({ key, localPath = localPathForKey(key), client, ledger, dryRun = false }) {
  const row = await ledger.get(key);
  if (!row || row.location === 'local' || !row.sha256) return { key, action: 'kept', reason: 'not copied and verified yet' };
  let stat = null;
  try { stat = await fs.promises.stat(localPath); } catch { /* already gone */ }
  if (!stat) {
    if (row.location === 'both' && !dryRun) await ledger.setLocation(key, 'remote', { pendingOffload: false });
    return { key, action: 'already-deleted' };
  }
  if (stat.size !== row.size) return { key, action: 'kept', reason: `local file is ${stat.size} bytes, the verified copy ${row.size}` };
  const remote = await client.head(key);
  if (!sameObject(remote, row.size, row.sha256)) {
    const reason = remote ? 'the bucket copy no longer matches' : 'the bucket copy is gone';
    if (!dryRun) {
      await ledger.setLocation(key, 'local');
      await ledger.noteError(key, reason);
    }
    return { key, action: 'kept', reason };
  }
  if (dryRun) return { key, action: 'would-delete', size: stat.size };
  await fs.promises.unlink(localPath);
  await ledger.setLocation(key, 'remote', { pendingOffload: false });
  return { key, action: 'deleted-local', size: stat.size };
}

/** Bring a bucket-only file back onto the disk (the rollback), verified. */
async function restoreToLocal({ key, localPath = localPathForKey(key), client, ledger, dryRun = false }) {
  const row = await ledger.get(key);
  if (!row || row.location !== 'remote') return { key, action: 'skipped' };
  if (dryRun) return { key, action: 'would-restore', size: row.size };
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  const temporary = `${localPath}.restore-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const got = await client.download(key, temporary);
    if (!got) throw new VerificationError(`${key}: not in the bucket`);
    if (got.size !== row.size || got.sha256 !== row.sha256) {
      throw new VerificationError(`${key}: downloaded ${got.size} bytes / ${got.sha256}, expected ${row.size} / ${row.sha256}`);
    }
    await fs.promises.rename(temporary, localPath);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
  await ledger.setLocation(key, 'both', { pendingOffload: false });
  return { key, action: 'restored', size: row.size };
}

/** One new upload: copy, verify, delete the local copy. Claimed, so one process does it. */
async function offloadUpload({ key, client, ledger }) {
  if (!(await ledger.claim(key))) return { key, action: 'claimed-elsewhere' };
  try {
    const copied = await copyToBucket({ key, client, ledger, pendingOffload: true });
    if (copied.action === 'missing-local') {
      await ledger.noteError(key, 'local file missing before it was moved');
      return copied;
    }
    return await deleteLocalCopy({ key, client, ledger });
  } catch (error) {
    await ledger.noteError(key, error.message).catch(() => {});
    throw error;
  } finally {
    await ledger.release(key).catch(() => {});
  }
}

/** The uploads still waiting (an interrupted push, a restart): the scheduler's job. */
async function offloadPendingUploads({ client, ledger, logger, limit = 20 }) {
  const result = { moved: 0, failed: 0 };
  if (!client) return result;
  for (const row of await ledger.pending(limit)) {
    try {
      const outcome = await offloadUpload({ key: row.key, client, ledger });
      if (outcome.action === 'deleted-local' || outcome.action === 'already-deleted') result.moved += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn?.('[storage] offload failed', { key: row.key, err: error.message });
    }
  }
  return result;
}

module.exports = {
  VerificationError,
  copyToBucket,
  deleteLocalCopy,
  offloadPendingUploads,
  offloadUpload,
  restoreToLocal,
};
