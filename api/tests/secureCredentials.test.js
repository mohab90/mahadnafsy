'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generateTemporaryPassword, generateNumericCode } = require('../lib/secureCredentials');

test('temporary credentials use the expected alphabet and production-safe length', () => {
  const samples = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()));
  assert.equal(samples.size, 100);
  for (const value of samples) {
    assert.match(value, /^[A-HJ-NP-Za-km-z2-9]{12}$/);
  }
});

test('numeric verification codes are always six digits', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateNumericCode(), /^\d{6}$/);
  }
});
