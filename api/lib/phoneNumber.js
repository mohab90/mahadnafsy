'use strict';
/**
 * One place that decides what a phone number *is*.
 *
 * The system needs a number in two different shapes and had been computing both
 * ad hoc, in three places, with three different results:
 *
 *   identity  — "are these two records the same person?" and "which account owns
 *               this number?". Country code and trunk zero stripped, so every
 *               spelling of one number collapses to a single comparable key.
 *   dialable  — what actually gets handed to WhatsApp. Meta's Cloud API and
 *               Green-API both address a recipient by full international number,
 *               so this one MUST carry the country code.
 *
 * Conflating them is not cosmetic. lib/whatsapp.js used to build the delivery
 * address as `digits.replace(/^0+/, '')`, which turns 01012345678 into
 * 1012345678 — a number that exists nowhere. Every message to a number stored in
 * local Egyptian form (which is how customers type it and how the lead forms
 * captured it) was addressed to nobody, and the provider's rejection was logged
 * at warn level and otherwise ignored.
 */

// Egypt. The institute operates here, and it is the only country whose code is
// stripped for the identity key — see toIdentity below.
const DEFAULT_COUNTRY_CODE = String(process.env.WA_DEFAULT_COUNTRY_CODE || '20');

// Egyptian mobile: 10 national digits, always 10 / 11 / 12 / 15 after the trunk
// zero. Deliberately strict — a number that does not match keeps whatever
// country code it already carries rather than being guessed at.
const EG_MOBILE_NATIONAL = /^1[0125]\d{8}$/;

/**
 * The comparison key. Digits only, no country code for local numbers, no trunk
 * zero. Non-Egyptian numbers keep their own country code so they stay distinct.
 * Junk returns '' rather than something that could accidentally match a record.
 */
function toIdentity(input) {
  let digits = String(input == null ? '' : input).replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^00/, '');                  // 00<country> → <country>
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    digits = digits.slice(DEFAULT_COUNTRY_CODE.length);
  }
  return digits.replace(/^0+/, '');                    // local trunk prefix
}

/**
 * The delivery address: full international number, digits only, no '+'.
 * Returns '' when the input cannot be dialled, so callers can refuse to send
 * instead of handing the provider an address that will never arrive.
 */
function toDialable(input) {
  const identity = toIdentity(input);
  if (!identity) return '';
  // A bare Egyptian national number is the one case we can safely complete.
  if (EG_MOBILE_NATIONAL.test(identity)) return `${DEFAULT_COUNTRY_CODE}${identity}`;
  // 11 digits or more means a country code is already in there (a Saudi mobile is
  // 12, a US number 11) — send it as it stands rather than inventing ours.
  if (identity.length >= 11 && isPlausible(identity)) return identity;
  // What's left is a local number with no country code and no way to complete it
  // — a 9-digit Cairo landline, say. Undialable is the honest answer: guessing a
  // country code here would address a live mobile belonging to someone else.
  return '';
}

/** Length sanity: shorter or longer than this cannot be a real number. */
function isPlausible(digits) {
  return /^\d{9,15}$/.test(String(digits || ''));
}

/**
 * Every digits-only spelling that means this same number, for matching against
 * columns that were never normalised.
 *
 * Callers used to find those rows with `REGEXP_REPLACE(phone,...) LIKE '%<id>'`.
 * A trailing wildcard does not mean "the same number" — it means "ends with
 * these digits", and an identity may be as short as 9 digits while a stored
 * number may be 15. A subscriber stored as 966501234567 is matched by the
 * identity 66501234567, which is a different country and a different person.
 * That let one customer's record be adopted by whoever asked for a code on a
 * number that merely shared its tail.
 *
 * An exact set costs the same to evaluate and cannot match a different number.
 */
function identitySpellings(input) {
  const identity = toIdentity(input);
  // Length-checked, not merely non-empty: callers build a WHERE term out of
  // this, and '123' would otherwise become a term that matches whatever row
  // happens to hold those digits.
  if (!isPlausible(identity)) return [];
  const out = new Set([identity, `0${identity}`]);
  // Only a number we can recognise as Egyptian gets the country code put back:
  // prefixing it onto a foreign identity would invent a spelling that means
  // someone else.
  if (EG_MOBILE_NATIONAL.test(identity)) {
    out.add(`${DEFAULT_COUNTRY_CODE}${identity}`);
    out.add(`${DEFAULT_COUNTRY_CODE}0${identity}`);
    out.add(`00${DEFAULT_COUNTRY_CODE}${identity}`);
  }
  return [...out];
}

/** True when this number can actually receive a WhatsApp message. */
function isDialable(input) {
  return toDialable(input) !== '';
}

/** Pretty form for display and for links: +20 101 234 5678 → +201012345678 */
function toDisplay(input) {
  const dialable = toDialable(input);
  return dialable ? `+${dialable}` : '';
}

module.exports = {
  DEFAULT_COUNTRY_CODE,
  toIdentity,
  toDialable,
  toDisplay,
  isDialable,
  isPlausible,
  identitySpellings,
};
