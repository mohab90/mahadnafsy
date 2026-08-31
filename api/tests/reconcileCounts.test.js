'use strict';
// A count that is really a page size.
//
// Every reconciliation check ends `ORDER BY … LIMIT 100` and `count` was
// rows.length, so any check with more than a hundred hits reported exactly a
// hundred and a reader could not tell a hundred from a thousand. That is not a
// cosmetic problem: converted_without_subscriber reported 44 when the true
// figure was 248, and the smaller number was worked on as though it were the
// whole problem.
//
// The fix strips the trailing ORDER BY … LIMIT to turn the sample query into a
// population query, which only works while every check keeps ending that way.
// These tests hold both halves: the tail is strippable on every check, and the
// stripping produces something that is still one statement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'core', 'payops.js'), 'utf8');

// The same expression the route uses. Kept identical on purpose — a test that
// strips differently from the code proves nothing about the code.
const STRIP = /\s+ORDER BY[\s\S]*?LIMIT\s+\d+\s*$/i;

/** The SQL of every check in the reconciliation dashboard. */
function checkStatements() {
  const dashboard = source.slice(source.indexOf("const checks = ["));
  return [...dashboard.matchAll(/key: '([a-z_]+)', severity: '(critical|warning)',[\s\S]*?sql: `([\s\S]*?)`/g)]
    .map(match => ({ key: match[1], severity: match[2], sql: match[3] }));
}

test('the dashboard reports a real count, not the page size', () => {
  assert.match(source, /count,\s*countExact/, 'the reply must carry the count it computed');
  assert.match(source, /SELECT COUNT\(\*\) AS n FROM \(\$\{population\}\)/,
    'the population query is what makes the count real');
  assert.match(source, /rows\.length >= SAMPLE_LIMIT/,
    'the extra query should only run when the sample came back full');
  // criticalCount must add the true counts, or the headline stays capped even
  // once each row is honest.
  assert.match(source, /criticalCount[\s\S]{0,200}sum \+ result\.count/);
});

test('every check still ends in a strippable ORDER BY … LIMIT', () => {
  const checks = checkStatements();
  assert.ok(checks.length >= 14, `only ${checks.length} checks parsed — the scan lost sight of them`);

  const unstrippable = checks.filter(check => !STRIP.test(check.sql)).map(check => check.key);
  assert.deepEqual(unstrippable, [],
    'these checks cannot be turned into a population query, so their count silently stays capped');
});

test('stripping the tail leaves one statement, not a fragment', () => {
  for (const check of checkStatements()) {
    const population = check.sql.replace(STRIP, '');
    assert.notEqual(population, check.sql, `${check.key}: nothing was stripped`);
    assert.doesNotMatch(population, /\bLIMIT\s+\d+\s*$/i,
      `${check.key}: a LIMIT survived, so COUNT would count the capped set`);
    // Balanced parentheses — the population is wrapped in `SELECT … FROM ( … )`,
    // and an unbalanced strip would produce a syntax error at runtime rather
    // than here.
    const opens = (population.match(/\(/g) || []).length;
    const closes = (population.match(/\)/g) || []).length;
    assert.equal(opens, closes, `${check.key}: unbalanced parentheses after stripping`);
    assert.match(population, /^\s*SELECT\b/i, `${check.key}: does not start as a SELECT`);
  }
});
