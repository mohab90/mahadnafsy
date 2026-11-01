# قائمة العيوب — مراجعة 31 أكتوبر 2026

التقرير الأساسي: [AUDIT_20261031_WORLD_CLASS_AR.md](AUDIT_20261031_WORLD_CLASS_AR.md). كل الخطوات على **المعمل** (`tools/lab/README.md`: MariaDB :3397 + API :3401، 601,230 ليد، 30,011 عميل، 36,683 دفعة، كلها بيانات تجريبية). الحسابات `admin@perf.test` وغيره، الباسورد في `tools/lab/lab-up.sh`. «الحالة»: **اتصلح** يعني اتصلح في الفرع بتست، **مفتوح** يعني محتاج شغل أو قرار.

**مفيش P0 مؤكد.** الأولويات: P1 وجع يومي أو خطر تشغيلي، P2 تلميع أو قرار.

---

## BUG-01 · P1 · تقرير «الإيراد جاي منين» بطيء جداً على الحجم الكبير — **اتصلح**
**الخطوات:** سجّل دخول `accountant1@perf.test` (أو admin) على المعمل، `GET /api/admin/funnel/attribution?by=source` والكاش فاضي.
**الفعلي:** 8.2 ث (admin) و15+ ث timeout مرتين متتاليتين (accountant1 بعد انتهاء الكاش). **المتوقع:** أقل من ثانيتين.
**السبب:** `leads LEFT JOIN subscribers LEFT JOIN payments GROUP BY` على كل الـ601 ألف ليد، وفيهم 20 ألف بس ليهم عميل. `api/routes/funnel.js:93-130`.
**الإصلاح:** قراءتين مدمجتين بالـlabel (الليدز لوحدها + العملاء ودفعاتهم). بعد الإصلاح 0.5–2.5 ث. **نفس النتيجة بالظبط:** قارنت 4 صيغ استعلام وقارنت الاستعلام الأصلي مباشرة على القاعدة (16 مجموعة، 0 فرق). اختبار: `api/tests/funnelAttributionAtScale.test.js`. الكوميتات `0e4b5cd0`، `a2b87eef`.

## BUG-02 · P1 (الشاشة اتعالجت، التأكيد من الإنتاج مستني) · لوحة القيادة المالية بتحسب الإيراد من مصدر وباقي الشاشة من مصدر تاني
**الخطوات:** admin ← الحسابات ← «لوحة القيادة المالية» (أو `GET /api/admin/finance/cockpit`) وقارن بـ`GET /api/admin/overview/revenue`.
**الفعلي (المعمل):** `revenue.month = 20,000` و`netProfit = 20,000` بينما `overview/revenue.monthEgp = 1,463,200` ونفس الرد فيه `topCourses` أول كورس 70,900 و`byMethod` 1,426,000.
**السبب:** إيراد اليوم/الأسبوع/الشهر/12 شهر من `journal_entries` + `journal_entry_lines` (حسابات 4%) في `api/routes/finance/cockpit.js:48-72`، وأعلى الكورسات والموظفين وطرق الدفع من `payments` في نفس الملف `:96-130`. على المعمل **36,666 من 36,683 دفعة مدفوعة مش في الدفتر** (بيانات اتحطت مباشرة).
**ليه مهم:** على الإنتاج لو أي دفعة ماترحّلتش (فشل outbox، دفعة قديمة قبل الترحيل) الشاشة بتناقض نفسها من غير أي تنبيه.
**المطلوب:** (1) تنفّذ على الإنتاج قراءة واحدة (استعلام في القسم 7 من التقرير الأساسي)، (2) شريط تحذير «N دفعة مش مترحّلة للدفتر» على الشاشة.

## BUG-03 · P2 · حد الشهر مختلف بين شاشتين (17,200 ج على المعمل) — **اتصلح**
**الخطوات:** على المعمل: `GET /api/admin/overview/revenue` ← `monthEgp = 1,463,200`. `GET /api/admin/finance/statement?from=2026-10-01&to=2026-10-31` ← `collected = 1,446,000`.
**الفرق:** 17,200 ج = 18 دفعة تاريخها بين 2026-09-30 21:00 و24:00 UTC (= 00:00–03:00 بتوقيت القاهرة 1 أكتوبر).
**السبب:** الرئيسية بتقص بلحظة بداية يوم القاهرة (`api/routes/analytics/dashboard.js:330-343` عبر `cairoDayStartUtc`)، وكشف الحساب بتاريخ UTC مجرّد `p.date>=? AND p.date<?` (`api/lib/financeStatement.js:55` و`:123`). والتخزين UTC (`api/lib/db.js:32`).
**الأثر على الإنتاج:** دفعات أول 2–3 ساعات من الشهر بالتوقيت المحلي بتتحسب في الشهر اللي قبله في كشف الحساب. صغير بس بيخلّي شاشتين مختلفتين.
**المطلوب:** حد واحد مشترك (`cairoDayStartUtc`) في كشف الحساب والكوكبت وباقي تقارير الفترات.

## BUG-04 · P2 · دور «المدير» (MANAGER) بينشئ حسابات ADMIN
**الخطوات:** سجّل دخول `manager@perf.test`، `POST /api/admin/staff` بجسم `{"name":"x","email":"probe@x.test","role":"admin"}`. **الفعلي:** 200 وصف اتعمل بـ`role=ADMIN`. **المتوقع حسب التعليق:** 403 «إنشاء حساب بصلاحية مدير أو أدمن يحتاج صلاحية المالك».
**السبب:** الحارس `api/routes/staff.js:191-192` بيستثني `req.isSuperAdmin`، و`isSuperAdmin` بيتحط true لأي دور في `FULL_ACCESS_ROLES` = ADMIN + MANAGER (`api/constants/permissions.js:339`, `api/middleware/auth.js:349`). المدير أصلاً عنده صلاحيات كاملة، فمفيش تصعيد حقيقي؛ المشكلة إن الحارس والرسالة بيوهموا إن في فرق. (مسحت الصفين اللي اتعملوا من قاعدة المعمل.)
**المطلوب:** قرارك: يا تفضل المدير = الأدمن (وتتغيّر الرسالة)، يا تقصر إنشاء ADMIN/MANAGER على المالك (`isInstituteOwner`).

## BUG-05 · مش عيب (راجعته تاني): القفل برسالة واضحة بمدة الانتظار، والجهاز المعروف مستثنى (`rateLimits.js:76-97`)
**الخطوات:** 14 محاولة غلط على `sales2@perf.test` من نفس الجهاز، بعدين الباسورد الصح. **الفعلي:** 14×401 ثم 429 حتى بالصح. **المتوقع:** بعد القفل الصاحب يستنى أو يفتح بكود. على شبكة المكتب (نفس الـIP) ممكن زميل يقفل زميل بالغلط.
**المرجع:** `api/middleware/rateLimits.js:76` (loginLimiter). **المطلوب:** رسالة واضحة بمدة الانتظار + استثناء الجهاز المعروف (`mahadKnownLogin`) موجود؛ تأكد إنه بيغطي كل أجهزة المكتب.

## BUG-06 · P2 · أي رابط غلط في الموقع بيرجّع 200 (soft-404) — **اتصلح في الكود (النشر عليك)**
**الخطوات:** `curl -s -o /dev/null -w "%{http_code}" https://mahadnafsy.com/no-such-page-xyz` ← **200**.
**السبب:** `try_files $uri $uri/ /index.html` (`deploy/nginx/mahad-web.conf.example:102-103`). جوجل بيعتبرها soft-404 وبتبوّظ تقارير الفهرسة.
**المطلوب:** الـSPA يرجّع 404 لما الـroute مش معروف (قائمة routes من الـsitemap في nginx أو `error_page`).

## BUG-07 · P2 (اتصلح للصفحات الـ10 الرئيسية) · HTML الخام لصفحات الموقع غير الكورسات كلها canonical = الرئيسية
**الخطوات:** `curl -s https://mahadnafsy.com/courses | grep canonical` (نفس الشيء `/about` و`/contact` و`/consultations`) ← `https://mahadnafsy.com/`، 9,027 بايت، 0 `<h1>`.
**السبب:** `client/index.html:88` canonical ثابت؛ الكورسات (`/c/<slug>/`) متجهّزة مسبقاً بـcanonical خاص (`tools/generate-seo.mjs`) لكن صفحات القوائم لأ.
**الأثر:** واتساب وفيسبوك وبينج مابيشغّلوش JS، فمعاينة أي رابط غير الكورسات = عنوان الرئيسية.

## BUG-08 · P2 · روابط الـsitemap للكورسات بتتحوّل 301
**الخطوات:** `curl -sI https://mahadnafsy.com/c/mbti` ← 301 (إلى `/c/mbti/`) والـsitemap مكتوب فيه من غير `/` (`api/lib/seoPages.js:149`). **المطلوب:** `/` في آخر الرابط داخل الـsitemap.

## BUG-09 · P2 · أزرار من غير اسم في 7 شاشات — **اتصلح بالكامل (اختبار رسم حقيقي لزرار التبديل وكارت الليد)**
**الخطوات:** افتح `/dashboard/client` (قاعدة العملاء) وشغّل في الكونسول: `[...document.querySelectorAll('button')].filter(b=>!b.innerText.trim()&&!b.title&&!b.getAttribute('aria-label')).length` ← 50. وفي «التكاملات» و«مصادر الليد» و«مساحات عمل الفروع»: أزرار التبديل (switch) من غير اسم ولا حالة.
**السبب:** `admin/pages/dashboard/tabs/saasConnectorUi.tsx:71` (Toggle)، `ClientDbTab.tsx:724`، `TasksBoardTab.tsx:220`.
**الإصلاح:** `role="switch"` + `aria-checked` + `aria-label` للتبديل، `role="checkbox"` لزر تحديد العميل، `aria-label` لزر إضافة مهمة. الكوميت `948621be`. **الباقي:** زرار واحد في `course_waitlist` (أيقونة من غير نص).

## BUG-10 · P2 · **اتصلح (الرأس بقى يقول «أوفلاين»)** «N عميل محتمل» في رأس شاشة الـCRM بيعدّ الأوفلاين بس
**الخطوات:** admin ← المبيعات ← العملاء المحتملون (601 ألف ليد). الرأس: «**0** عميل محتمل · 20748 يحتاج متابعة عاجلة».
**السبب:** `admin/pages/dashboard/tabs/LeadsTab.tsx:363-366` بيطرح كل مصادر الأونلاين، و`admin/pages/dashboard/tabs/leads/LeadsTabHeader.tsx:67` بيكتبه «عميل محتمل» من غير ما يقول إنه أوفلاين. على الإنتاج لو المصادر حقيقية الرقم مش صفر، لكن التسمية مضللة.
**المطلوب:** «N ليد أوفلاين» أو إجمالي الليدز (`leadStats.total` موجود من `/api/admin/leads/stats`).

## BUG-11 · P2 · 3 شاشات بتفتح لدور وزرارها يرجّع 403
**الخطوات:** `node tools/permission-mismatch-scan.mjs`. `customer_inbox` للمبيعات والمحاسب (POST `/admin/subscribers` يحتاج `manage_subscribers`)، `whatsapp_web` للدعم والمحاسب (POST `/admin/leads` يحتاج `manage_leads`)، `interviews` لمدير الدقي (DELETE `/admin/hr/applicants/*` يحتاج `manage_hr`). (نفس بند 4 في `OPEN_PROBLEMS_20261031_AR.md`.) **المطلوب:** قرارك: أدّي الصلاحية ولا اخفي الزرار.

## BUG-12 · P2 (بالتصميم) · الدعم شايف كل سجل المدفوعات بتليفونات العملاء
**الخطوات:** `support1@perf.test`، `GET /api/admin/finance/payments-register?limit=200` ← `total: 36683`، فيه اسم وكود وتليفون العميل ومين استلم. (المندوب `sales1` شايف 197 بس.) السبب: `DATA_SCOPE[SUPPORT] = 'all'` (`api/constants/permissions.js:368`) + `view_orders`. نفس بند 3 في ملف المشاكل. **المطلوب:** قرار تضييق.

## BUG-13 · P2 · DNS الإيميل
**الخطوات:** `node -e "require('dns').promises.resolveTxt('mahadnafsy.com').then(console.log)"` ← SPF `v=spf1 include:_spf.reach.hostinger.com ~all` (من غير Brevo)؛ `_dmarc` = `p=none`؛ `resolveMx('mahadnafsy.com')` ← `ENODATA` (مفيش MX). DKIM لـBrevo موجود (`brevo1/2._domainkey`) فبيعدّي DMARC حالياً. **المطلوب:** إضافة Brevo للـSPF، DMARC `quarantine` بعد ما التقارير تثبت، MX لو فيه صناديق بريد على الدومين (فيه TXT تحقق Zoho).

## BUG-14 · P2 · endpoints أبطأ من ثانيتين على 601 ألف ليد (admin، warm)
`/api/admin/reconciliation-dashboard` 3.5 ث (4.7 لحساب المحاسب) · `/api/admin/reports/management` 3.1 ث · `/api/admin/reports/campaign` 3.0 ث · `/api/admin/online-performance` 2.6 ث · `/api/admin/analytics/conversion-funnel` 2.1 ث (6 ث بارد) · `/api/admin/leads/crm-insights` 1.1 ث و622 كيلو. **الخطوات:** `node tools/lab/sweep.cjs . admin` ← الجدول «slowest». على الإنتاج (حوالي 150 ألف ليد حسب ملاحظاتك) أقل، لكن الاتجاه واضح.

## BUG-15 · P2 · شاشات بتنزّل قوائم كاملة
`/api/admin/expenses` 2.1 ميجا · `/api/admin/payments` 1.1 ميجا · `/api/admin/orders` 787 كيلو (1.6 ث) · `/api/admin/export/payments` 3 ميجا · `/api/staff/subscribers?limit=...` 7.2 ميجا لو `limit` كبير (محدود). نفس بند 10 في `OPEN_PROBLEMS_20261031_AR.md`.

## BUG-16 · معلومة · أداة المعمل
`D:/audit_tmp/perf-db/start-api.sh` فيها مسار worktree تاني (`email-branding-fix-apply-dbda20`) مش الفرع الحالي؛ عملت `start-api-audit.sh` جنبها للمراجعة دي. وسكربت `tools/lab/journeys.cjs:35` كان بيقارن رقم التليفون الخام بالمطبّع (فشل كاذب) — اتصلّح بمقارنة آخر 10 أرقام.

---

## اللي جرّبته وطلع سليم (عشان مايتكررش الفحص)
- عميل عادي (`cust1@perf.test`) على `/api/admin/*` و`/api/staff/*` ← 403 في كل الحالات؛ دفعة/طلب عميل تاني ← 404.
- مندوب (`sales1`) على ليد مندوب تاني: GET 404، timeline 403، PATCH/PUT 404، والـDB ما اتغيّرتش. تصدير الليدز بتاعه = ليدزه بس (10,000 سطر حد أقصى).
- أصل الطلب (Origin) غريب على POST ← 403. رؤوس الأمان على الـAPI كاملة. الكوكيز `HttpOnly; Secure; SameSite=None`.
- سعر الحجز العام: السيرفر بيحسبه من الكتالوج ويرفض أي رقم تاني (409). (الدفع الإلكتروني مقفول في المعمل فاللي اتفحص هو الكود.)
- حقن: `{"$ne":""}` في الدخول ← 400؛ `' OR 1=1--` و`sort=id;DROP TABLE x` في بحث الليدز ← 200 بنتيجة عادية (باراميتر مش نص).
- webhooks (ميتا، UltraMsg): توقيع HMAC بمقارنة آمنة زمنياً (`api/routes/whatsapp-webhook.js:15-45`)؛ روابط webhook الخارجية بتفحص SSRF وDNS rebinding (`api/lib/webhookSecurity.js`).
- 0 استخدام لـ`dangerouslySetInnerHTML` في الأدمن والعميل.
- endpoints العامة (9) مفيهاش أي مفتاح/سر (فحص بنمط).
- دفتر اليومية: 0 قيد غير متوازن (29 قيد في المعمل).
- 72 شاشة أدمن في المتصفح: 0 خطأ JS و0 خطأ HTTP و0 تمرير أفقي.
