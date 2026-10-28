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

test('without «merge» the credentials are replaced whole, as before', async () => {
  const db = updateDb({ metaPhoneId: '1098', metaToken: 'old' });
  await channels.updateChannel('t1', 'c1', { credentials: { metaPhoneId: '55', metaToken: 'new' } }, db);
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

test('every save is proved at once, the official channel is tested without a message, and the staff panel keeps what it saved', () => {
  const route = read('api/routes/messaging-channels.js');
  assert.match(route, /async function verifySaved\(tenantId, channel\)/);
  assert.match(route, /if \(credentials && \(kind === 'messenger' \|\| provider === 'meta'\)\) await verifySaved\(req\.tenantId, channel\);/);
  assert.match(route, /if \(req\.body\?\.credentials\) await verifySaved\(req\.tenantId, existing\);/);
  assert.match(route, /if \(Object\.keys\(credentials\)\.length\) await verifySaved\(req\.tenantId, saved\);/);
  assert.match(route, /if \(channel\.provider === 'meta'\) \{\s*const resolved = await channels\.getSendableChannel[\s\S]*?verifyMetaCredentials\(resolved\.credentials\)/);
  assert.match(route, /mergeCredentials: Boolean\(mergeCredentials\), provider,/);

  const staff = read('admin/pages/dashboard/tabs/messaging/MyWhatsappChannelPanel.tsx');
  assert.match(staff, /setInstanceId\(hints\.instanceId \|\| ''\); setWapilotInstance\(hints\.instance \|\| ''\); setMetaPhoneId\(hints\.metaPhoneId \|\| ''\);/);
  assert.match(staff, /mergeCredentials: reconnecting/);
  assert.doesNotMatch(staff, /setInstanceId\(''\); setApiToken\(''\); setMetaPhoneId\(''\)/, 'the identifiers are not wiped after a save');
  const panel = read('admin/pages/dashboard/tabs/messaging/MessagingChannelsPanel.tsx');
  assert.match(panel, /patch\.credentials = credentials; patch\.mergeCredentials = true;/);
  assert.match(panel, /channel\.provider === 'meta' && \(/);
  assert.match(panel, /channel\.kind === 'messenger' && \(/);
});

test('a save that fails says why, instead of «فشل الحفظ» alone', () => {
  const staff = read('admin/pages/dashboard/tabs/messaging/MyWhatsappChannelPanel.tsx');
  assert.match(staff, /catch \(error\) \{ notify\('error', error instanceof Error && error\.message \? `فشل الحفظ: \$\{error\.message\}` : 'فشل الحفظ'\); \}/);
  assert.doesNotMatch(staff, /catch \{ notify\('error', 'فشل الحفظ'\); \}/);
});
