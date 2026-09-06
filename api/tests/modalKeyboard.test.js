'use strict';
// Sixty components in the admin render a full-screen overlay; four handled the
// Escape key, and three of those are the shared dialogs. Everywhere else a
// keyboard user opening a modal kept focus on <body> behind it — reaching the
// first field meant tabbing through the whole page underneath, and leaving
// meant finding the mouse. Confirmed on the live admin with a real key press,
// not a synthetic event, because a synthetic one can miss the real handler.
//
// Verified after deploying: focus lands on «اسم العميل» and Escape closes.
//
// Applied to AddLeadModal as the proven pattern. The other overlays still need
// it, and each needs its own onClose and panel ref, so they are a deliberate
// follow-up rather than a blind sweep across fifty-six files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', '..', 'admin');
const read = rel => fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
const hook = read('components/shared/useModalKeyboard.ts');

test('the shared hook closes on Escape and moves focus into the panel', () => {
  assert.match(hook, /event\.key !== 'Escape'/);
  assert.match(hook, /document\.addEventListener\('keydown', onKey\)/);
  assert.match(hook, /document\.removeEventListener\('keydown', onKey\)/);
  assert.match(hook, /focus\(\{ preventScroll: true \}\)/);
});

test('it prefers a form field over the close button', () => {
  const body = hook.slice(hook.indexOf('const field'));
  assert.match(body, /const field = panel\.querySelector/);
  assert.match(body, /const fallback = panel\.querySelector/);
  assert.match(body, /\(field \|\| fallback\)\?\.focus/);
});

test('AddLeadModal uses it and gives it the panel', () => {
  const modal = read('pages/dashboard/tabs/leads/AddLeadModal.tsx');
  assert.match(modal, /import \{ useModalKeyboard \}/);
  assert.match(modal, /const panelRef = useModalKeyboard\(onClose\)/);
  assert.match(modal, /<div ref=\{panelRef\}/);
});
