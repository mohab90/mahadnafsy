// A private copy of the panel's database at production scale — synthetic, no real person in it.
//
// «اشتغل علي السرعة وكل التابات وحسابات الأدوار»: the panel cannot be measured against the stand-in API
// (it returns the wrong shapes, so 33 tabs crash for reasons that are not the panel's) and the production
// backups hold real clients, which this machine must not copy. So: build the empty schema from api/schema.sql
// into a local MariaDB, fill it here, and run the real API against it.
//
//   mariadb-install-db --datadir=D:/audit_tmp/perf-db/data --password=...    (once)
//   mariadbd --datadir=... --port=3397                                         (running)
//   mysql ... mahad_perf < api/schema.sql                                      (once)
//   node tools/seed-synthetic-load.cjs [--scale=1]
//
// It refuses anything but 127.0.0.1 and a database called mahad_perf*, because the same script pointed at the
// tunnel on :3306 would write fake rows into production.
//
// How it fills: for each table it reads the columns from information_schema and writes only the ones that are
// NOT NULL without a default, plus the ones a table's recipe names; the rest keep their defaults. So a column
// added by a later migration does not break it.
const path = require('path');
const mysql = require(path.join(__dirname, '..', 'api', 'node_modules', 'mysql2', 'promise'));
const bcrypt = require(path.join(__dirname, '..', 'api', 'node_modules', 'bcryptjs'));

const arg = (name, fallback) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
const HOST = process.env.SEED_DB_HOST || '127.0.0.1';
const PORT = Number(process.env.SEED_DB_PORT || 3397);
const DB = process.env.SEED_DB_NAME || 'mahad_perf';
const SCALE = Number(arg('scale', '1'));
if (HOST !== '127.0.0.1' || !/^mahad_perf/.test(DB) || PORT === 3306) {
  console.error(`refusing: ${HOST}:${PORT}/${DB} is not a local mahad_perf database`);
  process.exit(1);
}
const T = 'tenant-default';
const PASSWORD = process.env.SEED_LOGIN_PASSWORD || 'Perf!Local1';

// Deterministic, so two runs build the same lab.
let state = 123456789;
const rnd = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
const pick = list => list[Math.floor(rnd() * list.length)];
const FIRST = ['أحمد', 'محمد', 'محمود', 'علي', 'عمر', 'يوسف', 'سارة', 'منى', 'نورا', 'هدى', 'آية', 'ريم', 'خالد', 'إبراهيم', 'مريم', 'ليلى'];
const FAMILY = ['السيد', 'عبد الله', 'حسن', 'النجار', 'العمري', 'سليمان', 'الشافعي', 'منصور', 'إسماعيل', 'فهمي'];
const person = () => `${pick(FIRST)} ${pick(FIRST)} ${pick(FAMILY)}`;
const phone = i => `010${String(10000000 + (i * 7919) % 89999999).padStart(8, '0')}`;
const daysAgo = (days, jitter = 0) => new Date(Date.now() - (days + rnd() * jitter) * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
const dateAgo = days => daysAgo(days).slice(0, 10);

let db;
const cache = {};
async function columnsOf(table) {
  if (cache[table]) return cache[table];
  const [rows] = await db.query(
    `SELECT COLUMN_NAME name, DATA_TYPE type, COLUMN_TYPE ctype, IS_NULLABLE nullable, COLUMN_DEFAULT def, EXTRA extra, CHARACTER_MAXIMUM_LENGTH maxlen
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [DB, table]);
  return (cache[table] = rows);
}
const enumValues = ctype => [...String(ctype).matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));

/** A value for a column nobody gave a recipe for: legal, not meaningful. */
function generic(col, i) {
  const t = col.type;
  if (t === 'enum') return enumValues(col.ctype)[0];
  if (/int|decimal|float|double/.test(t)) return 0;
  if (t === 'datetime' || t === 'timestamp') return daysAgo(30);
  if (t === 'date') return dateAgo(30);
  if (t === 'json') return '{}';
  if (/text|char/.test(t)) return /^(id|.*_id)$/.test(col.name) ? `${col.name}-${i}` : `x${i}`;
  return '';
}

/** Insert `n` rows of `table`. `recipe(i)` returns the columns it cares about; the required rest are filled generically. */
async function fill(table, n, recipe, { batch = 1500 } = {}) {
  n = Math.max(0, Math.round(n));
  if (!n) return;
  const cols = await columnsOf(table);
  const required = cols.filter(c => c.nullable === 'NO' && c.def === null && !/auto_increment|GENERATED/i.test(c.extra));
  const known = new Set(cols.map(c => c.name));
  const unknown = new Set();
  const started = Date.now();
  for (let from = 0; from < n; from += batch) {
    const rows = [];
    let names;
    for (let i = from; i < Math.min(n, from + batch); i++) {
      const row = {};
      for (const [name, value] of Object.entries(recipe(i) || {})) {
        if (known.has(name)) row[name] = value;
        else if (!unknown.has(name)) { unknown.add(name); console.log(`  (${table}: no column ${name}, skipped)`); }
      }
      for (const col of required) if (!(col.name in row)) row[col.name] = generic(col, i);
      names = names || Object.keys(row);
      rows.push(names.map(name => row[name]));
    }
    await db.query(`INSERT IGNORE INTO \`${table}\` (${names.map(x => `\`${x}\``).join(',')}) VALUES ?`, [rows]);
  }
  console.log(`${table.padEnd(28)} ${String(n).padStart(8)} rows  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const LEAD_STATUS = ['new', 'new', 'new', 'contacted', 'interested_booking', 'interested_followup', 'no_answer_wa', 'no_answer_nowa', 'not_interested', 'postpone_month', 'wrong_number', 'closed', 'converted'];
let branchOf;
const BRANCHES = ['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD', 'DAQQI'];
// What api/lib/branches.js branchIdForBranch() gives each branch; every real row carries it.
const BRANCH_ID = { ONLINE_EGYPT: 'branch-online-egypt', ONLINE_SAUDI: 'branch-online-saudi', ONLINE_ABROAD: 'branch-online-abroad', DAQQI: 'branch-daqqi' };
const SOURCES = ['facebook', 'website', 'whatsapp', 'instagram', 'referral', 'google'];

(async () => {
  db = await mysql.createConnection({ host: HOST, port: PORT, user: 'root', password: process.env.SEED_DB_PASSWORD || 'perf_root_local', database: DB, multipleStatements: false });
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  await db.query("SET SESSION sql_mode = ''");
  const t0 = Date.now();

  await fill('tenants', 1, () => ({ id: T, slug: 'default', name: 'معهد الدراسات النفسية' }));
  // Without an active subscription every feature-gated route answers 402, which is most of the panel.
  await fill('saas_plans', 1, () => ({ id: 'plan-perf', plan_key: 'enterprise', name: 'Perf', feature_limits_json: '{}' }));
  await fill('tenant_subscriptions', 1, () => ({ id: 'sub-perf', tenant_id: T, plan_id: 'plan-perf', status: 'active', starts_at: daysAgo(100), ends_at: daysAgo(-3000) }));
  await fill('branches', BRANCHES.length, i => ({ id: `br-${i}`, tenant_id: T, branch_key: BRANCHES[i], slug: BRANCHES[i].toLowerCase(), label: BRANCHES[i] }));

  // ── people who sign in: one account per role the panel has ─────────────────────────────────────────
  const hash = await bcrypt.hash(PASSWORD, 8);
  const STAFF = [
    ['admin', 'ADMIN'], ['manager', 'MANAGER'], ['sales1', 'SALES'], ['sales2', 'SALES'], ['sales3', 'SALES'], ['sales4', 'SALES'],
    ['collection1', 'COLLECTION'], ['collection2', 'COLLECTION'], ['support1', 'SUPPORT'], ['reception1', 'RECEPTION_DAQQI'],
    ['accountant1', 'ACCOUNTANT'], ['hr1', 'HR'], ['instructor1', 'INSTRUCTOR'], ['instructor2', 'INSTRUCTOR'],
  ];
  const staffColumns = (await columnsOf('staff')).map(c => c.name);
  const roleEnum = enumValues((await columnsOf('staff')).find(c => c.name === 'role').ctype);
  const staffRows = STAFF.filter(([, role]) => roleEnum.includes(role));
  await fill('users', staffRows.length, i => ({ id: `u-${staffRows[i][0]}`, tenant_id: T, email: `${staffRows[i][0]}@perf.test`, password_hash: hash, name: `${staffRows[i][0]} موظف`, role: staffRows[i][1] === 'ADMIN' ? 'admin' : staffRows[i][1].toLowerCase(), is_active: 1, phone: `2010000000${String(i).padStart(2, '0')}` }));
  await fill('staff', staffRows.length, i => ({
    id: `st-${staffRows[i][0]}`, tenant_id: T, name: `${staffRows[i][0]} موظف`, email: `${staffRows[i][0]}@perf.test`, phone: `2010000000${String(i).padStart(2, '0')}`,
    role: staffRows[i][1], joined_at: daysAgo(400), is_active: 1, ...(staffColumns.includes('firebase_uid') ? { firebase_uid: `u-${staffRows[i][0]}` } : {}),
  }));
  const salesIds = staffRows.map(([name, role]) => role === 'SALES' ? `st-${name}` : null).filter(Boolean);

  // A student: a customer sign-in, the client record behind it, three enrolments and a few lectures, for the portal.
  await fill('users', 1, () => ({ id: 'u-student1', tenant_id: T, email: 'student1@perf.test', password_hash: hash, name: 'طالب تجريبي', role: 'user', is_active: 1, phone: '201000000099' }));
  await fill('subscribers', 1, () => ({ id: 's-student1', tenant_id: T, firebase_uid: 'u-student1', client_code: 'CLT-STUDENT', name: 'طالب تجريبي', phone: '201000000099', email: 'student1@perf.test', branch: 'ONLINE_EGYPT', is_active: 1, created_at: daysAgo(40), updated_at: daysAgo(1) }));
  await fill('enrollments', 3, i => ({ id: `en-student-${i}`, tenant_id: T, subscriber_id: 's-student1', course_id: `c-${i}`, status: 'active', enrolled_at: daysAgo(30), access_type: 'FULL', progress_percent: 10 * (i + 1) }));
  await fill('course_lectures', 15, i => ({ id: `lec-${i}`, course_id: `c-${i % 3}`, title: `محاضرة ${i + 1}`, lecture_type: 'RECORDED', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: '00:20:00', duration_seconds: 1200, sort_order: i, is_published: 1 }));

  // ── the catalogue ──────────────────────────────────────────────────────────────────────────────────
  const COURSES = 25;
  await fill('courses', COURSES, i => ({ id: `c-${i}`, tenant_id: T, title: `دبلومة ${pick(FIRST)} ${i}`, description: 'وصف', short_description: 'وصف قصير', instructor: person(), thumbnail: 'https://h.top4top.io/p_3734xfq501.png', category: 'psychology', type: 'RECORDED', price_egp: 3000 + i * 100, price_sar: 400, price_usd: 100, is_published: 1, hours: 40, duration: '3 months' }));
  await fill('bundles', 7, i => ({ id: `b-${i}`, tenant_id: T, title: `مسار ${i}`, description: 'مسار', thumbnail: 'https://h.top4top.io/p_3734xfq501.png', price_egp: 9000, price_sar: 1200, price_usd: 300, is_published: 1 }));
  await fill('therapists', 13, i => ({ id: `t-${i}`, tenant_id: T, name: person(), specialty: 'علاج نفسي', image: 'https://h.top4top.io/p_3734xfq501.png', bio: 'نبذة', title: 'استشاري', experience: '10', rating: 4.8, price_egp: 500, is_active: 1 }));
  await fill('testimonials', 6, i => ({ id: `ts-${i}`, tenant_id: T, name: person(), text: 'تجربة ممتازة', rating: 5, is_active: 1 }));

  // ── the volume: what made the panel heavy ─────────────────────────────────────────────────────────
  const LEADS = 150000 * SCALE;
  await fill('leads', LEADS, i => {
    const rep = salesIds[i % salesIds.length];
    return {
      id: `l-${i}`, tenant_id: T, name: person(), phone: phone(i), email: `lead${i}@perf.test`, source: pick(SOURCES), status: pick(LEAD_STATUS),
      branch: (branchOf = pick(BRANCHES)), branch_id: BRANCH_ID[branchOf], interest_level: pick(['LOW', 'MEDIUM', 'HIGH']), lead_score: Math.floor(rnd() * 100), assigned_sales_id: rep, assigned_sales_name: rep.slice(3),
      notes: i % 3 === 0 ? 'تم التواصل' : '', created_at: daysAgo(i / 300, 3), updated_at: daysAgo(i / 400, 2),
      next_follow_up_date: i % 5 === 0 ? daysAgo(-Math.floor(rnd() * 7)) : null, interested_course_ids_json: JSON.stringify([`c-${i % COURSES}`]),
    };
  });
  const SUBS = 30000 * SCALE;
  await fill('subscribers', SUBS, i => ({
    id: `s-${i}`, tenant_id: T, client_code: `CLT-${1000 + i}`, name: person(), phone: phone(i + 500000), email: `client${i}@perf.test`, branch: (branchOf = pick(BRANCHES)), branch_id: BRANCH_ID[branchOf],
    assigned_cs_id: i % 4 === 0 ? 'st-collection1' : 'st-collection2', assigned_cs_name: 'collection', is_active: 1, created_at: daysAgo(i / 60, 2), updated_at: daysAgo(i / 80),
    crm_json: JSON.stringify({ clientStatus: pick(['active', 'active', 'active', 'finished', 'paused']), enrolledCourseIds: [`c-${i % COURSES}`], paymentHistory: [{ id: `p-${i}`, amount: 1000, currency: 'EGP', date: dateAgo(i / 80), status: 'collected' }] }),
    course_access_json: JSON.stringify({ [`c-${i % COURSES}`]: { granted: true } }),
  }));
  const ORDERS = 60000 * SCALE;
  await fill('orders', ORDERS, i => ({
    id: `o-${i}`, tenant_id: T, type: 'COURSE', item_id: `c-${i % COURSES}`, item_title: `دبلومة ${i % COURSES}`, amount: 1000 + (i % 30) * 100, currency: 'EGP', payment_method: pick(['CASH', 'CARD', 'TRANSFER']),
    customer_name: person(), customer_phone: phone(i + 500000), status: pick(['PAID', 'PAID', 'PAID', 'PENDING', 'REFUNDED']), subscriber_id: `s-${i % SUBS}`, created_at: daysAgo(i / 100, 2), paid_at: daysAgo(i / 100),
  }));
  await fill('payments', 40000 * SCALE, i => {
    const amount = 500 + (i % 10) * 100;
    const when = daysAgo(i / 100, 2);
    return {
      id: `pay-${i}`, tenant_id: T, subscriber_id: `s-${i % SUBS}`, amount, currency: 'EGP', amount_egp: amount, fx_rate_to_egp: 1, status: i % 12 === 0 ? 'REFUNDED' : 'PAID',
      payment_type: 'COURSE', course_id: `c-${i % COURSES}`, is_installment: i % 3 === 0 ? 1 : 0, date: when, created_at: when, item_title: `دبلومة ${i % COURSES}`,
    };
  });
  await fill('expenses', 4000, i => ({ id: `e-${i}`, tenant_id: T, title: `مصروف ${i}`, amount: 100 + (i % 50) * 10, category: 'other', created_at: daysAgo(i / 6, 1) }));
  await fill('consultations', 3000, i => ({ id: `con-${i}`, tenant_id: T, client_name: person(), client_phone: phone(i), therapist_id: `t-${i % 13}`, created_at: daysAgo(i / 8, 1) }));
  await fill('contact_messages', 2500, i => ({ id: `cm-${i}`, tenant_id: T, name: person(), email: `m${i}@perf.test`, phone: phone(i), message: 'رسالة', created_at: daysAgo(i / 8, 1) }));
  await fill('lead_timeline', 200000 * SCALE, i => ({ id: `lt-${i}`, tenant_id: T, lead_id: `l-${i % LEADS}`, created_at: daysAgo(i / 500, 1) }));
  await fill('activity_logs', 250000 * SCALE, i => ({ id: `al-${i}`, tenant_id: T, created_at: daysAgo(i / 800, 1) }));

  // ── HR: the pages that were slow ───────────────────────────────────────────────────────────────────
  await fill('job_postings', 3, i => ({ id: `job-${i}`, tenant_id: T, title: ['محاسب', 'مسؤول مبيعات', 'مدرب'][i], branch: 'daqqi', status: 'OPEN', created_at: daysAgo(30) }));
  await fill('join_us_applications', 1285 * SCALE, i => ({
    id: `ja-${i}`, tenant_id: T, name: person(), email: `ja${i}@perf.test`, phone: phone(i + 900000), specialty: 'تخصص', type: i % 2 ? 'INSTRUCTOR' : 'EMPLOYEE',
    status: pick(['NEW', 'NEW', 'REVIEWED', 'CONTACTED']), created_at: daysAgo(i / 5, 1), source_form: i % 2 ? 'teaching' : 'staff',
  }));
  const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
  await fill('job_applicants', 1500, i => ({
    id: `app-${i}`, tenant_id: T, job_id: `job-${i % 3}`, name: person(), email: `ap${i}@perf.test`, phone: phone(i + 800000), stage: pick(STAGES), specialty: 'تخصص',
    applicant_type: i % 2 ? 'INSTRUCTOR' : 'EMPLOYEE', source: 'website', created_at: daysAgo(i / 5, 1), interview_at: i % 4 === 0 ? `${dateAgo(-(i % 9) + 4)} 15:00:00` : null,
  }));
  await fill('support_tickets', 2000, i => ({ id: `tk-${i}`, tenant_id: T, subject: `تذكرة ${i}`, created_at: daysAgo(i / 10, 1) }));
  await fill('community_posts', 300, i => ({ id: `cp-${i}`, tenant_id: T, author_name: person(), title: `منشور ${i}`, content: 'نص', created_at: daysAgo(i / 3) }));

  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s. sign in as admin@perf.test / ${PASSWORD} (every account uses it)`);
  await db.end();
})().catch(error => { console.error(error); process.exit(1); });
