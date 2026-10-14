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

module.exports = { spellingsOf, clientHoldingPhone, phoneInUse };
