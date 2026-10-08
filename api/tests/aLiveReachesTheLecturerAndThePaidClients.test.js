'use strict';

// «حساب لمحاضر … يقدر يفتح اللايف ,, ولما نضيف محاضرة لايف علي السيستم مع دكتور
// لازم يروحله اشعار ويروح لكل العملاء اللى مشتركه في نفس الكورس … بس شرط ان العملاء
// دول خلصوا فلوسهم او 90 % وشرط انهم محضروش اللايف قبل كدا» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-live-secret-0123456789-abcdefghijklmnopqrst';

const outboxed = [];
const notified = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { outboxed.push(message); } });
stub('../lib/notification', { insertNotification: async (_db, type, title, message, data, tenantId, staffId) => { notified.push({ type, staffId, message }); } });
// Paid 90%: s-paid and s-came-before; s-owes has not.
stub('../lib/coursePaid', { hasPaidForCourse: async (_db, { subscriberId }) => subscriberId !== 's-owes', PAID_SHARE: 0.9 });

const { announceLiveStream, joinLink, validJoin } = require('../lib/liveStreams');

const stream = {
  id: 'ls-1', title: 'لايف العلاج المعرفي', instructor_id: 'st-dr', instructor_name: 'د. منى',
  scheduled_at: new Date(Date.now() + 3 * 86400000), stream_url: 'https://zoom.us/j/1',
  visibility: 'COURSE_SUBSCRIBERS', target_course_ids_json: JSON.stringify(['c-1']),
};
const db = {
  query: async sql => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT \* FROM live_streams/.test(flat)) return [[stream]];
    if (/SELECT id, name, phone FROM staff/.test(flat)) return [[{ id: 'st-dr', name: 'منى سامي', phone: '01000000001' }]];
    if (/SELECT DISTINCT s\.id, s\.name, s\.phone, s\.email, x\.course_id/.test(flat)) {
      return [[
        { id: 's-paid', name: 'ياسمين', phone: '01011111111', course_id: 'c-1' },
        { id: 's-owes', name: 'نهى', phone: '01022222222', course_id: 'c-1' },
        { id: 's-came-before', name: 'محمد', phone: '01033333333', course_id: 'c-1' },
      ]];
    }
    if (/FROM live_stream_attendance a JOIN live_streams ls/.test(flat)) return [[{ subscriber_id: 's-came-before', target_course_ids_json: JSON.stringify(['c-1']) }]];
    return [{ affectedRows: 1 }];
  },
};

test('the lecturer is told in the system and on WhatsApp; only the paid clients who did not come before get it', async () => {
  const result = await announceLiveStream(db, { tenantId: 't', streamId: 'ls-1' });
  assert.equal(result.instructorTold, true);
  assert.deepEqual([result.clients, result.unpaid, result.attended], [1, 1, 1]);
  assert.equal(notified[0].staffId, 'st-dr');
  const recipients = outboxed.filter(m => !m.sendAt).map(m => m.recipient);
  assert.deepEqual(recipients, ['01000000001', '01011111111']);
  const invitation = outboxed.find(m => m.recipient === '01011111111' && !m.sendAt);
  assert.match(invitation.payload.message, /مع د\. منى/);
  assert.ok(invitation.payload.message.includes(joinLink('ls-1', 's-paid')), 'her own link');
  assert.ok(outboxed.some(m => m.recipient === '01011111111' && m.sendAt), 'and a reminder two hours before');
  assert.ok(outboxed.every(m => m.dedupeKey), 'announcing again reaches only who was not told');
});

test('the personal link proves who joined, and nobody else\'s', () => {
  const link = new URL(joinLink('ls-1', 's-paid'));
  assert.equal(validJoin('ls-1', 's-paid', link.searchParams.get('t')), true);
  assert.equal(validJoin('ls-1', 's-owes', link.searchParams.get('t')), false);
});

test('the lecturer\'s account holds the live and opens it; the site counts who joined', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  const save = read('api/routes/core/catalog.js');
  assert.match(save, /INSERT INTO live_streams \(id, tenant_id, title, instructor_id, instructor_name/);
  assert.match(save, /if \(status === 'UPCOMING' && \(!before \|\| !before\.announced_at \|\| moved\)\)/);
  const routes = read('api/routes/liveStreams.js');
  assert.match(routes, /if \(!manager && String\(stream\.instructor_id \|\| ''\) !== String\(req\.staffRecord\?\.id \|\| ''\)\) return res\.status\(403\)/);
  assert.match(routes, /router\.get\('\/api\/live\/:id\/join', publicLimiter/);
  assert.match(read('admin/pages/TherapistPortal.tsx'), /<InstructorLivePanel \/>/);
  assert.match(read('client/components/student-dashboard/StudentLiveStreamsTab.tsx'), /mysqlClient\.joinLiveStream\(live\.id\)/);
});
