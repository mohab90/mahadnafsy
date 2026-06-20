'use strict';
/**
 * MASTER BRANCH CONSTANTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the branch enum. The same list was previously
 * hard-coded in ~10 places across routes (waitlist, payments, backfill, …) with
 * subtle drift (some included 'ALL', some 'OTHER'). Import from here instead.
 *
 * - BRANCHES        : the real, persistable branches (what a row's `branch` may be)
 * - BRANCH_FILTERS  : BRANCHES + 'ALL' (the wildcard used only for query filters)
 * - normalizeBranch : canonicalises free-form input ("daqqi", "online-egypt" → "DAQQI"/"ONLINE_EGYPT")
 * - isBranch        : validates a value is a real branch
 */
const BRANCHES = Object.freeze([
  'DAQQI',
  'TAGAMOA',
  'ONLINE_EGYPT',
  'ONLINE_SAUDI',
  'ONLINE_ABROAD',
  'OTHER',
]);

const BRANCH_FILTERS = Object.freeze(['ALL', ...BRANCHES]);

const BRANCH_LABELS_AR = Object.freeze({
  DAQQI: 'فرع الدقي',
  TAGAMOA: 'فرع التجمع',
  ONLINE_EGYPT: 'أونلاين محلي (مصر)',
  ONLINE_SAUDI: 'أونلاين سعودي',
  ONLINE_ABROAD: 'أونلاين دولي',
  OTHER: 'أخرى',
});

// Canonicalise: uppercase, collapse spaces/hyphens to underscore. Maps the
// legacy 'DQI' alias to 'DAQQI'. Returns null for empty input.
function normalizeBranch(v) {
  if (!v) return null;
  const key = String(v).trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (key === 'DQI') return 'DAQQI';
  return key;
}

function isBranch(v) {
  return BRANCHES.includes(normalizeBranch(v));
}

module.exports = { BRANCHES, BRANCH_FILTERS, BRANCH_LABELS_AR, normalizeBranch, isBranch };
