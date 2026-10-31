# خطة التطوير والإطلاق الرئيسية — Mahad Nafsy v25

تاريخ الاعتماد: 2026-07-18  
النسخة الأساسية الوحيدة: `D:\mahadnafsy25`  
نسختا 26 و30: مصادر انتقائية للأفكار والمميزات فقط، وليستا قواعد دمج.

## 1. هدف البرنامج

تحويل نسخة 25 إلى منصة تشغيل موثوقة قابلة للإطلاق والإدارة والتوسع كـSaaS، مع ضمان أن كل عملية تجارية حرجة لها مصدر بيانات واحد، وصلاحية واضحة، ومعاملة ذرية، وسجل تدقيق، واختبار آلي.

الرحلة المرجعية التي لا يجوز كسرها:

`Visitor → Lead → Assignment → Follow-up → Order → Payment → Journal → Enrollment → Client Portal → Completion → Certificate`

## 2. مبادئ غير قابلة للتفاوض

1. لا نجاح بصري قبل نجاح الحفظ الفعلي.
2. لا Query على بيانات أعمال بدون `tenant_id` صريح أو Parent join موثوق.
3. كل Payment مدفوع له قيد مالي، وكل Refund له قيد عكسي.
4. الدفع المرتبط بكورس لا يعتمد بدون Enrollment ناجح في نفس الـTransaction.
5. الشهادة لا تصدر بدون Payment وEnrollment وCompletion مستحقين.
6. لا Runtime DDL؛ أي تغيير Schema من خلال Migration مرقمة وقابلة لإعادة التشغيل.
7. لا نسخ Module كامل من 26 أو 30؛ النقل Feature-by-feature مع اختبارات.
8. لا إطلاق إذا فشل أي Gate من بوابات الإصدار الحرجة.
9. لا أسرار أو بيانات عملاء في Git أو Logs أو تقارير الاختبار.
10. كل Batch تطوير صغيرة، قابلة للرجوع، ومقاسة قبل وبعد.

## 3. مسارات العمل

### A. الأمن وعزل المؤسسات

- توحيد Tenant resolution من Host أو Signed tenant token أو JWT الموثوق.
- منع الثقة المباشرة في `x-tenant-id` للمستخدم العادي.
- إضافة Tenant لكل Staff/User cache key ولكل Lookup.
- Tenantize CRM، Finance، Accounting ERP، Community، Support، LMS والـNotifications.
- اختبارات Tenant A لا يستطيع قراءة أو تعديل أي Record في Tenant B.
- تدوير Secrets، تقوية JWT، وتوحيد Cookie/session policy.
- مراجعة Upload validation وMIME sniffing وحدود الأحجام.
- Audit log لكل Login، Mutation مالي، تغيير صلاحية، وExport بيانات.

معيار القبول: صفر استعلام أعمال حساس غير Scoped، واختبار Cross-tenant آلي لكل Module.

### B. رحلة العميل والتكامل

- التسجيل والـLead والـAssignment داخل Transaction أو Durable Outbox.
- منع تكرار Lead/Subscriber على مستوى Tenant مع قواعد واضحة.
- توحيد حالات Lead وSubscriber وOrder وPayment وEnrollment.
- منع أي Success UI قبل استلام ID مؤكد من API.
- Reconciliation jobs لاكتشاف:
  - Payment بلا Journal.
  - Payment بلا Enrollment.
  - Enrollment بلا Payment مؤهل.
  - Order مدفوع وغير مرتبط بعميل.
  - Lead محول بلا Subscriber.
- Timeline موحد لحركة العميل يظهر للإدارة والموظف حسب الصلاحيات.

معيار القبول: E2E كامل من Landing إلى Certificate مع Assertions داخل DB بعد كل مرحلة.

### C. المدفوعات والحسابات

- الحفاظ على Paymob موقوفًا حتى قرار تفعيل منفصل وCredentials صالحة.
- اعتماد الدفع اليدوي فقط من Order مسعّر Server-side.
- Idempotency keys لاعتماد الدفع والاسترداد والـWebhooks.
- Double-entry journal إلزامي لكل Payment/Refund/Expense/Payroll.
- Period locks تمنع التعديل على فترة مالية مغلقة.
- Reconciliation dashboard للمحاسب والإدارة.
- Currency conversion موحد مع تخزين سعر التحويل المستخدم.
- ربط كل حركة بـTenant وBranch وSubscriber وCourse/Bundle وStaff.

معيار القبول: مجموع القيود متوازن، ولا Commit جزئي في أي Workflow مالي.

### D. CRM والمبيعات وخدمة العملاء

- Least-loaded/Rules-based assignment مع قابلية إعادة التوزيع وتدقيق السبب.
- SLA للمتابعة وتنبيهات للـStale leads.
- منع الحذف الفعلي؛ Soft delete وأرشفة مع Audit.
- توحيد Inbox للتذاكر والـContacts والاستردادات وطلبات الانضمام.
- ربط المكالمات والرسائل والمتابعات بالـLead والموظف.
- Conversion funnel حسب المصدر والفرع والموظف والكورس.
- Deduplication بقواعد Phone/Email/Tenant مع Merge workflow.

معيار القبول: أي Lead عام يظهر في CRM والموظف المعيّن والإدارة خلال نفس العملية أو Outbox قابلة لإعادة المحاولة.

### E. LMS وبوابة العميل

- مصدر واحد للـEnrollment والوصول للمحتوى.
- Progress tracking Idempotent ومربوط بالـTenant.
- Course completion rules صريحة وقابلة للاختبار.
- Certificate eligibility موحدة في Service واحدة.
- فصل Tabs بوابة العميل وتقليل حجم `UserDashboard`.
- تحسين Video access والتحقق من الاستحقاق قبل كشف الرابط.
- دعم Bundles، Drip content، Quizzes وLive sessions بعقود API ثابتة.

معيار القبول: العميل يرى نفس الحقيقة الموجودة في Payments/Enrollments بعد Refresh ومن جهاز جديد.

### F. HR والرواتب

- استكمال Tenant/Branch scope لكل الجداول.
- Payroll calculation وإغلاق الشهر داخل Transaction.
- Attendance، Leaves، Commissions، Advances وInstructor fees في مصدر واحد.
- منع تعديل أو حذف Records مالية مدفوعة.
- Approval matrix وسجل تدقيق لكل اعتماد.
- Payslip وتقرير إجمالي مطابقان لنفس Payroll run.

معيار القبول: إعادة حساب نفس الشهر لا تنتج Double payroll، وTenant A لا يرى موظفي Tenant B.

### G. تفكيك الواجهة والمعمارية

- خفض `Dashboard.tsx` تدريجيًا إلى أقل من 1500 سطر.
- خفض كل Dashboard tab إلى أقل من 800–1000 سطر.
- فصل orchestration عن presentation وعن API mutations.
- تقسيم `SiteDataContext` إلى Domain contexts أو Query hooks بدون Actions وهمية.
- Shared DTOs/mappers تمنع اختلاف Admin/Client/API.
- منع `as any` في حدود البيانات الجديدة.
- Lazy loading على مستوى الأقسام الثقيلة.

معيار القبول: TypeScript strict للملفات الجديدة، ولا Mutation محلية بدون API contract.

### H. قاعدة البيانات والـMigrations

- Migration runner هو المسار الوحيد لتغيير Schema.
- Fresh-install test من Schema فارغ حتى آخر Migration.
- Upgrade test من نسخة Production snapshot.
- Backfill jobs لها Dry-run ونتائج قابلة للتدقيق.
- Foreign keys وUnique keys مركبة مع Tenant حيث يلزم.
- Index audit باستخدام `EXPLAIN` للـCRM/Finance/Dashboard.
- Backup/restore drill شهري.

معيار القبول: Fresh وUpgrade migration ينجحان مرتين متتاليتين، ولا Runtime DDL في المصدر.

### I. الاختبارات والجودة

- Unit tests لكل validation وpermission وstate transition.
- API contract tests لكل Endpoint حرج.
- DB integration tests ضد MySQL حقيقية مؤقتة.
- Playwright للـPublic/Admin/Employee/Client journeys.
- Role/button matrix لكل صفحة مهمة.
- Duplicate route scanner وRuntime DDL scanner في CI.
- Performance baseline وRegression budget.

معيار القبول: كل Gate أدناه أخضر على Commit الإصدار نفسه.

### J. التشغيل والمراقبة

- Structured logs مع request/correlation ID وTenant ID بدون PII حساس.
- Metrics للدفع والـLeads والـQueues والأخطاء والزمن.
- Alerts للـPayment/Journal mismatch والـOutbox backlog والـ5xx.
- Process manager، health/live وhealth/ready منفصلان.
- Staging مطابق للإنتاج قدر الإمكان.
- Runbooks للأعطال والاسترجاع وتعطل Providers.

معيار القبول: استعادة الخدمة والـDB من Backup في اختبار موثق ضمن RTO/RPO المحددين.

## 4. خطة 30 يومًا — إغلاق مخاطر الإطلاق

### الأسبوع 1: الأمان والأساس

- اعتماد v25 وتجميد الدمج بالجملة.
- إغلاق Auth/Staff/Tenant mismatch.
- إغلاق Tenant holes في Leads وRefunds وFinance print وAccounting ERP.
- إضافة اختبارات Cross-tenant.
- تشغيل Fresh migration على Staging DB.
- تفعيل Secret/readiness checks.

### الأسبوع 2: رحلة العميل والمال

- اختبار Registration/Lead/Assignment فعليًا.
- اختبار Checkout intent وProof approval.
- اختبار Payment/Journal/Enrollment/CRM داخل Transaction.
- اختبار Refund reversal.
- بناء Reconciliation report وإصلاح أي Orphans.

### الأسبوع 3: الصفحات والصلاحيات

- Role matrix للإدارة والموظف والمحاسب والعميل.
- اختبار كل Form/Button/Table/Filter حرج.
- منع Fire-and-forget في Business mutations.
- إصلاح حالات Loading/Error/Retry.
- استكمال تفكيك Dashboard وDaqqi وUnified Client.

### الأسبوع 4: UAT والإطلاق التجريبي

- UAT ببيانات اختبار في Tenantين وفرعين.
- Concurrency tests لاعتماد الدفع والـRefund.
- Load test للـDashboard والـLeads والـFinance.
- Backup/restore drill.
- Pilot محدود، Monitoring، وخطة Rollback.

## 5. خطة 31–90 يومًا — بناء منصة قابلة للتوسع

### الأيام 31–45

- Domain services لـCRM/Payments/Enrollment/Certificates.
- DTO contracts مشتركة ومولد OpenAPI.
- Outbox موحد للأحداث الخارجية.
- تفكيك SiteDataContext وواجهات الإدارة الكبيرة.

### الأيام 46–60

- Tenantize Community/Support/Accounting بالكامل.
- تحسين DB indexes وN+1 queries.
- Audit timeline موحد.
- Reconciliation dashboard وData quality jobs.

### الأيام 61–75

- CI/CD كامل وبيئة Staging ثابتة.
- Observability dashboards وAlerts.
- Provider adapters للـEmail/WhatsApp/Payments مع Circuit breakers.
- Load، soak، وفشل Provider simulations.

### الأيام 76–90

- Security review وPen-test.
- Disaster recovery exercise.
- مراجعة Accessibility وMobile UX.
- Release candidate freeze ثم UAT نهائي.
- إطلاق تدريجي حسب Tenant/Branch.

## 6. خارطة 91–180 يومًا

- Self-service SaaS onboarding وTenant provisioning.
- Subscription plans وFeature flags وفواتير المنصة.
- Analytics warehouse/read models للتقارير الثقيلة.
- Advanced lead scoring وautomation مع Human approval.
- Mobile/PWA improvements وOffline-safe progress queue.
- Data retention، consent، export/delete workflows مكتملة.
- Localization وCurrency/Tax rules حسب الدولة.

## 7. بوابات الإصدار الإلزامية

| Gate | شرط النجاح |
| --- | --- |
| Source | `git diff --check` وAPI syntax وTypeScript ناجحة |
| Unit | كل Unit tests ناجحة |
| Build | Admin وClient production builds ناجحة |
| Routes | صفر Duplicate routes وصفر Runtime DDL |
| DB | Fresh + Upgrade migrations ناجحة |
| SaaS | Cross-tenant suite ناجحة بالكامل |
| Journey | Lead-to-certificate E2E ناجح |
| Finance | Payment/Journal/Enrollment وRefund reversal ناجحة |
| Permissions | Role matrix ناجحة لكل Action حرج |
| Security | لا Critical/High مفتوحة بدون Risk acceptance مكتوب |
| Performance | لا تجاوز للـLatency/Error budgets |
| Operations | Backup/restore وRollback drill ناجحان |
| Providers | حالة كل Provider واضحة: active/test/suspended |

## 8. مؤشرات الأداء المستهدفة

- فقد Leads: 0.
- Duplicate lead rate بعد dedupe: أقل من 1%.
- Payment without journal: 0.
- Paid course without enrollment: 0.
- Cross-tenant access incidents: 0.
- API 5xx: أقل من 0.5%.
- p95 للـReads الرئيسية: أقل من 500ms على الحمل المستهدف.
- p95 للـMutations الحرجة: أقل من 1000ms باستثناء Providers.
- Outbox oldest pending age: أقل من 5 دقائق.
- Error-free client sessions: أكثر من 99%.
- Backup restore success: 100% في الاختبارات الدورية.

## 9. استراتيجية الدمج من 26 و30

كل ميزة تمر بالترتيب التالي:

1. إثبات أنها غير موجودة وظيفيًا في 25.
2. إثبات وجود Backend وUI وعقد بيانات حقيقي.
3. مراجعة Tenant/Permission/Transaction behavior.
4. إعادة تنفيذها وفق معمارية 25؛ لا نسخ أعمى.
5. إضافة اختبارات قبل دمجها.
6. تشغيل Gates السطح المتأثر ثم Quality suite.

ممنوع نقل Stores نسخة 30 الحالية أو Auth/Payments/HR/Certificates من 26 أو 30 دون إعادة تصميم كاملة.

## 10. استراتيجية الإطلاق والرجوع

- نشر Staging من Commit محدد.
- Database backup قبل كل Migration production.
- تشغيل Migrations قبل تحويل Traffic مع قياس الزمن.
- Canary لمؤسسة/فرع محدود.
- مراقبة 5xx والـQueues والتكامل المالي.
- Rollback التطبيق إلى الإصدار السابق دون Rollback مدمر للـSchema.
- Forward-fix migration عند الحاجة.
- إيقاف Mutations المالية مؤقتًا إذا فشل Reconciliation gate.

## 11. تعريف الجاهزية النهائية

المشروع يصبح جاهزًا للإطلاق فقط عندما تكون الرحلة الكاملة مثبتة على DB حقيقية، ويكون عزل المؤسسات مختبرًا، وتكون العمليات المالية قابلة للمطابقة، وتنجح كل بوابات الإصدار على نفس Commit المرشح للنشر. نجاح Build أو وجود الصفحة وحده لا يمثل جاهزية.
