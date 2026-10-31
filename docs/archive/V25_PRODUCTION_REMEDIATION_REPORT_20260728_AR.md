# تقرير معالجة أخطر بنود الإنتاج — نسخة 25

التاريخ: 2026-07-28  
النطاق: `D:\mahadnafsy25`  
القرار الحالي: **الكود وRelease Candidate المحلي اجتازا بوابات الجودة وقاعدة البيانات ورحلة العميل، لكن Production Go-Live ما زال NO-GO. آخر تشغيل نجح في 9 فحوص وفشل في 13 مدخل نشر خارجي مع تخطي Paymob عمدًا.**

## تحديث الإغلاق الهندسي — 29 يوليو 2026

آخر نتيجة موثقة هي **508 اختبارات: 507 PASS، صفر FAIL، و1 TODO متعمد لـPaymob**، مع نجاح:

- `npm run qa:launch`: API lint + Admin/Client TypeScript + Unit Tests + 56/56 Quality + production builds.
- Dependency gate للـAPI/Admin/Client؛ الاستثناء المؤقت الوحيد advisory موثق ومؤرخ لـReact Router حتى 30 سبتمبر 2026.
- Smoke على API منفصل بمنفذ 3101 وMariaDB معزولة بمنفذ 3307: HTTP وLive DB وReconciliation كلها نجحت.
- Fresh migration وverification حتى 148 وDB integration وUAT كامل نفذت فعليًا، وليست نتائج Static.

أهم ما أُغلق في الجولة الأخيرة:

1. حفظ Orders/Transfers وطلبات الانضمام أصبح server-first، ولا تظهر رسالة نجاح قبل الحفظ الفعلي.
2. طلب الانضمام يعتمد على العملية الذرية في الـAPI لربط `join_us_applications` بمسار HR، بدل Lead محلي غير محفوظ.
3. إنشاء/تعديل المعالج وجدوله أصبح Transaction واحدة، وإنشاء الاستشارة الجديدة يربط Lead جديدًا داخل Transaction واحدة عند الحاجة.
4. حساب الموظف وبيانات staff/user يحفظان في Transaction واحدة، وإعادة ضبط كلمة المرور أصبحت privileged server-generated.
5. بوابة المعالج أصبحت مرتبطة بحساب Staff وصلاحية وتعيين الاستشارة، بلا login محلي أو كلمات مرور بوابة وهمية.
6. إشعارات العميل وقراءة المحاضرات/الفصول/الملاحظات والجلسات الحية أصبحت server truth.
7. كل async routes أصبحت محمية مركزيًا من rejected Promises في Express 4.
8. `/api/admin` يتحقق من الهوية قبل feature gate المعتمد على DB؛ لذلك يظل الرد 401 صحيحًا حتى عند تعطل MySQL.
9. مفاتيح Gemini/OpenAI/Claude لم تعد تخرج إلى المتصفح؛ كل الاستدعاءات تمر عبر server proxy محكوم بالصلاحية والـrate limit والـtimeout والحدود.
10. أداة UAT أصبحت prerequisite-aware: لا تسجل `PASS` عند صفر tokens ولا تنتج cascade failures بعد غياب API/DB.

القرار لم يتغير إلى Go-Live: **الكود وMariaDB المحلية والـUAT مثبتة، لكن الجاهزية الإنتاجية 100% غير مكتملة لأن Redis/Secret Manager/Sentry/WhatsApp/Data Residency وFX الحي وبيانات منصة النشر ليست موارد متاحة في البيئة الحالية.**

## النتيجة التنفيذية

| البند | الحالة المثبتة | الدليل |
|---|---|---|
| MySQL staging + migrations | ✅ قاعدة RC نظيفة: baseline=35، applied=110، failed=0؛ تحقق 144–148 ناجح | `api/lib/migrationRunner.js` و`api/tools/verify-migrations.cjs` |
| Audit HMAC | ⚠️ مسار حقن آمن واختبار التشفير مكتمل؛ Secret Manager الإنتاجي غير موفر | `api/lib/secretResolver.js` و`api/lib/productionConfig.js:36` |
| Redis | ⚠️ التكامل الموزع والـfailover مثبتان محليًا؛ Managed `rediss://` غير موفر | `api/lib/rateLimitStore.js` و`api/lib/productionConfig.js:85` |
| Tenant A/B + roles + journey | ✅ 54/54 و17 حسابًا على Release Candidate بعد migration 148 | `api/tools/uat-full-smoke.cjs` |
| Sentry + incident webhook | ⚠️ الكود والاختبار الصناعي مكتملان؛ DSN وWebhook الحقيقيان غير موفرين | `api/lib/errorMonitor.js` |
| Data residency | ❌ لا يمكن إثباتها بلا مستند مزود حقيقي وتاريخ وSHA256 | `api/lib/productionConfig.js:117` و`api/docs/DATA_RESIDENCY_EVIDENCE.md` |
| WhatsApp | ⚠️ التوقيع وdelivery receipts وDB E2E مكتملة؛ الاعتمادات الحية غير موفرة | `api/routes/whatsapp-webhook.js:18` وmigration 147 |
| Login/API p95 | ✅ القياس المحلي للإصدار الحالي: Login 785ms، Leads 73ms، Manual Payment 27ms | `api/tools/load-smoke.cjs` |
| Paymob | ✅ موقوف fail-closed لحين مراجعة المزود | `api/lib/saasSettings.js:108` |
| SaaS/ERP claims | ✅ منع ادعاء Enterprise SaaS/Full ERP مطبق | `api/lib/productionConfig.js:106` و`api/docs/PRODUCT_CAPABILITY_BOUNDARIES.md` |

## المشاكل التي ظهرت أثناء الإغلاق وتم علاجها

1. كان login يحتفظ باتصال MySQL أثناء `bcrypt` ثم ينتظر audit يحتاج اتصالًا آخر؛ تحت حمل يساوي حجم الـpool حدث circular wait و408. تم تحرير الاتصال قبل `bcrypt` والـaudit في `api/routes/auth.js:662-682`.
2. كان outbox يعتبر نتيجة WhatsApp `{ok:false}` إرسالًا ناجحًا. أصبح يرفضها ويسجل provider/message id وحالة التسليم في `api/lib/outbox.js:79-97`.
3. لم تكن delivery receipts محفوظة. أضيفت migration `147_v25_whatsapp_delivery_receipts.sql` ومسارات Meta/Green API الموقعة وحالة monotonic حتى `read`.
4. إضافة WhatsApp route كسرت عقد route registry (59 فعليًا مقابل 58 متوقعًا). تم تحديث العقد وإضافة إثبات وجود المسار.
5. كشفت Quality Gate أن 3 WhatsApp webhooks عامة بلا limiter. أضيف limiter موزع مخصص في `api/middleware/rateLimits.js:92` لكل المسارات في `api/routes/whatsapp-webhook.js`.
6. migrations 141/142 لم تكن idempotent بالكامل، وMySQL 8.4 رفض generated FK-dependent columns في 146. تم تحويلها إلى schema قابل للتطبيق المتكرر مع CHECK constraints.

## نتائج الاختبارات الفعلية

| الاختبار | النتيجة |
|---|---:|
| Targeted journey/tenant contracts | 21/21 PASS |
| MySQL integration | 5/5 PASS |
| UAT رحلة العميل + الأدوار + Tenant A/B | 54/54 PASS |
| كل Unit Tests | 508 إجماليًا: 507 PASS، 0 FAIL، 1 TODO متعمد لـPaymob |
| Quality gates | 56/56 PASS |
| Admin/Client TypeScript | PASS |
| Admin production build | PASS |
| Client production build | PASS |
| Browser E2E: Public/Client/Admin/16 staff roles | 39/39 PASS |
| WhatsApp signed receipt DB smoke | Meta delivered + Green read PASS |
| Queue dead-worker recovery | PASS؛ أعيد claim في المحاولة 2 واكتمل |

اختبار الحمل الأخير على Release Candidate المحلية، concurrency=8:

| العملية | العدد | الأخطاء | p50 | p95 | الحد |
|---|---:|---:|---:|---:|---:|
| Login | 26 | 0 | 712ms | 785ms | 3000ms |
| Admin leads API | 24 | 0 | 47ms | 73ms | 500ms |
| Manual payment write | 3 | 0 | 23ms | 27ms | 1000ms |

هذه أرقام staging محلية وليست بديلًا عن قياس production من نفس المنطقة وتحت traffic حقيقي.

## Backup / Restore الفعلي

- أزيل مسار backup قديم مكرر من `api/server.js` كان يستخدم shell ويقرأ `DB_PASS` بدل `DB_PASSWORD`.
- `api/lib/dbBackup.js` أصبح مسارًا واحدًا يستخدم `spawn` بلا shell، ولا يضع كلمة المرور في command line.
- الكتابة أصبحت atomic عبر ملف `.partial` مع SHA-256 sidecar ودوران متزامن للنسخة والـchecksum.
- أضيف `npm --prefix api run restore:rehearsal` مع guard صريح قبل إنشاء/حذف قاعدة مؤقتة.
- التمرين الفعلي أعاد **173 جدولًا**؛ counts للجداول الأساسية وchecksums migrations 144–147 متطابقة.
- تم التحقق من حذف قاعدة التمرين المؤقتة بعد النجاح: صفر قواعد متبقية بالـprefix المخصص.

## Dependency audit

- API: صفر ثغرات production.
- Admin وClient: npm يسجل advisory عاليًا في React Router 7.18.1.
- التطبيق يستخدم Declarative `BrowserRouter` ولا يستخدم unstable RSC APIs المتأثرة؛ بوابة الاعتماد تقبل هذا الاستثناء المحدد مؤقتًا فقط وتنتهي في 2026-09-30.
- يلزم الانتقال إلى إصدار React Router patched متوافق واختباره قبل انتهاء الاستثناء؛ لا يصح تنفيذ downgrade آلي يقترحه npm إذا كان سيعيد ثغرات أقدم.

## Production readiness الصادق

آخر تشغيل للبوابة بوضع `NODE_ENV=production` في البيئة الحالية:

- 23 فحصًا: **5 PASS، 1 SKIP (Paymob)، 17 FAIL**.
- تشمل العوائق: غياب MySQL للتحقق من migrations وFX وSaaS entitlements والـdurable queue، وإعداد product tier، وAudit Secret Manager evidence، وData Residency evidence، وWhatsApp live credentials، وSentry DSN، وincident webhook، و`APP_RELEASE`، و`UV_THREADPOOL_SIZE`، وManaged Redis TLS للـqueues والـrate-limit.
- Paymob سيظل disabled ولن يفتح قبل مراجعة المزود وE2E حقيقي.
- لا يجوز وصف المنتج حاليًا بأنه Enterprise SaaS أو Full ERP؛ الوصف المسموح هو `multi-tenant-pilot` أو `institute-suite`.

## المطلوب خارجيًا لإغلاق الـNO-GO

1. إنشاء secret مستقل 48+ حرفًا في AWS/GCP/Azure/Vault وتوفير provider/reference/rotation date بدون إرسال قيمة السر في تقرير أو Git.
2. توفير Managed Redis إقليمي بعنوان `rediss://` ثم إعادة failover ضد عقدتين فعليتين.
3. توفير Sentry project DSN وincident webhook حقيقي وتجربة alert مرتبطة بـrelease.
4. توفير مستند مزود الاستضافة الذي يثبت account/resource/region، وتاريخ المراجعة وSHA256 للملف.
5. توفير WhatsApp provider credentials ورقم اختبار ثم تشغيل `readiness:production:live` حتى وصول delivered/read receipt.
6. بعد ذلك فقط: production soak، restore rehearsal، rollback rehearsal، واعتماد Go/No-Go.

## الحكم

- **جاهزية الكود الساكن:** بوابة الجودة ناجحة. **جاهزية Release Candidate المتصل بقاعدة البيانات:** غير مثبتة بعد migration 148.
- **جاهزية الإنتاج 100%:** لا، والقول غير ذلك غير صحيح.
- **السبب المتبقي:** جزء خارجي من موارد واعتمادات وأدلة إنتاجية، وجزء تحقق تشغيلي متوقف بسبب عدم توفر MySQL في البيئة الحالية.
- **جاهزية Enterprise SaaS/Full ERP:** لا؛ ما زالت metering/institute billing وAP/AR subledgers والأصول والضرائب متطلبات منتج مستقلة.

## تحديث الإغلاق الهندسي الأخير — ARC-01

- تم تقليل `api/server.js` من **708 إلى 70 سطرًا**؛ الملف الآن مسؤول فقط عن bootstrap، انتظار migrations، تشغيل HTTP، وربط وحدات التشغيل.
- نُقلت كل مواعيد الـjobs والـworker/outbox إلى `api/lib/backgroundScheduler.js`، ونُقلت أعمال التذكير وFX وretargeting وwaitlist إلى `api/lib/scheduledJobHandlers.js`.
- أُزيل من startup أي تعديل ذاتي لـ`watchdog.sh` أو PM2 dump أو crontab. أصبح systemd/container/hosting هو المسؤول الوحيد عن restart، مع guard مراقبة ذاكرة منفصل في `api/lib/productionRuntimeGuard.js`.
- تم إصلاح waitlist حتى لا يسجل `notify_sent=1` عندما يعيد مزود WhatsApp نتيجة `{ok:false}`.
- الاختبارات النهائية بعد الفصل وحماية browser cache: **452 إجماليًا، 451 PASS، صفر FAIL، و1 TODO متعمد لـPaymob**، مع **56/56 Quality** ونجاح TypeScript وproduction builds للـAdmin والـClient.
- اختبارات العقود المركزة بعد الفصل: **70/70 PASS**.
- اختبار DB: **5/5 PASS**، وTenant A/B matrix عزلت CRM وHR وLMS والمال والتشغيل.
- UAT: **49/49 PASS** وشمل **17 دور موظف** ورحلة التسجيل→Lead→تحويل→عميل→دفع يدوي→قيد→Refund→فرع→Support.
- Queue smoke: استعادة job من worker متوقف وإتمامها في المحاولة الثانية بنجاح.
- Backup/restore: استعادة **173 جدولًا**، counts وchecksums 144–147 متطابقة، ثم حذف قاعدة الاختبار المؤقتة.
- حمل staging النهائي (concurrency الافتراضي للاختبار): login ‏p95 **631ms**، Admin leads API ‏p95 **48ms**، manual payment ‏p95 **30ms**، وصفر أخطاء.
- Dependency gate: API بلا advisories إنتاجية؛ استثناء React Router المحدد لـRSC فقط ما زال مؤقتًا حتى 2026-09-30 ويجب إلغاؤه فور توفر الإصدار المتوافق المصحح.
- رُفعت نسخة cache للـClient إلى v4 وحُذفت منه بيانات العملاء والـLeads والموظفين والاستشارات والنشاط والطلبات التشغيلية والاختبارات؛ localStorage أصبح public catalog فقط مع اختبار عقد يمنع رجوع هذا التسريب.

## تحديث الإغلاق المحلي الأخير — Community وClient Runtime

- أصبحت تفاعلات Community server-authoritative: likes فريدة لكل عميل، comments محفوظة، حذف ذري للبيانات التابعة، وعزل tenant، مع migration `148_v25_community_engagement_integrity.sql`.
- بوابة العميل لم تعد تنفذ Admin CRUD أو تعرض نجاحًا محليًا قبل تأكيد الخادم. كما أصبحت discounts وbroadcasts وquizzes وlive streams تُحمّل من APIs فعلية.
- أُصلح خلط إشعارات النظام مع محرر رسائل الإدارة، وأصبحت عمليات حفظ broadcasts وdiscounts تعرض فشل الخادم بدل النجاح الوهمي.
- `client/context/SiteDataContext.tsx` أصبح **556 سطرًا**، و`admin/context/SiteDataContext.tsx` **780 سطرًا**، و`api/server.js` **70 سطرًا**.
- `UnifiedClientPage.tsx` انخفض إلى **1435 سطرًا**، وchunk الصفحة من نحو **211.56KB إلى 73.88KB raw**؛ التفكيك تحسن لكنه لم يصل بعد لهدف أقل من 700 سطر.
- آخر `npm run qa:launch`: **462 إجماليًا، 461 PASS، صفر FAIL، و1 TODO متعمد لـPaymob**؛ Quality **56/56**، وAPI lint وTypeScript وproduction builds ناجحة.
- أمر migrations أصبح fail-closed: يرجع exit code غير صفري عند غياب MySQL بدل نجاح زائف.

## نتيجة بوابة الإنتاج بعد آخر تشغيل

**23 فحصًا: 5 PASS، 1 SKIP متعمد لـPaymob، 17 FAIL.**

لا يمكن تحويل هذه النتيجة إلى PASS من داخل الكود وحده. يلزم تشغيل MySQL وتطبيق 148 وفحص checksums، ثم توفير product tier وSecret Manager evidence وData Residency evidence وWhatsApp credentials وSentry DSN وincident webhook و`APP_RELEASE` و`UV_THREADPOOL_SIZE` وManaged Redis إقليمي عبر TLS. وضع placeholders لإظهار نجاح زائف مرفوض.

## تحديث 29 يوليو 2026 — إغلاق Admin AI والدقي وClient Portal

- أُغلق تسريب بيانات العملاء إلى مزودي Admin AI: السياق المرسل أصبح إحصاءات مجمعة فقط، مع تنقية server-side للبريد والهاتف والمعرّفات والـtokens، وفصل `systemInstruction` الخاص بـGemini، وAudit لا يسجل محتوى الطلب.
- أُزيل تخزين محادثات Admin AI من `localStorage`، وحُذف Hook ميت بالكامل؛ انخفض `AskAITab.tsx` من **602 إلى 453 سطرًا**.
- فُصلت قاعدة عملاء الدقي إلى `DaqqiClientsPanel.tsx`، فانخفض `DaqqiScheduleTab.tsx` من **1495 إلى 1272 سطرًا**.
- زر أرشفة عميل الدقي أصبح محكومًا بـ`delete_subscribers` ويستخدم Action المركزي الذي يعكس الواجهة عند فشل الخادم؛ لم يعد ينفذ طلبًا مباشرًا ويترك الشاشة بحالة كاذبة.
- نُقل تسكين العميل بين الروندات إلى Endpoint النقل الذري؛ لم يعد حذف الروند القديمة يحدث محليًا مع حفظ الروند الجديدة وحدها. أُزيل مكوّن تسكين مكرر غير مستخدم.
- أُزيل زر صورة العميل المحلي لأنه لم يكن يحفظ في قاعدة البيانات، وأصبح Support Portal يعتمد Cookie session بدل استخراج token من `localStorage`، مع معالجة network failure بدون تعليق زر الإرسال.
- أُزيل placeholder ميت في Content Hub لم يكن يمكن الوصول إليه.
- حفظ إعدادات الـTenant أصبح Transactional: دمج الإعدادات وحفظها وكتابة `admin.settings.updated` يتم على Connection واحدة مع `commit/rollback`، والـAudit يسجل أسماء الأقسام فقط؛ كما صُنّف Blob الإعدادات المجمعة Secret لمنع تسريب credentials.

نتيجة بوابة الإطلاق بعد هذه التغييرات:

| البوابة | النتيجة |
|---|---:|
| Unit tests | **496 إجماليًا: 495 PASS، 0 FAIL، 1 Paymob TODO** |
| Quality | **56/56 PASS** |
| API lint | PASS |
| Admin TypeScript + production build | PASS |
| Client TypeScript + production build | PASS |
| Dependency gate | PASS للثلاثة؛ استثناء React Router المحدد ينتهي 2026-09-30 |
| HTTP smoke على API 3101 | كل فحوص non-DB نجحت؛ DB-backed صُنفت BLOCKED لأن MySQL يرفض الاتصال |
| Production readiness | **5 PASS، 1 Paymob SKIP، 17 FAIL خارجية/تشغيلية** |

خدمة الاختبار 3101 أُوقفت بعد الفحص، وخدمة المستخدم الأصلية على 3001/PID 17936 لم تُمس. لا يوجد فشل كود معروف في البوابات المنفذة، لكن لا تزال عبارة “Production 100%” غير صحيحة قبل توفير MySQL staging والموارد والاعتمادات والأدلة الإنتاجية المذكورة أعلاه.

## تحديث 29 يوليو 2026 — إغلاق عقد رحلة العميل على قاعدة MariaDB نظيفة

- شُغلت MariaDB 11.4 مع قاعدة Release Candidate جديدة، ونُفذت migrations بنتيجة `baseline=35, applied=110, failed=0`. تحقق migrations 144–148 نجح مع تطابق checksums والـindexes والـconstraints المطلوبة.
- أُغلق المسار الفعلي: Public registration → Lead dedupe/assignment/attribution → Sales conversion بلا منح كورس قبل الدفع → Client login → server-priced idempotent Order → manual Proof → Accountant approval → Payment + balanced Journal + Enrollment → Progress → Completion → Certificate → Refund + reversal + revoke.
- Paymob ما زال fail-closed بقرار المنتج؛ UAT أثبت HTTP 503 وعدم كتابة أي Order عند محاولة الحجز القديم وهو disabled.
- Timeline العميل الموحدة تعرض Order/Payment/Learning/Certificate/Support للعميل والإدارة والموظف، وتحجب amount/currency عن Sales غير المالي.
- Funnel الإدارة أصبح cohort-based من `leads.id` عبر `subscribers.lead_id` إلى الدفع والتعلم والشهادة، بدل خلط تواريخ الـLead مع بيانات all-time.
- `reconcile` بعد الرحلة وبعد اختبار الحمل: صفر مخالفات حرجة. DB integration: **5/5 PASS** ويشمل Tenant A/B على SaaS وCRM وHR وLMS والمال والتشغيل.
- UAT النهائي: **54/54 PASS** ويشمل **17 حساب/دور**، الصلاحيات الإيجابية والسلبية، الفرع، الدعم، HR، المال، بوابة العميل، والشهادة والاسترداد.
- Browser E2E النهائي: **39/39 PASS** للـPublic site، Client login/payment surfaces، Admin login، ورندر 16 دور موظف بلا أخطاء React قاتلة.
- اختبار الحمل المحلي، concurrency=8: Login p95 **785ms**، Leads API p95 **73ms**، manual payment p95 **27ms**، وصفر أخطاء.
- أُصلح ضغط الفروع خلف NAT: Public GET/HEAD له حد قابل للضبط افتراضيه 600 لكل endpoint/دقيقة، بينما الكتابات بقيت 60؛ اختبار سلوكي أثبت GET رقم 61 ناجحًا وPOST رقم 61 مرفوضًا 429.
- بوابة الجودة النهائية: **508 اختبارات: 507 PASS، صفر FAIL، و1 TODO متعمد لمسار Paymob المؤجل**؛ Quality **56/56**، API lint وAdmin/Client TypeScript وproduction builds كلها PASS.
- Dependency gate نجح للـAPI/Admin/Client؛ استثناء React Router المؤقت والمحدد لـRSC فقط ينتهي في 2026-09-30.

### الحكم التشغيلي المحدّث

بوابة الإنتاج أصبحت **9 PASS، 1 SKIP لـPaymob، 13 FAIL**. تم إثبات MySQL والمigrations وSaaS entitlements والـdurable queue محليًا، لكن البنود الثلاثة عشر الباقية ليست أخطاء كود يمكن إخفاؤها بقيم وهمية: تصنيف نشر فعلي، Audit Secret Manager evidence، Data Residency evidence، FX provider حي، WhatsApp credentials، Sentry، incident webhook، release identity، UV thread-pool في منصة النشر، وManaged Redis إقليمي عبر TLS. لذلك الكود وRelease Candidate المحليان اجتازا البوابات المنفذة، أما اعتماد Production 100% فما زال **NO-GO خارجيًا** حتى حقن الأدلة والموارد الحقيقية وتشغيل `readiness:production:live`.
