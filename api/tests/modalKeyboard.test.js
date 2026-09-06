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

// ── Rolled out to the dialogs a desk opens all day ────────────────────────
// Money, hiring and CRM configuration. Each needs its own onClose and its own
// panel element, so they go one at a time rather than as a sweep across all
// sixty overlays.
const WIRED = [
  'pages/dashboard/tabs/financial/AddRefundModal.tsx',
  'pages/dashboard/tabs/financial/IncomeModal.tsx',
  'pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx',
  'pages/dashboard/tabs/hr-sections/StaffOnboardModal.tsx',
  'pages/dashboard/tabs/interviews-sections/HireModal.tsx',
  'pages/dashboard/tabs/CrmSettingsModal.tsx',
];

for (const file of WIRED) {
  test(`${file.split('/').pop()} imports the hook and attaches the panel`, () => {
    const source = read(file);
    assert.match(source, /import \{ useModalKeyboard \} from '[^']*useModalKeyboard'/);
    assert.match(source, /const panelRef = useModalKeyboard/);
    assert.match(source, /ref=\{panelRef\}/);
  });
}

test('the hook is generic, so a form panel can hold the ref too', () => {
  // HireModal's dialog is the form element itself; a ref pinned to
  // HTMLDivElement could not be attached to it without a cast.
  assert.match(hook, /export function useModalKeyboard<T extends HTMLElement = HTMLDivElement>/);
  assert.match(hook, /useRef<T \| null>\(null\)/);
  assert.match(read('pages/dashboard/tabs/interviews-sections/HireModal.tsx'), /useModalKeyboard<HTMLFormElement>\(onClose\)/);
});

test('a dialog that returns early calls the hook before it does', () => {
  // DaqqiPayModal opens with an early return when it has nothing to show. A
  // hook placed after that runs on some renders and not others, which React
  // forbids — the active flag exists so it can be called unconditionally.
  // Comments are stripped first: the one explaining this rule quotes the early
  // return verbatim, and it sits above the hook call — matched against the raw
  // source, the comment is what indexOf finds, and the check inverts.
  const source = read('pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hookAt = source.indexOf('useModalKeyboard(onClose');
  const returnAt = source.indexOf('return null');
  assert.ok(hookAt > 0 && returnAt > 0, 'expected both the hook call and the early return');
  assert.ok(hookAt < returnAt, 'the hook must be called before the early return');
  assert.match(source, /useModalKeyboard\(onClose, !!modal\)/);
});
