# دليل إطلاق Mahad v25

آخر تحديث: 29 يوليو 2026
النطاق المعتمد: Institute Suite مع Multi-tenant Pilot. لا يجوز تسويقه كـ ERP أو SaaS مؤسسي كامل.

## قرار الإطلاق

الإطلاق مسموح فقط عندما ينتهي الأمر التالي بصفر `FAIL`، مع السماح بـ`SKIP` واحد فقط لـPaymob طالما مراجعة المزود مستمرة:

```bash
npm --prefix api run readiness:production:live
```

`Paymob` والدفع/الاسترداد الجزئي يظلان مغلقين:

```env
PAYMOB_REVIEW_PENDING=true
INSTALLMENT_WRITES_ENABLED=false
PAYMENT_LINKS_ENABLED=false
```

## البنية المطلوبة

- Node.js 22 LTS.
- MySQL 8 مُدار، مع TLS ونسخ احتياطي وPITR.
- Redis مُدار داخل نفس المنطقة، والاتصال عبر `rediss://`.
- Secret Manager أو Vault للأسرار؛ ممنوع حفظ كلمات المرور أو المفاتيح في Git.
- Reverse proxy يمرر IP والـgeo headers بصورة موثوقة ومحددة.
- Sentry وقناة incident webhook فعالة.
- SMTP production وWhatsApp provider صالحان لاختبار إرسال حي.

## إعداد البيئة

استخدم [api/.env.example](api/.env.example) كقائمة كاملة. أهم الضوابط:

- مفاتيح `JWT_SECRET` و`SESSION_BINDING_SECRET` و`OTP_HMAC_SECRET` مستقلة وطول كل منها 48 حرفًا على الأقل.
- `AUDIT_HMAC_SECRET_FILE` يأتي من Secret Manager، مع provider/reference/rotation evidence.
- كلمة مرور SMTP تُحقن من `SMTP_PASS_FILE`، ومع إعدادات يديرها النشر استخدم:

```env
SMTP_CONFIG_SOURCE=environment
```

- اضبط `TRUST_PROXY_HOPS` على العدد الحقيقي للـproxies فقط.
- لا تفعل `TRUST_GEO_HEADERS=true` إلا إذا كان الـedge يحذف ويعيد كتابة headers العميل.
- عرّف `DATA_RESIDENCY_*` من أدلة المزود الفعلية، وليس من قيم محلية أو أمثلة.
- فعّل سياسة MFA لكل Tenant، وسجّل كل حساب إداري أو مالي أو صاحب صلاحية حساسة.

## بوابة الكود قبل النشر

```bash
npm run release:gate
```

الأمر يجمع lint وTypeScript والوحدات والجودة وبناء Admin وClient وفحص dependencies
و`readiness:production:live`. لا تستبدله بتشغيل أجزاء منفردة.

## إنشاء الإصدار

بعد مراجعة التغييرات ودمجها في commit نظيف:

```bash
npm run release:prepare
```

ينشئ الأمر ثلاث حزم commit-addressed للـAPI والـAdmin والـClient، مع SHA-256
وmanifest واحد. يفشل الأمر عمدًا لو كان الـworktree متسخًا أو لو لم توجد builds
مراجعة للواجهتين.

- أدوات `deploy_*` و`upload_*` القديمة معطلة ولا تنشر عبر SSH.
- أدوات SSH المساعدة تقبل private key أو agent فقط؛ كلمة مرور SSH ممنوعة.
- تفعيل الـAPI يتم بواسطة `deploy/activate-release.sh` بعد فحص checksum ومسارات
  الأرشيف، ثم release jobs معزولة للمigrations والتحقق والـreconciliation والـreadiness.
- تفعيل Admin وClient يتم بواسطة `deploy/activate-static-release.sh` مع component
  مقيد، SHA-256 للملف نفسه، archive validation وsymlink ذري، ثم `nginx -t`.
- لا يتم `source` لملف بيئة systemd داخل shell.

## قاعدة البيانات

1. خذ backup متسقًا قبل أي migration.
2. نفّذ migrations المرقمة فقط؛ Runtime DDL ممنوع.
3. تحقق من migrations 144–159 والـchecksums:

```bash
npm --prefix api run migrate
npm --prefix api run migrate:verify
```

4. نفّذ فحص الترابط المالي ورحلة العميل:

```bash
npm --prefix api run reconcile
```

5. نفّذ restore rehearsal على خادم استعادة منفصل أو قاعدة مؤقتة مصرح بها:

```bash
ALLOW_DB_RESTORE_REHEARSAL=1 npm --prefix api run restore:rehearsal
```

لا تنفذ الاستعادة فوق قاعدة حية.

## تشغيل Release Candidate

شغّل الـAPI تحت process manager يدعم:

- graceful `SIGTERM`;
- restart policy محدود؛
- health checks؛
- release tag؛
- logs مركزية؛
- أكثر من instance بعد ربط Redis.

نقاط الفحص:

```text
GET /api/health/live
GET /api/health
GET /api/health/detailed
GET /api/health/queues
```

`/api/health/live` يثبت حياة العملية فقط. قرار استقبال traffic يعتمد على `/api/health`.

## UAT الإجباري

على Release Candidate وببيانات اختبار معزولة:

```bash
npm --prefix api run uat:full-smoke
npm --prefix api run smoke:customer-auth-geo
npm --prefix api run smoke:forgot-password
npm --prefix api run queue:smoke
npm --prefix api run redis:failover-smoke
npm --prefix api run load:smoke
npm --prefix api run soak:smoke
npm run test:e2e
```

يجب التحقق من:

- Tenant A/B isolation.
- Website → Lead → Sales → Order → Manual payment proof → Journal → Enrollment → LMS → Certificate → Refund reversal.
- مصر = EGP، السعودية = SAR، وباقي الدول = USD.
- جلسة واحدة فقط للحساب، مرتبطة بعنوان IP.
- نسيت كلمة المرور: قبول SMTP، OTP غير مخزن كنص واضح، reset يبطل الجلسة القديمة.
- كل أدوار الموظفين الإيجابية والسلبية، ونطاق الفرع/الإسناد.
- worker stale-lock recovery وRedis health.

## الاختبارات الخارجية الحية

```bash
npm --prefix api run readiness:production:live
```

لا تعتبر القناة جاهزة بمجرد وجود credentials:

- SMTP: `verify` ثم رسالة حقيقية إلى صندوق اختبار واستلامها.
- WhatsApp: provider acceptance ثم `delivered/read` receipt.
- Sentry: test event يصل للمشروع الصحيح.
- Incident webhook: test alert يصل للقناة المناوبة.
- Redis: TLS ping من نفس شبكة الـAPI.
- Data residency: provider/region/evidence hash/date من الموارد الحية.

## النشر التدريجي والرجوع

1. انشر Release Candidate دون تحويل traffic.
2. نفذ readiness وUAT.
3. حوّل نسبة صغيرة من traffic وراقب errors وp95 وqueues.
4. وسّع تدريجيًا فقط مع صفر P0/P1.
5. عند الرجوع، ارجع التطبيق للنسخة السابقة؛ لا تعكس migration يدويًا. استخدم backup/PITR وفق runbook بعد تقييم البيانات الجديدة.

## شروط No-Go

- أي `FAIL` في production readiness.
- أي اختلاف Tenant أو صلاحيات.
- دفع بلا journal أو entitlement، أو refund بلا reversal.
- فشل restore rehearsal أو mismatch في checksums/counts.
- SMTP reset غير مُثبت حيًا.
- MFA غير مفعّل/غير مكتمل للحسابات الحساسة.
- Redis/Sentry/incident routing غير جاهز.
- محاولة تفعيل Paymob قبل موافقة المزود واختبار sandbox/webhook/replay.
- وجود worktree غير مراجع أو عدم القدرة على ربط artifact بـcommit وSHA-256.
- عدم تدوير أي credential ظهر سابقًا في Git history، حتى لو حُذف من الشجرة الحالية.
