'use strict';

const JOURNEY_STATES = Object.freeze({
  order: Object.freeze(['pending', 'paid', 'failed', 'refunded']),
  payment: Object.freeze(['pending', 'paid', 'failed', 'refunded']),
  enrollment: Object.freeze(['active', 'revoked']),
  certificate: Object.freeze(['active', 'revoked']),
});

function normalizeJourneyState(domain, value) {
  const state = String(value || '').trim().toLowerCase();
  if (!JOURNEY_STATES[domain]?.includes(state)) {
    const error = new Error(`Invalid ${domain} status`);
    error.statusCode = 400;
    throw error;
  }
  return state;
}

const isJourneyState = (domain, value, expected) =>
  normalizeJourneyState(domain, value) === expected;

module.exports = { JOURNEY_STATES, normalizeJourneyState, isJourneyState };
