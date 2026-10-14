'use strict';

// Seals every authenticator secret still stored in plain text.
//
// lib/twoFactor.js seals a legacy secret only when its owner next signs in
// with it, so an account that never signs in again — someone on leave, a
// customer who stopped coming — kept its raw base32 secret in users and staff
// indefinitely, readable from any backup or dump. This finishes the job for
// everyone at once.
//
// It runs at startup under a named lock (lib/jobLock.js), so two processes
// booting together do not both do it. It is idempotent: a sealed value
// (isSealedSecret) is never selected or rewritten, and each UPDATE matches the
// row only while it still holds the exact plain value that was read, so a
// re-enrolment or a sign-in that sealed it a moment earlier is left alone. Run
// again, it finds nothing. Plain SQL could not do this: sealing is AES-GCM
// with the server's key, so it has to happen here.
//
// It logs counts only — never a secret, an id or an address.

const { isSealedSecret, sealTotpSecret } = require('./twoFactor');

const TABLES = ['users', 'staff'];
const BATCH = 200;

/**
 * @returns {Promise<{ users: { sealed, skipped }, staff: { sealed, skipped } }>}
 *   sealed — rows rewritten; skipped — rows that changed under it.
 */
async function sealPlaintextTotpSecrets({ pool, batchSize = BATCH } = {}) {
  const totals = {};
  for (const table of TABLES) {
    const counts = { sealed: 0, skipped: 0 };
    totals[table] = counts;
    // Paged by id rather than OFFSET: rows sealed in one page drop out of the
    // filter, which would make an offset skip the rows behind them.
    let after = '';
    for (;;) {
      const [rows] = await pool.query(
        `SELECT id, tenant_id, totp_secret FROM ${table}
          WHERE totp_secret IS NOT NULL AND totp_secret <> '' AND totp_secret NOT LIKE 'v1:%'
            AND id > ?
          ORDER BY id LIMIT ?`,
        [after, batchSize]
      );
      if (!rows.length) break;
      for (const row of rows) {
        after = String(row.id);
        const stored = String(row.totp_secret || '');
        const secret = stored.trim();
        // The LIKE above already leaves these out; checked again here because
        // this function, not the SQL, is the rule for what is sealed.
        if (!secret || isSealedSecret(secret)) continue;
        const [result] = await pool.query(
          `UPDATE ${table} SET totp_secret=? WHERE id=? AND tenant_id=? AND totp_secret=?`,
          [sealTotpSecret(secret), row.id, row.tenant_id, stored]
        );
        if (Number(result?.affectedRows) === 1) counts.sealed += 1;
        else counts.skipped += 1;
      }
      if (rows.length < batchSize) break;
    }
  }
  return totals;
}

/** The scheduler's entry: never throws, and says nothing when there was nothing to do. */
async function runTotpSecretSweep({ pool, logger }) {
  try {
    const totals = await sealPlaintextTotpSecrets({ pool });
    const sealed = TABLES.reduce((sum, table) => sum + totals[table].sealed, 0);
    const skipped = TABLES.reduce((sum, table) => sum + totals[table].skipped, 0);
    if (sealed || skipped) {
      logger.info(`[jobs] totp secrets sealed: users=${totals.users.sealed} staff=${totals.staff.sealed} changed-meanwhile=${skipped}`);
    }
    return totals;
  } catch (error) {
    // Most likely no CHANNEL_SECRET_KEY/JWT_SECRET to seal with; the secrets
    // stay readable as they were and the next boot tries again.
    logger.warn('[jobs] totp secret sweep failed:', error.message);
    return null;
  }
}

module.exports = { runTotpSecretSweep, sealPlaintextTotpSecrets };
