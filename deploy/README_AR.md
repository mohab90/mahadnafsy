# نشر Mahad v25

المسار المعتمد هو Release Artifact من commit نظيف، وليس رفع ملفات منفردة أو نسخ `.env`.

## قبل إنشاء الإصدار

1. راجع التغييرات واعمل commit.
2. شغّل `npm run release:gate` من بيئة Release Candidate المتصلة بموارد الإنتاج.
3. شغّل `npm run release:prepare`.
4. انقل ملفات `.tgz` و`.sha256` وmanifest إلى خادم الإصدار عبر قناة المنصة الموثوقة.
5. طابق أسماء الملفات والـSHA-256 مع manifest قبل التفعيل.

## تهيئة الخادم مرة واحدة

- أنشئ مستخدمًا غير root باسم `mahad`.
- أنشئ `/opt/mahad/releases` و`/opt/mahad/static/releases` و`/var/lib/mahad`
  و`/var/cache/mahad`، واجعل مستخدم `mahad` مالكًا لمسارات البيانات والـcache فقط.
- ضع إعدادات الإنتاج في `/etc/mahad/api.env` بصلاحية `0640`، والأسرار كملفات mounted من Secret Manager.
- ثبت `deploy/systemd/mahad-api.service`.
- اضبط Nginx من `deploy/nginx/mahad-web.conf.example` بعد تحديد الدومينات
  والـtrusted proxy والـgeo provider الحقيقيين.

## تفعيل الـAPI

```bash
sudo bash deploy/activate-release.sh \
  /staging/mahad-<commit>-api.tgz \
  /staging/mahad-<commit>-api.tgz.sha256 \
  mahad-<commit>
```

`activate-release.sh` يحسب SHA-256 للـartifact المحدد نفسه، ويرفض archive traversal
والروابط، ثم يثبت dependencies ويطبق migrations ويشغل verification وreconciliation
وlive readiness قبل تبديل symlink بصورة ذرية. إذا لم تعد health خلال 30 ثانية يرجع
للإصدار السابق.

## تفعيل الواجهات

```bash
sudo bash deploy/activate-static-release.sh client \
  /staging/mahad-<commit>-client.tgz \
  /staging/mahad-<commit>-client.tgz.sha256 \
  mahad-<commit>

sudo bash deploy/activate-static-release.sh admin \
  /staging/mahad-<commit>-admin.tgz \
  /staging/mahad-<commit>-admin.tgz.sha256 \
  mahad-<commit>
```

الأداة تقبل `admin` أو`client` فقط، وترفض المسارات والروابط غير الآمنة، وتشترط
`index.html`، وتبدل symlink ذريًا، ولا تعيد تحميل Nginx إلا بعد نجاح `nginx -t`.
الأفضل ترتيب التحويل: API بلا traffic، ثم Client، ثم Admin، ثم canary traffic.

لا تستخدم `api/deploy_api.cjs` أو أدوات `upload_*` القديمة؛ أصبحت تفشل مغلقًا لأنها كانت ترفع `.env` وتعيد تشغيل عمليات واسعة بطريقة غير آمنة.

## المسار البديل: النشر بالحاويات خلف Traefik

الخطوات أعلاه تفترض خادمًا يشغّل Node عبر systemd وNginx يملك المنفذين 80 و443.
على خادم يعمل بالحاويات ويستخدم Traefik بوابةً عكسية، هذان الافتراضان لا يصحّان:
Traefik يملك المنفذين بالفعل ويتولى شهادات Let's Encrypt، فلا مكان لـNginx هناك.

في تلك الحالة استخدم [docker-compose.yml](../docker-compose.yml):

```bash
cp deploy/docker/.env.example .env
docker compose build
docker compose run --rm migrate
docker compose up -d
```

فروق جوهرية عن مسار الـsystemd:

- Traefik ينهي TLS، فالحاويات تستمع HTTP فقط ولا تربط منفذًا على المضيف.
- `/api` يُوجَّه من Traefik إلى حاوية الـAPI مباشرة ولا يمر عبر حاوية الواجهة،
  فيبقى `X-Forwarded-For` صادقًا وعدد الوسطاء واحدًا (`TRUST_PROXY_HOPS=1`).
- ترويسات الجغرافيا (`CF-IPCountry` و`X-Country-Code`) تُمسح في Traefik تمامًا
  كما يمسحها Nginx، حتى لا يصبح مسار الحاويات أضعف من مسار systemd.
- الترحيلات خطوة صريحة (`docker compose run --rm migrate`) ولا تعمل عند الإقلاع،
  حتى لا تتسابق نسختان على تعديل المخطط نفسه.

قاعدة البيانات ليست ضمن الملف عمدًا: الشرط في هذا الدليل هو MySQL مُدارة بـTLS
وPITR ونسخ احتياطي مُختبَر، و`readiness:production:live` يرفض المرور بدون ذلك —
وحاوية MySQL على المضيف نفسه لا تحقق أيًّا من هذه الشروط.

## الإصدار بأمر واحد (سيرفر `/var/www` + systemd)

`deploy/release-all.sh` بيعمل كل الخطوات بالترتيب ويقف عند أول مشكلة: فحص إن الشجرة نضيفة، `npm ci`، `release:prepare` (بيعيد المحاولة 3 مرات لأن مكافح الفيروسات على ويندوز ممكن يقفل ملف لثانية)، التأكد إن الأرشيفات بتاعة نفس الـcommit، باك أب القاعدة على السيرفر (وبيقف لو فشل)، الرفع والتحقق من الـchecksums، وبعدين النشر على مرحلتين:

1. **staging بس** (`MAHAD_DEPLOY_TARGET=staging deploy-release.sh`): الـmigrations على قاعدة staging، تشغيل الكود الجديد، والتأكد من `/api/health` ورقم آخر migration. لو فشل بيرجع لوحده والإنتاج ما اتلمسش.
2. **اختبارات المتصفح على staging من اللابتوب**: `public-smoke` و`payment-flow`، كل واحد لوحده. ده **البوابة**: لو واحد فشل، السكربت بيقف ويقول اسم الاختبار اللي فشل، وstaging بيبقى عليه الإصدار الجديد **والإنتاج زي ما هو على إصداره القديم**.
3. **الإنتاج** (`MAHAD_DEPLOY_TARGET=production deploy-release.sh`) لو الاختبارين نجحوا بس: بيتأكد إن الأرشيفات على السيرفر هي نفسها بالبايت اللي اتجرّبت على staging (من غير build جديد ولا رفع تاني)، ياخد باك أب جديد (الاختبارات بتاخد دقايق والمدفوعات شغالة)، وبعدين migrations الإنتاج وتشغيله، ورجوع تلقائي لو مش سليم.

السكربت على السيرفر نفسه بيرفض نشر الإنتاج لو staging مش شغال على نفس الإصدار (`APP_RELEASE` في `.env` بتاع staging) أو مش سليم. لو اتشغّل بإيدك من غير `MAHAD_DEPLOY_TARGET` بيعمل الاتنين ورا بعض زي زمان — من غير بوابة الاختبارات.

```bash
MAHAD_HOST=<عنوان-السيرفر> MAHAD_KEY=~/.ssh/<مفتاحك> bash deploy/release-all.sh
```

`--prepare-only` بيوقف بعد بناء الأرشيفات من غير ما يرفع حاجة. المصادقة بمفتاح SSH فقط.

### ما الذي يمنع النشر (12 أكتوبر 2026)

- الـcommit لازم يكون موجود على فرع على GitHub (`git branch -r --contains HEAD` بعد `git fetch`) — ادفعه الأول.
- لو `gh` مسجّل دخول أو `GITHUB_TOKEN` موجود: لازم الـCI بتاع الـcommit ده يكون أخضر. لو مفيش ولا واحد منهم: تحذير بس.
- `npm run release:gate -- --skip-live` لازم ينجح (lint، اختبارات الوحدة، الجودة، البناء، فحص الحزم). فحص الجاهزية الحي بيحتاج أسرار الإنتاج، فمكانه السيرفر مش اللابتوب.
- في طوارئ حقيقية: `MAHAD_DEPLOY_EMERGENCY='<السبب>'` بيحوّل الرفض ده لتحذير.
- على السيرفر: الـmigrations بتشتغل على قاعدة staging ثم الإنتاج **قبل** تشغيل الكود الجديد؛ لو واحدة فشلت النشر بيقف (exit غير صفري ومن غير «DONE») والكود القديم بيفضل شغال. بعد التشغيل، `/api/health` (من 127.0.0.1) لازم يقول إن آخر migration مطبّقة = آخر ملف في الإصدار.
- **اختبارات staging لازم تتسطّب على اللابتوب مرة واحدة**: `npm run test:e2e:install`. من غيرها السكربت بيقف في الأول خالص، قبل البناء والرفع (exit 80)، وبيقولك الأمر ده. الطريق الوحيد لتخطيها `MAHAD_SKIP_E2E='<السبب>'` — وبيطبع تحذير كبير إن الإنتاج هيتنشر من غير ما الاختبارات تعدّي على staging؛ ساعتها افحص staging بإيدك أو شغّل «Smoke (staging only)» من GitHub Actions.
- لو اختبار فشل (exit 79): staging عليه الإصدار الجديد والإنتاج ما اتلمسش. صلّح وانشر تاني. لو Playwright بيقول إن المتصفح مش موجود: `npm run test:e2e:install`.

| المتغير | المعنى |
|---|---|
| `MAHAD_E2E_STAGING_URL` | رابط staging (الافتراضي `https://staging.mahadnafsy.com`) |
| `E2E_BASIC_AUTH` | `user:pass` لبوابة nginx على staging لو موجودة |
| `TEST_STUDENT_EMAIL` / `TEST_STUDENT_PASSWORD` | طالب تجريبي على staging لاختبار الدفع |
| `MAHAD_GITHUB_REPO` | `owner/repo` لو `origin` مش رابط github.com |
| `MAHAD_SKIP_E2E` | السبب، لو لازم الإنتاج يتنشر من غير اختبارات staging (تحذير كبير) |

النشر كمان بيمسح الأرشيفات القديمة في `/staging` ويسيب آخر 3 (نسخ الرجوع ونسخ الإصدارات)، ونسخة الرجوع مبقتش بتنسخ `uploads/`. الأفضل `VIDEO_UPLOAD_DIR=/var/lib/mahad/videos` في `.env` بتاع الـAPI (انقل الفيديوهات الموجودة الأول).
ولو الديسك مش كفاية خالص: الفيديوهات والصور والإيصالات ممكن تتنقل لـ Cloudflare R2 / Backblaze B2 / AWS S3 — الخطوات في [`CLOUD_STORAGE.md`](CLOUD_STORAGE.md) (مقفول افتراضيًا).

### النسخ الاحتياطي خارج السيرفر

`deploy/mahad-db-backup.sh` (بيتسطّب في `/usr/local/bin` مع كل نشر) بياخد dump محلي ويتأكد منه، وبعدين **لازم** يبعت نسخة مشفّرة برّه السيرفر. لو مفيش وجهة أو مفيش مفتاح تشفير أو الرفع فشل: سطر `ALERT` في اللوج وفي syslog وexit 3 (الـdump المحلي بيتعمل برضه). النشر بيكمّل مع تنبيه أحمر لأن النسخة المحلية سليمة.

**الطريقة الموصى بيها:** `/etc/mahad/offsite.env` — أي bucket متوافق مع S3 (R2 / B2 / S3 / Wasabi) من غير `rclone config`، ومعاه نسخ الـbinlog كل 15 دقيقة والملفات المرفوعة كل ليلة وتجربة استرجاع شهرية من النسخة الخارجية. الخطوات كاملة في **`deploy/OFFSITE_BACKUPS.md`**.

الطريقة القديمة (لسه شغّالة، وبتكسب لو `MAHAD_BACKUP_REMOTE` موجود) — الإعدادات في `/etc/mahad/backup.env` (ملك root، مش قابل للكتابة لغيره):

| المتغير | المعنى |
|---|---|
| `MAHAD_BACKUP_REMOTE` | وجهة rclone، مثلاً `b2:mahad-backups/db` (لازم `rclone config` الأول) |
| `MAHAD_BACKUP_AGE_RECIPIENTS` | ملف مفاتيح age العامة (`age1…`) — الأفضل: السيرفر يشفّر ومايقدرش يفك |
| `MAHAD_BACKUP_GPG_PASSPHRASE_FILE` | بديل: ملف فيه passphrase لـgpg (chmod 400) |
| `MAHAD_BACKUP_GPG_PASSPHRASE` | نفس الـpassphrase من البيئة بدل الملف |
| `MAHAD_BACKUP_ALLOW_LOCAL_ONLY=1` | للتطوير فقط: من غير نسخة خارجية، تحذير بدل فشل. ممنوع على الإنتاج |
| `MAHAD_BACKUP_ENV_FILE` | مسار ملف الإعدادات لو مش `/etc/mahad/backup.env` |

المفتاح الخاص بتاع age (أو الـpassphrase) يتحفظ **برّه** السيرفر — من غيره النسخ الخارجية مالهاش لازمة. فك نسخة: `age -d -i key.txt x.sql.gz.age > x.sql.gz` أو `gpg -d x.sql.gz.gpg > x.sql.gz`.

**تجربة استرجاع أسبوعية:** النشر بيسطّب `/etc/cron.d/mahad-restore-rehearsal`، كل جمعة 5:30 الصبح بيشغّل `npm run verify:backup-restores` في `/var/www/mahad-api`: بيرجّع أحدث باك أب في قاعدة مؤقتة، يقارنها بالحية، ويمسحها. النتيجة في `/var/log/mahad-restore-rehearsal.log`، والفشل سطر `ALERT` في syslog.

**أول مرة (مرة واحدة على السيرفر):** بعد ما تعمل حساب تخزين (Backblaze B2 أو Google Drive أو أي وجهة rclone) و`rclone config` ليه، شغّل كـ root:

```bash
ssh root@<SSH_HOST> 'bash -s -- b2:mahad-backups/db' < deploy/setup-offsite-backup.sh
```

(`deploy/setup-offsite-backup.sh` بيسطّب rclone وage لو مش موجودين، ويتأكد إن الوجهة بترد، ويعمل زوج مفاتيح age: **العام** على السيرفر عشان يشفّر بس، و**الخاص** بيتكتب مرة واحدة في `/root/mahad-backup-age-private-key.txt` — انسخه بره السيرفر وامسحه بـ `shred -u`. وبيكتب `/etc/mahad/backup.env` ويشغّل نسخة تجربة ويورّيك اللوج.)

#### Google Drive كوجهة (الأسهل لو معاك حساب Gmail)

حساب الخدمة (service account) بتاع رفع الصور **مش مناسب** هنا: الملفات اللي بيرفعها بتتحسب على حصته هو (صفر) فبتترفض. بنستخدم حسابك إنت بتصريح OAuth:

1. على جهازك (ويندوز): `winget install Rclone.Rclone` ثم `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"` — بيفتح المتصفح، تسجّل دخول بحساب Google اللي هتتخزن عليه النسخ، وبيطبع سطر JSON بين `{` و`}` — انسخه كله.
2. على السيرفر (مرة واحدة): `rclone config create gdrive drive scope=drive.file token='<السطر اللي نسخته>'`
3. شغّل أمر الإعداد: `ssh root@<SSH_HOST> 'bash -s -- gdrive:mahad-backups' < deploy/setup-offsite-backup.sh`

صلاحية `drive.file` معناها rclone يشوف الملفات اللي هو عملها بس — مش باقي الدرايف. النسخ بتتشفّر قبل الرفع، فجوجل مش بتشوف محتواها. النسخ الخارجية بتتمسح بعد 30 يوم (`MAHAD_BACKUP_REMOTE_KEEP_DAYS`) وبعد ما نسخة اليوم تتأكد على الدرايف، والمسح نهائي (من غير سلة المحذوفات) عشان الـ 15 جيجا المجانية مايتملّوش. لو عايز تتأكد إن توكن Google شغال بعد أسبوع: `rclone lsd gdrive:` على السيرفر.

### المراقبة والتنبيهات

كل 5 دقايق `lib/opsWatchdog.js` بيسأل: نسبة أخطاء السيرفر، زحمة طلبات مش طبيعية على شاشة واحدة (حلقة في متصفح)، البطء، عمر آخر نسخة احتياطية، هل اتنسخت بره السيرفر، ورسايل واتساب/إيميل الواقفة. أي مشكلة بتتبعت **مرة واحدة لكل فترة** (ساعتين للأخطاء، 3 ساعات للزحمة والبطء والرسايل، يوم للنسخ) على واتساب لأرقام «التقرير اليومي» — يعني لازم يكون فيه رقم محفوظ هناك. النتيجة الأخيرة: `GET /api/admin/system/watchdog` (للأدمن).

| المتغير (في `.env` بتاع الـAPI) | المعنى |
|---|---|
| `OPS_HEARTBEAT_URL` | رابط https من خدمة خارجية (healthchecks.io أو UptimeRobot heartbeat). السيرفر بيضربه كل 5 دقايق، والخدمة هي اللي بتنبّهك لو الضرب وقف — الحالة الوحيدة اللي السيرفر مايقدرش يبلّغ عنها بنفسه (وقع أو واتساب واقع) |
| `OPS_ERROR_SHARE` / `OPS_ERROR_MIN` | نسبة وعدد أخطاء 5xx في آخر 10 دقايق (الافتراضي 3% و8) |
| `OPS_STORM_MIN` / `OPS_STORM_TIMES` / `OPS_STORM_ABSOLUTE` | زحمة: على الأقل 1500 طلب في 5 دقايق وأكتر من 6 أضعاف الساعة اللي قبلها، أو 6000 مهما كان |
| `OPS_SLOW_P95_MS` | بطء: p95 ≥ 3000ms في آخر 10 دقايق (لازم 80 طلب على الأقل) |
| `OPS_BACKUP_MAX_HOURS` | أقصى عمر لآخر نسخة سليمة (الافتراضي 30 ساعة) |

**المساحة:** `/api/health` (من 127.0.0.1) بيعرض نسبة امتلاء القرص، ولو وصلت `DISK_ALERT_PERCENT` (80%) بيتبعت واتساب لأرقام التقرير اليومي مرة في الأسبوع.
