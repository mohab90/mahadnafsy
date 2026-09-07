'use strict';

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

/** Any shade of interested, however finely the desk recorded it. */
function isInterestedLeadStatus(value) {
  return INTERESTED_LEAD_STATUSES.has(String(value || '').trim().toLowerCase());
}

module.exports = {
  LEAD_STATUSES,
  TERMINAL_LEAD_STATUSES,
  INTERESTED_LEAD_STATUSES,
  normalizeLeadStatus,
  isOpenLeadStatus,
  isInterestedLeadStatus,
};
