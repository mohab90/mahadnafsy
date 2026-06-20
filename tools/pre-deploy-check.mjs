#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// tools/pre-deploy-check.mjs — تحقق شامل قبل النشر الإنتاجي
// الاستخدام: node tools/pre-deploy-check.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'net';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const API    = join(ROOT, 'api');

// ── ANSI colors ──────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const BOLD = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0, warned = 0;

function ok(msg)   { console.log(`  ${G('✓')} ${msg}`); passed++; }
function fail(msg) { console.log(`  ${R('✗')} ${msg}`); failed++; }
function warn(msg) { console.log(`  ${Y('⚠')} ${msg}`); warned++; }
function section(title) { console.log(`\n${BOLD(B(`── ${title} `))}${'─'.repeat(50 - title.length)}`); }

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = join(API, '.env');
if (!existsSync(envPath)) {
  console.error(R('\n[FATAL] api/.env not found — cannot run pre-deploy checks\n'));
  process.exit(1);
}
const envContent = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

console.log(BOLD('\n╔════════════════════════════════════════════════════╗'));
console.log(BOLD('║   مهاد النفسي — Pre-Deploy Validation Check        ║'));
console.log(BOLD('╚════════════════════════════════════════════════════╝'));

// ══════════════════════════════════════════════════════════════════════════════
// 1. متغيرات البيئة الإلزامية
// ══════════════════════════════════════════════════════════════════════════════
section('1. متغيرات البيئة');

const REQUIRED = [
  { key: 'DB_HOST',      label: 'Database host' },
  { key: 'DB_USER',      label: 'Database user' },
  { key: 'DB_PASSWORD',  label: 'Database password' },
  { key: 'DB_NAME',      label: 'Database name' },
  { key: 'JWT_SECRET',   label: 'JWT secret' },
  { key: 'ADMIN_EMAILS', label: 'Admin emails' },
  { key: 'SMTP_HOST',    label: 'SMTP host' },
  { key: 'SMTP_USER',    label: 'SMTP user' },
  { key: 'SMTP_PASS',    label: 'SMTP password' },
];
const OPTIONAL = [
  { key: 'WA_INSTANCE_ID',     label: 'WhatsApp instance ID (Green-API)' },
  { key: 'WA_API_TOKEN',       label: 'WhatsApp API token' },
  { key: 'PAYMOB_API_KEY',     label: 'Paymob API key' },
  { key: 'PAYMOB_HMAC_SECRET', label: 'Paymob HMAC secret (payment verification)' },
  { key: 'GEMINI_API_KEY',     label: 'Gemini AI key (AI assistant)' },
  { key: 'ALLOWED_ORIGINS',    label: 'CORS allowed origins' },
];

for (const { key, label } of REQUIRED) {
  const v = env[key] || '';
  if (!v || v.startsWith('your_') || v === 'xxx') {
    fail(`${key} — ${label} غير مضبوط`);
  } else {
    ok(`${key} — مضبوط`);
  }
}
for (const { key, label } of OPTIONAL) {
  const v = env[key] || '';
  if (!v || v.startsWith('your_')) warn(`${key} — ${label} (اختياري لكن يُنصح به)`);
  else ok(`${key} — مضبوط`);
}

// JWT_SECRET طول كافٍ؟
const jwtLen = (env.JWT_SECRET || '').length;
if (jwtLen < 32) fail(`JWT_SECRET قصير جداً (${jwtLen} حرف — الحد الأدنى 32)`);
else if (jwtLen < 48) warn(`JWT_SECRET مقبول (${jwtLen} حرف) لكن يُفضل 48+`);
else ok(`JWT_SECRET طوله كافٍ (${jwtLen} حرف)`);

// NODE_ENV
if (env.NODE_ENV === 'production') ok('NODE_ENV=production');
else warn(`NODE_ENV=${env.NODE_ENV || 'غير مضبوط'} — يجب أن يكون production في الإنتاج`);

// ══════════════════════════════════════════════════════════════════════════════
// 2. الملفات الأساسية
// ══════════════════════════════════════════════════════════════════════════════
section('2. الملفات الأساسية');

const REQUIRED_FILES = [
  ['api/server.js',                     'نقطة دخول الـ API'],
  ['api/supervisor.js',                 'مدير العملية (Supervisor)'],
  ['api/lib/db.js',                     'اتصال قاعدة البيانات'],
  ['api/lib/helpers.js',                'مساعدات عامة'],
  ['api/lib/email.js',                  'إرسال البريد'],
  ['api/middleware/auth.js',            'middleware المصادقة'],
  ['api/middleware/rateLimits.js',      'rate limiting'],
  ['api/migrations/007_consolidated_runtime_schema.sql', 'Migration 007 (مطلوب قبل النشر)'],
  ['api/migrations/008_money_decimal_and_payroll_fix.sql', 'Migration 008 (مطلوب قبل النشر)'],
  ['tools/run-migrations.mjs',          'migration runner'],
  ['tools/mahad-quality-check.mjs',     'quality check tool'],
  ['DEPLOY.md',                         'دليل النشر'],
];

for (const [rel, label] of REQUIRED_FILES) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(`${rel} — ${label} مفقود`);
  else ok(`${rel} — موجود`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. package.json — التبعيات الأساسية
// ══════════════════════════════════════════════════════════════════════════════
section('3. التبعيات (package.json)');

const pkgPath = join(API, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const NEEDED = ['express', 'mysql2', 'bcryptjs', 'jsonwebtoken', 'helmet', 'cors', 'compression', 'dotenv'];
  for (const dep of NEEDED) {
    if (deps[dep]) ok(`${dep} — موجود (${deps[dep]})`);
    else fail(`${dep} — مفقود من package.json`);
  }
  if (!existsSync(join(API, 'node_modules'))) {
    warn('node_modules غير موجودة — شغّل npm install --production أولاً');
  } else {
    ok('node_modules — موجودة');
  }
} else {
  fail('api/package.json غير موجود');
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. فحص المنفذ (Port)
// ══════════════════════════════════════════════════════════════════════════════
section('4. فحص المنفذ');

const port = parseInt(env.PORT || '3001');
await new Promise(resolve => {
  const socket = createConnection({ port, host: '127.0.0.1' });
  socket.setTimeout(2000);
  socket.on('connect', () => {
    warn(`المنفذ ${port} مشغول — إما السيرفر شغال بالفعل أو منفذ آخر يستخدمه`);
    socket.destroy();
    resolve();
  });
  socket.on('error', () => {
    ok(`المنفذ ${port} متاح (السيرفر غير شغال حالياً)`);
    resolve();
  });
  socket.on('timeout', () => {
    ok(`المنفذ ${port} متاح (timeout — يعني حر)`);
    socket.destroy();
    resolve();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. بنية المجلدات
// ══════════════════════════════════════════════════════════════════════════════
section('5. بنية المجلدات');

const DIRS = [
  ['api/routes',     'مجلد routes'],
  ['api/lib',        'مجلد lib'],
  ['api/middleware', 'مجلد middleware'],
  ['api/migrations', 'مجلد migrations'],
  ['tools',          'مجلد tools'],
];
for (const [rel, label] of DIRS) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(`${rel} — ${label} مفقود`);
  else ok(`${rel} — موجود`);
}

// Admin dist build
const adminDist = join(ROOT, 'admin', 'dist');
if (!existsSync(adminDist)) warn('admin/dist/ غير موجود — شغّل: cd admin && npm run build');
else ok('admin/dist/ — موجود (build جاهز)');

// Client dist
const clientDist = join(ROOT, 'client', 'dist');
if (!existsSync(clientDist)) warn('client/dist/ غير موجود — شغّل: cd client && npm run build');
else ok('client/dist/ — موجود');

// ══════════════════════════════════════════════════════════════════════════════
// 6. ملفات الأمان
// ══════════════════════════════════════════════════════════════════════════════
section('6. الأمان');

// .env should NOT be committed
const gitignorePath = join(ROOT, '.gitignore');
if (existsSync(gitignorePath)) {
  const gi = readFileSync(gitignorePath, 'utf8');
  if (gi.includes('.env')) ok('.env مُدرج في .gitignore');
  else warn('.env غير مُدرج في .gitignore — خطر تسريب أسرار على Git');
}

// Check if .env contains placeholder values
const placeholders = Object.entries(env).filter(([, v]) => v.startsWith('your_') || v === 'xxx' || v === 'change_me');
if (placeholders.length > 0) {
  fail(`وُجدت قيم placeholder لم تُغيَّر: ${placeholders.map(([k]) => k).join(', ')}`);
} else {
  ok('لا توجد قيم placeholder في .env');
}

// ALLOWED_ORIGINS should not include localhost in production
if (env.NODE_ENV === 'production') {
  const origins = (env.ALLOWED_ORIGINS || '').split(',');
  const localhosts = origins.filter(o => o.includes('localhost') || o.includes('127.0.0.1'));
  if (localhosts.length > 0) fail(`ALLOWED_ORIGINS تحتوي على localhost في production: ${localhosts.join(', ')}`);
  else ok('ALLOWED_ORIGINS خالية من localhost (إنتاج)');
}

// ══════════════════════════════════════════════════════════════════════════════
// النتيجة الإجمالية
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(56));
console.log(BOLD(`  النتيجة النهائية:`));
console.log(`  ${G(`✓ ناجح: ${passed}`)}`);
if (warned > 0) console.log(`  ${Y(`⚠ تحذير: ${warned}`)}`);
if (failed > 0) console.log(`  ${R(`✗ فشل:   ${failed}`)}`);
console.log('═'.repeat(56));

if (failed > 0) {
  console.log(R('\n  ❌ النشر ليس آمناً — أصلح الأخطاء أعلاه أولاً\n'));
  process.exit(1);
} else if (warned > 0) {
  console.log(Y('\n  ⚠  النشر ممكن مع التحذيرات — راجعها قبل الإطلاق\n'));
  process.exit(0);
} else {
  console.log(G('\n  ✅ النظام جاهز للنشر الإنتاجي!\n'));
  process.exit(0);
}
