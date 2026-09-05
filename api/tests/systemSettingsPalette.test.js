'use strict';
// Every settings section must name a colour the palette defines.
//
// The backups section was declared `color: 'slate'` and the palette had no
// slate, so COLOR['slate'] was undefined and `COLOR[sec.color].bg` threw as
// soon as «النسخ الاحتياطية» was clicked. The tab that reports whether the
// database is being backed up crashed the settings screen.
//
// Nothing caught it. COLOR is typed Record<string, {...}>, so TypeScript treats
// every string index as present and the compiler is silent; the screen renders
// fine until that one tab is clicked, so a render check passes; and the section
// is one of sixteen, so it was never the one anybody happened to open.
//
// Found by clicking every distinct control in every screen with writes
// intercepted, which is the only thing that would have found it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(
  path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'systemSettingsSchema.tsx'),
  'utf8');

const palette = new Set(
  [...schema.matchAll(/^\s{2}([a-z]+):\s*\{ bg:/gm)].map(m => m[1]));

const sections = [...schema.matchAll(/key:\s*'([a-z_]+)'[^}]*color:\s*'([a-z]+)'/g)]
  .map(m => ({ section: m[1], color: m[2] }));

test('the palette and the section list are both being read', () => {
  // Without this, a regex that stops matching turns every assertion below into
  // a pass over an empty list.
  assert.ok(palette.size >= 10, `only ${palette.size} colours parsed from the palette`);
  assert.ok(sections.length >= 12, `only ${sections.length} sections parsed`);
  assert.ok(palette.has('indigo'), 'the palette parse is not finding known colours');
  assert.ok(sections.some(s => s.section === 'backups'), 'the section parse is not finding known sections');
});

test('every section names a colour the palette defines', () => {
  const missing = sections.filter(s => !palette.has(s.color));
  assert.deepEqual(missing, [],
    'these sections index COLOR with a key it does not have, which throws on click');
});
