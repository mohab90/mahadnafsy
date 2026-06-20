# دليل نشر مهاد النفسي — الإنتاج

## متطلبات السيرفر
- Node.js 20+ (يُوصى بـ 22)
- MySQL 8.0+
- Apache أو Nginx (reverse proxy)
- مساحة لا تقل عن 512 MB RAM

---

## 1. إعداد ملفات البيئة

### `api/.env` (انسخ من `.env.example` وامل القيم)

```env
NODE_ENV=production
PORT=3001

# قاعدة البيانات
DB_HOST=localhost
DB_PORT=3306
DB_USER=mahad_user
DB_PASSWORD=***
DB_NAME=mahad

# JWT
JWT_SECRET=***  # مفتاح عشوائي 64+ حرف

# CORS — نطاقات الواجهة المسموح بها
ALLOWED_ORIGINS=https://mahadnafsy.com,https://admin.mahadnafsy.com

# WhatsApp (Cloud API)
WHATSAPP_TOKEN=***
WHATSAPP_PHONE_ID=***
ADMIN_WHATSAPP_PHONE=20xxxxxxxxxx

# بريد إلكتروني
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=noreply@mahadnafsy.com
SMTP_PASS=***

# Paymob
PAYMOB_API_KEY=***
PAYMOB_IFRAME_ID=***
PAYMOB_HMAC_SECRET=***
```

---

## 2. تثبيت التبعيات

```bash
# على السيرفر
cd /path/to/mahad-api
npm install --production

cd /path/to/admin
npm install
npm run build   # ينتج مجلد dist/
```

---

## 3. تشغيل migrations قاعدة البيانات

**الترتيب مهم جداً — لا تقفز خطوات.**

الملفات 001–006 تعمل في الإنتاج بالفعل. **المطلوب تشغيله**: 007 ثم 008.

### الطريقة السريعة — Migration Runner (موصى بها)

```bash
# Dry-run أولاً لترى ما سيُشغَّل
node tools/run-migrations.mjs --dry-run

# تشغيل فعلي
node tools/run-migrations.mjs

# أو تشغيل من migration بعينه فقط
node tools/run-migrations.mjs --from 007
```

الـ runner يتحقق تلقائياً من `api/.env` للاتصال بقاعدة البيانات، ويحفظ المmigrations المُشغَّلة في جدول `schema_migrations` لتجنب التكرار.

### الطريقة اليدوية (بديل)

### تشغيل 007_consolidated_runtime_schema.sql

**الهدف**: يوحّد 90 جدول + 112 ALTER TABLE كانت مبعثرة داخل `startupTasks.js`.

```bash
# من command line
mysql -u mahad_user -p mahad < api/migrations/007_consolidated_runtime_schema.sql
```

أو من **phpMyAdmin** → SQL → انسخ الملف → Go (قد يستغرق 30-60 ثانية).

**تحقق:**
```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mahad';
-- يجب أن يكون 90 أو أكثر
```

### تشغيل 008_money_decimal_and_payroll_fix.sql

**الهدف**: تحويل أعمدة المال من `DOUBLE` → `DECIMAL(12,2)` + إصلاح `consultations.assigned_staff_id`.

```bash
mysql -u mahad_user -p mahad < api/migrations/008_money_decimal_and_payroll_fix.sql
```

**تحقق:**
```sql
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.columns
WHERE table_schema = 'mahad'
  AND table_name = 'courses'
  AND column_name IN ('price_egp', 'price_sar', 'price_usd');
-- يجب أن يظهر: decimal(12,2)
```

> **ملاحظة:** جميع ALTER TABLE تستخدم `IF NOT EXISTS` أو `MODIFY` — آمن للتشغيل مرتين.

---

## 4. تشغيل السيرفر

```bash
# تشغيل مباشر (اختبار فقط)
node api/server.js

# تشغيل بـ supervisor (الإنتاج)
nohup node api/supervisor.js >> api/server.log 2>&1 &

# أو بـ PM2
pm2 start api/server.js --name mahad-api
pm2 save
```

**التحقق من أن السيرفر شغال:**
```bash
curl http://localhost:3001/api/health/live
# يجب أن يرجع: {"status":"ok"}
```

---

## 5. إعداد Apache Reverse Proxy

في ملف VirtualHost الخاص بـ API:

```apache
<VirtualHost *:443>
    ServerName api.mahadnafsy.com

    ProxyPreserveHost On
    ProxyPass /api/ http://127.0.0.1:3001/api/
    ProxyPassReverse /api/ http://127.0.0.1:3001/api/

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/api.mahadnafsy.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/api.mahadnafsy.com/privkey.pem
</VirtualHost>
```

لواجهة الأدمن (`admin/dist/`):

```apache
<VirtualHost *:443>
    ServerName admin.mahadnafsy.com
    DocumentRoot /path/to/admin/dist

    <Directory /path/to/admin/dist>
        Options -Indexes
        AllowOverride All
        Require all granted
    </Directory>

    # React Router — وجّه كل شيء لـ index.html
    FallbackResource /index.html

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/admin.mahadnafsy.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/admin.mahadnafsy.com/privkey.pem
</VirtualHost>
```

---

## 6. التحقق الشامل بعد النشر

```bash
# 1. health check
curl https://api.mahadnafsy.com/api/health/live

# 2. smoke tests (تشغيل من السيرفر مع API_PORT الصح)
API_PORT=3001 node tools/mahad-api-smoke.mjs

# 3. quality check
node tools/mahad-quality-check.mjs
```

---

## 7. المراقبة والـ Logs

| الملف | الوصف |
|-------|--------|
| `api/server.log` | لوج تشغيل السيرفر |
| `api/watchdog.log` | لوج الـ watchdog (آخر 500 سطر) |
| `api/crash-history.log` | تاريخ الإعادات والكراشات (لا يُحذف) |

الـ watchdog يعيد تشغيل السيرفر تلقائياً إذا توقف — يستخدم cron كل دقيقة.

الذاكرة: السيرفر يُعيد تشغيل نفسه تلقائياً إذا تجاوز 170MB RSS.

---

## 8. تحديث الكود (Deploy جديد)

```bash
# 1. اسحب الكود الجديد
git pull origin main

# 2. ثبّت أي تبعيات جديدة
cd api && npm install --production

# 3. أعد بناء الواجهة
cd admin && npm install && npm run build

# 4. أعد تشغيل السيرفر (بـ SIGTERM مزدوج)
# الـ supervisor يتعامل مع الـ restart تلقائياً
kill -TERM $(cat api/server.pid) && sleep 1 && kill -TERM $(cat api/server.pid)
```

---

## ملاحظات مهمة
- لا ترفع ملف `.env` أبداً على Git
- `ALLOWED_ORIGINS` في الإنتاج يتجاهل تلقائياً أي `localhost`
- الـ watchdog يُنصب تلقائياً في cron عند تشغيل السيرفر
- جميع الدفعات تُسجَّل في `payment_audit_log` + `journal_entries` (دفتر يومية مزدوج)
