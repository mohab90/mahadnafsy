#!/usr/bin/env node
'use strict';

require('dotenv').config();

const bcrypt = require('../lib/passwordHash');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { branchIdForBranch } = require('../lib/branches');
const { saveMfaPolicy } = require('../lib/mfaPolicy');
const { generate } = require('otplib');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const TENANT_B_ID = 'tenant-uat-b';
const MFA_ENABLED = process.env.UAT_MFA_ENABLED === 'true';
const TOTP_SECRET = String(process.env.UAT_TOTP_SECRET || '');
if (MFA_ENABLED && TOTP_SECRET.length < 16) {
  throw new Error('UAT_TOTP_SECRET is required when UAT_MFA_ENABLED=true');
}

const results = [];
const ctx = {
  accounts: {},
  tokens: {},
  ids: {},
};

function mark(name, ok, detail = '', status = ok ? 'PASS' : 'FAIL') {
  results.push({ name, ok: !!ok, status, detail: String(detail || '') });
  const tag = status;
  console.log(`[${tag}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function expect(name, fn) {
  try {
    const detail = await fn();
    mark(name, true, detail);
    return true;
  } catch (e) {
    mark(name, false, e.message || e);
    return false;
  }
}

function skip(name, detail) {
  mark(name, false, detail, 'SKIP');
}

function summarize() {
  const failed = results.filter((result) => result.status === 'FAIL');
  const skipped = results.filter((result) => result.status === 'SKIP');
  console.log('\n=== UAT FULL SMOKE SUMMARY ===');
  console.table(results.map((result) => ({ status: result.status, check: result.name, detail: result.detail })));
  if (failed.length || skipped.length) {
    console.error(`\n${failed.length} UAT checks failed; ${skipped.length} skipped because prerequisites were unavailable.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll UAT checks passed.');
  }
}

async function api(path, { method = 'GET', token, body, expected = [200], headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(20_000),
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
  ['consultant', 'uat.consultant@mahad.test', 'CONSULTANT', 'UAT Consultant'],
  ['expert', 'uat.expert@mahad.test', 'EXPERT', 'UAT Expert'],
  ['trainer', 'uat.trainer@mahad.test', 'TRAINER', 'UAT Trainer'],
  ['instructor', 'uat.instructor@mahad.test', 'INSTRUCTOR', 'UAT Instructor'],
  ['other', 'uat.other@mahad.test', 'OTHER', 'UAT Other Staff'],
];

async function seedAccounts() {
  const hash = await hashPassword();
  for (const [key, email, role, name] of staffAccounts) {
    const userId = `uat-user-${key}`.slice(0, 100);
    const staffId = `uat-staff-${key}`.slice(0, 36);
    await pool.query(
      `INSERT INTO users
         (id, tenant_id, firebase_uid, email, password_hash, name, role, is_active, totp_secret, totp_enabled)
       VALUES (?,?,?,?,?,?,?,1,?,?)
       ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), password_hash=VALUES(password_hash),
         name=VALUES(name), role=VALUES(role), is_active=1,
         totp_secret=VALUES(totp_secret), totp_enabled=VALUES(totp_enabled)`,
      [userId, TENANT_ID, userId, email, hash, name, role.toLowerCase(),
        MFA_ENABLED ? TOTP_SECRET : null, MFA_ENABLED ? 1 : 0]
    );
    await pool.query(
      `INSERT INTO staff
         (id, firebase_uid, name, email, phone, role, joined_at, is_active, tenant_id,
          totp_secret, totp_enabled, permissions_json)
       VALUES (?,?,?,?,?,?,NOW(),1,?,?,?,NULL)
       ON DUPLICATE KEY UPDATE
         firebase_uid=VALUES(firebase_uid), name=VALUES(name), phone=VALUES(phone),
         role=VALUES(role), is_active=1, tenant_id=VALUES(tenant_id),
         totp_secret=VALUES(totp_secret), totp_enabled=VALUES(totp_enabled), permissions_json=NULL`,
      [staffId, userId, name, email, '01000000000', role, TENANT_ID,
        MFA_ENABLED ? TOTP_SECRET : null, MFA_ENABLED ? 1 : 0]
    );
    ctx.accounts[key] = { email, role, name, userId, staffId };
  }

  const studentId = 'uat-student-client';
  const studentEmail = 'uat.student@mahad.test';
  await pool.query(
    `INSERT INTO users (id, tenant_id, firebase_uid, email, password_hash, name, role, is_active)
     VALUES (?,?,?,?,?,?,'user',1)
     ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), password_hash=VALUES(password_hash),
       name=VALUES(name), role='user', is_active=1`,
    [studentId, TENANT_ID, studentId, studentEmail, hash, 'UAT Student']
  );
  await pool.query(
    `INSERT INTO subscribers
       (id, firebase_uid, client_code, name, email, phone, tenant_id, branch, branch_id,
        assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       firebase_uid=VALUES(firebase_uid), name=VALUES(name), phone=VALUES(phone),
       tenant_id=VALUES(tenant_id), branch=VALUES(branch), branch_id=VALUES(branch_id),
       assigned_sales_id=VALUES(assigned_sales_id), assigned_sales_name=VALUES(assigned_sales_name),
       assigned_cs_id=VALUES(assigned_cs_id), assigned_cs_name=VALUES(assigned_cs_name),
       source=VALUES(source)`,
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
      'uat-seed',
    ]
  );
  ctx.accounts.student = { email: studentEmail, role: 'user', name: 'UAT Student', userId: studentId, subscriberId: studentId };
  await saveMfaPolicy(TENANT_ID, { enabled: MFA_ENABLED }, 'uat-full-smoke');
}

async function loginAccount(account, headers = {}) {
  const { data } = await api('/api/auth/login', {
    method: 'POST',
    headers,
    body: { email: account.email, password: PASSWORD },
  });
  if (!data?.totpRequired) return data;
  if (!MFA_ENABLED) throw new Error(`unexpected MFA challenge for ${account.email}`);
  const verified = await api('/api/auth/2fa/verify', {
    method: 'POST',
    headers,
    body: { pendingToken: data.pendingToken, token: await generate({ secret: TOTP_SECRET }) },
  });
  return verified.data;
}

async function loginAll() {
  for (const [key, account] of Object.entries(ctx.accounts)) {
    const data = await loginAccount(account);
    if (!data?.token) throw new Error(`login returned no token for ${key}`);
    ctx.tokens[key] = data.token;
  }
}

async function checkTenantIsolation() {
  const hash = await hashPassword();
  const email = ctx.accounts.admin.email;
  const userId = 'uat-user-admin-tenant-b';
  const staffId = 'uat-staff-admin-tenant-b';
  const [[plan]] = await pool.query('SELECT id FROM saas_plans WHERE is_active=1 ORDER BY created_at LIMIT 1');
  if (!plan?.id) throw new Error('no active SaaS plan available for tenant B');

  await pool.query(
    `INSERT INTO tenants (id, slug, name, status, plan_key)
     VALUES (?,?,'UAT Tenant B','active','enterprise-local')
     ON DUPLICATE KEY UPDATE status='active', name=VALUES(name)`,
    [TENANT_B_ID, 'uat-tenant-b']
  );
  await pool.query(
    `INSERT INTO tenant_subscriptions
       (id, tenant_id, plan_id, status, starts_at, active_tenant_id)
     VALUES ('uat-subscription-b',?,?,'active',NOW(),?)
     ON DUPLICATE KEY UPDATE plan_id=VALUES(plan_id), status='active',
       starts_at=COALESCE(starts_at,NOW()), active_tenant_id=VALUES(active_tenant_id)`,
    [TENANT_B_ID, plan.id, TENANT_B_ID]
  );
  await pool.query(
    `INSERT INTO tenant_plans (tenant_id, plan_name)
     VALUES (?,'enterprise-local')
     ON DUPLICATE KEY UPDATE plan_name=VALUES(plan_name)`,
    [TENANT_B_ID]
  );
  await pool.query(
    `INSERT INTO users
       (id, tenant_id, firebase_uid, email, password_hash, name, role, is_active, totp_secret, totp_enabled)
     VALUES (?,?,?,?,?,?,'admin',1,?,?)
     ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), password_hash=VALUES(password_hash),
       name=VALUES(name), role='admin', is_active=1,
       totp_secret=VALUES(totp_secret), totp_enabled=VALUES(totp_enabled)`,
    [userId, TENANT_B_ID, userId, email, hash, 'UAT Tenant B Admin',
      MFA_ENABLED ? TOTP_SECRET : null, MFA_ENABLED ? 1 : 0]
  );
  await pool.query(
    `INSERT INTO staff
       (id, firebase_uid, name, email, phone, role, joined_at, is_active, tenant_id, totp_secret, totp_enabled)
     VALUES (?,?,?,?,'01000000000','ADMIN',NOW(),1,?,?,?)
     ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), firebase_uid=VALUES(firebase_uid),
       name=VALUES(name), role='ADMIN', is_active=1,
       totp_secret=VALUES(totp_secret), totp_enabled=VALUES(totp_enabled)`,
    [staffId, userId, 'UAT Tenant B Admin', email, TENANT_B_ID,
      MFA_ENABLED ? TOTP_SECRET : null, MFA_ENABLED ? 1 : 0]
  );
  await saveMfaPolicy(TENANT_B_ID, { enabled: MFA_ENABLED }, 'uat-full-smoke');

  const loginB = await loginAccount(
    { email },
    { 'X-Tenant-Id': TENANT_B_ID }
  );
  if (!loginB?.token) throw new Error('tenant B login returned no token');
  const payloadB = JSON.parse(Buffer.from(loginB.token.split('.')[1], 'base64url').toString('utf8'));
  if (payloadB.tid !== TENANT_B_ID || payloadB.uid !== userId) {
    throw new Error(`tenant B token scope mismatch: ${payloadB.tid}/${payloadB.uid}`);
  }

  const suffix = Date.now().toString(36);
  const { data: leadB } = await api('/api/registrations', {
    method: 'POST',
    headers: { 'X-Tenant-Id': TENANT_B_ID },
    body: {
      name: `Tenant B Lead ${suffix}`,
      email: `tenant-b.${suffix}@mahad.test`,
      phone: `0118${String(Date.now()).slice(-7)}`,
      source: 'uat-tenant-isolation',
      branch: 'ONLINE_EGYPT',
      leadType: 'COURSE',
    },
  });
  if (!leadB?.id) throw new Error('tenant B registration did not create a lead');

  const { data: tenantAList } = await api('/api/admin/leads?limit=100', {
    token: ctx.tokens.admin,
  });
  if (!Array.isArray(tenantAList) || tenantAList.some(row => row.id === leadB.id)) {
    throw new Error('tenant B lead leaked into tenant A list');
  }
  const { data: tenantBList } = await api('/api/admin/leads?limit=100', {
    token: loginB.token,
    headers: { 'X-Tenant-Id': TENANT_ID },
  });
  if (!Array.isArray(tenantBList) || !tenantBList.some(row => row.id === leadB.id)) {
    throw new Error('signed tenant B token did not remain scoped to tenant B');
  }
  await api('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Tenant-Id': 'tenant-does-not-exist' },
    body: { email, password: PASSWORD },
    expected: [400],
  });

  const [[sameEmail]] = await pool.query(
    'SELECT COUNT(*) count, COUNT(DISTINCT tenant_id) tenant_count FROM users WHERE email=?',
    [email]
  );
  if (Number(sameEmail?.count) < 2 || Number(sameEmail?.tenant_count) < 2) {
    throw new Error('same email was not isolated into two tenant accounts');
  }
  return `A/B isolated; tenant B lead=${leadB.id}`;
}

async function findCourse() {
  let [[course]] = await pool.query(
    `SELECT id, title, price_egp FROM courses
      WHERE tenant_id=? AND slug='uat-customer-journey' AND deleted_at IS NULL
      LIMIT 1`,
    [TENANT_ID]
  );
  if (!course) {
    const id = uuidv4();
    await pool.query(
      `INSERT IGNORE INTO courses
         (id,tenant_id,slug,title,description,short_description,instructor,thumbnail,
          category,type,price_egp,is_published)
       VALUES (?,?,'uat-customer-journey','UAT Customer Journey Course',
               'Release-candidate customer journey course','UAT journey','UAT Instructor','',
               'GENERAL','RECORDED',321,1)`,
      [id, TENANT_ID]
    );
    [[course]] = await pool.query(
      `SELECT id,title,price_egp FROM courses
        WHERE tenant_id=? AND slug='uat-customer-journey' AND deleted_at IS NULL LIMIT 1`,
      [TENANT_ID]
    );
  }
  if (!course) throw new Error('could not create the tenant-owned UAT course');
  await pool.query(
    `UPDATE courses SET price_sar=COALESCE(NULLIF(price_sar,0),25),
                        price_usd=COALESCE(NULLIF(price_usd,0),7)
      WHERE id=? AND tenant_id=?`,
    [course.id, TENANT_ID]
  );
  let [[lecture]] = await pool.query(
    `SELECT id FROM course_lectures
      WHERE course_id=? AND title='UAT Customer Journey Lecture' LIMIT 1`,
    [course.id]
  );
  if (!lecture) {
    const lectureId = uuidv4();
    await pool.query(
      `INSERT INTO course_lectures
         (id,course_id,title,lecture_type,video_url,duration,duration_seconds,is_published,sort_order)
       VALUES (?,?,'UAT Customer Journey Lecture','RECORDED','https://example.test/uat.mp4','01:00',60,1,1)`,
      [lectureId, course.id]
    );
    lecture = { id: lectureId };
  }
  ctx.ids.courseId = course.id;
  ctx.ids.lectureId = lecture.id;
  return { ...course, lectureId: lecture.id };
}

async function seedLeadViaPublicRegistration(course) {
  const suffix = Date.now().toString(36);
  const email = `uat.client.${suffix}@mahad.test`;
  const phone = `0109${String(Date.now()).slice(-7)}`;
  const body = {
    name: `UAT Client ${suffix}`,
    email,
    phone,
    source: 'uat-public-registration',
    branch: 'ONLINE_EGYPT',
    leadType: 'COURSE',
    enrolledCourseId: course?.id || null,
    utmSource: 'uat-search',
    utmMedium: 'cpc',
    utmCampaign: 'rc-customer-journey',
    notes: 'UAT end-to-end smoke lead',
  };
  const { data } = await api('/api/registrations', { method: 'POST', body });
  if (!data?.ok || !data.id) throw new Error(`registration failed: ${JSON.stringify(data)}`);
  const leadId = data.id;
  const { data: account } = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email,
      password: PASSWORD,
      name: body.name,
      phone,
      country: 'EG',
      interest: course.id,
    },
  });
  if (!account?.token) throw new Error('account registration returned no token');
  const [[lead]] = await pool.query(
    `SELECT tenant_id,branch,branch_id,assigned_sales_id,status,crm_json
       FROM leads WHERE id=? LIMIT 1`,
    [leadId]
  );
  const [duplicateRows] = await pool.query(
    `SELECT id FROM leads WHERE tenant_id=? AND
      (LOWER(TRIM(email))=? OR RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)=RIGHT(?,10))`,
    [TENANT_ID, email.toLowerCase(), phone]
  );
  let crm = {};
  try { crm = JSON.parse(lead?.crm_json || '{}'); } catch (_) {}
  if (duplicateRows.length !== 1) throw new Error(`registration created ${duplicateRows.length} lead rows`);
  if (lead?.tenant_id !== TENANT_ID || lead?.branch !== 'ONLINE_EGYPT' || !lead?.branch_id) {
    throw new Error('registration lost tenant or branch ownership');
  }
  if (lead?.assigned_sales_id !== ctx.accounts.sales.staffId) throw new Error('least-load sales assignment missing');
  if (lead?.status !== 'new') throw new Error(`unexpected lead status ${lead?.status}`);
  if (crm.enrolledCourseId !== course.id || crm.utmCampaign !== body.utmCampaign) {
    throw new Error('course/UTM attribution did not survive account registration');
  }
  const [[timeline]] = await pool.query(
    `SELECT COUNT(*) count FROM lead_timeline
      WHERE tenant_id=? AND lead_id=? AND event_type='created'`,
    [TENANT_ID, leadId]
  );
  if (Number(timeline?.count) !== 1) throw new Error('lead creation timeline is missing or duplicated');
  Object.assign(ctx.ids, { leadId, clientEmail: email, clientPhone: phone });
  return leadId;
}

async function convertLeadToSubscriber(course) {
  const { data } = await api(`/api/admin/leads/${ctx.ids.leadId}/convert`, {
    method: 'POST',
    token: ctx.tokens.sales,
    body: { courseId: course.id },
  });
  if (!data?.ok || !data.subscriber_id) throw new Error(`convert failed: ${JSON.stringify(data)}`);
  ctx.ids.subscriberId = data.subscriber_id;

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
  const [[prematureAccess]] = await pool.query(
    `SELECT COUNT(*) count FROM enrollments
      WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND status='active'`,
    [TENANT_ID, sub.id, course.id]
  );
  if (Number(prematureAccess?.count) !== 0) throw new Error('CRM conversion granted LMS access before payment');
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

async function rejectPrematureCertificate(course) {
  await api('/api/me/certificate-request', {
    method: 'POST',
    token: ctx.tokens.client,
    body: { courseId: course.id, type: 'OTHER', nationality: 'EGYPTIAN' },
    expected: [409],
  });
}

async function createCheckoutAndProof(course) {
  const checkoutBody = {
    itemId: course.id,
    itemType: 'course',
    itemTitle: 'Tampered browser title',
    customerName: `UAT Client`,
    customerEmail: ctx.ids.clientEmail,
    customerPhone: ctx.ids.clientPhone,
    amount: 1,
    currency: 'USD',
  };
  const first = await api('/api/public/checkout-intent', {
    method: 'POST',
    token: ctx.tokens.client,
    headers: { 'Idempotency-Key': `uat-${ctx.ids.leadId}` },
    body: checkoutBody,
  });
  const repeated = await api('/api/public/checkout-intent', {
    method: 'POST',
    token: ctx.tokens.client,
    headers: { 'Idempotency-Key': `uat-${ctx.ids.leadId}` },
    body: checkoutBody,
  });
  if (!first.data?.orderId || repeated.data?.orderId !== first.data.orderId) {
    throw new Error('checkout retry created a duplicate order');
  }
  const expectedAmount = Number(course.price_egp);
  if (Number(first.data.amount) !== expectedAmount || first.data.currency !== 'EGP') {
    throw new Error('checkout trusted the browser price/currency instead of the catalog');
  }
  ctx.ids.orderId = first.data.orderId;
  const intentKey = `uat-payment:${ctx.ids.orderId}`;
  const { data: intent } = await api('/api/me/payment-intents', {
    method: 'POST',
    token: ctx.tokens.client,
    headers: { 'Idempotency-Key': intentKey },
    body: { order_id: ctx.ids.orderId, provider: 'manual' },
    expected: [200, 201],
  });
  const { data: retriedIntent } = await api('/api/me/payment-intents', {
    method: 'POST',
    token: ctx.tokens.client,
    headers: { 'Idempotency-Key': intentKey },
    body: { order_id: ctx.ids.orderId, provider: 'manual' },
    expected: [200, 201],
  });
  if (!intent?.id || retriedIntent?.id !== intent.id) {
    throw new Error('payment intent is not idempotent');
  }
  ctx.ids.paymentIntentId = intent.id;
  const proofImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const { data: proof } = await api('/api/me/payment-proof', {
    method: 'POST',
    token: ctx.tokens.client,
    body: {
      order_id: ctx.ids.orderId,
      payment_intent_id: ctx.ids.paymentIntentId,
      payment_method: 'instapay',
      proof_image: proofImage,
      note: 'UAT customer journey proof',
    },
  });
  if (!proof?.id) throw new Error('payment proof was not persisted');
  if (proof.payment_intent_id !== ctx.ids.paymentIntentId || !proof.payment_attempt_id) {
    throw new Error('payment proof lost its intent/attempt identity');
  }
  ctx.ids.proofId = proof.id;
  return `${ctx.ids.orderId} / ${proof.id}`;
}

async function approveProofAndVerify(course) {
  await api(`/api/admin/payment-proofs/${ctx.ids.proofId}`, {
    method: 'PATCH',
    token: ctx.tokens.accountant,
    body: { action: 'approve', reviewer_note: 'UAT verified transfer' },
  });
  await api(`/api/admin/payment-proofs/${ctx.ids.proofId}`, {
    method: 'PATCH',
    token: ctx.tokens.accountant,
    body: { action: 'approve', reviewer_note: 'duplicate approval attempt' },
    expected: [409],
  });
  const paymentId = `proof-${ctx.ids.proofId}`;
  ctx.ids.paymentId = paymentId;
  ctx.ids.paymentAmount = Number(course.price_egp);
  const [[pay]] = await pool.query(
    `SELECT id, status, tenant_id, branch, branch_id FROM payments WHERE id=? LIMIT 1`,
    [paymentId]
  );
  if (!pay || pay.status !== 'paid') throw new Error('paid payment row not found');
  if (pay.tenant_id !== TENANT_ID) throw new Error(`payment tenant mismatch: ${pay.tenant_id}`);
  if (!pay.branch_id) throw new Error('payment branch_id missing');
  const [[intent]] = await pool.query(
    `SELECT pi.status,pi.payment_id,pa.status AS attempt_status,pa.payment_id AS attempt_payment_id
       FROM payment_intents pi
       JOIN payment_attempts pa ON pa.intent_id=pi.id AND pa.tenant_id=pi.tenant_id
      WHERE pi.id=? AND pi.tenant_id=? LIMIT 1`,
    [ctx.ids.paymentIntentId, TENANT_ID]
  );
  if (intent?.status !== 'paid' || intent?.attempt_status !== 'succeeded'
    || intent?.payment_id !== paymentId || intent?.attempt_payment_id !== paymentId) {
    throw new Error('payment intent/attempt did not settle with the canonical payment');
  }
  const [[journal]] = await pool.query(
    `SELECT id, total_debit, total_credit FROM journal_entries WHERE ref_type='payment' AND ref_id=? LIMIT 1`,
    [paymentId]
  );
  if (!journal) throw new Error('payment journal entry missing');
  if (Number(journal.total_debit) !== Number(journal.total_credit)) throw new Error('payment journal is not balanced');
  const [[invoice]] = await pool.query(
    `SELECT id,document_number,amount,currency FROM financial_documents
      WHERE tenant_id=? AND document_type='invoice' AND source_type='payment' AND source_id=? LIMIT 1`,
    [TENANT_ID, paymentId]
  );
  if (!invoice?.document_number?.startsWith('INV-')
    || Number(invoice.amount) !== ctx.ids.paymentAmount || invoice.currency !== 'EGP') {
    throw new Error('numbered payment invoice is missing or inconsistent');
  }
  ctx.ids.invoiceDocumentId = invoice.id;
  ctx.ids.invoiceNumber = invoice.document_number;
  const [[enrollment]] = await pool.query(
    `SELECT id,access_type,status FROM enrollments
      WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1`,
    [TENANT_ID, ctx.ids.subscriberId, course.id]
  );
  if (!enrollment || enrollment.status !== 'active' || enrollment.access_type !== 'full') {
    throw new Error('paid course did not create the canonical full entitlement');
  }
  const [[order]] = await pool.query(
    `SELECT status,subscriber_id,course_id,transaction_id FROM orders
      WHERE id=? AND tenant_id=? LIMIT 1`,
    [ctx.ids.orderId, TENANT_ID]
  );
  if (String(order?.status).toLowerCase() !== 'paid'
    || order?.subscriber_id !== ctx.ids.subscriberId
    || order?.course_id !== course.id
    || order?.transaction_id !== ctx.ids.proofId) {
    throw new Error('order/payment/customer/course linkage is incomplete');
  }
  return paymentId;
}

async function completeLearningAndVerifyCertificate(course) {
  const [lectures] = await pool.query(
    `SELECT id FROM course_lectures
      WHERE course_id=? AND is_published=1 ORDER BY sort_order,id`,
    [course.id]
  );
  if (!lectures.length) throw new Error('UAT course has no published lectures');
  let certCode = null;
  for (const lecture of lectures) {
    const { data } = await api('/api/me/progress', {
      method: 'PATCH',
      token: ctx.tokens.client,
      body: { lectureId: lecture.id, pct: 100, watchSeconds: 60 },
    });
    if (data?.certCode) certCode = data.certCode;
  }
  const { data: completions } = await api('/api/me/completions', { token: ctx.tokens.client });
  const completion = Array.isArray(completions)
    ? completions.find((row) => row.course_id === course.id && row.status === 'active')
    : null;
  certCode ||= completion?.certificate_code;
  if (!completion || !certCode) throw new Error('course completion/certificate was not issued');
  ctx.ids.completionId = completion.id;
  ctx.ids.certCode = certCode;

  const { data: verified } = await api(`/api/completions/verify/${encodeURIComponent(certCode)}`);
  if (verified?.certificate_code !== certCode || verified?.status !== 'active') {
    throw new Error('public certificate verification does not match the completion');
  }
  const { data: request } = await api('/api/me/certificate-request', {
    method: 'POST',
    token: ctx.tokens.client,
    body: {
      courseId: course.id,
      type: 'OTHER',
      nationality: 'EGYPTIAN',
      nameAr: 'عميل اختبار رحلة العميل',
      nameEn: 'Customer Journey UAT',
    },
  });
  if (!request?.id) throw new Error('eligible certificate request was not persisted');
  ctx.ids.certificateRequestId = request.id;

  const { data: timeline } = await api('/api/me/timeline', { token: ctx.tokens.client });
  const categories = new Set((timeline || []).map((event) => event.category));
  for (const category of ['order', 'payment', 'learning', 'certificate']) {
    if (!categories.has(category)) throw new Error(`customer timeline is missing ${category}`);
  }
  const { data: adminTimeline } = await api(
    `/api/staff/subscribers/${ctx.ids.subscriberId}/timeline`,
    { token: ctx.tokens.admin }
  );
  const { data: salesTimeline } = await api(
    `/api/staff/subscribers/${ctx.ids.subscriberId}/timeline`,
    { token: ctx.tokens.sales }
  );
  if (!adminTimeline.some((event) => event.category === 'payment' && Number(event.amount) > 0)) {
    throw new Error('admin timeline is missing financial journey detail');
  }
  if (salesTimeline.some((event) => Object.hasOwn(event, 'amount') || Object.hasOwn(event, 'currency'))) {
    throw new Error('non-finance staff timeline leaked payment values');
  }
  const [[cohort]] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS cohort_date
       FROM leads WHERE tenant_id=? AND id=? LIMIT 1`,
    [TENANT_ID, ctx.ids.leadId]
  );
  const cohortDate = cohort?.cohort_date;
  if (!cohortDate) throw new Error('lead cohort date could not be resolved from database truth');
  const { data: funnel } = await api(
    `/api/admin/funnel?from=${cohortDate}&to=${cohortDate}`,
    { token: ctx.tokens.admin }
  );
  const stages = new Map((funnel?.stages || []).map((stage) => [stage.key, Number(stage.value || 0)]));
  for (const stage of ['leads', 'paying', 'learners', 'certified']) {
    if (!stages.has(stage) || stages.get(stage) < 1) {
      throw new Error(`cohort funnel did not reflect the ${stage} stage`);
    }
  }
  return `${lectures.length} lecture(s), certificate=${certCode}`;
}

async function assertPaymobReservationIsDisabled() {
  const orderId = `uat-paymob-disabled-${Date.now()}`;
  const { data } = await api('/api/orders/reserve', {
    method: 'POST',
    expected: 503,
    body: {
      orderId,
      type: 'course',
      itemId: 'provider-review-pending',
      itemTitle: 'Must not persist while Paymob is disabled',
      amount: 1,
      currency: 'EGP',
      paymentMethod: 'paymob',
    },
  });
  if (data?.reason !== 'paymob_disabled') {
    throw new Error(`unexpected disabled-gateway response: ${JSON.stringify(data)}`);
  }
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM orders WHERE id=?',
    [orderId]
  );
  if (Number(row.total) !== 0) throw new Error('disabled Paymob reservation mutated the orders table');
  return '503 paymob_disabled; no order persisted';
}

async function requestAndApproveRefund() {
  const { data: requestData } = await api('/api/me/refund-request', {
    method: 'POST',
    token: ctx.tokens.client,
    body: {
      payment_id: ctx.ids.paymentId,
      amount: ctx.ids.paymentAmount,
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

  const { data: approved } = await api(`/api/admin/finance/refunds/${ctx.ids.refundId}`, {
    method: 'PUT',
    token: ctx.tokens.accountant,
    body: {
      status: 'APPROVED',
      notes: 'UAT approval',
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
  const [[creditNote]] = await pool.query(
    `SELECT document_number,related_document_id,amount,currency FROM financial_documents
      WHERE tenant_id=? AND document_type='credit_note'
        AND source_type='payment_refund' AND source_id=? LIMIT 1`,
    [TENANT_ID, ctx.ids.paymentId]
  );
  if (!creditNote?.document_number?.startsWith('CN-')
    || creditNote.related_document_id !== ctx.ids.invoiceDocumentId
    || Number(creditNote.amount) !== ctx.ids.paymentAmount || creditNote.currency !== 'EGP') {
    throw new Error('refund credit note is missing or not linked to the original invoice');
  }
  const [[enrollment]] = await pool.query(
    'SELECT status FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1',
    [TENANT_ID, ctx.ids.subscriberId, ctx.ids.courseId]
  );
  if (enrollment?.status !== 'revoked') throw new Error('refund did not revoke course access');
  const [[completion]] = await pool.query(
    'SELECT status FROM course_completions WHERE id=? AND tenant_id=? LIMIT 1',
    [ctx.ids.completionId, TENANT_ID]
  );
  if (completion?.status !== 'revoked') throw new Error('refund left a paid-only certificate active');
  const { data: revoked } = await api(
    `/api/completions/verify/${encodeURIComponent(ctx.ids.certCode)}`,
    { expected: [410] }
  );
  if (revoked?.valid !== false || revoked?.status !== 'revoked') {
    throw new Error('public verification did not expose certificate revocation');
  }
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
    token: ctx.tokens.collection,
  });
  if (!inbox?.tickets || !Array.isArray(inbox.tickets)) throw new Error('collection inbox response invalid');
  if (!inbox.tickets.some((t) => t.id === ctx.ids.ticketId)) {
    throw new Error('collection inbox does not include the client billing ticket');
  }
  const { data: supportInbox } = await api('/api/admin/cs/inbox', {
    token: ctx.tokens.support_online,
  });
  if (supportInbox?.tickets?.some((t) => t.id === ctx.ids.ticketId)) {
    throw new Error('technical support can see a collection-scoped billing ticket');
  }

  await api(`/api/admin/tickets/${ctx.ids.ticketId}/reply`, {
    method: 'POST',
    token: ctx.tokens.collection,
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
  for (const [key] of staffAccounts) {
    const { data: self } = await api('/api/staff/me', { token: ctx.tokens[key] });
    if (!self?.id || String(self.role || '').toUpperCase() !== ctx.accounts[key].role) {
      throw new Error(`${key} self profile is not linked to the seeded staff account`);
    }
    await api('/api/staff/me/hr', { token: ctx.tokens[key] });
    await api('/api/staff/me/schedule', { token: ctx.tokens[key] });
  }
  const checks = [
    ['admin can list staff', 'admin', '/api/admin/staff', 200],
    ['manager full access reaches finance', 'manager', '/api/admin/finance/refunds', 200],
    ['online manager sees tenant subscribers', 'online_manager', '/api/staff/subscribers', 200],
    ['online manager reaches academy courses', 'online_manager', '/api/admin/courses', 200],
    ['sales/collection manager sees all leads', 'sales_collection_manager', '/api/staff/leads', 200],
    ['sales/collection manager reaches finance', 'sales_collection_manager', '/api/admin/finance/refunds', 200],
    ['sales sees assigned lead/subscriber endpoint', 'sales', '/api/staff/subscribers', 200],
    ['sales sees assigned leads', 'sales', '/api/staff/leads', 200],
    ['sales sees assigned orders', 'sales', '/api/admin/orders', 200],
    ['collection sees assigned subscriber endpoint', 'collection', '/api/staff/subscribers', 200],
    ['collection reaches assigned finance', 'collection', '/api/admin/payments', 200],
    ['collection sees assigned orders', 'collection', '/api/admin/orders', 200],
    ['support online can use CS inbox', 'support_online', '/api/admin/cs/inbox', 200],
    ['support sees assigned subscribers', 'support_online', '/api/staff/subscribers', 200],
    ['support sees assigned orders read-only', 'support_online', '/api/admin/orders', 200],
    ['reception Dokki can see Dokki clients', 'reception_daqqi', '/api/staff/my-daqqi-clients', 200],
    ['reception sees Dokki orders', 'reception_daqqi', '/api/admin/orders', 200],
    ['daqqi manager can see Dokki clients', 'daqqi_manager', '/api/staff/my-daqqi-clients', 200],
    ['daqqi manager reaches branch finance', 'daqqi_manager', '/api/admin/payments', 200],
    ['HR can list employees', 'hr_manager', '/api/admin/hr/employees', 200],
    ['accountant can see finance refunds', 'accountant', '/api/admin/finance/refunds', 200],
    ['accountant can see chart of accounts', 'accountant', '/api/admin/accounting/chart-of-accounts', 200],
    ['accountant can see tenant orders', 'accountant', '/api/admin/orders', 200],
    ['consultant reaches consultation calendar', 'consultant', '/api/admin/consultations/calendar', 200],
    ['consultant sees assigned subscribers', 'consultant', '/api/staff/subscribers', 200],
    ['expert reaches course catalogue', 'expert', '/api/admin/courses', 200],
    ['expert cannot access finance refunds', 'expert', '/api/admin/finance/refunds', 403],
    ['trainer reaches course workspace', 'trainer', '/api/admin/courses', 200],
    ['instructor reaches course workspace', 'instructor', '/api/admin/courses', 200],
    ['other staff cannot access course administration', 'other', '/api/admin/courses', 403],
    ['support cannot access finance refunds', 'support_online', '/api/admin/finance/refunds', 403],
    ['sales cannot access HR employees', 'sales', '/api/admin/hr/employees', 403],
    ['accountant cannot access HR employees', 'accountant', '/api/admin/hr/employees', 403],
    ['HR cannot access finance refunds', 'hr_manager', '/api/admin/finance/refunds', 403],
    ['HR cannot access orders', 'hr_manager', '/api/admin/orders', 403],
    ['reception cannot access HR employees', 'reception_daqqi', '/api/admin/hr/employees', 403],
    ['trainer cannot access finance refunds', 'trainer', '/api/admin/finance/refunds', 403],
    ['instructor cannot access finance refunds', 'instructor', '/api/admin/finance/refunds', 403],
  ];
  for (const [name, roleKey, path, status] of checks) {
    await api(path, { token: ctx.tokens[roleKey], expected: [status] });
    mark(name, true, `${status}`);
  }
}

async function checkClientDashboardApis() {
  await api('/api/auth/me', { token: ctx.tokens.client });
  await api('/api/me/tickets', { token: ctx.tokens.client });
  const { data: subscriber } = await api('/api/me/subscriber', { token: ctx.tokens.client });
  if (subscriber?.id !== ctx.ids.subscriberId) {
    throw new Error('Client portal did not resolve the journey subscriber');
  }
  if (!Array.isArray(subscriber.paymentHistory)) {
    throw new Error('Client portal paymentHistory contract is missing');
  }
  const journeyPayment = subscriber.paymentHistory.find(payment => payment.id === ctx.ids.paymentId);
  if (!journeyPayment || journeyPayment.status !== 'refunded') {
    throw new Error('Client portal does not reflect the canonical refunded payment');
  }
  if (journeyPayment.courseId !== ctx.ids.courseId || Number(journeyPayment.courseExpected) <= 0) {
    throw new Error('Client portal payment is missing the linked course or expected amount');
  }
  if (journeyPayment.invoiceNumber !== ctx.ids.invoiceNumber) {
    throw new Error('Client portal payment is missing the immutable invoice number');
  }
  return `${subscriber.paymentHistory.length} payment(s), canonical refund visible`;
}

async function main() {
  const healthReady = await expect('Health endpoint + DB', async () => {
    const { data } = await api('/api/health/detailed');
    if (data?.status !== 'ok' || !data?.db?.ok) throw new Error(JSON.stringify(data));
    return `rss=${data.rssMB}MB db=${data.db.ms}ms`;
  });
  const dependentChecks = [
    'Seed all UAT staff/user accounts',
    'Login every employee role',
    'Tenant A/B identity, token and CRM data isolation',
    'Create public lead from website registration',
    'Sales converts lead to subscriber with tenant/branch/assignment scope',
    'Client can login after conversion',
    'Paymob remains fail-closed without mutating orders',
    'Certificate is blocked before payment and course completion',
    'Client creates server-priced idempotent order and payment proof',
    'Accountant approves proof with payment, journal and enrollment',
    'Learning progress creates a verifiable completion and unified timeline',
    'Refund reverses finance, access and paid-only certificate eligibility',
    'Transfer client to Dokki and verify branch-scoped visibility',
    'Client service ticket + support inbox + first response',
    'Recruiter/HR workflow and blocked non-HR access',
    'Role permission/scope smoke matrix',
    'Client dashboard core APIs',
  ];
  if (!healthReady) {
    dependentChecks.forEach(name => skip(name, 'Requires a reachable UAT API and MySQL database'));
    summarize();
    return;
  }

  const seeded = await expect('Seed all UAT staff/user accounts', async () => {
    await seedAccounts();
    return `${Object.keys(ctx.accounts).length} roles`;
  });
  if (!seeded) {
    dependentChecks.slice(1).forEach(name => skip(name, 'Requires successful UAT account seeding'));
    summarize();
    return;
  }

  const loggedIn = await expect('Login every employee role', async () => {
    await loginAll();
    return `${Object.keys(ctx.tokens).length} staff tokens`;
  });
  if (!loggedIn) {
    dependentChecks.slice(2).forEach(name => skip(name, 'Requires successful login for every UAT role'));
    summarize();
    return;
  }
  await expect('Tenant A/B identity, token and CRM data isolation', checkTenantIsolation);

  let course;
  const courseReady = await expect('Locate a UAT course', async () => {
    course = await findCourse();
    return course.id;
  });
  if (!courseReady) {
    dependentChecks.slice(3).forEach(name => skip(name, 'Requires a UAT course'));
    summarize();
    return;
  }
  await expect('Create public lead from website registration', async () => {
    const id = await seedLeadViaPublicRegistration(course);
    return id;
  });

  await expect('Sales converts lead without granting pre-payment LMS access', async () => convertLeadToSubscriber(course));
  await expect('Client can login after conversion', loginClient);
  await expect('Paymob remains fail-closed without mutating orders', assertPaymobReservationIsDisabled);
  await expect('Certificate is blocked before payment and course completion', async () => rejectPrematureCertificate(course));
  await expect('Client creates server-priced idempotent order and payment proof', async () => createCheckoutAndProof(course));
  await expect('Accountant approves proof with payment, journal and enrollment', async () => approveProofAndVerify(course));
  await expect('Learning progress creates a verifiable completion and unified timeline', async () => completeLearningAndVerifyCertificate(course));
  await expect('Refund reverses finance, access and paid-only certificate eligibility', requestAndApproveRefund);
  await expect('Transfer client to Dokki and verify branch-scoped visibility', transferToDaqqiAndCheckScope);
  await expect('Client service ticket + support inbox + first response', checkCustomerService);
  await expect('Recruiter/HR workflow and blocked non-HR access', checkHrAndRecruiting);
  await expect('Role permission/scope smoke matrix', checkRoleScopes);
  await expect('Client dashboard core APIs', checkClientDashboardApis);

  summarize();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch (_) {}
  });
