'use strict';
// No destructive action may depend on a dialog the browser can switch off.
//
// window.confirm looks like a guard and is not one. Chrome offers "prevent this
// page from creating additional dialogs" after the second one, and from then on
// every confirm() returns false instantly — the click makes no request, shows
// no error and says nothing. That reached the desk as "لما بحاول امسح عميل مش
// بيقبل ابدا", and it was true of all 47 call sites, not just the delete that
// was reported: the same silence guarded refunds, offboarding, ticket
// escalation and every other confirm in the admin.
//
// Confirmed on production rather than assumed — the request was intercepted so
// nothing could be destroyed, confirm() was forced to false, and the delete
// button went silent; through confirmDialog it works with confirm() still
// broken.
//
// PromptModal had already made this argument when it replaced window.prompt.
// The reason it needed making twice is that nothing was watching.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', '..', 'admin');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.ts') || file.endsWith('.tsx'));
}

// Comments are blanked, not removed: the replacement's own explanation names
// the thing it replaced, and an assertion its own comment can trip is not an
// assertion about the code. That mistake was made twice already in this suite.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');

const scanned = () => ['pages', 'components']
  .flatMap(dir => walk(path.join(ADMIN, dir)))
  .filter(file => !file.endsWith('confirmDialog.tsx'));

test('the admin never calls window.confirm', () => {
  const offenders = [];
  for (const file of scanned()) {
    if (!/window\.confirm\s*\(/.test(codeOnly(fs.readFileSync(file, 'utf8')))) continue;
    offenders.push(path.relative(ADMIN, file).split(path.sep).join('/'));
  }
  assert.deepEqual(offenders, [],
    'these guard an action with a dialog the browser is allowed to answer "no" to, silently');
});

test('window.prompt and window.alert stay gone too', () => {
  // Same failure, same suppression switch. PromptModal replaced prompt; this
  // keeps it replaced.
  const offenders = [];
  for (const file of scanned()) {
    const code = codeOnly(fs.readFileSync(file, 'utf8'));
    for (const call of ['window.prompt', 'window.alert']) {
      if (code.includes(call + '(')) {
        offenders.push(`${path.relative(ADMIN, file).split(path.sep).join('/')}: ${call}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the scan is reading the admin, so an empty result means something', () => {
  // The lesson from the permission matrix, which reported a closed matrix twice
  // while its own subject count had fallen — once to 84%, once to zero.
  const files = scanned();
  assert.ok(files.length >= 250, `only ${files.length} admin source files scanned`);
  const withDialog = files.filter(file =>
    /confirmDialog\s*\(/.test(codeOnly(fs.readFileSync(file, 'utf8'))));
  assert.ok(withDialog.length >= 30,
    `only ${withDialog.length} files call confirmDialog — the conversion is not where it should be`);
});
