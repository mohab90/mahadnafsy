'use strict';

// The key a form sends once per opened form (admin/lib/idempotencyKey.ts) so that a second request from the same form — a double click, a retry after a timeout —
// is answered with the first one's result instead of writing again (expenses, box withdrawals, manual journal entries; migration 386).

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** The key as stored, or null when the request sent none (or something that is not a key — it is then treated as no key, never as a reason to refuse). */
function cleanIdempotencyKey(raw) {
  const value = String(raw ?? '').trim();
  return KEY_PATTERN.test(value) ? value : null;
}

/** True when a database error is the unique key of these tables refusing a second row with the same key. */
const isDuplicateKey = error => error?.code === 'ER_DUP_ENTRY' && /idempotency/.test(String(error.sqlMessage || error.message || ''));

module.exports = { cleanIdempotencyKey, isDuplicateKey };
