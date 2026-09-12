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
const HAND_ROLLED_CEILING = 22;

/** Dialogs still on a stacking level they invented. Same rule: down, never up. */
const OWN_STACKING_CEILING = 6;

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
  // shared/ counts too. Moving a hand-rolled dialog into shared/ui makes it
  // reachable by both apps, which is progress — but it does not stop it being
  // hand-rolled, and a scan that skipped the directory would report the move
  // as six dialogs migrated.
  for (const app of ['admin', 'client', 'shared']) walk(path.join(ROOT, app));
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
  assert.ok(adopters.length >= 38, `expected the migrated dialogs, saw ${adopters.length}`);
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

  // The whole stacking scale, in one place and named. z-[300] existed because
  // two screens needed to sit above another dialog and each invented a number
  // for it; z-[80] because the confirm and prompt primitives have to sit above
  // whatever asked the question, including an `over` dialog.
  assert.match(modal, /const LAYER = \{ base: 'z-50', over: 'z-\[60\]', top: 'z-\[80\]' \} as const;/);
  assert.match(modal, /\$\{LAYER\[layer\]\}/);
  // Three is the whole scale. A fourth means the flow is wrong.
  const levels = /const LAYER = \{([^}]*)\}/.exec(modal)[1].split(',').filter(part => part.trim());
  assert.equal(levels.length, 3, 'a fourth stacking level was added instead of fixing the flow');
});

test('no dialog invents its own stacking level any more', () => {
  // Only full-screen dialog backdrops. A toast, a notifications bell and a nav
  // dropdown all legitimately sit high — the first version of this flagged all
  // ten of them, which would have been a rule about the wrong thing.
  //
  // And matched inside a className rather than anywhere in the file: the two
  // comments explaining why z-[300] is gone quote it, so a plain includes()
  // would fail on the explanation instead of on a use.
  // A ratchet, like the one above, because this is pre-existing: three dialogs
  // in تبويب الطلبات sit at z-[9999], the course upsell at z-[200], and the
  // fullscreen video player at z-[100] — that last one is arguably right, being
  // a fullscreen surface rather than a dialog. A new one may not join them.
  const offenders = componentFiles().filter(rel =>
    /className=.fixed inset-0[^"`]*z-\[[1-9]\d\d/.test(read(rel)));
  assert.ok(offenders.length <= OWN_STACKING_CEILING,
    `${offenders.length} files put a dialog on a stacking level of their own, up from `
    + `${OWN_STACKING_CEILING}: ${offenders.join(', ')}. Use Modal's layer prop.`);
});

test('both apps can reach it, and the keyboard hook lives with it', () => {
  // It was admin/components/shared/useModalKeyboard — unreachable from the
  // client, which has fourteen dialogs of its own.
  assert.ok(fs.existsSync(path.join(ROOT, 'shared', 'ui', 'useModalKeyboard.ts')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'admin', 'components', 'shared', 'useModalKeyboard.ts')),
    'two copies of the hook is how the two apps drift apart again');
  assert.match(read('shared/ui/Modal.tsx'), /from '\.\/useModalKeyboard'/);
});

test('the surfaces that are not dialogs still close on Escape', () => {
  // A video lightbox, an image gallery and the fullscreen player are not
  // dialogs and should not be dressed as one — shared/ui/Modal gives a white
  // panel with a header row, which is right for a form and wrong for a photo on
  // a black ground. But all three had no key handling at all: you could open one
  // and only get out again with the mouse.
  //
  // useEscapeKey is the half of useModalKeyboard that applies without a panel.
  const hook = read('shared/ui/useEscapeKey.ts');
  assert.match(hook, /event\.key !== 'Escape'/);
  assert.match(hook, /document\.removeEventListener\('keydown', onKey\)/,
    'the listener outlives the component and closes something that is already gone');
  assert.match(hook, /const latest = useRef\(onEscape\);/,
    'without the ref an inline arrow re-binds the listener on every render');

  for (const rel of [
    'client/pages/course-details-sections/PromoVideoSection.tsx',
    'client/pages/course-details-sections/GallerySection.tsx',
    'client/components/UserDashboardVideoPlayer.tsx',
  ]) {
    assert.match(read(rel), /useEscapeKey\(/, `${rel} has no way out but the mouse`);
  }
});
