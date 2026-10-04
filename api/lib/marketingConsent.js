'use strict';

const crypto = require('crypto');
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { resolveSecret } = require('./secretResolver');
const { toDialable } = require('./phoneNumber');

const SUBJECT_TABLES = Object.freeze({ lead: 'leads', subscriber: 'subscribers' });
const CHANNEL_COLUMNS = Object.freeze({ email: 'email', sms: 'phone', whatsapp: 'phone' });

function tokenSecret() {
  const secret = resolveSecret('MARKETING_TOKEN_SECRET') || resolveSecret('JWT_SECRET');
  if (!secret || String(secret).length < 32) throw new Error('Marketing token secret is not configured');
  return String(secret);
}

// A number is kept in the form it is dialled in (201012345678), however the
// record spells it. It used to be the digits as written, so an opt-out saved
// from a lead stored as 01012345678 never matched the campaign checking
// 201012345678, and the person who said stop kept getting promotions.
const PHONE_CHANNELS = new Set(['sms', 'whatsapp']);

function normalizeDestination(channel, value) {
  const raw = String(value || '').trim();
  if (channel === 'email') return raw.toLowerCase();
  if (PHONE_CHANNELS.has(channel)) return toDialable(raw) || raw.replace(/\D/g, '');
  return raw;
}

function destinationHash(channel, value) {
  return crypto.createHash('sha256').update(`${channel}:${normalizeDestination(channel, value)}`).digest('hex');
}

/** The hash an opt-out saved before numbers were normalised carries. */
function legacyPhoneHash(channel, value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? crypto.createHash('sha256').update(`${channel}:${digits}`).digest('hex') : null;
}

/** Every hash this destination may have been suppressed under. */
function hashesOf(channel, value) {
  const hashes = [destinationHash(channel, value)];
  if (PHONE_CHANNELS.has(channel)) {
    const legacy = legacyPhoneHash(channel, value);
    if (legacy && legacy !== hashes[0]) hashes.push(legacy);
  }
  return hashes;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createUnsubscribeToken({ tenantId, subjectType, subjectId, channel = 'email', expiresInDays = 365 }) {
  if (!tenantId || !SUBJECT_TABLES[subjectType] || !CHANNEL_COLUMNS[channel] || !subjectId) throw new Error('Invalid marketing token subject');
  const payload = encode({ tenantId, subjectType, subjectId, channel, exp: Date.now() + expiresInDays * 86400000 });
  const signature = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyUnsubscribeToken(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) throw new Error('Invalid unsubscribe token');
  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Invalid unsubscribe token');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.exp || data.exp < Date.now() || !data.tenantId || !SUBJECT_TABLES[data.subjectType] || !CHANNEL_COLUMNS[data.channel]) throw new Error('Expired or invalid unsubscribe token');
  return data;
}

async function setMarketingConsent({ tenantId, subjectType, subjectId, channel, subscribed, source, actor = null }, db = null) {
  const table = SUBJECT_TABLES[subjectType];
  const column = CHANNEL_COLUMNS[channel];
  if (!tenantId || !table || !column || !subjectId || !source) throw new Error('Invalid consent change');
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[subject]] = await conn.query(
      `SELECT id,${column} AS destination FROM ${table} WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [subjectId, tenantId]
    );
    if (!subject || !normalizeDestination(channel, subject.destination)) {
      const error = new Error('Marketing subject not found'); error.statusCode = 404; throw error;
    }
    const hash = destinationHash(channel, subject.destination);
    if (subscribed) {
      const hashes = hashesOf(channel, subject.destination);
      await conn.query(
        `DELETE FROM marketing_suppressions WHERE tenant_id=? AND channel=? AND destination_hash IN (${hashes.map(() => '?').join(',')})`,
        [tenantId, channel, ...hashes]);
    } else {
      await conn.query(
        `INSERT INTO marketing_suppressions (tenant_id,channel,destination_hash,subject_type,subject_id)
         VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE subject_type=VALUES(subject_type),subject_id=VALUES(subject_id),suppressed_at=NOW()`,
        [tenantId, channel, hash, subjectType, subjectId]
      );
    }
    await conn.query(
      `INSERT INTO marketing_consent_audit (id,tenant_id,subject_type,subject_id,channel,action,source,actor)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), tenantId, subjectType, subjectId, channel, subscribed ? 'resubscribed' : 'unsubscribed', source, actor]
    );
    if (ownsConnection) await conn.commit();
    return { ok: true, subscribed, channel };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

async function filterSuppressed(tenantId, channel, recipients, key, db = pool) {
  const unique = [...new Set(recipients.flatMap(item => hashesOf(channel, item[key])).filter(Boolean))];
  if (!unique.length) return recipients;
  const blocked = new Set();
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const [rows] = await db.query(
      `SELECT destination_hash FROM marketing_suppressions WHERE tenant_id=? AND channel=? AND destination_hash IN (${batch.map(() => '?').join(',')})`,
      [tenantId, channel, ...batch]
    );
    rows.forEach(row => blocked.add(row.destination_hash));
  }
  return recipients.filter(item => !hashesOf(channel, item[key]).some(hash => blocked.has(hash)));
}

module.exports = { createUnsubscribeToken, verifyUnsubscribeToken, setMarketingConsent, filterSuppressed, destinationHash, normalizeDestination };
