'use strict';

/**
 * 30 Oct 2026, the second pass over the CRM and the leads, measured on the lab at production scale (150,000 leads):
 *
 *   follow-up counts (bell, drawer, hub, reminders)   650 ms scanning every lead's crm_json -> 2 ms from the date index
 *   GET /api/admin/crm/work-queue                      1.5 s -> 30 ms (leads cut first, aggregates for those leads only; new index)
 *   GET /api/admin/leads/crm-insights                  1.8 s -> 0.9 s (the independent reads started together)
 *   GET /api/admin/leads/followups-panel               0.9 s -> 0.25 s
 *   GET /api/admin/leads/staff-performance             1.2 s -> 0.3 s
 *   GET /api/admin/leads/scored                        0.67 s -> 0.3 s
 *   sign-in                                            a full scan of the clients (1 s of database time) for the firebase_uid link
 *
 * and the places that took a certificate / book / carnet payment, which names the course, for the course's own money.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the follow-up helpers ask the DATETIME column for a day as a range, not through DATE_FORMAT and crm_json', () => {
  const { dueOn, dueBy, overdueBefore, FOLLOW_UP_DATE } = require('../lib/leadFollowUps');
  assert.deepEqual(dueOn('2026-10-30').params, ['2026-10-30', '2026-10-31']);
  assert.match(dueOn('2026-10-30').sql, /l\.next_follow_up_date >= \? AND l\.next_follow_up_date < \?/);
  // «Due by today» is everything before tomorrow's start; «overdue» everything before today's.
  assert.deepEqual(dueBy('2026-10-30').params, ['2026-10-31']);
  assert.deepEqual(overdueBefore('2026-10-30').params, ['2026-10-30']);
  for (const helper of [dueOn('2026-10-30'), dueBy('2026-10-30'), overdueBefore('2026-10-30')]) {
    assert.doesNotMatch(helper.sql, /DATE_FORMAT|JSON_/, 'a day compared through a function cannot use the date index');
    assert.match(helper.sql, /l\.hidden = 0/);
  }
  // The expression the screens still select and compare as text reads the column alone: no JSON parsed per lead.
  assert.doesNotMatch(FOLLOW_UP_DATE, /JSON_/);
});

test('the lead table\'s follow-up windows are ranges on the column', () => {
  const { leadTableFilter } = require('../lib/leadTableFilter');
  const run = followup => leadTableFilter({ followup }, { today: '2026-10-30', salesOnly: true });
  const tail = (filter, n) => filter.params.slice(-n);
  assert.deepEqual(tail(run('today'), 2), ['2026-10-30', '2026-10-31']);
  assert.deepEqual(tail(run('overdue'), 1), ['2026-10-30']);
  assert.deepEqual(tail(run('past7d'), 2), ['2026-10-23', '2026-10-30']);
  assert.deepEqual(tail(run('next3d'), 2), ['2026-10-31', '2026-11-03']);
  assert.match(run('no_followup').sql, /l\.next_follow_up_date IS NULL$/);
  for (const window of ['today', 'overdue', 'past3d', 'past7d', 'past30d', 'next3d', 'next7d']) {
    assert.doesNotMatch(run(window).sql, /DATE_FORMAT|JSON_EXTRACT.*nextFollowUpDate/, window);
  }
});

test('migration 349 copies a follow-up date kept only in crm_json into the column before the reads stop looking at the JSON', () => {
  const sql = read('api/migrations/349_v26_follow_up_date_in_the_column.sql');
  assert.match(sql, /UPDATE leads\s+SET next_follow_up_date = STR_TO_DATE\(LEFT\(JSON_UNQUOTE\(JSON_EXTRACT\(crm_json, '\$\.nextFollowUpDate'\)\), 10\), '%Y-%m-%d'\)/);
  assert.match(sql, /WHERE next_follow_up_date IS NULL/);
  assert.match(sql, /REGEXP '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}'/);
  assert.doesNotMatch(sql, /DELETE|DROP|TRUNCATE/i);
});

test('migration 348 gives the work queue its index in the order the query sorts', () => {
  const sql = read('api/migrations/348_v26_report_indexes.sql');
  assert.match(sql, /idx_leads_tenant_queue \(tenant_id, hidden, score DESC, created_at ASC\)/);
  assert.match(read('api/routes/crm-ops.js'), /ORDER BY l\.score DESC,l\.created_at ASC/);
});

test('the work queue cuts the leads first and reads the message counts and sequences for those leads only', () => {
  const route = read('api/routes/crm-ops.js');
  const handler = route.slice(route.indexOf("'/api/admin/crm/work-queue'"));
  assert.match(handler, /FROM communications WHERE tenant_id=\? AND lead_id IN \(\?\) GROUP BY lead_id/);
  assert.match(handler, /FROM drip_enrollments[\s\S]*?lead_id IN \(\?\)/);
  assert.doesNotMatch(handler, /FROM communications WHERE tenant_id=\? GROUP BY/, 'every communication of the tenant is aggregated again');
  assert.match(handler, /communication_count: commByLead\.get\(lead\.id\)\?\.communication_count \?\? null/);
});

test('the work queue gives buildWorkQueue the same fields as before for a lead with and without messages', async () => {
  const { buildWorkQueue } = require('../lib/crmWorkQueue');
  const now = new Date('2026-10-30T09:00:00Z');
  const lead = { id: 'a', status: 'interested', created_at: '2026-10-01', score: 80 };
  const quiet = buildWorkQueue([{ ...lead, communication_count: null, last_communication_at: null, active_sequence_id: null }], { now, limit: 5 });
  const talked = buildWorkQueue([{ ...lead, communication_count: 3, last_communication_at: '2026-10-29', active_sequence_id: 7 }], { now, limit: 5 });
  assert.equal(quiet.items.length, 1);
  // No message row at all (a lead the LEFT JOIN used to give NULLs) is a lead nobody has answered.
  assert.ok(quiet.items[0].reasons.some(reason => reason === 'first_response_sla_breached' || reason === 'new_uncontacted'));
  assert.ok(!talked.items[0].reasons.some(reason => reason === 'first_response_sla_breached' || reason === 'new_uncontacted'));
  assert.ok(talked.items[0].reasons.includes('sequence_active'));
});

test('CRM insights starts its independent reads together and ranges the reminders on the date column', () => {
  const route = read('api/routes/admin/leads/insights.js');
  const handler = route.slice(route.indexOf("'/api/admin/leads/crm-insights'"));
  assert.match(handler, /const \[\[\[dueRow\]\], \[weekCommRows\], \[followupRows\], \[newLeadRows\], \[overdueRows\], \[neverContacted\], \[loadRows\]\] = await Promise\.all\(/);
  assert.match(handler, /AND l\.next_follow_up_date < \?\s+ORDER BY \$\{FOLLOW_UP_DATE\} ASC/);
  assert.match(handler, /addDaysToDateOnly\(cairoToday\(\), 8\)/);
  // The scored list and the rep board do the same.
  const scored = route.slice(route.indexOf("'/api/admin/leads/scored'"), route.indexOf("'/api/admin/leads/crm-insights'"));
  assert.match(scored, /\[\[rows\], \[\[totalRow\]\], \[\[distRow\]\], \[facetRows\]\] = await Promise\.all\(/);
  const perf = route.slice(route.indexOf("'/api/admin/leads/staff-performance'"), route.indexOf("'/api/admin/leads/rep-revenue'"));
  assert.match(perf, /\[\[createdRows\], \[contactedRows\], \[dueRows\]\] = await Promise\.all\(/);
});

test('the counts the board, the table, the stale list and the duplicate finder answer are held for a few seconds and dropped by a write', () => {
  const lists = read('api/routes/admin/leads/lists.js');
  assert.match(lists, /cached\(`figures:leads-board-counts:\$\{req\.tenantId\}:\$\{where\}:\$\{JSON\.stringify\(whereParams\)\}`, FIGURES_TTL/);
  assert.match(lists, /cached\(`figures:leads-table-total:/);
  assert.match(read('api/routes/crm-ops.js'), /cached\(`figures:crm-stale-leads:\$\{req\.tenantId\}:\$\{sql\}:\$\{JSON\.stringify\(params\)\}`, 15 \* 1000/);
  assert.match(read('api/routes/admin/leads/dedup.js'), /cached\(`figures:lead-duplicates:\$\{req\.tenantId\}`, 30 \* 1000/);
  // «figures:» is what dropFiguresAfterWrites clears after every successful write.
  assert.match(read('api/lib/httpApp.js'), /cacheInvalidateLocal\('figures:'\)/);
});

test('the follow-up counters of the drawer and the hub compare the column, not a text built from it', () => {
  const stats = read('api/routes/admin/leads/stats.js');
  assert.match(stats, /SUM\(l\.next_follow_up_date < \?\) AS overdue, SUM\(l\.next_follow_up_date >= \?\) AS today/);
  assert.match(stats, /const onToday = 'l\.next_follow_up_date >= \? AND l\.next_follow_up_date < \?'/);
  assert.doesNotMatch(stats, /SUM\(\$\{FOLLOW_UP_DATE\} [<=]/);
  const hub = read('api/routes/admin/stafflists.js');
  assert.match(hub, /AND l\.next_follow_up_date >= \? AND l\.next_follow_up_date < \? LIMIT 30/);
});

test('signing in links the client record through the unique email index, not by scanning every client', () => {
  const session = read('api/routes/auth/session.js');
  assert.match(session, /UPDATE subscribers SET firebase_uid = \? WHERE tenant_id=\? AND email = \? AND firebase_uid IS NULL LIMIT 1/);
  assert.doesNotMatch(session, /UPDATE subscribers SET firebase_uid = \? WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)/);
  assert.match(session, /String\(user\.email\)\.trim\(\)\.toLowerCase\(\)/);
});

test('the places that sum what a client paid for a course leave the certificate, book, carnet and consultation payments out', () => {
  const { ITEM_PAYMENT_SQL } = require('../lib/agreedPrice');
  assert.equal(ITEM_PAYMENT_SQL, "COALESCE(p.payment_type, '') IN ('', 'COURSE', 'BUNDLE', 'OTHER')");
  for (const file of ['liveStreams', 'learningCohorts', 'reconcileChecks', 'daqqiAttendees', 'managementReport', 'lecturerPortal']) {
    const source = read(`api/lib/${file}.js`);
    assert.match(source, /require\('\.\/agreedPrice'\)/, `${file} does not load the rule`);
    assert.match(source, /\$\{ITEM_PAYMENT_SQL\}/, `${file} sums payments by course without the type rule`);
  }
  // Every course-money subquery of the Dokki roster, including the round's revenue.
  const roster = read('api/lib/daqqiAttendees.js');
  assert.ok((roster.match(/\$\{ITEM_PAYMENT_SQL\}/g) || []).length >= 6);
  // The management report's «most sold courses» counts course and track payments only.
  assert.match(read('api/lib/managementReport.js'), /\(p\.course_id IS NOT NULL OR p\.bundle_id IS NOT NULL\)\s+AND \$\{ITEM_PAYMENT_SQL\}/);
});

test('joining a live from the site counts only a client who holds one of the courses it is for', async () => {
  const { holdsALiveCourse } = require('../lib/liveStreams');
  const asked = [];
  const db = { query: async (sql, params) => { asked.push({ sql, params }); return [[{ ok: db.answer }]]; } };

  // A live open to everyone needs no lookup at all.
  db.answer = 0;
  assert.equal(await holdsALiveCourse(db, { tenantId: 'T', stream: { visibility: 'PUBLIC', target_course_ids_json: '["c1"]' }, subscriberId: 's' }), true);
  assert.equal(asked.length, 0);

  const stream = { visibility: 'COURSE_SUBSCRIBERS', target_course_ids_json: '["c1","c2"]' };
  assert.equal(await holdsALiveCourse(db, { tenantId: 'T', stream, subscriberId: 's9' }), false);
  db.answer = 1;
  assert.equal(await holdsALiveCourse(db, { tenantId: 'T', stream, subscriberId: 's9' }), true);
  const { sql, params } = asked[0];
  assert.match(sql, /FROM enrollments e WHERE e\.tenant_id=\? AND e\.subscriber_id=\? AND e\.status='active' AND e\.course_id IN \(\?,\?\)/);
  assert.equal((sql.match(/COALESCE\(p\.payment_type, ''\) IN/g) || []).length, 2, 'the paid arms read the course money only');
  assert.equal((sql.match(/\?/g) || []).length, params.length);
  assert.deepEqual(params.slice(0, 4), ['T', 's9', 'c1', 'c2']);

  const route = read('api/routes/liveStreams.js');
  const join = route.slice(route.indexOf("'/api/me/live-streams/:id/join'"), route.indexOf("'/api/staff/me/live-streams'"));
  assert.match(join, /await holdsALiveCourse\(pool, \{ tenantId: req\.tenantId, stream, subscriberId: sub\.id \}\)/);
  assert.match(join, /SELECT id, visibility, target_course_ids_json FROM live_streams/);
});

test('the clients without an account are found through the account email index, not by comparing every pair', () => {
  const source = read('api/routes/auth/staffAccounts.js');
  assert.equal((source.match(/AND u\.email=TRIM\(s\.email\)/g) || []).length, 2, 'the count and the bulk creation both use the indexed form');
  assert.doesNotMatch(source, /LOWER\(TRIM\(u\.email\)\)=LOWER\(TRIM\(s\.email\)\)/);
});
