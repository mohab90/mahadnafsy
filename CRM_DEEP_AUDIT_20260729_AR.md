# مراجعة CRM العميقة — نسخة 25

التاريخ: 29 يوليو 2026  
النطاق: الكود الفعلي للـCRM، رحلة الـLead، صلاحيات الموظفين، الربط مع العميل والدفع والحسابات والـLMS، واختبارات الانحدار.  
قرار هذا التقرير: **CRM صالح للتشغيل الداخلي المنضبط، لكنه ليس بعد في مستوى Salesforce/HubSpot/Dynamics كمنتج Enterprise. مسار Lead → Payment اتقفل ذريًا في الكود لدفعة واحدة، بينما يظل الإثبات الحي على staging مطلوبًا قبل اعتباره Production proof.**

## 1) نطاق الكود اللي اتراجع

| الجزء | الملفات الأساسية | الحجم/الدور |
|---|---|---:|
| Lead CRUD والتحويل والاستيراد والدمج | `api/routes/admin/leads.js` | 1,116 سطر |
| Pipeline / assignment / interactions | `api/routes/crm-advanced.js` | 320 سطر |
| المتابعات والـWhatsApp المجمع | `api/routes/crm-ops.js` | 90 سطر |
| التسجيل العام وCheckout intent | `api/routes/lead-capture-crm.js` | 403 سطر |
| Scoring | `api/routes/analytics/leads-scoring.js` | 164 سطر |
| Campaign attribution وDrip | `api/routes/analytics/campaigns.js` | 277 سطر |
| Canonical data scope | `api/lib/leadAccess.js` | 26 سطر |
| Assignment policy | `api/lib/leadAssignment.js` | 122 سطر |
| Pipeline state machine | `api/lib/leadPipeline.js` | 102 سطر |
| Communications / outbox | `api/lib/leadInteractions.js` | 208 سطر |
| Reversible merge | `api/lib/leadMerge.js` | 227 سطر |
| Drip worker | `api/lib/dripCampaigns.js` | 115 سطر |
| شاشة CRM الرئيسية | `admin/pages/dashboard/tabs/LeadsTab.tsx` | 709 سطر |
| جدول الـLeads | `admin/pages/dashboard/tabs/LeadTable.tsx` | 795 سطر |
| Actions orchestration | `admin/pages/dashboard/tabs/leads/useLeadActions.ts` | 269 سطر |

الـCRM الفعلي مش Module واحد؛ هو شبكة من lead capture، leads، pipeline، communications، reminders، scoring، campaigns، inbox، orders، subscribers، payments، entitlements وfinance.

## 2) خريطة الـAPIs الأساسية

| الوظيفة | Route | صلاحية/Scope | النتيجة |
|---|---|---|---|
| إنشاء/تحديث Lead | `POST /api/admin/leads` | `manage_leads` + canonical row scope | Transaction + duplicate lock + timeline |
| قائمة Leads | `GET /api/admin/leads` | `view_leads` + role scope | Paginated، لكن الواجهة تجمع الصفحات كلها |
| إحصاءات Pipeline | `GET /api/admin/leads/stats` | `view_leads` + role scope | Aggregate من السيرفر |
| حذف/Archive | `DELETE /api/admin/leads/:id` | Admin + `manage_leads` | Soft archive |
| Bulk assignment | `POST /api/admin/leads/bulk-assign` | `manage_leads` + limiter + scope | Transactional |
| Merge / Unmerge | `/api/admin/leads/merge`, `/unmerge` | Admin | Tenant locked + reversible audit |
| تحويل لمشترك | `POST /api/admin/leads/:id/convert` | `manage_leads` + scope | Transactional، بدون منح LMS قبل الدفع |
| Pipeline config | `GET/PUT /api/admin/crm/pipeline` | قراءة للموظف، تعديل Admin | Tenant-owned state machine |
| Interaction | `POST /api/admin/crm/leads/:id/interactions` | `manage_leads` + scope | التفاعل + المتابعة + الحالة في Transaction |
| حذف Interaction | `DELETE .../:interactionId` | `manage_leads` + scope | حذف فعلي + إعادة حساب آخر تواصل + audit |
| Stale / due | `/api/admin/crm/stale-leads`, `/follow-up-due` | `view_leads` + scope | DB-date based |
| Bulk WhatsApp | `POST /api/admin/crm/bulk-whatsapp` | `bulk_whatsapp` + scope + limiter | Outbox، وليس إرسال browser محلي |
| Public registration | `POST /api/registrations` | Public limiter | Tenant + identity lock + Lead |
| Public lead | `POST /api/leads-public` | Public limiter | Deduped/assigned/audited |
| Checkout intent | `POST /api/public/checkout-intent` | Auth + public limiter | Order/Lead intent، وليس دفع مؤكد |
| Scoring | `/api/admin/leads/scoring*` | Scope في القراءة، Admin في config/recalc | Rule-based |
| Campaign report | `GET /api/admin/reports/campaign` | `view_leads` + `view_reports` + scope | Revenue مخفي بدون `view_financial` |
| Drip enrollment | `/api/admin/drip-sequences/:id/enroll` | Admin | Locked + suppression-aware + outbox |

## 3) رحلة العميل داخل CRM

| المرحلة | تعمل؟ | الدليل من الكود | الترابط | التقييم |
|---|---|---|---|---:|
| Registration | ✅ | `api/routes/lead-capture-crm.js:30-110` | ينشئ/يربط Lead تحت tenant وبـGET_LOCK | 8.5/10 |
| Lead dedupe | ✅ | `api/routes/admin/leads.js:68-159` | Phone/email + subscriber conflict | 8.5/10 |
| Assignment | ✅ | `api/lib/leadAssignment.js` + migration 118 | branch/capacity/availability/weight | 8/10 |
| Sales follow-up | ✅ | `api/routes/crm-advanced.js:127-177` | Interaction + state + follow-up transaction | 8.5/10 |
| Admin visibility | ✅ | `lead_timeline`, communications، scoring/report scope | حركة الموظف مخزنة ومقروءة للإدارة | 8/10 |
| Course interest | ✅ | DB columns + `interested_course_ids_json` | Intent فقط، لا يفتح المحتوى | 8/10 |
| Checkout intent | ✅ | `api/routes/lead-capture-crm.js:246-399` | ينشئ intent/order قابل للاستكمال | 7.5/10 |
| Manual CRM payment | ✅ في الكود / غير مؤكد حيًا | `admin/pages/dashboard/dashboardPaymentHandlers.ts` + `api/routes/subscriber-payments.js` | Lead + subscriber + payment + journal + entitlement + conversion في Transaction واحدة | 8.5/10 |
| Accounting entry | ✅ لكل دفعة منفردة | `api/routes/subscriber-payments.js:298-305` | القيد داخل نفس Transaction بتاعة الدفعة | 8.5/10 |
| Enrollment | ✅ لكل دفعة paid | `api/routes/subscriber-payments.js:195-220` | Entitlement authority؛ pending لا يفتح LMS | 8.5/10 |
| Lead conversion | ✅ عند paid | `api/routes/subscriber-payments.js:320-338` | Lead → converted داخل Transaction الدفعة | 8.5/10 |
| Client dashboard | ✅ | الـsubscriber/enrollment projections | يعتمد على entitlements مش `crm_json` | 8/10 |
| Certificate | ⚠️ كرحلة كاملة | payment/certificate lifecycle موجودان | الاستحقاق مربوط بالإكمال والدفع، لكن UX موزع | 7/10 |

### إغلاق فجوة Lead Checkout

المسار القديم كان ينشئ Subscriber من الواجهة ثم يرسل دفعات منفصلة. اتغير كالتالي:

- الواجهة ترفض أكتر من بند دفع مؤقتًا برسالة واضحة، التزامًا بتأجيل تجزئة الدفع.
- لو العميل لسه Lead، الواجهة تبعت `lead_id + payment` مرة واحدة.
- السيرفر يقفل الـLead، يعيد فحص duplicate Subscriber، ينشئ Subscriber عند الحاجة، ثم يسجل payment والقيد والـentitlement والتحويل داخل **نفس Transaction**.
- أي فشل قبل `commit` يرجع كل العملية، فلا يفضل Subscriber نصف مكتمل.
- Paymob لم يتم لمسه ويظل disabled.

المتبقي هنا تشغيلي: تشغيل نفس السيناريو على staging MySQL حقيقي، لأن البيئة الحالية لا تحتوي DB listener.

## 4) الصلاحيات وحسابات الموظفين

المصدر الحاكم موجود في `api/constants/permissions.js:107-255`، والـrow scope في `api/lib/leadAccess.js`.

| الدور | ما يراه في CRM | ما يقدر يعمله | الجاهزية | ملاحظة صريحة |
|---|---|---|---:|---|
| Admin / Manager | كل الـLeads | كل العمليات | 9/10 | مناسب للتشغيل؛ الملفات الكبيرة ما زالت عبء صيانة |
| Sales & Collection Manager | كل الـLeads | إدارة/تصدير/حذف/WhatsApp | 8.5/10 | فصل سلطة الدفع والاعتماد موجود |
| Online Manager | كل الـLeads حاليًا | CRM + finance + online ops | 7/10 | `DATA_SCOPE='all'` قرار واسع؛ لازم اعتماد بيزنس صريح لو المفروض Online فقط |
| Daqqi Manager | فرع DAQQI | إدارة داخل الفرع | 8.5/10 | branch scope فعلي في SQL |
| Reception Daqqi | فرع DAQQI | إضافة/تعديل، بدون أدوات Admin | 8.5/10 | الواجهة اتقفلت حسب permission بدل إظهار أزرار 403 |
| Sales | الـLeads المسندة له | متابعة/حالة/تواصل/تصدير/WhatsApp | 8.5/10 | لا يرى Leads زميله |
| Collection | لا يدخل CRM lead screen افتراضيًا؛ يرى المشتركين المسندين | دفع/تحصيل حسب finance scope | 8/10 | ده فصل مقصود بين prospect وsubscriber |
| Support | لا يدخل Lead CRM افتراضيًا؛ يرى العملاء المسندين وخدمة العملاء | خدمة/Inbox | 8/10 | مناسب لو خدمة العملاء تبدأ بعد الاشتراك |
| Accountant | لا يحمل CRM افتراضيًا | Finance/orders/payments | 8.5/10 | `DATA_SCOPE=all` لا يعمل وحده بدون `view_leads` |
| Consultant | Leads مسندة له، قراءة فقط | View فقط | 7.5/10 | الواجهة الآن تخفي كل mutation controls |
| HR / Trainer / Instructor | لا Leads | لا CRM | 9/10 | عزل صحيح |

### إصلاح واجهة الصلاحيات في الجولة دي

من `admin/pages/dashboard/tabs/LeadsTab.tsx:145` يتم حساب `canManageLeads` من نفس permission registry. وتم تمريره للـHeader، Pipeline، Table، Communications وArchive. النتيجة:

- View-only لا يرى Add، drag/drop، status/source/branch/assignee edits، booking، delete، interaction delete، import أو bulk assignment.
- Export وBulk WhatsApp مستقلين عن `manage_leads`.
- الـAPI يظل الحاجز النهائي؛ إخفاء الزر UX وليس بديل أمان.

## 5) سلامة البيانات والترابط

| النقطة | الحالة | الدليل | الحكم |
|---|---|---|---|
| Tenant isolation | ✅ | `leadScope()` مطبق في list/write/status/interactions/reports/reminders/bulk | قوي |
| Duplicate prevention | ✅ | phone/email identity + GET_LOCK | قوي |
| Pipeline state | ✅ | `transitionLead()` + allowed transitions + audit | قوي |
| Assignment | ✅ | tenant staff validation + row lock + audit | قوي |
| Communications | ✅ | canonical table، tenant index، transactional writer | قوي |
| Interaction delete | ✅ | DB delete + recompute + immutable deletion event | قوي |
| Merge | ✅ | relations reparented + snapshot + unmerge | قوي |
| CRM → Finance | ✅ في الكود | lead checkout أصبح server-owned atomic command | يحتاج live DB proof |
| CRM → LMS | ✅ بعد paid | entitlement داخل payment transaction | قوي |
| CRM → Client | ✅ | subscriber/lead identity linked | جيد جدًا |
| Campaign → Revenue | ✅ بصلاحية | scoped lead join؛ money hidden without finance permission | جيد جدًا |
| Drip | ✅ معماريًا | scheduler → DB lock → suppression → outbox dedupe | قوي |
| WhatsApp live delivery | غير مؤكد | architecture موجود، credentials/live receipt خارجي غير متاح حاليًا | لا يُعتمد إنتاجيًا بعد |

## 6) الأداء والسرعة

### نقاط القوة

- Server-side stats بدل حساب كل KPIs من browser: `api/routes/admin/leads.js:963`.
- Pagination وkeyset option: `api/routes/admin/leads.js:993-1051`.
- Index-aware status filter بدون `LOWER(column)`.
- Lazy chunks: `LeadPipelineBoard` 3.41KB، `LeadModalsHost` 12.72KB، والـCRM الرئيسي chunk مستقل.
- Build إنتاجي ناجح؛ `LeadsTab` الحالي 96.66KB raw / 24.12KB gzip.

### عنق الزجاجة الحقيقي

| ID | المكان | السبب الجذري | التأثير | الحل |
|---|---|---|---|---|
| CRM-PERF-01 | `admin/lib/mysqlapi.ts:165-176` | `listAllLeads()` يجمع لحد 50 ألف Lead في المتصفح | وقت تحميل/ذاكرة/تجميد عند نمو البيانات، وcap صامت | Server-driven list state + cursor + total، وإلغاء full hydration |
| CRM-PERF-02 | **اتعالج** في `api/lib/leadRepository.js` و`crm-advanced.js` | كان لحد 200 communication لكل Lead | القائمة بقت آخر 20 + العدد الحقيقي، والتاريخ حتى 300 on-demand | مراقبة query p95 على staging |
| CRM-PERF-03 | `admin/context/site-data-hooks/useAdminDataRuntime.ts:304-327` | Admin silent refresh يعيد كل Leads كل دقيقتين | حمل ثابت يزيد خطيًا | delta feed/updated cursor أو invalidation events |
| CRM-PERF-04 | `admin/pages/dashboard/tabs/LeadTable.tsx` | 795 سطر و100 row DOM/table controls | render/update cost وصعوبة memoization | server pagination + virtual rows + فصل cells/actions |

الـCRM الحالي مناسب لعشرات الآلاف لو النشاط متوسط، لكنه **مش معماريًا جاهز لـ500k Leads** رغم وجود endpoint stats. تعليق الكود اللي يوحي إن النظام “never has to pull the whole table” غير متحقق في الواجهة الحالية.

## 7) مقارنة صريحة بأفضل 3 أنظمة

المقارنة مبنية على القدرات الرسمية الحالية:

- Salesforce يقدّم model واضح للـLead/Account/Contact/Opportunity، pipeline وforecasting وAI-guided selling: [Salesforce Sales Cloud](https://www.salesforce.com/sales/cloud/guide/?bc=OTH).
- HubSpot يجمع workspace للمبيعات، sequences، forecasting، conversation intelligence، predictive scoring وduplicate management: [HubSpot Sales Hub](https://www.hubspot.com/products/sales?lang=en) و[HubSpot CRM](https://www.hubspot.com/products/crm?software=crm).
- Dynamics 365 يقدّم lead-to-cash، predictive scoring، sequences، relationship/conversation intelligence وqualification audit: [Dynamics 365 Sales](https://learn.microsoft.com/en-us/dynamics365/sales/) و[Lead management](https://learn.microsoft.com/en-us/dynamics365/sales/lead-management-overview).

| القدرة | Mahad v25 | Salesforce | HubSpot | Dynamics | الفجوة |
|---|---:|---:|---:|---:|---|
| Lead capture/dedupe/assignment | 8/10 | 9.5 | 9 | 9 | قريبة تشغيليًا |
| Pipeline/state/audit | 8 | 9.5 | 9 | 9.5 | لا يوجد Opportunity entity مستقل |
| Activities/follow-up | 8 | 9.5 | 9.5 | 9.5 | لا email/calendar auto-capture ولا call intelligence |
| Scoring | 6 | 9.5 | 9 | 9 | Rule-based فقط؛ لا predictive/event training |
| Forecasting | 4.5 | 9.5 | 9 | 9.5 | تقارير/KPIs، مش forecast engine |
| Automation/sequences | 7.5 | 9.5 | 9.5 | 9 | outbox جيد؛ branching/versioning/experiments أضعف |
| Duplicate management | 8 | 9.5 | 9 | 9 | merge قوي؛ لا configurable matching studio |
| Seller workspace | 7.5 | 9.5 | 9.5 | 9 | مفيد، لكن لا guided next-best action |
| Mobile/offline | 2 | 9 | 8.5 | 9 | غير موجود كمنتج CRM |
| Enterprise scale | 5 | 10 | 9 | 9.5 | full-browser hydration |
| CRM→Finance/LMS | 7 | 8.5 | 7.5 | 9.5 | التكامل المحلي ميزة، لكن checkout command غير ذري |
| SaaS tenant safety | 8.5 | 10 | 9.5 | 10 | قوي في الكود؛ التشغيل الخارجي لسه له gates |

### مميزات تنافسية حقيقية في المشروع

1. ربط مباشر بين Lead والدفع والقيد المحاسبي والـentitlement والعميل، بدل integrations منفصلة.
2. Tenant/role/branch scope داخل SQL.
3. Reversible merge مع audit.
4. Payment لا يفتح LMS إلا من entitlement authority.
5. Drip/bulk messaging مبنيين على outbox/dedupe بدل `setInterval` داخل route.
6. رحلة DAQQI والOnline مدمجة في نفس customer identity.

### المميزات الناقصة مقارنة بالمنافسين

1. Account/Contact/Opportunity model.
2. Qualification gates وBANT/MEDDICC-style process.
3. Quotes/CPQ/product line items.
4. Forecast categories وmanager commit.
5. Email/calendar activity capture.
6. Call recording/transcription/coaching.
7. Predictive scoring وتفسير النموذج.
8. Territory/queue routing studio.
9. Visual automation builder بversioning/testing.
10. Mobile/offline seller app.
11. Custom objects/fields/report builder.
12. SLA escalation calendar/business hours.
13. Consent center كامل لكل قناة.
14. Server-driven search/listing at enterprise scale.
15. Atomic lead checkout command.

## 8) المشاكل الموحدة

| ID | المشكلة | الملف والسطر | الخطورة | السبب الجذري | التأثير الفني/البيزنس | الحل |
|---|---|---|---|---|---|---|
| CRM-001 | Live proof للـLead checkout الجديد غير منفذ | `api/routes/subscriber-payments.js` | P1 Release | staging DB غير متاح | لا يمكن إثبات rollback/commit حيًا | DB integration + forced-failure test |
| CRM-002 | تحميل كل Leads للمتصفح | `admin/lib/mysqlapi.ts:165` | P1 | client-side full hydration | بطء/ذاكرة وحد توسع | cursor list state |
| CRM-003 | إثبات أداء communications الجديد حيًا | `api/lib/leadRepository.js:37` | P2 Release | DB غير متاح للجولة | التحسين مثبت بالكود لا بالـp95 الحي | load test على 13k+ Lead |
| CRM-004 | Full refresh دوري | `useAdminDataRuntime.ts:304-327` | P1 | polling snapshot كامل | ضغط ثابت | delta/events |
| CRM-005 | ملف Leads route ضخم | `api/routes/admin/leads.js` (1,116 سطر) | P1 | CRUD/import/merge/convert/list في router واحد | coupling واختبار أصعب | controllers/services أصغر |
| CRM-006 | LeadTable ضخم | `LeadTable.tsx` (795 سطر) | P2 | table + modals + history + WhatsApp | rerender/refactor risk | split + virtualization |
| CRM-007 | لا Opportunity model | `api/schema.sql`/CRM migrations | P2 | Lead يتحول مباشرة Subscriber | forecasting/qualification ضعيف | contacts/accounts/opportunities schema |
| CRM-008 | Scoring rule-based فقط | `api/routes/analytics/leads-scoring.js` | P2 | weights ثابتة | أولوية أقل دقة | behavioral signals ثم predictive model |
| CRM-009 | Online Manager يرى كل CRM | `api/constants/permissions.js:237` | P1 Policy | `DATA_SCOPE='all'` | ممكن يرى DAQQI/local لو ده غير مقصود | اعتماد policy أو online branch scope |
| CRM-010 | Live WhatsApp غير مثبت | external credentials | P1 Ops | provider credentials/receipt proof غير جاهزين | المتابعة الآلية غير مضمونة | live send + signed receipt evidence |
| CRM-011 | Live DB UAT غير معاد بعد التغييرات | البيئة الحالية: 3306/3307 غير متاحين | P1 Release | لا staging DB شغال وقت الجولة | لا أقدر أزعم 100% runtime | تشغيل staging وإعادة UAT 17 roles |
| CRM-012 | Paymob E2E مؤجل | provider review | Deferred | قرار مقصود | الدفع الإلكتروني غير جاهز | يظل disabled/fail-closed |

## 9) الإصلاحات المنفذة في الجولة

1. Canonical write scope لكل create/update/bulk/status/interaction.
2. منع branch roles من إنشاء Lead خارج فرعها.
3. منع collection/support scopes من إنشاء prospect غير مملوك.
4. Bulk WhatsApp أصبح scoped قبل enqueue.
5. حذف interaction أصبح DB-backed وليس local UI filter.
6. interaction + next follow-up + status بقت Transaction واحدة.
7. reminder due-today يستخدم scope وDB date.
8. campaign/scoring reports بقت role scoped، والإيراد محجوب بدون finance permission.
9. Drip اتشال من route-local interval واتنقل scheduler + transaction + outbox + dedupe + suppression + unsubscribe.
10. View-only UI اتقفلت بالكامل حسب permission.
11. empty API result يمسح stale UI state فعلًا.
12. payment modal يفضل مفتوح عند الفشل بدون unhandled rejection.
13. قائمة الـLeads تحمل آخر 20 تفاعل فقط مع العدد الحقيقي؛ التاريخ الكامل يُطلب عند فتحه.

## 10) نتيجة الاختبارات

| الاختبار | النتيجة |
|---|---:|
| CRM targeted integrity/tenant tests | 28/28 |
| Unit regression الكامل | 517 total، 516 pass، 0 fail، 1 Paymob TODO مقصود |
| Quality guards | 56/56 |
| Admin TypeScript | Pass |
| Admin production build | Pass، 3,055 modules |
| Live MySQL CRM UAT بعد آخر patch | **لم يُنفذ في الجولة الحالية لعدم وجود DB listener** |

النجاح الستاتيكي والوحداتي قوي، لكنه لا يساوي Production proof. لا يوجد ادعاء 100% قبل staging DB + live role UAT + provider messaging evidence.

## 11) Executive Scorecard — CRM فقط

| البند | التقييم |
|---|---:|
| Business logic | 8.0/10 |
| Database integrity | 8.5/10 |
| Tenant/role security | 8.5/10 |
| Customer journey | 7.8/10 |
| Finance/LMS integration | 8.2/10 |
| UX | 7.5/10 |
| Performance | 5.5/10 |
| Maintainability | 6.2/10 |
| Enterprise features | 4.8/10 |
| Operational readiness | 6.0/10 |
| **CRM overall الحالي** | **7.3/10** |

## 12) القرار

- **هل CRM جاهز 100%؟ لا.**
- **هل قابل للتشغيل الداخلي؟ نعم، مع تعطيل Paymob ومع مراقبة أحجام البيانات.**
- **هل الأمان والترابط أحسن بوضوح؟ نعم؛ الـscope والـtransactions والـoutbox دلوقتي أقوى من بداية الجولة.**
- **أهم مانع للإغلاق:** live staging UAT للـcheckout والـ17 role، ثم server-driven pagination/history.
- **هل هو في مستوى أفضل CRM عالمي؟ لا؛ هو CRM تشغيلي مخصص قوي بالنسبة لرحلة المعهد، لكنه ناقص enterprise opportunity/forecasting/intelligence/scale capabilities.**
