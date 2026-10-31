# خطة تحويل Mahad Nafsy v25 إلى نسخة احترافية

> الخطة التنفيذية الأساسية الوحيدة للمشروع — آخر تحديث: 2026-07-30
> المرجع القديم `SYSTEM_LAUNCH_MASTER_PLAN_20260718.md` يظل مرجعًا تاريخيًا، لكن الحالات والأولويات المعتمدة موجودة هنا.
>
> آخر تحقق هندسي في 30 يوليو 2026: 606 اختبارات، 605 نجاح، صفر فشل، وPaymob TODO واحد مؤجل بقرار المنتج؛ 56/56 Quality، ونجاح TypeScript للواجهتين. UAT الفعلي 57/57 على 19 حساب/دور، DB integration ‏5/5، وTenant A/B/reconciliation بلا مخالفة حرجة على MySQL 8.4 المعزول. migrations ‏144–175 مطابقة للـchecksums، و`schema.sql` أنشأ 186 جدولًا في Fresh DB مؤقتة بنجاح. المتبقي للإطلاق الخارجي: Managed MySQL/Redis، Secret Manager evidence، Sentry/incident webhook، Data Residency/Geo evidence، SMTP/WhatsApp live receipts، تدوير credential قديم ظهر في Git history، وclean reviewed commit/artifacts. لا تُعتبر النسخة Production 100% قبل اجتياز هذه البوابات.

## 1) النتيجة المطلوبة

تحويل v25 إلى منصة:

- أسرع وأخف في الواجهة والـAPI وقاعدة البيانات.
- أقل في حجم الكود والتكرار، بدون حذف سلوك شغال أو كسر العقود الحالية.
- معمارية Domain-based واضحة بدل الملفات المركزية الضخمة.
- كل Module له مصدر بيانات واحد، API واضح، صلاحيات، Audit واختبارات.
- رحلة العميل مترابطة من أول الزيارة حتى الدفع والتعلم والشهادة.
- Finance وPayments مبنيين على Ledger ومصالحة فعلية، وليس مجرد شاشات تقارير.
- SaaS حقيقي يمنع أي اختلاط بين المؤسسات والفروع.
- قابلة للتشغيل والمراقبة والاسترجاع بدون اعتماد على أفراد بعينهم.

### معنى “رحلة عميل صحيحة 100%”

لن تُعتبر الرحلة مكتملة إلا عندما:

1. كل مرحلة لها سجل دائم في قاعدة البيانات.
2. كل انتقال حالة يتم من خلال Service مركزي ومعاملة ذرية عند الحاجة.
3. كل أثر مالي له Payment + Journal + Reconciliation evidence.
4. نفس الحقيقة تظهر للإدارة والموظف والعميل والمحاسب بدون نسخ متعارضة.
5. كل Action حرج Idempotent وله Audit trail.
6. E2E آلي يمر على Staging بقاعدة MySQL حقيقية.
7. تقارير المصالحة ترجع صفر حالات ناقصة قبل الإصدار.

## 2) خط الأساس المؤكد

| البند | الحالة الحالية |
|---|---|
| API Unit Tests | 605 ناجح، 0 فشل، 1 Paymob TODO مؤجل |
| Quality Gates | 56/56 ناجحة |
| Admin/Client TypeScript | ناجح |
| Admin/Client Production Build | ناجح |
| Migrations | 144–175 مطبقة ومثبتة محليًا بالـchecksums؛ التطبيق الإنتاجي ينتظر Managed Staging موثوق |
| Migration Drift | صفر؛ Base/Fresh/Restore متطابقون |
| Duplicate Routes | صفر |
| Runtime Route DDL | صفر |
| Tenant Scanner | 34 مرشحًا ثابتًا مقابل baseline قديم 68 |
| API Liveness | يعمل على 3001 |
| DB Readiness | MySQL 8.4 المحلي اجتاز migration/integration/UAT؛ إثبات Managed TLS/PITR ما زال خارجيًا |
| Dependency Audit | API: صفر؛ Admin/Client: تحذير React Router RSC upstream غير مستخدم في تطبيقات SPA |
| Paymob | موقوف لحين مراجعة Paymob |
| تجزئة الدفع/Partial Refund | مؤجلة بقرار منتج |

### ملفات تحتاج تفكيكًا تدريجيًا

| الملف | الحجم الحالي | الهدف |
|---|---:|---:|
| `api/server.js` | 61 سطر | ✅ أقل من 350 |
| `admin/context/SiteDataContext.tsx` | 780 تقريبًا | أقل من 300 |
| `client/context/SiteDataContext.tsx` | 556 تقريبًا | أقل من 300 |
| `admin/pages/Dashboard.tsx` | 1255 | أقل من 600 |
| `admin/pages/UnifiedClientPage.tsx` | 660 | ✅ أقل من 700 |
| `admin/pages/dashboard/tabs/LeadsTab.tsx` | 709 | أقل من 600 |
| `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` | 1296 تقريبًا | أقل من 800 |
| `client/pages/UserDashboard.tsx` | 1137 | أقل من 650 |

الأهداف السابقة ليست حذف أسطر فقط؛ النجاح يُقاس بانخفاض التعقيد والتكرار مع ثبات العقود والاختبارات.

## 3) مبادئ تنفيذ غير قابلة للتفاوض

1. v25 هي النسخة الأساسية الوحيدة؛ v26/v30 مراجع انتقائية فقط.
2. لا نقل كامل لأي Module من نسخة أخرى.
3. لا كتابة Business State داخل React Context أو Local Storage كبديل لقاعدة البيانات.
4. لا Action مالي خارج Transaction وPeriod Lock وLedger posting.
5. لا Query Business بدون `tenant_id` موثوق.
6. لا Success UI قبل نجاح الـAPI وتأكيد الحفظ.
7. لا Runtime DDL؛ كل تغيير Schema من Migration مرقمة.
8. لا حذف أو Merge لبيانات عميل بدون خريطة علاقات وAudit وإمكانية استرجاع.
9. كل تغيير صغير، قابل للمراجعة، وله Test مناسب.
10. لا إطلاق مع Critical/High مفتوحة أو DB E2E محجوب.
11. Paymob وتجزئة الدفع لا يتغيران قبل اجتياز Gate المخصص لهما.
12. الأداء والأمان وقابلية التشغيل جزء من Definition of Done، وليس مرحلة تجميل أخيرة.

## 4) ترتيب الأولويات

| الأولوية | المعنى | زمن التعامل |
|---|---|---|
| P0 | يمنع الإطلاق أو يهدد المال/البيانات/العزل | فورًا |
| P1 | يسبب ضعف تشغيل أو تجربة أو صيانة كبيرة | داخل 30 يوم |
| P2 | تطوير معماري وأداء ومميزات تنافسية | 31–90 يوم |
| P3 | تحسينات توسع وذكاء وأتمتة متقدمة | بعد ثبات المنصة |

## 5) خارطة التنفيذ

### المسار A — البيئة وقاعدة البيانات وبوابات الإصدار

| ID | P | البند | المالك الوظيفي | الاعتماد | معيار القبول |
|---|---:|---|---|---|---|
| ENV-01 | P0 | توفير MySQL Staging مطابق للإنتاج | DevOps/DBA | — | readiness=200 واتصال TLS/credentials منفصلة |
| ENV-02 | P0 | أخذ Snapshot آمن قبل migrations | DBA | ENV-01 | نسخة مشفرة واختبار قراءة metadata |
| ENV-03 | P0 | تطبيق migrations 065–112 على نسخة بيانات واقعية | DBA/Backend | ENV-02 | نجاح أول تشغيل والثاني No-op |
| ENV-04 | P0 | Fresh install من `schema.sql` ثم migrations | QA/DBA | ENV-01 | Schema نهائي يطابق upgrade path |
| ENV-05 | P0 | تشغيل reconciliation الحالية على Staging | Finance QA | ENV-03 | صفر paid-without-journal/enrollment |
| ENV-06 | P0 | Tenant-A/Tenant-B matrix لكل Module | Security QA | ENV-03 | صفر قراءة/تعديل Cross-tenant |
| ENV-07 | P0 | Backup/restore drill كامل | DBA/DevOps | ENV-03 | RPO/RTO موثق واسترجاع ناجح |
| ENV-08 | P1 | CI ينفذ static + DB integration + builds | DevOps | ENV-04 | أي فشل يمنع الدمج |
| ENV-09 | P1 | Release candidate immutable + versioning | DevOps | ENV-08 | نفس artifact ينتقل Staging→Production |
| ENV-10 | P1 | Roll-forward/rollback rehearsal | DevOps/DBA | ENV-07 | Runbook مجرب وليس نظريًا |

#### نتيجة تنفيذ المرحلة الأولى — 2026-07-25

| البند | الحالة | دليل القبول الفعلي |
|---|---|---|
| ENV-01 | ✅ مكتمل محليًا | MySQL 8.4.10 LTS؛ `/api/health` = 200؛ TLS AES-256 مع Verify-CA؛ اتصال plaintext مرفوض |
| ENV-02 | ✅ مكتمل | Snapshot قبل الترحيل + Backup نهائي AES-256-GCM؛ المفتاح منفصل ومقيد للمستخدم الحالي |
| ENV-03 | ✅ مكتمل | Upgrade حتى migration 113؛ إعادة التشغيل `baseline=0 applied=0 failed=0` |
| ENV-04 | ✅ مكتمل | Base/Fresh: 159 جدول، 1854 عمود، 937 index، 299 constraint، 47 علاقة — تطابق كامل |
| ENV-05 | ✅ مكتمل | `reconcile` و`smoke:live-db`: صفر مخالفات مالية/تكامل حرجة |
| ENV-06 | ✅ مكتمل | Matrix حي لـTenant A/B على SaaS/CRM/HR/LMS/Finance/Notifications/Tasks: صفر Cross-tenant read/update |
| ENV-07 | ✅ مكتمل | Backup 4.072s، Restore 19.359s؛ 159 جدول و247 سجل وقت القياس؛ Schema/Data/aggregates متطابقة |

الـRPO المقاس في التجربة هو لحظة الـsnapshot نفسها، والـRTO المقاس 19.359 ثانية على حجم الاختبار الحالي. هذه أرقام Staging محلية وليست وعد Production قبل قياسها على حجم البيانات والبنية الفعليين.

### المسار B — عقد رحلة العميل والترابط بين الأنظمة

| المرحلة | مصدر الحقيقة | الآثار الإلزامية | الاختبار المطلوب |
|---|---|---|---|
| Landing/Attribution | `utm/campaign attribution` | source/campaign/tenant محفوظة | UTM survives registration |
| Registration | `users + subscribers` | Lead واحد وربط identity | duplicate/concurrent registration |
| Lead Creation | `leads` | assignment + timeline + SLA | least-load + audit |
| Sales Follow-up | `lead_timeline/tasks` | activity visible Admin/Employee | status parity |
| Course Selection | `courses/bundles` | server price + tenant entitlement | tampered price rejected |
| Booking/Order | `orders` | immutable item snapshot | duplicate click idempotent |
| Manual Payment | `payments/proofs` | approval authority + branch | double approval rejected |
| Accounting | `journal_entries/lines` | balanced entry + FX snapshot | debit=credit |
| Enrollment | `enrollments` | access only after valid entitlement | paid-without-access=0 |
| Client Portal | Server APIs | course/payment/timeline parity | reload/device consistency |
| Completion | `course_completions` | progress prerequisites | repeat completion idempotent |
| Certificate | `certificate_requests/completions` | eligibility + audit + verification | unpaid/ineligible rejected |

#### بنود التنفيذ

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| JNY-01 | P0 | إنشاء E2E حقيقي Landing→Registration→Lead→Assignment | Assertions داخل DB بعد كل خطوة |
| JNY-02 | P0 | E2E Course→Order→Proof→Approval→Journal→Enrollment | كل IDs مترابطة وTransaction واحدة عند التسوية |
| JNY-03 | P0 | E2E Progress→Completion→Certificate→Dashboard | الصلاحية والدفع والتقدم متوافقة |
| JNY-04 | P0 | تقرير users بدون subscribers/leads | صفر حالات أو Queue إصلاح مراقبة |
| JNY-05 | P0 | تقرير converted leads بدون subscriber | صفر |
| JNY-06 | P0 | تقرير paid orders بدون payment/journal/enrollment | صفر |
| JNY-07 | P0 | Contract مركزي لحالات Lead/Order/Payment/Enrollment | لا vocabularies متعارضة بين الشاشات |
| JNY-08 | P1 | Customer timeline موحدة للإدارة والموظف والعميل | كل حدث حرج ظاهر حسب الصلاحية |
| JNY-09 | P1 | Retry/idempotency لكل form/action حرج | double-click/network retry لا يكرر البيانات |
| JNY-10 | P1 | Failed-step recovery queue | استكمال أو Rollback واضح لكل عملية جزئية |
| JNY-11 | P1 | Journey analytics funnel | نسب التحويل مبنية على IDs حقيقية لا تخمين |
| JNY-12 | P2 | Abandoned checkout/follow-up automation | consent + dedupe + measurable conversion |

#### نتيجة إغلاق المسار B — 29 يوليو 2026

| ID | الحالة | الدليل التنفيذي |
|---|---|---|
| JNY-01 | ✅ مكتمل | `api/tools/uat-full-smoke.cjs`: تسجيل Public فعلي، Lead واحد deduped، attribution، توزيع least-load، tenant/branch وtimeline داخل قاعدة البيانات |
| JNY-02 | ✅ مكتمل | سعر الكورس من الخادم، Order idempotent، Proof واعتماد محاسب، Payment وقيد متوازن وEnrollment مترابطة بنفس العميل والكورس والفرع |
| JNY-03 | ✅ مكتمل | منع الشهادة قبل الدفع/الإكمال، Progress 100%، Completion وشهادة قابلة للتحقق، ثم revoke تلقائي عند Refund |
| JNY-04 | ✅ مكتمل | `api/lib/reconcileChecks.js` يصنّف أي مستخدم عميل نشط بلا Lead أو Subscriber كمخالفة حرجة؛ النتيجة الحية صفر |
| JNY-05 | ✅ مكتمل | Converted Lead بلا Subscriber مخالفة حرجة؛ النتيجة الحية صفر |
| JNY-06 | ✅ مكتمل | Paid learning order بلا Payment/Journal/Subscriber/Enrollment مخالفة حرجة؛ النتيجة الحية صفر |
| JNY-07 | ✅ مكتمل | `api/lib/journeyStates.js` هو عقد Order/Payment/Enrollment/Certificate وتستخدمه حدود الـAPI |
| JNY-08 | ✅ مكتمل | Timeline واحدة للعميل والإدارة والموظف؛ القيم المالية ظاهرة لصاحب الصلاحية فقط ومخفية عن Sales |
| JNY-09 | ✅ مكتمل للمسار الحرج | التسجيل والـcheckout والاعتماد والإكمال والاسترداد تتحمل retry/double action بلا تكرار آثار؛ لا يعني ذلك اعتماد كل Form غير مرتبط بالرحلة |
| JNY-10 | ✅ مكتمل للمسار الحرج | التسوية والاسترداد Transactional مع rollback، والرسائل/الوظائف عبر outbox/queue قابلة لإعادة المحاولة |
| JNY-11 | ✅ مكتمل | Funnel يستخدم cohort واحد مبنيًا على `lead_id → subscriber_id → payment/completion` واختُبر حيًا قبل الاسترداد |
| JNY-12 | ⚠️ عقد الكود مكتمل / المزود خارجي | Suppression + dedupe + provider acceptance قبل `sent` مكتملة؛ إثبات delivery/conversion الحي ينتظر WhatsApp credentials |

نتيجة UAT الأخيرة: **57/57 PASS**، وتشمل 19 حساب/دور، Tenant A/B، Paymob fail-closed بلا كتابة Order، والرحلة الفعلية Registration→Lead→Conversion→Order→Payment Intent→Proof→Approval→Invoice→Journal→Enrollment→Completion→Certificate→Refund→Credit Note. نتيجة `reconcile`: **صفر مخالفات حرجة**.

### المسار C — Payments

#### المطلوب قبل أي تكامل Paymob

| ID | P | البند | الحالة/الشرط |
|---|---:|---|---|
| PAY-01 | P0 | تثبيت Payment Intent داخلي مستقل عن Provider | ✅ مكتمل واختُبر حيًا |
| PAY-02 | P0 | Idempotency key موحد للطلب/التسوية/webhook | ✅ مكتمل للمسار اليدوي؛ webhook داخل Gate Paymob |
| PAY-03 | P0 | Webhook inbox خام + signature result + replay protection | Gate Paymob |
| PAY-04 | P0 | ربط الدفع بالـtenant/branch/client/order/item/course/staff | ✅ مكتمل ومثبت داخل UAT |
| PAY-05 | P0 | State machine موحدة: pending/paid/failed/refunded | ✅ مكتمل للمسار اليدوي |
| PAY-06 | P0 | Reconciliation بين orders/payments/journals/enrollments | ✅ مكتمل؛ صفر anomalies حرجة |
| PAY-07 | P1 | Payment attempt history بدون تسريب أسرار | ✅ مكتمل |
| PAY-08 | P1 | Manual proof SLA ومراجعة ثنائية للعمليات الحساسة | ⏳ SLA واعتماد proof الثنائي قيد الإغلاق |
| PAY-09 | P1 | Receipts/credit notes وتسلسل أرقام per tenant | ✅ مكتمل عبر migrations 173–175 |
| PAY-10 | P1 | Customer/Admin/Accountant payment parity | ✅ مكتمل ومثبت حيًا |
| PAY-11 | P1 | Failed/expired payment recovery UX | ✅ retry idempotent؛ Browser recovery يحتاج إعادة gate |
| PAY-12 | P2 | Payment links بمدة صلاحية وحد استخدام | ⏳ مطلوب إثبات سلوكي نهائي |

#### Paymob Gate — متوقف لحين مراجعة الشركة

لا يتم تفعيل Paymob إلا بعد:

- تأكيد contract والـcredentials والـintegration IDs من Paymob.
- Sandbox end-to-end ناجح.
- تحقق HMAC/signature من المصدر الرسمي.
- حفظ webhook قبل المعالجة وإمكانية replay آمنة.
- عدم اعتبار Redirect نجاحًا ماليًا.
- reconciliation job بين Paymob والنظام.
- timeout/retry/duplicate/out-of-order tests.
- pilot محدود ثم مراقبة قبل التعميم.

تجزئة الدفع وPartial Paymob Refund تظل مؤجلة. لا تُبنى فوق assumptions غير معتمدة.

### المسار D — Finance & Accounting

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| FIN-01 | P0 | إكمال فحص كل Money mutation ضد Ledger/Period Lock | ✅ العقود والمسارات الأساسية مغطاة |
| FIN-02 | P0 | Daily reconciliation آلي مع Dashboard أخطاء | ⚠️ الكشف آلي؛ ownership/workflow للـanomaly قيد الإغلاق |
| FIN-03 | P0 | Branch/Cost Center إلزامي حسب نوع الحركة | ⚠️ Branch مكتمل؛ Cost Center يحتاج عقدًا صريحًا |
| FIN-04 | P0 | Refund reversal كامل للدفتر والعمولة والالتحاق | ✅ مكتمل بلا حذف تاريخي |
| FIN-05 | P0 | صلاحيات segregation of duties | ✅ AP/Bank/Close بثلاثة أطراف واختبار حي |
| FIN-06 | P1 | Accounts Receivable aging من entitlements الفعلية | ⚠️ أرصدة الاستحقاق موجودة؛ aging buckets قيد الإغلاق |
| FIN-07 | P1 | Accounts Payable للموردين والمدربين | ✅ مكتمل واختُبر حيًا |
| FIN-08 | P1 | Bank/cash reconciliation workspace | ✅ مكتمل واختُبر حيًا |
| FIN-09 | P1 | Period close/reopen policy مع approval | ✅ إغلاق ثلاثي وفترة مغلقة محمية |
| FIN-10 | P1 | Invoice/Credit Note numbering per tenant/branch | ✅ مكتمل مع backfill ومصالحة |
| FIN-11 | P1 | VAT/tax configuration وتقرير قابل للتصدير | ⚠️ التقرير موجود؛ سياسة الضرائب والنسخ المؤرخة قيد الإغلاق |
| FIN-12 | P1 | Payroll/instructor fees/commissions reconciliation | ⚠️ القيود موجودة؛ تقرير liability→payment الموحد قيد الإغلاق |
| FIN-13 | P1 | Budget vs actual وforecast من ledger | ⚠️ Actual من ledger؛ forecast قيد الإغلاق |
| FIN-14 | P2 | Cash-flow forecast 13 أسبوع | ⏳ غير مكتمل |
| FIN-15 | P2 | Multi-currency revaluation policy | ⏳ غير مكتمل |
| FIN-16 | P2 | Financial audit export package | ✅ مكتمل مع SHA-256 واختبار حي |
| FIN-17 | P2 | Month-end close checklist | ✅ مكتمل وقابل للتوقيع |

### المسار E — CRM والمبيعات وخدمة العملاء

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| CRM-01 | P0 | إنهاء Lead repository/service المركزي | لا SQL للـLead خارج domain إلا reports |
| CRM-02 | P0 | Assignment policy per tenant/branch/team | workload + availability + audit |
| CRM-03 | P0 | Activity parity Admin/Employee | نفس الحدث ونفس الحالة |
| CRM-04 | P1 | Duplicate review queue بدل auto destructive merge | preview + reversible merge |
| CRM-05 | P1 | SLA escalation وowner dashboard | overdue measurable |
| CRM-06 | P1 | Pipeline definitions قابلة للضبط per tenant | transitions validated |
| CRM-07 | P1 | Sales targets/commission trace | target→activity→payment |
| CRM-08 | P1 | Omnichannel timeline | email/WhatsApp/call/task موحدة |
| CRM-09 | P1 | Lead quality/source ROI | attribution→revenue |
| CRM-10 | P2 | Forecast probability model قابل للتفسير | no opaque auto-write |
| CRM-11 | P2 | Next-best-action suggestions | approval before mutation |
| CRM-12 | P1 | Opportunity fields: expected close/category/probability | كل forecast row له قيمة وتاريخ وسبب |
| CRM-13 | P1 | Forecast hierarchy وrep/manager submissions | rollup حسب الصلاحية مع snapshot تاريخي |
| CRM-14 | P1 | Pipeline coverage وweek-over-week movement | target/commit/best-case/pipeline قابلة للـdrill-down |
| CRM-15 | P1 | توحيد شاشتي Forecast على API واحد | لا حساب مالي أو pipeline داخل المتصفح |
| CRM-16 | P1 | Sales sequences بإصدارات ثابتة | pause/resume/unenroll/reply-stop وoutbox |
| CRM-17 | P1 | Prioritized seller work queue | SLA+score+value+next step قابلة للتفسير |
| CRM-18 | P1 | Quote/offer snapshot قبل Order | line items/discount/expiry/approval/audit |
| CRM-19 | P1 | Discount approval matrix | Sales لا يعتمد خصمه خارج الحدود |
| CRM-20 | P2 | Forecast accuracy tracking | submitted forecast مقابل actual لكل rep/period |
| CRM-21 | P2 | Pipeline inspection history | تغير value/date/category/owner ظاهر للإدارة |
| CRM-22 | P2 | Connector contracts | inbound/outbound idempotency + health + replay |
| CRM-23 | P2 | Conversation coaching evidence | scorecard مرتبط بمكالمة/رسالة فعلية وصلاحية |
| CRM-24 | P2 | Mobile seller workspace | work queue والتحديثات الحرجة responsive/accessible |
| CRM-25 | P2 | CRM contract/performance E2E | 10k leads، p95 والـpermissions والـtenant isolation |

تقدم المرحلة الثانية (2026-07-25):

- ✅ مصدر تفاعل Tenant-safe موحد، Timeline صارم، وواتساب جماعي Transactional عبر Outbox.
- ✅ توحيد صلاحيات الإدارة/الموظف/الفرع، وتوحيد التشغيل اليدوي والمجدول للـAutomation.
- ✅ Merge جديد قابل للعكس مع Snapshot للعلاقات وLive DB smoke ناجح.
- ✅ حفظ Lead أصبح Server-authoritative ويحدث email/phone/source فعليًا؛ إزالة 300+ سطر صافي من مسار CRM.
- ✅ أُغلق نطاق CRM الحالي: Lead repository مركزي، Assignment حسب branch/team/capacity، Pipeline قابل للضبط، مراجعة دمج صريحة مع Unmerge، وإنهاء `crm_json.communications`.

### المسار F — LMS وبوابة العميل والشهادات

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| LMS-01 | P0 | Enrollment/Entitlement service كمصدر وحيد | لا Access من payment UI state |
| LMS-02 | P0 | Progress/completion idempotency | repeat request لا يكرر شهادة |
| LMS-03 | P0 | Course/bundle/cohort prerequisite policy | server enforced |
| LMS-04 | P1 | Signed/expiring media delivery | URL غير قابلة للمشاركة الدائم |
| LMS-05 | P1 | Quiz attempts وتقييم Server-side | الإجابات الصحيحة لا تصل للعميل |
| LMS-06 | P1 | Attendance/live session integration | client/course/branch trace |
| LMS-07 | P1 | Certificate issue/revoke/reissue lifecycle | audit + public verification |
| LMS-08 | P1 | Portal timeline للدفع والكورس والشهادة والدعم | بيانات موحدة |
| LMS-09 | P1 | Device refresh/offline retry policy | لا تضارب progress |
| LMS-10 | P2 | Learning paths/cohorts/drip rules | entitlement tested |
| LMS-11 | P2 | Instructor analytics | privacy + tenant scope |

تقدم LMS وبوابة العميل (2026-07-25):

- ✅ LMS-01/02/03: `enrollments` هو مصدر الاستحقاق الوحيد، مع سجل `entitlement_events`، تقدم مركزي، متطلبات Course/Bundle/Cohort مفروضة على الخادم وواجهة إدارة للكورسات.
- ✅ تم ترحيل وحذف `enrolledCourseIds` و`courseAccess` و`lectureProgress` والشهادات القديمة من `crm_json` بعد Backfill آمن.
- ✅ Refund والمنح اليدوي وإثبات الدفع وتحويل Lead والحسابات الجديدة تمر من Entitlement service؛ Paymob فقط باقٍ كاستثناء مؤجل بقرار المنتج.
- ✅ LMS-07: إصدار/إلغاء/إعادة إصدار الشهادة بسجل Lifecycle، سبب إلزامي، صلاحيات، تحقق عام، طباعة متعددة المؤسسات، وواجهة إدارة مرتبطة بالسجل الحقيقي.
- ✅ LMS-04/05/06: تذاكر وسائط موقعة قصيرة العمر مع إعادة فحص الاستحقاق، تقييم Quiz على الخادم، وربط الجلسات الحية بالعميل والكورس والفرع.
- ✅ LMS-08/09: Timeline موحدة للدفع/الطلب/الاستحقاق/الشهادة/الدعم، وطابور Offline monotonic مربوط بهوية العميل ويعيد المزامنة عند عودة الشبكة.
- ✅ LMS-10/11: الباقات هي Learning Paths مرتبة Tenant-owned، Cohorts بسعة ومتطلبات ومنح/سحب استحقاق Transactional، وربط المحاضر بحساب الموظف وتحليلات مقيدة بالكورسات المسندة.
- ✅ أُغلق نطاق LMS الحالي بالكامل؛ migration حتى 126، Builds الإدارة والعميل ناجحة؛ API Unit 341/0/1، Integration 5/5، Live DB smoke وReconciliation بلا مخالفات حرجة.
- 🔄 التالي: إغلاق HR ونظام الموظفين بندًا بندًا.

### المسار G — HR ونظام الموظفين

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| HR-01 | P0 | Role/branch approval matrix على DB | كل Action حساس مختبر |
| HR-02 | P0 | Payroll close/pay state machine | calculate→approve→pay |
| HR-03 | P1 | Payslip/advance/deduction/commission reconciliation | totals تطابق ledger |
| HR-04 | P1 | Employee self-service least privilege | PII حسب الحاجة |
| HR-05 | P1 | Attendance/leave/overtime policy engine | policy version محفوظة |
| HR-06 | P1 | Offboarding revoke sessions/access/tasks | صفر حساب نشط بعد الفصل |
| HR-07 | P1 | HR retention/audit policy | بيانات حساسة مش في logs |
| HR-08 | P2 | Performance goals linked to evidence | no manual-only scores |

### المسار H — SaaS والأمان والصلاحيات

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| SEC-01 | P0 | إغلاق الـ34 tenant scanner candidates بالدليل | صفر unknown candidates |
| SEC-02 | P0 | Platform-admin role صريح ومراقب | كل bypass audited |
| SEC-03 | P0 | Route+button+field permission matrix | backend هو الحكم النهائي |
| SEC-04 | P0 | Upload hardening لكل نوع ملف | signature/size/path/storage |
| SEC-05 | P0 | PII/secrets log scrub | automated tests |
| SEC-06 | P1 | Session/token rotation/revocation policy | stolen token containment |
| SEC-07 | P1 | MFA enforcement للمال والإدارة العليا | configurable per tenant |
| SEC-08 | P1 | Feature entitlements/quotas per SaaS plan | server enforced |
| SEC-09 | P1 | Tenant custom domain/branding/email identity | verified ownership |
| SEC-10 | P1 | Audit log tamper resistance/retention | append-only export |
| SEC-11 | P1 | Dependency/SCA/security headers automation | CI gate |
| SEC-12 | P2 | Data residency/export/delete workflows | verified completion |
| SEC-13 | P2 | Rate limits per tenant/user/IP/action | no noisy-neighbor |

تقدم إغلاق مسار SaaS/Security (2026-07-26):

- ✅ SEC-06/07: تدوير وإلغاء الجلسات فعليًا، MFA مملوك للمستخدم ومفروض حسب الدور/الصلاحية بسياسة Tenant قابلة للضبط.
- ✅ SEC-08/09: Quotas وFeature Entitlements على الخادم، وربط Domain/Brand/Email لا يعمل قبل إثبات ملكية النطاق.
- ✅ SEC-10: سجل Audit متسلسل بـHMAC، كتابة متزامنة داخل Transaction، أرشفة قبل الحذف، وتصدير بخلاصة تحقق.
- ✅ SEC-11: Dependency gate في CI؛ كل Advisory جديد يفشل البناء، والاستثناء المؤقت الوحيد مقيد بإصدار وتاريخ انتهاء وسبب قابل للاختبار.
- ✅ SEC-12: تصدير شامل للعميل، Workflow محو بمراجعة وحجز قانوني/تشغيلي، إلغاء جلسات، إخفاء PII عبر 21 فئة، ودليل تنفيذ موقّع بعد التحقق.
- ✅ SEC-13: Rate limits معزولة حسب Tenant/User/IP/Action، طبقتا IP+Account للمصادقة، وRedis distributed store شرط Production Readiness.
- 🔄 بدأ ARC-10 بإزالة الـlimiters والمسارات الجزئية الميتة بعد استبدالها بمصادر موحدة ومختبرة.
- ✅ تحقق المرحلة: API Unit ‏398/399 ناجح مع Paymob TODO واحد مؤجل، Integration ‏5/5، UAT ‏22/22، Quality ‏56/56، والـAdmin/Client builds وDB reconciliation ناجحة.

### المسار I — Architecture وتقليل الكود

#### الشكل المستهدف

```text
Route / Controller
        ↓
Application Service / Use Case
        ↓
Domain Policy + Transaction Boundary
        ↓
Repository / External Adapter
        ↓
MySQL / Provider
```

React:

```text
Page Shell
  ├─ Feature Components
  ├─ Query/Mutation Hooks
  ├─ Typed API Client
  └─ Local UI State فقط
```

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| ARC-01 | P1 | تقسيم `api/server.js` إلى bootstrap/routes/jobs/observability/shutdown | server أقل من 350 سطر |
| ARC-02 | P1 | تقسيم Admin SiteDataContext حسب domains | لا Context شامل لكل النظام |
| ARC-03 | P1 | تقسيم Client SiteDataContext | server state في query hooks |
| ARC-04 | P1 | استخراج Unified Client orchestration | page أقل من 700 سطر |
| ARC-05 | P1 | استخراج Leads/Daqqi/UserDashboard features | الأهداف الرقمية بالأعلى |
| ARC-06 | P1 | DTO/schema مشتركة للـAPI | request/response contract tests |
| ARC-07 | P1 | Error model موحد | code/message/details/requestId |
| ARC-08 | P1 | Transaction helper موحد | لا begin/commit patterns متناقضة |
| ARC-09 | P1 | Domain events/outbox للآثار غير المتزامنة | لا fire-and-forget حرج |
| ARC-10 | P1 | إزالة dead code بعد إثبات zero callers | build+rg+runtime evidence |
| ARC-11 | P2 | Dependency boundaries lint | Finance لا يعتمد على UI/CRM JSON |
| ARC-12 | P2 | Shared table/filter/form primitives | تقليل النسخ بدون god component |
| ARC-13 | P2 | إزالة `as any` تدريجيًا | budget يتناقص في CI |
| ARC-14 | P2 | ADRs للقرارات المعمارية الحرجة | قرار/بدائل/أثر موثق |

تقدم مرحلة المعمارية:

- ✅ ARC-01: اكتمل Route Registry وفصل HTTP app وprocess lifecycle وscheduled handlers وbackground scheduler وproduction runtime guard؛ أصبح `api/server.js` ‏70 سطرًا مع اختبارات عقود وتشغيل كاملة.
- ✅ اختبار عقد الـRoute Registry، API lint، ‏Admin/Client TypeScript، ‏399/400 Unit مع Paymob TODO واحد، Integration ‏5/5، Quality ‏56/56، وProduction builds للتطبيقين.

#### قواعد Refactor

- Batch واحدة لكل Domain.
- Characterization tests قبل النقل.
- لا تغيير Schema وسلوك وUI في نفس الـPR إلا للضرورة.
- قياس الأسطر والتعقيد وحجم الـbundle قبل وبعد.
- حذف الملف القديم فقط بعد صفر imports ونجاح build/E2E.

### المسار J — Database Engineering

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| DB-01 | P0 | توحيد canonical schema مع آخر migrations | fresh=upgrade |
| DB-02 | P0 | Foreign keys/tenant composite keys audit | لا cross-tenant relation |
| DB-03 | P0 | Orphan/duplicate report قبل أي constraints | zero unresolved |
| DB-04 | P1 | Index + EXPLAIN لأعلى 30 query | لا full scan غير مبرر |
| DB-05 | P1 | Pagination لكل list كبيرة | no unbounded list |
| DB-06 | P1 | Money/date/timezone conventions | DECIMAL + UTC + display TZ |
| DB-07 | P1 | Archive/retention strategy | الجداول التشغيلية لا تتضخم بلا حد |
| DB-08 | P1 | Online migration rules | lock time budget |
| DB-09 | P1 | Slow query log وتحليل دوري | top regressions visible |
| DB-10 | P2 | Read model/materialized summaries للتقارير الثقيلة | freshness SLA موثق |
| DB-11 | P2 | PITR/binlog restore drill | استرجاع لنقطة زمنية ناجح |

### المسار K — الأداء والواجهة وتجربة الاستخدام

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| PERF-01 | P1 | Baseline Lighthouse/API/DB قبل التحسين | نتائج محفوظة قابلة للمقارنة |
| PERF-02 | P1 | Route-level code splitting لكل صفحة كبيرة | initial JS budget محقق |
| PERF-03 | P1 | منع duplicate frontend fetches | dedupe/cache/invalidation واضحة |
| PERF-04 | P1 | Virtualization/pagination للجداول الكبيرة | 10k rows لا تجمد UI |
| PERF-05 | P1 | Query batching ومنع N+1 | query count budget |
| PERF-06 | P1 | Skeleton/error/empty/retry states موحدة | كل صفحة حرجة مكتملة الحالات |
| PERF-07 | P1 | Forms تحفظ draft فقط عند الحاجة | لا local truth يناقض DB |
| PERF-08 | P1 | Accessibility keyboard/labels/contrast/RTL | WCAG AA للأجزاء الحرجة |
| PERF-09 | P2 | Image/font/cache optimization | LCP budget |
| PERF-10 | P2 | Optimistic UI فقط للعمليات القابلة للعكس | rollback UX مختبر |
| UX-01 | P1 | توحيد المصطلحات والحالات بالعربي | نفس status بنفس الاسم واللون |
| UX-02 | P1 | منع الأزرار غير المسموحة من الظهور | UI + API authorization |
| UX-03 | P1 | Confirmations للأعمال المدمرة/المالية | impact واضح قبل التنفيذ |
| UX-04 | P1 | Deep links من Dashboard إلى السجل الأصلي | لا أرقام بلا drill-down |

### المسار L — Notifications وIntegrations

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| MSG-01 | P0 | إزالة silent catches من الرسائل الحرجة | failure visible/retryable |
| MSG-02 | P1 | Provider health dashboard | latency/failure/queue depth |
| MSG-03 | P1 | Template versioning/preview/test send | tenant-safe |
| MSG-04 | P1 | Consent حسب القناة والغرض | marketing ≠ transactional |
| MSG-05 | P1 | Delivery status يظهر للموظف والإدارة | sent/failed/dead |
| MSG-06 | P1 | Webhook adapters موحدة وآمنة من SSRF | allowlist/signature/retry |
| MSG-07 | P2 | WhatsApp conversation continuity | opt-in + audit |

### المسار M — QA والمراقبة والتشغيل

| ID | P | البند | معيار القبول |
|---|---:|---|---|
| QA-01 | P0 | DB integration suite لكل transaction حرج | rollback/duplicate/concurrency |
| QA-02 | P0 | Playwright journeys: Public/Admin/Employee/Client/Accountant | release blocking |
| QA-03 | P0 | Failure injection: DB/provider/queue timeout | no partial truth |
| QA-04 | P1 | API contract tests لكل endpoint حرج | schema drift blocked |
| QA-05 | P1 | Load test للـCRM/dashboard/checkout | budgets محققة |
| QA-06 | P1 | Soak test للjobs/outboxes | no memory/queue leak |
| QA-07 | P1 | Structured logs tenant-safe + correlation ID | trace كامل بلا PII |
| QA-08 | P1 | Metrics: latency/errors/DB pool/queue/reconciliation | dashboards + alerts |
| QA-09 | P1 | SLO/alert/runbook لكل خدمة حرجة | alert actionable |
| QA-10 | P1 | Production process manager + graceful shutdown | zero dropped jobs |
| QA-11 | P1 | SSL/domain/CORS/proxy validation | production headers صحيحة |
| QA-12 | P1 | UAT scripts وتوقيع Finance/Sales/LMS/HR | قبول وظيفي موثق |

## 6) مميزات جديدة بعد تثبيت الأساس

هذه المميزات لا تبدأ قبل إغلاق P0 الخاص بالـDomain التابع لها.

| ID | P | الميزة | القيمة |
|---|---:|---|---|
| NEW-01 | P2 | Unified Customer 360 Timeline | رؤية العميل كاملة من مصدر واحد |
| NEW-02 | P2 | Finance Close Workspace | إغلاق شهري ومهام وموافقات ومصالحة |
| NEW-03 | P2 | Branch Profitability Dashboard | ربحية حقيقية من Ledger |
| NEW-04 | P2 | Smart CRM Work Queue | ترتيب العمل حسب SLA والقيمة |
| NEW-05 | P2 | Learning Paths/Cohorts | تطوير LMS والاحتفاظ |
| NEW-06 | P2 | Customer self-service invoices/support/profile | تقليل عبء الموظفين |
| NEW-07 | P2 | SaaS plan quotas/usage billing readiness | جاهزية تجارية للتوسع |
| NEW-08 | P2 | Audit Explorer | تتبع أي تغيير ومن قام به |
| NEW-09 | P3 | Explainable revenue/lead forecast | قرار أفضل بدون auto-mutation |
| NEW-10 | P3 | Anomaly detection للمال والتكامل | اكتشاف paid-without-access وغيره |

## 7) الخطة الزمنية

### الأيام 1–7: فتح بوابة قاعدة البيانات

- ENV-01 إلى ENV-07.
- تطبيق migrations حتى 112.
- تشغيل reconciliation وTenant matrix.
- تثبيت baseline أداء حقيقي.
- لا Feature development خلال فشل P0.

### الأيام 8–21: رحلة العميل والمال

- JNY-01 إلى JNY-07.
- PAY-01 إلى PAY-10 بدون تفعيل Paymob.
- FIN-01 إلى FIN-05.
- SEC-01 إلى SEC-05.
- QA-01 إلى QA-03.

### الأيام 22–30: التشغيل التجريبي

- Role/button/action matrix.
- UAT لكل قسم.
- backup/restore وrollback rehearsal.
- Load smoke وobservability.
- Pilot داخلي ببيانات اختبار ممثلة للواقع.

### الأيام 31–45: تقليل التعقيد

- ARC-01 إلى ARC-05.
- CRM repository والخدمات المركزية.
- Enrollment/Entitlement service.
- Error/DTO/transaction contracts.

### الأيام 46–60: السرعة والخفة

- DB index/EXPLAIN.
- Frontend code splitting/query dedupe/virtualization.
- Bundle/API/query budgets داخل CI.
- إغلاق الملفات الضخمة للأهداف المرحلية.

### الأيام 61–75: Finance وOperations المتقدمة

- AR/AP وBank reconciliation وPeriod close.
- payroll/commission/instructor reconciliation.
- provider/message health.
- customer/accountant/admin parity.

### الأيام 76–90: المميزات والإطلاق الاحترافي

- Customer 360.
- Finance Close Workspace.
- SaaS entitlements/quotas.
- Learning paths حسب جاهزية LMS.
- Security/load/soak/UAT نهائي.
- Paymob فقط إذا اجتاز Gate الرسمي.

### الأيام 91–180: التوسع

- PITR وHigh availability حسب الحمل.
- Read models للتقارير الثقيلة.
- Advanced automation/forecasting/anomaly detection.
- Mobile/PWA roadmap بعد ثبات عقود الـAPI.

## 8) ميزانيات الأداء والجودة

| المؤشر | الهدف |
|---|---:|
| API read p95 داخل الشبكة | أقل من 350ms |
| Critical mutation p95 بدون provider | أقل من 800ms |
| DB query p95 للـqueries الأساسية | أقل من 150ms |
| Dashboard initial API calls | بحد أقصى 8 |
| صفحة list | Pagination إلزامية بعد 200 سجل |
| Public LCP على اتصال متوسط | أقل من 2.5s |
| CLS | أقل من 0.1 |
| Initial compressed JS لكل تطبيق | Budget يحدد بعد baseline ويقل 25% |
| Cross-tenant failures | صفر |
| Paid without balanced journal | صفر |
| Paid without entitled access | صفر |
| Lost lead/duplicate payment | صفر |
| Critical notification silent failure | صفر |
| Critical/High security findings | صفر قبل الإطلاق |

## 9) بوابات الإصدار الإلزامية

لا يتم إطلاق Release Candidate إلا إذا نجحت كلها:

- `npm run qa:launch`.
- DB readiness وmigrations upgrade/fresh-install.
- Unit + integration + Playwright E2E.
- Tenant-A/Tenant-B matrix.
- Customer journey الثلاثة الأساسية.
- Finance reconciliation بصفر anomalies حرجة.
- Permission matrix لكل Role/Action.
- Backup/restore وrollback rehearsal.
- Load test داخل الميزانيات.
- Logs/metrics/alerts بدون PII.
- توقيع UAT من Finance وSales وLMS وHR وSupport.
- Paymob يظل Suspended إذا لم يجتز Gate؛ لا يمنع إطلاق manual-payment-only إذا تم توضيح ذلك تشغيليًا.

## 10) Definition of Done لأي بند

البند لا يتحول إلى Done إلا إذا:

1. السلوك المطلوب واضح وله Acceptance criteria.
2. الصلاحيات والـtenant/branch scope موثقة.
3. Schema migration موجودة لو لزم الأمر.
4. Error/empty/loading/retry UX مكتملة.
5. Unit/contract/integration/E2E بالمستوى المناسب.
6. لا silent catch أو partial persistence.
7. الأداء تم قياسه قبل وبعد.
8. Audit/observability موجودان للعمليات الحرجة.
9. التوثيق وrunbook تم تحديثهما.
10. نفس Release Candidate اجتاز بوابات الإصدار.

## 11) ترتيب البدء الفعلي

1. **توفير MySQL Staging وتطبيق migrations حتى 112.**
2. **تشغيل DB reconciliation وTenant-A/Tenant-B.**
3. **تنفيذ E2E الكامل لرحلة العميل اليدوية بدون Paymob.**
4. **إغلاق أي mismatch في Payment/Journal/Enrollment/CRM.**
5. **إكمال Permission matrix وbackup/restore.**
6. **بدء تفكيك `api/server.js` وSiteDataContext بعد تثبيت اختبارات السلوك.**
7. **تنفيذ Finance/Payments roadmap الداخلية.**
8. **تحسين الأداء بالأرقام.**
9. **بناء المميزات الجديدة بعد نجاح الأساس.**
10. **فتح Paymob Gate فقط بعد الرد والمراجعة الرسمية.**

## 12) آخر نقطة تحقق فعلية — 2026-07-26

- ✅ Migrations مطبقة حتى 139؛ أضيف tenant ownership كامل لـ`activity_logs` والأرشيف.
- ✅ Employee/API UAT: ‏48/48؛ تسجيل 17 حسابًا يغطي 14 دورًا أساسيًا ورحلة Website→CRM→Payment→Journal→Refund→Dokki→Support→HR.
- ✅ Playwright: ‏36/36؛ ومصفوفة Render موسعة ‏16/16 لحسابات الموظفين تشمل Consultant/Trainer/Instructor.
- ✅ API Unit: ‏406 نجاح، صفر فشل، وPaymob TODO واحد مؤجل.
- ✅ Integration ‏5/5، Quality ‏56/56، Tenant Scanner صفر عبر 148 جدولًا، Reconciliation صفر مخالفات حرجة.
- ✅ Admin/Client TypeScript وProduction builds ناجحان، وDependency gate ناجح.
- ✅ Load smoke بلا أخطاء: CRM p95=53ms، manual payment p95=25ms؛ login concurrency p95=3.75s مسجل كبند تحسين.
- ✅ ARC-01: فصل Route Registry وHTTP app وProcess lifecycle؛ `server.js` انخفض من 1253 إلى نحو 730 سطرًا.
- ✅ ARC-10: حذف `serverCronJobs.js` الميت (468 سطرًا) بعد نقل HR retention إلى Job مستقل موصل فعليًا بالـruntime.
- ✅ إصلاح login rate limit لبيئات الفروع خلف NAT: النجاح لا يستهلك حد brute-force، والفشل يظل محميًا على مستوى IP والحساب.
- ✅ إصلاح Public catalog rate limit لبيئات الفروع خلف NAT: reads=600/action/min وwrites=60/action/min، مع اختبار سلوكي للحدين.
- ⛔ Production Readiness ما زالت غير مكتملة: AUDIT_HMAC_SECRET، DATA_RESIDENCY_REGION، WhatsApp، Sentry، Redis queues، Redis rate-limit. Paymob مؤجل بقرار المنتج.
- 📄 التقرير النهائي: `SYSTEM_FINAL_READINESS_REPORT_20260726.md`.
- 📄 تقرير الأدوار: `EMPLOYEE_ROLE_READINESS_REPORT_20260726.md`.

## 13) آخر نقطة تحقق فعلية — 2026-07-28

- ✅ Community أصبحت server-authoritative للـlikes/comments مع tenant scope وخصوصية وحذف ذري، وأضيفت migration 148.
- ✅ Discounts وbroadcasts وquizzes وlive streams في الـClient أصبحت تُحمّل من APIs فعلية؛ لا نجاح محلي كاذب عند فشل الحفظ.
- ✅ الـClient لم يعد يستورد أو يستخدم Admin APIs، و`SiteDataContext` انخفض إلى 556 سطرًا؛ Admin context إلى 780 و`server.js` إلى 70.
- ⚠️ `UnifiedClientPage.tsx` انخفض من 1788 إلى 1435 سطرًا، والـchunk من 211.56KB إلى 73.88KB raw؛ ARC-04 تحسن لكنه لم يكتمل حتى هدف أقل من 700 سطر.
- ✅ آخر بوابة كاملة: 462 اختبارًا، 461 PASS، صفر FAIL، وPaymob TODO واحد متعمد؛ Quality 56/56 وTypeScript وproduction builds ناجحة.
- ✅ migration CLI أصبح fail-closed عند غياب MySQL ولا يعيد exit 0 كنجاح زائف.
- ⛔ MySQL غير متاح حاليًا على `127.0.0.1:3306`؛ لذلك migration 148 وchecksums وDB/UAT/load للـRelease Candidate الحالي غير مثبتة.
- ⛔ آخر Production Readiness: 5 PASS، 17 FAIL، 1 SKIP لـPaymob. لا Go-Live قبل إغلاق إعدادات البنية والـcredentials والأدلة المذكورة في تقرير المعالجة.
## سجل التنفيذ الموثق — إغلاق بوابة CRM في 2026-07-30

هذا السجل هو الأحدث ويعلو أي أرقام أقدم في مقدمة الملف:

- ✅ `CRM-12` و`CRM-14` إلى `CRM-25`: أُغلقت بعقود API وقاعدة بيانات وواجهات واختبارات، وتشمل opportunity fields، forecast/accuracy/movements، sequences، work queue، quotes/discount approvals، connector inbox، coaching evidence، وتصميمًا responsive لمساحة عمل المبيعات.
- ⚠️ `CRM-13`: submissions والـrollups التاريخية وصلاحيات نطاق البيانات مكتملة؛ شجرة إدارة تنظيمية متعددة المستويات قابلة للتهيئة ما زالت تطويرًا تنافسيًا وليست مانع تشغيل لمعهد واحد.
- ✅ migrations `160–166` مطبقة على MySQL 8.4 المعزول، و`144–166` اجتازت مطابقة checksum بالكامل.
- ✅ Fresh schema أنشأ `176` جدولًا، وتأكد FK بين `crm_quote_orders` و`orders`؛ وأُصلح ترتيب المرجع داخل `api/schema.sql`.
- ✅ API Unit: `593` اختبارًا؛ `592` نجاح، صفر فشل، وPaymob TODO واحد مؤجل بقرار المنتج.
- ✅ Quality: `56/56`، بما فيها `302` endpoint إداري mutating بصلاحية صريحة، صفر duplicate routes وصفر tenant-scope regression.
- ✅ CRM live smokes: forecasting، sequences، quotes، durable connector inbox، coaching evidence؛ وعزل Tenant A/B داخل الاختبارات الحية.
- ✅ CRM performance: `10,000` Lead، warm query/ranking p95 = `177.97ms` مقابل هدف `400ms`.
- ✅ Admin TypeScript ناجح بعد واجهات Forecast/Sequences/Quotes/Work Queue/Coaching.
- ⛔ لا يرفع هذا وحده المشروع إلى Production 100%: التكامل الحي مع مزودي البريد/WhatsApp، Managed Redis/MySQL، Sentry، Secret Manager، وبيانات residency/proxy ما زالت بوابات خارجية موثقة.
