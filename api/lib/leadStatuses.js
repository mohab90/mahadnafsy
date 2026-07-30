'use strict';

const LEAD_STATUSES = new Set([
  'new', 'contacted', 'interested', 'interested_booking', 'interested_followup',
  'not_interested', 'not_interested_hidden', 'no_answer', 'no_answer_wa',
  'no_answer_nowa', 'wrong_number', 'closed', 'converted', 'lost', 'won',
  'unqualified', 'disqualified', 'archived', 'postpone_month', 'with_colleague', 'other',
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

module.exports = { LEAD_STATUSES, normalizeLeadStatus };
