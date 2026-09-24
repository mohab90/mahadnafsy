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
 * Every day here is YYYY-MM-DD, which is the shape every caller slices and
 * compares against a stored date.
 */
export const CAIRO_TIME_ZONE = 'Africa/Cairo';

export function cairoDateOnly(value?: Date | string | number): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return cairoParts(date).date;
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

/**
 * The institute's month, as `YYYY-MM`.
 *
 * Same fault as cairoDateOnly, one boundary up: 31 places asked for
 * `new Date().toISOString().slice(0, 7)`, and on the first of the month —
 * until 02:00 or 03:00 Cairo — that names the month that just ended. A monthly
 * sales target keyed on `period` matched no row, «إيرادات الشهر» showed the
 * previous month's, and a commission run started against the wrong period.
 */
export function cairoMonthOnly(value?: Date | string | number): string {
  return cairoDateOnly(value).slice(0, 7);
}

/**
 * `YYYY-MM-DD` for N days before the institute's today.
 *
 * Written for the range pickers — «آخر 7 أيام», «آخر 30 يوم», «آخر 3 شهور» —
 * which each built their own boundary with `new Date(+d - 7 * 86400000)` and
 * then formatted it in UTC, so the window was a day out for the same three
 * hours every night. Subtracting whole days from the Cairo day rather than from
 * an instant also keeps the boundary right across a daylight-saving change,
 * which arithmetic on milliseconds does not.
 */
export function cairoDaysAgo(days: number, from?: Date | string | number): string {
  const today = cairoDateOnly(from);
  if (!today) return '';
  const [year, month, day] = today.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day - days));
  return shifted.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` for N days after the institute's today — a due-soon window, a default expiry. */
export function cairoDaysAhead(days: number, from?: Date | string | number): string {
  return cairoDaysAgo(-days, from);
}

/**
 * The first day of the institute's week, `YYYY-MM-DD`: Sunday, or Monday when
 * asked (the Dokki rounds key their postponed weeks on Monday).
 *
 * The screens built it with `d.setDate(d.getDate() - d.getDay())` on the current
 * instant and then formatted it in UTC — so between midnight and 02:00 or 03:00
 * Cairo, «هذا الأسبوع» began on the Saturday before.
 */
export function cairoWeekStart(firstDay: 0 | 1 = 0, from?: Date | string | number): string {
  const today = cairoDateOnly(from);
  if (!today) return '';
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return cairoDaysAgo((weekday - firstDay + 7) % 7, from);
}

/**
 * The first day of the Cairo month N months before this one, `YYYY-MM-01`;
 * negative looks ahead. For «آخر 3 شهور» pickers that start on a month boundary,
 * and for a salary change that takes effect next month.
 */
export function cairoMonthStart(monthsBack = 0, from?: Date | string | number): string {
  const month = cairoMonthOnly(from);
  if (!month) return '';
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 - monthsBack, 1)).toISOString().slice(0, 10);
}

/*
 * Times of day.
 *
 * Everything above is about which *day* it is. Nothing here covered what time
 * it is, so every screen that showed one printed the stored value as it came —
 * and stored instants are UTC. A call logged at 12:45 in Cairo was stored as
 * 09:45, correctly, and then shown as 09:45 in «سجل التواصل», on the lead's
 * timeline and on the client's page: three hours early in summer, two in winter.
 *
 * The rule these three hold to: storage is UTC, a screen shows Cairo, and an
 * input a person types into speaks Cairo too and is converted back on the way
 * out. A stored value with no zone on it — '2026-09-24 09:45', the shape the
 * browser writes and MySQL DATETIME returns — is UTC, never local.
 */

const NAIVE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A stored value as an instant. Zoneless strings are UTC by the storage rule. */
function toInstant(value: Date | string | number): Date {
  if (value instanceof Date || typeof value === 'number') return new Date(value);
  const raw = String(value).trim();
  const naive = raw.match(NAIVE_DATE_TIME);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
  }
  return new Date(raw);
}

/*
 * Cairo's offset from UTC, by UTC hour.
 *
 * List screens ask for the Cairo day of every row, and asking Intl each time —
 * a new formatter per call — took 2.5 s for 30,000 leads, on every render of
 * the analytics tab. Egypt's offset is a whole number of hours and changes only
 * at a local midnight, so it is constant within any UTC hour: Intl is asked once
 * per distinct hour and the rest is arithmetic.
 */
let offsetFormat: Intl.DateTimeFormat | undefined;
const offsetByHour = new Map<number, number>();

function cairoOffsetMs(instant: number): number {
  const hour = Math.floor(instant / 3600000) * 3600000;
  let offset = offsetByHour.get(hour);
  if (offset === undefined) {
    offsetFormat ??= new Intl.DateTimeFormat('en-US', {
      timeZone: CAIRO_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const parts = offsetFormat.formatToParts(new Date(hour));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    offset = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - hour;
    offsetByHour.set(hour, offset);
  }
  return offset;
}

function cairoParts(date: Date) {
  const wall = new Date(date.getTime() + cairoOffsetMs(date.getTime())).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** A stored instant on the institute's clock, `YYYY-MM-DD HH:MM`. Blank or unreadable → ''. */
export function cairoDateTime(value?: Date | string | number | null): string {
  if (value === undefined || value === null || value === '') return '';
  const instant = toInstant(value);
  if (Number.isNaN(instant.getTime())) return typeof value === 'string' ? value : '';
  const { date, time } = cairoParts(instant);
  return `${date} ${time}`;
}

/** The value for an `<input type="datetime-local">`: Cairo wall clock, `YYYY-MM-DDTHH:MM`. */
export function cairoDateTimeInput(value?: Date | string | number | null): string {
  const shown = cairoDateTime(value === undefined || value === null || value === '' ? new Date() : value);
  return shown ? shown.replace(' ', 'T') : '';
}

/**
 * Back from what a person typed — Cairo wall clock — to the UTC `YYYY-MM-DD HH:MM`
 * that is stored. The offset is looked up at that moment rather than assumed,
 * because Egypt moves between +2 and +3 and a single constant is wrong for half
 * the year. Two passes, since the offset at a first guess can differ from the
 * offset at the answer when the guess and the answer straddle the change.
 */
export function cairoInputToUtc(local: string): string {
  const match = String(local || '').trim().match(NAIVE_DATE_TIME);
  if (!match) return '';
  const [, y, mo, d, h, mi] = match;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const offsetAt = (instant: number) => {
    const { date, time } = cairoParts(new Date(instant));
    const [py, pmo, pd] = date.split('-').map(Number);
    const [ph, pmi] = time.split(':').map(Number);
    return Date.UTC(py, pmo - 1, pd, ph, pmi) - instant;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  // The autumn change repeats an hour: on the night Egypt goes back, 23:00-23:59
  // happens twice, and a zoneless input cannot say which one was meant. Take the
  // first, as Temporal's 'compatible' rule does, rather than whichever the
  // arithmetic happened to land on. (The spring change skips an hour instead;
  // a time typed inside it moves forward, by the same rule.)
  const earlier = instant - 3600000;
  if (cairoDateTime(earlier) === cairoDateTime(instant)) instant = earlier;
  return new Date(instant).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The Cairo day of a stored instant, `YYYY-MM-DD`, or '' when there is none.
 *
 * For lists that show when something was created. They printed
 * `createdAt.slice(0, 10)`, which is the UTC day, so a lead that arrived at
 * 01:30 in Cairo was listed under the day before. cairoDateOnly() is not the
 * replacement: given nothing it answers *today*, which is right for "what day
 * is it" and wrong for a row whose date is missing.
 */
export function cairoDay(value?: Date | string | number | null): string {
  return cairoDateTime(value).slice(0, 10);
}
