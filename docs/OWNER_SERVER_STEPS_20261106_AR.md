# خطوات السيرفر عندك — بالترتيب (6 نوفمبر 2026)

> ورقة واحدة. **ولا خطوة هنا اتنفذت** (ما فيش نشر ولا دفع على GitHub ولا دخول على السيرفر مني). كل خطوة: الأمر، إيه اللي يبيّن إنها نجحت، وإزاي ترجّعها. نفّذ الخطوة اللي بعد التانية، ما تخطّيش.
> تفاصيل الأقسام (مزوّدي التخزين، الاسترجاع…) في `deploy/OFFSITE_BACKUPS.md`.

## 0) قبل أي حاجة (دقيقتين)

على السيرفر:
```bash
mysql -u root -N -e "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3"
```
**المفروض** أول سطر يبدأ بـ`360_` (يعني اللي شغّال دلوقتي هو `fd98aaac`). لو أكبر من كده، قوللي قبل النشر. الفرع الجديد هيشغّل مايجريشن **361 إلى 367** (361 بتغيّر بيانات: السبت يوم شغل + مكافآت «شيت الشهر» → مرفوضة — شوف القسم 3 في `FINAL_REPORT_20261106_AR.md`).

## 1) النشر

من جهازك، من فولدر المشروع على الفرع `claude/plan-95-phase-0-2-420eba` (نضيف، من غير تعديلات):
```bash
MAHAD_DEPLOY_EMERGENCY='نشر أسبوعي من غير push' bash deploy/release-all.sh
```
الفرع مش مدفوع على GitHub (القرار بتاعك: push مرة في الأسبوع)، فالسكريبت هيرفض من غير التجاوز ده، والتجاوز بيعدّي فحص «الكوميت على فرع بعيد وCI أخضر» بس، وباقي البوابة (لينت، وحدة، جودة، بناء، تدقيق الاعتماديات، نسخة احتياطية، staging، اختبارات staging، نسخة جديدة، إنتاج) بتشتغل. **الخطوة 9 بتفتح الموقع العام والدفع بس، مش لوحة الإدارة** (هي بتطبع ده).

**النجاح:** آخر سطر `released mahad-… (staging and production)`، وبعده على السيرفر:
```bash
systemctl is-active mahad-api            # active
curl -s http://127.0.0.1:3001/api/health/live    # {"status":"ok",…}
mysql -u root -N -e "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"   # 367_…
```
وافتح اللوحة بإيدك: «الحسابات ← نظرة عامة» (اضغط على خزنة: لازم تفتح السجل على الخزنة والشهر)، «مركز المبيعات»، «اسأل الذكاء»، وفي «الموارد البشرية» كشف شهر فيه سبت.

**لو فشل في النص:** السكريبت بيوقف قبل الإنتاج وبيقول إيه اللي حصل. لو فشل **على الإنتاج** بيرجّع الكود لوحده (`PRODUCTION FAILED - rolled back`).
**لو اشتغل وطلعت مشكلة بعدين (رجوع الكود فورًا، لحد النشر الجاي):**
```bash
mv /var/www/mahad-api/uploads /var/www/mahad-api.prev/ && mv /var/www/mahad-api /var/www/mahad-api.bad && mv /var/www/mahad-api.prev /var/www/mahad-api && systemctl restart mahad-api
```
الرجوع **مش بيرجّع المايجريشن** (هي إضافات، الكود القديم بيشتغل على الجداول الجديدة). الطريق ورا المايجريشن نفسها هو النسخة الاحتياطية اللي السكريبت أخدها قبل كل نصف (آخر ملف في `/var/backups/mahad-db/`)، وبترجّعه في قاعدة جديدة (القسم 5 في `OFFSITE_BACKUPS.md`) — خصوصًا مايجريشن 361 اللي غيّرت صفوف.

## 2) النسخة الخارجية (إعدادات التخزين) — قبل الـbinlog

على السيرفر، مرة واحدة، كـroot. اعمل bucket خاص ومفتاح عليه (جدول المزوّدين في القسم 1 من `OFFSITE_BACKUPS.md`)، وبعدين:
```bash
apt-get update && apt-get install -y rclone gnupg
mkdir -p /etc/mahad && openssl rand -base64 48 > /etc/mahad/offsite.pass && chmod 600 /etc/mahad/offsite.pass
cat /etc/mahad/offsite.pass     # انسخ الكلمة دي في password manager برّه السيرفر — من غيرها النسخ مالهاش لازمة
```
واكتب `/etc/mahad/offsite.env` (الحقول `ENDPOINT / BUCKET / ACCESS_KEY_ID / SECRET_ACCESS_KEY / REGION / PROVIDER / PREFIX / PASSPHRASE_FILE=/etc/mahad/offsite.pass` مثال كامل في القسم 2)، وبعدين `chown root:root /etc/mahad/offsite.env && chmod 600 /etc/mahad/offsite.env`.

**اختبار — النجاح:**
```bash
mahad-offsite test            # آخر سطر: test ok: wrote, listed, read back, decrypted and deleted _check/…
bash /usr/local/bin/mahad-db-backup.sh; echo "exit=$?"     # exit=0
tail -n 3 /var/log/mahad-db-backup.log     # فيه: backup ok: … و off-site ok via mahad-offsite: …
mahad-offsite status
```
**الرجوع:** امسح `/etc/mahad/offsite.env` (كل أوامر `mahad-offsite` بتبقى «OFF» وبتخرج 0)، والنسخة المحلية كل ساعة بتفضل (بس بترجع تطلع exit 3 وALERT إن مفيش نسخة خارجية، زي ما كانت).

## 3) الـbinlog (استرجاع لدقيقة) — بعد ما القسم 2 يتأكد

وقت هادي. **فحوصات قبل البدء** (القسم 4 في `OFFSITE_BACKUPS.md`): `df -h /var/log` (على الأقل 5 جيجا فاضل)، `mysql -V` (لازم MariaDB)، وإن مفيش `log_bin` متضبط في مكان تاني. وبعدين:
```bash
install -m 0644 /usr/local/share/mahad/60-mahad-binlog.cnf /etc/mysql/mariadb.conf.d/60-mahad-binlog.cnf
mkdir -p /var/log/mysql && chown mysql:mysql /var/log/mysql
systemctl restart mariadb
mysql -u root -N -e 'SELECT @@log_bin'      # 1
mahad-offsite ship-binlogs && mahad-offsite status
```
**النجاح:** `SELECT @@log_bin` = `1` و`systemctl is-active mariadb` = `active`، و`mahad-offsite status` من غير أي سطر `FAILED`. بعد أول يوم: `du -sh /var/log/mysql` و`df -h /var/log` (لو كبير: قلّل `expire_logs_days` في الملف).
**الرجوع:**
```bash
rm /etc/mysql/mariadb.conf.d/60-mahad-binlog.cnf && systemctl restart mariadb
mysql -u root -N -e 'SELECT @@log_bin'      # 0
```

## 4) سطر crontab القديم — بعد 2 (و3 لو هتعمله)

```bash
crontab -l | grep mahad-db-backup                     # السطر القديم (غالبًا 20 3 * * *): شوفه الأول
crontab -l > /root/crontab.bak.$(date +%F)            # نسخة قبل أي تغيير
crontab -l | grep -v 'mahad-db-backup' | crontab -    # امسح السطر ده بس
crontab -l                                            # تأكيد
grep -v '^#' /etc/cron.d/mahad-db-backup              # والجدول الجديد (كل ساعة :17) لسه موجود
```
**النجاح:** `crontab -l` مفيهوش `mahad-db-backup`، وفي اللوج بعد الساعة الجاية سطر `backup ok`. (القفل الجديد جوه السكريبت بيخلّي أي تداخل تشغيلة بتتخطّى وتكتب `SKIPPED` — يعني السطر القديم ما بيضرش، بس مفيش داعي له.)
**الرجوع:** `crontab /root/crontab.bak.<التاريخ>`.

## 5) عدّاد استخدام الفهارس لمدة شهر (آخر خطوة، بعد أي restart لـMariaDB)

```sql
SET GLOBAL userstat=1;
```
(`mysql -u root -e "SET GLOBAL userstat=1"`.) **لازم بعد الـbinlog مش قبله:** أي restart لـMariaDB بيرجّعه 0. بياكل كام في المية من السيرفر، فهو لشهر بس.
**النجاح:** `mysql -u root -N -e "SHOW VARIABLES LIKE 'userstat'"` → `ON`.
**بعد شهر (فيه نهاية شهر الرواتب والتقارير):**
```bash
cd /var/www/mahad-api && node tools/index-usage-report.cjs
mysql -u root -e "SET GLOBAL userstat=0"
```
التقرير بيقرا بس (ما بيمسحش فهرس)، وقرارات الفهارس بتتاخد منه على staging الأول.
**الرجوع:** `SET GLOBAL userstat=0;`.

---
**اللي ما اتجرّبش:** كل ده ما اتنفذش على السيرفر. الأرقام اللي في القسم 3 (5 جيجا) تقدير مني. ما اتأكدتش إن حساب UAT موجود على staging.
