'use strict';
// The client's real name and national ID, taken at the booking desk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkArabicName, checkEnglishName, checkNationalId, validateBookingIdentity } = require('../lib/bookingIdentity');

test('the Arabic name has to be a full triple name in Arabic letters', () => {
  assert.equal(checkArabicName('أحمد محمد علي').ok, true);
  assert.equal(checkArabicName('  مُحَمَّد   أحمد   حسن ').value, 'محمد أحمد حسن', 'tashkeel and extra spaces are cleaned');
  assert.equal(checkArabicName('أحمد محمد').ok, false);
  assert.equal(checkArabicName('أحمد عبد الله').ok, false, '«عبد الله» is one name');
  assert.equal(checkArabicName('أحمد محمد عبد الله').ok, true);
  assert.equal(checkArabicName('Ahmed Mohamed Ali').ok, false);
  assert.equal(checkArabicName('').ok, false);
});

test('the English name is optional, but Latin letters and two words when given', () => {
  assert.deepEqual(checkEnglishName(''), { ok: true, value: null });
  assert.equal(checkEnglishName('Ahmed Ali').ok, true);
  assert.equal(checkEnglishName('Ahmed').ok, false);
  assert.equal(checkEnglishName('أحمد علي').ok, false);
});

test('an Egyptian national ID is 14 digits holding a real birth date', () => {
  assert.equal(checkNationalId('29001011234567').ok, true);
  assert.equal(checkNationalId('٢٩٠٠١٠١١٢٣٤٥٦٧').value, '29001011234567', 'Arabic digits are read');
  assert.equal(checkNationalId('29013011234567').ok, false, 'month 13');
  assert.equal(checkNationalId('19001011234567').ok, false, 'century digit');
  assert.equal(checkNationalId('2900101123456').ok, false, '13 digits');
  assert.equal(checkNationalId('A1234567', { egyptian: false }).ok, true, 'a passport for a foreign client');
});

test('the phone has to be confirmed with the client', () => {
  const base = { nameAr: 'أحمد محمد علي' };
  assert.equal(validateBookingIdentity(base).code, 'PHONE_NOT_CONFIRMED');
  assert.equal(validateBookingIdentity({ ...base, phoneConfirmed: true }).ok, true);
});
