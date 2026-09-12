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

const ROOT = path.join(__dirname, '..', '..');
const ADMIN = path.join(ROOT, 'admin');
const read = rel => fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
// The hook moved to shared/ui so the client's fourteen dialogs can reach it
// too; shared/ui/Modal is built on it.
const hook = fs.readFileSync(path.join(ROOT, 'shared', 'ui', 'useModalKeyboard.ts'), 'utf8');

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

test('إضافة ليد جديد opens the shared dialog', () => {
  // This was the proven pattern for the hook and the first dialog to get it.
  // It is on shared/ui/Modal now, which is where that pattern ended up.
  const modal = read('pages/dashboard/tabs/leads/AddLeadModal.tsx');
  assert.match(modal, /import \{ Modal \} from '[^']*shared\/ui\/Modal'/);
  assert.match(modal, /<Modal/);
  assert.doesNotMatch(modal, /useModalKeyboard/,
    'two Escape handlers on one dialog: Modal already calls the hook');
});

test('most dialogs reach the hook through the shared Modal, not directly', () => {
  // The hook was generic over the panel element because HireModal made its
  // <form> the panel. That dialog is on shared/ui/Modal now, and Modal always
  // wraps its children in a div, so the type parameter had no user left.
  assert.match(hook, /export function useModalKeyboard\(onClose: \(\) => void, active = true\)/);
  assert.match(hook, /useRef<HTMLDivElement \| null>\(null\)/);
  const sharedModal = fs.readFileSync(path.join(ROOT, 'shared', 'ui', 'Modal.tsx'), 'utf8');
  assert.match(sharedModal, /const panelRef = useModalKeyboard\(onClose, open\);/);
});

// The early-return rule — a hook after `if (!open) return null` runs on some
// renders and not others — now lives where the return does: shared/ui/Modal.
// api/tests/sharedModal.test.js asserts it there. Every dialog reaches the hook
// through Modal, so there is no caller left to check here.
