'use strict';

// «العميلة دي بتدخل على حسابها تلاقي مفيش كورسات كأنها حساب جديد»: a client's site account is tied to their client record by number or e-mail (lib/subscriberIdentity.js).
// One who registered on the site with an e-mail while the record holds only a phone number matches neither, and signs in to an empty account. The name alone
// can never link them by itself — anyone could type a client's name at sign-up and be given their courses and payments — so a person on the staff, who
// has seen both, links them here: the suggestions come from the name; the link is theirs to make, and it is written in the client's history.

const { normalizeArabicName } = require('./linkSiteAccounts');
const { logClientEvent } = require('./clientHistory');

const MIN_SHARED_WORDS = 3;

/** How many words two names share, after the spellings are folded; a full match counts as every word. */
function sharedWords(a, b) {
  const first = normalizeArabicName(a).split(' ').filter(Boolean);
  const second = new Set(normalizeArabicName(b).split(' ').filter(Boolean));
  return first.filter(word => second.has(word)).length;
}

/** The client records that might be this account's owner, best first. */
async function candidatesFor(db, { tenantId, userId }) {
  const [[user]] = await db.query('SELECT id, name, email, phone FROM users WHERE id=? AND tenant_id=? LIMIT 1', [userId, tenantId]);
  if (!user) return null;
  const words = normalizeArabicName(user.name).split(' ').filter(word => word.length > 1);
  if (words.length < 2) return { user, candidates: [] };
  const [rows] = await db.query(
    `SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.firebase_uid,
            EXISTS (SELECT 1 FROM users lu WHERE lu.id = s.firebase_uid AND lu.tenant_id = s.tenant_id) AS has_live_account
       FROM subscribers s
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (s.name LIKE ? OR s.name LIKE ?)
      LIMIT 200`,
    [tenantId, `%${words[0]}%`, `%${words[words.length - 1]}%`]);
  const needed = Math.min(MIN_SHARED_WORDS, words.length);
  const candidates = rows
    .map(row => ({ ...row, score: sharedWords(user.name, row.name) }))
    .filter(row => row.score >= needed)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(row => ({
      id: row.id, clientCode: row.client_code || null, name: row.name, phone: row.phone || null, email: row.email || null, branch: row.branch || null,
      linkedToLiveAccount: Number(row.has_live_account) === 1 && row.firebase_uid !== userId,
      score: row.score,
    }));
  return { user, candidates };
}

/**
 * Link the account to the client's record (inside the caller's transaction). A record that belongs to another LIVE account, or an account that already
 * owns another record, is only moved when the caller says so (`force`): that is the case of an empty record made for the account, which is let go.
 */
async function linkSiteAccount(db, { tenantId, userId, subscriberId, force = false, actor }) {
  const [[user]] = await db.query('SELECT id, name, email, phone, email_unverified FROM users WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [userId, tenantId]);
  if (!user) return { ok: false, status: 404, error: 'حساب الموقع مش موجود' };
  const [[staff]] = await db.query("SELECT id FROM staff WHERE tenant_id=? AND deleted_at IS NULL AND email<>'' AND email=? LIMIT 1", [tenantId, user.email]);
  if (staff) return { ok: false, status: 409, error: 'ده حساب موظف مش حساب عميل' };
  const [[subscriber]] = await db.query(
    `SELECT s.id, s.name, s.email, s.client_code, s.firebase_uid,
            EXISTS (SELECT 1 FROM users lu WHERE lu.id = s.firebase_uid AND lu.tenant_id = s.tenant_id) AS has_live_account
       FROM subscribers s WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [tenantId, subscriberId]);
  if (!subscriber) return { ok: false, status: 404, error: 'العميل مش موجود' };
  if (subscriber.firebase_uid === userId) return { ok: true, already: true, clientCode: subscriber.client_code };
  if (Number(subscriber.has_live_account) === 1 && !force) {
    return { ok: false, status: 409, code: 'CLIENT_HAS_ACCOUNT', error: 'العميل ده مربوط بحساب موقع تاني شغال — لو متأكد اربطه بالقوة' };
  }
  const [[other]] = await db.query('SELECT id, name, client_code FROM subscribers WHERE tenant_id=? AND firebase_uid=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [tenantId, userId]);
  if (other && !force) {
    return { ok: false, status: 409, code: 'ACCOUNT_HAS_CLIENT', error: `الحساب ده مربوط بالفعل بسجل ${other.name || ''} ${other.client_code || ''} — لو ده سجل فاضي اربطه بالقوة` };
  }
  // The UNIQUE (tenant_id, firebase_uid) key: the other record lets go before this one takes the account.
  await db.query('UPDATE subscribers SET firebase_uid=NULL, updated_at=updated_at WHERE tenant_id=? AND firebase_uid=?', [tenantId, userId]);
  await db.query('UPDATE subscribers SET firebase_uid=NULL, updated_at=updated_at WHERE tenant_id=? AND id=?', [tenantId, subscriberId]);
  await db.query(
    `UPDATE subscribers SET firebase_uid=?, email=COALESCE(NULLIF(email, ''), ?), updated_at=updated_at WHERE tenant_id=? AND id=?`,
    [userId, user.email || null, tenantId, subscriberId]);
  await logClientEvent(db, {
    tenantId, subscriberId, action: 'site_account_linked', actor,
    label: `ربط حساب الموقع (${user.email || user.phone || user.id}) بسجل العميل${other ? ` — وفُكّ عن السجل ${other.client_code || other.id}` : ''}`,
  });
  return { ok: true, clientCode: subscriber.client_code, released: other ? other.id : null };
}

module.exports = { candidatesFor, linkSiteAccount, sharedWords };
