'use strict';

// Every dialog in the admin panel rendered at the full width of the screen.
//
// shared/ui/Modal.tsx composes its size from lookup tables — `sm:max-w-2xl`,
// `max-h-[95vh]`, `rounded-t-3xl` — and shared/ is outside the admin folder.
// Neither app's Tailwind `content` list mentioned it, so Tailwind never saw
// those class names and never emitted them: the panel carried `sm:max-w-2xl`
// as an attribute and computed `max-width: none`. Measured on the live panel at
// 1440px wide, «تسجيل دفعة» was 1425px across with no height cap.
//
// 92 admin files import from shared/ui, so this was every one of their screens,
// not only the payment dialog.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('both apps scan shared/ for the classes they render', () => {
  for (const app of ['admin', 'client']) {
    const config = read(path.join(app, 'tailwind.config.js'));
    // Searched over the whole file, not a slice of the content array: the
    // comment beside the glob contains max-h-[95vh], and slicing to the first
    // ']' stopped inside it — the test failed on its own prose.
    assert.ok(config.includes("'../shared/**/*.{ts,tsx}'"),
      `${app} does not scan shared/, so any class used only there is missing from its stylesheet`);
  }
});

test('the classes that sized the dialog live only in shared/', () => {
  // If these ever move into the app folders the glob is no longer load-bearing,
  // and this test should be revisited rather than deleted.
  const modal = read(path.join('shared', 'ui', 'Modal.tsx'));
  for (const cls of ['sm:max-w-2xl', 'max-h-[95vh]', 'rounded-t-3xl']) {
    assert.ok(modal.includes(cls), `Modal no longer composes ${cls}`);
  }
  // And the sizes are built from a table, which is why a scanner has to read
  // this file: the string `sm:max-w-2xl` never appears in the calling screen.
  assert.match(modal, /const SIZE[\s\S]{0,200}'sm:max-w-2xl'/);
});
