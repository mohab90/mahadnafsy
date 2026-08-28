'use strict';

// fetchCsvFollowRedirects accumulated the response with `d += chunk`, which runs
// toString() on each chunk separately. An Arabic letter is two bytes in UTF-8,
// so a letter split across a chunk boundary lost both halves to U+FFFD and the
// name arrived as "دبلو��ة_المعالج". The damage landed at a different position
// every run, because the boundary falls wherever the socket happened to split —
// which is exactly the shape found in the imported leads, and why those rows
// then matched no course.
//
// This pins the decoding rule itself: collect the bytes, decode once.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SAMPLE = 'دبلومة_المعالج_النفسي_المحترف';
const REPLACEMENT = '�';

/** What the old code did: decode every chunk on its own. */
function decodePerChunk(buffer, cutAt) {
  let out = '';
  out += buffer.subarray(0, cutAt);
  out += buffer.subarray(cutAt);
  return out;
}

/** What the code does now: collect, then decode once. */
function decodeOnce(buffer, cutAt) {
  return Buffer.concat([buffer.subarray(0, cutAt), buffer.subarray(cutAt)]).toString('utf8');
}

test('decoding each chunk separately corrupts Arabic split across a boundary', () => {
  const buffer = Buffer.from(SAMPLE, 'utf8');
  let damaged = 0;
  for (let cut = 1; cut < buffer.length; cut++) {
    if (decodePerChunk(buffer, cut).includes(REPLACEMENT)) damaged++;
  }
  // Every two-byte letter has an interior boundary that breaks it, so this was
  // not a rare race: about half of all split points damage the text.
  assert.ok(damaged > buffer.length / 4,
    `expected many damaging split points, got ${damaged} of ${buffer.length - 1}`);
});

test('collecting the bytes first survives every split point', () => {
  const buffer = Buffer.from(SAMPLE, 'utf8');
  for (let cut = 1; cut < buffer.length; cut++) {
    assert.strictEqual(decodeOnce(buffer, cut), SAMPLE,
      `a split at byte ${cut} should still decode to the original`);
  }
});

test('the fetch helper collects buffers rather than concatenating strings', () => {
  // A source check, so the bug cannot return the next time someone edits this.
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheets.js'), 'utf8');
  const helper = source.slice(source.indexOf('function fetchCsvFollowRedirects'));
  // Comments are stripped first: the explanation above the fix quotes the old
  // line, and scanning raw text would flag the description of the bug as the bug.
  const body = helper
    .slice(0, helper.indexOf('async function'))
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  assert.ok(body.includes('Buffer.concat'),
    'fetchCsvFollowRedirects should decode once from concatenated buffers');
  assert.ok(!/[A-Za-z_$][\w$]*\s*\+=\s*c\b/.test(body),
    'fetchCsvFollowRedirects must not append a raw chunk onto a string');
});

test('a multi-byte row round-trips through the collected-bytes path', () => {
  // Three chunks arriving separately, as the socket delivers them.
  const buffer = Buffer.from(`الفرع: اون_لاين_داخل_مصر | الكورس: ${SAMPLE}`, 'utf8');
  const chunks = [buffer.subarray(0, 17), buffer.subarray(17, 40), buffer.subarray(40)];
  const decoded = Buffer.concat(chunks).toString('utf8');
  assert.ok(!decoded.includes(REPLACEMENT), 'no replacement characters');
  assert.ok(decoded.endsWith(SAMPLE), 'the course name survives intact');
});
