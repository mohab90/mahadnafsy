'use strict';
const logger = require('./logger');

const BRANCH_ALIASES = Object.freeze({
  DAQQI: 'DAQQI',
  DQI: 'DAQQI',
  DOKKI: 'DAQQI',
  'الدقي': 'DAQQI',
  'دقي': 'DAQQI',
  TAGAMOA: 'TAGAMOA',
  TAGAMO3: 'TAGAMOA',
  TAGAMO: 'TAGAMOA',
  'التجمع': 'TAGAMOA',
  'التجمع_الخامس': 'TAGAMOA',
  ONLINE: 'ONLINE_EGYPT',
  ONLINE_EGYPT: 'ONLINE_EGYPT',
  ONLINE_EG: 'ONLINE_EGYPT',
  'اونلاين': 'ONLINE_EGYPT',
  'أونلاين': 'ONLINE_EGYPT',
  'أونلاين_مصر': 'ONLINE_EGYPT',
  'اونلاين_مصر': 'ONLINE_EGYPT',
  ONLINE_SAUDI: 'ONLINE_SAUDI',
  SAUDI: 'ONLINE_SAUDI',
  KSA: 'ONLINE_SAUDI',
  'السعودية': 'ONLINE_SAUDI',
  ONLINE_ABROAD: 'ONLINE_ABROAD',
  ABROAD: 'ONLINE_ABROAD',
  INTERNATIONAL: 'ONLINE_ABROAD',
  OTHER: 'OTHER',
  'أخرى': 'OTHER',
  'اخرى': 'OTHER',
});

function normalizeBranch(value, fallback = null) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const direct = BRANCH_ALIASES[raw];
  if (direct) return direct;
  const key = raw.toUpperCase().replace(/[-\s]+/g, '_');
  return BRANCH_ALIASES[key] || fallback;
}

function defaultDigitalBranch(value) {
  return normalizeBranch(value, 'ONLINE_EGYPT');
}

/**
 * The branch_id a record is filed under.
 *
 * The `branches` table can hold a branch this enum cannot name — it holds seven
 * and the enum knows six. When that happens the record used to be filed as
 * `branch-other` in silence: it disappears from every branch filter, every
 * branch-scoped report, and the money attributed to it lands in the wrong
 * bucket, with nothing anywhere saying so. (Today the extra row, «الفرع الإداري
 * - طنطا», is internal_only=1 and no dialog offers it, so nothing is misfiled —
 * but that is one column away from being untrue.)
 *
 * The fallback is still the safe answer. It just says so now.
 */
function branchIdForBranch(value, fallback = 'branch-other') {
  const branch = normalizeBranch(value, null);
  const map = {
    ONLINE_EGYPT: 'branch-online-egypt',
    ONLINE_SAUDI: 'branch-online-saudi',
    ONLINE_ABROAD: 'branch-online-abroad',
    DAQQI: 'branch-daqqi',
    TAGAMOA: 'branch-tagamoa',
    OTHER: 'branch-other',
  };
  if (map[branch]) return map[branch];
  const raw = String(value || '').trim();
  if (raw) {
    logger.warn('[branches] no branch id for this branch — filing it under the fallback', {
      value: raw, normalized: branch, fallback,
    });
  }
  return fallback;
}

function branchForId(value, fallback = 'OTHER') {
  const map = {
    'branch-online-egypt': 'ONLINE_EGYPT',
    'branch-online-saudi': 'ONLINE_SAUDI',
    'branch-online-abroad': 'ONLINE_ABROAD',
    'branch-daqqi': 'DAQQI',
    'branch-tagamoa': 'TAGAMOA',
    'branch-other': 'OTHER',
  };
  return map[String(value || '')] || fallback;
}

module.exports = {
  BRANCH_ALIASES,
  branchForId,
  branchIdForBranch,
  defaultDigitalBranch,
  normalizeBranch,
};
