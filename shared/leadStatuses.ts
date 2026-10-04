/**
 * What a lead's status means, for every screen — the browser half of
 * api/lib/leadStatuses.js, kept identical by api/tests/leadStatusVocabulary.test.js.
 *
 * Before this, «closed» was written out by hand in a dozen places and no two
 * agreed: one screen counted a wrong number as still open, the HR report
 * counted «مغلق» as a sale, offboarding handed a colleague the leads that had
 * said no. A screen that needs one of these questions answered asks here.
 */

/** Every status a lead can be set to. */
export const LEAD_STATUSES = [
  'new', 'contacted', 'interested', 'interested_booking', 'interested_followup',
  'not_interested', 'not_interested_hidden', 'no_answer', 'no_answer_wa',
  'no_answer_nowa', 'wrong_number', 'closed', 'converted', 'lost', 'won',
  'unqualified', 'disqualified', 'archived', 'postpone_month', 'with_colleague', 'other',
] as const;

/** A lead in one of these is finished: nobody follows it up, it is never stale, it is not redistributed. */
export const TERMINAL_LEAD_STATUSES: ReadonlySet<string> = new Set([
  'converted', 'lost', 'won', 'closed', 'not_interested', 'not_interested_hidden',
  'wrong_number', 'unqualified', 'disqualified', 'archived',
]);

/** A sale. «مغلق» (closed) is not one: it ends the lead without a booking. */
export const CONVERTED_LEAD_STATUSES: ReadonlySet<string> = new Set(['converted', 'won']);

/** Any shade of interested, however finely the desk recorded it. */
export const INTERESTED_LEAD_STATUSES: ReadonlySet<string> = new Set([
  'interested', 'interested_booking', 'interested_followup',
]);

const norm = (status: unknown) => String(status ?? '').trim().toLowerCase();

/** Still worth a salesperson's time. */
export const isOpenLeadStatus = (status: unknown) => !TERMINAL_LEAD_STATUSES.has(norm(status));
export const isConvertedLeadStatus = (status: unknown) => CONVERTED_LEAD_STATUSES.has(norm(status));
export const isInterestedLeadStatus = (status: unknown) => INTERESTED_LEAD_STATUSES.has(norm(status));
