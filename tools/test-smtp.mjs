#!/usr/bin/env node
// SMTP diagnostic. Loads api/.env, verifies the SMTP connection/auth, and
// (optionally) sends a test email. Tells you exactly why sending fails.
//   node tools/test-smtp.mjs                 # verify connection only
//   node tools/test-smtp.mjs you@email.com   # also send a test message
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
apiRequire('dotenv').config({ path: join(ROOT, 'api', '.env') });
const nodemailer = apiRequire('nodemailer');
const { resolveSecret } = apiRequire('./lib/secretResolver');

const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
const port = parseInt(process.env.SMTP_PORT || '465');
const user = process.env.SMTP_USER || 'info@mahadnafsy.com';
const to = process.argv[2];
const password = resolveSecret('SMTP_PASS');

console.log(`SMTP: ${user} @ ${host}:${port} (secure=${port === 465})  pass=${password ? 'SET' : 'EMPTY'}`);
const mailer = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: password } });

try {
  await mailer.verify();
  console.log('✅ VERIFY OK — connection + auth succeeded. The mailbox can send.');
  if (to) {
    const info = await mailer.sendMail({ from: `"معهد الدراسات النفسية" <${user}>`, to, subject: 'اختبار SMTP — Mahad', html: '<p>لو وصلتك الرسالة دي يبقى الـSMTP شغّال ✅</p>' });
    console.log('✅ SENT —', info.messageId, '→', to);
  } else {
    console.log('ℹ️  pass an email arg to also send a test message.');
  }
} catch (e) {
  console.log('❌ FAILED:', e.message);
  if (/disabled by user|554/i.test(e.message)) console.log('   → السبب: المايل بوكس/الإرسال متعطّل من hPanel. فعّله من Emails في hPanel (أو استخدم مزود SMTP بديل).');
  else if (/auth|535|password/i.test(e.message)) console.log('   → السبب: يوزر/باسورد غلط. صحّح SMTP_USER/SMTP_PASS في api/.env.');
  else if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(e.message)) console.log('   → السبب: مشكلة شبكة/host. تأكد من SMTP_HOST/SMTP_PORT.');
  process.exitCode = 1;
}
