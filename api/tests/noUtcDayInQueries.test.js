'use strict';
// The server, MariaDB and the Node process all run in UTC, and the institute
// runs on Cairo time — two hours ahead in winter, three in summer. So the
// database's own idea of "today" and "now" is the wrong day for a few hours
// every night, and the wrong hour all day:
//
//   CURDATE() / CURRENT_DATE  begin Cairo's day at 02:00 or 03:00, so a lead
//                             distributed, a sale made or a message sent after
//                             midnight counted towards yesterday, and every
//                             daily cap reset in the small hours.
//   HOUR(NOW())               recorded a 09:00 check-in as 06:00, which is
//                             before any shift starts — so nobody who arrived
//                             before noon was ever late.
//
// Sixty-odd queries were moved to lib/dates.js (sqlCairoToday,
// sqlCairoDayStartUtc, cairoClock). This keeps new ones from reaching for the
// database's clock again. Comments are blanked first: the explanations beside
// the fixes name the functions they replaced, and an assertion tripped by its
// own comment is not an assertion about the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');

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

const FORBIDDEN = [
  [/CURDATE\(\)/, 'CURDATE() is the UTC date — use sqlCairoToday() or sqlCairoDayStartUtc()'],
  [/\bCURRENT_DATE\b/, 'CURRENT_DATE is the UTC date — use sqlCairoToday()'],
  [/DATE\(NOW\(\)\)/, 'DATE(NOW()) is the UTC date — use sqlCairoToday()'],
  [/HOUR\(NOW\(\)\)|MINUTE\(NOW\(\)\)/, "NOW()'s hour is UTC — use cairoClock()"],
];

const files = () => ['routes', 'lib'].flatMap(dir => walk(path.join(API, dir)));

test('no query asks the database what day or hour it is', () => {
  const offenders = [];
  for (const file of files()) {
    const code = codeOnly(fs.readFileSync(file, 'utf8'));
    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(code)) offenders.push(`${path.relative(API, file)}: ${reason}`);
    }
  }
  assert.deepEqual(offenders, [], 'these read the UTC clock where Cairo is meant');
});

test('the scan is actually reading the API, so an empty result means something', () => {
  const scanned = files();
  assert.ok(scanned.length >= 200, `only ${scanned.length} files scanned`);
  const usesCairo = scanned.filter(file =>
    /sqlCairoToday\(\)|sqlCairoDayStartUtc\(\)|cairoClock\(\)/.test(fs.readFileSync(file, 'utf8')));
  assert.ok(usesCairo.length >= 20,
    `only ${usesCairo.length} files use the Cairo clock — the conversion is not where it should be`);
});
