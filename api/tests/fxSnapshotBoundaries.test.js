'use strict';
// The FX guard at its edges.
//
// isFxSnapshotUsable is the single gate between a foreign payment and the
// journal: postPaymentJournal and toEgp both refuse to convert unless it says
// yes. The live evidence behind it is one foreign payment, which is not enough
// to claim the boundaries are right — a rate that is stale by an hour, a clock
// that runs backwards, or a rates map that arrived as strings would each have
// produced that same single successful payment.
//
// fxSnapshotSafety.test.js covers the three obvious rejections. These are the
// cases where being off by one step silently posts money at the wrong rate, or
// silently refuses money that should post.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isFxSnapshotUsable } = require('../lib/finance');

const now = Date.parse('2026-07-29T12:00:00Z');
const at = iso => ({ source: 'provider', rates: { USD: 50, SAR: 13.3 }, updatedAt: iso });

test('the staleness cut-off includes its own boundary and excludes the step past it', () => {
  // Default window is 48h. Exactly 48h old is still good; a minute older is not.
  // An exclusive comparison here would refuse every payment for the hour before
  // the daily refresh lands, which reads to an operator as "payments are down".
  assert.equal(isFxSnapshotUsable(at('2026-07-27T12:00:00Z'), 'USD', now), true, '48h exactly must still convert');
  assert.equal(isFxSnapshotUsable(at('2026-07-27T11:59:00Z'), 'USD', now), false, '48h + 1min must not');
});

test('a snapshot dated in the future is refused rather than treated as fresh', () => {
  // now - updatedAt goes negative, which is <= maxAge and would pass a naive
  // check. A rate stamped in the future is a broken clock or a bad write, and
  // either way it is not a rate anyone verified.
  assert.equal(isFxSnapshotUsable(at('2026-07-29T12:00:01Z'), 'USD', now), false);
  assert.equal(isFxSnapshotUsable(at('2027-01-01T00:00:00Z'), 'USD', now), false);
});

test('FX_MAX_AGE_HOURS is read per call, and a nonsense value fails closed', () => {
  const previous = process.env.FX_MAX_AGE_HOURS;
  try {
    process.env.FX_MAX_AGE_HOURS = '1';
    assert.equal(isFxSnapshotUsable(at('2026-07-29T11:30:00Z'), 'USD', now), true, '30min inside a 1h window');
    assert.equal(isFxSnapshotUsable(at('2026-07-29T10:30:00Z'), 'USD', now), false, '90min outside it');

    // Math.max(1, Number('later')) is NaN, and every comparison against NaN is
    // false — so a typo in the environment refuses foreign payments instead of
    // waving them through on an unbounded window.
    process.env.FX_MAX_AGE_HOURS = 'later';
    assert.equal(isFxSnapshotUsable(at('2026-07-29T11:59:00Z'), 'USD', now), false);

    // Zero must not mean "no maximum".
    process.env.FX_MAX_AGE_HOURS = '0';
    assert.equal(isFxSnapshotUsable(at('2026-07-29T10:30:00Z'), 'USD', now), false);
  } finally {
    if (previous === undefined) delete process.env.FX_MAX_AGE_HOURS;
    else process.env.FX_MAX_AGE_HOURS = previous;
  }
});

test('a rate that is zero, negative, missing or unparseable never converts', () => {
  const fresh = '2026-07-29T11:00:00Z';
  for (const rate of [0, -1, null, undefined, NaN, Infinity, 'abc', '']) {
    assert.equal(
      isFxSnapshotUsable({ source: 'provider', rates: { USD: rate }, updatedAt: fresh }, 'USD', now),
      false,
      `rate ${String(rate)} must not be accepted`,
    );
  }
  // A numeric string is what a DECIMAL column hands back through mysql2, and it
  // is a legitimate rate — refusing it would fail closed on ordinary data.
  assert.equal(
    isFxSnapshotUsable({ source: 'provider', rates: { USD: '48.75' }, updatedAt: fresh }, 'USD', now),
    true,
  );
});

test('EGP is exempt from every one of those checks', () => {
  // EGP needs no rate, so it must not be dragged down by a stale or absent
  // snapshot — otherwise a failed rate refresh stops domestic payments too,
  // which is the entire business.
  assert.equal(isFxSnapshotUsable(null, 'EGP', now), true);
  assert.equal(isFxSnapshotUsable({ source: 'static-fallback', rates: {}, updatedAt: null }, 'EGP', now), true);
  assert.equal(isFxSnapshotUsable(at('2020-01-01T00:00:00Z'), 'egp', now), true, 'case must not matter');
});

test('the currency allow-list is closed, not merely a rejection of known-bad names', () => {
  const fresh = at('2026-07-29T11:00:00Z');
  fresh.rates.EUR = 55;
  fresh.rates.GBP = 62;
  // A rate being present in the map is not authorisation to post in it: only
  // EGP/SAR/USD have accounts and a refund path.
  for (const cur of ['EUR', 'GBP', 'AED', 'KWD', 'US']) {
    assert.equal(isFxSnapshotUsable(fresh, cur, now), false, `${String(cur)} must be refused`);
  }
});

test('an absent currency means EGP, and that default is load-bearing', () => {
  // Not about the columns: payments, orders and expenses all declare currency
  // as enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP', so no row arrives empty.
  // This is about the argument. isFxSnapshotUsable, toEgp and postPaymentJournal
  // each take a currency from a JS caller and each repeat `currency || 'EGP'`,
  // and callers do hand them values off nullable sources — refund_requests
  // declares currency as a plain nullable varchar. Tightening this one function
  // to reject empty input would diverge it from the two that convert on the
  // same value, and every foreign-currency test here would still pass.
  const stale = { source: 'static-fallback', rates: {}, updatedAt: null };
  for (const cur of [null, undefined, '']) {
    assert.equal(isFxSnapshotUsable(stale, cur, now), true, `${String(cur)} must fall back to EGP`);
  }
  // But only genuinely absent values default. Whitespace is a malformed
  // currency, not an omitted one.
  assert.equal(isFxSnapshotUsable(stale, '  ', now), false);
});
