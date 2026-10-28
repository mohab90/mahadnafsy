# النسخ الاحتياطي خارج السيرفر — Off-site backups

> **الخلاصة:** كل نسخ قاعدة البيانات دلوقتي على نفس الهارد اللي عليه القاعدة. لو السيرفر وقع أو الحساب اتقفل أو حد مسح حاجة بالغلط، كل حاجة تروح مرة واحدة. الملف ده بيشرح إزاي نشغّل نسخة **مشفّرة** برّه السيرفر على أي خدمة تخزين متوافقة مع S3 (Cloudflare R2 أو Backblaze B2 أو AWS S3 أو Wasabi).
>
> **In short:** every copy of the database is on the disk the database lives on. This turns on an **encrypted** off-site copy to any S3-compatible bucket. Everything is **off** until `/etc/mahad/offsite.env` exists; nothing changes on the server before that.

## إيه اللي بيتعمل — What runs

| الوقت | إيه | الأمر |
|---|---|---|
| كل ساعة (:17) | الـdump المحلي (زي ما هو) + نسخة مشفّرة في `db/` | `mahad-db-backup.sh` → `mahad-offsite push-dump` |
| كل 15 دقيقة | ملفات الـbinlog المقفولة في `binlog/<اليوم>/` (لو الـbinlog شغّال) | `mahad-offsite ship-binlogs` |
| 2:40 بالليل | الملفات المرفوعة الجديدة أو المتغيّرة (فيديوهات، لوجو، صور) في `uploads/` | `mahad-offsite sync-uploads` |
| 4:10 بالليل | الاحتفاظ: كل نسخة لمدة 7 أيام، بعدها نسخة في اليوم لحد 35 يوم، بعدها نسخة في الشهر لـ12 شهر. الـbinlog لـ35 يوم | `mahad-offsite prune` |
| يوم 2 في الشهر 5:45 | تجربة استرجاع من النسخة الخارجية (اختياري) | `mahad-offsite rehearse --scheduled` |

- كل حاجة بتتشفّر بـ`gpg` (AES256) **قبل** ما تطلع من السيرفر، والنسخة بتتفك تجريبياً قبل الرفع، وبعد الرفع بنسأل الـbucket عن الحجم.
- الملفات المرفوعة بتتنسخ بس (copy) — ملف اتمسح من السيرفر **مبيتمسحش** من برّه.
- أي فشل: سطر `ALERT` في `/var/log/mahad-offsite.log` وفي syslog (`journalctl -t mahad-offsite`) وعلى stderr (cron بيبعته بالإيميل لو مضبوط)، وعلى `ALERT_WEBHOOK_URL` لو موجود في ملف الإعدادات (نفس الـwebhook بتاع الـAPI). الـbackup بالساعة بيرجع exit 3، والنشر (`release-all.sh`) بيطبع تحذير أحمر.
- `mahad-offsite status` بيوري آخر نتيجة لكل مهمة.

## 1. في حساب التخزين — In the provider

اعمل **bucket خاص (private)** اسمه مثلاً `mahad-backups`، ومفتاح (Access Key) **على الـbucket ده بس**.

| الخدمة | المفتاح | `ENDPOINT` | `REGION` | `PROVIDER` |
|---|---|---|---|---|
| **Cloudflare R2** | R2 → Manage API tokens → Create → *Object Read & Write*، محدد بالـbucket ده | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `auto` | `Cloudflare` (أو `Other` لو rclone أقدم من 1.59) |
| **Backblaze B2** | App Keys → Add → *Allow access to: mahad-backups*، Read and Write | `https://s3.<region>.backblazeb2.com` (مكتوب في صفحة الـbucket) | مثلاً `us-west-004` | `Other` |
| **AWS S3** | IAM user بسياسة على الـbucket بس: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject` | فاضي | مثلاً `eu-central-1` | `AWS` |
| **Wasabi** | Sub-user بسياسة على الـbucket بس | `https://s3.<region>.wasabisys.com` | مثلاً `eu-central-1` | `Wasabi` (Wasabi بيحاسب على 90 يوم أقل حاجة) |

**مفتاح من غير صلاحية مسح (الأأمن):** B2 (عن طريق `b2 key create` بصلاحيات `listFiles,readFiles,writeFiles` من غير `deleteFiles`) وAWS (من غير `s3:DeleteObject`) بيسمحوا بكده. ساعتها لو حد اخترق السيرفر مايقدرش يمسح النسخ الخارجية. في الحالة دي:
- حط `MAHAD_OFFSITE_PRUNE=0` في ملف الإعدادات،
- واعمل **Lifecycle rule** في الـbucket: امسح `db/` بعد 35 يوم و`binlog/` بعد 35 يوم (الاحتفاظ الشهري بيتلغي في الحالة دي، أو اعمل bucket تاني للشهري)،
- واختياري: Object Lock / versioning لو الخدمة بتدعمه.

R2 مفيهوش مفتاح كتابة بس؛ استخدم Object Read & Write والـprune بيشتغل عادي.

## 2. على السيرفر — On the server (once, as root)

```bash
# الأدوات: rclone (المفضّل) و gnupg. aws CLI بديل لو rclone مش موجود.
apt-get update && apt-get install -y rclone gnupg
rclone version            # 1.59 أو أحدث عشان PROVIDER=Cloudflare؛ أقدم = استخدم Other
# بديل: snap install aws-cli --classic   (والسكريبت بيختاره لوحده لو rclone مش موجود)

# كلمة سر التشفير: طويلة وعشوائية، و**تتحفظ برّه السيرفر كمان** (password manager)
mkdir -p /etc/mahad
openssl rand -base64 48 > /etc/mahad/offsite.pass
chmod 600 /etc/mahad/offsite.pass
cat /etc/mahad/offsite.pass     # انسخها واحفظها في مكان آمن برّه السيرفر — من غيرها النسخ مالهاش لازمة

# ملف الإعدادات
cat > /etc/mahad/offsite.env <<'EOF'
MAHAD_OFFSITE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
MAHAD_OFFSITE_BUCKET=mahad-backups
MAHAD_OFFSITE_ACCESS_KEY_ID=...
MAHAD_OFFSITE_SECRET_ACCESS_KEY=...
MAHAD_OFFSITE_REGION=auto
MAHAD_OFFSITE_PROVIDER=Cloudflare
MAHAD_OFFSITE_PREFIX=mahad
MAHAD_OFFSITE_PASSPHRASE_FILE=/etc/mahad/offsite.pass
# اختياري:
# MAHAD_OFFSITE_REHEARSAL=1          تجربة الاسترجاع الشهرية من النسخة الخارجية
# ALERT_WEBHOOK_URL=https://...      Slack/Discord/أي webhook للتنبيهات
# MAHAD_OFFSITE_PRUNE=0              لو المفتاح مايقدرش يمسح والـlifecycle rules هي اللي بتمسح
# MAHAD_OFFSITE_TOOL=aws             لإجبار aws CLI بدل rclone
# MAHAD_OFFSITE_UPLOAD_DIRS="/var/www/mahad-api/uploads /var/lib/mahad/videos"
#   (الافتراضي: /var/www/mahad-api/uploads + أي VIDEO_UPLOAD_DIR / BRAND_ASSET_DIR /
#    MEDIA_IMAGE_DIR في /var/www/mahad-api/.env برّه الفولدر ده)
# MAHAD_OFFSITE_KEEP_HOURLY_DAYS=7  MAHAD_OFFSITE_KEEP_DAILY_DAYS=35
# MAHAD_OFFSITE_KEEP_MONTHLY=12     MAHAD_OFFSITE_KEEP_BINLOG_DAYS=35
EOF
chown root:root /etc/mahad/offsite.env && chmod 600 /etc/mahad/offsite.env
```

`mahad-offsite` والـcron (`/etc/cron.d/mahad-offsite`) بيتسطّبوا مع كل نشر. لو لسه ماحصلش نشر بعد التحديث ده: `bash deploy/release-all.sh`.

> الملف لازم يكون ملك root و`chmod 600`، وإلا السكريبت بيرفضه بـALERT (فيه مفتاح الـbucket وكلمة السر).
> لو `/etc/mahad/backup.env` فيه `MAHAD_BACKUP_REMOTE` (الطريقة القديمة بـ`rclone config`) فهو اللي بيكسب للـdump بالساعة؛ امسحه عشان تستخدم الطريقة دي.

## 3. اختبار — Test

```bash
mahad-offsite test --dry-run      # الإعدادات كاملة؟ (من غير رفع)
mahad-offsite test                # يرفع ملف صغير مشفّر، يقرأه تاني، يفكّه، ويمسحه
bash /usr/local/bin/mahad-db-backup.sh; echo "exit=$?"   # 0 = الـdump اتعمل واترفع
mahad-offsite sync-uploads --dry-run | head               # الملفات اللي هتترفع
mahad-offsite sync-uploads        # أول مرة بياخد وقت (الفيديوهات)
mahad-offsite rehearse            # تجربة استرجاع كاملة من النسخة الخارجية (يدوي، في أي وقت)
mahad-offsite status
tail -n 30 /var/log/mahad-offsite.log
```

## 4. الـbinlog — استرجاع لدقيقة معيّنة (Point-in-time recovery)

من غير binlog أقصى حاجة نرجع لها هي آخر dump (لحد ساعة ضايعة). مع الـbinlog نرجع لأي دقيقة (لحد 15 دقيقة ضايعة لو السيرفر نفسه راح).

**التشغيل محتاج restart لـMariaDB (ثواني) — اعمله في وقت هادي. النشر مش بيشغّله لوحده؛ بيطبع `NOTE: MariaDB binary logs are OFF` لحد ما يتشغّل.**

```bash
install -m 0644 /usr/local/share/mahad/60-mahad-binlog.cnf /etc/mysql/mariadb.conf.d/60-mahad-binlog.cnf
mkdir -p /var/log/mysql && chown mysql:mysql /var/log/mysql
systemctl restart mariadb
mysql -u root -N -e 'SELECT @@log_bin'    # لازم 1
mahad-offsite ship-binlogs && mahad-offsite status
```

الـdump بالساعة بعد كده بيسجّل مكانه في الـbinlog (`--master-data=2`)، و`ship-binlogs` بيبعت كل binlog مقفول كل 15 دقيقة (وبيقفل الحالي لو اتكتب فيه حاجة). MariaDB بيمسح نسخه المحلية بعد 10 أيام (`expire_logs_days`).

## 5. الاسترجاع — Restore

**قاعدة: الاسترجاع دايماً في قاعدة جديدة، مش فوق القاعدة الشغّالة.** بعد ما تتأكد، غيّر `DB_NAME` في `.env` بتاع الـAPI أو اعمل rename.

على سيرفر جديد: ثبّت rclone وgnupg، رجّع `/etc/mahad/offsite.env` و`/etc/mahad/offsite.pass` (من النسخة اللي برّه السيرفر)، وانسخ `deploy/mahad-offsite.sh` لـ`/usr/local/bin/mahad-offsite`.

**آخر dump:**
```bash
mahad-offsite fetch-db latest /root/restore            # أو اسم نسخة معيّنة بدل latest
mysql -u root -e 'CREATE DATABASE mahad_restored CHARACTER SET utf8mb4'
zcat /root/restore/mahadnafsy_db_*.sql.gz | mysql -u root mahad_restored
```

**لدقيقة معيّنة (بتوقيت السيرفر):**
```bash
mahad-offsite fetch-pitr '2026-10-21 14:05:00' /root/pitr
cat /root/pitr/RESTORE_COMMANDS.txt     # الأوامر بالظبط: الـdump ثم mysqlbinlog --start-position … --stop-datetime …
```
السكريبت بيختار آخر dump قبل الوقت ده، وبينزّل الـbinlogs من مكان الـdump، وبيتأكد إن `mysqlbinlog` قادر يقراها. التنفيذ نفسه بإيدك (`bash` على الأوامر أو سطر سطر).

**الملفات المرفوعة:**
```bash
mahad-offsite fetch-uploads /root/uploads-restore
# بتتحط بمسارها الأصلي: /root/uploads-restore/var/www/mahad-api/uploads/...
rsync -a /root/uploads-restore/var/www/mahad-api/uploads/ /var/www/mahad-api/uploads/
```

**تحقق:** `cd /var/www/mahad-api && MAHAD_BACKUP_DIR=/root/restore npm run verify:backup-restores` (بيرجّع النسخة في قاعدة مؤقتة، يقارن عدد الصفوف بالقاعدة الحية، ويمسحها).

## English summary

- Settings: `/etc/mahad/offsite.env` (root, `chmod 600`). Without it every `mahad-offsite` command exits 0 silently; the hourly backup keeps its existing behaviour (exit 3 + ALERT: no off-site copy).
- Transport: `rclone` (remote built from `RCLONE_CONFIG_MAHADOFFSITE_*` env vars, no `rclone config`) or the `aws` CLI, auto-detected; `MAHAD_OFFSITE_TOOL` forces one.
- Encryption: gpg symmetric AES256, passphrase on fd 3 (never argv). Mandatory — nothing is shipped in clear.
- Layout in `<bucket>/<prefix>/`: `db/<db>_<YYYYMMDD_HHMMSS>.sql.gz.gpg`, `binlog/<YYYY-MM-DD>/<binlog>.gpg`, `uploads/<absolute local path>.gpg`, `_check/` (test objects).
- Retention (`prune`, nightly): all dumps for 7 days, first of each day to 35 days, first of each month for 12 months; binlogs 35 days. With a no-delete key set `MAHAD_OFFSITE_PRUNE=0` and use bucket lifecycle rules.
- PITR: `deploy/mariadb/60-mahad-binlog.cnf` (manual install + MariaDB restart), `ship-binlogs` every 15 min, `fetch-pitr '<time>' DIR` prepares dump + binlogs + exact commands.
- Rehearsal: `mahad-offsite rehearse` downloads the newest off-site dump, decrypts it and runs `npm run verify:backup-restores` against it (scratch DB, compared with live, dropped). Monthly with `MAHAD_OFFSITE_REHEARSAL=1`.
- Alerts: `ALERT` lines in `/var/log/mahad-offsite.log`, syslog (`user.err`, tag `mahad-offsite`), stderr (cron mail), and `ALERT_WEBHOOK_URL` if set.
