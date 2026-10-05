'use strict';
/** A number written in a Messenger chat, found and made dialable (lib/pageAudience.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { findPhone } = require('../lib/pageAudience');

test('finds the numbers people actually write', () => {
  assert.equal(findPhone('رقمي 01012345678 لو سمحت'), '201012345678');
  assert.equal(findPhone('٠١١٢٣٤٥٦٧٨٩'), '201123456789');
  assert.equal(findPhone('واتس +966 50 123 4567'), '966501234567');
  assert.equal(findPhone('0020 122 334 4556'), '201223344556');
  assert.equal(findPhone('010-1234-5678'), '201012345678');
});

test('does not take what is not a phone', () => {
  assert.equal(findPhone('الرقم القومي 29001011234567'), '');
  assert.equal(findPhone('رقم الطلب 123456'), '');
  assert.equal(findPhone('السعر 3000 جنيه'), '');
  assert.equal(findPhone(''), '');
});
