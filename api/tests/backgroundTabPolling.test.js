'use strict';

// A setInterval that calls the API keeps calling it when the tab is in the
// background, minimised, or on a phone in a pocket. Nothing on screen changes,
// because there is no screen — the answer is thrown away.
//
// Counted over one day on production, that was most of the traffic:
//
//   POST /api/me/heartbeat                    3,970   every 30s per open tab
//   GET  /api/admin/notifications             1,657   every 60s
//   GET  /api/health                          1,197   every 5m, two apps
//   GET  /api/admin/hr/staff-messages/inbox     787   every 120s
//
// The heartbeat also writes: presence, plus an UPDATE on the users row. A
// customer dashboard left open in a background tab wrote to the database 2,880
// times a day to report that nobody was there.
//
// This test does not carry a list of pollers — it finds them. A new screen that
// polls the API without gating on visibility fails here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function sources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of ['admin', 'client', 'shared']) walk(path.join(ROOT, dir));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

/** From `setInterval(` to its closing paren, so the tick body can be read. */
function intervalBodies(source) {
  const bodies = [];
  const needle = 'setInterval(';
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return bodies;
    from = start + needle.length;
    let depth = 1;
    let index = from;
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') depth -= 1;
      index += 1;
    }
    bodies.push({ body: source.slice(start, index), line: source.slice(0, start).split('\n').length });
  }
}

/**
 * A tick that talks to the server. Anything else is a local timer — a clock, a
 * countdown, an SLA recompute — and may keep running.
 *
 * The first version of this matched `fetch(`, and so missed
 * `void fetchSalesData()` — a poll pulling the whole sales pipeline every two
 * minutes. Verified by deleting that guard and watching the test still pass.
 * It matches the verb-plus-capital shape now, which is what these are called.
 * Not `get` or `list`, though: getTime, getItem and getFullYear are local, and
 * including them flagged the SLA countdown in TicketsTab, which touches no
 * network at all. Real API calls go through mysqlAdmin./apiFetch, matched above.
 */
const NETWORK = /\bfetch\s*\(|mysql[A-Za-z]*\.|apiFetch|heartbeat|\b(fetch|load|reload|refresh|poll|sync)[A-Z]\w*/;

/** Either the shared hook's guard, or the tick's own. */
const GUARDED = /document\.hidden|visibilityState !== 'visible'/;

/**
 * `setInterval(check, 30000)` hides its body behind a name. Resolve a bare
 * identifier to its definition in the same file, so the tick is judged on what
 * it does rather than on how it was written.
 */
function resolveTick(body, source) {
  const bare = /setInterval\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(body);
  if (!bare) return body;
  const name = bare[1];
  const at = new RegExp(`(?:const|let|var|function)\\s+${name}\\b`).exec(source);
  if (!at) return body;
  // From the definition to the end of its statement — enough to see the calls.
  return body + '\n' + source.slice(at.index, at.index + 800);
}

test('no screen polls the API while its tab is hidden', () => {
  const files = sources();
  // Denominator, so a walk that stopped matching is visible rather than
  // reported as a clean bill.
  assert.ok(files.length > 200, `expected both app trees, saw ${files.length}`);

  let timers = 0;
  let networkTimers = 0;
  const unguarded = [];

  for (const rel of files) {
    // The hook is the thing being enforced; its own setInterval is the guard.
    if (rel === 'shared/useVisibleInterval.ts') continue;
    const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const { body, line } of intervalBodies(source)) {
      timers += 1;
      const tick = resolveTick(body, source);
      if (!NETWORK.test(tick)) continue;   // a clock, a countdown, a local recompute
      networkTimers += 1;
      if (GUARDED.test(body)) continue;
      unguarded.push(`${rel}:${line}`);
    }
  }

  // Premises. If either of these empties, the scan found nothing and would
  // otherwise report a clean bill.
  assert.ok(timers >= 8, `expected the app's timers, saw ${timers}`);
  assert.ok(networkTimers >= 3, `expected the polling timers, saw ${networkTimers}`);

  assert.deepEqual(unguarded, [],
    'these poll the API on a timer that keeps running in a background tab: ' + unguarded.join(', '));
});

test('the shared hook fires again the moment the tab comes back', () => {
  const hook = codeOnly(fs.readFileSync(path.join(ROOT, 'shared', 'useVisibleInterval.ts'), 'utf8'));

  // Skipping ticks is only safe because nothing stays stale: the tab coming
  // back to the front re-runs the callback immediately. Without this the fix
  // would trade traffic for a screen showing yesterday's numbers.
  assert.ok(hook.includes("document.addEventListener('visibilitychange', fire);"));
  assert.ok(hook.includes("document.removeEventListener('visibilitychange', fire);"),
    'the listener outlives the component and fires against unmounted state');
  assert.ok(hook.includes('if (typeof document !== \'undefined\' && document.hidden) return;'));

  // The callback lives in a ref, so passing an inline arrow — which every
  // caller does — does not tear down and restart the interval each render.
  assert.ok(hook.includes('const latest = useRef(callback);'));
  assert.ok(hook.includes('}, [intervalMs, enabled]);'),
    'depending on the callback restarts the timer on every render, which never fires');
});

test('the heartbeat beats less often than presence expires', () => {
  const dashboard = codeOnly(fs.readFileSync(path.join(ROOT, 'client', 'pages', 'UserDashboard.tsx'), 'utf8'));
  const presence = codeOnly(fs.readFileSync(path.join(ROOT, 'api', 'lib', 'onlineUsers.js'), 'utf8'));

  // "Online" means seen within listOnlineUsers' window. The beat has to fit
  // inside it at least twice, so one dropped request does not drop the user
  // off the online list.
  const window = /maxAgeMs = (\d+) \* 60 \* 1000/.exec(presence);
  assert.ok(window, 'the presence window is no longer declared where this can read it');
  const windowMs = Number(window[1]) * 60 * 1000;

  const beat = /useVisibleInterval\(\s*\([\s\S]*?heartbeat[\s\S]*?,\s*([\d_]+),/.exec(dashboard);
  assert.ok(beat, 'the heartbeat is not on the visible-interval hook any more');
  const beatMs = Number(beat[1].replace(/_/g, ''));

  assert.ok(beatMs * 2 <= windowMs,
    `a ${beatMs}ms beat against a ${windowMs}ms window drops a user off the online list on one lost request`);
});
