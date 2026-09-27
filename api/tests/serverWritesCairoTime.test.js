'use strict';
// «شوف ليه الساعه لسه والتوقيت مش مصر».
//
// The API runs in UTC. noUtcDayInQueries keeps the database's clock out of the
// SQL; this keeps the Node process's clock out of everything else the server
// writes: "today" and "in three days" for reminders, a quote's validity, a
// report's default range and month, a payment's default date — and the dates
// and times printed into receipts, invoices, reports, certificates and the
// live-session email, which told students a 20:00 session started at 17:00.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
// A backup's filename, which its shell counterpart also dates in UTC.
const ALLOWED = new Set(['lib/dbBackup.js']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.js'));
}

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.replace(/\s\/\/.*$/, '')))
  .join('\n');

const sources = () => ['routes', 'lib']
  .flatMap(dir => walk(path.join(API, dir)))
  .map(file => ({ rel: path.relative(API, file).split(path.sep).join('/'), code: codeOnly(fs.readFileSync(file, 'utf8')) }))
  .filter(({ rel }) => !ALLOWED.has(rel));

test('no server code takes today, or N days from today, from the UTC clock', () => {
  const utcToday = /new Date\(\)\.toISOString\(\)\.(?:slice|substring)\(0,\s*(?:7|10)\)|new Date\(Date\.now\(\)[^)]*\)\.toISOString\(\)\.(?:slice|substring)\(0,\s*(?:7|10)\)/;
  const offenders = [];
  const files = sources();
  assert.ok(files.length > 150, `expected the routes and lib trees, saw ${files.length}`);
  for (const { rel, code } of files) {
    code.split('\n').forEach((line, i) => { if (utcToday.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(offenders, [], 'use cairoToday() / addDaysToDateOnly(cairoToday(), n) from lib/dates.js:\n' + offenders.join('\n'));
});

test('every date or time the server formats for a person names Cairo', () => {
  const offenders = [];
  for (const { rel, code } of sources()) {
    for (const match of code.matchAll(/\.toLocale(Date|Time)?String\(/g)) {
      const call = code.slice(match.index, match.index + 240);
      const aboutTime = match[1] || /dateStyle|timeStyle|year\s*:|month\s*:|day\s*:|hour\s*:|weekday\s*:/.test(call.split(';')[0]);
      if (aboutTime && !/timeZone/.test(call.split(';')[0])) {
        offenders.push(`${rel}: ${call.split('\n')[0].trim().slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "add timeZone: 'Africa/Cairo':\n" + offenders.join('\n'));
});
