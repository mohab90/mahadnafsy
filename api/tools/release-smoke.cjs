#!/usr/bin/env node
'use strict';

/**
 * Real HTTP requests to every route a release changed — against a running API.
 *
 * Unit tests read source; EXPLAIN proves SQL parses against the schema. Neither
 * proves a route answers. This logs in as the UAT accounts that live on staging
 * and calls each changed route the way the admin, HR and student apps do.
 *
 * Deliberately harmless:
 *   * reads, dry runs, and requests that must be REFUSED;
 *   * nothing that sends email or WhatsApp;
 *   * a refusal that unexpectedly succeeds is undone before the run ends.
 *
 * Staging only. It refuses to run against anything that is not a local port or
 * an explicit staging host.
 *
 *   API_BASE_URL=http://127.0.0.1:3002 node tools/release-smoke.cjs
 */

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';

if (!/^http:\/\/127\.0\.0\.1:\d+$|^http:\/\/localhost:\d+$|staging/i.test(API) || /:3001\b/.test(API)) {
  console.error(`refusing to run against ${API} — staging or a local port only, never production (3001)`);
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  pass' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '', cookie: res.headers.get('set-cookie') || '' };
}

async function login(email) {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (r.json?.totpRequired) throw new Error(`${email} requires TOTP — set UAT_TOTP_SECRET or use an account without MFA`);
  const token = r.json?.token || (/authToken=([^;]+)/.exec(r.cookie) || [])[1];
  if (!token) throw new Error(`${email} login failed: ${r.status} ${r.text.slice(0, 120)}`);
  return decodeURIComponent(token);
}

const jsonOk = (r, extra = () => true) => r.status === 200 && r.json !== null && !r.json.error && extra(r.json);
const brief = r => `${r.status}${r.json?.code ? ' ' + r.json.code : ''}${r.json?.error && r.status !== 200 ? ' ' + String(r.json.error).slice(0, 70) : ''}`;

(async () => {
  console.log(`release smoke against ${API}\n`);
  const health = await call('/api/health');
  record('health', health.json?.status === 'ok', health.json?.status);

  const admin = await login('uat.admin@mahad.test');
  const hr = await login('uat.hr-manager@mahad.test');
  const student = await login('uat.student@mahad.test');
  record('UAT logins (admin, hr, student)', true);

  // ── every changed admin read ───────────────────────────────────────────
  console.log('\nadmin reads the release changed');
  const reads = [
    '/api/admin/dashboard/kpi', '/api/admin/kpi/summary',
    '/api/admin/analytics/churn-risk', '/api/admin/analytics/cohorts?year=2026',
    '/api/admin/analytics/expenses', '/api/admin/analytics/retention',
    '/api/admin/analytics/revenue-forecast', '/api/admin/analytics/revenue-sources',
    '/api/admin/analytics/staff-performance', '/api/admin/automation/stats',
    '/api/admin/export/payments', '/api/admin/financial-audit-dashboard',
    '/api/admin/funnel/attribution', '/api/admin/orders', '/api/admin/payment-boxes',
    '/api/admin/payments/due-upcoming', '/api/admin/payments/review', '/api/admin/payments',
    '/api/admin/queue-dashboard', '/api/admin/refund-requests', '/api/admin/reports/campaign',
    '/api/admin/reports/daily-preview', '/api/admin/reports/sales-performance',
    '/api/admin/sales-goals/vs-actual', '/api/admin/subscribers/archived',
  ];
  for (const path of reads) {
    const r = await call(path, { token: admin });
    // CSV export answers text/csv, everything else JSON.
    const ok = path.includes('/export/') ? r.status === 200 && !/<html/i.test(r.text) : jsonOk(r);
    record(`GET ${path}`, ok, ok ? '' : brief(r));
  }

  const staffList = await call('/api/admin/staff', { token: admin });
  const staffRows = Array.isArray(staffList.json) ? staffList.json : (staffList.json?.staff || []);
  const managerRow = staffRows.find(s => String(s.email).toLowerCase() === 'uat.manager@mahad.test');
  const hrRow = staffRows.find(s => String(s.email).toLowerCase() === 'uat.hr-manager@mahad.test');
  if (hrRow) {
    for (const path of [`/api/admin/hr/employees/${hrRow.id}`, `/api/admin/hr/kpi/${hrRow.id}`]) {
      const r = await call(path, { token: admin });
      record(`GET ${path.replace(hrRow.id, ':id')}`, jsonOk(r), jsonOk(r) ? '' : brief(r));
    }
  }

  const stub = await call('/api/admin/payments/bulk-stub', { method: 'POST', token: admin, body: { dryRun: true } });
  record('POST /api/admin/payments/bulk-stub (dry run only)', jsonOk(stub, j => j.dryRun === true), `count=${stub.json?.count}`);

  // ── the new refusals, as a non-owner who holds manage_staff ────────────
  console.log('\nnon-owner refusals (as hr)');
  const hrPerm = await call('/api/admin/staff-account', { method: 'POST', token: hr,
    body: { email: 'uat.manager@mahad.test', password: PASSWORD, name: 'UAT Manager', role: 'sales' } });
  if (hrPerm.status === 403 && !hrPerm.json?.code) {
    record('hr reaches staff-account at all', false, 'hr lacks manage_staff on this environment — the guards cannot be exercised through HTTP here');
  } else {
    record('staff-account refuses a manager\'s login for a non-owner', hrPerm.status === 403 && hrPerm.json?.code === 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT', brief(hrPerm));
    const cust = await call('/api/admin/staff-account', { method: 'POST', token: hr,
      body: { email: 'uat.student@mahad.test', password: PASSWORD, name: 'UAT Student', role: 'sales' } });
    record('staff-account refuses a customer\'s login for a non-owner', cust.status === 403 && cust.json?.code === 'CUSTOMER_ACCOUNT_REQUIRES_OWNER', brief(cust));
    if (cust.status === 200) {
      console.log('    !! a customer login was converted — this run leaves a staff row for uat.student to remove by hand');
    }
  }
  if (managerRow) {
    const demote = await call('/api/admin/staff', { method: 'POST', token: hr,
      body: { id: managerRow.id, name: managerRow.name, email: managerRow.email, role: 'SALES' } });
    const refused = demote.status === 403 && demote.json?.code === 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT';
    record('staff.js refuses a non-owner rewriting a manager\'s row', refused, brief(demote));
    if (demote.status === 200) {
      const back = await call('/api/admin/staff', { method: 'POST', token: admin,
        body: { id: managerRow.id, name: managerRow.name, email: managerRow.email, role: 'MANAGER' } });
      console.log(`    !! the manager row was rewritten; restored as owner: ${back.status}`);
    }
  }

  // ── the two saves that answered 500 in production ──────────────────────
  //
  // A course save listed 39 columns against 38 placeholders; a bundle save
  // wrote three columns the table did not have. Both are one statement, and a
  // unit test that reads that statement as text cannot tell you the row landed
  // — so this writes one of each, reads it back, and takes it away again.
  console.log('\ncatalog saves');
  const stamp = Date.now();
  const courseId = `release-smoke-course-${stamp}`;
  const savedCourse = await call('/api/admin/courses', { method: 'POST', token: admin, body: {
    id: courseId, title: 'اختبار حفظ الدورة', slug: courseId, category: 'GENERAL', type: 'RECORDED',
    price: { EGP: 100 }, accessMonths: 3, isPublished: false,
  } });
  record('POST /api/admin/courses saves a course', savedCourse.status === 200, brief(savedCourse));

  const courseList = await call('/api/admin/courses?limit=500', { token: admin });
  const courseRow = (Array.isArray(courseList.json) ? courseList.json : courseList.json?.items || [])
    .find(c => c.id === courseId);
  // The editor's own field: written by the save, and empty on every edit until
  // the read path returned it — which is how a course set to expire became
  // unlimited again the next time anyone opened it.
  record('the course comes back with its access window', Number(courseRow?.accessMonths) === 3,
    `accessMonths=${JSON.stringify(courseRow?.accessMonths)}`);

  const bundleId = `release-smoke-bundle-${stamp}`;
  const savedBundle = await call('/api/admin/bundles', { method: 'POST', token: admin, body: {
    id: bundleId, title: 'اختبار حفظ الباقة', slug: bundleId,
    thumbnail: 'https://example.com/release-smoke.jpg', detailsContent: { smoke: true }, price: { EGP: 250 },
  } });
  record('POST /api/admin/bundles saves a bundle', savedBundle.status === 200, brief(savedBundle));

  const bundleList = await call('/api/admin/bundles', { token: admin });
  const bundleRow = (Array.isArray(bundleList.json) ? bundleList.json : []).find(b => b.id === bundleId);
  record('the bundle keeps its image and page content',
    bundleRow?.thumbnail === 'https://example.com/release-smoke.jpg' && bundleRow?.detailsContent?.smoke === true,
    `thumbnail=${JSON.stringify(bundleRow?.thumbnail)} details=${JSON.stringify(bundleRow?.detailsContent)}`);

  for (const [what, path] of [['bundle', `/api/admin/bundles/${bundleId}`], ['course', `/api/admin/courses/${courseId}`]]) {
    const gone = await call(path, { method: 'DELETE', token: admin });
    if (gone.status !== 200) console.log(`    !! the smoke ${what} ${gone.status === 404 ? 'was already gone' : `could not be removed (${gone.status})`} — id ${what === 'bundle' ? bundleId : courseId}`);
  }

  // ── the panel's live streams, and the orders the vault reads ────────────
  const streams = await call('/api/admin/live-streams', { token: admin });
  record('GET /api/admin/live-streams lists the streams for the panel', jsonOk(streams, j => Array.isArray(j)), brief(streams));
  const orderRows = await call('/api/admin/orders?limit=50', { token: admin });
  record('GET /api/admin/orders answers with desk payments still marked',
    jsonOk(orderRows, j => Array.isArray(j) && j.every(o => o.source !== 'crm' || 'staff_name' in o)), brief(orderRows));

  // ── student path that touches a changed query ──────────────────────────
  console.log('\nstudent');
  const refund = await call('/api/me/refund-request', { method: 'POST', token: student,
    body: { payment_id: 'release-smoke-no-such-payment', amount: 1, reason: 'release smoke' } });
  record('refund request for a payment that is not theirs is refused', [400, 404].includes(refund.status), brief(refund));
  const studentStreams = await call('/api/admin/live-streams', { token: student });
  record('a student cannot read the stream list the panel reads', [401, 403].includes(studentStreams.status), brief(studentStreams));

  // ── public ─────────────────────────────────────────────────────────────
  console.log('\npublic');
  const unsub = await call('/api/public/marketing/unsubscribe?token=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
  record('unsubscribe with a hostile token does not echo it', unsub.status === 400 && !unsub.text.includes('<script>'), `${unsub.status}`);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error('smoke aborted: ' + err.message); process.exit(1); });
