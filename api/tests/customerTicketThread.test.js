'use strict';
/**
 * The customer's support thread. The server has always served GET
 * /api/me/tickets/:id and accepted POST /api/me/tickets/:id/reply, both
 * ownership-checked — and nothing in the client app ever called either. The
 * ticket card said "3 ردود من الإدارة" and did not open, so support was
 * answering into a page the customer could not read. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const support = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
const tab = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'components', 'student-dashboard', 'StudentSupportTab.tsx'), 'utf8');

// Comments quote the endpoints they describe, and a doesNotMatch run against the
// raw file would be answered by the prose instead of by the code.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the customer page reaches both halves of the thread the server exposes', () => {
  const code = codeOnly(tab);
  assert.match(code, /\/me\/tickets\/\$\{encodeURIComponent\(id\)\}/,
    'the ticket card must fetch the thread');
  assert.match(code, /\/me\/tickets\/\$\{encodeURIComponent\(thread\.id\)\}\/reply/,
    'and must be able to answer it');
  assert.match(code, /method: 'POST'/);
});

test('a reply the customer cannot see is not counted for them either', () => {
  const customerList = support.slice(support.indexOf("router.get('/api/me/tickets'"));
  const countLine = customerList.slice(0, customerList.indexOf('ORDER BY'));
  assert.match(countLine, /COUNT\(\*\) FROM ticket_replies[\s\S]*?tr\.is_internal=0/,
    'the customer count must exclude internal notes');

  const detail = support.slice(support.indexOf("router.get('/api/me/tickets/:id'"));
  const repliesQuery = detail.slice(0, detail.indexOf('res.json'));
  assert.match(repliesQuery, /FROM ticket_replies WHERE ticket_id=\? AND tenant_id=\? AND is_internal=0/,
    'and so must the thread the customer reads');
});

test('the admin lists still count every reply, internal ones included', () => {
  // Staff are the audience internal notes exist for — the filter belongs on the
  // customer's two reads and nowhere else.
  const adminScope = support.slice(0, support.indexOf("router.post('/api/me/tickets'"));
  const counts = adminScope.match(/COUNT\(\*\) FROM ticket_replies[^)]*\)/g) || [];
  assert.equal(counts.length, 2, 'two admin-side reply counts');
  for (const count of counts) assert.doesNotMatch(count, /is_internal/);
});

test('the reply echoed to the page matches the row that was inserted', () => {
  const replyRoute = support.slice(support.indexOf("router.post('/api/me/tickets/:id/reply'"));
  assert.ok(replyRoute.includes("[replyId, req.tenantId, req.params.id, 'CLIENT'"),
    'the insert writes CLIENT');
  assert.match(replyRoute, /reply: \{[^}]*author_type: 'CLIENT'/,
    'so the echo must say CLIENT too, not subscriber');
});

test('ownership is checked on both customer routes before anything is returned', () => {
  for (const route of ["router.get('/api/me/tickets/:id'", "router.post('/api/me/tickets/:id/reply'"]) {
    const body = support.slice(support.indexOf(route));
    const handler = body.slice(0, body.indexOf('\n});'));
    assert.match(handler, /ownsTicket\(t, subscriber, email\)/, `${route} must check ownership`);
    assert.ok(
      handler.indexOf('ownsTicket') < handler.indexOf('res.json'),
      'and must check it before answering');
  }
});
