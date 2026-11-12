'use strict';
/**
 * The Egyptian national ID check (api/lib/egyptianNationalId.js for the server, shared/egyptianNationalId.ts for the browser): what it accepts,
 * each way it refuses, Arabic digits — and that the two copies answer identically over the same cases.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const server = require('../lib/egyptianNationalId');
const { bundle } = require('./support/repo');
const browser = bundle('shared/egyptianNationalId.ts');

const NOW = new Date('2026-11-12T10:00:00Z');
const VALID = '29001011234567';

test('a real ID gives its birth date and governorate', () => {
  const r = server.checkEgyptianNationalId(VALID, NOW);
  assert.deepEqual(r, { ok: true, value: VALID, birthDate: '1990-01-01', governorate: 'الدقهلية', governorateCode: '12' });
  const born2000 = server.checkEgyptianNationalId('30001018800123', NOW);
  assert.equal(born2000.ok, true);
  assert.deepEqual([born2000.birthDate, born2000.governorateCode], ['2000-01-01', '88']);
});

test('Arabic-Indic and Persian digits, spaces and dashes are normalised', () => {
  assert.equal(server.checkEgyptianNationalId('٢٩٠٠١٠١١٢٣٤٥٦٧', NOW).value, VALID);
  assert.equal(server.checkEgyptianNationalId('۲۹۰۰۱۰۱۱۲۳۴۵۶۷', NOW).value, VALID);
  assert.equal(server.checkEgyptianNationalId('2900 1011-234567', NOW).value, VALID);
});

const BAD = [
  ['', 'EMPTY'], ['   ', 'EMPTY'],
  ['2900101123456', 'LENGTH'], ['290010112345678', 'LENGTH'], ['2900101123456A', 'LENGTH'],
  ['11111111111111', 'REPEATED'], ['22222222222222', 'REPEATED'],
  ['19001011234567', 'CENTURY'], ['49001011234567', 'CENTURY'],
  ['29013011234567', 'BIRTH_DATE'], ['29002301234567', 'BIRTH_DATE'], ['29002291234567', 'BIRTH_DATE'], ['29000011234567', 'BIRTH_DATE'],
  ['39901011234567', 'BIRTH_DATE'], // born in 2099: not yet
  ['29001019934567', 'GOVERNORATE'], ['29001010034567', 'GOVERNORATE'], ['29001013634567', 'GOVERNORATE'],
];
for (const [value, problem] of BAD) {
  test(`refused: ${JSON.stringify(value)} is ${problem}`, () => {
    assert.deepEqual(server.checkEgyptianNationalId(value, NOW), { ok: false, problem });
  });
}

test('a leap day is real only in a leap year', () => {
  assert.equal(server.checkEgyptianNationalId('29602291234567', NOW).ok, true); // 1996
  assert.equal(server.checkEgyptianNationalId('29502291234567', NOW).problem, 'BIRTH_DATE'); // 1995
});

test('the mask shows the last three digits only', () => {
  assert.equal(server.maskNationalId(VALID), '***********567');
});

test('the browser copy answers exactly as the server copy over every case', { skip: !browser && 'esbuild not installed' }, () => {
  const cases = [VALID, '٢٩٠٠١٠١١٢٣٤٥٦٧', '30001018800123', '29602291234567', ...BAD.map(([v]) => v), null, undefined, 12345];
  for (const value of cases) {
    assert.deepEqual(browser.checkEgyptianNationalId(value, NOW), server.checkEgyptianNationalId(value, NOW), String(value));
  }
  assert.deepEqual(browser.GOVERNORATES, server.GOVERNORATES);
  assert.deepEqual(browser.NATIONAL_ID_MESSAGES, server.NATIONAL_ID_MESSAGES);
  assert.equal(browser.maskNationalId(VALID), server.maskNationalId(VALID));
});
