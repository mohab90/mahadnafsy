'use strict';

// What the routes call to put a file where STORAGE_DRIVER says and to find it
// again (lib/objectStorage.js). With the default `local` driver none of this
// changes anything: uploads are written exactly as before and every read finds
// its file on the disk first.

const logger = require('./logger').child({ module: 'stored-files' });
const { parseKey, remoteStore, storageConfig, writesToBucket } = require('./objectStorage');
const { createDbLedger } = require('./storageLedger');
const { offloadUpload } = require('./storageOffload');

const PROOF_REF = 'storage:';
const PROOF_EXT = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' });

/**
 * A short-lived bucket URL for a file that is no longer on the disk, or null
 * (no bucket configured, or the ledger has no copy there). Asked only after
 * the caller has already checked access and looked on the disk.
 */
async function bucketUrlFor(key, { expiresIn = 900, preferPublic = false, ledger = createDbLedger(), client = remoteStore() } = {}) {
  if (!client || !parseKey(key)) return null;
  const row = await ledger.get(key);
  if (!row || !['both', 'remote'].includes(row.location)) return null;
  if (preferPublic) {
    const cdn = client.publicUrl(key);
    if (cdn) return cdn;
  }
  return client.presignGet(key, Math.max(60, Math.floor(expiresIn)));
}

/**
 * How long a lecture's bucket URL lives: never past the media ticket that let
 * the viewer in, and never past STORAGE_VIDEO_URL_TTL_SECONDS. A <video> may
 * keep using the redirected URL for its later range requests, so it has to
 * last the lecture — exactly as the ticket does (lib/mediaAccess.js).
 */
function videoUrlLifetime(ticketExp, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cap = storageConfig().s3?.videoUrlTtlSeconds || 4 * 60 * 60;
  return Math.max(60, Math.min(Number(ticketExp) - nowSeconds, cap));
}

/**
 * A lecture just saved on the disk by routes/upload.js: when the s3 driver is
 * on, record it as waiting and move it now, in the background, so the upload's
 * response does not wait on the bucket. Until it is moved it plays from the
 * disk; if the process stops first, the scheduler's sweep picks it up.
 */
async function queueUploadOffload(key, { size, contentType }) {
  if (!writesToBucket()) return false;
  const ledger = createDbLedger();
  await ledger.record(key, { location: 'local', size, contentType, pendingOffload: true });
  const client = remoteStore();
  setImmediate(() => {
    offloadUpload({ key, client, ledger })
      .then(outcome => logger.info('[storage] upload moved to the bucket', { key, action: outcome.action }))
      .catch(error => logger.warn('[storage] upload stays on disk until the next sweep', { key, err: error.message }));
  });
  return true;
}

/**
 * Put a small file straight into the bucket (a picture). Returns false when
 * the driver is local or the bucket refused — the caller then writes to the
 * disk as before, and records it for the sweep when the driver is s3.
 */
async function putSmallObject(key, buffer, { contentType, cacheControl } = {}) {
  if (!writesToBucket()) return false;
  try {
    const client = remoteStore();
    const stored = await client.put(key, { buffer, contentType, cacheControl });
    await createDbLedger().record(key, { location: 'remote', size: stored.size, sha256: stored.sha256, contentType });
    return true;
  } catch (error) {
    logger.warn('[storage] bucket write failed; kept on disk', { key, err: error.message });
    return false;
  }
}

/** A file written to the disk while the s3 driver is on: the sweep moves it later. */
async function noteLocalWhileBucketOn(key, { size, contentType }) {
  if (!writesToBucket()) return;
  await createDbLedger().record(key, { location: 'local', size, contentType, pendingOffload: true })
    .catch(error => logger.warn('[storage] could not record a local file for the sweep', { key, err: error.message }));
}

/**
 * The value to keep in payment_proofs.proof_image. With the s3 driver the
 * picture goes to the bucket (private: only the image route reads it back)
 * and the row keeps `storage:<key>`; otherwise, or if the bucket refuses, the
 * data URL is kept in the row as before. Returns { value, key } — key is set
 * when an object was written, so the caller can remove it if its transaction
 * rolls back.
 */
async function storeProofImage({ tenantId, proofId, dataUrl, db }) {
  if (!dataUrl || !writesToBucket()) return { value: dataUrl || null, key: null };
  const match = /^data:(image\/[a-z]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl));
  const contentType = match && String(match[1]).toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!match || !PROOF_EXT[contentType]) return { value: dataUrl, key: null };
  const key = `proofs/${tenantId}/${proofId}.${PROOF_EXT[contentType]}`;
  if (!parseKey(key)) return { value: dataUrl, key: null };
  try {
    const stored = await remoteStore().put(key, { buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'), contentType, cacheControl: 'private, no-store' });
    await createDbLedger(db).record(key, { location: 'remote', size: stored.size, sha256: stored.sha256, contentType });
    return { value: `${PROOF_REF}${key}`, key };
  } catch (error) {
    logger.warn('[storage] proof kept in its row: bucket write failed', { key, err: error.message });
    return { value: dataUrl, key: null };
  }
}

/** Remove an object written for a row that was then not saved. */
async function discardObject(key) {
  if (!key) return;
  // Its ledger row went with the rolled-back transaction.
  try { await remoteStore()?.remove(key); } catch (error) { logger.warn('[storage] orphan object left in the bucket', { key, err: error.message }); }
}

/**
 * payment_proofs.proof_image as the admin screen has always received it: a
 * data URL. A `storage:` value is read from the bucket here, behind the same
 * route and the same permission and branch checks as before.
 */
async function readProofImage(value, { client = remoteStore() } = {}) {
  const raw = String(value || '');
  if (!raw.startsWith(PROOF_REF)) return raw || null;
  const key = raw.slice(PROOF_REF.length);
  if (!parseKey(key) || !client) return null;
  const object = await client.getBuffer(key, { maxBytes: 8 * 1024 * 1024 });
  if (!object) return null;
  const extension = key.split('.').pop();
  const contentType = Object.keys(PROOF_EXT).find(type => PROOF_EXT[type] === extension) || 'image/jpeg';
  return `data:${contentType};base64,${object.buffer.toString('base64')}`;
}

module.exports = {
  PROOF_EXT,
  PROOF_REF,
  bucketUrlFor,
  discardObject,
  noteLocalWhileBucketOn,
  putSmallObject,
  queueUploadOffload,
  readProofImage,
  storeProofImage,
  videoUrlLifetime,
};
