/**
 * The institute's day, on the browser side.
 *
 * The server has dateOnlyInTimeZone() in api/lib/dates.js and uses it wherever a
 * date key decides what counts as "today". The admin had no equivalent, so
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
