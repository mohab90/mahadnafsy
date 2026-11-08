'use strict';

// «ربط رقم تاني على الانبوكس وربط ماسنجر … ولما بعمل حفظ البيانات بتروح لما بدخل عليها تاني» (28 Oct 2026).
//
// The credentials are one sealed blob, so everything saved with them — the Phone Number ID, the Business Account ID, the Page ID, the
// instance — vanished from the form the moment it was saved, and the panel cleared even the identifiers after a save. An expired Messenger
// token could not be replaced without deleting the channel (the edit form had no field for it), and the official-API «اختبار» sent a
// message under a category that is closed by default, so it could never succeed.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-channel-saves-0123456789abcdef';
process.env.CHANNEL_SECRET_KEY = process.env.CHANNEL_SECRET_KEY || 'test-key-at-least-sixteen-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { seal, open } = require('../lib/secretBox');
const channels = require('../lib/messagingChannels');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const TOKEN = 'EAAGm0PX4ZCpsBOsecrettokenvalue1234';

const rowOf = (credentials, over = {}) => ({
  id: 'c1', tenant_id: 't1', kind: 'whatsapp', provider: 'meta', label: 'رقم الشركة', display_number: '201012345678', status: 'connected',
  credentials_sealed: seal(credentials), ...over,
});

test('what is saved with the credentials comes back as identifiers, and the secret never does', () => {
  const official = channels.toPublic(rowOf({ metaPhoneId: '109876543210', metaWabaId: '223344556677', metaToken: TOKEN }));
  assert.deepEqual(official.credentialHints, { metaPhoneId: '109876543210', metaWabaId: '223344556677', secretTail: '1234' });
  assert.equal(official.hasCredentials, true);
  assert.ok(!JSON.stringify(official).includes(TOKEN), 'the token is not in the answer');
  assert.ok(!JSON.stringify(official).includes('credentials_sealed'));

  const page = channels.toPublic(rowOf({ pageId: '5544332211', pageAccessToken: TOKEN }, { kind: 'messenger', provider: 'messenger' }));
  assert.deepEqual(page.credentialHints, { pageId: '5544332211', secretTail: '1234' });
  const wapilot = channels.toPublic(rowOf({ instance: 'instance5000', apiKey: 'abcdef-key-9999' }, { provider: 'wapilot' }));
  assert.deepEqual(wapilot.credentialHints, { instance: 'instance5000', secretTail: '9999' });
  assert.equal(channels.toPublic(rowOf(null, { credentials_sealed: null })).credentialHints, null, 'nothing saved, nothing to show');
  assert.equal(channels.toPublic(rowOf({ x: 1 }, { credentials_sealed: 'not a sealed value' })).credentialHints, null, 'a value that cannot be opened shows nothing, and does not fail');
});

test('the list and the single read both bring the sealed value in, to be turned into hints and dropped', async () => {
  const seen = [];
  const row = rowOf({ metaPhoneId: '1098', metaToken: TOKEN });
  const db = { query: async sql => { seen.push(sql.replace(/\s+/g, ' ')); return [/LIMIT 1/.test(sql) ? [row] : [row]]; } };
  const [listed] = await channels.listChannels({ tenantId: 't1' }, db);
  assert.equal(listed.credentialHints.metaPhoneId, '1098');
  assert.ok(seen[0].includes('credentials_sealed'));
  const one = await channels.getChannelById('t1', 'c1', db);
  assert.equal(one.credentialHints.secretTail, '1234');
  assert.ok(!('credentials_sealed' in one));
});

function updateDb(saved) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      if (/^SELECT credentials_sealed FROM messaging_channels/.test(flat)) return [[{ credentials_sealed: seal(saved) }]];
      if (/^SELECT kind, provider FROM messaging_channels/.test(flat)) return [[{ kind: 'whatsapp', provider: 'green-api' }]];
      if (/^SELECT .* FROM messaging_channels WHERE tenant_id=\? AND id=\?/.test(flat)) return [[rowOf(saved)]];
      return [{ affectedRows: 1 }];
    },
  };
}

test('a new token replaces only the token: the saved identifiers stay, and the connection is marked for proof', async () => {
  const db = updateDb({ metaPhoneId: '1098', metaWabaId: '2233', metaToken: 'old-token-0000' });
  await channels.updateChannel('t1', 'c1', { credentials: { metaToken: TOKEN, metaPhoneId: '  ', foreign: 'x' }, mergeCredentials: true }, db);
  const update = db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql));
  assert.match(update.sql, /credentials_sealed = \?, external_id = \?, status = 'pending', last_error = NULL/);
  const sealed = update.params[0];
  assert.deepEqual(open(sealed), { metaPhoneId: '1098', metaWabaId: '2233', metaToken: TOKEN }, 'a blank box and an unknown key change nothing');
  assert.equal(update.params[1], '1098', 'the webhook still finds the channel by its Phone Number ID');
});

test('a change of ID alone, with no token typed, keeps the token', async () => {
  const db = updateDb({ pageId: '5544', pageAccessToken: TOKEN });
  await channels.updateChannel('t1', 'c1', { credentials: { pageId: '7788' }, mergeCredentials: true }, db);
  const update = db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql));
  assert.deepEqual(open(update.params[0]), { pageId: '7788', pageAccessToken: TOKEN });
});

test('merging with nothing typed leaves the credentials and the connection state alone', async () => {
  const db = updateDb({ metaPhoneId: '1098', metaToken: TOKEN });
  await channels.updateChannel('t1', 'c1', { credentials: { metaToken: '', metaPhoneId: '' }, mergeCredentials: true, label: 'اسم جديد' }, db);
  const update = db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql));
  assert.match(update.sql, /label = \?/);
  assert.doesNotMatch(update.sql, /credentials_sealed|status = 'pending'/);
});

test('an edit that sends the saved token back blank never wipes it: merging is the default (1 Nov 2026)', async () => {
  // The form never receives a saved token, so an older screen sent it blank with the rest of the fields, and a replace-all stored the blank.
  const db = updateDb({ metaPhoneId: '1098', metaWabaId: '2233', metaToken: TOKEN });
  await channels.updateChannel('t1', 'c1', { credentials: { metaPhoneId: '1098', metaWabaId: '2233', metaToken: '' } }, db);
  const touched = db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql));
  assert.equal(touched, undefined, 'nothing typed, nothing written');
  const db2 = updateDb({ metaPhoneId: '1098', metaToken: TOKEN });
  await channels.updateChannel('t1', 'c1', { credentials: { metaPhoneId: '55', metaToken: '' } }, db2);
  assert.deepEqual(open(db2.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql)).params[0]), { metaPhoneId: '55', metaToken: TOKEN });
  const db3 = updateDb({ metaPhoneId: '1098', metaToken: TOKEN });
  await channels.updateChannel('t1', 'c1', { credentials: { metaToken: '••••••••' } }, db3);
  assert.equal(db3.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql)), undefined, 'a masked echo is not a token');
});

test('only replaceCredentials: true replaces the credentials whole', async () => {
  const db = updateDb({ metaPhoneId: '1098', metaToken: 'old' });
  await channels.updateChannel('t1', 'c1', { credentials: { metaPhoneId: '55', metaToken: 'new' }, replaceCredentials: true }, db);
  const update = db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql));
  assert.deepEqual(open(update.params[0]), { metaPhoneId: '55', metaToken: 'new' });
});

test('a switch of provider is applied and checked, not dropped', async () => {
  const db = updateDb({ instanceId: '1', apiToken: 'x' });
  await channels.updateChannel('t1', 'c1', { provider: 'wapilot' }, db);
  assert.match(db.calls.find(call => /^UPDATE messaging_channels SET/.test(call.sql)).sql, /provider = \?/);
  await assert.rejects(channels.updateChannel('t1', 'c1', { provider: 'messenger' }, db), { statusCode: 400 }, 'messenger is not a WhatsApp provider');
});

test('the official API is asked of Meta, with the one Graph version, and says who the number belongs to', async () => {
  const { verifyMetaCredentials } = require('../lib/whatsapp');
  const { GRAPH } = require('../lib/metaGraph');
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => { seen.push({ url, options }); return { ok: true, status: 200, json: async () => ({ id: '1098', display_phone_number: '+20 10 1234 5678', verified_name: 'معهد الدراسات النفسية', quality_rating: 'GREEN', name_status: 'APPROVED' }) }; };
  try {
    const ok = await verifyMetaCredentials({ metaPhoneId: '1098', metaToken: TOKEN });
    assert.deepEqual(ok, { ok: true, number: '+20 10 1234 5678', name: 'معهد الدراسات النفسية', quality: 'GREEN', nameStatus: 'APPROVED' });
    assert.equal(seen[0].url.startsWith(`${GRAPH}/1098?fields=`), true);
    assert.equal(seen[0].options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(await verifyMetaCredentials({ metaPhoneId: '1098' }), { ok: false, reason: 'not_configured' });
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Error validating access token: Session has expired' } }) });
    assert.deepEqual(await verifyMetaCredentials({ metaPhoneId: '1098', metaToken: TOKEN }), { ok: false, reason: 'Error validating access token: Session has expired' });
  } finally { global.fetch = original; }
});

test('4 Nov 2026: an id Meta does not know is explained — the account id typed as the number is corrected, anything else says what to check', async () => {
  const { verifyMetaCredentials, listMetaTemplates } = require('../lib/whatsapp');
  const original = global.fetch;
  const gone = { error: { message: "Unsupported get request. Object with ID '797474976773775' does not exist, cannot be loaded due to missing permissions, or does not support this operation", code: 100 } };
  const answer = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
  try {
    // The id is a WhatsApp Business Account with one number: that number is the answer.
    global.fetch = async url => (String(url).includes('/phone_numbers') ? answer({ data: [{ id: '1098', display_phone_number: '+20 10 1234 5678', verified_name: 'المعهد' }] }) : answer(gone, false));
    const fixed = await verifyMetaCredentials({ metaPhoneId: '797474976773775', metaToken: TOKEN });
    assert.equal(fixed.ok, true);
    assert.equal(fixed.correctedPhoneId, '1098');
    assert.equal(fixed.wabaId, '797474976773775');
    // Several numbers: the owner is told which is which, nothing is guessed.
    global.fetch = async url => (String(url).includes('/phone_numbers') ? answer({ data: [{ id: '1', display_phone_number: '+20 1' }, { id: '2', display_phone_number: '+20 2' }] }) : answer(gone, false));
    const many = await verifyMetaCredentials({ metaPhoneId: '797474976773775', metaToken: TOKEN });
    assert.equal(many.ok, false);
    assert.match(many.reason, /WABA/);
    assert.match(many.reason, /\+20 2 = 2/);
    // Neither: the token or the id is wrong, said in Arabic with the original sentence kept.
    global.fetch = async () => answer(gone, false);
    const unknown = await verifyMetaCredentials({ metaPhoneId: '797474976773775', metaToken: TOKEN });
    assert.equal(unknown.ok, false);
    assert.match(unknown.reason, /Phone Number ID/);
    assert.match(unknown.reason, /whatsapp_business_management/);
    assert.match(unknown.reason, /does not exist/);
  } finally { global.fetch = original; }
  assert.match(read('api/routes/messaging-channels.js'), /async function saveCorrectedPhoneId\(tenantId, channelId, check\)/);
  assert.equal(typeof listMetaTemplates, 'function');
});




