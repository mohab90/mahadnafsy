'use strict';
// Three community lists went to both apps as raw database rows.
//
// The posts beside them have always gone through mapPost. The library, videos
// and events did not, and both the customer page and the admin panel read
// camelCase — their TypeScript types declare it. So every field was undefined
// on both sides at once:
//
//   library — Community.tsx calls item.fileType.toLowerCase(). On undefined
//   that throws, and the ErrorBoundary wraps the whole layout, so opening
//   «المكتبة الرقمية» took down the entire page including the nav and printed
//   the raw English error underneath. downloadUrl was undefined too, so nothing
//   could be downloaded even before the throw.
//
//   videos — videoUrl decides playability: every video carried a «قريباً»
//   badge, «مشاهدة» never rendered, and clicking did nothing.
//
//   events — eventDate drives the calendar. The grid matched on it, the month
//   filter fell through to "show everything", the month arrows therefore did
//   nothing, and the reminder bell was disabled on every event with «لم يُحدد
//   تاريخ لهذه الفعالية بعد» — for events that all had dates.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const community = codeOnly(read('api/routes/community.js'));

function handlerFor(routePath) {
  const at = community.indexOf(`'${routePath}'`);
  assert.ok(at > 0, `${routePath} not found`);
  const rest = community.slice(at);
  const end = rest.indexOf('\n});');
  return rest.slice(0, end === -1 ? rest.length : end);
}

// Each pair is asserted whole. Checking only that a name appears passes against
// `fileType: r.fileType`, which is the same bug written the other way round.
const CASES = [
  ['/api/community/library', [
    ['downloadUrl', 'file_url'], ['fileType', 'file_type'], ['fileSize', 'file_size'],
  ]],
  ['/api/community/videos', [
    ['videoUrl', 'video_url'], ['viewsLabel', 'views_label'],
  ]],
  ['/api/community/events', [
    ['eventDate', 'event_date'], ['dateLabel', 'date_label'],
    ['eventType', 'event_type'], ['imageUrl', 'image_url'],
  ]],
];

for (const [route, pairs] of CASES) {
  test(`${route} sends the names both apps read`, () => {
    const handler = handlerFor(route);
    for (const [field, column] of pairs) {
      assert.match(handler, new RegExp(field + ': r\\.' + column + '\\b'),
        `${field} must be mapped from ${column}`);
    }
    assert.doesNotMatch(handler, /\.\.\.r,/, 'the raw row must not be spread through');
  });
}

test('fileType is never undefined, because the page calls a method on it', () => {
  // The crash was not the missing name alone — it was calling .toLowerCase() on
  // the result. An empty string keeps the page up even if a row has no type.
  assert.match(handlerFor('/api/community/library'), /fileType: r\.file_type \|\| ''/);
  assert.match(codeOnly(read('client/pages/Community.tsx')), /item\.fileType\.toLowerCase\(\)/,
    'if the page stops calling a method here, the fallback above can be revisited');
});

test('both apps declare the camelCase names, which is why this is the right shape', () => {
  // The mapping is only correct relative to what the readers ask for, so the
  // readers are the other half of the assertion — and there are two of them.
  for (const types of ['admin/types.ts', 'client/types.ts']) {
    const declared = read(types);
    for (const field of ['fileType', 'downloadUrl', 'videoUrl', 'viewsLabel', 'eventDate', 'dateLabel', 'eventType']) {
      assert.match(declared, new RegExp('\\b' + field + '\\??:'), `${types} must declare ${field}`);
    }
  }
});

test('the posts route was already mapped and stays that way', () => {
  // mapPost is why discussions worked while the three lists beside them did not.
  assert.match(community, /const mapPost = \(r\) =>/);
  assert.match(community, /authorName: r\.author/);
});
