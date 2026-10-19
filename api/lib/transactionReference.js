'use strict';

// A payment's reference number, as it is worth storing.
//
// «الرقم المرجعي 0 متسجل قبل كده مينفعش يتسجل كده تاني … 0 دا يعني لا شيء، ينفع يتسجل تاني» (19 Oct 2026). payments.transaction_id is
// unique across the institute, so the second payment typed with «0» (what a desk writes when there is no operation number)
// was refused as «already used». A reference made only of zeros or dashes — or the words that mean «none» — names no
// transaction, so it is stored as no reference at all, and any number of payments may carry it.

const NOTHING = /^[\s0٠\-_.،,/\\]*$/;
const NONE_WORDS = new Set(['لا يوجد', 'لايوجد', 'لا', 'مفيش', 'بدون', 'n/a', 'na', 'none', 'null', 'undefined', 'no']);

/** The reference trimmed to what fits the column, or null when it says nothing. */
function cleanReference(value, max = 191) {
  const text = String(value ?? '').trim();
  if (!text || NOTHING.test(text) || NONE_WORDS.has(text.toLowerCase())) return null;
  return text.slice(0, max);
}

module.exports = { cleanReference };
