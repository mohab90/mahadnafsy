# تقرير الجاهزية الهندسية والتشغيلية النهائي — Mahad v25

تاريخ القياس: 26 يوليو 2026  
النطاق: الكود الحالي + MySQL 8.4 + API + Admin + Client + Chromium.  
الاستثناء المتفق عليه: Paymob وتجزئة الدفع غير داخلين في حكم الجاهزية الحالي.

## الحكم التنفيذي

النسخة بقت جاهزة وظيفيًا بدرجة عالية للتشغيل الداخلي ومسار الدفع اليدوي، ومفيش حاليًا مخالفة حرجة معروفة في رحلة العميل أو الـtenant isolation أو الـledger reconciliation بعد آخر دورة اختبار. لكنها **مش Production 100% لسه** لأن بوابة إعدادات الإنتاج نفسها فشلت في 6 بنود بنية خارجية، بالإضافة إلى Paymob المؤجل. التقييم الإجمالي الحالي: **88/100**، وجاهزية المسارات اليدوية الأساسية: **92%**.

## نتائج بوابات الإصدار

| البوابة | النتيجة |
|---|---:|
| API Unit/Contract | 406 ناجح، 0 فشل، 1 Paymob TODO |
| DB Integration | 5/5 ناجح |
| Quality/Security Static | 56/56 ناجح |
| Tenant Scanner | 0 مخالفة عبر 148 جدولًا |
| Duplicate Routes | 0 |
| Admin TypeScript + Build | ناجح |
| Client TypeScript + Build | ناجح |
| Dependency Gate | ناجح؛ استثناء React Router RSC مؤقت حتى 2026-09-30 |
| API/DB UAT | 48/48 ناجح |
| Employee Chromium Render | 16/16 حسابًا ناجحًا |
| Full Playwright | 36/36 ناجح |
| Finance Reconciliation | 0 مخالفة حرجة |
| Load Smoke | 0 خطأ؛ CRM p95=53ms؛ manual payment p95=25ms |
| Production Readiness | 5/12 ناجح؛ 7 بنود إعداد خارجية غير مغلقة، أحدها Paymob المؤجل |

## تقييم الأقسام

| القسم | المنطق | قاعدة البيانات | الترابط | الأمان | الأداء | التوسع | التقييم |
|---|---:|---:|---:|---:|---:|---:|---:|
| CRM | 9.3 | 9.2 | 9.4 | 9.1 | 9.0 | 8.8 | 9.2 |
| Client Portal | 9.1 | 9.2 | 9.3 | 9.0 | 8.6 | 8.7 | 9.0 |
| Payments اليدوي | 9.3 | 9.4 | 9.5 | 9.2 | 9.2 | 8.8 | 9.2 |
| Finance & Accounting | 9.4 | 9.5 | 9.4 | 9.3 | 9.1 | 8.9 | 9.3 |
| HR | 9.2 | 9.3 | 9.1 | 9.2 | 8.8 | 8.7 | 9.1 |
| LMS | 9.3 | 9.3 | 9.4 | 9.1 | 8.7 | 8.9 | 9.2 |
| Admin Dashboard | 9.0 | 9.1 | 9.2 | 9.0 | 8.2 | 8.1 | 8.8 |
| Employee System | 9.3 | 9.1 | 9.4 | 9.3 | 8.7 | 8.8 | 9.2 |
| SaaS Settings | 9.0 | 9.2 | 9.0 | 9.2 | 8.6 | 8.8 | 9.0 |
| Authentication/Permissions | 9.3 | 9.1 | 9.3 | 9.2 | 7.8 | 8.7 | 8.9 |
| Notifications | 8.9 | 9.0 | 9.0 | 9.0 | 8.7 | 8.4 | 8.8 |
| Orders | 9.2 | 9.3 | 9.4 | 9.2 | 9.0 | 8.8 | 9.2 |
| Public Website | 9.0 | 9.0 | 9.2 | 9.0 | 8.5 | 8.6 | 8.9 |
| Database Layer | 9.2 | 9.5 | 9.4 | 9.3 | 9.0 | 8.9 | 9.2 |
| API Layer | 9.1 | 9.2 | 9.3 | 9.2 | 8.8 | 8.7 | 9.1 |

## رحلة العميل الفعلية

| المرحلة | الحالة | التخزين/المصدر | الظهور والترابط | التقييم |
|---|---|---|---|---:|
| Landing/Registration | ✅ | users + subscribers + leads | Website ثم CRM بنفس tenant | 9.2 |
| Lead Creation | ✅ | leads + lead_timeline | Admin/Employee مع assignment وSLA | 9.4 |
| CRM Assignment | ✅ | assigned_sales_id + policy | نطاق Sales الفعلي مختبر | 9.3 |
| Sales Follow-up | ✅ | timeline/tasks/communications | النشاط موحد ومقيد بالصلاحية | 9.2 |
| Course Selection | ✅ | courses/bundles/prerequisites | السعر والاستحقاق من الخادم | 9.2 |
| Booking/Order | ✅ | orders + item snapshot | أدوار التشغيل ترى النطاق الصحيح | 9.2 |
| Manual Payment | ✅ | payments | مرتبط بالعميل/الفرع/الموظف | 9.3 |
| Accounting Entry | ✅ | journal_entries + lines | نفس Transaction؛ المصالحة صفر | 9.5 |
| Enrollment | ✅ | enrollments + entitlement_events | لا وصول من UI state | 9.4 |
| Client Dashboard | ✅ | Server APIs | الدفع والكورس والدعم والشهادة | 9.2 |
| Completion | ✅ | progress + course_completions | Idempotent ومتطلبات الخادم | 9.3 |
| Certificate | ✅ | completion/lifecycle/payment link | إصدار/إلغاء/إعادة إصدار وتحقق عام | 9.2 |
| Paymob | ⏸️ مؤجل | — | انتظار المراجعة الرسمية | خارج التقييم |

أهم أدلة التنفيذ:

- الانتقال المركزي لحالة الـLead: `api/lib/leadState.js:9`، والتحويل الذري: `api/routes/admin/leads.js:708`.
- تسجيل الدفع والـjournal في نفس المعاملة: `api/routes/subscriber-payments.js:136` و`api/routes/subscriber-payments.js:294`.
- تأكيد الطلب المالي: `api/lib/orderPaymentConfirmation.js:23`.
- Refund reversal: `api/lib/refunds.js:97` و`api/lib/refunds.js:126`.
- الاستحقاق والتقدم والشهادة: `api/lib/courseCompletion.js:12` و`api/lib/learningPrerequisites.js:17`.

## جاهزية حسابات الموظفين

| الدور | نطاقه الفعلي | أهم ما يراه | الحالة |
|---|---|---|---:|
| Admin | كل الـTenant | كل الأقسام والإعدادات | ✅ 9.5/10 |
| Manager | كل الـTenant | الإدارة والمال والموظفين | ✅ 9.4/10 |
| Online Manager | كل الـTenant | CRM/Online Clients/Courses/Finance | ✅ 9.1/10 |
| Sales & Collection Manager | كل الـTenant | Leads/Clients/Team/Finance | ✅ 9.1/10 |
| Sales | assigned_sales | Leads/Clients/Orders المسندة | ✅ 9.2/10 |
| Collection | assigned_cs | عملاء/تحصيل/Orders المسندة | ✅ 9.2/10 |
| Support Online/Daqqi | assigned_cs | Inbox/Tickets/Clients/Orders read-only | ✅ 9.1/10 |
| Reception Daqqi | branch:DAQQI | عملاء وجدول وطلبات الدقي | ✅ 9.0/10 |
| Daqqi Manager | branch:DAQQI | تشغيل ومال الفرع | ✅ 9.2/10 |
| HR/Recruiter | HR only | موظفين/توظيف/رواتب/سياسات | ✅ 9.2/10 |
| Accountant | tenant financial | Payments/Ledger/Refunds/Orders | ✅ 9.4/10 |
| Consultant | assigned_sales | Calendar والعملاء المرتبطين | ✅ 8.8/10 |
| Trainer | course scope | Courses/Lectures/Self-service | ✅ 8.7/10 |
| Instructor | course scope | Courses/Lectures/Self-service | ✅ 8.7/10 |

المصدر المركزي للأدوار والنطاقات: `api/constants/permissions.js:110` و`api/constants/permissions.js:232`.  
تطبيق الصلاحية في الخادم: `api/middleware/auth.js:272` و`api/middleware/auth.js:299`.  
تفاصيل كل حساب واختباراته موجودة في `EMPLOYEE_ROLE_READINESS_REPORT_20260726.md`.

## إصلاحات الجولة الأخيرة

| ID | المشكلة | الملف والسطر | السبب الجذري | التأثير قبل الإصلاح | الحل |
|---|---|---|---|---|---|
| EMP-01 | Orders كانت Admin-only رغم ظهورها للموظف | `api/routes/orders.js:29` | عدم تطابق UI/RBAC/API | زر موجود لكن الطلب يُرفض أو يرى نطاقًا غلط | Permission + financial scope |
| EMP-02 | PATCH عام يقدر يغيّر تاريخ مالي | `api/routes/orders.js:232` | خلط order state مع payment state | Ledger drift | منع التعديل بعد التاريخ المالي |
| EMP-03 | تأكيد الدفع كان Action محلي غير صحيح | `admin/pages/dashboard/tabs/OrdersTab.tsx` | UI استخدم PATCH بدل confirm workflow | دفع لا يظهر صح في باقي الأقسام | ربط confirm-payment الحقيقي |
| EMP-04 | اعتماد الموظف لنفس العملية | `api/routes/orders.js:168` | Maker/checker كان UI فقط | Fraud/control risk | فرض segregation في API |
| SEC-14 | activity_logs بلا tenant | `api/migrations/139_v25_activity_log_tenant_integrity.sql:1` | Schema قديم مشترك | تسريب سجل نشاط بين المؤسسات | tenant_id + scoped reads/writes |
| OPS-01 | أرشفة activity تستخدم timestamp غلط وبلا Transaction | `api/lib/archiveJob.js:14` | Drift مع schema | فقد أو حذف جزئي | Transaction + العمود `at` |
| OPS-02 | HR retention موجود في ملف ميت | `api/lib/hrAuditRetentionJob.js:33` و`api/server.js:344` | اختبار وجود لا اختبار wiring | سياسة الاحتفاظ لا تعمل إنتاجيًا | Job مستقل ومسجل فعليًا |
| SEC-15 | تسجيلات الدخول الناجحة تستهلك حد فرع كامل | `api/middleware/rateLimits.js:52` | IP limiter يحسب success | منع موظفين خلف NAT | حساب المحاولات الفاشلة فقط |
| ARC-01 | Bootstrap متضخم ومتكرر | `api/lib/httpApp.js:67` و`api/lib/registerRoutes.js:64` | Server مركزي تاريخي | صعوبة صيانة واختبار | فصل HTTP/routes/lifecycle |
| ARC-10 | نسخة Cron قديمة غير مستخدمة | `api/lib/hrAuditRetentionJob.js` | Dead duplicate | سلوك واختبارات مضللة | حذف 468 سطرًا وتوصيل المطلوب |

## البنود اللي تمنع إعلان Production 100%

| الخطورة | المشكلة | الدليل/المكان | التأثير | المطلوب |
|---|---|---|---|---|
| P0 | AUDIT_HMAC_SECRET غير إنتاجي | `api/tools/production-readiness.cjs` | سلسلة Audit غير موثوقة إنتاجيًا | Secret مستقل 48+ حرفًا في Secret Manager |
| P0 | Redis غير مفعّل للـqueues/rate limit | `api/tools/production-readiness.cjs` | تعدد النسخ قد يكرر jobs أو يضعف الحدود | Redis production + worker health |
| P1 | Sentry غير مفعّل | `api/tools/production-readiness.cjs` | أخطاء الإنتاج تعتمد على logs فقط | DSN + alert routing |
| P1 | Data residency غير موثق | `api/tools/production-readiness.cjs` | مخاطرة امتثال وتشغيل | تحديد المنطقة والتحقق منها |
| P1 | WhatsApp credentials غير جاهزة | `api/tools/production-readiness.cjs` | رسائل المتابعة لا تُرسل | Credentials + إرسال حي تجريبي |
| P1 | Login concurrent p95=3.75s | `api/tools/load-smoke.cjs` | بطء عند دخول دفعة موظفين | قياس production وCPU profiling مع الحفاظ على bcrypt |
| مؤجل | Paymob inactive | `api/server.js:300` | لا دفع إلكتروني | يفتح فقط بعد مراجعة Paymob |

## Executive Scorecard

| القسم | التقييم | الحالة |
|---|---:|---|
| Architecture | 8.3/10 | جيد جدًا؛ `server.js` وبعض React orchestration لسه كبار |
| CRM | 9.2/10 | جاهز |
| Client Portal | 9.0/10 | جاهز |
| Finance | 9.3/10 | جاهز للمسار اليدوي |
| Payments | 9.2/10 يدوي / 0 Paymob | اليدوي جاهز؛ Paymob مؤجل |
| HR | 9.1/10 | جاهز |
| LMS | 9.2/10 | جاهز |
| SaaS Settings | 9.0/10 | وظيفيًا جاهز؛ production infra ناقصة |
| Database | 9.2/10 | جاهز ومصالح |
| API | 9.1/10 | جاهز |
| Security | 8.8/10 | الكود قوي؛ secrets/Redis/Sentry تمنع 100% |
| Performance | 8.3/10 | Reads/mutations سريعة؛ login concurrency يحتاج تحسين |
| Integration | 9.3/10 | جاهز للمسارات المختبرة |
| Customer Journey | 9.2/10 | اليدوي كامل |
| Code Quality | 8.4/10 | تحسن كبير؛ ملفات Frontend كبيرة باقية |
| Overall Project | 88/100 | Release Candidate قوي، مش Production 100% |

## القرار

1. **هل النسخة جاهزة للإطلاق؟** جاهزة كـRelease Candidate وتشغيل يدوي داخلي. لا أوصي بإطلاق Production عام قبل إغلاق P0 للبنية.
2. **هل تصلح كأساس نهائي؟** نعم، المعمارية وقاعدة البيانات الحالية يصلحوا كأساس نهائي؛ المطلوب استكمال تفكيك الملفات الكبيرة لا إعادة بناء.
3. **أخطر نقاط الانفصال السابقة؟** Orders↔Payments، activity log↔tenant، HR retention↔runtime. الثلاثة اتصلحوا.
4. **أخطر المتبقي؟** Audit secret، Redis، observability، data residency، WhatsApp، أداء login المتزامن، ثم Paymob لما يفتح Gate.
5. **خطة 30 يوم:** إعداد production secrets/Redis/Sentry، اختبار إرسال فعلي، profiling لتسجيل الدخول، soak test، rehearsal للـbackup/rollback، وتوقيع UAT من أصحاب الأقسام.
6. **خطة 90 يوم:** إكمال تفكيك `server.js` وReact contexts/pages، dependency boundaries، read models للتقارير الثقيلة، HA/PITR، ثم Paymob بعد الموافقة.
7. **الخلاصة الصادقة:** النظام لم يعد Prototype مفكك؛ بقى منصة مترابطة ومختبرة بقوة للمسار اليدوي. نسبة 100% دلوقتي هتكون ادعاء غير صحيح لحد ما البنية الخارجية تتقفل.
