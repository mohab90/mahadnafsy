'use strict';

// 12 Nov 2026, «قنوات المراسلة بتقف ومش شغالة ليه»: a refusal about one message or one person must not take the channel away from everybody.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isChannelLevelFailure, isTransientSendFailure } = require('../lib/sendFailures');

const meta = (code, message = 'x') => ({ error: { code, message } });

test('the official API: a refusal about the person written to leaves the channel in service', () => {
  for (const [code, what] of [
    [131047, 'more than 24 hours since the customer last wrote'],
    [131026, 'the number is not on WhatsApp'],
    [131049, 'the per-person marketing cap'],
    [131051, 'an unsupported message type'],
    [131021, 'the recipient is the sender'],
    [100, 'a bad parameter'],
    [132001, 'a template that does not exist in that language'],
    [130472, 'the number is part of an experiment'],
  ]) assert.equal(isChannelLevelFailure('meta', meta(code)), false, what);
});

test('the official API: a refusal about the token, the account or the number parks the channel', () => {
  for (const [code, what] of [
    [190, 'the token expired'], [10, 'no permission'], [200, 'a permission is missing'], [131005, 'access denied'],
    [131031, 'the account is locked'], [131042, 'a billing problem'], [133010, 'the number is not registered'], [368, 'blocked for policy'],
  ]) assert.equal(isChannelLevelFailure('meta', meta(code)), true, what);
});

test('throttling, timeouts and network blips never park a channel, on any provider', () => {
  for (const reason of ['Too Many Attempts', 'HTTP 429', 'The operation was aborted due to timeout', 'ECONNRESET', 'fetch failed', meta(80007, 'Rate limit hit'), meta(131048, 'Spam rate limit hit'), meta(130429, 'Rate limit hit')]) {
    assert.equal(isTransientSendFailure(reason), true, JSON.stringify(reason));
    assert.equal(isChannelLevelFailure('meta', reason), false);
    assert.equal(isChannelLevelFailure('wapilot', reason), false);
  }
});

test('a provider with no error codes keeps the old rule: anything that is not transient is the channel', () => {
  assert.equal(isChannelLevelFailure('wapilot', 'session is not WORKING'), true);
  assert.equal(isChannelLevelFailure('ultramsg', { error: 'instance not authorized' }), true);
  assert.equal(isChannelLevelFailure('meta', 'something without a code'), false, 'the official API with no recognisable code: left as it was');
  assert.equal(isChannelLevelFailure('meta', 'not_configured'), false);
  assert.equal(isChannelLevelFailure('wapilot', null), false);
});
