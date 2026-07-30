# حالة استكمال Mahad v25 — تقرير صريح

التاريخ: 29 يوليو 2026  
النطاق: آخر حالة فعلية للكود في `D:\mahadnafsy25`.  
الاستثناء المعتمد: Paymob وتقسيم/استرداد الدفع الجزئي يظلان متوقفين لحين مراجعة المزود.

## القرار التنفيذي

- **الكود المحلي اجتاز بوابة الإطلاق:** 553 اختبارًا (552 Pass، صفر Fail، وTODO واحد مقصود لـPaymob)، و56/56 فحص جودة، ونجح Build الإدارة والعميل.
- **النسخة ليست 100% Production Ready اليوم:** فحص `production-readiness` أعطى 5 Pass و1 Skip و22 Fail بسبب مدخلات/خدمات البيئة الخارجية، وأهمها MySQL الحالية، Redis، الأسرار المُدارة، Sentry، WhatsApp، Data Residency وقياس الحمل الحي.
- يوجد إثبات تاريخي سابق داخل المشروع لاختبارات MySQL/UAT/Browser، لكن migrations 150–159 والتعديلات الأخيرة تحتاج إعادة تطبيق واختبار على الـstaging المُدار قبل Release Candidate.
- التقييم الواقعي للكود والمنتج الحالي: **72/100**. جاهزية الإطلاق الفعلية في البيئة الحالية: **54/100 (No-Go)**.

## ما أُغلق في آخر جولة

| ID | المشكلة | الدليل | النتيجة |
|---|---|---|---|
| INT-01 | إنشاء عميل الدقي ثم دفعه كان خطوتين وقد يترك عميلًا بلا دفعة | `api/routes/subscriber-payments.js:38-160,239-278` و`admin/pages/dashboard/tabs/OnlineClientsTab.tsx:650-735` | العميل + الدفعة + القيد + الاستحقاق داخل Transaction واحدة |
| FIN-01 | Dashboard الأونلاين كان يجمع EGP/SAR/USD في رقم ونسبة واحدة | `admin/pages/dashboard/tabs/OnlineTeamTab.tsx:189-202,366,493-504` | المتأخرات منفصلة حسب العملة، والتحصيل المدفوع يستخدم `amount_egp` المثبت |
| PERF-01 | `/admin/payments` كان يقطع النتائج عند 2000 | `api/routes/payments.js:72-132` و`admin/lib/mysqlapi.ts:273-288` | Pagination حتى 5000/صفحة والعميل يجلب الصفحات بحد حماية 50 ألف |
| CS-01 | اختيار موظف التذكرة كان يمكن أن يعبر Tenant | `api/lib/ticketRouting.js:78-95` | اختيار الموظف والحمل Tenant-scoped |
| CS-02 | موظف الدعم كان يقدر يرى Queues أوسع من قسمه | `api/routes/support.js` | Department/assignment scope على القراءة والتفاصيل والتعديل |
| CS-03 | الرد/الأحداث/الإشعار لم تكن عقدًا واحدًا | `api/lib/ticketRouting.js` و`api/lib/notification.js` | Replies/events/notifications داخل Transaction |
| ATT-01 | حضور الدقي كان Counter قابلًا للكتابة بدل سجل حدث | migration `158_v25_daqqi_attendance_events.sql` و`api/routes/daqqi-rounds.js` | Attendance event غير قابل للمحو، مع locking ومنع النقل بعد بدء الحضور |
| AUTH-01 | OTP كان مخزنًا كنص واضح وقابلًا لاستهلاك متزامن | `api/routes/auth.js:40-45,850-1015` وmigration `159_v25_otp_secret_storage.sql` | HMAC SHA-256 + Row Lock + single-use transaction |
| OPS-01 | Presence كان process-local | `api/lib/onlineUsers.js` و`api/lib/httpApp.js` | Redis في التشغيل الموزع وMemory فقط للتطوير |
| ARCH-01 | Runtime DDL ميت بحوالي 1,800+ سطر | حذف `api/lib/startupTasks.js` و`tools/extract-runtime-ddl.cjs` | migrations هي السلطة الوحيدة؛ الحذف قابل للاسترجاع من Git |

## تقييم الأقسام بعد الاختبارات

| القسم | التقييم /10 | الحكم الصريح |
|---|---:|---|
| CRM | 7.5 | قوي لمعهد متوسط؛ أقل من Salesforce/Dynamics/HubSpot في CPQ والـforecasting والـecosystem |
| Client Portal | 7.2 | رحلة جيدة وربط LMS/دفع/شهادات واضح؛ يحتاج UAT نهائي على البيانات الفعلية |
| Payments اليدوي | 7.4 | Ledger/entitlement/CRM transaction جيدة؛ Paymob والجزئي خارج الحكم |
| Finance & Accounting | 7.0 | Double-entry وفترات وFX وreconciliation جيدة؛ ليس ERP كاملًا |
| HR | 6.8 | دورة موظف ورواتب واعتمادات جيدة؛ لا statutory tax/benefits/workforce planning |
| LMS | 6.8 | Entitlements/prerequisites/progress/quizzes/certificates؛ لا SCORM/xAPI/LTI/proctoring |
| Attendance & Dokki | 6.9 | سجل حضور immutable وربط فرع/جولات؛ لا biometric/geofencing/rules engine |
| Customer Service | 7.0 | Routing/SLA/CSAT وتذاكر مترابطة؛ لا omnichannel ingest أو business-hours SLA |
| Online Follow-up | 6.8 | Branch scope وpresence ومؤشرات موحدة؛ لا cadence/attribution/coaching بمستوى CRM عالمي |
| SaaS | 5.2 | Tenants/plans/quotas/domains موجودة؛ metering/proration/dunning/tax ناقصة |
| Authentication & Permissions | 7.6 | Tenant/session/MFA/IP/OTP أقوى؛ يعتمد إنتاجيًا على secrets وRedis وproxy/geo مضبوطين |
| API/Database Architecture | 7.3 | عقود واختبارات وعزل قوي؛ ملفات Routes كبيرة وlive migration proof مطلوب |

## جاهزية أدوار الموظفين

| الدور | النطاق الخادمي | الحالة |
|---|---|---|
| Admin/Manager | Tenant كامل؛ Platform Admin منفصل | ⚠️ العقد ناجح، إعادة UAT على staging مطلوبة |
| Online Manager | Online clients/CRM/courses والمال حسب permission | ⚠️ |
| Sales/Collection Manager | CRM والعملاء والفريق والمال حسب permission | ⚠️ |
| Sales | `assigned_sales` | ⚠️ |
| Collection | `assigned_cs` + maker/checker | ⚠️ |
| Support | Department/assignment-scoped tickets + عميل مرتبط | ⚠️ |
| Reception/Manager Dokki | `branch:DAQQI` | ⚠️ |
| HR | HR فقط؛ بلا Customer scope | ⚠️ |
| Accountant | Financial tenant/branch scope | ⚠️ |
| Consultant | العملاء/الاستشارات المسندة | ⚠️ |
| Trainer/Instructor | Course/self-HR scope | ⚠️ |

`⚠️` لا تعني وجود كسر معروف في الدور؛ معناها إن آخر تعديل يحتاج Browser/API UAT بحساب فعلي على الـstaging الجديد.

## رحلة العميل

| المرحلة | حالة الكود | مصدر الحقيقة | المتبقي قبل الإنتاج |
|---|---|---|---|
| Landing → Registration | ✅ | `users` + `leads` | Geo/proxy وDB live proof |
| Lead → Assignment → Follow-up | ✅ | leads/pipeline/interactions/tasks | WhatsApp live delivery |
| Course/Booking | ✅ | catalog/orders | Catalog EGP/SAR/USD completeness |
| Manual Payment | ✅ | payments | Staging transaction/reconcile |
| Accounting | ✅ | journal header/lines | Migration 150–159 + live reconciliation |
| Enrollment/LMS | ✅ | entitlements/enrollments | End-to-end account UAT |
| Certificate | ✅ | completion/certificate lifecycle | Paid→complete→issue→public verify UAT |
| Paymob | ⏸️ | معطل عمدًا | Provider review ثم sandbox/webhook replay/live test |

## موانع الإنتاج المثبتة الآن

| الأولوية | المانع | المطلوب لإغلاقه |
|---|---|---|
| P0 | MySQL غير متاحة في فحص اليوم | Managed staging، migrations 150–159، checksums، reconcile وTenant A/B |
| P0 | `AUDIT_HMAC_SECRET`/`SESSION_BINDING_SECRET`/`OTP_HMAC_SECRET` ليست Secrets إنتاجية مُدارة | مفاتيح مستقلة 48+ حرفًا من Secret Manager |
| P0 | Redis غير مفعل | `rediss://` مُدار، region evidence، failover وqueue/rate-limit smoke |
| P1 | Sentry وincident webhook وrelease tag غير جاهزين | DSN + HTTPS channel + live alert |
| P1 | Data Residency غير موثق | Provider/region/evidence SHA-256/verified date |
| P1 | WhatsApp غير جاهز | Credentials + outbound acceptance + delivery receipt |
| P1 | Geo/proxy production policy ناقصة | Trusted geo headers/provider + exact proxy hops |
| P1 | Login/API p95 الحي غير معاد بعد آخر تغييرات | realistic concurrency + CPU/DB pool profiling |
| P0 عند التفعيل | Paymob | يظل Disabled حتى المراجعة وإثبات E2E |

## خطة الإغلاق

1. Provision staging مطابق للإنتاج: MySQL + Redis + Secret Manager + Sentry + alert webhook.
2. تطبيق migrations 150–159 وتشغيل `verify-migrations` وschema snapshot وreconciliation.
3. تشغيل Production Readiness حتى تكون كل البنود Pass باستثناء Paymob Skip المعتمد.
4. إعادة Tenant A/B و14-role Browser/API UAT، ثم رحلة Registration→Certificate.
5. اختبار SMTP live inbox، WhatsApp delivery receipt، queue/Redis failover وbackup/restore drill.
6. Load/soak test بأهداف أولية: reads p95 <400ms، writes p95 <700ms، login p95 <1.5s مع bcrypt cost 12.
7. إصدار Release Candidate فقط بعد صفر P0 وصفر regression؛ عدم تسويق SaaS/ERP كمنتج مؤسسي كامل.

## الخلاصة

لا توجد حاليًا أخطاء معروفة فاشلة في بوابة الكود المحلية، لكن **ده لا يساوي جاهزية 100% للإنتاج**. أقوى أجزاء النسخة: CRM core، الـmanual payment→ledger→entitlement contract، العزل والصلاحيات، ورحلة LMS الأساسية. أضعف أجزاء المنتج مقارنة بالمنصات العالمية: SaaS billing/metering، ERP المؤسسي، interoperability في LMS، والاعتماد على خدمات إنتاج لم تُجهز بعد. القرار الحالي: **No-Go للإطلاق العام، وقريب من Release Candidate بعد إغلاق بيئة التشغيل وإعادة الـUAT الحي**.
