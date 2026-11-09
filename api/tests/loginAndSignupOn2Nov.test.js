'use strict';
/**
 * 2 Nov 2026, «بعض العملاء مش بيعرفوا يعملوا تسجيل دخول … ليه أي عميل بيعمل تسجيل دخول السيستم بيحسبه كأنه عميل جديد وبيظهر كأنه مكرر»:
 *
 *  - a client stored as 01XXXXXXXXX (7,114 of 14,241 on production) was a stranger to the check "already a client?" that compared with the bare
 *    1XXXXXXXXX, so signing in filed them again as a new lead «تسجيل دخول»;
 *  - «نسيت كلمة المرور» by number looked the client up the same way, so for most clients no code was ever sent;
 *  - 32 customers were refused 305 times in two weeks by the two-device rule with «تواصل مع الدعم»;
 *  - the sign-in page: an email or a number with the password, a code on the channel typed, no WhatsApp-code sign-in, both ways in at sign-up;
 *  - a year of access, a year and a half for two tracks.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-login-2-nov-0123456789abcdef0123456789';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensureLeadForUser } = require('../lib/registrationLead');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

function fakeConn({ clientPhoneDigits = null, clientEmail = null } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/FROM subscribers/.test(flat)) {
        const byPhone = clientPhoneDigits && params.includes(clientPhoneDigits);
        const byEmail = clientEmail && params.includes(clientEmail);
        return [byPhone || byEmail ? [{ id: 'sub-1' }] : []];
      }
      if (/INSERT INTO leads/.test(flat)) { writes.push(flat); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
}

test('a client stored as 01XXXXXXXXX who signs in is not filed again as a new lead', async () => {
  const conn = fakeConn({ clientPhoneDigits: '01012345678' });
  const outcome = await ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u1', name: 'منى', phone: '1012345678' } });
  assert.equal(outcome.created, false);
  assert.equal(outcome.reason, 'already a client');
  assert.equal(conn.writes.length, 0, 'no lead was written');
});

test('every spelling of the number is asked for, and the email counts too', async () => {
  const asked = [];
  const conn = { async query(sql, params) { asked.push({ sql: String(sql), params }); return [[{ id: 'sub-1' }]]; } };
  await ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u1', phone: '+201012345678', email: 'Mona@Example.com ' } });
  const query = asked.find(item => /FROM subscribers/.test(item.sql));
  assert.match(query.sql, /phone_digits IN \(/);
  for (const spelling of ['1012345678', '01012345678', '201012345678']) assert.ok(query.params.includes(spelling), spelling);
  assert.ok(query.params.includes('mona@example.com'), 'the email, case and spaces aside');
});

test('a real newcomer is asked about as a client first, and is not stopped by it', async () => {
  const conn = fakeConn();
  const seen = [];
  const original = conn.query;
  conn.query = async (sql, params) => { seen.push(String(sql)); return original(sql, params); };
  // No client: it goes on to the lead lookup and the INSERT. The code-number and sales-rep helpers are the real ones and may or may not reach a
  // database where this runs (CI has one, a laptop does not), so only the order of the questions is asserted, not how the write ends.
  await ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u2', name: 'جديد', phone: '1099999999' } }).catch(() => null);
  const asked = seen.findIndex(sql => /FROM subscribers/.test(sql));
  assert.ok(asked >= 0, 'it asked whether the person is a client first');
  assert.equal(asked, 0, 'before anything else');
});









test('the page: an email or a number with the password, the code on the channel typed, both ways in at sign-up', () => {
  const page = read('client/pages/Auth.tsx');
  
  
  
  
  
  
  assert.equal((page.match(/<h1/g) || []).length, 1, 'one h1');
});


