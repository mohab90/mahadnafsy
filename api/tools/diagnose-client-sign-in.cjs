#!/usr/bin/env node
'use strict';

/**
 * «العميل بيدخل بيظهرله تصفح الكورسات وهو أصلاً مشترك» (4 Nov 2026): why a signed-in client sees no course. READ-ONLY — nothing is written.
 *
 *   node tools/diagnose-client-sign-in.cjs                         # the counts: how many site accounts are in each situation
 *   node tools/diagnose-client-sign-in.cjs --email=name@mail.com   # one person: their login(s), the client record(s) with that e-mail or number, and the courses each holds
 *
 * The counts carry no names or contact details. The one-person report prints that person's own rows, so run it for a client you are helping.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const EMAIL = (process.argv.find(arg => arg.startsWith('--email=')) || '').slice('--email='.length).trim().toLowerCase();
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const HOLDS = "EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id = s.tenant_id AND e.subscriber_id = s.id AND e.status = 'active')";

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const one = async (sql, params = []) => (await db.query(sql, params))[0][0];

  if (!EMAIL) {
    const rows = [
      ['site accounts (active)', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1`],
      ['  with an e-mail still unproven', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1 AND u.email_unverified = 1`],
      ['  linked to a client record', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1 AND EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL)`],
      ['  linked to a record that holds NO course', `SELECT COUNT(*) n FROM users u JOIN subscribers s ON s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL WHERE u.tenant_id = ? AND u.is_active = 1 AND NOT ${HOLDS}`],
      ['    ...while another record with the same e-mail holds courses', `SELECT COUNT(DISTINCT u.id) n FROM users u JOIN subscribers s ON s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL JOIN subscribers t ON t.tenant_id = s.tenant_id AND t.id <> s.id AND t.deleted_at IS NULL AND t.email <> '' AND LOWER(TRIM(t.email)) = LOWER(TRIM(u.email)) WHERE u.tenant_id = ? AND u.is_active = 1 AND NOT ${HOLDS} AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id = t.tenant_id AND e.subscriber_id = t.id AND e.status = 'active')`],
      ['  linked to nobody', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1 AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL)`],
      ['    ...whose proven e-mail is a client that holds courses', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1 AND u.email_unverified = 0 AND u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.deleted_at IS NULL AND LOWER(TRIM(s.email)) = LOWER(TRIM(u.email)) AND ${HOLDS})`],
      ['    ...whose UNPROVEN e-mail is a client that holds courses', `SELECT COUNT(*) n FROM users u WHERE u.tenant_id = ? AND u.is_active = 1 AND u.email_unverified = 1 AND u.email IS NOT NULL AND EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.deleted_at IS NULL AND LOWER(TRIM(s.email)) = LOWER(TRIM(u.email)) AND ${HOLDS})`],
      ['active enrollments with no course (a track only)', `SELECT COUNT(*) n FROM enrollments e WHERE e.tenant_id = ? AND e.status = 'active' AND e.course_id IS NULL`],
      ['active enrollments already past their expiry', `SELECT COUNT(*) n FROM enrollments e WHERE e.tenant_id = ? AND e.status = 'active' AND e.expiry_date IS NOT NULL AND e.expiry_date < NOW()`],
    ];
    for (const [label, sql] of rows) console.log(label.padEnd(62), (await one(sql, [TENANT])).n);
    await db.end();
    return;
  }

  const [accounts] = await db.query('SELECT id, name, email, phone, email_unverified, is_active, created_at FROM users WHERE tenant_id = ? AND LOWER(TRIM(email)) = ?', [TENANT, EMAIL]);
  console.log(`site accounts with ${EMAIL}: ${accounts.length}`);
  for (const account of accounts) {
    console.log(`  ${account.id}  active=${account.is_active}  email ${Number(account.email_unverified) === 1 ? 'NOT PROVEN' : 'proven'}  phone=${account.phone || '—'}  created ${new Date(account.created_at).toISOString().slice(0, 10)}`);
    const [linked] = await db.query('SELECT s.id, s.client_code, s.name FROM subscribers s WHERE s.tenant_id = ? AND s.firebase_uid = ? AND s.deleted_at IS NULL', [TENANT, account.id]);
    console.log(linked.length ? `    linked to client ${linked.map(row => `${row.client_code} ${row.name}`).join(' | ')}` : '    linked to NO client record');
  }
  const phones = [...new Set(accounts.map(account => String(account.phone || '').replace(/\D/g, '')).filter(Boolean))];
  const [clients] = await db.query(
    `SELECT s.id, s.client_code, s.name, s.email, s.phone, s.firebase_uid, s.deleted_at,
            (SELECT COUNT(*) FROM enrollments e WHERE e.tenant_id = s.tenant_id AND e.subscriber_id = s.id AND e.status = 'active') AS active_courses,
            (SELECT COUNT(*) FROM enrollments e WHERE e.tenant_id = s.tenant_id AND e.subscriber_id = s.id AND e.status = 'active' AND e.expiry_date IS NOT NULL AND e.expiry_date < NOW()) AS past_expiry
       FROM subscribers s
      WHERE s.tenant_id = ? AND (LOWER(TRIM(s.email)) = ?${phones.length ? ' OR s.phone_digits IN (?)' : ''})`,
    [TENANT, EMAIL, ...(phones.length ? [phones] : [])]);
  console.log(`\nclient records with that e-mail or number: ${clients.length}`);
  for (const client of clients) {
    console.log(`  ${String(client.client_code || '').padEnd(10)} ${String(client.name || '').slice(0, 26).padEnd(26)} courses=${client.active_courses} (past expiry ${client.past_expiry})  ` +
      `${client.deleted_at ? 'DELETED  ' : ''}${client.firebase_uid ? `login=${client.firebase_uid}` : 'login=none'}`);
  }
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
