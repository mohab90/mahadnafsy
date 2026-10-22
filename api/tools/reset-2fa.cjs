#!/usr/bin/env node
'use strict';
// The owner's way back in when the authenticator phone AND the recovery codes
// are gone. Run on the server, from the API folder, by someone with shell
// access — which is the proof of authority the web routes cannot ask for:
//
//   node tools/reset-2fa.cjs --email owner@example.com                 ← shows the account, changes nothing
//   node tools/reset-2fa.cjs --email owner@example.com --apply         ← removes its 2FA and signs it out everywhere
//   node tools/reset-2fa.cjs --email owner@example.com --apply --fresh-grace
//        ← and gives it a new grace period (the policy's days) before it must enrol again
//   --tenant <id>   another institute (default tenant-default)
//
// After it the account signs in with its password and is taken to the 2FA
// enrolment screen (without --fresh-grace that screen is all it can open until
// it enrols, which takes a minute). The reset is written to the audit trail.
require('dotenv').config();
const { pool } = require('../lib/db');
const { clearRecoveryCodes } = require('../lib/twoFactor');
const { writeAuditEvent } = require('../lib/auditTrail');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const email = String(arg('--email') || '').trim().toLowerCase();
  const tenantId = String(arg('--tenant') || 'tenant-default');
  const apply = process.argv.includes('--apply');
  const freshGrace = process.argv.includes('--fresh-grace');
  if (!email) {
    console.error('usage: node tools/reset-2fa.cjs --email <address> [--tenant <id>] [--apply] [--fresh-grace]');
    process.exitCode = 2;
    return;
  }
  const [users] = await pool.query(
    'SELECT id, email, name, totp_enabled, is_active FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=?',
    [tenantId, email]
  );
  if (!users.length) {
    console.error(`no account with ${email} in ${tenantId}`);
    process.exitCode = 1;
    return;
  }
  for (const user of users) {
    console.log(`${user.id}  ${user.email}  ${user.name || ''}  2FA=${user.totp_enabled ? 'on' : 'off'}  active=${user.is_active ? 'yes' : 'no'}`);
  }
  if (!apply) {
    console.log('nothing changed — add --apply to remove 2FA from the account(s) above');
    return;
  }
  const userIds = users.map(user => user.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE users SET totp_enabled=0, totp_secret=NULL, session_version=session_version+1,
              active_session_id=NULL, active_session_ip_hash=NULL,
              active_session_started_at=NULL, active_session_last_seen_at=NULL
              ${freshGrace ? ', mfa_grace_started_at=NOW()' : ''}
        WHERE tenant_id=? AND id IN (?)`,
      [tenantId, userIds]
    );
    await conn.query(
      'UPDATE staff SET totp_enabled=0, totp_secret=NULL WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [tenantId, email]
    );
    await clearRecoveryCodes(conn, { tenantId, userIds });
    await writeAuditEvent({
      req: { tenantId, user: { uid: 'server-console' }, headers: { 'user-agent': 'tools/reset-2fa.cjs' } },
      db: conn, action: 'auth.mfa.reset_from_server', entityType: 'user', entityId: userIds[0], severity: 'critical',
      metadata: { email, accounts: userIds.length, fresh_grace: freshGrace },
    });
    await conn.commit();
    console.log(`2FA removed from ${userIds.length} account(s); every session of it is signed out.`);
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

main()
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
