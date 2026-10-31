# حالة إغلاق موانع إنتاج Mahad v25

التاريخ: 29 يوليو 2026  
الحكم الحالي: **Release Candidate ناجح وظيفيًا، لكن Production No-Go تشغيليًا**.  
الاستثناء المعتمد: Paymob يظل `Disabled` حتى انتهاء مراجعة المزود وإثبات E2E.

## ما أُغلق داخل المشروع

| البند | الدليل الفعلي | النتيجة |
|---|---|---:|
| Migrations | 144–159 applied، وكل checksum مطابق، وكل schema invariant ناجح | ✅ |
| سلامة البيانات | Reconciliation: صفر مخالفة حرجة | ✅ |
| عزل المستأجرين | Tenant A/B يغطي SaaS وCRM وHR وLMS وFinance وOperations | ✅ |
| رحلة العميل | Registration → Lead → Conversion → Order → Proof → Journal → Enrollment → LMS → Certificate → Refund/Reversal | ✅ 57/57 |
| أدوار الموظفين | دخول MFA + واجهة وصلاحيات موجبة وسالبة لكل الأدوار | ✅ 18/18 Browser |
| Browser/API regression | Chromium حقيقي: الموقع والعميل والإدارة وMFA وحدود المصادقة والدفع | ✅ 40/40 |
| Unit regression | 569 إجمالي: 568 Pass، صفر Fail، وPaymob TODO واحد مقصود | ✅ |
| DB integration | الاتصال والترابط المالي وعدم السالب وعزل Tenant A/B | ✅ 5/5 |
| Builds | Admin وClient typecheck + production build | ✅ |
| حمل واقعي | 26 login p95=1227ms، 100 reads p95=101ms، 10 writes p95=387ms، errors=0 | ✅ |
| Soak دقيقة | 252 دورة، p95=45ms، errors=0، RSS +39MB، DB queued=0 | ✅ |
| Redis المحلي | writable master + reconnect/failover smoke | ✅ محلي فقط |
| MFA | otplib v13 API صحيحة، نافذة آمنة ±30s، rate key مرتبط بحساب pending موثّق | ✅ |
| الكتابات المالية المتزامنة | قفل لكل مشترك + transaction retry للـdeadlock | ✅ |
| Dependency gate | أحدث React Router 7.18.2؛ استثناء RSC-only دقيق وينتهي 2026-09-30 | ⚠️ مقبول مؤقتًا |
| حماية Image Proxy | كل redirect يعاد فحصه ضد HTTPS allow-list، والـcache خارج الإصدار immutable | ✅ |
| حزم الواجهات | تفعيل Admin/Client ذري مع SHA-256 وarchive validation و`nginx -t` | ✅ |

## نتيجة Production Readiness الحالية

فحص سياسة الإنتاج على الـRC المحلي أعطى: **32 فحصًا: 19 Pass، 1 Skip معتمد
لـPaymob، 12 Fail**. هذه النتيجة لا تستبدل الفحص الحي من شبكة الإنتاج.

| الأولوية | المانع المتبقي | ما تم في الكود | المطلوب من بيئة الإنتاج لإغلاقه |
|---|---|---|---|
| P0 | Managed MySQL staging غير متاح لنا | تم التحقق محليًا على MySQL 8.4 من 144–159 وchecksums وreconcile وTenant A/B | إنشاء Managed MySQL مطابق، TLS/PITR وrestore evidence، ثم إعادة نفس البوابات عليه |
| P0 | Secrets غير مُدارة فعليًا | دعم `*_FILE` ومراجع مستقلة وبوابة تمنع الأسرار الوهمية | Secret Manager حقيقي: JWT/Session/OTP/Audit مستقلة 48+، references وrotation date |
| P0 | Managed Redis غير موجود | Redis store، writable-role probe، health وfailover smoke | `rediss://` مُدار، provider/region، ثم failover من شبكة الـAPI |
| P0 | SSH credential قديم ظهر في Git history | أُزيل من كل أدوات النشر الحالية، والنشر بكلمة مرور أصبح fail-closed | تدوير credential من لوحة المزود وإلغاء القديم؛ تنظيف الشجرة لا يلغي تاريخ Git |
| P1 | Geo/proxy بلا دليل إنتاج | policy صار fail-closed ويتحقق من hops/provider/evidence hash/live edge | تحديد proxy hops والـedge/provider، ملف دليل SHA-256، رابط الإنتاج وفحص EG/SAR/USD |
| P1 | Data residency غير موثق | البوابة تتحقق من ملف الدليل وSHA-256 والتاريخ | provider/region/evidence file/hash/verified date حقيقية |
| P1 | SMTP الإنتاج الحي غير مثبت | نجح SMTP test inbox: الرسالة وOTP HMAC وreset وsession revocation | إرسال حي إلى صندوق إنتاج داخلي وإثبات الاستلام؛ نجاح fake SMTP ليس دليل مزود |
| P1 | WhatsApp غير جاهز | outbound lifecycle + signed receipt + monotonic status جاهزة | credentials حقيقية ثم acceptance وdelivery receipt |
| P1 | Sentry غير جاهز | readiness gate موجود | DSN HTTPS ومشاهدة test event في المشروع الصحيح |
| P1 | Incident routing غير جاهز | readiness gate موجود | HTTPS webhook وتجربة alert تصل للمناوب |
| P1 | Release tag غير موجود | readiness gate يمنع الإطلاق بدونه | `APP_RELEASE` يساوي build/commit المنشور |
| P1 | لا يوجد artifact نهائي من commit نظيف بعد | API/Admin/Client packaging + SHA-256 + manifest جاهزة وتفشل مع worktree متسخ | مراجعة التغييرات ثم commit/CI نظيف وتشغيل `release:prepare` |
| مؤجل | Paymob | يفشل مغلقًا 503 ولا ينشئ Order | لا يُفعّل قبل موافقة المزود وsandbox/webhook/replay/E2E |

## إعدادات مؤكدة وليست موانع كود

يجب أن تحتوي بيئة تشغيل الـAPI على:

```env
NODE_ENV=production
UV_THREADPOOL_SIZE=8
RUN_MIGRATIONS_ON_STARTUP=false
PRODUCT_CAPABILITY_TIER=multi-tenant-pilot
PAYMOB_REVIEW_PENDING=true
INSTALLMENT_WRITES_ENABLED=false
PAYMENT_LINKS_ENABLED=false
```

لا يجوز وضع قيم الأسرار نفسها في Git أو في هذا التقرير.

## أمر القبول النهائي

بعد توفير الموارد الخارجية وتشغيل Release Candidate من داخل شبكة الإنتاج:

```bash
npm --prefix api run migrate
npm --prefix api run migrate:verify
npm --prefix api run reconcile
npm --prefix api run readiness:production:live
npm --prefix api run uat:full-smoke
npm --prefix api run load:smoke
npm --prefix api run soak:smoke
```

شرط Go: **صفر Fail، وصفر P0/P1، وSkip واحد فقط لـPaymob**.  
حتى ذلك الوقت لا يصح وصف النسخة بأنها جاهزة للإطلاق 100%، ولا تسويقها كـERP أو SaaS مؤسسي كامل.
