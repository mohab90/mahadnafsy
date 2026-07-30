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
