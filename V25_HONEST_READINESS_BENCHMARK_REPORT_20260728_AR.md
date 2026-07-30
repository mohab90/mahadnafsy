# التقرير الصريح لجاهزية Mahad v25 والمقارنة المرجعية

تاريخ القياس: 28 يوليو 2026  
النطاق: الكود الحالي في `D:\mahadnafsy25`، API + Admin + Client + schema/migrations + اختبارات ثابتة ووحدات وبناء Production.  
الاستثناء المطلوب من صاحب المشروع: Paymob وتجزئة/استرداد الدفع الجزئي مؤجلين لحين مراجعة مزود الدفع.

## الحكم التنفيذي

**النسخة ليست جاهزة للإطلاق العام بنسبة 100%.**  
الكود الحالي اجتاز بوابات الجودة والبناء، لكن بيئة التشغيل نفسها فشلت في 12 من 18 فحص جاهزية، وقاعدة MySQL غير متاحة حاليًا لإثبات المايجريشن والـUAT الحي. كذلك Paymob مؤجل رسميًا، ومجموعة من القدرات المؤسسية الموجودة في المنتجات العالمية غير موجودة أصلًا في المنتج الحالي.

- نضج المنتج والكود الحالي: **64/100**.
- جاهزية الإطلاق الفعلية الآن: **52/100**.
- الجاهزية للاستخدام الداخلي المحدود بعد تشغيل قاعدة البيانات والتحقق من المايجريشن: **مشروطة**.
- الجاهزية لإطلاق SaaS عام متعدد العملاء: **غير كافية حاليًا**.

الفرق بين الرقمين مهم: الاختبارات الثابتة الناجحة تثبت عقود الكود، لكنها لا تثبت اتصال الإنتاج أو وصول الرسائل أو عمل Redis أو صحة بيانات الإنتاج.

## أدلة القياس الفعلية

| البوابة | النتيجة |
|---|---:|
| API lint | ✅ ناجح |
| Admin TypeScript | ✅ ناجح |
| Client TypeScript | ✅ ناجح |
| Unit/contract tests | ✅ 434 اختبارًا؛ 433 ناجح، 0 فشل، 1 TODO خاص باختبار Paymob المعزول |
| Quality/security gates | ✅ 56/56 |
| Tenant scanner | ✅ 0 مخالفة عبر 150 جدولًا متتبعًا |
| Authorization coverage | ✅ 286 endpoint تعديلي محمي |
| Duplicate routes | ✅ صفر |
| Permission matrix | ✅ 90 ملف Routes و109 تبويب Dashboard |
| Admin production build | ✅ 3040 module |
| Client production build | ✅ 1858 module |
| Production readiness | ❌ 18 فحصًا: 5 ناجح، 1 Paymob مؤجل، 12 فاشل |
| MySQL live integration/UAT | ❌ غير منفذ: `ECONNREFUSED 127.0.0.1:3306` |
| Login production load | ⚠️ غير منفذ؛ المتاح فقط benchmark محلي للتشفير |

اختبار bcrypt المحلي بعد استخدام المحرك الأصلي:

| المؤشر | النتيجة |
|---|---:|
| Concurrency | 24 |
| p50 | 1.245s |
| p95 | 2.368s |
| Max | 2.388s |
| أقصى Event-loop lag | 24ms |

ده تحسن عن قياس 3.75s القديم، لكنه **ليس** p95 لتسجيل الدخول على Production؛ ما زال مطلوب قياس HTTP حي مع CPU profiling.

## خريطة المشروع الحالية

| البند | العدد |
|---|---:|
| الملفات، مع احتساب الملفات المخفية واستبعاد `node_modules/dist/.git/coverage/backups` | 1,087 |
| المجلدات المستبعد منها نفس مجلدات البناء والتبعيات | 113 |
| ملفات الكود/SQL/CSS/HTML | 932 |
| أسطر الكود المقاسة | 147,098 |
| ملفات API routes | 90 |
| تعريفات Router | 625 |
| SQL migrations | 143 |
| ملفات اختبارات API | 90 |

أهم الوحدات: CRM، العملاء والاشتراكات، Orders، Payments، Finance/Accounting، LMS، الشهادات، HR/Payroll/Attendance، دعم العملاء، Notifications، SaaS control plane، الأمن والخصوصية، وتشغيل الفروع والدقي.

## تقييم الأقسام بعد الإصلاحات

| القسم | المنطق | قاعدة البيانات | الترابط | الأمان | الأداء | التوسع | التقييم |
|---|---:|---:|---:|---:|---:|---:|---:|
| CRM | 7.6 | 7.3 | 7.4 | 7.2 | 6.7 | 6.7 | **7.0** |
| Client Portal | 7.1 | 7.0 | 7.2 | 7.0 | 6.6 | 6.4 | **6.8** |
| Payments | 6.2 | 6.5 | 6.4 | 6.3 | 6.0 | 4.0 | **4.8** |
| Finance & Accounting | 7.0 | 7.2 | 7.0 | 6.9 | 6.2 | 5.2 | **6.2** |
| HR | 6.7 | 6.7 | 6.4 | 6.7 | 6.1 | 5.4 | **6.0** |
| Attendance | 6.4 | 6.6 | 6.3 | 6.4 | 6.1 | 4.8 | **5.5** |
| LMS | 6.9 | 6.8 | 7.0 | 6.8 | 6.2 | 5.7 | **6.2** |
| Customer Service | 6.8 | 6.8 | 6.9 | 6.8 | 6.0 | 5.1 | **6.0** |
| Online Follow-up | 6.9 | 6.6 | 6.8 | 6.6 | 6.0 | 5.6 | **6.1** |
| SaaS Settings | 6.3 | 6.5 | 6.3 | 6.4 | 5.8 | 4.2 | **4.8** |
| Authentication/Permissions | 7.4 | 7.0 | 7.2 | 6.5 | 5.8 | 6.5 | **6.4** |
| Notifications | 6.9 | 6.9 | 6.7 | 6.8 | 5.8 | 5.2 | **6.1** |
| Public Website | 7.0 | 6.8 | 6.9 | 6.8 | 6.4 | 6.1 | **6.6** |
| Database Layer | 7.1 | 7.2 | 7.0 | 6.7 | 6.1 | 5.8 | **6.3** |
| API Layer | 7.6 | 7.2 | 7.4 | 7.2 | 6.7 | 6.5 | **7.1** |

## مقارنة كل نظام بثلاث منصات مرجعية عالمية

المنصات التالية مختارة كمرجع لاتساع المنتج ونضجه، وليس باعتبار وجود ترتيب عالمي مطلق.

| النظام | المنصات المرجعية | ما يقدمه v25 فعليًا | الفجوة الأساسية | النتيجة |
|---|---|---|---|---:|
| CRM | [Salesforce Einstein](https://help.salesforce.com/s/articleView?id=sf.einstein_sales.htm&language=en_US)، [Dynamics 365 Sales](https://learn.microsoft.com/en-us/dynamics365/sales/overview)، [HubSpot Sales](https://www.hubspot.com/products/sales?lang=en) | Pipeline قابل للتهيئة، توزيع، ownership، timeline، reminders، merge قابل للعكس، scoring وتقارير | لا يوجد CPQ، territories/forecasting مؤسسي، سجل omnichannel كامل، coaching وAI intelligence بنفس العمق، ولا ecosystem تكاملات | **7.0/10** |
| LMS | [Canvas](https://www.instructure.com/canvas)، [Moodle Workplace](https://moodle.com/solutions/workplace/workplace-features/)، [Docebo](https://www.docebo.com/products/extended-enterprise/) | Courses/bundles، prerequisites، cohorts، entitlement، progress، quizzes، certificates، waitlist | لا يوجد SCORM/xAPI/LTI، gradebook/rubrics/competencies عميقة، proctoring، authoring/versioning، أو إثبات accessibility مؤسسي | **6.2/10** |
| HR | [Workday HCM](https://www.workday.com/en-us/products/human-capital-management/overview.html)، [SAP SuccessFactors](https://www.sap.com/products/hcm/about-successfactors.html)، [Oracle HCM](https://www.oracle.com/human-capital-management/human-resources/) | Employees، recruiting، onboarding/offboarding، leave، appraisal، compensation approval، payroll integration | لا يوجد benefits، statutory payroll/tax engine، position/workforce planning، succession أو skills ontology | **6.0/10** |
| ERP/Finance | [SAP S/4HANA Finance](https://www.sap.com/products/erp/s4hana/features/finance.html)، [Oracle ERP Finance](https://www.oracle.com/erp/finance-and-accounting/)، [Dynamics 365 Finance](https://learn.microsoft.com/en-us/dynamics365/finance/) | Double-entry ledger، periods، journal، payments/refunds، expenses، reconciliation، FX snapshots وتقارير دفترية | لا يوجد AP/AR مؤسسي، vendors/procurement/PO، fixed assets/depreciation، tax engine، consolidation أو inventory accounting | **5.7/10** |
| Attendance | [Workday Time](https://www.workday.com/en-us/products/workforce-management/time.html)، [SAP Time Tracking](https://www.sap.com/products/hcm/employee-time-tracking-software.html)، [UKG WFM](https://www.ukg.com/products/workforce-management) | Check-in/out، shifts، leave، payroll linkage، branch scope وidempotency | لا يوجد تكامل أجهزة biometric، geofencing، rules engine معقد، labor forecasting أو workforce optimization | **5.5/10** |
| Online Follow-up | Salesforce، Dynamics، HubSpot | فريق Online بأدوار ونطاقات، lead assignment، follow-up tasks، WhatsApp configuration، dashboard وKPIs | لا يوجد unified omnichannel conversation timeline، cadence sequencing ناضج، attribution/forecasting/coaching | **6.1/10** |
| Customer Service | [Zendesk](https://www.zendesk.com/service/ai/)، [Salesforce Service Cloud](https://www.salesforce.com/service/cloud/guide/?bc=OTH)، [Dynamics Customer Service](https://learn.microsoft.com/en-us/dynamics365/customer-service/) | Tickets، routing، SLA، escalation، CSAT، replies/outbox، canned responses وFAQ | لا يوجد ingest حقيقي موحد للبريد/واتساب/سوشيال، business-hour SLA calendars، QA/workforce management، أو AI agent assist ناضج | **6.0/10** |
| SaaS | [Stripe Billing](https://stripe.com/billing/features)، [Chargebee](https://www.chargebee.com/billing/manage-subscriptions/)، [Zuora](https://www.zuora.com/products/) | Tenants، plans، entitlements، feature flags، quotas، domains وcontrol plane | لا يوجد metering runtime، proration، invoices/collection، dunning، tax، customer billing portal أو lifecycle automation كاملة | **4.8/10** |

## رحلة العميل الفعلية

| المرحلة | تعمل؟ | مصدر الحقيقة | أين تظهر؟ | CRM Sync | Finance Sync | المشكلة المتبقية | التقييم |
|---|---|---|---|---|---|---|---:|
| Landing/Course discovery | ✅ | courses/bundles/content | الموقع | — | — | لا توجد تجربة performance حية على CDN | 7.0 |
| Registration | ✅ بالكود | users + lead | حساب العميل + CRM | ✅ إنشاء/إعادة استخدام Lead داخل transaction؛ `api/routes/auth.js:80-131` | — | لم يختبر حيًا مع DB الحالية | 7.2 |
| Lead assignment | ✅ بالكود | `assigned_sales_id` + policy | Sales/Admin | ✅ | — | يحتاج UAT بحسابات Production | 7.4 |
| Sales follow-up | ✅ | interactions/timeline/tasks | موظف + إدارة | ✅ | — | WhatsApp الحي غير متاح | 7.0 |
| Course selection/order | ✅ | courses + orders | Client/Admin | ✅ ownership | Pending | Paymob غير داخل الحكم | 6.6 |
| Manual payment approval | ✅ بالكود | payments | Client/CRM/Finance/Admin | ✅ | ✅ | لا يوجد إثبات حي بسبب DB | 6.8 |
| Accounting entry | ✅ بالكود | journal_entries + lines | Finance reports | ✅ عبر payment/subscriber | ✅ نفس transaction؛ `api/lib/orderPaymentConfirmation.js:40-86` | live reconciliation غير منفذ | 7.2 |
| Enrollment | ✅ بالكود | enrollments/entitlements | حساب العميل وLMS | ✅ lead conversion | ✅ يتطلب paid payment | live UAT غير منفذ | 7.1 |
| Learning progress | ✅ بالكود | lecture/progress tables | Client/LMS admin | — | entitlement gate | لا SCORM/xAPI أو proctoring | 6.5 |
| Certificate | ✅ بالكود | course_completions + lifecycle | Client/Public verify/Admin | — | paid entitlement مطلوب؛ `api/lib/courseCompletion.js:21-68` | لا اعتماد خارجي أو credential wallet | 6.6 |
| Paymob | ⏸️ مؤجل | — | — | — | — | في انتظار مراجعة Paymob | خارج الحكم |

## الترابط بين الأنظمة

| نقطة الترابط | الحالة | الدليل | الخلل المتبقي | الخطورة | الحل |
|---|---|---|---|---|---|
| Website ↔ CRM | ✅ بالكود | `api/routes/auth.js:80-131` و`api/routes/lead-capture-crm.js` | لم يثبت حيًا على DB الحالية | P1 | UAT تسجيل فعلي والتحقق من timeline/assignment |
| CRM ↔ Employee | ✅ ثابت | `api/constants/permissions.js:240-251` | لا يوجد UAT حي لكل Role | P1 | تشغيل مصفوفة accounts على staging |
| CRM ↔ Admin | ✅ ثابت | lead state/timeline/assignment tests | — | P2 | مراقبة SLA والتوزيع في الإنتاج |
| CRM ↔ Finance | ✅ بالكود | `api/lib/orderPaymentConfirmation.js:78-82` | Paymob مؤجل | P1 | UAT manual الآن ثم Paymob لاحقًا |
| Payments ↔ Client | ⚠️ | payment/enrollment APIs | Gateway مؤجل | P0 عند إطلاق الدفع الإلكتروني | مراجعة المزود ثم E2E sandbox/live |
| Payments ↔ Accountant/Admin | ✅ بالكود | payment + journal transaction | DB reconciliation الحي غير منفذ | P0 قبل الإطلاق | تشغيل migration/UAT/reconcile |
| HR ↔ Employees | ✅ ثابت | HR routes + private field migration | live account UAT غير منفذ | P1 | اختبار HR/self-service بحسابات حقيقية |
| HR ↔ Payroll | ✅ بالكود | payroll sources fail-closed | لا statutory tax engine | P1 | تصميم payroll localization |
| LMS ↔ Enrollments | ✅ بالكود | entitlement service + progress tests | لا standards interoperability | P2 | SCORM/xAPI/LTI roadmap |
| Certificates ↔ Payments ↔ Client | ✅ بالكود | `api/lib/courseCompletion.js:21-68` | لا UAT حي | P1 | سيناريو paid→complete→certificate |
| SaaS Settings ↔ Modules | ⚠️ | `api/lib/tenantScope.js:67-110` | metering/billing lifecycle ناقص | P1 | بناء usage authority وbilling events |
| Support ↔ Notifications | ✅ بالكود | `api/routes/support.js:251-661` و`api/routes/notifications.js:15-73` | providers الخارجية غير جاهزة | P1 | WhatsApp/email live delivery test |

## جاهزية أدوار الموظفين

النتيجة هنا **جاهزية Static/Contract وليست UAT حي** لأن MySQL غير متاحة.

| الدور | النطاق الفعلي | ما يراه | الحكم |
|---|---|---|---|
| Admin / Manager | كل Tenant | كل الوحدات المسموحة | ⚠️ جاهز ثابتًا؛ live UAT مطلوب |
| Online Manager | كل Tenant تشغيليًا | CRM، online clients، orders، courses، finance حسب الصلاحيات | ⚠️ |
| Sales & Collection Manager | كل Tenant | leads/subscribers/team/finance | ⚠️ |
| Sales | `assigned_sales` | Leads والعملاء والطلبات المسندة | ⚠️ |
| Collection | `assigned_cs` | التحصيل والعملاء والدفعات المسندة | ⚠️ |
| Support | `assigned_cs` | Tickets/inbox والعملاء والطلبات للقراءة | ⚠️ |
| Reception Daqqi | `branch:DAQQI` | عملاء وجدول وطلبات الدقي | ⚠️ |
| Daqqi Manager | `branch:DAQQI` | تشغيل ومال الفرع | ⚠️ |
| HR | لا Customer scope | الموظفون والتوظيف والسياسات والرواتب | ⚠️ |
| Accountant | كل النطاق المالي للـTenant | Payments/Ledger/Refunds/Orders | ⚠️ |
| Consultant | `assigned_sales` | الاستشارات والعملاء المرتبطون | ⚠️ |
| Trainer / Instructor | Course scope | Courses/Lectures وself-service | ⚠️ |

مصدر الحقيقة: `api/constants/permissions.js:232-254`. الحماية الخادمية موجودة ومصفوفة الصلاحيات الثابتة نجحت، لكن لا يجوز تحويل ده إلى “حسابات جاهزة 100%” قبل UAT حي.

## ما تم إغلاقه في الجولة الأخيرة

| المشكلة | الإصلاح | دليل التحقق |
|---|---|---|
| تذاكر تُحذف نهائيًا أو تتعدل بدون locking | Soft archive + transactions + legal transitions + close reason | `api/routes/support.js:251-574`، migration 144 |
| Bell notifications كانت global read state | Recipient scope + per-viewer read receipts | `api/routes/notifications.js:15-73`، migration 145 |
| SaaS entitlement يفشل مفتوحًا | Fail-closed + current subscription dates + flag validation | `api/lib/tenantScope.js:67-110` |
| فروع الإعدادات منفصلة عن جدول الفروع | كتابة content + canonical branches في transaction واحدة | `api/routes/config.js:44-83` |
| ازدواج feature flags/active subscriptions | Unique generated scope keys | migration 146 |
| الميزانية العمومية تعرض أرقامًا مصطنعة | حذف تقديرات 40%/5%/18% وربطها بLedger API | `admin/pages/dashboard/tabs/BalanceSheetTab.tsx:1`، `api/routes/analytics/financial.js:382-445` |
| التدفق النقدي محسوب محليًا من Orders/Expenses | ربطه بقيود حساب النقدية 1100 | `admin/pages/dashboard/tabs/CashFlowTab.tsx:1`، `api/routes/analytics/financial.js:451-505` |

## كل المخاطر والمشكلات المتبقية المثبتة

| ID | المشكلة | الملف والسطر | الخطورة | السبب الجذري | التأثير الفني | تأثير العميل/البيزنس | الحل المقترح |
|---|---|---|---|---|---|---|---|
| PROD-01 | Audit secret غير إنتاجي ومصدره غير موثق | `api/tools/production-readiness.cjs:49-53`، `api/lib/productionConfig.js:17-25` | P0 | Secret ناقص/placeholder وليس من managed source | سلسلة التدقيق لا تملك ضمان tamper evidence إنتاجي | نزاع/امتثال دون دليل موثوق | Secret مستقل 48+ حرفًا في Secret Manager وتوثيق `AUDIT_SECRET_SOURCE` |
| PROD-02 | Redis غير مفعل | `api/tools/production-readiness.cjs:265-271`، `api/lib/rateLimitStore.js:10-26` | P0 | لا `REDIS_URL` ولا distributed flag | Rate limits محلية لكل instance | تجاوز حدود أو سلوك مختلف عند التوسع | Redis HA + TLS + health/latency alarms |
| PROD-03 | Sentry غير مفعل | `api/tools/production-readiness.cjs:230-233`، `api/lib/errorMonitor.js:14-15` | P1 | DSN غير موجود | لا error aggregation/trace | تأخر اكتشاف الأعطال | DSN + release/environment tags + alert routing |
| PROD-04 | مسار الحوادث غير مفعل | `api/tools/production-readiness.cjs:235-253` | P1 | لا HTTPS webhook | إنذارات 5xx بلا وصول للفريق | MTTR أعلى | Incident channel وتجربة alert حية |
| PROD-05 | Data residency غير مثبت | `api/tools/production-readiness.cjs:56-57`، `api/lib/productionConfig.js:63-70` | P1 | المنطقة/المزود/الدليل/تاريخ التحقق غائبون | لا إثبات مكان تخزين البيانات | مخاطرة تعاقدية وخصوصية | قرار region موثق + contract/provider evidence + verification date |
| PROD-06 | WhatsApp غير جاهز | `api/tools/production-readiness.cjs:177-202` | P1 | Meta/Green API credentials غائبة | Outbox لا يضمن تسليم القناة | Follow-up وSLA لا يصلان | Credentials + test recipient + delivery receipt |
| PROD-07 | DB غير متاحة | `api/tools/production-readiness.cjs:68-148` | P0 | MySQL/tunnel متوقف | لا migrations/queue/FX/entitlements verification | النظام غير قابل للتشغيل الموثق | تشغيل staging DB ثم migration/readiness/reconcile |
| PROD-08 | migrations 144-146 غير مثبت تطبيقها | `api/tools/production-readiness.cjs:104-112` | P0 | DB غير متاحة | إصلاحات support/notifications/SaaS قد لا تكون في schema الحية | اختلاف سلوك الإنتاج عن الكود | Apply + checksum + schema snapshot |
| PROD-09 | لا UAT حي للأدوار والرحلة | `api/tests/integration/db.integration.test.js:28-50` | P1 | لا `TEST_DB_*`/DB | العقود ثابتة فقط | صلاحية أو رحلة قد تفشل مع بيانات حقيقية | Tenant A/B + 14 roles + customer journey UAT |
| PERF-01 | p95 login الإنتاجي غير مقاس | `api/tools/load-smoke.cjs:49-82,122` | P1 | القياس الحالي bcrypt محلي | اختناقات DB/network/CPU مجهولة | بطء جماعي عند بدء الدوام | k6/Artillery على staging + CPU/DB pool profile |
| PAY-01 | Paymob مؤجل | `api/tools/production-readiness.cjs:205-206`، `api/tests/publicOrdersFulfillment.test.js:27` | P0 عند التفعيل | مراجعة المزود غير منتهية | E2E finalization غير مثبت | دفع ناجح قد لا يتحول لاشتراك/قيد إن فُعّل مبكرًا | إبقاؤه disabled ثم sandbox→webhook replay→live penny test |
| PAY-02 | Partial/Paymob refunds مؤجلة | `api/lib/refunds.js:45`، `api/tests/refunds.test.js:124-141` | P1 | قرار مقصود حتى مراجعة الدفع | النظام يرفض المسار | خدمة العملاء لا تنفذ refund جزئي آلي | تصميم allocation/reversal بعد قرار المزود |
| SAAS-01 | Billing الدوري ينشئ Pending payment ولا يحصّل | `api/lib/subscriptionBilling.js:72-103` | P1 | لا provider collection workflow | تاريخ التجديد يتقدم دون settlement آلي كامل | إيراد SaaS وتسويات يدوية | invoice→attempt→settlement/dunning state machine |
| SAAS-02 | Usage metering schema بلا runtime authority | `api/schema.sql:3022` | P1 | `tenant_usage` غير مستخدم في services | لا metered billing/quota evidence | لا خطط حسب الاستخدام | event collector idempotent + aggregation + immutable billing snapshot |
| SUP-01 | Inbox legacy منفصل عن نظام التذاكر | `api/routes/inbox.js:11-66`، `admin/context/site-data-hooks/useAiMessagingConfigState.ts:22,55-67` | P2 | مساران تاريخيان؛ أحدهما state متفائل | احتمال اختلاف المحادثة عن ticket timeline | موظف يرى قناة غير مكتملة | deprecate legacy inbox أو تحويله adapter إلى support tickets |
| DEP-01 | React Router advisory مقبول مؤقتًا | `tools/dependency-audit.mjs:19-23`، `admin/package.json:22`، `client/package.json:22` | P1 زمني | استثناء مؤقت لـRSC advisory | خطر عند تغير surface أو انتهاء الاستثناء | مخاطرة أمنية بعد 30 سبتمبر 2026 | Upgrade واختبارات routes قبل تاريخ الانتهاء |
| ARCH-01 | ملفات ضخمة عالية الاقتران | `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` 1464 سطرًا، `admin/pages/Dashboard.tsx` 1340، `LeadsTab.tsx` 943، `FinancialTab.tsx` 768 | P2 | تراكم orchestration وUI/data في ملفات واحدة | صعوبة اختبار وتغيير وأحجام chunks كبيرة | بطء التطوير واحتمال regressions | split by feature/use-case مع server-query hooks وحدود 300-500 سطر |
| ERP-01 | ERP ليس ERP مؤسسيًا كاملًا | `api/routes/accounting-erp.js:1-160` | P1 استراتيجي | النطاق الحالي chart/balances/journals وليس full ERP | غياب AP/AR/procurement/assets/tax/consolidation | عمليات يدوية خارج النظام | تنفيذ roadmap ERP وعدم تسويق الوحدة كـERP كامل قبلها |

## Executive Scorecard

| القسم | التقييم | الحالة |
|---|---:|---|
| Architecture | 7.0/10 | ⚠️ جيدة لكن الاقتران والملفات الكبيرة موجودان |
| CRM | 7.0/10 | ⚠️ قوي تشغيليًا، أقل كثيرًا من enterprise CRM |
| Client Portal | 6.8/10 | ⚠️ رحلة جيدة بالكود، live UAT ناقص |
| Finance | 6.2/10 | ⚠️ Ledger جيد، ERP gaps كبيرة |
| Payments | 4.8/10 | ❌ Paymob والجزئي مؤجلان |
| HR | 6.0/10 | ⚠️ HR operations وليس HCM عالميًا |
| LMS | 6.2/10 | ⚠️ LMS تشغيلي بلا standards ecosystem |
| SaaS Settings | 4.8/10 | ❌ control plane موجود، billing/metering ناقص |
| Database | 6.3/10 | ⚠️ schema جيد بالكود، live migrations غير مثبتة |
| API | 7.1/10 | ⚠️ أفضل طبقات المشروع حاليًا |
| Security | 5.8/10 | ❌ أسرار/Redis/observability/residency غير جاهزة |
| Performance | 6.2/10 | ⚠️ builds جيدة، load production غير مقاس |
| Integration | 6.5/10 | ⚠️ core journey مترابطة بالكود، providers/UAT ناقصان |
| Customer Journey | 6.2/10 | ⚠️ manual path معقول، gateway غير جاهز |
| Code Quality | 6.8/10 | ⚠️ gates قوية، ملفات ضخمة وtechnical debt |
| Overall Project | **64/100** | **غير جاهز لإطلاق عام** |
| Production Launch Readiness | **52/100** | **No-Go حاليًا** |

## أخطر 10 بنود يجب علاجها فورًا

1. تشغيل staging MySQL موثوق وتطبيق migrations 144-146 والتحقق من checksums.
2. ضبط `AUDIT_HMAC_SECRET` مستقلًا من Secret Manager.
3. تشغيل Redis موزع واختبار rate-limit/worker failover.
4. تنفيذ Tenant A/B و14-role UAT ورحلة العميل end-to-end.
5. تشغيل Sentry وincident webhook وتجربة alert حية.
6. تثبيت Data residency بالدليل والتاريخ والمزود.
7. تجهيز WhatsApp وتجربة إرسال واستلام delivery receipt.
8. قياس login/API p95 حيًا تحت حمل واقعي.
9. إبقاء Paymob disabled لحد مراجعة المزود وإنهاء E2E الخاص به.
10. منع تسويق SaaS/ERP كمنتج مؤسسي كامل قبل metering/billing وAP/AR/assets/tax.

## خطة 30 يومًا

### الأيام 1-5: بيئة وإثبات

- Staging مماثل للإنتاج: MySQL، Redis، secrets، Sentry، alert channel.
- تطبيق كل migrations وأخذ schema snapshot.
- تشغيل production-readiness حتى 17 PASS + 1 Paymob SKIP.
- UAT رحلة العميل اليدوية وTenant A/B.

### الأيام 6-10: تشغيل وأداء

- Load test login/CRM/payments/finance/support مع p50/p95/p99.
- CPU profiling، DB slow query log، pool saturation، Redis latency.
- SLOs: API read p95 أقل من 400ms، write p95 أقل من 700ms، login p95 هدف مبدئي أقل من 1.5s مع bcrypt cost محفوظ.

### الأيام 11-15: الحسابات والموظفون

- UAT لكل Role بحساب مستقل: positive/negative permissions وdata scope.
- سيناريوهات maker/checker للتحصيل والمحاسبة.
- HR self-service، attendance→payroll، reception/Daqqi branch isolation.

### الأيام 16-20: الرحلة والتكامل

- Registration→Lead→Assignment→Follow-up→Order→Manual Payment→Journal→Enrollment→Progress→Certificate.
- مطابقة نفس العميل في CRM/Finance/Portal/Admin.
- فشل متعمد في منتصف كل transaction للتأكد من rollback.

### الأيام 21-25: دعم وSaaS

- WhatsApp live test وsupport SLA/CSAT.
- توحيد/deprecate legacy inbox.
- تصميم billing state machine وusage events، من غير تفعيل Paymob.

### الأيام 26-30: Release Candidate

- Upgrade/قرار React Router advisory.
- Full regression + dependency audit + restore drill.
- Security review وrelease checklist وتوقيع Go/No-Go موثق.

## خطة 90 يومًا

### الشهر الثاني

- ERP: AP/AR، vendors، procurement/PO، fixed assets/depreciation، tax foundation.
- SaaS: invoices، attempts، dunning، metering، customer billing portal.
- LMS: SCORM/xAPI أولًا، gradebook/rubrics، accessibility audit.
- CRM/Support: omnichannel identity، conversation timeline، cadence engine.

### الشهر الثالث

- HR/Attendance: payroll localization، devices/geofencing، complex shift/overtime rules.
- Data platform: event/outbox analytics، warehouse/BI، immutable KPI definitions.
- Architecture: تفكيك أكبر أربعة ملفات، query caching، pagination/virtualization، contract-generated API types.
- Reliability: multi-instance chaos/failover، backup restore RTO/RPO، DR exercise، SLO/error-budget dashboard.

## القرار النهائي الصريح

1. **هل نسخة 25 جاهزة للإطلاق؟** لا، ليس قبل إغلاق 12 فشل Production readiness وتشغيل DB/UAT.  
2. **هل تصلح كأساس نهائي؟** تصلح كأساس هندسي قابل للتطوير، لكنها ليست منتجًا نهائيًا بمستوى Salesforce/Workday/SAP/Canvas/Stripe.  
3. **أخطر نقاط الانفصال؟** بيئة الإنتاج عن الكود، Paymob عن رحلة التحصيل، SaaS plans عن billing/metering، legacy inbox عن support tickets، وERP label عن النطاق المحاسبي الفعلي.  
4. **أخطر المشاكل فورًا؟** البنود العشرة المذكورة أعلاه، بالترتيب.  
5. **خطة 30 يومًا؟** إثبات البيئة والرحلة والصلاحيات والأداء ثم Release Candidate فقط إذا تحولت البوابة إلى PASS.  
6. **خطة 90 يومًا؟** إكمال قدرات ERP/SaaS/LMS/HR المؤسسية وتخفيض الاقتران ورفع الاعتمادية.  
7. **الخلاصة الصادقة؟** المشروع أصبح أقوى وأأمن ومترابطًا في المسارات الأساسية، لكن التقييمات السابقة فوق 9/10 كانت أعلى من الدليل الحقيقي. الكود جيد كأساس متوسط النضج؛ التشغيل العام الآن قرار **No-Go** حتى تُغلق فجوات البيئة والاختبار الحي، وحتى بعد ذلك سيظل هناك roadmap منتج حقيقي للوصول لمستوى الأنظمة المرجعية.
