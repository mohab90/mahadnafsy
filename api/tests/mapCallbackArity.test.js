'use strict';

// Array.prototype.map passes (element, index, array). A function whose second
// parameter means something therefore receives the *index* when it is handed to
// map directly — and an index is a number, which is truthy for every element
// but the first.
//
// It was live on GET /api/courses: mapCourse's second parameter is the course's
// materials, attached only when a caller loaded them, so production answered
// "materials":1, "materials":2, "materials":3 … a number to screens that call
// .forEach and .map on it. The same trap then hid a privacy fix: mapTherapist
// gained an includeMeetingLinks flag, and `therapists.map(mapTherapist)` handed
// it the index, putting the join links back on the public feed for every
// therapist after the first.
//
// Nothing about it fails loudly, and a unit test that calls the mapper directly
// passes throughout — so it is pinned here at the call sites instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mappers = require('../lib/mappers');

const ROUTES = path.join(__dirname, '..', 'routes');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

/**
 * Exported mappers that declare a second parameter.
 *
 * Read from the source, not from Function.length — which counts only the
 * parameters before the first default, and so reports 1 for
 * `mapTherapist(r, includeMeetingLinks = false)`. A defaulted second parameter
 * is precisely the dangerous shape: it accepts the index silently instead of
 * being missing.
 */
const MAPPERS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mappers.js'), 'utf8');
const MULTI_ARG = Object.keys(mappers).filter(name => {
  if (typeof mappers[name] !== 'function') return false;
  const decl = new RegExp(`function ${name}\\(([^)]*)\\)`).exec(MAPPERS_SOURCE);
  return Boolean(decl) && decl[1].includes(',');
});

test('the mappers this guards are the ones that actually take a second argument', () => {
  // Denominator: if a refactor makes them all single-argument, this test would
  // silently guard nothing.
  assert.ok(MULTI_ARG.length >= 3, `expected several multi-argument mappers, found ${MULTI_ARG.join(', ') || 'none'}`);
  assert.ok(MULTI_ARG.includes('mapCourse'), 'mapCourse should still take its materials');
  assert.ok(MULTI_ARG.includes('mapTherapist'), 'mapTherapist should still take its meeting-link flag');
});

test('no route hands a multi-argument mapper straight to map or forEach', () => {
  const offenders = [];
  let scanned = 0;
  for (const file of walk(ROUTES)) {
    const source = fs.readFileSync(file, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/');
    scanned += 1;
    for (const name of MULTI_ARG) {
      const bare = new RegExp(`\\.(?:map|forEach|flatMap)\\(\\s*${name}\\s*\\)`, 'g');
      let match;
      while ((match = bare.exec(source))) {
        offenders.push(`api/${rel}:${source.slice(0, match.index).split('\n').length}  ${name}`);
      }
    }
  }
  assert.ok(scanned > 20, `expected to walk the route tree, saw ${scanned} files`);
  assert.deepEqual(offenders, [],
    'these receive the array index as their second argument — wrap them in an arrow');
});

test('mapCourse only attaches materials when a caller actually passes them', () => {
  const row = { id: 'c1', title: 'كورس', is_published: 1 };
  assert.ok(!('materials' in mappers.mapCourse(row)), 'a course with no materials loaded should not claim any');
  assert.deepEqual(mappers.mapCourse(row, [{ id: 'm1' }]).materials, [{ id: 'm1' }]);
  // The shape the bug produced, spelled out: an index in the materials slot.
  assert.equal(mappers.mapCourse(row, 2).materials, 2);
});
