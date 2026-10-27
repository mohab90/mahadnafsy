'use strict';

// «مراقبة وتنبيهات» (26 Oct 2026): the server tells the owner when the error rate jumps, a route is hammered in a loop, the system is slow,
// the nightly backup is stale or never left the machine, or messages are stuck — instead of nobody finding out.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ops-watchdog-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const watchdog = require('../lib/opsWatchdog');

const MINUTE = 60 * 1000;
const at = Date.UTC(2026, 9, 26, 12, 0, 0);
const reset = () => watchdog._buckets.clear();
const feed = (minutesAgo, route, count, { status = 200, ms = 20 } = {}) => {
  for (let i = 0; i < count; i += 1) watchdog.noteRequest({ route, status, ms }, at - minutesAgo * MINUTE + 1000);
};

test('normal traffic raises nothing', () => {
  reset();
  for (let minute = 0; minute < 30; minute += 1) { feed(minute, 'GET /api/staff/leads', 20); feed(minute, 'GET /api/me/subscriber', 15); }
  feed(2, 'POST /api/admin/leads', 1, { status: 500 });
  assert.deepEqual(watchdog.trafficFindings(at), []);
});

test('a jump in 5xx is an alert that names the routes', () => {
  reset();
  feed(1, 'GET /api/admin/subscribers', 90);
  feed(1, 'GET /api/admin/subscribers', 12, { status: 500 });
  feed(3, 'POST /api/admin/subscriber-payments', 3, { status: 500 });
  const [finding] = watchdog.trafficFindings(at);
  assert.equal(finding.key, 'errors');
  assert.match(finding.body, /15 خطأ \(5xx\) من 105 طلب/);
  assert.match(finding.body, /GET \/api\/admin\/subscribers \(12\)/);
});

test('a route asked far more than it was an hour before is a storm — the 20 Oct loop that went unnoticed', () => {
  reset();
  // An hour of 30 requests every five minutes, then 2,500 in five minutes.
  for (let minute = 59; minute >= 5; minute -= 1) feed(minute, 'GET /api/staff/me', 6);
  for (let minute = 4; minute >= 0; minute -= 1) feed(minute, 'GET /api/staff/me', 500);
  const storm = watchdog.trafficFindings(at).find(finding => finding.key === 'storm');
  assert.ok(storm, 'the loop is found');
  assert.match(storm.body, /GET \/api\/staff\/me: 2500 طلب في 5 دقايق/);
  // The same volume on a route that is always that busy is not a storm.
  reset();
  for (let minute = 59; minute >= 0; minute -= 1) feed(minute, 'GET /api/admin/join-us', 400);
  assert.equal(watchdog.trafficFindings(at).find(finding => finding.key === 'storm'), undefined);
});

test('slowness needs enough requests to mean something', () => {
  reset();
  feed(2, 'GET /api/admin/subscribers', 20, { ms: 9000 });
  assert.equal(watchdog.trafficFindings(at).find(finding => finding.key === 'slow'), undefined, 'twenty requests are an anecdote');
  feed(1, 'GET /api/admin/subscribers', 100, { ms: 4200 });
  const slow = watchdog.trafficFindings(at).find(finding => finding.key === 'slow');
  assert.ok(slow);
  assert.match(slow.body, /GET \/api\/admin\/subscribers/);
});

test('backups: stale, missing, never copied off the machine — and an unreadable folder says nothing', () => {
  const hours = h => at - h * 3600 * 1000;
  const fresh = { readable: true, newest: { name: 'db.sql.gz', bytes: 5e6, at: hours(5) } };
  const copied = { readable: true, backupOkAt: hours(5), offsiteOkAt: hours(5), lastAlert: null };
  assert.deepEqual(watchdog.backupFindings({ local: fresh, offsite: copied, now: at }), []);
  const stale = watchdog.backupFindings({ local: { readable: true, newest: { name: 'x', bytes: 5e6, at: hours(60) } }, offsite: copied, now: at });
  assert.equal(stale[0].key, 'backup');
  assert.match(stale[0].body, /60 ساعة/);
  assert.equal(watchdog.backupFindings({ local: { readable: true, newest: null }, offsite: copied, now: at })[0].key, 'backup');
  const never = watchdog.backupFindings({ local: fresh, offsite: { readable: true, backupOkAt: hours(5), offsiteOkAt: null, lastAlert: 'OFF-SITE BACKUP FAILED: MAHAD_BACKUP_REMOTE is not set' }, now: at });
  assert.equal(never[0].key, 'offsite');
  assert.match(never[0].body, /MAHAD_BACKUP_REMOTE is not set/);
  assert.deepEqual(watchdog.backupFindings({ local: { readable: false, newest: null }, offsite: { readable: false }, now: at }), [], 'a development machine has no backup folder');
  assert.deepEqual(watchdog.backupFindings({ local: fresh, offsite: { readable: false }, now: at }), [], 'an unreadable log is unknown, not a failure');
});

test('the backup folder and the job log are read as they are on the server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-backup-'));
  fs.writeFileSync(path.join(dir, 'mahadnafsy_db_20261025.sql.gz'), Buffer.alloc(1_200_000));
  fs.writeFileSync(path.join(dir, 'mahadnafsy_db_empty.sql.gz'), Buffer.alloc(4000));
  const local = watchdog.newestBackup(dir);
  assert.equal(local.readable, true);
  assert.equal(local.newest.name, 'mahadnafsy_db_20261025.sql.gz', 'a file too small to be a dump is no backup');
  assert.deepEqual(watchdog.newestBackup(path.join(dir, 'nope')), { readable: false, newest: null });
  const log = path.join(dir, 'backup.log');
  fs.writeFileSync(log, [
    '2026-10-25T03:20:01+03:00 backup ok: /var/backups/mahad-db/x.sql.gz (60M, 234 tables)',
    '2026-10-25T03:21:10+03:00 ALERT OFF-SITE BACKUP FAILED: rclone copy returned non-zero',
    '2026-10-26T03:20:01+03:00 backup ok: /var/backups/mahad-db/y.sql.gz (61M, 234 tables)',
    '2026-10-26T03:22:30+03:00 off-site ok: b2:mahad/y.sql.gz.age (30000000 bytes, encrypted)',
  ].join('\n'));
  const state = watchdog.offsiteState(log);
  assert.equal(state.readable, true);
  assert.equal(state.offsiteOkAt, Date.parse('2026-10-26T03:22:30+03:00'));
  assert.equal(state.backupOkAt, Date.parse('2026-10-26T03:20:01+03:00'));
  assert.match(state.lastAlert, /OFF-SITE BACKUP FAILED/);
  assert.equal(watchdog.offsiteState(path.join(dir, 'missing.log')).readable, false);
});

test('stuck or dead messages are found per channel, from rows read for this tenant only', async () => {
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); return [[{ channel: 'whatsapp', stuck: '31', dead: '2' }, { channel: 'email', stuck: '0', dead: '14' }]]; } };
  const [finding] = await watchdog.outboxFindings(db, 't1', at);
  assert.equal(finding.key, 'outbox');
  assert.match(finding.body, /واتساب: 31 رسالة واقفة/);
  assert.match(finding.body, /إيميل: 14 رسالة فشلت/);
  assert.equal(seen[0].params[2], 't1');
  assert.deepEqual(await watchdog.outboxFindings({ query: async () => [[{ channel: 'whatsapp', stuck: '3', dead: '1' }]] }, 't1', at), []);
});

test('an alert reaches each owner number once per quiet window, in the owner\'s words', async () => {
  const sent = [];
  const outbox = require('../lib/outbox');
  const ownerReport = require('../lib/ownerDailyReport');
  const original = { enqueue: outbox.enqueue, settings: ownerReport.ownerReportSettings };
  outbox.enqueue = async message => { sent.push(message); return `id-${sent.length}`; };
  ownerReport.ownerReportSettings = async () => ({ phones: ['01012345678', '01099999999'] });
  try {
    const findings = [{ key: 'errors', severity: 'high', title: 'أخطاء سيرفر كتيرة دلوقتي', body: '15 خطأ', hint: 'ابعت الرسالة للمطوّر.' }];
    const queued = await watchdog.queueAlerts({ findings, tenantId: 't1', db: {}, now: at });
    assert.equal(queued, 2);
    assert.match(sent[0].payload.message, /^🚨 \*أخطاء سيرفر كتيرة دلوقتي\*/);
    assert.equal(sent[0].payload.category, 'staff_alert');
    assert.equal(sent[0].channel, 'whatsapp');
    // Same window → same key (the outbox refuses the repeat); the next window → a new key.
    await watchdog.queueAlerts({ findings, tenantId: 't1', db: {}, now: at + 30 * MINUTE });
    await watchdog.queueAlerts({ findings, tenantId: 't1', db: {}, now: at + 3 * 3600 * 1000 });
    assert.equal(sent[0].dedupeKey, sent[2].dedupeKey);
    assert.notEqual(sent[0].dedupeKey, sent[4].dedupeKey);
    assert.notEqual(sent[0].dedupeKey, sent[1].dedupeKey, 'each number has its own');
    assert.ok(sent.every(message => message.dedupeKey.length <= 150));
    // Nobody to tell: nothing queued, and it says so.
    ownerReport.ownerReportSettings = async () => ({ phones: [] });
    assert.equal(await watchdog.queueAlerts({ findings, tenantId: 't1', db: {}, now: at }), 0);
  } finally { outbox.enqueue = original.enqueue; ownerReport.ownerReportSettings = original.settings; }
});

test('the heartbeat pings an https address and nothing else', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true }; };
  assert.equal(await watchdog.heartbeat({ env: {}, fetchImpl }), false);
  assert.equal(await watchdog.heartbeat({ env: { OPS_HEARTBEAT_URL: 'http://insecure.example/ping' }, fetchImpl }), false);
  assert.equal(await watchdog.heartbeat({ env: { OPS_HEARTBEAT_URL: 'https://hc-ping.com/abc' }, fetchImpl }), true);
  assert.deepEqual(calls, ['https://hc-ping.com/abc']);
  assert.equal(await watchdog.heartbeat({ env: { OPS_HEARTBEAT_URL: 'https://hc-ping.com/abc' }, fetchImpl: async () => { throw new Error('down'); } }), false);
});

test('the watchdog is hooked to every request, runs every five minutes under a lock, and is readable by the owner', () => {
  assert.match(read('api/lib/performanceMonitor.js'), /require\('\.\/opsWatchdog'\)\.noteRequest\(\{ route: key, status, ms \}\)/);
  const jobs = read('api/lib/backgroundScheduler.js');
  assert.match(jobs, /lockedJob\('ops_watchdog', \(\) => require\('\.\/opsWatchdog'\)\.runOpsWatchdog\(\{ pool, logger \}\)/);
  assert.match(jobs, /repeat\(watch, 5 \* 60 \* 1000\)/);
  assert.match(read('api/routes/admin-utils.js'), /router\.get\('\/api\/admin\/system\/watchdog', requireAuth, requireAdmin/);
});

test('the one-time off-site setup keeps the private key off the server and never overwrites what exists', () => {
  const script = read('deploy/setup-offsite-backup.sh');
  assert.match(script, /age-keygen -o "\$PRIVATE_KEY"/);
  assert.match(script, /age-keygen -y "\$PRIVATE_KEY" > "\$RECIPIENTS"/, 'only the public key stays in the settings');
  assert.match(script, /MAHAD_BACKUP_AGE_RECIPIENTS=%s/);
  assert.doesNotMatch(script, /MAHAD_BACKUP_AGE_IDENTITY|age -d/, 'the server never decrypts');
  assert.match(script, /chmod 600 "\$ENV_FILE"/);
  assert.match(script, /already exists — left as it is/, 'an existing settings file is not overwritten');
  assert.match(script, /shred -u/, 'the owner is told to move the private key and delete it');
  assert.match(read('deploy/README_AR.md'), /'bash -s -- b2:mahad-backups\/db' < deploy\/setup-offsite-backup\.sh/);
  assert.match(read('deploy/README_AR.md'), /OPS_HEARTBEAT_URL/);
});

test('the off-site copies are pruned only after today\'s is proven at the destination, and only this job\'s own files', () => {
  const script = read('deploy/mahad-db-backup.sh');
  const uploaded = script.indexOf('log "off-site ok:');
  const pruned = script.indexOf('rclone delete "$REMOTE"');
  assert.ok(uploaded > 0 && pruned > uploaded, 'retention comes after the verified upload');
  assert.match(script, /REMOTE_KEEP_DAYS="\$\{MAHAD_BACKUP_REMOTE_KEEP_DAYS:-30\}"/);
  assert.match(script, /--drive-use-trash=false --min-age "\$\{REMOTE_KEEP_DAYS\}d" --include "\$\{DB\}_\*\.sql\.gz\.age" --include "\$\{DB\}_\*\.sql\.gz\.gpg"/);
  assert.match(script, /\[ "\$\{REMOTE_KEEP_DAYS:-0\}" -ge 7 \]/, 'a mistyped keep-days can never mean «delete everything»');
  assert.match(script, /WARNING off-site retention failed \(the new copy is safe\)/);
});

test('the Google Drive instructions ask only for the drive.file scope and never use the service account', () => {
  const readme = read('deploy/README_AR.md');
  const encoded = Buffer.from('{"scope":"drive.file"}').toString('base64').replace(/=+$/, '');
  assert.ok(readme.includes(`rclone authorize "drive" "${encoded}"`));
  assert.match(readme, /rclone config create gdrive drive scope=drive\.file token=/);
  assert.match(readme, /gdrive:mahad-backups/);
  assert.match(readme, /حساب الخدمة \(service account\) بتاع رفع الصور \*\*مش مناسب\*\*/);
});

// 27 Oct 2026: «واتساب: 13 رسالة فشلت نهائياً» (then 42) with the channel connected and sending. 299 of the 300 dead rows
// were category_disabled — the message types the owner keeps closed — and no code had failed. The count read them as a
// failing channel, and the alert said codes pass through the outbox, which they do not (lib/whatsappOtp.js sends direct).
test('messages refused on purpose are not counted as a channel failing', async () => {
  const seen = [];
  const db = { query: async sql => { seen.push(sql); return [[{ channel: 'whatsapp', stuck: '0', dead: '0' }]]; } };
  assert.deepEqual(await watchdog.outboxFindings(db, 't1', at), []);
  const sql = seen[0];
  assert.match(sql, /status IN \('failed','dead'\) AND created_at >= \? AND COALESCE\(last_error, ''\) NOT REGEXP '[^']*category_disabled[^']*'/);
  // every refusal the outbox itself kills on the first attempt is left out of the count
  const outbox = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'outbox.js'), 'utf8');
  const permanent = outbox.match(/const PERMANENT_REFUSAL = \/([^/]+)\//)[1].split('|');
  for (const token of permanent) assert.ok(sql.includes(token), token);
  for (const token of ['invalid_number', 'undialable_phone']) assert.ok(sql.includes(token), token);
});

test('the alert does not say codes go through the outbox', async () => {
  const [finding] = await watchdog.outboxFindings({ query: async () => [[{ channel: 'whatsapp', stuck: '0', dead: '12' }]] }, 't1', at);
  assert.match(finding.body, /واتساب: 12 رسالة فشلت نهائياً/);
  assert.match(finding.body, /بتتبعت مباشرة ومش بتعدي من الطابور ده/);
  assert.doesNotMatch(finding.body, /بتعدي من هنا/);
});

// 27 Oct 2026: «اعملي تنبيه لو الإيميل وقف ويبعتلي على واتساب زي رسايل الـOTP» — the owner is told on WhatsApp when sign-in codes stop
// arriving or the mail relay refuses sends; both go out directly, so neither shows in the outbox count.
test('sign-in codes that were refused are found, from the codes of this tenant in the last hour', async () => {
  const seen = [];
  const answers = [[[{ failed: '6', accepted: '9' }]], [[{ reason: 'channel_disconnected', n: 6 }]]];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); return answers.shift(); } };
  const [finding] = await watchdog.otpFindings(db, 't1', at);
  assert.equal(finding.key, 'otp');
  assert.equal(finding.severity, 'high');
  assert.match(finding.body, /6 كود من 15 فشل إرساله في آخر ساعة/);
  assert.match(finding.body, /أكتر سبب: channel_disconnected/);
  assert.equal(seen[0].params[0], 't1');
  assert.equal(seen[0].params[1].getTime(), at - 60 * MINUTE);
  // a number that is not on WhatsApp is the customer's to fix, and is not counted
  assert.match(seen[0].sql, /delivery_status='failed' AND COALESCE\(delivery_error_code, ''\) <> 'invalid_number'/);
  assert.match(seen[0].sql, /type='login' AND phone IS NOT NULL/);
  assert.match(finding.hint, /قنوات الرسائل/);
});

test('a few refused codes among many sent, or a lone one, tell nobody', async () => {
  const once = row => ({ query: async () => [[row]] });
  assert.deepEqual(await watchdog.otpFindings(once({ failed: '2', accepted: '0' }), 't1', at), [], 'two is under the floor');
  assert.deepEqual(await watchdog.otpFindings(once({ failed: '4', accepted: '40' }), 't1', at), [], 'a share of 9% is a hiccup');
  assert.deepEqual(await watchdog.otpFindings(once({ failed: null, accepted: null }), 't1', at), [], 'no codes at all');
});

test('the mail relay refusing sends one after another is found; a customer\'s own bad address is not', () => {
  const state = (overrides = {}) => ({ failuresSinceSuccess: 4, lastFailureAt: new Date(at - 10 * MINUTE).toISOString(), lastSuccessAt: new Date(at - 50 * MINUTE).toISOString(), lastError: 'Invalid login: 535 Authentication failed', ...overrides });
  const [finding] = watchdog.emailFindings({ tenantId: 't1', now: at, health: state() });
  assert.equal(finding.key, 'email');
  assert.equal(finding.severity, 'high');
  assert.match(finding.body, /4 محاولة إرسال فشلت ورا بعض — آخر مرة اشتغل فيها من 50 دقيقة/);
  assert.match(finding.body, /Invalid login: # Authentication failed|Invalid login: 535 Authentication failed/);
  assert.match(finding.hint, /Brevo/);
  assert.deepEqual(watchdog.emailFindings({ now: at, health: state({ failuresSinceSuccess: 2 }) }), [], 'two in a row is not yet');
  assert.deepEqual(watchdog.emailFindings({ now: at, health: state({ failuresSinceSuccess: 0, lastFailureAt: null }) }), [], 'healthy');
  assert.deepEqual(watchdog.emailFindings({ now: at, health: state({ lastFailureAt: new Date(at - 4 * 3600 * 1000).toISOString() }) }), [], 'an old failure is not news');
  for (const lastError of ['No recipients defined', 'Recipient address rejected: Access denied', 'Mailbox unavailable']) {
    assert.deepEqual(watchdog.emailFindings({ now: at, health: state({ lastError }) }), [], lastError);
  }
});

test('addresses and long numbers never go into an alert that is sent to a phone', () => {
  const [finding] = watchdog.emailFindings({ now: at, health: { failuresSinceSuccess: 5, lastFailureAt: new Date(at - MINUTE).toISOString(), lastSuccessAt: null, lastError: 'connect ETIMEDOUT 18.134.12.201:587 for ahmed.ali@gmail.com id 123456789' } });
  assert.doesNotMatch(finding.body, /ahmed|gmail|123456789/);
  assert.match(finding.body, /<email>/);
});

test('the watchdog asks both questions, and tells the owner in the same way as the others', () => {
  const source = read('api/lib/opsWatchdog.js');
  assert.match(source, /\.\.\.await otpFindings\(pool, tenantId, now\)/);
  assert.match(source, /emailFindings\(\{ tenantId, now \}\)/);
  assert.equal(watchdog.QUIET_HOURS.otp, 2);
  assert.equal(watchdog.QUIET_HOURS.email, 3);
  assert.ok(watchdog.T.otpFailed >= 3 && watchdog.T.emailFailures >= 3);
  // the explanation at the top no longer says codes pass through the outbox
  assert.doesNotMatch(source, /login codes and password resets are among them/);
});
