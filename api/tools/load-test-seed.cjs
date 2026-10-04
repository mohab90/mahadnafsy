#!/usr/bin/env node
'use strict';
/**
 * Fill a TEST database with a large, realistic CRM — for measuring how the
 * system behaves at the size the institute is growing to.
 *
 *   DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=<a test database> \
 *     node tools/load-test-seed.cjs --leads 500000 --clients 50000
 *
 * Everything is written under one tenant (default 'tenant-load') so it can be
 * measured and removed on its own: --clean deletes that tenant's rows.
 * Refuses to run against a database whose name does not contain "test", "load"
 * or "mahad" on localhost, so it cannot be pointed at production by accident.
 */
const mysql = require('mysql2/promise');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const TENANT = arg('tenant', 'tenant-load');
// Row ids are global primary keys, so a second seeded tenant needs its own prefix.
const P = arg('prefix', 'ld');
const LEADS = Number(arg('leads', 500000));
const CLIENTS = Number(arg('clients', 50000));
const REPS = Number(arg('reps', 60));
const COURSES = 40;
const BATCH = 4000;

const STATUSES = [['new', 18], ['contacted', 22], ['interested', 12], ['follow_up', 10], ['not_interested', 12], ['archived', 16], ['converted', 6], ['lost', 4]];
const SOURCES = ['facebook', 'website', 'whatsapp', 'instagram', 'referral', 'تسجيل دخول', 'manual', 'messenger'];
const BRANCHES = [['ONLINE_EGYPT', 'branch-online-egypt', 55], ['DAQQI', 'branch-daqqi', 25], ['ONLINE_SAUDI', 'branch-online-saudi', 10], ['TAGAMOA', 'branch-tagamoa', 6], ['ONLINE_ABROAD', 'branch-online-abroad', 4]];
const FIRST = ['محمد', 'أحمد', 'منى', 'سارة', 'نهى', 'ياسمين', 'مصطفى', 'علي', 'فاطمة', 'هبة', 'رانيا', 'إسلام', 'دعاء', 'مروة', 'خالد'];
const LAST = ['حسن', 'إبراهيم', 'عبد الله', 'سعيد', 'محمود', 'فؤاد', 'السيد', 'رمضان', 'عادل', 'جمال'];

let seed = 42;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = list => list[Math.floor(rand() * list.length)];
const weighted = list => {
  const total = list.reduce((s, item) => s + item[item.length - 1], 0);
  let roll = rand() * total;
  for (const item of list) { roll -= item[item.length - 1]; if (roll <= 0) return item; }
  return list[0];
};
const daysAgo = max => {
  const d = new Date(Date.UTC(2026, 9, 4) - Math.floor(rand() * max) * 86400000 - Math.floor(rand() * 86400000));
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const phone = n => `10${String(10000000 + n).padStart(8, '0')}`;

async function insert(conn, table, cols, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await conn.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ?`, [chunk]);
  }
}

async function main() {
  const db = process.env.DB_NAME || '';
  const host = process.env.DB_HOST || '127.0.0.1';
  if (!/test|load|mahad/i.test(db) || !['127.0.0.1', 'localhost'].includes(host)) {
    console.error(`refusing: ${host}/${db} — point DB_* at a local test database`);
    process.exit(2);
  }
  const conn = await mysql.createConnection({
    host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: db,
  });
  await conn.query('SET foreign_key_checks=0, unique_checks=0');
  const clean = async () => {
    for (const table of ['communications', 'enrollments', 'payments', 'subscribers', 'leads', 'courses', 'staff', 'tenants']) {
      await conn.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'}=?`, [TENANT]);
    }
  };
  if (process.argv.includes('--clean')) { await clean(); console.log('cleaned', TENANT); await conn.end(); return; }
  await clean();
  const started = Date.now();

  // Suspended, not active: the scheduled jobs walk every active tenant, and a
  // load tenant among them would send its 500k leads reminders and rescore them.
  await conn.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Load test', 'suspended')", [TENANT, TENANT]).catch(() => {});
  const reps = Array.from({ length: REPS }, (_, i) => [`${P}-rep-${i}`, TENANT, `مندوب ${i + 1}`, `rep${i}@load.test`, phone(9000000 + i),
    i < REPS - 8 ? 'SALES' : 'COLLECTION', 1, '2025-01-01', weighted(BRANCHES)[1]]);
  await insert(conn, 'staff', ['id', 'tenant_id', 'name', 'email', 'phone', 'role', 'is_active', 'joined_at', 'branch_id'], reps);
  const sales = reps.filter(r => r[5] === 'SALES');
  const courses = Array.from({ length: COURSES }, (_, i) => [`${P}-course-${i}`, TENANT, `كورس ${i + 1}`, '', '', '', '', 'GENERAL', 'RECORDED', 1500 + (i % 8) * 500]);
  await insert(conn, 'courses', ['id', 'tenant_id', 'title', 'description', 'short_description', 'instructor', 'thumbnail', 'category', 'type', 'price_egp'], courses);

  const leads = [];
  for (let i = 0; i < LEADS; i++) {
    const [status] = weighted(STATUSES);
    const [branch, branchId] = weighted(BRANCHES);
    const rep = rand() < 0.93 ? pick(sales) : null;
    const created = daysAgo(720);
    leads.push([`${P}-lead-${i}`, TENANT, `C${200000 + i}`, `${pick(FIRST)} ${pick(LAST)}`, rand() < 0.3 ? `lead${i}@load.test` : null,
      phone(i), pick(SOURCES), status, branch, branchId, rep?.[0] || null, rep?.[2] || null, created, created, 0,
      Math.floor(rand() * 100), rand() < 0.2 ? daysAgo(-30).slice(0, 10) : null]);
  }
  await insert(conn, 'leads', ['id', 'tenant_id', 'client_code', 'name', 'email', 'phone', 'source', 'status', 'branch', 'branch_id',
    'assigned_sales_id', 'assigned_sales_name', 'created_at', 'updated_at', 'hidden', 'score', 'next_follow_up_date'], leads);
  console.log(`leads ${LEADS} in ${Math.round((Date.now() - started) / 1000)}s`);

  const clients = [];
  for (let i = 0; i < CLIENTS; i++) {
    const lead = leads[i * Math.floor(LEADS / CLIENTS)];
    const collector = rand() < 0.4 ? pick(reps.filter(r => r[5] === 'COLLECTION')) : null;
    clients.push([`${P}-sub-${i}`, TENANT, lead[2], lead[3], lead[5], lead[4], lead[8], lead[9], lead[10], collector?.[0] || null, lead[12], 1, lead[0]]);
  }
  await insert(conn, 'subscribers', ['id', 'tenant_id', 'client_code', 'name', 'phone', 'email', 'branch', 'branch_id',
    'assigned_sales_id', 'assigned_cs_id', 'created_at', 'is_active', 'lead_id'], clients);

  const payments = []; const enrollments = [];
  clients.forEach((client, i) => {
    const course = courses[i % COURSES];
    const count = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const amount = 500 + Math.floor(rand() * 6) * 250;
      payments.push([`${P}-pay-${i}-${k}`, TENANT, client[0], course[0], amount, amount, 'EGP', 'COURSE', pick(['كاش', 'انستا باي', 'فودافون كاش 2020']),
        'paid', daysAgo(400).slice(0, 10), client[7], client[8], course[9]]);
    }
    enrollments.push([`${P}-enr-${i}`, TENANT, client[0], course[0], 'active', client[10]]);
  });
  await insert(conn, 'payments', ['id', 'tenant_id', 'subscriber_id', 'course_id', 'amount', 'amount_egp', 'currency', 'payment_type',
    'payment_method', 'status', 'date', 'branch_id', 'staff_id', 'course_expected'], payments);
  await insert(conn, 'enrollments', ['id', 'tenant_id', 'subscriber_id', 'course_id', 'status', 'enrolled_at'], enrollments);

  let comms = 0;
  for (let i = 0; i < LEADS; i += BATCH) {
    const rows = [];
    for (let j = i; j < Math.min(LEADS, i + BATCH); j++) {
      const n = Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        rows.push([`${P}-com-${j}-${k}`, TENANT, leads[j][0], pick(['CALL', 'WHATSAPP', 'NOTE']), daysAgo(300), 'متابعة', leads[j][10]]);
      }
    }
    comms += rows.length;
    await insert(conn, 'communications', ['id', 'tenant_id', 'lead_id', 'type', 'date', 'notes', 'staff_id'], rows);
  }
  await conn.query('SET foreign_key_checks=1, unique_checks=1');
  console.log(JSON.stringify({ tenant: TENANT, leads: LEADS, clients: CLIENTS, payments: payments.length, enrollments: enrollments.length,
    communications: comms, seconds: Math.round((Date.now() - started) / 1000) }));
  await conn.end();
}

main().catch(error => { console.error(error.message); process.exit(1); });
