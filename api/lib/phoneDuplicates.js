'use strict';

// One number, one client.
//
// «خلي مطابقة رقم الهاتف تكون ب10 ارقام … ونمنع اي تكرار» (14 Oct 2026). The number is compared by
// its identity — the ten digits of an Egyptian mobile (lib/phoneNumber.js), however it was typed —
// against the client's first AND second number. This is the one question every save asks.

const { identitySpellings, toIdentity } = require('./phoneNumber');

/** Every stored spelling of the numbers given, for an IN (?) — empty when none is a real number. */
function spellingsOf(...phones) {
  return [...new Set(phones.flatMap(phone => {
    const identity = toIdentity(phone);
    return identity ? [identity, ...identitySpellings(identity)] : [];
  }))];
}

/**
 * The client who already holds one of these numbers, as their first or second, or null.
 * `exceptId` leaves out the client being edited.
 */
async function clientHoldingPhone(db, { tenantId, phones, exceptId = '' }) {
  const spellings = spellingsOf(...[].concat(phones));
  if (!spellings.length) return null;
  const [rows] = await db.query(
    `SELECT id, client_code, name, phone, phone2 FROM subscribers
      WHERE tenant_id = ? AND deleted_at IS NULL AND id <> ? AND (phone IN (?) OR phone2 IN (?)) LIMIT 1`,
    [tenantId, exceptId || '', spellings, spellings]);
  return rows[0] || null;
}

/** The refusal a screen shows, naming who has the number. */
function phoneInUse(holder) {
  const who = `${holder.name || 'عميل'}${holder.client_code ? ` (${holder.client_code})` : ''}`;
  return {
    status: 409,
    body: {
      error: `الرقم ده متسجّل قبل كده للعميل ${who} — افتح ملفه بدل ما تسجّله من جديد.`,
      code: 'PHONE_IN_USE', existingId: holder.id, existingName: holder.name || null, existingCode: holder.client_code || null,
    },
  };
}

// ── Two people, one number — on purpose ─────────────────────────────────────────
// «العميل بيجيب صاحبه … فبيبقى نفس رقم التليفون لحسابين» (15 Oct 2026). Never by accident: a member of staff
// names the client already holding the number and gives the reason, and the new account is linked to it.
const SHARED_RELATIONS = Object.freeze({ friend: 'صاحب / صاحبة', relative: 'قريب / قريبة', spouse: 'زوج / زوجة', colleague: 'زميل / زميلة', other: 'آخر' });
const MAX_SHARERS = 4;

/**
 * Whether `phone` may be given to a second person, and on which slot. `sharedWithId` is the client who holds it.
 * Returns { ok: true, slot, primaryId, holder } or { ok: false, status, body }.
 */
async function sharedPhoneSlot(db, { tenantId, phone, sharedWithId, reason, relation }) {
  const why = String(reason || '').trim();
  if (why.length < 3) return { ok: false, status: 400, body: { error: 'اكتب سبب إن الرقم ده بيخص شخصين (مثلاً: صاحبه بيستخدم نفس الرقم)', code: 'SHARED_PHONE_REASON' } };
  if (!SHARED_RELATIONS[relation]) return { ok: false, status: 400, body: { error: 'اختار صلة الشخص بصاحب الرقم', code: 'SHARED_PHONE_RELATION' } };
  const spellings = spellingsOf(phone);
  if (!spellings.length) return { ok: false, status: 400, body: { error: 'الرقم غير صحيح', code: 'SHARED_PHONE_NUMBER' } };
  const [[holder]] = await db.query(
    `SELECT id, name, client_code, phone, phone_slot, phone_shared_with FROM subscribers
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND phone IN (?) LIMIT 1`, [sharedWithId, tenantId, spellings]);
  if (!holder) return { ok: false, status: 409, body: { error: 'العميل اللي اخترته مش صاحب الرقم ده — افتح ملفه وراجع.', code: 'SHARED_PHONE_HOLDER' } };
  const [[top]] = await db.query('SELECT COUNT(*) AS n, COALESCE(MAX(phone_slot), 0) AS slot FROM subscribers WHERE tenant_id = ? AND deleted_at IS NULL AND phone IN (?)', [tenantId, spellings]);
  if (Number(top.n) > MAX_SHARERS) return { ok: false, status: 409, body: { error: 'الرقم ده عليه أكتر من عدد حسابات مسموح — راجع الإدارة.', code: 'SHARED_PHONE_LIMIT' } };
  return { ok: true, slot: Number(top.slot) + 1, primaryId: holder.phone_shared_with || holder.id, holder };
}

/** The link, written on both clients' files, so neither is a mystery to whoever opens it. */
async function recordSharedPhone(db, { tenantId, newId, newName, sharing, actor }) {
  const { logClientEvent } = require('./clientHistory');
  const relation = SHARED_RELATIONS[sharing.relation] || sharing.relation;
  const holder = sharing.holder;
  await logClientEvent(db, {
    tenantId, subscriberId: newId, action: 'phone_shared', actor,
    label: `اتفتح حساب مرتبط بنفس رقم ${holder.name || 'عميل'}${holder.client_code ? ` (${holder.client_code})` : ''} — ${relation}. السبب: ${sharing.reason}`,
  });
  await logClientEvent(db, {
    tenantId, subscriberId: holder.id, action: 'phone_shared', actor,
    label: `اتفتح حساب تاني بنفس رقمه لـ«${newName || 'عميل'}» (${relation}). السبب: ${sharing.reason}`,
  });
}

module.exports = { spellingsOf, clientHoldingPhone, phoneInUse, sharedPhoneSlot, recordSharedPhone, SHARED_RELATIONS, MAX_SHARERS };
