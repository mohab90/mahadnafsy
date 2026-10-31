#!/usr/bin/env node
'use strict';

/**
 * Before the emailed login code goes live: which accounts will be asked for it, and can it reach each of them?
 *
 *   node tools/login-code-readiness.cjs                          # the list; reads only, sends nothing
 *   node tools/login-code-readiness.cjs --send-test you@mail.com # also sends ONE test email through the live SMTP settings
 *   node tools/login-code-readiness.cjs --strict                 # exit 1 while any account has no usable address
 *
 * An account the policy names (lib/mfaPolicy.js) that has no real address cannot sign in once the code is on:
 * EMAIL_CODE_NO_EMAIL. «check» rows look right and are the owner's to confirm — somebody has to open each mailbox.
 * Reads the .env beside it, in a read-only transaction.
 */

const path = require('path');
const API_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(API_ROOT, '.env') });
const mysql = require('mysql2/promise');
const { classifyLoginEmail } = require(path.join(API_ROOT, 'lib', 'loginEmailReadiness.js'));
const { accountRequiresMfa, normalizeMfaPolicy } = require(path.join(API_ROOT, 'lib', 'mfaPolicy.js'));

const STRICT = process.argv.includes('--strict');
const testAt = process.argv.indexOf('--send-test');
const TEST_ADDRESS = testAt > -1 ? String(process.argv[testAt + 1] || '').trim() : '';
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const OWNERS = String(process.env.ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await db.query('SET SESSION TRANSACTION READ ONLY');
  const [[setting]] = await db.query(
    "SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section='security_mfa_policy' LIMIT 1", [TENANT]).catch(() => [[null]]);
  let stored = null;
  try { stored = setting?.config_json ? (typeof setting.config_json === 'string' ? JSON.parse(setting.config_json) : setting.config_json) : null; } catch { stored = null; }
  const policy = normalizeMfaPolicy(stored || {});

  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.is_active, s.role, s.permissions_json, s.is_active AS staff_active
       FROM users u
       LEFT JOIN staff s ON s.tenant_id = u.tenant_id AND s.email = u.email AND s.deleted_at IS NULL
      WHERE u.tenant_id = ?
        AND (s.id IS NOT NULL OR u.email IN (${OWNERS.length ? OWNERS.map(() => '?').join(',') : "''"}))`,
    [TENANT, ...OWNERS]);
  await db.end();

  const byEmail = new Map();
  for (const row of rows) {
    const key = String(row.email || '').trim().toLowerCase();
    if (key) byEmail.set(key, [...(byEmail.get(key) || []), row.name || row.id]);
  }

  const asked = rows.filter(row => row.is_active && accountRequiresMfa({ ...policy, enabled: true }, {
    isOwner: OWNERS.includes(String(row.email || '').trim().toLowerCase()),
    staff: row.role ? { role: row.role, permissions_json: row.permissions_json } : null,
  }));
  console.log(`كود الإيميل: ${policy.enabled ? 'مفعّل' : 'مقفول حالياً (الدخول بالإيميل والباصورد بس)'} | حسابات هتتطلب كود لو اتفعّل:${asked.length} من ${rows.length}\n`);

  const order = { missing: 0, invalid: 1, placeholder: 2, phone_like: 3, shared: 4, check: 5 };
  const report = asked.map(row => {
    const key = String(row.email || '').trim().toLowerCase();
    const others = (byEmail.get(key) || []).filter(name => name !== (row.name || row.id));
    return { row, ...classifyLoginEmail(row.email, { sharedWith: others }) };
  }).sort((a, b) => order[a.status] - order[b.status]);

  for (const { row, status, reason } of report) {
    console.log(`${status.padEnd(12)} ${String(row.role || (OWNERS.includes(String(row.email).toLowerCase()) ? 'owner' : '')).padEnd(24)} ${String(row.name || '').slice(0, 22).padEnd(22)} ${String(row.email || '—').padEnd(34)} ${reason}`);
  }
  const broken = report.filter(item => item.status !== 'check');
  console.log(`\nمحتاج تصليح: ${broken.length} | محتاج تأكيد إنهم بيفتحوا الإيميل: ${report.length - broken.length}`);

  if (TEST_ADDRESS) {
    const { sendEmail, getDeliveryHealth } = require(path.join(API_ROOT, 'lib', 'email.js'));
    try {
      const info = await sendEmail(TEST_ADDRESS, 'تجربة إرسال — كود الدخول', '<p>لو الرسالة دي وصلتك يبقى إرسال الإيميل شغال.</p>', { tenantId: TENANT });
      console.log(info?.suppressed
        ? '\nالإرسال متقفول بـEMAIL_OUTBOUND_CATEGORIES — مفيش رسالة اتبعتت'
        : `\nاتبعتت رسالة تجربة لـ${TEST_ADDRESS} (${info?.messageId || 'تم القبول من السيرفر'}). افتح الإيميل وتأكد إنها وصلت.`);
    } catch (error) {
      console.log(`\nفشل الإرسال: ${String(error.message || error).slice(0, 300)}`);
      console.log(getDeliveryHealth(TENANT));
      process.exitCode = 1;
    }
  }
  if (STRICT && broken.length) process.exitCode = 1;
  process.exit(process.exitCode || 0);
})().catch(error => { console.error(error.message); process.exit(2); });
