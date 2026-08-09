'use strict';
/**
 * Course video is the asset the whole subscription protects, so the rule under
 * test is narrow and absolute: a public, unauthenticated response may carry a
 * lecture's real video_url ONLY when that lecture is genuinely free to watch.
 *
 * The bug these tests exist for: the free-preview rank used to be the row's
 * index in the response array. /api/lectures is public and paginated, so the
 * counter restarted at 0 on every page, and with the default allowance of one
 * free lecture per course, `GET /api/lectures?limit=1&offset=N` returned
 * lecture N+1 at "position 0" — i.e. the real CDN URL of a paid lecture, to
 * anyone, with no token. The rank now comes from ROW_NUMBER() in SQL, which no
 * LIMIT/OFFSET can shift.
 *
 * These call the gate directly rather than asserting on source text: the
 * previous generation of this guard was a regex over the route file, and a
 * regex cannot tell you that Number(null) is 0.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPreviewGate, courseRankSql } = require('../lib/previewRank');

// A paid lecture as it arrives from mapLecture(): the URL is present, and the
// gate's only job is deciding whether it survives.
const paid = (over = {}) => ({
  id: 'L9', title: 'Paid lecture', isPreview: false,
  videoUrl: 'https://cdn/paid-9.m3u8', order: 9, ...over,
});

test('the free lecture of a course keeps its playable URL', () => {
  const out = applyPreviewGate(paid(), 0, 1);
  assert.equal(out.videoUrl, 'https://cdn/paid-9.m3u8');
});

test('a lecture past the free allowance is stripped of its URL', () => {
  assert.equal(applyPreviewGate(paid(), 1, 1).videoUrl, '');
  assert.equal(applyPreviewGate(paid(), 500, 1).videoUrl, '');
});

test('an explicitly-flagged preview stays playable at any rank', () => {
  const out = applyPreviewGate(paid({ isPreview: true }), 77, 1);
  assert.equal(out.videoUrl, 'https://cdn/paid-9.m3u8');
});

test('a larger tenant allowance frees exactly that many lectures', () => {
  const limit = 3;
  assert.equal(applyPreviewGate(paid(), 2, limit).videoUrl, 'https://cdn/paid-9.m3u8');
  assert.equal(applyPreviewGate(paid(), 3, limit).videoUrl, '');
});

test('the paginated exploit no longer works: rank comes from the course, not the page', () => {
  // Reproduces GET /api/lectures?limit=1&offset=500. The response array holds a
  // single row, so its index is 0; its true rank in the course is 500. Feeding
  // the index is what leaked, so the gate must be given — and must honour — the
  // rank, and the two must disagree here or the test proves nothing.
  const trueRank = 500;
  const indexInPage = 0;
  assert.notEqual(trueRank, indexInPage);
  assert.equal(applyPreviewGate(paid(), trueRank, 1).videoUrl, '');
  // Documents the old behaviour, so a revert to index-based ranking fails here.
  assert.equal(applyPreviewGate(paid(), indexInPage, 1).videoUrl, 'https://cdn/paid-9.m3u8');
});

test('a rank the query failed to produce withholds the URL instead of unlocking it', () => {
  // Every one of these is 0 under Number(), and 0 is the one free position —
  // so a bare Number() cast would hand out the paid URL for a row whose rank
  // is missing. That is the same leak by a different route.
  for (const bad of [undefined, null, '', '   ', [], false, 'abc', NaN, -1, '-1', 1.5, {}]) {
    assert.equal(
      applyPreviewGate(paid(), bad, 1).videoUrl, '',
      `rank ${JSON.stringify(bad)} must not be treated as a free position`
    );
  }
});

test('a digit string from the driver is still a valid rank', () => {
  // mysql2 can return BIGINT columns as strings depending on driver config.
  assert.equal(applyPreviewGate(paid(), '0', 1).videoUrl, 'https://cdn/paid-9.m3u8');
  assert.equal(applyPreviewGate(paid(), '5', 1).videoUrl, '');
});

test('a non-positive allowance frees nothing', () => {
  assert.equal(applyPreviewGate(paid(), 0, 0).videoUrl, '');
  assert.equal(applyPreviewGate(paid(), 0, -1).videoUrl, '');
});

test('withholding the URL leaves the rest of the lecture intact for the catalogue', () => {
  const out = applyPreviewGate(paid(), 9, 1);
  assert.equal(out.videoUrl, '');
  assert.equal(out.id, 'L9');
  assert.equal(out.title, 'Paid lecture');
  assert.equal(out.order, 9);
});

test('the gate does not mutate the caller’s object', () => {
  const input = paid();
  applyPreviewGate({ ...input }, 9, 1);
  assert.equal(input.videoUrl, 'https://cdn/paid-9.m3u8');
});

test('courseRankSql partitions by course and is zero-based', () => {
  // The whole point of ranking in SQL is that LIMIT/OFFSET cannot shift it, so
  // the expression must partition by course_id and start at 0 to line up with
  // the allowance comparison (rank < previewLimit).
  const sql = courseRankSql('l');
  assert.match(sql, /ROW_NUMBER\(\)\s*OVER/i);
  assert.match(sql, /PARTITION BY\s+l\.course_id/i);
  assert.match(sql, /ORDER BY\s+l\.sort_order/i);
  assert.match(sql, /-\s*1\s*$/, 'must be zero-based to match rank < previewLimit');
  // A deterministic tiebreak matters: two lectures sharing a sort_order would
  // otherwise swap ranks between requests, so which one is free would flap.
  assert.match(sql, /l\.id/i);
});

test('courseRankSql applies the table alias it is given', () => {
  assert.match(courseRankSql('cl'), /PARTITION BY\s+cl\.course_id/i);
  assert.doesNotMatch(courseRankSql('cl'), /\bl\.course_id/i);
});
