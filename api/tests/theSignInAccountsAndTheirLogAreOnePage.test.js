'use strict';
/**
 * «حسابات الدخول وسجل تسجيلات الدخول دول صفحتين … محتاجين ندمجهم في صفحة واحدة يظهر اسم العميل ورقمه ومرات
 * الدخول مع IP ويبقى في إجراءات والحالة، بس صلح الحالة لأن فيها أخطاء كتير … ضيف عمود IP الجهاز الحالة السبب»
 * (16 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const { reasonLabel, REASONS } = require('../lib/loginReasons');

test('every reason the sign-in routes write has an Arabic label, and an unknown one is shown, not hidden', () => {
  const written = new Set();
  for (const file of ['api/routes/auth/session.js', 'api/routes/auth/whatsappLogin.js', 'api/routes/auth/refreshAndTwoFactor.js']) {
    for (const match of read(file).matchAll(/failureReason(?::|\s*=)\s*'([a-z_]+)'/g)) written.add(match[1]);
    for (const match of read(file).matchAll(/'(wa_otp_invalid|device_limit)'/g)) written.add(match[1]);
  }
  assert.ok(written.size >= 7, `found ${[...written].join(', ')}`);
  for (const code of written) assert.ok(REASONS[code], `${code} has no Arabic label`);
  assert.equal(reasonLabel('wrong_password'), 'كلمة المرور غلط');
  assert.equal(reasonLabel('something_new'), 'something_new');
  assert.equal(reasonLabel(null), null);
});

test('the log keeps who was tried and where from, and tells the truth about the status', () => {
  const audit = read('api/lib/loginAudit.js');
  assert.match(audit, /getClientIp\(req\)/, 'the address is the connection\'s own, not a forwarded header the client can write');
  assert.doesNotMatch(audit, /x-forwarded-for/i);
  assert.match(audit, /\(tenant_id,user_id,email,phone,ip,user_agent,status,failure_reason\)/);

  const session = read('api/routes/auth/session.js');
  assert.match(session, /const tried = identifierIsEmail \? \{ email: logIdentifier \} : \{ phone: logIdentifier \}/, 'a number tried is filed as a number, not under e-mail');
  assert.doesNotMatch(session, /logLoginAttempt\(\{ email: logIdentifier/);
  // A sign-in the sharing guard then refuses is logged as refused, after its «نجح» row.
  for (const file of ['api/routes/auth/session.js', 'api/routes/auth/whatsappLogin.js']) {
    assert.match(read(file), /failureReason: 'sharing_limit_locked'/, `${file}: a sign-in refused after the password was right says so`);
  }
  const wa = read('api/routes/auth/whatsappLogin.js');
  assert.match(wa, /phone: req\.body\?\.phone, req, status: 'failed', failureReason/, 'a failed WhatsApp code has the number it was tried for');
  const twoFa = read('api/routes/auth/refreshAndTwoFactor.js');
  assert.match(twoFa, /failureReason: 'totp_invalid'/);
  assert.match(twoFa, /failureReason: 'recovery_code_invalid'/);
});

test('the accounts endpoint answers the page: counts from the log, the last attempt, the 2FA step told apart', () => {
  const routes = read('api/routes/misc/analytics.js');
  assert.match(routes, /Math\.max\(Number\(row\.login_count\) \|\| 0, Number\(c\.ok\) \|\| 0\)/, 'the count is not only the users column, which older sign-ins never reached');
  assert.match(routes, /SELECT MAX\(id\) FROM login_history WHERE tenant_id = \? AND user_id IN \(\?\) GROUP BY user_id/);
  assert.match(routes, /last_ip: last\?\.ip/);
  assert.match(routes, /function attemptState\(row, newerSameUser = \[\]\)/);
  assert.match(routes, /'\/api\/admin\/security\/accounts\/:id\/logins'/);
  assert.match(routes, /'\/api\/admin\/security\/accounts\/:id\/unlock'/);
  assert.match(routes, /LEFT JOIN users u ON u\.id = h\.user_id/, 'every attempt shows whose it was');
});

test('2FA: a password step the code completed is not left saying «waiting»', () => {
  const routes = read('api/routes/misc/analytics.js');
  const body = routes.slice(routes.indexOf('const TWO_FA_WINDOW_MS'), routes.indexOf('const shapeEvent'));
  const fn = new Function('', `${body.replace(/^function attemptState/m, 'function attemptState')}; return attemptState;`)();
  const t = minutes => new Date(Date.UTC(2026, 9, 16, 10, minutes)).toISOString();
  const pending = { status: '2fa_pending', created_at: t(0) };
  assert.equal(fn(pending, [{ status: '2fa_success', created_at: t(1) }]), 'done');
  assert.equal(fn(pending, [{ status: '2fa_success', created_at: t(30) }]), 'pending', 'a code half an hour later is another sign-in');
  assert.equal(fn(pending, []), 'pending');
  assert.equal(fn({ status: 'failed', created_at: t(0) }), 'failed');
  assert.equal(fn({ status: 'success', created_at: t(0) }), 'ok');
  assert.equal(fn({ status: '2fa_success', created_at: t(0) }), 'ok');
});

test('one page: the accounts with IP, device, status, reason and actions; the old second page is gone', () => {
  const panel = read('admin/pages/dashboard/tabs/client-db/LoginAccountsPanel.tsx');
  for (const heading of ['العميل', 'الرقم', 'مرات الدخول', 'IP', 'الجهاز', 'الحالة', 'السبب', 'إجراءات']) {
    assert.ok(panel.includes(`>${heading}</th>`), `column ${heading}`);
  }
  assert.match(panel, /فك الإيقاف/);
  assert.match(panel, /تعطيل/);
  assert.match(panel, /<LoginHistoryPanel \/>/, 'every attempt, including the unknown accounts, is the page\'s second mode');
  const tab = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.match(tab, /\['accounts', 'تسجيلات الدخول'\]/);
  assert.doesNotMatch(tab, /'logins'/, 'no separate log tab');
  assert.doesNotMatch(tab, /حسابات الدخول'\]/);
  const history = read('admin/pages/dashboard/tabs/client-db/LoginHistoryPanel.tsx');
  assert.match(history, /r\.reason_label/);
  assert.match(history, /STATE_META\[r\.state\]/);
});
