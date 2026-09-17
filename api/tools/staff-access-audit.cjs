#!/usr/bin/env node
'use strict';

/**
 * Every staff account, measured against what its screens actually need.
 *
 * The repo already checks this for ROLES: role-bar-gate-scan refuses a role
 * that is offered a tab its permissions cannot open, or that holds a data
 * permission its scope cannot serve. Both checks passed while a real person's
 * account was broken, because a row carries its own permission list and its own
 * data scope, and neither is the role's.
 *
 * That is how the institute's HR manager ended up with view_leads and
 * manage_leads on a row whose scope was the hr default of 'none': every lead
 * query became `AND 1=0`, so the screen opened, answered 200, and showed
 * nothing. It read as "the account is empty" rather than "the account is
 * misconfigured", and it stayed that way because the one screen that could fix
 * it answered 403 to everybody.
 *
 * What it reports, per row:
 *
 *   inert        a data permission the effective scope cannot serve — the tab
 *                opens onto an empty page;
 *   narrowed     the row's own list is missing something the role's defaults
 *                carry, so somebody trimmed it. Often deliberate, always worth
 *                seeing;
 *   beyond role  the row holds what its role's defaults do not;
 *   deletes      delete or refund-approval rights on a row that is not a
 *                manager — the owner's rule is that only a manager deletes a
 *                client;
 *   locked out   an explicit empty list: no permissions at all;
 *   no login     an HR record with no account behind it. Not a fault.
 *
 *   node tools/staff-access-audit.cjs            # every live row
 *   node tools/staff-access-audit.cjs --strict   # exit 1 on inert or deletes
 *
 * Reads the .env beside it. Read-only, in a read-only transaction.
 */

const path = require('path');
const API_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(API_ROOT, '.env') });
const mysql = require('mysql2/promise');
const {
  ROLE_PERMS, FULL_ACCESS_ROLES, DATA_SCOPE,
  normalizeDataScope, resolvePermissions, resolveDataScope,
} = require(path.join(API_ROOT, 'constants', 'permissions.js'));

const STRICT = process.argv.includes('--strict');

// The same list role-bar-gate-scan uses: permissions whose whole purpose is to
// return client rows, and which a scope of 'none' answers with nothing.
const NEEDS_ROWS = ['view_leads', 'view_subscribers', 'view_client_db', 'view_orders', 'view_financial'];
// The owner's rule: only a manager deletes a client.
const MANAGER_ONLY = ['delete_leads', 'delete_subscribers'];
// Not a rule — authority worth being able to list. Two of these are in the
// collection role's own defaults, so holding one is a decision, not a fault.
const MONEY_AUTHORITY = ['approve_refunds', 'manage_financial'];

const list = value => (Array.isArray(value) ? value : []);

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await db.query('SET SESSION TRANSACTION READ ONLY');
  // A staff row is a personnel record; the login is a users row with the same
  // email. firebase_uid looks like the link and is not one — two rows out of
  // eighteen carry it, including people who signed in this week, so reading it
  // as "has an account" reports sixteen employees locked out of a system they
  // use daily.
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.email, s.role, s.is_active, s.data_scope, s.permissions_json, s.branch_id,
            u.id IS NOT NULL AS has_login, u.active_session_last_seen_at AS last_seen
       FROM staff s
       LEFT JOIN users u
         ON LOWER(TRIM(u.email)) = LOWER(TRIM(s.email)) AND u.tenant_id = s.tenant_id
      WHERE s.deleted_at IS NULL ORDER BY s.role, s.name`);
  await db.end();

  const findings = [];
  console.log(`${rows.length} live staff rows in ${process.env.DB_NAME}\n`);
  console.log('role                     name                 scope            perms  state');
  console.log('─'.repeat(88));

  for (const row of rows) {
    const role = String(row.role || '').toLowerCase();
    const full = FULL_ACCESS_ROLES.includes(role);
    let explicit = null;
    try { explicit = row.permissions_json ? JSON.parse(row.permissions_json) : null; } catch { explicit = 'unparseable'; }

    const effective = resolvePermissions(row);
    const held = effective === '*' ? 'all' : list(effective);
    const scope = resolveDataScope(row, { fallback: 'none' });
    const override = normalizeDataScope(row.data_scope);

    const state = [];
    if (!row.is_active) state.push('inactive');
    if (!row.email) state.push('no email');
    else if (!row.has_login) state.push('no login');
    else state.push(row.last_seen ? `seen ${String(row.last_seen).slice(0, 10)}` : 'never signed in');
    if (Array.isArray(explicit) && explicit.length === 0) state.push('locked out');
    if (explicit === 'unparseable') state.push('unreadable list');

    console.log(
      `${role.padEnd(24)} ${String(row.name || '').slice(0, 20).padEnd(20)} ` +
      `${(override ? scope : scope + ' (role)').padEnd(16)} ` +
      `${(held === 'all' ? '  *' : String(held.length).padStart(3))}    ${state.join(', ') || 'ok'}`
    );

    const add = (kind, detail) => findings.push({ kind, who: `${role} · ${row.name}`, detail });

    if (held !== 'all') {
      // A data permission the scope cannot serve.
      if (scope === 'none') {
        const inert = held.filter(p => NEEDS_ROWS.includes(p));
        if (inert.length) add('inert', `holds ${inert.join(', ')} with data scope 'none' — those screens open empty`);
      }
      // Rights reserved for a manager, and money authority worth listing.
      if (!full) {
        const reserved = held.filter(p => MANAGER_ONLY.includes(p));
        if (reserved.length) add('deletes', `holds ${reserved.join(', ')} without being a manager`);
        const money = held.filter(p => MONEY_AUTHORITY.includes(p));
        if (money.length) {
          const byDefault = list(ROLE_PERMS[role]).filter(p => money.includes(p));
          add('money authority', `${money.join(', ')}${byDefault.length === money.length ? ' — from the role defaults' : byDefault.length ? ` (${byDefault.join(', ')} from the role defaults)` : ' — granted on this row, not by the role'}`);
        }
      }
      // Somebody trimmed the row, or widened it.
      if (Array.isArray(explicit) && explicit.length) {
        const defaults = ROLE_PERMS[role] === '*' ? null : list(ROLE_PERMS[role]);
        if (defaults) {
          const missing = defaults.filter(p => !explicit.includes(p));
          const extra = explicit.filter(p => !defaults.includes(p));
          if (missing.length) add('narrowed', `its role brings ${missing.join(', ')} and this row does not have ${missing.length > 1 ? 'them' : 'it'}`);
          if (extra.length) add('beyond role', `holds ${extra.join(', ')} which ${role} defaults do not`);
        }
      }
      if (Array.isArray(explicit) && explicit.length === 0) {
        add('locked out', 'an explicit empty list — the account can reach nothing but its own page');
      }
    }
    if (row.is_active && !row.email) add('no login', 'an active employee record with no email, so no account can exist for it');
    else if (row.is_active && !row.has_login) add('no login', `an active employee record with no account behind ${row.email} — this person cannot sign in`);
  }

  const byKind = {};
  for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);
  const ORDER = ['inert', 'locked out', 'no login', 'deletes', 'narrowed', 'beyond role', 'money authority'];
  console.log('');
  for (const kind of ORDER) {
    const group = byKind[kind];
    if (!group) continue;
    console.log(`${kind} — ${group.length}`);
    for (const f of group) console.log(`   ${f.who}: ${f.detail}`);
    console.log('');
  }
  if (!findings.length) console.log('every row can serve every permission it holds.');

  const blocking = (byKind.inert || []).length + (byKind.deletes || []).length
    + (byKind['locked out'] || []).length + (byKind['no login'] || []).length;
  if (STRICT && blocking) {
    console.log(`${blocking} row(s) hold access that does not work or is not theirs to hold.`);
    process.exit(1);
  }
  console.log(`scopes in use: ${[...new Set(rows.map(r => resolveDataScope(r, { fallback: 'none' })))].join(', ')}`);
  console.log(`(role defaults: ${Object.entries(DATA_SCOPE).filter(([r]) => rows.some(x => String(x.role).toLowerCase() === r)).map(([r, s]) => `${r}=${s}`).join(', ')})`);
})().catch(error => { console.error('staff-access-audit: ' + error.message); process.exit(2); });
