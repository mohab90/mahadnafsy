'use strict';

// Sixty-five dialogs were written by hand — fifty-one in the admin, fourteen in
// the client — and they had drifted into twenty different spellings of the same
// backdrop: bg-black/40, /50, /60, with and without blur, at z-50, z-[60],
// z-[80] and z-[300]. Five of the fifty-one handled the Escape key. Fifteen had
// no visible close button.
//
// shared/ui/Modal is the one dialog for both apps. The migration is deliberate
// rather than a sweep — each dialog has its own header, footer and close
// behaviour to carry across, and a bad sweep across sixty-five money and CRM
// screens is worse than the inconsistency.
//
// So this is a ratchet: the count may fall, never rise. A new screen that hand-
// rolls its own overlay fails here, and so does a migration that regresses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Where the count stood when the ratchet was set. Lower it as dialogs move
 * across; never raise it. Raising it is the one edit this test exists to stop.
 */
const HAND_ROLLED_CEILING = 57;

function componentFiles() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) out.push(full);
    }
  };
  for (const app of ['admin', 'client']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('the count of hand-rolled dialogs only goes down', () => {
  const files = componentFiles();
  // Denominator: a walk that stopped matching would report a clean bill.
  assert.ok(files.length > 300, `expected both component trees, saw ${files.length}`);

  const handRolled = files.filter(rel => /className=.fixed inset-0[^"`]*bg-black\//.test(read(rel)));
  assert.ok(handRolled.length <= HAND_ROLLED_CEILING,
    `${handRolled.length} dialogs still build their own backdrop, up from ${HAND_ROLLED_CEILING}. `
    + 'Use shared/ui/Modal rather than raising the ceiling.');

  // And the shared one is actually in use, so the ceiling is not being met by
  // deleting dialogs instead of migrating them.
  const adopters = files.filter(rel => /from ['"][^'"]*shared\/ui\/Modal['"]/.test(read(rel)));
  assert.ok(adopters.length >= 5, `expected the migrated dialogs, saw ${adopters.length}`);
});

test('the shared dialog does what the hand-rolled ones mostly did not', () => {
  const modal = read('shared/ui/Modal.tsx');

  // Escape and focus, which five of fifty-one had. Called before the early
  // return and told whether it is live, because a hook after a return runs on
  // some renders and not others.
  assert.match(modal, /const panelRef = useModalKeyboard\(onClose, open\);/);
  assert.match(modal, /if \(!open\) return null;/);
  const hookAt = modal.indexOf('useModalKeyboard(onClose, open)');
  const returnAt = modal.indexOf('if (!open) return null;');
  assert.ok(hookAt > 0 && hookAt < returnAt, 'the hook must be called before the early return');

  // A click inside must not close it, and a click on the backdrop must —
  // checked on the event target, not by stopping propagation, so a control
  // inside that stops its own events cannot break closing.
  assert.match(modal, /if \(event\.target === event\.currentTarget\) onClose\(\);/);

  // Screen readers get a dialog, not a div.
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=\{title \? titleId : undefined\}/);
  assert.match(modal, /aria-label="إغلاق"/);

  // Two stacking levels, named. z-[300] existed because one screen needed to
  // sit above another dialog and invented a number for it.
  assert.match(modal, /layer === 'over' \? 'z-\[60\]' : 'z-50'/);
});

test('both apps can reach it, and the keyboard hook lives with it', () => {
  // It was admin/components/shared/useModalKeyboard — unreachable from the
  // client, which has fourteen dialogs of its own.
  assert.ok(fs.existsSync(path.join(ROOT, 'shared', 'ui', 'useModalKeyboard.ts')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'admin', 'components', 'shared', 'useModalKeyboard.ts')),
    'two copies of the hook is how the two apps drift apart again');
  assert.match(read('shared/ui/Modal.tsx'), /from '\.\/useModalKeyboard'/);
});
