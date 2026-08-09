# تقرير المراجعة والتحليل العميق لمشروع مهاد نفسي

**تاريخ المراجعة:** 2026-08-08  
**النطاق:** موقع العملاء، نظام الإدارة، API، قاعدة البيانات، الأمن، الترابط، رحلة العميل، الجاهزية التشغيلية.  
**نوع الدليل:** `LIVE` = فحص حي الآن، `STATIC` = قراءة الكود/الحراس، `BASELINE` = دليل سابق موثق، `BLOCKED` = محجوب بسبب بنية التشغيل.

## 1. الحكم التنفيذي

المشروع ليس مجرد موقع كورسات؛ هو Institute Suite متعدد الفروع/المستأجرين يجمع CRM وLMS والتحصيل والمحاسبة وHR والدقي/الأونلاين وخدمة العملاء والتسويق. بنية الـAPI والأمن والعزل أفضل من أغلب الأنظمة الداخلية، وتوجد اختبارات وحدات كثيفة جدًا. في المقابل، اتساع المنتج أدى إلى تعقيد كبير في لوحة الإدارة، تكرار طبقات العرض، وفجوات بين البيانات المتاحة وبين حالات الواجهة عند تعطل قاعدة البيانات.

| محور | التقييم /10 | حالة الدليل | الحكم |
|---|---:|---|---|
| موقع العملاء وتجربة الشراء | **7.1** | LIVE + STATIC | واجهة عربية جيدة ومسارات شراء واضحة، لكن تحمل فشل البيانات ضعيف وبعض الحقول/الأزرار غير accessible. |
| نظام الإدارة | **7.5** | STATIC + BASELINE | تغطية تشغيلية واسعة وربط صلاحيات قوي، لكن لوحة ضخمة وبها 5 أخطاء lint ومدخلات مخفية/تابات صعبة الاكتشاف. |
| API والمنطق التشغيلي | **8.1** | STATIC + 755/755 tests | معاملات مالية، عزل tenant، outbox وRBAC ناضجة؛ ما زالت تكاملات خارجية ومسارات Paymob مؤجلة. |
| قاعدة البيانات والمخطط | **7.2** | STATIC | 194 migration وحراس drift، لكن `schema.sql` لا يطابق replay الكامل (79 عمودًا، 7 جداول legacy). |
| الأمن والخصوصية | **7.8** | STATIC + tests | MFA/session binding/audit chain/tenant scope قوية؛ توجد ثغرات dependency وغياب دليل providers الإنتاجية. |
| الترابط ورحلة العميل | **7.0** | STATIC + BASELINE UAT | الهوية من lead إلى payment إلى LMS/certificate/reversal موحدة، لكن التجربة تعتمد على صحة DB وPaymob معلق. |
| الجاهزية الإنتاجية الحالية | **4.5** | LIVE BLOCKED | فحص production readiness الحالي: 5 PASS، 1 SKIP Paymob، 26 FAIL بسبب secrets/DB/Redis/providers/release evidence. |

**التقييم الموحّد كنظام معهد متوسط: 7.2/10.** التقييم العادل مقابل Salesforce/Workday/NetSuite كمنتج Enterprise كامل: **6.0/10**؛ لا ينبغي تسويق النظام كـERP أو Enterprise SaaS كامل قبل إغلاق حدود المنتج الحالية.

## 2. خريطة المعمارية والترابط

```text
زائر الموقع
  -> Home/Courses/CourseDetails/Consultations
  -> Lead capture أو Auth
  -> Lead + attribution + assignment (CRM)
  -> Checkout / manual proof / Paymob (Paymob موقوف)
  -> Order + Payment + double-entry Journal (Finance)
  -> Subscriber/User + Enrollment/Entitlement (LMS)
  -> Lecture progress + Quiz + Completion
  -> Certificate lifecycle + public verification
  -> Support/Community/Notifications + customer timeline
  -> Refund reversal -> payment/order/commission/entitlement/certificate/waitlist
```

| علاقة بين الأقسام | الحالة | التقييم |
|---|---|---:|
| Lead -> Subscriber/User | transaction server-owned، conversion atomic | 8.5 |
| Payment -> Journal -> Order | double-entry وperiod lock وreversal | 8.5 |
| Payment -> Enrollment/Entitlement | مرتبط ويُراجع في reconciliation | 8.2 |
| LMS progress -> Completion -> Certificate | lifecycle واختبارات موجودة | 7.8 |
| Support -> Timeline -> Notifications/outbox | tenant scoped وtransactional | 7.3 |
| Branch/currency -> Finance/LMS/CRM | branch scope وEGP/SAR/USD | 7.5 |
| Marketing/WhatsApp/Email -> CRM | outbox وconsent، لكن providers غير جاهزة محليًا | 6.4 |
| Admin menu -> renderer -> API | الحراس 0 مخالفة، لكن surface scan يرى 5 false-positive routes و17 renderer غير مباشر | 7.0 |

## 3. رحلة العميل بالتفصيل

| المرحلة | ما يحدث | مصدر الحقيقة | نقاط القوة | أكبر خطر | درجة |
|---|---|---|---|---|---:|
| الاكتشاف | صفحات عامة، بحث، كتالوج، خبراء | API/catalog + SiteData | SEO أساسي، responsive، CTA واضح | metadata اجتماعي/ canonical ثابتان لمعظم الصفحات | 7.8 |
| التقاط الاهتمام | lead widget، contact، course lead form | `leads` + consent + dedup | dedup/assignment/audit atomic | عند DB down لا توجد رسالة عامة متسقة في كل الصفحات | 7.2 |
| التأهيل | pipeline، scoring، followups، sequences، quotes | CRM routes + tables | forecast/CPQ/coaching أضيفت فعليًا | search `LIKE %q%` وغياب Opportunity مستقل | 8.0 |
| التسجيل | Auth/WhatsApp OTP/registration | users/subscribers/sessions | HMAC OTP، MFA، session revocation | إنتاج OTP/SMTP/WhatsApp يحتاج evidence خارجي | 7.5 |
| الدفع | cash/manual proof؛ Paymob fail-closed | orders/payments/journal | transaction + idempotency + currency snapshot | Paymob والـpartial refunds معلقان | 6.8 |
| التفعيل | approval -> payment -> enrollment/entitlement | payment proof + LMS | لا نجاح UI قبل persistence، reconciliation critical | صحة الرحلة محجوبة محليًا بغياب MySQL | 7.4 |
| التعلم | lectures/video/progress/quizzes/live/community | LMS + client dashboard | progress وquiz grading server-side | صفحة account/learning لا تعرض fallback واضحًا عند فشل API | 7.5 |
| الإكمال | course completion ثم certificate | completion/certificate lifecycle | revoke/reissue/audit/public verify | تغطية الاختبار عالية لكن E2E حي غير متاح الآن | 7.6 |
| الدعم | tickets، routing، SLA، reply، CSAT/NPS | support + outbox | tenant/department/SLA قوي | واجهة CX موزعة داخل hubs وعناصر بلا مدخل مستقل | 6.8 |
| الاسترداد | refund request/approval/reversal | shared `applyRefundReversal` | يعكس journal ويلغي commission ويراجع access | Paymob/partial refund غير متاحين | 7.0 |
| الاحتفاظ | reminders، abandoned checkout، loyalty، referrals | jobs/outbox | suppression وdedupe واختبارات | provider/Redis/release evidence غير مكتمل | 6.9 |

## 4. تقييم صفحات موقع العملاء

الدرجات التالية تخص الشاشة كمنتج وسلوكها وعلاقتها بالـAPI، وليست حكمًا على المحتوى التجاري وحده. الصفحات التي لم تستطع تحميل بيانات DB أخذت درجة أقل مع وسم السبب.

| الصفحة/المسار | الدرجة | الحالة | الملاحظات الرئيسية |
|---|---:|---|---|
| الرئيسية `/` | 8.1 | LIVE | Hero وCTA وlead capture وresponsive جيدان؛ كثرة العناصر العائمة تحتاج ضبط conversion analytics. |
| عن المعهد `/about` | 8.0 | LIVE | قصة وثقة وإحصاءات وصور؛ يعتمد على أصول خارجية. |
| الكورسات `/courses` | 7.6 | LIVE | فلاتر وبحث وبطاقات؛ أظهر 0/1 بيانات حسب استجابة API ويحتاج empty/error state أوضح. |
| تفاصيل الكورس `/course/:id`, `/c/:slug` | 7.4 | STATIC/BLOCKED | Hero، lectures، reviews، lead form وCTA مترابطة؛ التفاصيل غير قابلة للحكم الحي بدون ID/DB. |
| الباقات `/bundles` | 7.5 | LIVE | مقارنة ومسارات واضحة؛ تعتمد على catalog hydration. |
| تفاصيل الباقة `/bundle/:id` | 7.2 | STATIC/BLOCKED | upsell، gallery، course links وcheckout؛ البيانات الديناميكية غير قابلة للتحقق حيًا. |
| الاستشارات `/consultations` | 6.3 | LIVE/BLOCKED | في غياب therapists عرضت footer فقط بلا `h1` أو رسالة تعذر التحميل؛ هذا قصور UX حقيقي حتى لو سببه DB. |
| المجتمع `/community` | 6.4 | LIVE/BLOCKED | tabs ونشر/تعليق/مشاركة موجودة؛ عند API down الشاشة شبه فارغة بدل حالة offline/empty مفهومة. |
| معرض المعهد `/institute-gallery` | 6.8 | LIVE | state فارغ صريح “لا توجد صور”، لكن القيمة التسويقية منخفضة عندما لا تُدار الأصول. |
| الخبراء `/instructors` | 6.9 | LIVE | بطاقات جيدة و5 خبراء ظهروا؛ `cdnImg(undefined)` يرجع `''` فتكرر خطأ React وصور مكسورة. |
| تفاصيل الخبير `/instructor/:id` | 6.8 | STATIC | حجز وslots وcourses؛ أزرار Facebook/Twitter/LinkedIn بلا handlers أو links. |
| تسجيل الدخول `/auth` | 7.8 | LIVE + STATIC | email/password، forgot password، WhatsApp OTP، TOTP/MFA؛ حقول label بلا association `for/id` وأيقونة show password بلا اسم. |
| حسابي `/my-account` | 7.2 | LIVE/BLOCKED | route guard موجود؛ عند عدم auth أو DB down يعود footer بلا explanation مفيدة. |
| التسجيل `/enroll` | 7.1 | LIVE | cash/installment واختيار متعدد؛ الحقول المرئية غير مرتبطة semantic labels. |
| checkout `/checkout` | 7.0 | LIVE/BLOCKED | صفحة دفع mini footer؛ عند غياب item لا تعرض recovery/redirect واضح. |
| الدفع السريع `/pay` | 7.3 | LIVE | form واضح وmanual payment intent؛ يحتاج failure copy وtracking أقوى. |
| نجاح الدفع `/success` | 8.0 | LIVE | يشرح إيصال التحويل والخطوة التالية ويربط الحساب. |
| التحقق من الشهادة `/certificate/:code` | 7.4 | LIVE/BLOCKED | endpoint عام وحالة lifecycle؛ الكود غير الصالح ينتهي footer بدون شاشة نتيجة غنية. |
| السياسات `/policies`, `/privacy`, `/terms` | 7.5 | LIVE | privacy/terms ومعلومات الاستشارة موجودة؛ canonical/meta لا تتغير لكل route. |
| تواصل معنا `/contact` | 7.1 | LIVE | form persistence محمي باختبار؛ label association وserver-down copy يحتاجان تحسينًا. |
| FAQ `/faq` | 7.2 | LIVE | محتوى قابل للقراءة؛ لا يظهر في الصفحة عند البيانات غير المحملة إلا fallback ثابت. |
| تقييم التذكرة `/ticket-rating` | 7.3 | LIVE | token invalid state صحيح؛ يحتاج مسار دعم بديل أوضح. |
| انضم كمحاضر `/join` | 7.0 | LIVE | نموذج متخصص؛ 7 من 9 حقول غير مرتبطة semantic label في الفحص. |
| الوظائف `/join-us` | 7.0 | LIVE | قائمة تقديم؛ نفس مشكلة labels وغياب tracking للـapplication funnel. |
| 404 | 8.0 | LIVE | RTL، روابط العودة والكورسات؛ جيد. |

## 5. تقييم صفحات/تابات نظام الإدارة

الاختبار الحي الكامل يتطلب حسابات staff وDB؛ لذلك هذه الدرجات `STATIC` مع اعتماد baseline الموظفين (18 حسابًا، Chromium matrix 18/18) حيث أشير إليه. درجة التاب تقيس القيمة التشغيلية، وضوح الوصول، سلامة الصلاحيات، وعدم التكرار.

### الإدارة والتحليل

| التاب | /10 | ملاحظة |
|---|---:|---|
| `kpi_dashboard` | 7.8 | مؤشرات تنفيذية جيدة؛ freshness وتعريفات KPI تحتاج data dictionary. |
| `overview` | 7.5 | مركز تشغيل غني؛ حجم state كبير. |
| `activity` | 7.6 | audit/activity مفيد؛ يحتاج retention/search UX أفضل. |
| `tasks_board` | 7.4 | tasks server-backed وrole scoped. |
| `retention` | 7.0 | تحليل مفيد لكن attribution/cohort يحتاج تفسيرًا مرئيًا. |
| `cohort_analysis` | 7.2 | cohort مرتبط بالـfunnel؛ يحتاج أداء وحجم بيانات حقيقي. |
| `revenue_sources` | 7.1 | يربط قنوات الإيراد؛ يتأثر بغياب FX/DB. |
| `expense_analytics` | 7.0 | تقارير جيدة؛ لا tax layer كاملة. |
| `ask_ai` | 6.8 | proxy server-side ومحددات جيدة؛ provider readiness غير مثبت. |

### CRM والمبيعات

| التاب | /10 | ملاحظة |
|---|---:|---|
| `leads` | 8.1 | أقوى workflow: pipeline، dedup، assignment، timeline، reminders. شاشة كبيرة (778 سطر). |
| `sales_hub` | 7.8 | يجمع team/reports/targets؛ تعقيد sub-tabs مرتفع. |
| `followup_reminders` | 7.5 | server-owned وSLA؛ يحتاج رسائل تشغيلية موحدة. |
| `lead_scoring` | 7.6 | scoring tenant-configured؛ كان unreachable ثم أضيف للقائمة. |
| `forecast` | 7.5 | forecast/submissions/accuracy موجودة؛ لا Opportunity object مستقل. |
| `sales_goals` | 7.4 | الآن قابل للوصول من القائمة بعد التعديل غير المحفوظ الحالي؛ يجب اختبار permission/route قبل الدمج. |
| `contentHub` CRM editors | 7.1 | إدارة النصوص جيدة؛ 15 tab إضافية ترفع cognitive load. |
| `quotes/CPQ` داخل Leads | 7.8 | تسعير server-owned وموافقة discount وledger-safe. |

### الأونلاين والدقي

| التاب | /10 | ملاحظة |
|---|---:|---|
| `online_clients` | 7.7 | قاعدة عملاء وpayments/course access؛ شاشة كبيرة (1031 سطر). |
| `client` | 7.8 | Unified client يربط CRM/finance/LMS/support. |
| `online_hub` | 7.6 | team + collection؛ يحتاج تقليل التداخل مع client. |
| `installment_plans` | 7.3 | الحسابات fail-closed وlegacy read-only. |
| `subscriptions` | 7.0 | recurring billing موجود؛ readiness provider غير مثبت. |
| `daqqi_schedule` | 7.0 | atomic rounds/attendance؛ شاشة 1296 سطر عالية المخاطر للصيانة. |
| `daqqi_clients` | 6.9 | branch-scoped وarchive محفوظ. |
| `daqqi_team` | 6.8 | صلاحيات branch جيدة؛ visibility تحتاج تبسيط. |
| `daqqi_accounting` | 7.0 | linked to finance/currency؛ يحتاج UAT حي. |
| `daqqi_stats` | 6.8 | حضور وإحصائيات؛ data freshness غير قابل للقياس محليًا. |
| `waitlist` | 7.1 | auto-notify بعد refund/unenroll. |

### خدمة العملاء والشهادات

| التاب | /10 | ملاحظة |
|---|---:|---|
| `customer_inbox` | 7.2 | يجمع support/contact/refund/cert؛ كثافة عالية. |
| `service_hub` | 6.8 | consolidation جيد لكن يخفي 8 workflows في sub-tabs. |
| `consultation_calendar` | 7.0 | الحجز والـslots متصلان بالـcheckout. |
| `cert_requests` | 7.3 | lifecycle وpricing ومراجعة tenant-scoped. |
| `cert_pricing` | 7.2 | nationality/currency mapping مضبوط؛ manual pending price موجود. |
| `tickets` | 7.0 | SLA/routing/replies؛ polling داخل الواجهة يحتاج realtime موحد. |
| `faq_manager` | 6.9 | CRUD موجود لكن الوصول كان غير مباشر في surface scan. |
| `refund_requests` | 7.0 | shared reversal موجود؛ Paymob/partial deferred. |
| `contacts` | 6.9 | الرسائل محفوظة؛ تظهر داخل service hub لا كصفحة مستقلة. |
| `nps_dashboard` | 6.7 | يقيس NPS/CSAT؛ أضعف في التحليل والتفعيل. |

### Finance

| التاب | /10 | ملاحظة |
|---|---:|---|
| `financial` | 8.2 | double-entry، periods، FX snapshots، proof review. |
| `orders` | 7.9 | order/payment/receipt journey؛ كثافة 1226 سطر. |
| `financial_reports` | 7.9 | P&L، aging، reconciliation، exports. |
| `balance_sheet` | 7.8 | ledger-backed ولا يختلق browser figures. |
| `cash_flow` | 7.6 | forecast/actual؛ يحتاج managed DB وFX live. |
| `recurring_expenses` | 7.2 | cadence monthly guarded؛ ظهر كـroute false-positive بسبب scanner. |
| `budget_tracker` | 7.3 | budget vs actual؛ tax absent. |
| `revenue_forecast` | 7.4 | forecast مالي؛ لا يساوي full FP&A. |

### HR

| التاب | /10 | ملاحظة |
|---|---:|---|
| `hr` | 7.0 | records/recruiting/leave/payroll/offboarding؛ شاشة 1011 سطر. |
| `hr_analytics` | 6.8 | تقارير تشغيلية؛ لا org chart/هدف أداء مكتمل. |
| `enps_dashboard` | 6.7 | survey وeNPS؛ محدود في action plans. |
| `offboarding` | 6.9 | workflow موجود وآثار تدقيق. |
| `instructors` | 7.0 | expert catalog/assignments؛ يظهر تحت HR رغم أثره التسويقي/LMS. |
| `join_us` | 7.1 | recruitment applications. |
| `interviews` | 7.0 | scheduling/rating؛ يحتاج mobile recruiter flow. |
| `my_hr` | 7.3 | self-service records/leave/disciplinary appeal. |

### التسويق والمراسلات

| التاب | /10 | ملاحظة |
|---|---:|---|
| `marketing_hub` | 7.0 | attribution/campaigns؛ شاشة 1058 سطر. |
| `messaging_hub` | 6.7 | WhatsApp/Messenger؛ provider غير متصل محليًا. |
| `email_campaigns` | 6.8 | outbox/consent؛ delivery evidence ناقص. |
| `sms_campaigns` | 6.5 | CRUD موجود؛ SMS provider غير مثبت. |
| `drip_campaigns` | 6.8 | sequence cadence وoutbox. |
| `notif_inbox` | 7.0 | notifications tenant/recipient scoped. |

### المحتوى وLMS

| التاب | /10 | ملاحظة |
|---|---:|---|
| `content_hub` | 7.1 | 15 editor tabs؛ خطر cognitive overload. |
| `courses` | 7.6 | catalog CRUD وpricing/capacity. |
| `lectures` | 7.5 | chapters/lecture/notes persistence. |
| `bundles` | 7.5 | paths/packages. |
| `quizzes` | 7.4 | AI generation bounded، grading server-side. |
| `course_waitlist` | 7.2 | seat release notification. |
| `live_streams` | 7.0 | HLS/live session hooks؛ يحتاج provider UAT. |
| `community` | 7.0 | moderation/publishing permission-bound. |
| `testimonials` | 6.8 | CRUD موجود لكنه بلا مدخل sidebar مستقل في surface scanner. |
| `institute_gallery` | 6.8 | أصول الموقع؛ الحالة الفارغة واضحة لكن لا content الآن. |

### الإعدادات والأمان وSaaS

| التاب | /10 | ملاحظة |
|---|---:|---|
| `settings_hub` | 7.0 | يختصر إعدادات كثيرة لكن navigation deep. |
| `system_settings` | 7.2 | secrets redacted وtenant settings؛ شاشة 697 سطر. |
| `payment_settings` | 7.0 | manual/Paymob fail-closed؛ Paymob غير متاح. |
| `lead_sources_settings` | 7.0 | source/catalog settings. |
| `otp_settings` | 7.0 | diagnostics dry-run وrate limits. |
| `sms_settings` | 6.6 | connector readiness ناقصة. |
| `branch_workspaces` | 7.3 | branch catalog/quota/currency. |
| `automation` | 7.3 | backend-owned workflows/outbox. |
| `ip_whitelist` | 7.1 | proxy/IP policy؛ يحتاج production hops evidence. |
| `messaging_agent` | 6.8 | AI messaging proxy. |
| `admin_ai_settings` | 6.9 | provider config server-side. |
| `server_monitor` | 7.0 | مراقبة لا تقتل host processes؛ يحتاج Sentry/alerts. |
| `webhooks` | 7.0 | signed inbound/outbox؛ provider coverage ناقصة. |
| `security_dashboard` | 7.5 | MFA/audit export/session policy. |
| `pg_migrate` | 6.5 | الاسم مضلل لأن backend MySQL؛ يحتاج إعادة تسمية/حماية أقوى. |

## 6. تقييم API والبيانات

| الوحدة | /10 | ما تم التحقق منه | الفجوة |
|---|---:|---|---|
| Auth/session/MFA | 8.6 | tenant-bound JWT، IP-bound single session، OTP HMAC، MFA policy | readiness providers/evidence غير موجودة محليًا. |
| CRM | 8.1 | lead state، dedup، merge، assignment، SLA، CPQ، forecast، sequences | Opportunity model/search engine/custom objects غير مكتملة. |
| Finance/accounting | 8.4 | journals، period lock، FX، AP، reconciliation، refunds | tax/VAT/e-invoice غير موجودة؛ Paymob/partial refund مؤجلة. |
| LMS/certificates | 7.9 | entitlements، prerequisites، quizzes، completion، revoke/reissue/verify | E2E مع DB غير متاح الآن؛ mobile/offline غير موجود. |
| HR/payroll | 7.0 | records، recruitment، leave، attendance، payroll، disciplinary appeal | org chart، performance cycle، banking/biometric/mobile ناقصة. |
| Support/CX | 6.8 | routing، department scope، SLA، replies، CSAT/NPS | UX موزع، realtime غير مكتمل، تكامل WhatsApp غير جاهز. |
| Community | 7.2 | tenant-bound reads/mutations، rate limits، moderation | blank fallback عند DB down. |
| Public/orders | 7.1 | public rate limits، checkout intent، manual proof، idempotency | payment provider dependency؛ invalid detail routes لا تعرض state غني. |
| Messaging/connectors | 6.2 | outbox، signed webhooks، consent، dedupe | WhatsApp/SMS/Sentry/incident webhook غير مثبتين. |
| Scheduler/jobs | 7.4 | durable queue، retry، stale worker recovery، one scheduler | لا يمكن قياس Redis/worker production حاليًا. |
| Upload/media | 7.6 | byte signature، tenant path isolation، SSRF host allowlist | external CDN dependencies وempty image URL handling. |

## 7. الأمن والاعتمادية

### نقاط قوة مثبتة

- `npm run quality`: **62/62 checks PASS**.
- API syntax: **435/435 files PASS**.
- Unit tests: **755 PASS، 0 FAIL، 1 TODO** (الاختبار متعلق بتمرير Paymob injectable helper).
- كل 337 endpoint تعديل إداري خلف authz guard، وtenant-scope guard = 0 violations عبر 181 جدولًا.
- security headers، compression، centralized async boundary، rate limits، audit chain، secret redaction، upload signature، SSRF guards.
- admin/client typecheck وproduction build PASS؛ client lint PASS.

### مخاطر مؤكدة أو قابلة للإعادة

1. **ثغرات dependencies - P1:** API لديه `ip-address@10.2.0` عالي الخطورة عبر `express-rate-limit`; admin/client لديهما `dompurify@3.4.12` متوسط و`socket.io-parser@4.2.6` عالي. كلها لها fix متاح، ولا ينبغي release قبل `npm audit --omit=dev` نظيف أو exception موثق.
2. **قاعدة البيانات محجوبة - P0 للتشغيل المحلي:** `/api/health` يعيد `503 {"status":"error","db":"disconnected"}`، بينما `/api/health/live` = 200؛ كل مسارات DB-backed غير قابلة للتحقق الآن.
3. **Schema source drift - P1:** `schema-source-drift` يعيد 79 عمودًا مفقودًا عبر 50 جدولًا و7 جداول موجودة في `schema.sql` فقط. الثلاثة critical التاريخية (`automation_workflows.conditions/action_config`, `course_completions.email_sent`) قديمة/مستبدلة جزئيًا بـ`*_json` لكنها تعني أن replay وsnapshot ليسا مصدرًا واحدًا واضحًا.
4. **Production readiness - P0 قبل الإطلاق:** الأمر الحالي 5 PASS/1 SKIP/26 FAIL، والفشل يشمل session/OTP/audit secrets، geo/residency، managed MySQL/PITR/TLS، Redis، MFA enrollment، FX، SMTP evidence، WhatsApp، Sentry، incident webhook، APP_RELEASE وthread-pool.
5. **UX عند فشل API - P1:** consultations/community/my-account وبعض detail routes تظهر footer/مساحة شبه فارغة بدل Offline/Error/Retry. هذا يجعل المستخدم لا يعرف هل لا توجد بيانات أم أن النظام متعطل.
6. **صور مكسورة - P2:** `cdnImg` يعيد `''` عند عدم وجود صورة، والـInstructors يرسم `<img src="">`; فحص المتصفح سجل خطأ React متكرر وصورًا مكسورة.
7. **Accessibility - P2:** أزرار menu/eye/social/bell بلا accessible name في حالات متعددة، والحقول المرئية تستخدم `label` بلا `htmlFor/id`؛ الفحص الحي وجد 1-2 button غير مسمى وحقولًا غير مرتبطة في كل نموذج تقريبًا.
8. **أزرار شكلية - P2:** أزرار Facebook/Twitter/LinkedIn في `InstructorDetails`، bell في Community، وبعض أزرار CTA بلا handler/href. هذه تضر الثقة أكثر من كونها خطأ تجميليًا.
9. **تعقيد لوحة الإدارة - P2:** 274 TSX admin، 115 tab key، 92 مدخل قائمة تقريبًا، وأكبر الملفات 1000-1300 سطر. surface scanner الحالي يرى 5 entries غير مرسومة و17 renderer بلا entry؛ أغلبها consolidation/false-positive، لكن يجب تحويله إلى contract آلي لا يعتمد على regex.
10. **lint الإدارة - P2:** خطآن `no-irregular-whitespace` في `ArchiveTab.tsx:20` و`leadCourseLabel.ts:40`.
11. **Tax/localization gap - P1 للمال:** لا يوجد tax-rate engine أو VAT/e-invoice ETA؛ هذا يمنع اعتبار Finance ERP قانونيًا كاملًا.
12. **حدود المنتج - P1 استراتيجي:** لا Opportunity مستقل، لا search engine جزئي، لا custom objects/report builder، لا mobile/offline app، ولا تكامل biometric/bank payroll.

## 8. ما هو متصل فعليًا وما يحتاج عملًا

| المسار | الترابط الحالي | درجة الترابط |
|---|---|---:|
| Catalog -> Lead -> CRM | ممتاز، form وassignment وdedup وtimeline | 8.2 |
| CRM -> Payment | جيد، quote/order/payment link مع currency server-owned | 7.8 |
| Payment -> Finance | قوي جدًا، journal/period/reversal/reconcile | 8.5 |
| Payment -> LMS | قوي في الكود والاختبارات | 8.0 |
| LMS -> Certificate | lifecycle واضح، public verify/revoke | 7.8 |
| Certificate -> Support/Customer | requests/timeline موجودة | 7.1 |
| HR -> Payroll -> Finance | موجود على مستوى الرواتب والقيود | 6.9 |
| Marketing -> CRM | attribution/outbox/consent | 6.7 |
| Branch -> All modules | tenant + branch/data scope | 7.8 |
| External providers -> runtime | ناقص evidence واتصال حقيقي | 4.5 |

## 9. ترتيب الإصلاح المقترح

### خلال 24 ساعة

1. إصلاح dependencies الثلاثة وإعادة تشغيل `npm audit --omit=dev`.
2. تشغيل MySQL/managed staging أو تثبيت blocker رسمي؛ لا تختبر الواجهة ببيانات cache وتعلن PASS.
3. إصلاح `cdnImg`/Instructors لمنع `src=""`، وإضافة error boundary/state موحد: `loading / empty / offline / retry` لكل الصفحة العامة المعتمدة على API.
4. إضافة `htmlFor/id` و`aria-label` لكل icon-only control في Header/Auth/Instructor/Community.
5. تنظيف خطي lint في ملفي الإدارة.

### خلال أسبوع

1. جعل `schema.sql` snapshot مولّدًا من migrations أو إضافة migrations صريحة لـrename/columns القديمة، وإزالة الجداول السبعة legacy من snapshot أو توثيق مالكها.
2. استبدال surface/route regex scanners بتحليل registry واحد يستورد `TabKey`/route manifest ويختبر كل menu item بأنه قابل للrender.
3. توحيد ServiceHub وCX في IA واضح مع deep links لكل sub-tab وbreadcrumbs.
4. إضافة E2E حي لرحلة: lead -> order -> proof -> approval -> enrollment -> progress -> certificate -> refund.
5. إضافة OpenTelemetry/Sentry/incident webhook وrelease manifest قبل أي claim إنتاجي.

### خلال 30-90 يومًا

1. tax/VAT/e-invoice layer حسب الدولة، مع tax snapshots في journal/document.
2. Opportunity object وsearch index وreport builder محدود بدل توسيع LeadsTab.
3. mobile/offline/biometric attendance وbank payroll integration.
4. provider adapters مع contract tests حقيقية لـWhatsApp/SMS/SMTP/Redis/Paymob بعد اعتماد المزود.

## 10. بوابة التحقق الحالية

| الاختبار | النتيجة |
|---|---|
| API syntax | PASS 435/435 |
| Unit tests | PASS 755، FAIL 0، TODO 1 |
| Quality gates | PASS 62/62 |
| Admin typecheck | PASS |
| Client typecheck | PASS |
| Admin build | PASS |
| Client build | PASS |
| Client lint | PASS |
| Admin lint | FAIL: خطآن whitespace |
| Client/Admin/API HTTP | PASS للواجهتين، API live PASS وready BLOCKED 503 DB |
| Dashboard surface scan | PASS process، لكنه كشف 5/17 مؤشرات تحتاج contract حقيقي |
| Route integrity scan | PASS process؛ 5 false positives لأن parser لا يطابق routers nested/paths الديناميكية |
| Permission matrix | PASS 0 violations |
| Schema source drift | FAIL 79 columns/50 tables + 7 schema-only tables |
| Production readiness | FAIL 5 pass / 1 skip / 26 fail |

## 11. القرار

**المشروع جاهز كـPilot تشغيلي داخلي بعد تشغيل DB وإغلاق مشاكل UI الحرجة، لكنه غير جاهز لإعلان Production Enterprise أو SaaS متعدد العملاء على نطاق واسع.** أقوى أجزائه: Finance transaction model، tenant isolation، CRM workflow، LMS entitlement، security tests. أضعف أجزائه: external-provider readiness، schema authority clarity، fallback UX عند انقطاع DB، accessibility، وتعقيد لوحة الإدارة.

أي إطلاق حقيقي يجب أن يمر بثلاثة شروط غير قابلة للتفاوض: (1) MySQL/Redis/providers managed مع evidence حديث، (2) dependency + schema drift gates نظيفة، (3) E2E حي لرحلة العميل كاملة مع reconciliation وrollback مثبتين.
