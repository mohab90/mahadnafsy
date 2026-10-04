'use strict';

// What a lead's status means, for the whole API. shared/leadStatuses.ts is the
// browser's copy, kept identical by tests/leadStatusVocabulary.test.js, and
// that test also refuses a hand-written list of statuses anywhere else: «closed»
// used to be spelled out in a dozen places and no two agreed.

const LEAD_STATUSES = new Set([
  'new', 'contacted', 'interested', 'interested_booking', 'interested_followup',
  'not_interested', 'not_interested_hidden', 'no_answer', 'no_answer_wa',
  'no_answer_nowa', 'wrong_number', 'closed', 'converted', 'lost', 'won',
  'unqualified', 'disqualified', 'archived', 'postpone_month', 'with_colleague', 'other',
]);

// Statuses that end a lead's life. Everything else is still work for someone.
//
// The desk records outcomes more finely than the code used to read them:
// production holds interested_followup, interested_booking, no_answer_wa and
// no_answer_nowa alongside the plain interested and no_answer. Several places
// tested for the short form alone, so the finer ones fell through — most
// consequentially the bulk-assign pool, which allowed only 'new' and
// 'interested' while its own comment said it excluded the closed ones. A lead
// marked interested_booking — a lead about to buy — was never redistributed.
//
// Grouping lives here so a new status is classified once rather than in each
// screen that happens to care.
const TERMINAL_LEAD_STATUSES = new Set([
  'converted', 'lost', 'won', 'closed', 'not_interested', 'not_interested_hidden',
  'wrong_number', 'unqualified', 'disqualified', 'archived',
]);

// A sale. «مغلق» (closed) is not one: it ends the lead without a booking, and
// the HR reports that counted it as converted credited reps with sales.
const CONVERTED_LEAD_STATUSES = new Set(['converted', 'won']);

const INTERESTED_LEAD_STATUSES = new Set([
  'interested', 'interested_booking', 'interested_followup',
]);

function normalizeLeadStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!LEAD_STATUSES.has(status)) {
    const error = new Error('Invalid lead status');
    error.statusCode = 400;
    throw error;
  }
  return status;
}

/** Still worth a salesperson's time — the complement of the terminal set. */
function isOpenLeadStatus(value) {
  return !TERMINAL_LEAD_STATUSES.has(String(value || '').trim().toLowerCase());
}

function isConvertedLeadStatus(value) {
  return CONVERTED_LEAD_STATUSES.has(String(value || '').trim().toLowerCase());
}

// For SQL: `status NOT IN (?)` with a list as the one parameter, or the list
// written in as `status NOT IN ${TERMINAL_SQL}` where the statement's
// parameters are positional. These are the constants above, never input, and
// every member is checked to be a bare word before it is quoted.
const TERMINAL_LIST = Object.freeze([...TERMINAL_LEAD_STATUSES]);
const CONVERTED_LIST = Object.freeze([...CONVERTED_LEAD_STATUSES]);
const sqlList = values => {
  if (!values.every(v => /^[a-z_]+$/.test(v))) throw new Error('lead status constants must be bare words');
  return `(${values.map(v => `'${v}'`).join(',')})`;
};
const TERMINAL_SQL = sqlList(TERMINAL_LIST);
const CONVERTED_SQL = sqlList(CONVERTED_LIST);

/** Any shade of interested, however finely the desk recorded it. */
function isInterestedLeadStatus(value) {
  return INTERESTED_LEAD_STATUSES.has(String(value || '').trim().toLowerCase());
}

module.exports = {
  LEAD_STATUSES,
  TERMINAL_LEAD_STATUSES,
  CONVERTED_LEAD_STATUSES,
  INTERESTED_LEAD_STATUSES,
  TERMINAL_LIST,
  CONVERTED_LIST,
  TERMINAL_SQL,
  CONVERTED_SQL,
  isConvertedLeadStatus,
  normalizeLeadStatus,
  isOpenLeadStatus,
  isInterestedLeadStatus,
};
