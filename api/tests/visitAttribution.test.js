'use strict';

// The ad parameters of a visit reach the lead and the order (lib/visitAttribution.js):
// from the body the page sends, else from the session cookie, cleaned to short text.

const test = require('node:test');
const assert = require('node:assert/strict');
const { attributionFromRequest, attributionValues, cleanAttribution, attributionLabel, fillAttributionSql } = require('../lib/visitAttribution');

test('only the known keys survive, trimmed, without control characters, cut to the column', () => {
  const clean = cleanAttribution({ utm_source: '  facebook\n ', utm_campaign: 'x'.repeat(300), fbclid: 'a'.repeat(400), evil: 'drop', utm_term: { a: 1 } });
  assert.deepEqual(Object.keys(clean).sort(), ['fbclid', 'utm_campaign', 'utm_source']);
  assert.equal(clean.utm_source, 'facebook');
  assert.equal(clean.utm_campaign.length, 200);
  assert.equal(clean.fbclid.length, 255);
  assert.deepEqual(cleanAttribution('nope'), {});
});

test('the body wins; the session cookie when the body has none; nothing when neither', () => {
  const cookie = `authToken=x; mahad_attr=${encodeURIComponent(JSON.stringify({ utm_source: 'google', gclid: 'G1' }))}`;
  assert.deepEqual(attributionFromRequest({ body: { attribution: { utm_source: 'tiktok' } }, headers: { cookie } }), { utm_source: 'tiktok' });
  assert.deepEqual(attributionFromRequest({ body: {}, headers: { cookie } }), { utm_source: 'google', gclid: 'G1' });
  assert.deepEqual(attributionFromRequest({ body: {}, headers: { cookie: 'mahad_attr=%7Bbroken' } }), {});
  assert.deepEqual(attributionFromRequest({}), {});
});

test('values line up with the columns, and a later form fills only what is empty', () => {
  assert.deepEqual(attributionValues({ utm_medium: 'cpc', gclid: 'G' }), [null, 'cpc', null, null, null, null, 'G']);
  assert.match(fillAttributionSql(), /^utm_source=COALESCE\(NULLIF\(utm_source,''\), \?\)/);
  assert.equal(attributionLabel({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'eid' }), 'facebook · paid · eid');
  assert.equal(attributionLabel({ fbclid: 'x' }), 'facebook', 'a click id alone still names the network');
});
