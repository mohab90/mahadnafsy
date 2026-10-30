/**
 * One throwaway database per integration test file.
 *
 * Loaded with `node --test --import` (see "test:integration" in api/package.json),
 * so it runs inside each test file's own process before the file is read: it
 * copies a template schema into `mahad_it_<host>_<pid>_<n>` and points DB_NAME
 * (and TEST_DB_NAME, which the files prefer) at the copy. The file then
 * requires lib/db as it always did and gets a pool on its own database, so the
 * order the files run in and whatever rows an earlier file left behind no
 * longer matter. The copy is dropped when the file's process ends.
 *
 * The template is the schema a new server gets — an empty database built by
 * the migration runner (schema.sql, then every migration). It is built once
 * per change of schema.sql or the migrations (the name carries a hash of
 * both), under a database lock so files started together build it once, and
 * kept between runs: copying it takes about a second, building it a few.
 *
 * Off when no DB_* is configured (the files skip themselves), or with
 * MAHAD_IT_SHARED_DB=1 to run against DB_NAME itself as before.
 */
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = process.env;
// The emailed login code is on by default (lib/mfaPolicy.js); the sign-ins the integration files make have no mailbox to read it from.
if (env.MAHAD_IT_NO_EMAIL_CODE === undefined) env.MAHAD_IT_NO_EMAIL_CODE = '1';
const setting = key => env[`TEST_DB_${key}`] || env[`DB_${key}`];
const enabled = Boolean(setting('USER') && setting('NAME')) && env.MAHAD_IT_SHARED_DB !== '1';

// Only this machine's copies are swept: a database server shared by two
// machines would otherwise see the other one's live pids as dead.
const HOST_TAG = crypto.createHash('sha1').update(os.hostname()).digest('hex').slice(0, 4);
const COPY_PREFIX = `mahad_it_${HOST_TAG}_`;
const TEMPLATE_PREFIX = 'mahad_it_tpl_';
// A template no run has used for this long belongs to an old checkout.
const TEMPLATE_IDLE_DAYS = 2;

function schemaHash() {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(path.join(API_ROOT, 'schema.sql')));
  const dir = path.join(API_ROOT, 'migrations');
  for (const file of fs.readdirSync(dir).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    hash.update(file).update(fs.readFileSync(path.join(dir, file)));
  }
  return hash.digest('hex').slice(0, 12);
}

const quote = name => `\`${String(name).replace(/`/g, '``')}\``;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function connect(mysql) {
  return mysql.createConnection({
    host: setting('HOST') || '127.0.0.1',
    port: Number(setting('PORT') || 3306),
    user: setting('USER'),
    password: setting('PASSWORD'),
    multipleStatements: true,
    charset: 'UTF8MB4_UNICODE_CI',
  });
}

// The migration runner in a process of its own: requiring lib/db here would
// cache a pool on the template for the test file that follows.
async function buildTemplate(conn, template) {
  await conn.query(`DROP DATABASE IF EXISTS ${quote(template)}`);
  await conn.query(`CREATE DATABASE ${quote(template)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  try {
    await promisify(execFile)(process.execPath, [path.join(API_ROOT, 'tools', 'migrate.cjs')], {
      cwd: API_ROOT,
      env: { ...env, DB_NAME: template, TEST_DB_NAME: '', DB_HOST: setting('HOST') || '127.0.0.1',
        DB_PORT: setting('PORT') || '3306', DB_USER: setting('USER'), DB_PASSWORD: setting('PASSWORD') || '' },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    await conn.query(`DROP DATABASE IF EXISTS ${quote(template)}`).catch(() => {});
    throw new Error(`integration template: migrations failed\n${String(error.stdout || '').slice(-4000)}\n${error.stderr || ''}`);
  }
  await conn.query(`CREATE TABLE ${quote(template)}._it_template (used_at DATETIME NOT NULL)`);
  await conn.query(`INSERT INTO ${quote(template)}._it_template VALUES (UTC_TIMESTAMP())`);
}

async function sweep(conn, template) {
  const [schemas] = await conn.query(
    "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'mahad\\_it\\_%'");
  for (const { name } of schemas) {
    if (name.startsWith(COPY_PREFIX)) {
      const pid = Number(name.slice(COPY_PREFIX.length).split('_')[0]);
      if (pid && pid !== process.pid && !alive(pid)) await conn.query(`DROP DATABASE IF EXISTS ${quote(name)}`).catch(() => {});
    } else if (name.startsWith(TEMPLATE_PREFIX) && name !== template) {
      const [[row]] = await conn.query(
        `SELECT MAX(used_at) < UTC_TIMESTAMP() - INTERVAL ${TEMPLATE_IDLE_DAYS} DAY AS idle FROM ${quote(name)}._it_template`,
      ).catch(() => [[{ idle: 1 }]]);
      if (Number(row?.idle)) await conn.query(`DROP DATABASE IF EXISTS ${quote(name)}`).catch(() => {});
    }
  }
}

async function copyTemplate(conn, template, target) {
  const [tables] = await conn.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' AND table_name<>'_it_template'",
    [template]);
  const ddl = [];
  const seeded = [];
  for (const { name } of tables) {
    const [[created]] = await conn.query(`SHOW CREATE TABLE ${quote(template)}.${quote(name)}`);
    ddl.push(created['Create Table']);
    const [[has]] = await conn.query(`SELECT EXISTS(SELECT 1 FROM ${quote(template)}.${quote(name)}) AS rowsThere`);
    if (Number(has.rowsThere)) seeded.push(name);
  }
  // SHOW CREATE TABLE names foreign-key targets without a schema, so they
  // resolve inside the copy; CREATE TABLE … LIKE would have dropped them.
  await conn.query(`CREATE DATABASE ${quote(target)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE ${quote(target)}; SET FOREIGN_KEY_CHECKS=0; ${ddl.join(';\n')};`);
  for (const name of seeded) await conn.query(`INSERT INTO ${quote(name)} SELECT * FROM ${quote(template)}.${quote(name)}`);
  const [triggers] = await conn.query('SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=?', [template]);
  for (const { name } of triggers) {
    const [[row]] = await conn.query(`SHOW CREATE TRIGGER ${quote(template)}.${quote(name)}`);
    await conn.query(String(row['SQL Original Statement']).replace(/\bDEFINER\s*=\s*\S+\s+/i, ''));
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}

if (enabled && env.MAHAD_IT_DB_READY !== String(process.pid)) {
  const mysql = require('mysql2/promise');
  const template = `${TEMPLATE_PREFIX}${schemaHash()}`;
  const target = `${COPY_PREFIX}${process.pid}_${Date.now().toString(36)}`;
  const conn = await connect(mysql);
  try {
    const lock = `mahad_it_template_${template}`;
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 300) AS got', [lock]);
    if (Number(got) !== 1) throw new Error('integration template: timed out waiting for another run to build it');
    try {
      const [[ready]] = await conn.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name='_it_template'", [template]);
      if (!Number(ready.n)) await buildTemplate(conn, template);
      await conn.query(`UPDATE ${quote(template)}._it_template SET used_at=UTC_TIMESTAMP()`);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lock]);
    }
    await sweep(conn, template);
    await copyTemplate(conn, template, target);
  } finally {
    await conn.end().catch(() => {});
  }

  env.DB_NAME = target;
  if (env.TEST_DB_NAME) env.TEST_DB_NAME = target;
  env.MAHAD_IT_DB_READY = String(process.pid);

  let dropped = false;
  process.on('beforeExit', async () => {
    if (dropped) return;
    dropped = true;
    const closing = await connect(mysql).catch(() => null);
    if (!closing) return;
    await closing.query(`DROP DATABASE IF EXISTS ${quote(target)}`).catch(() => {});
    await closing.end().catch(() => {});
  });
}
