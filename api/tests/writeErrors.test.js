'use strict';
/**
 * What a screen is told when a write is refused.
 *
 * Every HR handler ended with `res.status(500).json({ error: 'Internal server
 * error' })`, which the screens print verbatim — so a duplicate row, a required
 * field left blank and a genuine fault all read the same. That is how «تعذر
 * إنشاء الموظف» came to mean five different things, and why the person who hit
 * it could not act on it. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeWriteError, sendWriteError } = require('../lib/writeErrors');

const fakeRes = () => {
  const res = {};
  res.status = code => { res.code = code; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
};

test('a condition the user can fix is named', () => {
  for (const [code, status] of [
    ['ER_DUP_ENTRY', 409],
    ['ER_NO_REFERENCED_ROW_2', 409],
    ['ER_ROW_IS_REFERENCED', 409],
    ['ER_BAD_NULL_ERROR', 400],
    ['ER_DATA_TOO_LONG', 400],
    ['WARN_DATA_TRUNCATED', 400],
  ]) {
    const res = fakeRes();
    sendWriteError(res, { code, message: 'raw driver text' });
    assert.equal(res.code, status, `${code} must not be a 500`);
    assert.ok(res.body.code, `${code} must carry a machine-readable code`);
    assert.match(res.body.error, /[؀-ۿ]/, `${code} must answer in Arabic`);
    assert.ok(!/raw driver text/.test(res.body.error), 'and must not echo the driver');
  }
});

test('anything else stays a 500 and stays quiet', () => {
  for (const error of [
    { code: 'ER_PARSE_ERROR', message: 'You have an error in your SQL syntax' },
    { code: 'ECONNREFUSED' },
    new TypeError('cannot read properties of undefined'),
    undefined,
  ]) {
    const res = fakeRes();
    sendWriteError(res, error);
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'Internal server error' },
      'a real fault must not describe itself to a browser');
  }
  assert.equal(describeWriteError({ code: 'ER_PARSE_ERROR' }), null);
});

test('every HR handler answers through it', () => {
  const dir = path.join(__dirname, '..', 'routes', 'hr');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.js') && name !== '_shared.js');
  let handlers = 0;
  for (const name of files) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    const bare = (source.match(/res\.status\(500\)\.json\(\{ error: 'Internal server error' \}\)/g) || []).length;
    assert.equal(bare, 0, `${name} still answers a refused write with a bare 500`);
    const mapped = (source.match(/hrError\(res,/g) || []).length;
    if (mapped) {
      assert.match(source, /hrError/, `${name} must import it`);
      handlers += mapped;
    }
  }
  assert.ok(handlers >= 100, `expected the HR handlers to be converted, found ${handlers}`);
});

test('hrError keeps the log line and delegates the response', () => {
  const shared = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hr', '_shared.js'), 'utf8');
  assert.match(shared, /logger\.error\(message, error\?\.message \|\| error\)/,
    'the operator still gets the real error');
  assert.match(shared, /return sendWriteError\(res, error\)/,
    'and the browser gets only what it can act on');
});
