'use strict';

// Two unique keys that turned ordinary actions into «حدث خطأ»:
//   - lead merge: 11 merges on 28 Sep failed on uq_leads_tenant_phone — a
//     target taking a source's number while the source, hidden but still a
//     row, held it;
//   - WhatsApp sign-in: 2 verifications on 29 Sep failed on
//     uq_users_tenant_phone — the code was issued against active accounts, and
//     the number already had one (created by another code, or switched off).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('merge frees the sources\' phone and client code before the target takes them, and unmerge gives them back', () => {
  const merge = read('lib/leadMerge.js');
  const release = merge.indexOf('UPDATE leads SET phone=NULL, client_code=NULL WHERE tenant_id=? AND id IN');
  const take = merge.indexOf('UPDATE leads SET name=?,email=?,phone=?');
  assert.ok(release > 0 && release < take, 'the sources must give the values up first');
  assert.match(merge, /JSON\.stringify\(\{ lead: source, relations \}\)/, 'the snapshot still has the originals');
  const unmerge = merge.slice(merge.indexOf('async function unmergeLead'));
  assert.match(unmerge, /for \(const field of \['phone', 'client_code'\]\)/);
  assert.match(unmerge, /SELECT id FROM leads WHERE tenant_id=\? AND \$\{field\}=\? AND id<>\? LIMIT 1/, 'not taken back from whoever holds it now');
});

test('a verified number signs in to its own account, and a switched-off one says so', () => {
  const otp = read('lib/whatsappOtp.js');
  const lookup = otp.indexOf("'SELECT id, is_active FROM users WHERE tenant_id=? AND phone=? LIMIT 1 FOR UPDATE'");
  const insert = otp.indexOf('INSERT INTO users', lookup);
  assert.ok(lookup > 0 && insert > lookup, 'the number\'s account is looked up before one is created');
  assert.match(otp, /if \(existing && !existing\.is_active\) \{[\s\S]{0,200}error\.statusCode = 403;/);
  assert.match(otp, /if \(existing\) userId = existing\.id;/);
});

test('a number that cannot be dialled is the customer\'s to fix now, not «try later»', () => {
  const otp = read('lib/whatsappOtp.js');
  assert.match(otp, /const badNumber = reason === 'invalid_number';/);
  assert.match(otp, /failure\.statusCode = badNumber \? 400 : 503;/);
});
