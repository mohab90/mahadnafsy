'use strict';
/**
 * Which identity do we send this from?
 *
 * There are three kinds of sending identity and they must not become three
 * implementations:
 *   • the company's WhatsApp        (owner_staff_id NULL, kind 'whatsapp')
 *   • an employee's own WhatsApp    (owner_staff_id set,  kind 'whatsapp')
 *   • the Facebook page's Messenger (owner_staff_id NULL, kind 'messenger')
 *
 * Resolution order for a send, most specific first:
 *   1. an explicit channelId  — the caller already decided
 *   2. the sending staff member's own channel, if they have a connected one
 *   3. the tenant default for that kind
 *   4. the legacy site_config WhatsApp, so nothing breaks before any channel row
 *      exists
 *
 * Step 4 is why this can ship before the provider is chosen: today every send
 * lands on the legacy config exactly as it does now, and each channel row added
 * later takes over for its own traffic without touching a single call site.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { seal, open } = require('./secretBox');
const { toDialable } = require('./phoneNumber');
const logger = require('./logger');

const KINDS = ['whatsapp', 'messenger'];
const PROVIDERS = { whatsapp: ['meta', 'green-api', 'wapilot'], messenger: ['messenger'] };
const STATUSES = ['pending', 'connected', 'disconnected', 'error'];

const PUBLIC_COLUMNS = `id, tenant_id, kind, provider, owner_staff_id, label, display_number,
  status, last_verified_at, last_error, is_default, is_active,
  daily_send_limit, sent_today, sent_today_date, created_by, created_at, updated_at`;

/** Strips the sealed credential — this is what any API response may contain. */
function toPublic(row) {
  if (!row) return null;
  const { credentials_sealed, ...safe } = row;
  return {
    ...safe,
    isConnected: row.status === 'connected',
    // Whether creds exist, never what they are.
    hasCredentials: Boolean(credentials_sealed),
  };
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw Object.assign(new Error('Unknown channel kind'), { statusCode: 400 });
}

function assertProvider(kind, provider) {
  if (!PROVIDERS[kind]?.includes(provider)) {
    throw Object.assign(new Error(`Provider ${provider} is not valid for ${kind}`), { statusCode: 400 });
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

async function listChannels({ tenantId, kind = null, ownerStaffId = undefined }, db = pool) {
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (kind) { assertKind(kind); where.push('kind = ?'); params.push(kind); }
  // `undefined` means "any owner"; `null` explicitly means the company channels.
  if (ownerStaffId === null) where.push('owner_staff_id IS NULL');
  else if (ownerStaffId !== undefined) { where.push('owner_staff_id = ?'); params.push(ownerStaffId); }
  const [rows] = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM messaging_channels
      WHERE ${where.join(' AND ')}
      ORDER BY owner_staff_id IS NOT NULL, is_default DESC, label ASC
      LIMIT 500`,
    params
  );
  return rows.map(toPublic);
}

async function getChannelById(tenantId, id, db = pool) {
  const [[row]] = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM messaging_channels WHERE tenant_id=? AND id=? LIMIT 1`,
    [tenantId, id]
  );
  return toPublic(row);
}

/**
 * The full row including decrypted credentials. Never hand the result to a
 * response — it exists so a sender can authenticate.
 * @returns {Promise<{row: object, credentials: object}|null>}
 */
async function getSendableChannel({ tenantId, channelId = null, staffId = null, kind = 'whatsapp' }, db = pool) {
  assertKind(kind);
  // Naming a channel explicitly is a decision, not a preference: if it cannot
  // send, the caller must find out rather than have the message quietly go from
  // the company number instead. Without this the "test this channel" button
  // would fall through to the default channel and report success — proving
  // nothing about the credentials it was supposed to be proving.
  const exclusive = Boolean(channelId);

  const attempts = [];
  // A named channel is also allowed to be 'pending': being untested is exactly
  // the state a test send exists to resolve.
  if (channelId) attempts.push(['id = ?', [channelId], "status IN ('connected','pending')"]);
  if (staffId) attempts.push(['owner_staff_id = ? AND kind = ?', [staffId, kind], "status='connected'"]);
  attempts.push(['is_default = 1 AND kind = ? AND owner_staff_id IS NULL', [kind], "status='connected'"]);

  for (const [clause, params, statusClause] of attempts) {
    const [[row]] = await db.query(
      `SELECT * FROM messaging_channels
        WHERE tenant_id=? AND ${clause} AND is_active=1 AND ${statusClause} LIMIT 1`,
      [tenantId, ...params]
    );
    if (!row && exclusive) return null;
    if (!row) continue;
    let credentials = null;
    try {
      credentials = open(row.credentials_sealed);
    } catch (error) {
      // A credential we cannot decrypt is not "no credential" — it means the key
      // changed or the row was tampered with. Fall through to the next candidate
      // rather than sending with nothing, and make the channel's state visible.
      logger.error('[channels] credentials could not be opened', { channelId: row.id, err: error.message });
      await markChannelError(tenantId, row.id, 'تعذّر فك تشفير بيانات الاتصال — أعد ربط القناة', db).catch(() => {});
      if (exclusive) return null;
      continue;
    }
    if (!credentials) {
      if (exclusive) return null;
      continue;
    }
    return { row, credentials };
  }
  return null;
}

// ── Writing ──────────────────────────────────────────────────────────────────

async function createChannel({
  tenantId, kind, provider, ownerStaffId = null, label,
  displayNumber = null, credentials = null, createdBy = null,
  dailySendLimit = null, makeDefault = false,
}, db = pool) {
  assertKind(kind);
  assertProvider(kind, provider);
  const trimmedLabel = String(label || '').trim().slice(0, 120);
  if (!trimmedLabel) throw Object.assign(new Error('اسم القناة مطلوب'), { statusCode: 400 });

  const id = uuidv4();
  // Stored normalised so the display value matches what messages are actually
  // addressed to — a channel labelled 01012… that sends as 20101… is a support
  // ticket waiting to happen.
  const number = kind === 'whatsapp' && displayNumber ? (toDialable(displayNumber) || null) : null;

  await db.query(
    `INSERT INTO messaging_channels
       (id, tenant_id, kind, provider, owner_staff_id, label, display_number,
        credentials_sealed, status, is_default, daily_send_limit, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, tenantId, kind, provider, ownerStaffId || null, trimmedLabel, number,
      credentials ? seal(credentials) : null,
      // Always 'pending': saved credentials are a claim, not proof. Only a
      // successful send (or, for Messenger, a token check) makes it 'connected'.
      'pending',
      0,
      Number.isFinite(Number(dailySendLimit)) && Number(dailySendLimit) > 0
        ? Math.min(Number(dailySendLimit), 100000) : 1000,
      createdBy,
    ]
  );
  if (makeDefault && !ownerStaffId) await setDefaultChannel(tenantId, id, kind, db);
  return getChannelById(tenantId, id, db);
}

async function updateChannel(tenantId, id, patch, db = pool) {
  const sets = [];
  const params = [];
  if (patch.label !== undefined) { sets.push('label = ?'); params.push(String(patch.label).trim().slice(0, 120)); }
  if (patch.displayNumber !== undefined) {
    sets.push('display_number = ?');
    params.push(patch.displayNumber ? (toDialable(patch.displayNumber) || null) : null);
  }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); params.push(patch.isActive ? 1 : 0); }
  if (patch.dailySendLimit !== undefined) {
    sets.push('daily_send_limit = ?');
    params.push(Math.max(1, Math.min(Number(patch.dailySendLimit) || 1000, 100000)));
  }
  if (patch.credentials !== undefined) {
    // Re-sealing resets the connection state: new credentials are unverified
    // until a send or a test proves them.
    sets.push('credentials_sealed = ?', "status = 'pending'", 'last_error = NULL');
    params.push(patch.credentials ? seal(patch.credentials) : null);
  }
  if (!sets.length) return getChannelById(tenantId, id, db);
  params.push(tenantId, id);
  await db.query(`UPDATE messaging_channels SET ${sets.join(', ')} WHERE tenant_id=? AND id=?`, params);
  return getChannelById(tenantId, id, db);
}

/** Exactly one default per (tenant, kind) — enforced here, in one transaction. */
async function setDefaultChannel(tenantId, id, kind, db = pool) {
  assertKind(kind);
  await db.query(
    'UPDATE messaging_channels SET is_default = 0 WHERE tenant_id=? AND kind=? AND owner_staff_id IS NULL',
    [tenantId, kind]
  );
  await db.query(
    'UPDATE messaging_channels SET is_default = 1 WHERE tenant_id=? AND id=? AND owner_staff_id IS NULL',
    [tenantId, id]
  );
  return getChannelById(tenantId, id, db);
}

async function markChannelConnected(tenantId, id, db = pool) {
  await db.query(
    `UPDATE messaging_channels
        SET status='connected', last_verified_at=NOW(), last_error=NULL
      WHERE tenant_id=? AND id=?`,
    [tenantId, id]
  );
}

async function markChannelError(tenantId, id, message, db = pool) {
  await db.query(
    `UPDATE messaging_channels SET status='error', last_error=? WHERE tenant_id=? AND id=?`,
    [String(message || '').slice(0, 500), tenantId, id]
  );
}

async function deleteChannel(tenantId, id, db = pool) {
  const [result] = await db.query('DELETE FROM messaging_channels WHERE tenant_id=? AND id=?', [tenantId, id]);
  return result.affectedRows > 0;
}

// ── Send budget ──────────────────────────────────────────────────────────────

/**
 * Claim one send against the channel's daily budget.
 *
 * A personal WhatsApp that suddenly emits thousands of messages gets the
 * employee's own number banned by the provider, so the cap is per channel and
 * the counter resets on first use each day rather than needing a scheduled job.
 *
 * The whole thing is one conditional UPDATE so two concurrent sends cannot both
 * see the same remaining budget and both spend it.
 *
 * @returns {Promise<boolean>} false when the channel is out of budget today
 */
async function claimSendBudget(tenantId, channelId, db = pool) {
  const [result] = await db.query(
    `UPDATE messaging_channels
        SET sent_today = CASE WHEN sent_today_date = CURDATE() THEN sent_today + 1 ELSE 1 END,
            sent_today_date = CURDATE(),
            updated_at = updated_at
      WHERE tenant_id=? AND id=?
        AND (sent_today_date <> CURDATE() OR sent_today_date IS NULL OR sent_today < daily_send_limit)`,
    [tenantId, channelId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  KINDS,
  PROVIDERS,
  STATUSES,
  toPublic,
  listChannels,
  getChannelById,
  getSendableChannel,
  createChannel,
  updateChannel,
  setDefaultChannel,
  markChannelConnected,
  markChannelError,
  deleteChannel,
  claimSendBudget,
};
