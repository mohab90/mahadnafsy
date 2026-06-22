'use strict';
/**
 * Unit tests for middleware/validate — the input-validation + sanitization layer
 * used across route handlers (security-critical, was untested). Pure functions +
 * middleware factories with mocked req/res/next. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isString, isEmail, isInt, isPosInt, isNumber, isUUID, isOneOf, isArray, isObject,
  stripHtml, sanitizeText, validateBody, validateParams, validateQuery,
} = require('../middleware/validate');

test('isString: non-empty string within length, rejects junk', () => {
  assert.equal(isString('hello'), true);
  assert.equal(isString('   '), false);     // whitespace-only
  assert.equal(isString(''), false);
  assert.equal(isString(123), false);
  assert.equal(isString(null), false);
  assert.equal(isString('ab', 1), false);   // exceeds max
});

test('isEmail: accepts valid, rejects malformed', () => {
  assert.equal(isEmail('a@b.com'), true);
  assert.equal(isEmail('name.surname@mahadnafsy.com'), true);
  assert.equal(isEmail('no-at'), false);
  assert.equal(isEmail('a@b'), false);       // no TLD
  assert.equal(isEmail('a b@c.com'), false); // space
  assert.equal(isEmail(''), false);
});

test('isInt / isPosInt: bounds + integer-only', () => {
  assert.equal(isInt(5), true);
  assert.equal(isInt('5'), true);            // numeric string coerces
  assert.equal(isInt(5.5), false);
  assert.equal(isInt(3, 1, 2), false);       // above max
  assert.equal(isPosInt(1), true);
  assert.equal(isPosInt(0), false);
  assert.equal(isPosInt(-2), false);
});

test('isNumber: finite floats within bounds, never NaN/Infinity', () => {
  assert.equal(isNumber(1.25), true);
  assert.equal(isNumber('1.25'), true);
  assert.equal(isNumber(Infinity), false);
  assert.equal(isNumber('abc'), false);
  assert.equal(isNumber(5, 0, 4), false);
});

test('isUUID: v4 only', () => {
  assert.equal(isUUID('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true);
  assert.equal(isUUID('not-a-uuid'), false);
  assert.equal(isUUID('3f2504e0-4f89-11d3-9a0c-0305e82c3301'), false); // v1, not v4
});

test('isOneOf / isArray / isObject', () => {
  assert.equal(isOneOf('a', ['a', 'b']), true);
  assert.equal(isOneOf('z', ['a', 'b']), false);
  assert.equal(isArray([1, 2]), true);
  assert.equal(isArray([1], 0), false);      // exceeds maxLen
  assert.equal(isArray('x'), false);
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
});

test('stripHtml / sanitizeText: prevent stored XSS', () => {
  assert.equal(stripHtml('<script>alert(1)</script>hi'), 'alert(1)hi');
  assert.equal(stripHtml('<b>bold</b>'), 'bold');
  assert.equal(sanitizeText('<i>x</i>'), 'x');
  assert.equal(sanitizeText(12345), '');     // non-string → empty
  assert.equal(sanitizeText('abcdef', 3), 'abc'); // capped
});

// ── middleware factories ──────────────────────────────────────────────────────
const mkRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

test('validateBody: 400 with field errors on invalid, next() on valid', () => {
  const mw = validateBody({
    name: v => isString(v, 100) || 'name required',
    email: v => isEmail(v) || 'bad email',
  });

  // invalid → 400, next NOT called
  let nextCalled = false;
  const res1 = mkRes();
  mw({ body: { name: '', email: 'nope' } }, res1, () => { nextCalled = true; });
  assert.equal(res1.statusCode, 400);
  assert.equal(nextCalled, false);
  assert.equal(res1.body.errors.length, 2);

  // valid → next called, no error response
  let nextCalled2 = false;
  const res2 = mkRes();
  mw({ body: { name: 'أحمد', email: 'a@b.com' } }, res2, () => { nextCalled2 = true; });
  assert.equal(nextCalled2, true);
  assert.equal(res2.statusCode, 200);
});

test('validateQuery: skips absent optional fields, validates present ones', () => {
  const mw = validateQuery({ limit: v => isPosInt(v) || 'bad limit' });

  let ok = false;
  mw({ query: {} }, mkRes(), () => { ok = true; });
  assert.equal(ok, true, 'absent optional field passes');

  const res = mkRes();
  let called = false;
  mw({ query: { limit: '-5' } }, res, () => { called = true; });
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('validateParams: rejects bad param', () => {
  const mw = validateParams({ id: v => isUUID(v) || 'id must be uuid' });
  const res = mkRes();
  mw({ params: { id: 'x' } }, res, () => {});
  assert.equal(res.statusCode, 400);
});
