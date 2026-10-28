'use strict';

// storage_objects (migration 325): where each uploaded file lives while files
// move between this server's disk and the bucket (lib/objectStorage.js).
//
//   local  — on the disk only (or, for a payment proof, in its row only)
//   both   — copied to the bucket and verified; the local copy is still kept
//   remote — in the bucket only
//
// A file with no row has never been moved: it is on the disk, as every file
// was before. The move tool (tools/move-uploads-to-storage.cjs) and the
// offload of new uploads (lib/storageOffload.js) are the only writers, and they
// write `both` only after the bucket's own size and SHA-256 agree with the
// file, and `remote` only after checking that again just before deleting.

const { parseKey } = require('./objectStorage');

const LOCATIONS = Object.freeze(['local', 'both', 'remote']);

function rowOut(row) {
  if (!row) return null;
  return {
    key: row.object_key,
    tenantId: row.tenant_id,
    kind: row.kind,
    location: row.location,
    size: row.size_bytes == null ? null : Number(row.size_bytes),
    sha256: row.sha256 || null,
    contentType: row.content_type || null,
    pendingOffload: Boolean(row.pending_offload),
    lastError: row.last_error || null,
  };
}

function keyParts(key) {
  const parsed = parseKey(key);
  if (!parsed) throw new Error(`Invalid storage key: ${key}`);
  return parsed;
}

/** The ledger on a database pool or connection (a transaction's, for a proof). */
function createDbLedger(db) {
  const pool = () => db || require('./db').pool;
  return {
    async get(key) {
      const { tenantId } = keyParts(key);
      const [[row]] = await pool().query('SELECT * FROM storage_objects WHERE object_key=? AND tenant_id=? LIMIT 1', [key, tenantId]);
      return rowOut(row);
    },
    /** Create or replace the facts about one file. */
    async record(key, { location, size = null, sha256 = null, contentType = null, pendingOffload = false }) {
      if (!LOCATIONS.includes(location)) throw new Error(`Invalid storage location: ${location}`);
      const { tenantId, kind } = keyParts(key);
      await pool().query(
        `INSERT INTO storage_objects (object_key, tenant_id, kind, location, size_bytes, sha256, content_type, pending_offload, copied_at, local_deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? IN ('both','remote'), NOW(), NULL), IF(?='remote', NOW(), NULL))
         ON DUPLICATE KEY UPDATE location=VALUES(location), size_bytes=VALUES(size_bytes), sha256=VALUES(sha256),
           content_type=VALUES(content_type), pending_offload=VALUES(pending_offload), last_error=NULL,
           copied_at=IF(VALUES(location) IN ('both','remote'), COALESCE(copied_at, NOW()), NULL),
           local_deleted_at=IF(VALUES(location)='remote', COALESCE(local_deleted_at, NOW()), NULL)`,
        [key, tenantId, kind, location, size, sha256, contentType, pendingOffload ? 1 : 0, location, location]
      );
    },
    /** Change the location of a file already recorded; false if it has no row. */
    async setLocation(key, location, { pendingOffload } = {}) {
      if (!LOCATIONS.includes(location)) throw new Error(`Invalid storage location: ${location}`);
      const { tenantId } = keyParts(key);
      const [result] = await pool().query(
        `UPDATE storage_objects
            SET location=?, last_error=NULL, claimed_until=NULL,
                pending_offload=COALESCE(?, pending_offload),
                copied_at=IF(? IN ('both','remote'), COALESCE(copied_at, NOW()), copied_at),
                local_deleted_at=IF(?='remote', NOW(), NULL)
          WHERE object_key=? AND tenant_id=?`,
        [location, pendingOffload == null ? null : (pendingOffload ? 1 : 0), location, location, key, tenantId]
      );
      return result.affectedRows > 0;
    },
    async noteError(key, message) {
      const { tenantId } = keyParts(key);
      await pool().query('UPDATE storage_objects SET last_error=?, claimed_until=NULL WHERE object_key=? AND tenant_id=?',
        [String(message || '').slice(0, 500), key, tenantId]);
    },
    /** Take a file for `seconds` so a second process leaves it alone. */
    async claim(key, seconds = 30 * 60) {
      const { tenantId } = keyParts(key);
      const [result] = await pool().query(
        `UPDATE storage_objects SET claimed_until=DATE_ADD(NOW(), INTERVAL ? SECOND)
          WHERE object_key=? AND tenant_id=? AND (claimed_until IS NULL OR claimed_until < NOW())`,
        [Math.max(1, Math.floor(seconds)), key, tenantId]
      );
      return result.affectedRows > 0;
    },
    async release(key) {
      const { tenantId } = keyParts(key);
      await pool().query('UPDATE storage_objects SET claimed_until=NULL WHERE object_key=? AND tenant_id=?', [key, tenantId]);
    },
    /** New uploads still waiting to be moved by the API (every tenant: a system job). */
    async pending(limit = 20) {
      const [rows] = await pool().query(
        `SELECT object_key, tenant_id, kind, location, size_bytes, sha256, content_type, pending_offload, last_error
           FROM storage_objects
          WHERE pending_offload=1 AND location<>'remote' AND (claimed_until IS NULL OR claimed_until < NOW())
          ORDER BY created_at LIMIT ?`,
        [Math.max(1, Math.min(Number(limit) || 20, 500))]
      );
      return rows.map(rowOut);
    },
    /** Every file in one location (the move tool's rollback and report). */
    async inLocation(location, { kinds = ['video', 'image', 'proof'] } = {}) {
      const [rows] = await pool().query(
        `SELECT object_key, tenant_id, kind, location, size_bytes, sha256, content_type, pending_offload, last_error
           FROM storage_objects WHERE location=? AND kind IN (?) ORDER BY tenant_id, object_key`,
        [location, kinds]
      );
      return rows.map(rowOut);
    },
  };
}

module.exports = { LOCATIONS, createDbLedger, rowOut };
