'use strict';

// The customer-service suggestions the owner chose (8 Oct 2026): «أي تقييم أقل من
// 5 يفتح تيكت لخدمة العملاء لوحده · العميل يقيّم بنفسه بلينك واتساب بعد المحاضرة
// التالتة والأخيرة · ردود جاهزة لأشهر 10 مشاكل · مؤشر عميل في خطر: تقييم واطي،
// وغاب محاضرتين، وعليه فلوس».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-cs-secret-0123456789-abcdefghijklmnopqrstuv';

test('a rating under 5 opens a ticket for customer service by itself; a good one does not', async () => {
  const tickets = [];
  const supportFile = require.resolve('../routes/support');
  require.cache[supportFile] = { id: supportFile, filename: supportFile, loaded: true, exports: { createRoutedTicket: async (_db, args) => { tickets.push(args); return { id: 'tk-1' }; } } };
  const historyFile = require.resolve('../lib/clientHistory');
  const history = [];
  require.cache[historyFile] = { id: historyFile, filename: historyFile, loaded: true, exports: { logClientEvent: async (_db, args) => { history.push(args); }, actorName: () => 'x' } };
  const { saveRating } = require('../lib/clientRatings');
  const db = { query: async sql => (/FROM subscribers/.test(sql) ? [[{ name: 'نهى', email: null }]] : [{ affectedRows: 1 }]) };
  const round = { id: 'r-1', code: '3018', branch: 'DAQQI', course_id: 'c-1', instructor_name: 'د. منى' };
  const low = await saveRating(db, { tenantId: 't', round, subscriberId: 's-1', scores: [3, 4, 2, 6], note: 'مش فاهمة', by: { name: 'العميل' } });
  assert.equal(low.average, 3.8);
  assert.equal(low.ticketId, 'tk-1');
  assert.equal(tickets[0].category, 'client_problem');
  assert.match(tickets[0].subject, /تقييم واطي 3\.8\/10 — روند 3018/);
  assert.match(tickets[0].body, /المحاضر: 3\/10 · المادة العلمية: 4\/10/);
  assert.match(history[0].label, /اتفتح تيكت لخدمة العملاء من تقييم واطي/);
  const good = await saveRating(db, { tenantId: 't', round, subscriberId: 's-2', scores: [9, 8, 9, 10], by: { name: 'هنا' } });
  assert.equal(good.ticketId, null);
  assert.equal(tickets.length, 1);
});

test('the client rates by their own link at the third lecture and when the round finishes', () => {
  const { ratingLink, validRating } = require('../lib/selfRating');
  const link = new URL(ratingLink('r-1', 's-1'));
  assert.equal(link.pathname, '/rate/r-1');
  assert.equal(validRating('r-1', 's-1', link.searchParams.get('t')), true);
  assert.equal(validRating('r-1', 's-2', link.searchParams.get('t')), false, 'nobody rates in another\'s name');
  const rounds = read('api/routes/daqqi-rounds.js');
  assert.match(rounds, /if \(attendedLectures === 3\) \{\s*await inviteToRate\(conn, \{[^}]*stage: 'third' \}\);/);
  assert.match(rounds, /existing\.status !== 'FINISHED' && status === 'FINISHED'\) \{[\s\S]{0,300}stage: 'final' \}\);/);
  const routes = read('api/routes/clientRatings.js');
  assert.match(routes, /router\.post\('\/api\/public\/rate\/:roundId', publicLimiter/);
  assert.match(routes, /by: \{ id: null, name: 'العميل' \}/);
  assert.match(read('client/App.tsx'), /<Route path="\/rate\/:roundId"/);
});

test('ready replies for the ten commonest problems, added once', () => {
  const sql = read('api/migrations/262_v26_canned_replies_top_problems.sql');
  assert.equal((sql.match(/SELECT '|UNION ALL SELECT '/g) || []).length, 10);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM support_canned_responses c WHERE c\.tenant_id = t\.id AND c\.title = x\.title\)/);
});

test('«في خطر» is two of: a rating under 5, two lectures missed, money owed', () => {
  const { riskOf } = require('../lib/clientsAtRisk');
  assert.equal(riskOf({ latestRating: 4, sessions: 5, attended: 5, owed: 0 }).atRisk, false, 'one alone is not');
  assert.deepEqual(riskOf({ latestRating: 4, sessions: 5, attended: 3, owed: 0 }).reasons, ['تقييمه 4/10', 'غاب 2 محاضرات']);
  assert.equal(riskOf({ latestRating: null, sessions: 6, attended: 2, owed: 1500 }).atRisk, true);
  assert.equal(riskOf({ latestRating: 9, sessions: 3, attended: 2, owed: 1500 }).atRisk, false);
  // A round whose attendance is not taken calls nobody absent.
  assert.equal(riskOf({ latestRating: null, sessions: 0, attended: 0, owed: 1500 }).atRisk, false);
  assert.match(read('admin/lib/clientsAtRisk.ts'), /return \{ atRisk: reasons\.length >= 2, reasons \};/, 'the round row uses the same rule');
  assert.match(read('admin/pages/dashboard/tabs/RatingsTab.tsx'), /<ClientsAtRiskPanel \/>/);
});
