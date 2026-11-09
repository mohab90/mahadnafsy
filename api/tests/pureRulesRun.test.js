'use strict';
/**
 * Four rules that were regular expressions over the source, now run on the real modules:
 *   • the public certificate escapes every value a customer controls (lib/certificateHtml.js);
 *   • a course page tells a search engine it is a course, with no price, and nothing in it can close the script it sits in (lib/seoPages.js);
 *   • a lead status is classified once, in one module (lib/leadStatuses.js);
 *   • a date range starts at Cairo's day, counted on the calendar, not in milliseconds (shared/cairoDate.ts, admin/lib/rangeStart.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');
const { certificateHtml, certificateFormHtml, trainingLine } = require('../lib/certificateHtml');
const { courseJsonLd } = require('../lib/seoPages');
const statuses = require('../lib/leadStatuses');

const HOSTILE = '<img src=x onerror=alert(1)>"\'&';

test('the public certificate escapes every value a customer controls', () => {
  const html = certificateHtml({
    studentName: HOSTILE, courseName: HOSTILE, duration: HOSTILE, trainer: HOSTILE, serialNo: HOSTILE, issuedAt: HOSTILE,
    qrUrl: 'https://example.test/qr.png', verifyUrl: 'https://example.test/v?x="><script>alert(1)</script>', certCode: HOSTILE, year: HOSTILE,
  });
  assert.ok(!html.includes('<img src=x'), 'no raw tag from any field');
  assert.ok(!html.includes('<script'), 'nor from the link');
  assert.ok(!/onerror=alert\(1\)>/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'what is left of the payload is inert text');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;'), 'shown, as text');
  const form = certificateFormHtml({ studentName: HOSTILE, courseName: HOSTILE, duration: HOSTILE, certCode: HOSTILE, year: HOSTILE, nameTop: 10, courseTop: 12, hoursTop: 14, codeTop: 16 });
  assert.ok(!form.includes('<img src=x'), 'the desk\'s form copy too');
  assert.equal(trainingLine('40 hours', 2026), 'completed 40 training hours in 2026');
  assert.ok(!trainingLine(HOSTILE, 2026).includes('<img'), 'the free-text duration is escaped');
});

test('a course page says it is a course, with no price, and nothing in it can close the script it sits in', () => {
  const html = courseJsonLd({
    name: 'دبلومة </script><script>alert(1)</script>', description: 'وصف', url: 'https://example.test/courses/c1', image: 'https://example.test/c.png',
    site: 'https://example.test', hours: 40, instructor: 'د. منى', code: 'C1',
  });
  const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '');
  assert.ok(!body.includes('</script'), 'a title cannot end the script early');
  const data = JSON.parse(body.replace(/<\\\//g, '</'));
  assert.equal(data['@type'], 'Course');
  assert.equal(data.provider['@type'], 'EducationalOrganization');
  assert.equal(data.timeRequired, 'PT40H');
  assert.equal(data.hasCourseInstance.instructor.name, 'د. منى');
  assert.ok(!/price|offers/i.test(JSON.stringify(data)), 'no price: the site\'s price follows the visitor\'s country');
});

test('a lead status is classified once: terminal, converted and interested are views of one vocabulary', () => {
  const { isOpenLeadStatus, isConvertedLeadStatus, isInterestedLeadStatus, normalizeLeadStatus } = statuses;
  for (const closed of ['converted', 'lost', 'won', 'closed', 'not_interested', 'wrong_number', 'archived']) assert.equal(isOpenLeadStatus(closed), false, closed);
  for (const open of ['new', 'contacted', 'interested', 'interested_booking', 'interested_followup', 'no_answer_wa', 'postpone_month']) assert.equal(isOpenLeadStatus(open), true, `${open} is still work for someone`);
  assert.equal(isConvertedLeadStatus('won'), true);
  assert.equal(isConvertedLeadStatus('closed'), false, '«مغلق» ends a lead without a booking: it is not a sale');
  assert.equal(isInterestedLeadStatus(' Interested_Booking '), true, 'any shade, however it was typed');
  assert.equal(isInterestedLeadStatus('contacted'), false);
  assert.equal(normalizeLeadStatus(' NEW '), 'new');
  assert.throws(() => normalizeLeadStatus('mystery'), error => error.statusCode === 400);
  for (const status of statuses.TERMINAL_LEAD_STATUSES) assert.ok(statuses.LEAD_STATUSES.has(status), `${status} is a known status`);
  assert.ok(statuses.TERMINAL_LIST.every(status => /^[a-z_]+$/.test(status)), 'the SQL lists are bare words');
});

const cairo = bundle('shared/cairoDate.ts');
const range = bundle('admin/lib/rangeStart.ts');
test('a date range starts at Cairo\'s day, counted on the calendar', { skip: !cairo || !range ? 'esbuild is not installed' : false }, () => {
  const justAfterCairoMidnight = new Date('2027-01-15T22:30:00Z'); // 16 Jan 00:30 in Cairo
  assert.equal(cairo.cairoDateOnly(justAfterCairoMidnight), '2027-01-16', 'Cairo is already tomorrow while UTC is still today');
  assert.equal(cairo.cairoDaysAgo(7, justAfterCairoMidnight), '2027-01-09');
  assert.equal(cairo.cairoDaysAhead(3, justAfterCairoMidnight), '2027-01-19');
  assert.equal(cairo.cairoMonthOnly(new Date('2027-01-31T22:30:00Z')), '2027-02', 'the first of the month begins at Cairo midnight');
  assert.equal(cairo.cairoDaysAgo(30, new Date('2027-03-02T10:00:00Z')), '2027-01-31', 'across a short month');
  assert.equal(cairo.isExpiryActive('2027-01-15', new Date('2027-01-15T21:30:00Z')), true, 'an expiry runs through its Cairo day');
  assert.equal(cairo.isExpiryActive('2027-01-15', justAfterCairoMidnight), false);
  assert.equal(cairo.isExpiryActive('', justAfterCairoMidnight), true, 'blank is no expiry');
  assert.equal(cairo.CAIRO_TIME_ZONE, 'Africa/Cairo');
  // Across the daylight-saving change (the last Friday of April in Cairo): 7 days before 30 April is 23 April on the calendar.
  assert.equal(cairo.cairoDaysAgo(7, new Date('2027-04-30T10:00:00Z')), '2027-04-23');
  const today = cairo.cairoDateOnly();
  assert.equal(range.rangeStartDate('today'), today);
  assert.equal(range.rangeStartDate('7d'), range.rangeStartDate('week'));
  assert.equal(range.rangeStartDate('30d'), cairo.cairoDaysAgo(30));
  assert.equal(range.rangeStartDate('3months'), cairo.cairoDaysAgo(90));
  assert.equal(range.rangeStartDate('month'), `${cairo.cairoMonthOnly()}-01`);
  assert.equal(range.rangeStartDate('all'), '2000-01-01');
  assert.equal(range.rangeStartDate('whatever-a-screen-invents'), '2000-01-01');
});
