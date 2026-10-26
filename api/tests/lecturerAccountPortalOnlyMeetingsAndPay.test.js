'use strict';

// 26 Oct 2026 — the lecturer's account, second round: both jobs on one login, three prices, the portal and nothing else, the
// system's own video rooms (Zoom / Google Meet), and the requests of a person who is not a permanent employee.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-meeting-integration-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

// The tenant setting store, in memory — set before meetingProvider loads, which takes the functions at require time.
const store = new Map();
const tenantSettings = require('../lib/tenantSettings');
tenantSettings.getTenantSetting = async (key, { tenantId, fallback = null } = {}) => store.get(`${tenantId}:${key}`) ?? fallback;
tenantSettings.setTenantSetting = async (key, value, { tenantId } = {}) => { store.set(`${tenantId}:${key}`, JSON.parse(JSON.stringify(value))); };
const meetings = require('../lib/meetingProvider');

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a lecturer\'s account is the portal and nothing else: courses, content and payments stay off whatever the grid says', () => {
  const { hasPermission, resolvePermissions, ROLE_PERMS } = require('../constants/permissions');
  for (const role of ['instructor', 'trainer', 'consultant', 'expert']) {
    // An old grid saved when these jobs carried the course boxes.
    const staff = { role, permissions_json: JSON.stringify(['view_dashboard', 'view_courses', 'manage_courses', 'manage_lectures', 'manage_content', 'manage_payments', 'view_consultations']) };
    for (const blocked of ['view_courses', 'manage_courses', 'manage_lectures', 'manage_content', 'manage_payments', 'manage_bundles', 'manage_instructors']) {
      assert.equal(hasPermission(staff, blocked), false, `${role} must not hold ${blocked}`);
    }
    assert.equal(hasPermission(staff, 'use_lecturer_portal'), true, `${role} always has the portal`);
    assert.equal(hasPermission(staff, 'view_consultations'), true);
    assert.ok(!ROLE_PERMS[role].includes('view_courses') && !ROLE_PERMS[role].includes('manage_lectures'), `${role} defaults carry no course boxes`);
  }
  // Everyone else is untouched.
  assert.equal(hasPermission({ role: 'manager' }, 'view_courses'), true);
  assert.deepEqual(resolvePermissions({ role: 'accountant', permissions_json: JSON.stringify(['manage_payments']) }), ['manage_payments']);
});

test('the dashboard bounces a lecturer to the portal, and the portal\'s live buttons no longer need the courses box', () => {
  const app = read('admin/App.tsx');
  assert.match(app, /const NotForLecturers/);
  assert.match(app, /<Navigate to="\/lecturer-portal" replace \/>/);
  assert.equal((app.match(/<NotForLecturers><Dashboard \/><\/NotForLecturers>/g) || []).length, 6, 'every dashboard URL');
  const live = read('api/routes/liveStreams.js');
  assert.match(live, /'\/api\/staff\/me\/live-streams', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_courses', 'use_lecturer_portal'\)/);
  assert.match(live, /\/api\/staff\/me\/live-streams\/:id\/status', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_courses', 'use_lecturer_portal'\)/);
});

test('three prices: the live hour, the branch hour and the session — and a live that ends earns its fee', () => {
  const { lectureFee } = require('../lib/instructorPay');
  const rate = { pay_basis: 'per_hour', lecture_rate_per_hour: 300, training_rate_per_hour: 250, lecture_hours: 2 };
  assert.deepEqual(lectureFee(rate, 1.5, 'live'), { total: 450, fixed: null, hours: 1.5, ratePerHour: 300 });
  assert.deepEqual(lectureFee(rate, null, 'branch'), { total: 500, fixed: null, hours: 2, ratePerHour: 250 }, 'a branch lecture: its hour price × the default lecture hours');
  // A lecturer paid only for branch hours earns nothing for a live, and a revenue-share lecturer still gets the branch hour.
  assert.equal(lectureFee({ pay_basis: 'revenue_share', training_rate_per_hour: 250 }, 2, 'live'), null);
  assert.equal(lectureFee({ pay_basis: 'revenue_share', training_rate_per_hour: 250 }, 2, 'branch').total, 500);
  assert.match(read('api/lib/instructorPay.js'), /sourceKey: `daqqi:\$\{round\.id\}:\$\{week\}`, date: week, actor, kind: 'branch'/);
  const live = read('api/routes/liveStreams.js');
  assert.match(live, /sourceKey: `livestream:\$\{stream\.id\}`/, 'one fee per live, however often it is saved');
  const section = read('admin/pages/dashboard/tabs/courses/LecturerAccountSection.tsx');
  for (const text of ['سعر ساعة اللايف', 'سعر ساعة الحضور في الدقي', 'سعر الجلسة الاستشارية', 'training_rate_per_hour', 'محاضر + استشاري']) assert.ok(section.includes(text), text);
});

test('one login can hold both jobs: lecturer + consultant', () => {
  const section = read('admin/pages/dashboard/tabs/courses/LecturerAccountSection.tsx');
  assert.match(section, /\['BOTH', 'محاضر \+ استشاري \(الاتنين\)'\]/);
  assert.match(section, /const realRole = \(job: string\) => \(job === 'BOTH' \? 'INSTRUCTOR' : job\)/);
  assert.match(section, /consultationSettings: \{ \.\.\.draft\.consultationSettings, enabled: true \}/, 'the consultation service is switched on with it');
  const portal = read('api/routes/lecturer-portal.js');
  assert.match(portal, /capabilities: \{\s*lecturer:[\s\S]*consultant: Boolean\(me\.therapist\?\.is_consultation_enabled\)/);
  assert.match(read('admin/pages/LecturerPortal.tsx'), /overview\.capabilities\.consultant/);
});

test('the portal carries the permission, leave and advance requests of someone who is not a permanent employee', () => {
  assert.match(read('admin/pages/LecturerPortal.tsx'), /\{ id: 'requests', label: 'طلباتي \(إذن · إجازة · سلفة\)'/);
  const requests = read('admin/pages/lecturer/LecturerRequests.tsx');
  assert.match(requests, /<MyRequestsSection hr=\{hr\} leaves=\{leaves\} advances=\{advances\}/);
  const section = read('admin/pages/dashboard/my-profile/MyRequestsSection.tsx');
  for (const text of ['إذن صباحي', 'إذن مسائي', 'طلب سلفة', 'طلب إجازة']) assert.ok(section.includes(text), text);
});

test('Zoom: the system gets a token, makes the meeting and hands back both links', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://zoom.us/oauth/token')) return response(200, { access_token: 'zoom-token', expires_in: 3600 });
    if (String(url).endsWith('/users/me/meetings')) return response(201, { id: 987654321, join_url: 'https://zoom.us/j/987654321?pwd=x', start_url: 'https://zoom.us/s/987654321?zak=y', password: 'abc123' });
    return response(404, {});
  };
  meetings._tokenCache.clear();
  const saved = await meetings.saveIntegration('t1', { provider: 'zoom', zoom: { accountId: 'ACC', clientId: 'CID', clientSecret: 'sh-secret' } });
  assert.equal(saved.configured, true);
  assert.equal(JSON.stringify(saved).includes('sh-secret'), false, 'the secret never comes back');
  assert.match(store.get('t1:meeting_integration').zoom.clientSecretSealed, /^v1:/, 'it is sealed at rest');
  const made = await meetings.createMeeting('t1', { topic: 'مراجعة', startLocal: '2026-11-01T14:00:00', timeZone: 'UTC', durationMinutes: 90 }, { fetchImpl });
  assert.deepEqual(made, { provider: 'zoom', meetingId: '987654321', joinUrl: 'https://zoom.us/j/987654321?pwd=x', hostUrl: 'https://zoom.us/s/987654321?zak=y', passcode: 'abc123' });
  const token = calls[0];
  assert.equal(token.options.headers.Authorization, `Basic ${Buffer.from('CID:sh-secret').toString('base64')}`);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.duration, 90);
  assert.equal(body.start_time, '2026-11-01T14:00:00');
  assert.equal(body.timezone, 'UTC');
  // A second meeting reuses the token.
  await meetings.createMeeting('t1', { topic: 'x', startLocal: '2026-11-02T10:00:00', durationMinutes: 30 }, { fetchImpl });
  assert.equal(calls.filter(call => call.url.startsWith('https://zoom.us/oauth/token')).length, 1);
  // A blank secret on a later save keeps the sealed one.
  await meetings.saveIntegration('t1', { provider: 'zoom', zoom: { accountId: 'ACC2', clientId: 'CID', clientSecret: '' } });
  assert.equal((await meetings.integrationStatus('t1')).configured, true);
});

test('Google Meet: a Calendar event with a Meet room, made by the service account for the delegated user', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const env = { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@project.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://oauth2.googleapis.com/token') return response(200, { access_token: 'g-token', expires_in: 3600 });
    if (String(url).startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) return response(200, { id: 'evt1', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
    return response(404, {});
  };
  meetings._tokenCache.clear();
  assert.equal((await meetings.integrationStatus('t2', { env })).configured, false, 'nothing is set up yet');
  await meetings.saveIntegration('t2', { provider: 'google_meet', google: { delegatedUser: 'Meetings@Institute.com' } });
  const made = await meetings.createMeeting('t2', { topic: 'استشارة', startLocal: '2026-11-01 16:30:00', timeZone: 'Africa/Cairo', durationMinutes: 45 }, { fetchImpl, env });
  assert.deepEqual(made, { provider: 'google_meet', meetingId: 'evt1', joinUrl: 'https://meet.google.com/abc-defg-hij', hostUrl: 'https://meet.google.com/abc-defg-hij', passcode: null });
  const assertion = new URLSearchParams(calls[0].options.body).get('assertion').split('.');
  const claims = JSON.parse(Buffer.from(assertion[1], 'base64url').toString());
  assert.equal(claims.sub, 'meetings@institute.com', 'acts for the delegated user');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.events');
  const event = JSON.parse(calls[1].options.body);
  assert.equal(event.end.dateTime, '2026-11-01T17:15:00', '45 minutes after the start, on the same wall clock');
  assert.equal(event.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
});

test('with no integration the system makes nothing, and a provider that refuses is reported', async () => {
  assert.equal(await meetings.createMeeting('nobody', { topic: 'x', startLocal: '2026-11-01T10:00:00' }), null);
  meetings._tokenCache.clear();
  await meetings.saveIntegration('t3', { provider: 'zoom', zoom: { accountId: 'A', clientId: 'C', clientSecret: 'S' } });
  await assert.rejects(
    meetings.createMeeting('t3', { topic: 'x', startLocal: '2026-11-01T10:00:00' }, { fetchImpl: async () => response(401, { reason: 'Invalid client_id or client_secret' }) }),
    /Zoom refused the keys \(401/);
  assert.equal(meetings.addMinutesLocal('2026-12-31T23:30:00', 45), '2027-01-01T00:15:00');
});

test('lives and consultations take their rooms from the system', () => {
  const portal = read('api/routes/lecturer-portal.js');
  assert.match(portal, /const integrated = \(await integrationStatus\(me\.tenantId\)\)\.configured;\s*const live = await liveFields\(me, req\.body \|\| \{\}, \{ integrated \}\);\s*const room = integrated \? await makeRoom\(me, live\) : null;/);
  assert.match(portal, /stream_url, platform, visibility, target_course_ids_json, status, description, created_at, host_url, meeting_id, meeting_provider/);
  assert.match(portal, /router\.post\('\/api\/staff\/lecturer\/consultations\/:id\/start'/);
  assert.match(portal, /الروابط بيعملها السيستم لوحده/, 'a lecturer cannot type a link over the system\'s');
  assert.match(portal, /deleteMeeting\(me\.tenantId, \{ provider: live\.meeting_provider, meetingId: live\.meeting_id \}\)/, 'a cancelled live takes its room down');
  assert.match(read('api/lib/consultationReminders.js'), /await ensureUpcomingMeetings\(db, \{ tenantId \}\)/);
  assert.match(read('api/lib/consultationReschedule.js'), /resetConsultationMeeting\(db, \{ tenantId, consultationId: consultation\.id \}\)/);
  assert.match(read('api/routes/liveStreams.js'), /router\.put\('\/api\/admin\/meeting-integration', requireAuth, requireAdminOrStaff, requirePermission\('manage_settings'\)/);
  const migration = read('api/migrations/308_v26_meeting_integration.sql');
  for (const column of ['live_streams ADD COLUMN IF NOT EXISTS host_url', 'consultations ADD COLUMN IF NOT EXISTS host_link', 'meeting_id VARCHAR(191)']) assert.ok(migration.includes(column), column);
  assert.match(read('api/lib/tenantSettings.js'), /meeting_integration/, 'its keys are stored as a secret setting');
  assert.match(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'), /key: 'meetings'/);
});

test('a consultation\'s meeting is made once, only when confirmed and timed, and made again after it is moved', async () => {
  const consultations = require('../lib/consultationMeetings');
  const updates = [];
  const row = { id: 'c1', status: 'CONFIRMED', at: '2026-11-03T18:00:00', meeting_id: null, therapist_name: 'سارة', session_duration_minutes: 50, default_minutes: 60 };
  const db = {
    query: async (sql, params) => {
      if (/^\s*SELECT c\.id, c\.status/.test(sql)) return [[row]];
      if (/^\s*UPDATE consultations SET meeting_link=\?/.test(sql)) { updates.push(params); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
  meetings._tokenCache.clear();
  await meetings.saveIntegration('t4', { provider: 'zoom', zoom: { accountId: 'A', clientId: 'C', clientSecret: 'S' } });
  const sent = [];
  const fetchImpl = async (url, options = {}) => {
    sent.push({ url: String(url), body: options.body && JSON.parse(options.body) });
    if (String(url).startsWith('https://zoom.us/oauth/token')) return response(200, { access_token: 't', expires_in: 3600 });
    return response(201, { id: 55, join_url: 'https://zoom.us/j/55', start_url: 'https://zoom.us/s/55' });
  };
  const made = await consultations.ensureConsultationMeeting(db, { tenantId: 't4', consultationId: 'c1' }, { fetchImpl });
  assert.deepEqual(made, { meetingLink: 'https://zoom.us/j/55', hostLink: 'https://zoom.us/s/55' });
  assert.deepEqual(updates[0].slice(0, 4), ['https://zoom.us/j/55', 'https://zoom.us/s/55', '55', 'zoom']);
  const request = sent.find(call => call.body);
  assert.equal(request.body.timezone, 'Africa/Cairo');
  assert.equal(request.body.duration, 50, 'the session\'s own length');
  // Not confirmed, or no hour: nothing is made.
  row.status = 'PENDING';
  assert.equal(await consultations.ensureConsultationMeeting(db, { tenantId: 't4', consultationId: 'c1' }, { fetchImpl }), null);
  row.status = 'CONFIRMED'; row.at = '2026-11-03T00:00:00';
  assert.equal(await consultations.ensureConsultationMeeting(db, { tenantId: 't4', consultationId: 'c1' }, { fetchImpl }), null);
  // Already made: handed back, not made again.
  row.at = '2026-11-03T18:00:00'; row.meeting_id = '55'; row.meeting_link = 'https://zoom.us/j/55'; row.host_link = 'https://zoom.us/s/55';
  const before = sent.length;
  assert.deepEqual(await consultations.ensureConsultationMeeting(db, { tenantId: 't4', consultationId: 'c1' }, { fetchImpl }), { meetingLink: 'https://zoom.us/j/55', hostLink: 'https://zoom.us/s/55' });
  assert.equal(sent.length, before);
});
