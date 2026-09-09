/**
 * The institute's day, on the browser side — both apps.
 *
 * The server has dateOnlyInTimeZone() in api/lib/dates.js and uses it wherever a
 * date key decides what counts as "today". The browsers had no equivalent, so
 * screens reached for `new Date().toISOString().slice(0, 10)` — which is the UTC
 * day. Cairo runs two to three hours ahead, so from midnight until 02:00 or
 * 03:00 local that string names yesterday: a «دفعات اليوم» tile counted the
 * previous day's receipts and reported none for the ones taken that morning.
 *
 * en-CA is used because it formats as YYYY-MM-DD, which is the shape every
 * caller slices and compares against a stored date.
 */
export const CAIRO_TIME_ZONE = 'Africa/Cairo';

export function cairoDateOnly(value?: Date | string | number): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: CAIRO_TIME_ZONE });
}

/**
 * Is a `YYYY-MM-DD` expiry still in force?
 *
 * An admin who types 15 September into «تاريخ الانتهاء» means the offer runs
 * through that day. Three places disagreed about it: the admin's own list
 * compared the date strings and so kept the offer active all day; the public
 * /api/discounts route and the two customer pages compared instants, and
 * `Date.parse('2026-09-15')` is midnight *UTC* — so the discount disappeared
 * from the site at 02:00 or 03:00 Cairo on the day it was supposed to run,
 * while the admin screen still listed it under «الخصومات النشطة».
 *
 * Empty means no expiry, which is how every caller already reads a blank field.
 */
export function isExpiryActive(expiresAt?: string | null, now?: Date | string | number): boolean {
  const value = String(expiresAt || '').trim();
  if (!value) return true;
  return value.slice(0, 10) >= cairoDateOnly(now);
}
