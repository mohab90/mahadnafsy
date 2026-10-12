'use strict';

// «اقفل الأسرار القديمة» (12 Oct 2026): an authenticator secret still stored in
// plain text was sealed only when its owner next signed in, so an account that
// never did kept it readable in every dump. lib/totpSecretSweep.js seals them
// all once at startup — never touching a sealed value, never overwriting a row
// that changed under it, and logging counts only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-totp-sweep-secret-0123456789-abcdefghij';

const { readTotpSecret, sealTotpSecret, isSealedSecret } = require('../lib/twoFactor');
const { sealPlaintextTotpSecrets, runTotpSecretSweep } = require('../lib/totpSecretSweep');

const PLAIN_A = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const PLAIN_B = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';

/** Two tables in memory, answering the sweep's SELECT and UPDATE as MariaDB would. */
function fakePool(tables, { beforeUpdate } = {}) {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      const table = /\b(?:FROM|UPDATE)\s+(users|staff)\b/.exec(sql)?.[1];
      const rows = tables[table];
      if (/^\s*SELECT/.test(sql)) {
        const [after, limit] = params;
        const hits = rows
          .filter(row => row.totp_secret && !String(row.totp_secret).startsWith('v1:') && row.id > after)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map(row => ({ ...row }));
        return [hits];
      }
      if (/^\s*UPDATE/.test(sql)) {
        const [value, id, tenantId, expected] = params;
        if (beforeUpdate) beforeUpdate({ table, id, rows });
        updates.push({ table, id });
        const row = rows.find(r => r.id === id && r.tenant_id === tenantId && r.totp_secret === expected);
        if (!row) return [{ affectedRows: 0 }];
        row.totp_secret = value;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('every plaintext secret is sealed, in both tables, and still opens to the same secret', async () => {
  const tables = {
    users: [
      { id: 'u-1', tenant_id: 't-a', totp_secret: PLAIN_A },
      { id: 'u-2', tenant_id: 't-b', totp_secret: ` ${PLAIN_B}\n` },
      { id: 'u-3', tenant_id: 't-a', totp_secret: null },
    ],
    staff: [{ id: 's-1', tenant_id: 't-a', totp_secret: PLAIN_A }],
  };
  const totals = await sealPlaintextTotpSecrets({ pool: fakePool(tables) });
  assert.deepEqual(totals, { users: { sealed: 2, skipped: 0 }, staff: { sealed: 1, skipped: 0 } });
  for (const row of [...tables.users.slice(0, 2), ...tables.staff]) assert.ok(isSealedSecret(row.totp_secret));
  assert.equal(readTotpSecret(tables.users[0].totp_secret).secret, PLAIN_A);
  assert.equal(readTotpSecret(tables.users[1].totp_secret).secret, PLAIN_B, 'trimmed the way readTotpSecret reads it');
  assert.equal(readTotpSecret(tables.staff[0].totp_secret).secret, PLAIN_A);
  assert.equal(tables.users[2].totp_secret, null);
});

test('a sealed value is never selected or rewritten, and a second run does nothing', async () => {
  const sealed = sealTotpSecret(PLAIN_A);
  const tables = {
    users: [{ id: 'u-1', tenant_id: 't-a', totp_secret: sealed }, { id: 'u-2', tenant_id: 't-a', totp_secret: PLAIN_B }],
    staff: [],
  };
  const pool = fakePool(tables);
  await sealPlaintextTotpSecrets({ pool });
  assert.equal(tables.users[0].totp_secret, sealed, 'byte for byte');
  assert.deepEqual(pool.updates.map(u => u.id), ['u-2']);
  const again = fakePool(tables);
  assert.deepEqual(await sealPlaintextTotpSecrets({ pool: again }), { users: { sealed: 0, skipped: 0 }, staff: { sealed: 0, skipped: 0 } });
  assert.equal(again.updates.length, 0);
});

test('a row re-enrolled while the sweep ran keeps its new secret', async () => {
  const fresh = sealTotpSecret(PLAIN_B);
  const tables = { users: [{ id: 'u-1', tenant_id: 't-a', totp_secret: PLAIN_A }], staff: [] };
  const pool = fakePool(tables, { beforeUpdate: ({ rows }) => { rows[0].totp_secret = fresh; } });
  const totals = await sealPlaintextTotpSecrets({ pool });
  assert.deepEqual(totals.users, { sealed: 0, skipped: 1 });
  assert.equal(tables.users[0].totp_secret, fresh);
});

test('pages past a full batch without skipping or repeating a row', async () => {
  const users = Array.from({ length: 7 }, (_, i) => ({ id: `u-${i}`, tenant_id: 't-a', totp_secret: PLAIN_A }));
  const pool = fakePool({ users, staff: [] });
  const totals = await sealPlaintextTotpSecrets({ pool, batchSize: 3 });
  assert.equal(totals.users.sealed, 7);
  assert.equal(new Set(pool.updates.map(u => u.id)).size, 7);
  assert.ok(users.every(row => isSealedSecret(row.totp_secret)));
});

test('it logs counts only, says nothing when there is nothing to do, and never throws', async () => {
  const lines = [];
  const logger = { info: (...args) => lines.push(args.join(' ')), warn: (...args) => lines.push(args.join(' ')) };
  const tables = { users: [{ id: 'u-1', tenant_id: 't-a', totp_secret: PLAIN_A }], staff: [{ id: 's-1', tenant_id: 't-a', totp_secret: PLAIN_B }] };
  await runTotpSecretSweep({ pool: fakePool(tables), logger });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /users=1 staff=1/);
  for (const leak of [PLAIN_A, PLAIN_B, 'u-1', 's-1', 't-a']) assert.ok(!lines[0].includes(leak), `log names ${leak}`);

  lines.length = 0;
  await runTotpSecretSweep({ pool: fakePool(tables), logger });
  assert.deepEqual(lines, []);

  const broken = { query: async () => { throw new Error('db down'); } };
  assert.equal(await runTotpSecretSweep({ pool: broken, logger }), null);
  assert.match(lines[0], /sweep failed: db down/);
});

test('it runs once at startup, under its own lock, and is not a SQL migration', () => {
  const scheduler = fs.readFileSync(path.join(__dirname, '..', 'lib', 'backgroundScheduler.js'), 'utf8');
  assert.match(scheduler, /later\(lockedJob\('totp_secret_seal', \(\) => require\('\.\/totpSecretSweep'\)\.runTotpSecretSweep\(\{ pool, logger \}\)\), 60 \* 1000\);/);
  const call = scheduler.indexOf("lockedJob('totp_secret_seal'");
  assert.ok(!/repeat\([^)]*totp/.test(scheduler.slice(call, call + 400)), 'once, not on a timer');
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'migrations'));
  assert.ok(!migrations.some(name => /seal.*totp|totp.*seal/i.test(name) && !/272_v26_sealed_totp_secrets/.test(name)));
});
