'use strict';

// «في مشكلة بتظهر خصوصا عند رفع او حجز عميل سعودي او دولي اتاكد منها» (13 Oct 2026).
// Besides the stale rate (lib/fxRefresh.js, 10 Oct), a number typed the way an
// international one is — «+966 50 123 4567» — was stored as typed, so the same
// client written another way was not found and was registered a second time.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { completeForBranch, identitySpellings, isRealPhone } = require('../lib/phoneNumber');
const { validateBookingIdentity } = require('../lib/bookingIdentity');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('an international number is stored as digits with its country code, however it was typed', () => {
  const stored = {
    '+966 50 123 4567': '966501234567',
    '00966-50-123-4567': '966501234567',
    '(+44) 7911 123456': '447911123456',
    '+20 101 234 5678': '201012345678',
    '+971501234567': '971501234567',
  };
  for (const [typed, expected] of Object.entries(stored)) {
    assert.equal(completeForBranch(typed, 'ONLINE_ABROAD'), expected, typed);
    assert.equal(isRealPhone(completeForBranch(typed, 'ONLINE_ABROAD')), true, typed);
  }
});

test('a local number only loses its separators; a Saudi 05… still gets its 966; text is left alone', () => {
  assert.equal(completeForBranch('010 1234 5678', 'ONLINE_EGYPT'), '01012345678');
  assert.equal(completeForBranch('٠١٠١٢٣٤٥٦٧٨', 'ONLINE_EGYPT'), '01012345678', 'Arabic digits become Latin');
  assert.equal(completeForBranch('0501234567', 'ONLINE_SAUDI'), '966501234567');
  assert.equal(completeForBranch('0501234567', 'DAQQI'), '0501234567', "Mansoura's 050 is not a Saudi number");
  assert.equal(completeForBranch('ahmed@example.com', 'ONLINE_EGYPT'), 'ahmed@example.com');
  assert.equal(completeForBranch(undefined, 'ONLINE_EGYPT'), undefined);
});

test('the international form of a Saudi mobile finds every way it was stored', () => {
  // The booking completes a Saudi branch's 05… to 966… first, so this is the form it searches by.
  const spellings = identitySpellings('966501234567');
  for (const stored of ['966501234567', '0501234567', '501234567', '00966501234567']) {
    assert.ok(spellings.includes(stored), `966501234567 should find ${stored}`);
  }
  // A different number that merely shares its tail is not found…
  assert.ok(!spellings.includes('66501234567'));
  assert.ok(!spellings.includes('1234567'));
  // …and a bare 050… is not claimed to be Saudi: it is also Mansoura's landline.
  assert.ok(!identitySpellings('0501234567').includes('966501234567'));
});

test("the booking route looks the client up by every spelling and names the one it found", () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /identitySpellings\(safePhone\)/);
  assert.match(route, /phone IN \(\?\) OR phone2 IN \(\?\) OR REGEXP_REPLACE\(COALESCE\(phone, ''\), '\[\^0-9\]', ''\) IN \(\?\)/, 'the client\'s second number is a number too');
  assert.match(route, /const safePhone = toIdentity\(completeForBranch\(typedPhone, branch\)\)/, 'a booked client is stored as the identity, not as typed');
  assert.match(route, /العميل مسجل من قبل بنفس/);
});

test('a Saudi or international client books with a passport or residence number and a full Arabic name', () => {
  const client = { nameAr: 'محمد عبدالله العتيبي', nameEn: 'Mohammed Alotaibi', nationalId: '1012345678', phoneConfirmed: true };
  assert.equal(validateBookingIdentity(client, { egyptian: false }).ok, true);
  assert.equal(validateBookingIdentity({ ...client, nationalId: 'A1234567' }, { egyptian: false }).ok, true);
  // The Egyptian 14 digits are asked only of an Egyptian tier.
  assert.equal(validateBookingIdentity(client, { egyptian: true }).ok, false);
});

test('a rate that cannot be had is refused with what to do about it, not as an internal error', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /FX_STALE|ensureFreshFx/);
  assert.match(read('api/lib/fxRefresh.js'), /دوس «تحديث أسعار الصرف»/);
});
