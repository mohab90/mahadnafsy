'use strict';

/**
 * «مين فاتح السيستم دلوقتي» (7 Nov 2026): which members of staff are in the panel and when each one last did something.
 *
 * Two things feed it: the panel's own beat (POST /api/staff/presence, every 60 s while the tab is visible, and at once when a screen is opened) and every
 * successful write (middleware/adminAudit.js). Neither writes per request: the latest state of each person is kept in memory and goes to staff_presence at most
 * once a minute per person (WRITE_EVERY_MS), so thirty people clicking all day cost thirty writes a minute at the very most. What waits in memory is at worst one
 * minute old when the next event flushes it; a restart loses nothing but that minute. Rows from two instances merge in the database (the later action wins).
 *
 * The thresholds are the owner's: «online» within two minutes of the last sign of life, «idle» within fifteen, otherwise offline.
 */

const { pool } = require('./db');
const { cairoToday } = require('./dates');

const ONLINE_MS = 2 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const WRITE_EVERY_MS = 60 * 1000;

const state = new Map();
const keyOf = (tenantId, staffKey) => `${tenantId}:${staffKey}`;

/** online | idle | offline, by how long ago the last sign of life was. */
function statusOf(lastSeenMs, now = Date.now()) {
  if (!Number.isFinite(lastSeenMs)) return 'offline';
  const age = now - lastSeenMs;
  if (age < ONLINE_MS) return 'online';
  if (age < IDLE_MS) return 'idle';
  return 'offline';
}

/** The person a request belongs to: their staff row, or the owner's own login (who has no staff row). */
function whoIs(req) {
  const staff = req.staffRecord;
  const key = staff?.id || req.user?.uid;
  if (!key) return null;
  return {
    tenantId: req.tenantId, staffKey: String(key).slice(0, 100),
    name: String(staff?.name || req.user?.name || (req.isSuperAdmin ? 'المالك' : '')).slice(0, 255),
    role: String(staff?.role || (req.isSuperAdmin ? 'OWNER' : '')).slice(0, 40),
  };
}

async function flush(entry) {
  entry.flushedAt = entry.at;
  const seen = new Date(entry.lastSeenAt);
  const acted = entry.lastActionAt ? new Date(entry.lastActionAt) : null;
  // The label goes before the time it belongs to: MySQL evaluates the assignments left to right, so the comparison sees the stored time, not the new one.
  await pool.query(
    `INSERT INTO staff_presence (tenant_id, staff_key, name, role, screen, last_seen_at, last_action_at, last_action_kind, last_action_label, seen_day, first_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), role = VALUES(role), screen = COALESCE(VALUES(screen), screen),
       first_seen_at = IF(seen_day = VALUES(seen_day), LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at)),
       seen_day = VALUES(seen_day),
       last_action_kind = IF(VALUES(last_action_at) IS NOT NULL AND (last_action_at IS NULL OR VALUES(last_action_at) >= last_action_at), VALUES(last_action_kind), last_action_kind),
       last_action_label = IF(VALUES(last_action_at) IS NOT NULL AND (last_action_at IS NULL OR VALUES(last_action_at) >= last_action_at), VALUES(last_action_label), last_action_label),
       last_action_at = GREATEST(COALESCE(last_action_at, VALUES(last_action_at)), COALESCE(VALUES(last_action_at), last_action_at)),
       last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))`,
    [entry.tenantId, entry.staffKey, entry.name, entry.role, entry.screen || null, seen, acted, entry.lastActionKind || null,
      entry.lastActionLabel || null, entry.day, new Date(entry.firstSeenAt)]);
}

/**
 * Records a sign of life from `who` (see whoIs). `action` is a write or a screen opened ({ kind: 'write' | 'screen', label }); a bare beat is only «still here».
 * Resolves true when it wrote to the database. Never throws: presence is not worth failing a request for.
 */
async function notePresence(who, { screen = null, action = null, now = Date.now() } = {}) {
  if (!who) return false;
  const key = keyOf(who.tenantId, who.staffKey);
  const entry = state.get(key) || { ...who, firstSeenAt: now, flushedAt: 0, day: cairoToday(new Date(now)) };
  const day = cairoToday(new Date(now));
  if (entry.day !== day) { entry.day = day; entry.firstSeenAt = now; }
  Object.assign(entry, { name: who.name || entry.name, role: who.role || entry.role, at: now, lastSeenAt: now });
  if (screen) entry.screen = String(screen).slice(0, 64);
  if (action) { entry.lastActionAt = now; entry.lastActionKind = action.kind; entry.lastActionLabel = String(action.label || '').slice(0, 255); }
  state.set(key, entry);
  if (now - entry.flushedAt < WRITE_EVERY_MS) return false;
  try { await flush(entry); return true; } catch { entry.flushedAt = 0; return false; }
}

/** Writes what is still only in memory (an action inside the last minute with nothing after it), so the screen never shows an older last action. */
async function flushPresence() {
  for (const entry of state.values()) {
    if (entry.at > entry.flushedAt) {
      try { await flush(entry); } catch { entry.flushedAt = 0; }
    }
  }
}

/** The people of the tenant with how long ago each was last seen and last acted, newest first. */
async function listPresence(tenantId, { now = Date.now() } = {}) {
  const [rows] = await pool.query(
    `SELECT staff_key, name, role, screen, last_seen_at, last_action_at, last_action_kind, last_action_label, DATE_FORMAT(seen_day, '%Y-%m-%d') AS seen_day, first_seen_at
       FROM staff_presence WHERE tenant_id = ? AND last_seen_at >= ? ORDER BY last_seen_at DESC`,
    [tenantId, new Date(now - 24 * 3600 * 1000)]);
  const day = cairoToday(new Date(now));
  return rows.map(row => ({
    staffKey: row.staff_key, name: row.name || '', role: row.role || '', screen: row.screen || null,
    lastSeenAt: new Date(row.last_seen_at).getTime(),
    lastActionAt: row.last_action_at ? new Date(row.last_action_at).getTime() : null,
    lastActionKind: row.last_action_kind || null, lastActionLabel: row.last_action_label || null,
    // The first beat of the day, the only «sign-in time» the panel knows; a row from an earlier day has none for today.
    firstSeenToday: row.seen_day === day ? new Date(row.first_seen_at).getTime() : null,
  }));
}

const resetPresenceForTests = () => state.clear();

module.exports = { ONLINE_MS, IDLE_MS, WRITE_EVERY_MS, statusOf, whoIs, notePresence, flushPresence, listPresence, resetPresenceForTests };
