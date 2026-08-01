/**
 * Building a wa.me link, once, correctly.
 *
 * This was open-coded in ~20 places with at least seven different rules, and
 * most of them were wrong in the same way: `phone.replace(/^0/, '2')` turns
 * 01012345678 into 21012345678 — country code "2", which is not Egypt and not
 * anywhere. Sales staff clicking those buttons got "this number is not on
 * WhatsApp" and had to retype the number by hand.
 *
 * The rule here mirrors api/lib/phoneNumber.js `toDialable` exactly. If you
 * change one, change the other — a number the admin can message must be the
 * same number the server sends to.
 */

const DEFAULT_COUNTRY_CODE = '20';
const EG_MOBILE_NATIONAL = /^1[0125]\d{8}$/;

/** Digits only, no country code, no trunk zero — the comparison key. */
export function toIdentity(input: string | null | undefined): string {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^00/, '');
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) digits = digits.slice(DEFAULT_COUNTRY_CODE.length);
  return digits.replace(/^0+/, '');
}

/**
 * Full international number, digits only — what wa.me and the providers want.
 * Returns '' when there is no way to build a real address, so callers can hide
 * the button instead of opening a chat with a number that doesn't exist.
 */
export function toDialable(input: string | null | undefined): string {
  const identity = toIdentity(input);
  if (!identity) return '';
  if (EG_MOBILE_NATIONAL.test(identity)) return `${DEFAULT_COUNTRY_CODE}${identity}`;
  if (identity.length >= 11 && /^\d{9,15}$/.test(identity)) return identity;
  return '';
}

/**
 * A wa.me URL, or null when the number cannot receive a message.
 * @param text optional prefilled message
 */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  const dialable = toDialable(phone);
  if (!dialable) return null;
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${dialable}${query}`;
}

/** `+201012345678` for display, or '' when the number is unusable. */
export function toDisplay(input: string | null | undefined): string {
  const dialable = toDialable(input);
  return dialable ? `+${dialable}` : '';
}
