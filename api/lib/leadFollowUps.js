'use strict';

// «متابعات النهارده» — which leads are due, in one place.
//
// Four screens counted it four ways: the 08:00 reminder read the date column
// alone and took archived leads with it; the day's digest and the reminders
// panel read the column alone, so a date set only in crm_json was nobody's; the
// header bell and the follow-ups drawer read the column, else crm_json's date;
// and the sales hub and the reminders tab counted in the browser, over the page
// of leads it had loaded and their own list of closed statuses. A rep was told
// one number in the bell and another on the hub.
//
// The definition: a lead not archived (hidden = 0), whose status is still open
// (lib/leadStatuses.js — not one of the terminal ones), whose follow-up date —
// the column (every writer sets it; migration 349 copied crm_json's into it) — falls on the Cairo day
// asked about (lib/dates.js cairoToday). Overdue is the same with an earlier day.
// Every fragment is written for the lead alias `l`.

const { NEXT_FOLLOWUP } = require('./leadTableFilter');
const { TERMINAL_SQL } = require('./leadStatuses');
const { addDaysToDateOnly } = require('./dates');

/** The follow-up date, YYYY-MM-DD or NULL. */
const FOLLOW_UP_DATE = NEXT_FOLLOWUP;
/** A lead whose follow-up can be due: not archived, not closed. */
const FOLLOW_UP_OPEN = `l.hidden = 0 AND COALESCE(l.status, '') NOT IN ${TERMINAL_SQL}`;

// The column is a DATETIME, so a day is the range from its start to the next day's start: written that way the dates are
// read from idx_leads_tenant_followup_open (150,000 leads: 650 ms scanning them, 2 ms through the index).
/** ` AND …` for open leads due on `day` (today), with its params. */
const dueOn = day => ({
  sql: ` AND ${FOLLOW_UP_OPEN} AND l.next_follow_up_date >= ? AND l.next_follow_up_date < ?`,
  params: [day, addDaysToDateOnly(day, 1)],
});
/** ` AND …` for open leads due before `day`. */
const overdueBefore = day => ({ sql: ` AND ${FOLLOW_UP_OPEN} AND l.next_follow_up_date < ?`, params: [day] });
/** ` AND …` for open leads due on or before `day` — today's and the overdue together. */
const dueBy = day => ({ sql: ` AND ${FOLLOW_UP_OPEN} AND l.next_follow_up_date < ?`, params: [addDaysToDateOnly(day, 1)] });

module.exports = { FOLLOW_UP_DATE, FOLLOW_UP_OPEN, dueOn, overdueBefore, dueBy };
