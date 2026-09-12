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
// Shrinking on purpose: as dialogs move to shared/ui/Modal they reach the hook
// through it and drop off this list. تعيين الموظف and نموذج تعيين الموظف left
// that way, and إضافة استرداد with them.
const WIRED = [
  'components/PaymentModal.tsx',
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

test('most dialogs reach the hook through the shared Modal, not directly', () => {
  // The hook was generic over the panel element because HireModal made its
  // <form> the panel. That dialog is on shared/ui/Modal now, and Modal always
  // wraps its children in a div, so the type parameter had no user left.
  assert.match(hook, /export function useModalKeyboard\(onClose: \(\) => void, active = true\)/);
  assert.match(hook, /useRef<HTMLDivElement \| null>\(null\)/);
  const sharedModal = fs.readFileSync(path.join(ROOT, 'shared', 'ui', 'Modal.tsx'), 'utf8');
  assert.match(sharedModal, /const panelRef = useModalKeyboard\(onClose, open\);/);
});

test('a dialog that returns early calls the hook before it does', () => {
  // PaymentModal returns the printed receipt instead of the form once a payment
  // is saved. A hook placed after that return runs on some renders and not
  // others, which React forbids — the active flag exists so it can be called
  // unconditionally.
  //
  // This was asserted against DaqqiPayModal, the Daqqi desk's own copy of the
  // payment screen. That copy is gone and the desk opens the shared one, so
  // this is where the keyboard handling moved to — and where every other
  // payment screen gains it, having had none.
  //
  // Comments are stripped first: the one explaining this rule quotes the early
  // return verbatim, and it sits above the hook call — matched against the raw
  // source, the comment is what indexOf finds, and the check inverts. The line
  // pattern is [^\n]* rather than .*$ because `.` does not match \r, so on a
  // CRLF file .*$ never matches and nothing is stripped at all.
  const source = read('components/PaymentModal.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const hookAt = source.indexOf('useModalKeyboard(onClose');
  const returnAt = source.indexOf('if (printData) {');
  assert.ok(hookAt > 0 && returnAt > 0, 'expected both the hook call and the early return');
  assert.ok(hookAt < returnAt, 'the hook must be called before the early return');
  assert.match(source, /useModalKeyboard\(onClose, !printData\)/);
});
