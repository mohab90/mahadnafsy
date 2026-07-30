#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createGzip, createGunzip } = require('node:zlib');
const mysql = require('mysql2/promise');
const { getDbSslConfig } = require('../lib/dbSsl');

const sourceDb = String(process.env.DB_NAME || '');
const dbPassword = process.env.DB_PASSWORD_ALLOW_EMPTY === '1' ? '' : (process.env.DB_PASSWORD || '');
const rehearsalDb = `mahad_restore_rehearsal_${process.pid}_${Date.now()}`;
const requiredMigrations = [
  '144_v25_support_workflow_integrity.sql',
  '145_v25_notification_recipient_reads.sql',
  '146_v25_saas_control_plane_integrity.sql',
  '147_v25_whatsapp_delivery_receipts.sql',
  '148_v25_community_engagement_integrity.sql',
  '149_v25_customer_auth_geo_integrity.sql',
  '150_v25_hr_records_integrity.sql',
  '151_v25_payroll_scope_integrity.sql',
  '152_v25_instructor_rate_approval.sql',
  '153_v25_payment_compensation_integrity.sql',
  '154_v25_finance_query_indexes.sql',
  '155_v25_lms_assessment_integrity.sql',
  '156_v25_certificate_request_integrity.sql',
  '157_v25_attendance_dokki_indexes.sql',
  '158_v25_daqqi_attendance_events.sql',
  '159_v25_otp_secret_storage.sql',
];
const coreTables = [
  'tenants', 'users', 'staff', 'leads', 'subscribers', 'courses',
  'enrollments', 'payments', 'journal_entries', 'job_queue', 'message_outbox',
];

function fail(message) {
  throw new Error(message);
}

function assertSafe() {
  if (process.env.ALLOW_DB_RESTORE_REHEARSAL !== '1') {
    fail('Set ALLOW_DB_RESTORE_REHEARSAL=1 to acknowledge temporary database creation/drop');
  }
  if (!sourceDb || !/^[a-zA-Z0-9_]+$/.test(sourceDb)) fail('DB_NAME is missing or unsafe');
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SOURCE_BACKUP !== '1') {
    fail('Production source rehearsal requires ALLOW_PRODUCTION_SOURCE_BACKUP=1 and a restore-only target host');
  }
}

function executable(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  if (!value) fail(`${name} is missing`);
  return value;
}

function run(command, args, { input } = {}) {
  const childEnv = { ...process.env };
  if (dbPassword) childEnv.MYSQL_PWD = dbPassword;
  else delete childEnv.MYSQL_PWD;
  const child = spawn(command, args, {
    env: childEnv,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.slice(-1000)}`)));
  });
  return { child, completion };
}

async function snapshot(conn, database) {
  const [[tableCount]] = await conn.query(
    'SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=? AND table_type=?',
    [database, 'BASE TABLE']
  );
  const [existing] = await conn.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=? AND table_name IN (?)`,
    [database, coreTables]
  );
  const counts = {};
  for (const { TABLE_NAME: table } of existing) {
    const [[row]] = await conn.query(`SELECT COUNT(*) count FROM \`${database}\`.\`${table}\``);
    counts[table] = Number(row.count);
  }
  const [migrations] = await conn.query(
    `SELECT version, checksum FROM \`${database}\`.schema_migrations WHERE version IN (?) ORDER BY version`,
    [requiredMigrations]
  );
  return {
    tables: Number(tableCount.count),
    counts,
    migrations: Object.fromEntries(migrations.map(row => [String(row.version), String(row.checksum)])),
  };
}

async function dumpToFile(file) {
  const dump = executable('MYSQLDUMP_PATH', 'mysqldump');
  const args = [
    `--host=${process.env.DB_HOST || '127.0.0.1'}`,
    `--port=${process.env.DB_PORT || '3306'}`,
    `--user=${process.env.DB_USER}`,
    '--single-transaction', '--quick', '--routines', '--triggers', '--events',
    '--no-tablespaces', '--set-gtid-purged=OFF', sourceDb,
  ];
  const processRun = run(dump, args);
  await Promise.all([
    pipeline(processRun.child.stdout, createGzip({ level: 6 }), fs.createWriteStream(file, { flags: 'wx' })),
    processRun.completion,
  ]);
  const size = fs.statSync(file).size;
  if (size < 1024) fail(`Backup is suspiciously small (${size} bytes)`);
  return size;
}

async function restoreFromFile(file) {
  const client = executable('MYSQL_CLIENT_PATH', 'mysql');
  const args = [
    `--host=${process.env.DB_HOST || '127.0.0.1'}`,
    `--port=${process.env.DB_PORT || '3306'}`,
    `--user=${process.env.DB_USER}`,
    '--binary-mode', rehearsalDb,
  ];
  const processRun = run(client, args, { input: true });
  await Promise.all([
    pipeline(fs.createReadStream(file), createGunzip(), processRun.child.stdin),
    processRun.completion,
  ]);
}

(async () => {
  assertSafe();
  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: dbPassword,
    ssl: getDbSslConfig(),
    multipleStatements: false,
  };
  const admin = await mysql.createConnection(config);
  const dumpFile = path.join(os.tmpdir(), `${rehearsalDb}.sql.gz`);
  let created = false;
  try {
    const source = await snapshot(admin, sourceDb);
    await admin.query(`CREATE DATABASE \`${rehearsalDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const compressedBytes = await dumpToFile(dumpFile);
    await restoreFromFile(dumpFile);
    const restored = await snapshot(admin, rehearsalDb);
    const checksumsMatch = requiredMigrations.every(name =>
      source.migrations[name] && source.migrations[name] === restored.migrations[name]);
    const countsMatch = JSON.stringify(source.counts) === JSON.stringify(restored.counts);
    const ok = source.tables === restored.tables && countsMatch && checksumsMatch;
    console.log(JSON.stringify({
      ok,
      sourceDatabase: sourceDb,
      temporaryDatabase: rehearsalDb,
      compressedBytes,
      source,
      restored,
      checksumsMatch,
      countsMatch,
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    if (created) await admin.query(`DROP DATABASE IF EXISTS \`${rehearsalDb}\``);
    await admin.end();
    try { fs.unlinkSync(dumpFile); } catch (_) {}
  }
})().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
