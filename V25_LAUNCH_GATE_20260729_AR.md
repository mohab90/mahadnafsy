# بوابة إطلاق Mahad v25 — النتيجة الفعلية

التاريخ: 29 يوليو 2026  
البيئة المختبرة: MySQL 8.4 معزول على 3307 + Redis معزول على 6380 + API معزول على 3101.  
الاستثناء المعتمد: Paymob والدفع/الاسترداد الجزئي متوقفان لحين مراجعة المزود.

## الحكم التنفيذي

- جاهزية الكود والرحلات اليدوية المختبرة: **ناجحة**.
- جاهزية حسابات الموظفين وظيفيًا على بيئة الاختبار: **18/18 حسابًا نجح في المتصفح، و18 حساب موظف + حساب عميل نجحوا في API UAT**.
- جاهزية البيئة الإنتاجية الحالية: **No-Go**؛ فحص production-like أعطى **20 Pass، 1 Skip، 9 Fail** بعد إضافة بوابة MFA.
- لا يوجد دليل يسمح بوصف النسخة بأنها 100% Production Ready قبل تجهيز الخدمات الخارجية وإعادة نفس الفحص على موارد الإنتاج.

## الأدلة المنفذة

| البوابة | النتيجة |
|---|---:|
| Unit tests | 553 إجمالي: 552 Pass، صفر Fail، TODO واحد مقصود لـPaymob |
| Quality gate | 56/56 Pass |
| Admin build | Pass |
| Client build | Pass |
| Migrations 144–159 | Applied + checksum match + schema objects match |
| DB integration | 5/5 Pass |
| رحلة العميل وTenant A/B وصلاحيات الموظفين | 57/57 Pass |
| Playwright suite | 39/39 Pass |
| Render كل حسابات الموظفين بعد التوسعة | 18/18 Pass |
| Geo/currency + single session/IP | Pass لثلاث دول/عملات |
| Forgot password | SMTP accepted + OTP HMAC + reset + session revocation + relogin |
| Queue recovery | stale worker lock recovered، job completed on attempt 2 |
| Reconciliation | صفر Critical |
| Backup/restore rehearsal | 178 جدولًا، counts وchecksums متطابقة |
| Load smoke | Login p95=807ms، Admin API p95=62ms، Payment p95=147ms، صفر أخطاء |

## عقد رحلة العميل المختبر

Landing/Registration → Lead → Sales conversion → Client login → server-priced order → manual payment proof → accountant approval → payment + balanced journal → enrollment → learning completion → certificate verification → refund → reversal journal + revoke access/certificate.

تم التحقق كذلك من:

- Paymob يفشل مغلقًا بـ503 ولا ينشئ Order وهو متوقف.
- لا يتم منح LMS أو شهادة قبل الدفع والاستحقاق.
- الدفع مربوط بالعميل والطلب والكورس ويظهر في القيد والاستحقاق.
- refund يلغي الاستحقاق ويعكس القيد ولا يترك شهادة مدفوعة فعالة.
- نقل العميل للدقي يغيّر الرؤية حسب الفرع.
- تذكرة `billing` تصل للتحصيل، ولا تظهر للدعم الفني خارج قسمه.

## جاهزية أدوار الموظفين

| الحساب التشغيلي | الدور النظامي | ما تم إثباته | الحالة |
|---|---|---|---:|
| Admin | ADMIN | كل Tenant + إدارة الموظفين + واجهة كاملة | ✅ |
| Manager | MANAGER | Full tenant access مع فصل Platform Admin | ✅ |
| Online Manager | ONLINE_MANAGER | العملاء/CRM/الكورسات والعمليات المسموحة | ✅ |
| Sales & Collection Manager | SALES_COLLECTION_MANAGER | كل Leads + Finance المصرح + الفريق | ✅ |
| Sales | SALES | Leads/Subscribers/Orders المسندة فقط | ✅ |
| Collection | COLLECTION | العملاء والتحصيل والطلبات المسندة + Billing queue | ✅ |
| Support Online | SUPPORT | Support queue + assigned subscribers + orders read-only | ✅ |
| Support Daqqi | SUPPORT | نفس عقد SUPPORT؛ الفصل بالـassignment وليس Role مختلفًا | ✅ مع ملاحظة |
| Reception Daqqi | RECEPTION_DAQQI | عملاء وطلبات الدقي فقط | ✅ |
| Daqqi Manager | DAQQI_MANAGER | تشغيل وفرع Finance للدقي | ✅ |
| HR Manager | HR | الموظفون وHR والتقارير والتوظيف | ✅ |
| Recruiter | HR | Join-us/recruiting؛ نفس Role HR في النسخة الحالية | ✅ مع ملاحظة |
| Accountant | ACCOUNTANT | Orders/Payments/Ledger/Refunds/Chart دون HR | ✅ |
| Consultant | CONSULTANT | Calendar والعملاء المسندون دون Finance | ✅ |
| Expert | EXPERT | Catalog/consultations/read scope دون Finance | ✅ |
| Trainer | TRAINER | Course workspace + self HR دون Finance | ✅ |
| Instructor | INSTRUCTOR | Course workspace + self HR دون Finance | ✅ |
| Other | OTHER | Dashboard فقط، ومنع الأقسام الحساسة | ✅ |

الملاحظتان ليستا كسرًا في الاختبار: `Support Online/Daqqi` يشتركان في Role `SUPPORT`، و`HR Manager/Recruiter` يشتركان في Role `HR`. لو المطلوب فصل دائم في الصلاحيات بين الحسابين، يجب تطبيق `permissions_json` لكل مستخدم أو إضافة Roles تجارية مستقلة قبل إنشاء حسابات الإنتاج.

## موانع الإنتاج المثبتة

| الأولوية | المانع | الحالة المطلوبة |
|---|---|---|
| P0 | Managed Redis غير موجود | `rediss://` + provider/region + live ping/failover |
| P0 | Audit secret evidence محلي فقط | Secret Manager production provider/reference/rotation |
| P0 | MFA policy غير مفعلة وحسابات الاختبار الحساسة غير enrolled | Enable policy + QR enrollment لكل حساب حساس |
| P1 | SMTP production password غير محقون | `SMTP_PASS_FILE` + live inbox delivery |
| P1 | WhatsApp credentials غير موجودة | live send + delivery/read receipt |
| P1 | Sentry DSN غير موجود | live event مع release tag |
| P1 | Incident webhook غير موجود | live test alert |
| P1 | Data residency محلي وغير صالح كدليل إنتاج | provider/region/evidence SHA-256/verified date |
| مؤجل | Paymob | يظل Disabled حتى موافقة المزود واختبار E2E |

## القرار

الكود الحالي صالح كـRelease Candidate قوي للمسارات اليدوية المختبرة، لكن **ليس مسموحًا تحويله إلى إطلاق عام الآن**. المتبقي ليس شيئًا يمكن اختلاقه داخل المستودع: يحتاج موارد وحسابات إنتاج وموافقة/تسجيل MFA واختبارات استقبال حية. بوابة الإطلاق المحدثة موجودة في `DEPLOY.md` ويجب أن تنتهي بصفر Fail.
