#!/usr/bin/env node
'use strict';
/**
 * The rows the browser E2E specs need, in the original institute of a
 * throwaway database (CI's, or a local one): never run it against a database
 * that serves anyone.
 *
 *   - a staff administrator who signs in to the admin panel;
 *   - a published course with a free preview lecture and a paid one, and a
 *     student who has paid for it and is enrolled (the dashboard opens the
 *     paid lecture);
 *   - a second published course the student has not bought (the checkout);
 *   - two leads for the admin's leads list;
 *   - a Paymob configuration with placeholder keys, so the site offers card
 *     payment — the specs stop at the redirect to Paymob and never reach it.
 *
 * Idempotent: every row has a fixed id and is replaced on a second run.
 * Refuses to run when NODE_ENV=production or the database name does not look
 * disposable (contains "ci", "e2e", "test" or "local"), unless E2E_SEED_FORCE=1.
 *
 * Usage: DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… node api/tools/e2e-seed.cjs
 * The accounts it creates are printed, and are the e2e defaults (e2e/README.md).
 */
require('dotenv').config();

const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e.admin@mahad.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'MahadE2e#Admin2026';
const STUDENT_EMAIL = process.env.TEST_STUDENT_EMAIL || 'uat.student@mahad.test';
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD || 'MahadUat#2026';

const IDS = {
  adminUser: 'e2e-admin-user', adminStaff: 'e2e-admin-staff',
  studentUser: 'e2e-student-user', subscriber: 'e2e-student-sub',
  course: 'e2e-course-paid', chapter: 'e2e-chapter-1', lecture: 'e2e-lecture-1', paidLecture: 'e2e-lecture-2',
  checkoutCourse: 'e2e-course-checkout',
  enrollment: 'e2e-enrollment-1', payment: 'e2e-payment-1',
  leads: ['e2e-lead-1', 'e2e-lead-2'],
};

function refuseUnlessDisposable() {
  const name = String(process.env.DB_NAME || '');
  if (process.env.E2E_SEED_FORCE === '1') return;
  if (process.env.NODE_ENV === 'production' || !/(ci|e2e|test|local)/i.test(name)) {
    console.error(`[e2e-seed] refusing to seed "${name}": not a disposable database (set E2E_SEED_FORCE=1 to override)`);
    process.exit(2);
  }
}

async function seed(pool) {
  const { hash: hashPassword } = require('../lib/passwordHash');
  const { setTenantSetting } = require('../lib/tenantSettings');
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const studentHash = await hashPassword(STUDENT_PASSWORD);

  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version)
     VALUES (?, ?, ?, ?, 'مدير الاختبار', 'staff', 1, 1)
     ON DUPLICATE KEY UPDATE email=VALUES(email), password_hash=VALUES(password_hash), is_active=1, totp_enabled=0,
       sharing_locked_until=NULL`,
    [IDS.adminUser, TENANT, ADMIN_EMAIL, adminHash]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at)
     VALUES (?, ?, 'مدير الاختبار', ?, '1011119999', 'ADMIN', 1, '2025-01-01')
     ON DUPLICATE KEY UPDATE email=VALUES(email), role='ADMIN', is_active=1, deleted_at=NULL, totp_enabled=0`,
    [IDS.adminStaff, TENANT, ADMIN_EMAIL]);

  for (const [id, title, price] of [[IDS.course, 'كورس اختبار E2E المدفوع', 1500], [IDS.checkoutCourse, 'كورس اختبار E2E للشراء', 2400]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type,
                            price_egp, price_sar, price_usd, is_published, sort_order)
       VALUES (?, ?, ?, ?, 'كورس للاختبار الآلي', 'كورس للاختبار الآلي', 'فريق الاختبار', '', 'GENERAL', 'RECORDED', ?, 200, 50, 1, 0)
       ON DUPLICATE KEY UPDATE title=VALUES(title), price_egp=VALUES(price_egp), is_published=1, deleted_at=NULL`,
      [id, TENANT, id, title, price]);
  }
  await pool.query(
    `INSERT INTO course_chapters (id, course_id, title, sort_order) VALUES (?, ?, 'الفصل الأول', 1)
     ON DUPLICATE KEY UPDATE title=VALUES(title)`, [IDS.chapter, IDS.course]);
  // The first lecture of a course is the free preview (routes/public.js
  // getPreviewLimit); the second is the paid one, served only through the
  // enrolment-checked access endpoint.
  for (const [id, title, order] of [[IDS.lecture, 'المحاضرة الأولى في الاختبار', 1], [IDS.paidLecture, 'المحاضرة الثانية المدفوعة', 2]]) {
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, chapter_id, title, lecture_type, video_url, duration, duration_seconds,
                                    is_preview, sort_order, is_published)
       VALUES (?, ?, ?, ?, 'RECORDED', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '10:00', 600, 0, ?, 1)
       ON DUPLICATE KEY UPDATE title=VALUES(title), video_url=VALUES(video_url), sort_order=VALUES(sort_order), is_published=1`,
      [id, IDS.course, IDS.chapter, title, order]);
  }

  await pool.query(
    `INSERT INTO users (id, tenant_id, firebase_uid, email, password_hash, name, role, is_active, session_version)
     VALUES (?, ?, ?, ?, ?, 'طالبة الاختبار', 'user', 1, 1)
     ON DUPLICATE KEY UPDATE email=VALUES(email), password_hash=VALUES(password_hash), is_active=1,
       sharing_locked_until=NULL, active_session_id=NULL`,
    [IDS.studentUser, TENANT, IDS.studentUser, STUDENT_EMAIL, studentHash]);
  // Each browser context is a new device to lib/customerDevices.js; a rerun
  // starts the student with none (CI also raises CUSTOMER_MAX_DEVICES).
  await pool.query('DELETE FROM customer_devices WHERE tenant_id=? AND user_id=?', [TENANT, IDS.studentUser]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, firebase_uid, client_code, name, email, phone, branch, is_active, source, created_at)
     VALUES (?, ?, ?, 'E2E-STUDENT', 'طالبة الاختبار', ?, '01099990000', 'ONLINE_EGYPT', 1, 'e2e', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE firebase_uid=VALUES(firebase_uid), email=VALUES(email), is_active=1, deleted_at=NULL`,
    [IDS.subscriber, TENANT, IDS.studentUser, STUDENT_EMAIL]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, access_type, status, entitlement_source)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 'full', 'active', 'manual')
     ON DUPLICATE KEY UPDATE status='active', access_type='full', revoked_at=NULL`,
    [IDS.enrollment, TENANT, IDS.subscriber, IDS.course]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, amount_egp, payment_type, payment_method,
                           status, date, note, item_title, created_at)
     VALUES (?, ?, ?, ?, 1500, 'EGP', 1500, 'COURSE', 'cash', 'paid', CURDATE(), 'E2E seed', 'كورس اختبار E2E المدفوع', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE status='paid', deleted_at=NULL`,
    [IDS.payment, TENANT, IDS.subscriber, IDS.course]);

  for (const [index, id] of IDS.leads.entries()) {
    await pool.query(
      `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, assigned_sales_id, assigned_sales_name, created_at)
       VALUES (?, ?, ?, ?, 'فيسبوك', 'new', 0, ?, 'مدير الاختبار', UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE hidden=0, deleted_at=NULL, merged_into_lead_id=NULL`,
      [id, TENANT, `عميل اختبار E2E ${index + 1}`, `0109888000${index + 1}`, IDS.adminStaff]);
  }

  // Placeholder keys: enough for the site to offer card payment; the specs
  // intercept the call that would reach Paymob.
  await setTenantSetting('sys_payment_gateway', {
    active_provider: 'paymob',
    mode: 'sandbox',
    paymob: {
      enabled: true, api_key: 'e2e-placeholder-key', hmac_secret: 'e2e-placeholder-hmac',
      integration_id_card: '1', iframe_id: '1',
      webhook_url: 'http://127.0.0.1/api/webhooks/paymob', callback_url: '/success',
    },
  }, { tenantId: TENANT });
}

if (require.main === module) {
  refuseUnlessDisposable();
  const { pool } = require('../lib/db');
  seed(pool)
    .then(() => {
      console.log(`[e2e-seed] seeded ${process.env.DB_NAME}: admin ${ADMIN_EMAIL}, student ${STUDENT_EMAIL}, courses ${IDS.course} (enrolled) and ${IDS.checkoutCourse}`);
      return pool.end();
    })
    .catch(async (error) => {
      console.error('[e2e-seed] failed:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seed, IDS };
