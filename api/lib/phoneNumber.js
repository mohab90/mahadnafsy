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
// ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ → 0123456789. `\D` treats Arabic-Indic digits as
// not-digits, so a number typed on an Arabic keyboard collapsed to nothing.
const latinDigits = value => String(value)
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0));

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
  let digits = latinDigits(String(input == null ? '' : input)).replace(/\D/g, '');
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
  // A Saudi mobile is written 05XXXXXXXX, 5XXXXXXXX and 9665XXXXXXXX alike.
  const saudi = /^966(5\d{8})$/.exec(identity);
  if (saudi) {
    out.add(saudi[1]);
    out.add(`0${saudi[1]}`);
    out.add(`00${identity}`);
  }
  return [...out];
}

/**
 * identitySpellings, plus the Saudi spelling a local 5XXXXXXXX number may have
 * been stored under — for "is this number already in the CRM?", never for
 * sign-in or account adoption.
 *
 * identitySpellings('966501234567') finds 0501234567, but identitySpellings
 * ('0501234567') does not find 966501234567, so a Saudi client stored with
 * their code was a stranger to the same number typed locally, and the desk
 * filed them twice. The reverse is left out of identitySpellings itself on
 * purpose: 050… is also a Mansoura landline, and a code request for one must
 * not adopt a Saudi client's account. Flagging a possible duplicate is safe.
 */
function matchingSpellings(input) {
  const out = new Set(identitySpellings(input));
  const identity = toIdentity(input);
  if (out.size && SA_MOBILE_NATIONAL.test(identity)) {
    out.add(`966${identity}`);
    out.add(`00966${identity}`);
  }
  return [...out];
}

// A Saudi mobile as Saudis write it: 05XXXXXXXX, or 5XXXXXXXX without the
// zero. It carries no country code, so it could not be dialled, and the payment
// route refused every booking for a Saudi client written that way (9 leads and
// 2 clients on 6 Oct). It is also the shape of some Egyptian landlines — 050…
// is Mansoura — so it is completed only for a client in the Saudi branch.
const SA_MOBILE_NATIONAL = /^5\d{8}$/;

/** The number with 966 put in front when it is a Saudi client's local mobile; otherwise as given. */
function completeForBranch(input, branch) {
  const identity = toIdentity(input);
  const saudi = String(branch || '').trim().toUpperCase().replace(/[-\s]+/g, '_') === 'ONLINE_SAUDI';
  return saudi && SA_MOBILE_NATIONAL.test(identity) ? `966${identity}` : tidyTyped(input);
}

/**
 * A number as people type an international one — «+966 50 123 4567», «00966-50…»,
 * «(+44) 7911 123456» — in the one shape the system stores: digits, the country
 * code in front, no «+», no separators. «+966 50 123 4567» was stored as typed,
 * so the same client written «966501234567» was not found, and a Saudi or an
 * international booking registered the client a second time. A local number
 * (010 1234 5678) only loses its separators; anything with a letter in it is
 * left exactly as given.
 */
function tidyTyped(input) {
  if (typeof input !== 'string') return input;
  const typed = latinDigits(input).trim();
  if (!/^[+\d\s().-]+$/.test(typed) || !/\d/.test(typed)) return input;
  const digits = typed.replace(/\D/g, '');
  if (typed.startsWith('+')) return digits;
  if (digits.startsWith('00') && digits.length > 9) return digits.slice(2);
  return digits;
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

/**
 * A number a person can be reached on: dialable (an Egyptian mobile, or a
 * number carrying its country code), and not a filler typed to get past a
 * required field — 01000000000, 01111111111.
 */
function isRealPhone(input) {
  const dialable = toDialable(input);
  if (!dialable) return false;
  return !/^(\d)\1+$/.test(dialable.slice(-9));
}

/**
 * A number from an imported file, in the one shape the system keeps, and what is wrong with it.
 *
 * «وقت استيراد داتا … لو الرقم غلط او مش كامل بيرفض يرفع العميل … لما العميل يكون اوله 5 دا معناه انه سعودي حط انت
 * اتوماتك جمبه 966 … ولو في غلط اكتب ان الرقم فيه غلط». An import takes every row: a Saudi mobile written 5XXXXXXXX
 * or 05XXXXXXXX gets 966 in front, and a number that cannot be dialled (a digit short, a filler like 01000000000,
 * nothing at all) is kept as typed with a problem to write on the record, never a reason to leave the client out.
 * { phone, problem, saudi }: phone is '' only when the file had none.
 */
function cleanImportedPhone(input) {
  const typed = String(input == null ? '' : input).trim();
  if (!typed) return { phone: '', problem: 'مفيش رقم تليفون', saudi: false };
  const digits = latinDigits(typed).replace(/\D/g, '').replace(/^00/, '');
  const national = digits.replace(/^0(?=5\d{8}$)/, '');
  if (SA_MOBILE_NATIONAL.test(national)) return { phone: `966${national}`, problem: '', saudi: true };
  const phone = tidyTyped(typed);
  const usable = isDialable(phone) && isRealPhone(phone);
  return { phone, problem: usable ? '' : `الرقم فيه غلط أو ناقص: ${typed}`, saudi: false };
}

module.exports = {
  cleanImportedPhone,
  completeForBranch,
  DEFAULT_COUNTRY_CODE,
  latinDigits,
  isRealPhone,
  toIdentity,
  toDialable,
  toDisplay,
  isDialable,
  isPlausible,
  identitySpellings,
  matchingSpellings,
};
