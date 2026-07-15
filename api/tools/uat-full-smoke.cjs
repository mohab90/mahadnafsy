#!/usr/bin/env node
'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { branchIdForBranch } = require('../lib/branches');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-default';

const results = [];
const ctx = {
  accounts: {},
  tokens: {},
  ids: {},
};

function mark(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function expect(name, fn) {
  try {
    const detail = await fn();
    mark(name, true, detail);
  } catch (e) {
    mark(name, false, e.message || e);
  }
}

async function api(path, { method = 'GET', token, body, expected = [200], headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(res.status)) {
    const snippet = typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400);
    throw new Error(`${method} ${path} -> ${res.status}; expected ${statuses.join('/')}; ${snippet}`);
  }
  return { status: res.status, data };
}

async function hashPassword() {
  return bcrypt.hash(PASSWORD, 12);
}

const staffAccounts = [
  ['admin', 'uat.admin@mahad.test', 'ADMIN', 'UAT Admin'],
  ['manager', 'uat.manager@mahad.test', 'MANAGER', 'UAT Manager'],
  ['online_manager', 'uat.online-manager@mahad.test', 'ONLINE_MANAGER', 'UAT Online Manager'],
  ['sales_collection_manager', 'uat.sales-manager@mahad.test', 'SALES_COLLECTION_MANAGER', 'UAT Sales Collection Manager'],
  ['sales', 'uat.sales@mahad.test', 'SALES', 'UAT Sales'],
  ['collection', 'uat.collection@mahad.test', 'COLLECTION', 'UAT Collection'],
  ['support_online', 'uat.support-online@mahad.test', 'SUPPORT', 'UAT Online Support'],
  ['support_daqqi', 'uat.support-daqqi@mahad.test', 'SUPPORT', 'UAT Dokki Support'],
  ['reception_daqqi', 'uat.reception-daqqi@mahad.test', 'RECEPTION_DAQQI', 'UAT Dokki Reception'],
  ['daqqi_manager', 'uat.daqqi-manager@mahad.test', 'DAQQI_MANAGER', 'UAT Dokki Manager'],
  ['hr_manager', 'uat.hr-manager@mahad.test', 'HR', 'UAT HR Manager'],
  ['recruiter', 'uat.recruiter@mahad.test', 'HR', 'UAT Recruiter'],
  ['accountant', 'uat.accountant@mahad.test', 'ACCOUNTANT', 'UAT Accountant'],
];

async function seedAccounts() {
  const hash = await hashPassword();
  for (const [key, email, role, name] of staffAccounts) {
    const userId = `uat-user-${key}`.slice(0, 100);
    const staffId = `uat-staff-${key}`.slice(0, 36);
    await pool.query(
      `INSERT INTO users (id, firebase_uid, email, password_hash, name, role, is_active)
       VALUES (?,?,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name), role=VALUES(role), is_active=1`,
      [userId, userId, email, hash, name, role.toLowerCase()]
    );
    await pool.query(
      `INSERT INTO staff
         (id, firebase_uid, name, email, phone, role, joined_at, is_active, tenant_id, totp_enabled, permissions_json)
       VALUES (?,?,?,?,?,?,NOW(),1,?,0,NULL)
       ON DUPLICATE KEY UPDATE
         firebase_uid=VALUES(firebase_uid), name=VALUES(name), phone=VALUES(phone),
         role=VALUES(role), is_active=1, tenant_id=VALUES(tenant_id),
         totp_enabled=0, permissions_json=NULL`,
      [staffId, userId, name, email, '01000000000', role, TENANT_ID]
    );
    ctx.accounts[key] = { email, role, name, userId, staffId };
  }

  const studentId = 'uat-student-client';
  const studentEmail = 'uat.student@mahad.test';
  await pool.query(
    `INSERT INTO users (id, firebase_uid, email, password_hash, name, role, is_active)
     VALUES (?,?,?,?,?,'user',1)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name), role='user', is_active=1`,
    [studentId, studentId, studentEmail, hash, 'UAT Student']
  );
  await pool.query(
    `INSERT INTO subscribers
       (id, firebase_uid, client_code, name, email, phone, tenant_id, branch, branch_id,
        assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       firebase_uid=VALUES(firebase_uid), name=VALUES(name), phone=VALUES(phone),
       tenant_id=VALUES(tenant_id), branch=VALUES(branch), branch_id=VALUES(branch_id),
       assigned_sales_id=VALUES(assigned_sales_id), assigned_sales_name=VALUES(assigned_sales_name),
       assigned_cs_id=VALUES(assigned_cs_id), assigned_cs_name=VALUES(assigned_cs_name)`,
    [
      studentId,
      studentId,
      'UAT-STUDENT',
      'UAT Student',
      studentEmail,
      '01099990000',
      TENANT_ID,
      'ONLINE_EGYPT',
      branchIdForBranch('ONLINE_EGYPT'),
      ctx.accounts.sales.staffId,
      ctx.accounts.sales.name,
      ctx.accounts.collection.staffId,
      ctx.accounts.collection.name,
    ]
  );
  ctx.accounts.student = { email: studentEmail, role: 'user', name: 'UAT Student', userId: studentId, subscriberId: studentId };
}

async function loginAll() {
  for (const [key, account] of Object.entries(ctx.accounts)) {
    const { data } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: account.email, password: PASSWORD },
    });
    if (!data?.token) throw new Error(`login returned no token for ${key}`);
    ctx.tokens[key] = data.token;
  }
}

async function findCourse() {
  const [[course]] = await pool.query(
    `SELECT id, title, price_egp FROM courses
      WHERE deleted_at IS NULL
      ORDER BY is_published DESC, created_at DESC
      LIMIT 1`
  ).catch(() => [[null]]);
  ctx.ids.courseId = course?.id || null;
  return course;
}

async function seedLeadViaPublicRegistration(course) {
  const suffix = Date.now().toString(36);
  const leadId = `uat-lead-${suffix}`;
  const email = `uat.client.${suffix}@mahad.test`;
  const phone = `0109${String(Date.now()).slice(-7)}`;
  const body = {
    id: leadId,
    name: `UAT Client ${suffix}`,
    email,
    phone,
    source: 'uat-public-registration',
    branch: 'ONLINE_EGYPT',
    leadType: 'COURSE',
    enrolledCourseId: course?.id || null,
    notes: 'UAT end-to-end smoke lead',
  };
  const { data } = await api('/api/registrations', { method: 'POST', body });
  if (!data?.ok || data.id !== leadId) throw new Error(`registration failed: ${JSON.stringify(data)}`);
  await pool.query(
    `UPDATE leads
        SET tenant_id=?, branch='ONLINE_EGYPT', branch_id=?,
            assigned_sales_id=?, assigned_sales_name=?,
            assigned_cs_id=?, assigned_cs_name=?,
            enrolled_course_id=COALESCE(?, enrolled_course_id),
            lead_type='COURSE', status='new'
      WHERE id=?`,
    [
      TENANT_ID,
      branchIdForBranch('ONLINE_EGYPT'),
      ctx.accounts.sales.staffId,
      ctx.accounts.sales.name,
      ctx.accounts.collection.staffId,
      ctx.accounts.collection.name,
      course?.id || null,
      leadId,
    ]
  );
  Object.assign(ctx.ids, { leadId, clientEmail: email, clientPhone: phone });
  return leadId;
}

async function convertLeadToSubscriber() {
  const { data } = await api(`/api/admin/leads/${ctx.ids.leadId}/convert`, {
    method: 'POST',
    token: ctx.tokens.sales,
    body: {},
  });
  if (!data?.ok || !data.subscriber_id) throw new Error(`convert failed: ${JSON.stringify(data)}`);
  ctx.ids.subscriberId = data.subscriber_id;

  const hash = await hashPassword();
  await pool.query(
    `UPDATE users SET password_hash=?, is_active=1 WHERE LOWER(TRIM(email))=?`,
    [hash, ctx.ids.clientEmail.toLowerCase()]
  );
  const [[sub]] = await pool.query(
    `SELECT id, tenant_id, branch, branch_id, assigned_sales_id, assigned_cs_id, lead_id
       FROM subscribers WHERE id=? LIMIT 1`,
    [ctx.ids.subscriberId]
  );
  if (!sub) throw new Error('subscriber not found after conversion');
  if (sub.tenant_id !== TENANT_ID) throw new Error(`subscriber tenant mismatch: ${sub.tenant_id}`);
  if (sub.branch !== 'ONLINE_EGYPT') throw new Error(`subscriber branch mismatch: ${sub.branch}`);
  if (!sub.branch_id) throw new Error('subscriber branch_id missing');
  if (sub.assigned_sales_id !== ctx.accounts.sales.staffId) throw new Error('sales assignment did not carry over');
  if (sub.assigned_cs_id !== ctx.accounts.collection.staffId) throw new Error('collection assignment did not carry over');
  return sub.id;
}

async function loginClient() {
  const { data } = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ctx.ids.clientEmail, password: PASSWORD },
  });
  if (!data?.token) throw new Error('client login returned no token');
  ctx.tokens.client = data.token;
}

async function createPayment(course) {
  const paymentId = `uat-pay-${Date.now().toString(36)}`;
  const amount = Number(course?.price_egp || 321) || 321;
  const { data } = await api('/api/admin/subscriber-payments', {
    method: 'POST',
    token: ctx.tokens.accountant,
    body: {
      subscriber_id: ctx.ids.subscriberId,
      payment: {
        id: paymentId,
        amount,
        currency: 'EGP',
        paymentType: 'COURSE',
        paymentMethod: 'cash',
        transactionId: `UAT-TXN-${Date.now()}`,
        status: 'paid',
        source: 'staff',
        staffId: ctx.accounts.accountant.staffId,
        staffName: ctx.accounts.accountant.name,
        courseId: course?.id || null,
        itemTitle: course?.title || 'UAT course payment',
        note: 'UAT payment journey',
      },
    },
  });
  if (!data?.ok) throw new Error(`payment endpoint failed: ${JSON.stringify(data)}`);
  ctx.ids.paymentId = paymentId;
  const [[pay]] = await pool.query(
    `SELECT id, status, tenant_id, branch, branch_id FROM payments WHERE id=? LIMIT 1`,
    [paymentId]
  );
  if (!pay || pay.status !== 'paid') throw new Error('paid payment row not found');
  if (pay.tenant_id !== TENANT_ID) throw new Error(`payment tenant mismatch: ${pay.tenant_id}`);
  if (!pay.branch_id) throw new Error('payment branch_id missing');
  const [[journal]] = await pool.query(
    `SELECT id, total_debit, total_credit FROM journal_entries WHERE ref_type='payment' AND ref_id=? LIMIT 1`,
    [paymentId]
  );
  if (!journal) throw new Error('payment journal entry missing');
  if (Number(journal.total_debit) !== Number(journal.total_credit)) throw new Error('payment journal is not balanced');
  return paymentId;
}

async function requestAndApproveRefund() {
  const { data: requestData } = await api('/api/me/refund-request', {
    method: 'POST',
    token: ctx.tokens.client,
    body: {
      payment_id: ctx.ids.paymentId,
      amount: 100,
      currency: 'EGP',
      reason: 'UAT refund request',
    },
  });
  if (!requestData?.ok || !requestData.id) throw new Error(`refund request failed: ${JSON.stringify(requestData)}`);
  ctx.ids.refundId = requestData.id;

  const { data: list } = await api('/api/admin/refund-requests', {
    token: ctx.tokens.accountant,
  });
  if (!Array.isArray(list) || !list.some((r) => r.id === ctx.ids.refundId)) {
    throw new Error('accountant cannot see refund request');
  }

  const { data: approved } = await api(`/api/admin/refund-requests/${ctx.ids.refundId}`, {
    method: 'PATCH',
    token: ctx.tokens.accountant,
    body: {
      status: 'APPROVED',
      admin_note: 'UAT approval',
      refund_method: 'cash',
    },
  });
  if (!approved?.ok) throw new Error(`refund approval failed: ${JSON.stringify(approved)}`);

  const [[pay]] = await pool.query(`SELECT status FROM payments WHERE id=? LIMIT 1`, [ctx.ids.paymentId]);
  if (pay?.status !== 'refunded') throw new Error(`payment status after refund is ${pay?.status}`);
  const [[audit]] = await pool.query(
    `SELECT id FROM payment_audit_log WHERE payment_id=? AND new_status='refunded' LIMIT 1`,
    [ctx.ids.paymentId]
  );
  if (!audit) throw new Error('refund payment audit row missing');
  const [[journal]] = await pool.query(
    `SELECT id, total_debit, total_credit FROM journal_entries WHERE ref_type='refund' AND ref_id=? LIMIT 1`,
    [ctx.ids.paymentId]
  );
  if (!journal) throw new Error('refund journal entry missing');
  if (Number(journal.total_debit) !== Number(journal.total_credit)) throw new Error('refund journal is not balanced');
}

async function transferToDaqqiAndCheckScope() {
  await pool.query(
    `UPDATE subscribers
        SET branch='DAQQI', branch_id=?, assigned_cs_id=?, assigned_cs_name=?
      WHERE id=?`,
    [
      branchIdForBranch('DAQQI'),
      ctx.accounts.reception_daqqi.staffId,
      ctx.accounts.reception_daqqi.name,
      ctx.ids.subscriberId,
    ]
  );
  const { data: daqqiClients } = await api('/api/staff/my-daqqi-clients', {
    token: ctx.tokens.reception_daqqi,
  });
  if (!Array.isArray(daqqiClients) || !daqqiClients.some((s) => s.id === ctx.ids.subscriberId)) {
    throw new Error('Dokki reception cannot see transferred client');
  }
  await api('/api/staff/my-daqqi-clients', {
    token: ctx.tokens.sales,
    expected: [403],
  });
}

async function checkCustomerService() {
  const { data: created } = await api('/api/me/tickets', {
    method: 'POST',
    token: ctx.tokens.client,
    body: {
      subject: 'UAT payment support',
      body: 'Need help with my refund',
      category: 'billing',
    },
  });
  if (!created?.id) throw new Error(`client ticket creation failed: ${JSON.stringify(created)}`);
  ctx.ids.ticketId = created.id;

  const { data: inbox } = await api('/api/admin/cs/inbox', {
    token: ctx.tokens.support_online,
  });
  if (!inbox?.tickets || !Array.isArray(inbox.tickets)) throw new Error('support inbox response invalid');
  if (!inbox.tickets.some((t) => t.id === ctx.ids.ticketId)) throw new Error('support inbox does not include client ticket');

  await api(`/api/admin/tickets/${ctx.ids.ticketId}/reply`, {
    method: 'POST',
    token: ctx.tokens.support_online,
    body: { body: 'UAT support reply' },
  });
  const [[ticket]] = await pool.query(
    `SELECT status, first_response_at FROM support_tickets WHERE id=? LIMIT 1`,
    [ctx.ids.ticketId]
  );
  if (!ticket?.first_response_at) throw new Error('ticket first_response_at was not set');
}

async function checkHrAndRecruiting() {
  const appId = `uat-join-${Date.now().toString(36)}`;
  await pool.query(
    `INSERT INTO join_us_applications
       (id, name, email, phone, specialty, experience, type, status, tenant_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status='NEW'`,
    [appId, 'UAT Recruit', `uat.recruit.${Date.now()}@mahad.test`, '01011112222', 'QA', 'UAT', 'EMPLOYEE', 'NEW', TENANT_ID]
  );
  const { data: joinRows } = await api('/api/admin/join-us', {
    token: ctx.tokens.recruiter,
  });
  if (!Array.isArray(joinRows) || !joinRows.some((r) => r.id === appId)) {
    throw new Error('recruiter cannot see join-us application');
  }
  await api(`/api/admin/join-us/${appId}`, {
    method: 'PATCH',
    token: ctx.tokens.recruiter,
    body: { status: 'REVIEWED', admin_note: 'UAT reviewed' },
  });
  await api('/api/admin/hr/employees', {
    token: ctx.tokens.hr_manager,
  });
  await api('/api/admin/hr/employees', {
    token: ctx.tokens.sales,
    expected: [403],
  });
}

async function checkRoleScopes() {
  const checks = [
    ['sales sees assigned lead/subscriber endpoint', 'sales', '/api/staff/subscribers', 200],
    ['collection sees assigned subscriber endpoint', 'collection', '/api/staff/subscribers', 200],
    ['support online can use CS inbox', 'support_online', '/api/admin/cs/inbox', 200],
    ['reception Dokki can see Dokki clients', 'reception_daqqi', '/api/staff/my-daqqi-clients', 200],
    ['daqqi manager can see Dokki clients', 'daqqi_manager', '/api/staff/my-daqqi-clients', 200],
    ['accountant can see finance refunds', 'accountant', '/api/admin/finance/refunds', 200],
    ['accountant can see chart of accounts', 'accountant', '/api/admin/accounting/chart-of-accounts', 200],
    ['support cannot access finance refunds', 'support_online', '/api/admin/finance/refunds', 403],
    ['sales cannot access HR employees', 'sales', '/api/admin/hr/employees', 403],
  ];
  for (const [name, roleKey, path, status] of checks) {
    await api(path, { token: ctx.tokens[roleKey], expected: [status] });
    mark(name, true, `${status}`);
  }
}

async function checkClientDashboardApis() {
  const endpoints = [
    '/api/auth/me',
    '/api/me/tickets',
  ];
  await api(endpoints[0], { token: ctx.tokens.client });
  await api(endpoints[1], { token: ctx.tokens.client });
}

async function main() {
  await expect('Health endpoint + DB', async () => {
    const { data } = await api('/api/health/detailed');
    if (data?.status !== 'ok' || !data?.db?.ok) throw new Error(JSON.stringify(data));
    return `rss=${data.rssMB}MB db=${data.db.ms}ms`;
  });

  await expect('Seed all UAT staff/user accounts', async () => {
    await seedAccounts();
    return `${Object.keys(ctx.accounts).length} roles`;
  });

  await expect('Login every employee role', async () => {
    await loginAll();
    return `${Object.keys(ctx.tokens).length} staff tokens`;
  });

  const course = await findCourse();
  await expect('Create public lead from website registration', async () => {
    const id = await seedLeadViaPublicRegistration(course);
    return id;
  });

  await expect('Sales converts lead to subscriber with tenant/branch/assignment scope', convertLeadToSubscriber);
  await expect('Client can login after conversion', loginClient);
  await expect('Accountant records paid payment and accounting journal', async () => createPayment(course));
  await expect('Client refund request + accountant approval transaction + refund journal', requestAndApproveRefund);
  await expect('Transfer client to Dokki and verify branch-scoped visibility', transferToDaqqiAndCheckScope);
  await expect('Client service ticket + support inbox + first response', checkCustomerService);
  await expect('Recruiter/HR workflow and blocked non-HR access', checkHrAndRecruiting);
  await expect('Role permission/scope smoke matrix', checkRoleScopes);
  await expect('Client dashboard core APIs', checkClientDashboardApis);

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== UAT FULL SMOKE SUMMARY ===');
  console.table(results.map((r) => ({ status: r.ok ? 'PASS' : 'FAIL', check: r.name, detail: r.detail })));
  if (failed.length) {
    console.error(`\n${failed.length} UAT checks failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll UAT checks passed.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch (_) {}
  });
