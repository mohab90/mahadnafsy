'use strict';

// A deleted payment is not revenue.
//
// `payments` is soft-deleted — the row stays and `deleted_at` is stamped. On
// production 27 rows carry it, worth 51,053 EGP, and every one of them was
// being counted: the queries filtered on `status='paid'` and nothing else, so
// the dashboard read 844,771 for the year against a real 793,718. Six percent
// of the institute's revenue was money somebody had already deleted. It reached
// the KPI header, the daily report, the sales leaderboard, the commission
// calculation, the forecast, and the per-box totals.
//
// So: every query that sums or counts money out of `payments` must honour
// `deleted_at IS NULL`. A handful must NOT, and they are named below with the
// reason — an integrity scan and a dedupe check are worthless if they cannot
// see the deleted rows.
//
// Two shapes this test also has to get right, because the first cut of the fix
// got them wrong:
//   * on a LEFT JOIN the predicate belongs in ON — in WHERE it discards the
//     unmatched rows and turns the join inner;
//   * `${interpolated}` WHERE fragments hide the guard from a source scan, so
//     the fragment's own initialiser is what gets checked.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');

// Deliberately unguarded — each of these needs to see deleted rows.
const ALLOWED = new Map([
  ['lib/reconcileChecks.js', 'integrity scans exist to see every row'],
  ['lib/privacyService.js', 'a subject-access export must return everything held'],
  ['lib/finance.js', 'a branch lookup by id — no money in it'],
  ['routes/core/payops.js', 'id dedupe, and the payment audit log outlives the payment'],
  ['routes/public-orders.js:471', 'transaction_id dedupe — blind to a deleted row it double-charges'],
  ['routes/finance-documents.js', 'the invoice is its own record'],
  ['routes/support.js', 'ticket context, looked up by an explicit id'],
  ['routes/monitoring.js:301', 'journal reconciliation wants the raw table'],
  ['routes/monitoring.js:309', 'journal reconciliation wants the raw table'],
  // Queries whose WHERE arrives as `${an interpolated fragment}` are exempt
  // here and covered by the initialiser test further down instead — a source
  // scan cannot see into the fragment. Line numbers are deliberately NOT used
  // for these: pinning a line means every edit above it breaks this test.
  ['routes/hr/staffprofile.js:167', 'guarded inside the derived table'],
]);

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Spans of every string literal, so a query is read whole rather than guessed at.
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; i += 2; continue; }
    if (ch === '`' || ch === "'" || ch === '"') {
      const start = i; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === ch) break;
        if (ch !== '`' && src[i] === '\n') break;
        i++;
      }
      out.push([start, i]); i++; continue;
    }
    i++;
  }
  return out;
}

function scan() {
  const unguarded = [];
  for (const abs of jsFiles(API)) {
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes('payments')) continue;
    const rel = path.relative(API, abs).split(path.sep).join('/');
    const lits = literals(src);
    const re = /\b(?:FROM|JOIN)\s+payments\b(?!_)/gi;
    let m;
    while ((m = re.exec(src))) {
      const lit = lits.find(([a, b]) => m.index > a && m.index < b);
      if (!lit) continue;
      const sql = src.slice(lit[0] + 1, lit[1]);
      if (!/\bSELECT\b/i.test(sql)) continue;
      // Only money: a SUM over an amount column, or a COUNT of payment rows.
      const money = /\bSUM\s*\(\s*(?:CASE[\s\S]{0,120}?)?[a-z_]*\.?amount/i.test(sql)
        || /\bCOUNT\s*\([^)]*\)\s+AS\s+\w*(?:payment|paid|pending|sales|transaction)/i.test(sql);
      if (!money) continue;
      const aliasM = /\bpayments\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/i.exec(src.slice(m.index, m.index + 40));
      const kw = new Set(['where', 'on', 'set', 'group', 'order', 'left', 'inner', 'right',
        'join', 'as', 'using', 'limit', 'having', 'union', 'cross']);
      const a = aliasM && !kw.has(aliasM[1].toLowerCase()) ? aliasM[1] : null;
      const guarded = a
        ? new RegExp('\\b' + a + '\\.deleted_at\\s+IS\\s+NULL', 'i').test(sql)
        : /\bdeleted_at\s+IS\s+NULL/i.test(sql);
      if (guarded) continue;
      // The WHERE is built in JS. Nothing here can tell whether the fragment
      // carries the guard, so the fragment's own initialiser is pinned instead
      // (see 'the interpolated WHERE fragments carry the guard themselves').
      if (/WHERE\s*\$\{|\$\{\w*[Ww]here\w*\}/.test(sql)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (ALLOWED.has(rel) || ALLOWED.has(rel + ':' + line)) continue;
      unguarded.push(rel + ':' + line);
    }
  }
  return unguarded;
}

test('no money is summed out of payments without honouring deleted_at', () => {
  const unguarded = scan();
  assert.deepEqual(unguarded, [],
    'these read money from `payments` and count the deleted rows:\n  ' + unguarded.join('\n  '));
});

test('the scan can actually see a breach', () => {
  // The guard above is a source scan, and a source scan that matches nothing
  // passes on everything. Break one and the scan has to notice.
  const f = path.join(API, 'routes', 'analytics', 'dashboard.js');
  const original = fs.readFileSync(f, 'utf8');
  const guard = "FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed') AND deleted_at IS NULL";
  assert.ok(original.includes(guard), 'the KPI query moved — repoint this mutation');
  try {
    fs.writeFileSync(f, original.replace(guard,
      "FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed')"));
    const broken = scan();
    assert.ok(broken.includes('routes/analytics/dashboard.js:65'),
      'the KPI query lost its guard and the scan said nothing');
  } finally {
    fs.writeFileSync(f, original);
  }
});

test('the interpolated WHERE fragments carry the guard themselves', () => {
  // A scan cannot see into `${where}`. These two build their filter in JS, so
  // the initialiser is the thing to pin.
  const payments = fs.readFileSync(path.join(API, 'routes', 'payments.js'), 'utf8');
  assert.ok(payments.includes("let where = 'p.tenant_id = ? AND p.deleted_at IS NULL'"),
    'the payments list built its WHERE without the soft-delete guard');

  const orders = fs.readFileSync(path.join(API, 'routes', 'public-orders.js'), 'utf8');
  assert.ok(orders.includes("'WHERE subscriber_id = ? AND amount > 0 AND deleted_at IS NULL'"),
    "the customer's paid-total counts deleted payments again");
});

test('on a LEFT JOIN the guard sits in ON, never in WHERE', () => {
  // In WHERE it drops every unmatched row and quietly makes the join inner.
  // The ghost sweep below looks for `p.id IS NULL`; with the guard in its WHERE
  // it matches nothing at all and the cleanup silently stops running.
  for (const rel of ['routes/admin-utils.js', 'routes/analytics/dashboard.js',
    'routes/client-maintenance.js', 'routes/funnel.js', 'routes/misc/analytics.js']) {
    const src = fs.readFileSync(path.join(API, rel), 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/LEFT JOIN\s+payments\b/i.test(lines[i])) continue;
      // The ON clause runs until the next WHERE / GROUP / another JOIN.
      let on = '';
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        if (j > i && /^\s*(WHERE|GROUP|ORDER|HAVING|LIMIT)\b/i.test(lines[j])) {
          assert.ok(!/p\.deleted_at\s+IS\s+NULL/i.test(lines[j]),
            rel + ':' + (j + 1) + ' puts the guard in WHERE on a LEFT JOIN — that drops the unmatched rows');
          break;
        }
        on += ' ' + lines[j];
        if (/^\s*(LEFT|INNER|RIGHT)\s+JOIN\b/i.test(lines[j]) && j > i) break;
      }
      assert.match(on, /p\.deleted_at\s+IS\s+NULL/i,
        rel + ':' + (i + 1) + ' LEFT JOINs payments without excluding the deleted rows');
    }
  }
});
