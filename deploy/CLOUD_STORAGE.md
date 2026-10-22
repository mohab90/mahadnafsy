# نقل الفيديوهات والملفات من ديسك السيرفر لـ Cloud Storage

الديسك كان واصل 88% وأغلبه فيديوهات المحاضرات. السيستم بقى يقدر يحط الملفات المرفوعة في bucket من نوع S3
(Cloudflare R2 أو Backblaze B2 أو AWS S3) بدل ديسك السيرفر.

**الوضع الافتراضي: مقفول.** من غير الإعدادات اللي تحت السيستم بيشتغل بالظبط زي قبل كده — كل حاجة على الديسك.

## إيه اللي بيتنقل وإزاي

| الملف | مكانه على السيرفر | لما `STORAGE_DRIVER=s3` |
|---|---|---|
| فيديوهات/صوتيات المحاضرات | `VIDEO_UPLOAD_DIR` | بيترفع على السيرفر زي الأول، وبعدها بثواني بيتنقل للـbucket في الخلفية ويتمسح من الديسك بعد التأكد (الحجم + SHA-256). |
| صور الموقع (الأحداث، الجاليري، المحاضرين، نموذج الشهادة) | `MEDIA_IMAGE_DIR` | بتتحط في الـbucket على طول. |
| صور إيصالات الدفع | جوه جدول `payment_proofs` (data URL) | الجديدة بتتحط في الـbucket (خاصة) والصف بيبقى فيه `storage:proofs/...`. |
| لوجو/فافيكون البراند | `BRAND_ASSET_DIR` | زي ما هي (ليها إعداد S3 لوحدها: `BRAND_ASSET_STORAGE`). |

- **العناوين ما بتتغيرش**: الفيديو لسه `/uploads/videos/...` والصورة لسه `/api/media/...`، فمفيش أي صف في الداتابيز محتاج يتعدل.
- **الصلاحيات زي ما هي بالظبط**: الفيديو المدفوع لسه بيعدي على التذكرة (ticket) والتأكد من الاشتراك الفعّال في كل طلب. لو الملف في الـbucket، السيرفر بيرد بـ redirect لرابط موقّع (presigned) **عمره ما بيزيد عن عمر التذكرة**، وبعدها المتصفح بيسحب الـranges من الـbucket مش من الـAPI. من غير تذكرة أو من غير اشتراك مفيش رابط بيطلع خالص.
- الإيصال بيتقري من الـbucket جوه نفس الـroute بنفس صلاحية `view_financial` ونطاق الفرع، وبيرجع للشاشة بنفس الشكل.
- القراءة دايمًا: **الديسك الأول، وبعدين الـbucket** حسب جدول `storage_objects`. فالنقل لو اتقطع في النص، أو رجعت لـ`local`، كل الملفات بتفضل شغالة.
- لو الـbucket وقع وقت الرفع: الصورة/الإيصال بيتحفظوا في مكانهم القديم، والفيديو بيفضل على الديسك لحد ما مهمة كل 10 دقايق تنقله. **الرفع عمره ما بيفشل بسبب الـbucket.**
- الرفع من الأدمن ما اتغيرش (الملف بيعدي على السيرفر). فـ **مش محتاج CORS** على الـbucket، ولا تعديل في nginx.

## 1) اعمل الـbucket والمفاتيح

### Cloudflare R2 (المقترح: مفيش رسوم على المشاهدة/الخروج)
1. Cloudflare Dashboard ← **R2 Object Storage** ← **Create bucket**، الاسم مثلاً `mahad-media`. سيبه **Private** (ما تفعّلش Public access ولا r2.dev).
2. R2 ← **Manage R2 API Tokens** ← **Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: `mahad-media` بس
   - انسخ **Access Key ID** و **Secret Access Key** (السر بيظهر مرة واحدة).
3. الـendpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (الـAccount ID في صفحة R2). الـregion: `auto`.

### Backblaze B2
1. **Buckets** ← **Create a Bucket**، Files: **Private**. فعّل **Object Lock** أو خلي الـLifecycle "Keep all versions" لو عايز حماية من المسح بالغلط.
2. **Application Keys** ← **Add a New Application Key**: Allow access to Bucket = `mahad-media`، Type = **Read and Write**. انسخ `keyID` و `applicationKey`.
3. الـendpoint اللي مكتوب في صفحة الـbucket، مثلاً `https://s3.eu-central-003.backblazeb2.com`، والـregion = `eu-central-003`.

### AWS S3
1. اعمل bucket وخلي **Block all public access = On**.
2. IAM user بـ policy على `arn:aws:s3:::mahad-media/*` فيها بس: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`.
3. الـendpoint: `https://s3.<region>.amazonaws.com`، والـregion زي `eu-central-1`.

> staging والإنتاج على نفس السيرفر: يا إما bucket لكل واحد، يا إما نفس الـbucket بـ `STORAGE_S3_PREFIX` مختلف (`staging` و `production`). **ما تخليهمش بنفس الـprefix.**

## 2) الإعدادات (`.env` بتاع الـAPI)

في ملف إعدادات الـAPI (الـ`.env` اللي في مجلد الـAPI، أو `/etc/mahad/api.env` لو الخدمة شغالة بـ EnvironmentFile)، للإنتاج:

```
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_S3_BUCKET=mahad-media
STORAGE_S3_REGION=auto
STORAGE_S3_ACCESS_KEY_ID=<Access Key ID>
STORAGE_S3_SECRET_ACCESS_KEY=<Secret Access Key>
STORAGE_S3_PREFIX=production
```

- السر ممكن يتحط في ملف بدل السطر: `STORAGE_S3_SECRET_ACCESS_KEY_FILE=/etc/mahad/secrets/s3-secret` (صلاحية 0640، ومتحطش الاتنين مع بعض).
- B2/AWS: نفس السطور بالـendpoint والـregion بتوعهم.
- `STORAGE_S3_FORCE_PATH_STYLE=true` هو الافتراضي وشغال على التلاتة.
- `STORAGE_VIDEO_URL_TTL_SECONDS` (اختياري): أقصى عمر لرابط المحاضرة (الافتراضي 4 ساعات، وعمره ما بيعدي عمر التذكرة).
- staging نفس الكلام في الـ`.env` بتاعه مع `STORAGE_S3_PREFIX=staging`.

بعدها اعمل restart للـAPI **والـworker** (لو شغال):

```
sudo systemctl restart mahad-api-staging    # جرّب على staging الأول
sudo systemctl restart mahad-api mahad-api-worker
```

في اللوج هتلاقي `[storage] new uploads go to bucket mahad-media`. لو فيه إعداد ناقص هتلاقي
`[storage] STORAGE_* settings are not usable; new files stay on this disk: ...` والسيستم بيكمّل على الديسك.

### اتأكد إنه شغال
1. من الأدمن ارفع محاضرة تجريبية قصيرة.
2. في اللوج: `[storage] upload moved to the bucket`.
3. في الداتابيز:
   ```sql
   SELECT object_key, location, size_bytes, last_error FROM storage_objects ORDER BY created_at DESC LIMIT 5;
   ```
   المفروض `location = remote`.
4. افتح المحاضرة بحساب طالب مشترك: في DevTools ← Network هتلاقي طلب `/api/media/lectures/...` رجّع **302** والفيديو بيتسحب من `...r2.cloudflarestorage.com`. وبحساب مش مشترك: مفيش 302.

## 3) نقل الملفات القديمة

الأداة: `api/tools/move-uploads-to-storage.cjs`. بتقرا إعدادات الـbucket من `.env` بتاع الـAPI (حتى لو `STORAGE_DRIVER` لسه `local`).
شغّلها من مجلد الـAPI الشغال، جوه `tmux` أو `screen` عشان لو الـSSH اتقطع. لو الإعدادات في `/etc/mahad/api.env` حمّلها الأول: `set -a; . /etc/mahad/api.env; set +a`.

```
cd /var/www/mahad-api        # مجلد الـAPI الشغال
# 1. تجربة من غير أي تغيير: بتطبع كل ملف هيتعمل فيه إيه
node tools/move-uploads-to-storage.cjs --dry-run --include-proofs

# 2. نسخ + تأكيد (الديسك لسه زي ما هو)
node tools/move-uploads-to-storage.cjs --include-proofs --log-file=/var/log/mahad/move-uploads.log

# 3. بعد ما تتأكد إن المحاضرات شغالة: افضي الديسك
node tools/move-uploads-to-storage.cjs --include-proofs --delete-local --log-file=/var/log/mahad/move-uploads.log
df -h
```

- كل ملف بيتحسب له SHA-256، يترفع والـbucket نفسه بيرفضه لو البايتات وصلت غلط، وبعدين HEAD ومقارنة الحجم والـhash تاني قبل ما يتسجل `both`.
- **الأداة مش بتمسح أي حاجة من غير `--delete-local`**، وحتى معاها بتتأكد من نسخة الـbucket تاني قبل المسح. الإيصال بيتبدل في الصف بالمرجع بس لو الصورة لسه هي نفسها اللي اتأكدنا منها.
- اتقطعت؟ شغّلها تاني بنفس الأمر: اللي اتأكد بيتعدّى، واللي اترفع ومتسجلش بيتقارن الـhash بتاعه ويتسجل من غير رفع تاني. الأمر بيرجع exit code 1 لو فيه ملف فشل، والسبب في `storage_objects.last_error`.
- خيارات: `--only=videos` أو `--only=media` أو `--only=proofs` (مع `--include-proofs`)، `--limit=50` لدفعة صغيرة.
- الإيصالات اختيارية (`--include-proofs`) لأنها في الداتابيز مش على شكل ملفات؛ نقلها بيصغّر الداتابيز والباك أب كل ساعة.

## 4) الرجوع لـ local (Rollback)

1. غيّر `STORAGE_DRIVER=local` **وسيب سطور `STORAGE_S3_*` زي ما هي**، واعمل restart. الرفع الجديد بيرجع للديسك، والملفات اللي في الـbucket لسه شغالة منه.
2. اتأكد إن فيه مساحة على الديسك تكفي (`SELECT SUM(size_bytes) FROM storage_objects WHERE location='remote';`) وبعدين رجّع الملفات:
   ```
   node tools/move-uploads-to-storage.cjs --to-local --include-proofs --dry-run
   node tools/move-uploads-to-storage.cjs --to-local --include-proofs --log-file=/var/log/mahad/move-uploads.log
   ```
   كل ملف بينزل لملف مؤقت، يتأكد الحجم والـhash، وبعدين ياخد مكانه. الإيصالات بترجع data URL في صفوفها.
3. لما `SELECT COUNT(*) FROM storage_objects WHERE location='remote';` تبقى صفر، ساعتها بس تقدر تشيل سطور `STORAGE_S3_*`.
   **ما تمسحش الـbucket قبل الخطوة دي.**

## CDN (اختياري — للصور بس)

من غير CDN الصور بتتقري من الـbucket برابط موقّع لمدة ساعة، وده كفاية. لو عايز دومين CDN:

- `STORAGE_PUBLIC_BASE_URL=https://media.example.com` بيخلي **صور الموقع بس** تتعرض من الدومين ده. الفيديوهات والإيصالات **عمرها ما بتعدي عليه**.
- **مهم**: دومين R2 العام (Custom Domain) بيفتح الـbucket كله لأي حد يعرف اسم الملف — ومين اتفرج على محاضرة مرة عرف اسمها. لازم تقفله على الصور بس:
  Cloudflare ← الدومين ← **Security → WAF → Custom rules**: لو `http.host eq "media.example.com"` و
  `not starts_with(http.request.uri.path, "/production/media/")` (أو `"/media/"` من غير prefix) ← **Block**.
- AWS: CloudFront بـ Origin Access Control وbucket policy بتسمح بـ `s3:GetObject` على `mahad-media/production/media/*` بس.
- لو مش متأكد إن القفل ده متظبط: **سيب `STORAGE_PUBLIC_BASE_URL` فاضي.**

## مشاكل معروفة

| اللي في اللوج / الأداة | السبب |
|---|---|
| `HTTP 403 SignatureDoesNotMatch` | السر غلط، أو ساعة السيرفر مش مظبوطة (`timedatectl`)، أو الـendpoint فيه اسم الـbucket. |
| `HTTP 403 AccessDenied` | المفتاح مش ليه صلاحية كتابة على الـbucket ده. |
| `HTTP 404 NoSuchBucket` | اسم الـbucket أو الـendpoint غلط. |
| `HTTP 400 XAmzContentSHA256Mismatch` | الملف اتغير أثناء الرفع أو البايتات وصلت ناقصة — الأداة بتعيده في المرة الجاية. |
| فيديو بيرجع 404 بعد النقل | `SELECT * FROM storage_objects WHERE object_key LIKE '%<اسم الملف>%'` — لو `local` والملف مش على الديسك، شوف `last_error`. |

## ملاحظات
- الباك أب كل ساعة بتاع الداتابيز **مش** بيغطي الـbucket. فعّل Versioning/Object Lock على B2 أو AWS لو عايز حماية من المسح؛ R2 ممكن تعمله نسخة دورية لـbucket تاني.
- الملفات المؤقتة للرفع لسه في `VIDEO_UPLOAD_DIR/.tmp`، فلازم يفضل فيه مساحة لأكبر فيديو هيترفع (`MAX_VIDEO_UPLOAD_BYTES`).
- الكود: `api/lib/objectStorage.js` (الاختيار والـclient)، `api/lib/s3Signature.js` (التوقيع)، `api/lib/storedFiles.js` (الـroutes)، `api/lib/storageOffload.js` (النقل والتأكيد)، `api/lib/storageLedger.js` و migration `325_v26_storage_objects.sql`.
