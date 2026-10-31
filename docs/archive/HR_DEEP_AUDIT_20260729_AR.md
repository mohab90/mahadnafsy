# مراجعة HR العميقة — نسخة 25

التاريخ: 29 يوليو 2026  
نطاق المراجعة: الكود الفعلي، الـAPI، قاعدة البيانات، الواجهات، الصلاحيات، Payroll، رحلة الموظف، والترابط مع CRM والحسابات.  
منهج التقييم: مقارنة مباشرة مع Workday HCM وSAP SuccessFactors وOracle Fusion Cloud HCM، وليس مقارنةً بنظام داخلي صغير.

## الحكم التنفيذي

قسم HR أصبح مناسبًا لتشغيل معهد متوسط بعد إغلاق عيوب سلامة البيانات الأساسية، لكنه **ليس HCM مؤسسيًا عالميًا**. تقييمه العادل حاليًا:

- الجاهزية التشغيلية لنطاق المعهد: **8.0/10 مشروطة بتطبيق migrations واختبار staging حي**.
- النضج مقارنةً بأفضل منصات HCM عالميًا: **6.7/10**.
- الأمان وسلامة انتقال البيانات: **8.1/10**.
- اكتمال المنتج المؤسسي العالمي: **5.2/10**.

لا يصح إعلان جاهزية 100% قبل تطبيق migrations 150–152 على MySQL staging، وتشغيل UAT حي لكل الأدوار، ومراجعة خبير Payroll مصري/سعودي للضرائب والتأمينات.

## معيار المقارنة العالمي

Workday يضع Core HCM وTalent وWorkforce Management وPlanning/Analytics وتجربة الموظف في نواة موحدة، ويشمل جدولة القوى العاملة، الوقت، التوظيف، التعلم، المهارات والتخطيط.  
المصدر: https://www.workday.com/en-us/products/human-capital-management/overview.html

SAP SuccessFactors يغطي Core HR وPayroll وRecruiting وOnboarding وLearning وPerformance/Goals وSuccession وTime Tracking وWorkforce Analytics، مع localizations وتشريعات لعدد كبير من الدول.  
المصدر: https://help.sap.com/docs/successfactors-hcm  
المصدر: https://www.sap.com/canada/products/hcm/about-successfactors.html

Oracle HCM يعرّف الحل الكامل باعتباره ربطًا بين Global HR وRecruiting وCompensation وBenefits وTalent وLearning وWorkforce Planning وTime Tracking وPayroll.  
المصدر: https://www.oracle.com/human-capital-management/what-is-hcm/

## خريطة التنفيذ الفعلية

| الوحدة | الملفات الأساسية | الحكم |
|---|---|---|
| Employee Core | `api/routes/hr/employees.js`, `admin/pages/dashboard/tabs/HRTab.tsx` | يعمل مع مصدر بيانات مركزي وتحديث هوية ذري |
| Attendance & Leave | `api/routes/hr/attendance.js`, `api/routes/hr/compensation.js` | يعمل، مع حماية سجلات الإجازة من الكتابة اليدوية |
| Payroll | `api/routes/hr/payroll.js` | دورة حساب/اعتماد/دفع وقيد محاسبي، لكن ليست Payroll قانونية متعددة الدول |
| Compensation | `api/routes/hr/compensation.js` | فصل صلاحيات لاعتماد المستحقات وأسعار المحاضرين |
| Advances & Discipline & Documents | `api/routes/hr/records.js` | دورة سلفة محاسبية، تأديب قابل للتظلم، ومستندات soft-delete |
| Recruiting & Onboarding | `api/routes/hr/recruiting.js`, `api/routes/hr/talent.js` | Funnel مترابط وتحويل موظف وتهيئة وظيفية قابلة للتتبع |
| Offboarding | `api/routes/hr/offboarding.js` | نقل أعمال وإبطال جلسات وإخفاء الملف العام في transaction |
| eNPS | `api/routes/hr/enps.js` | تجميع يحمي المجموعات الأقل من 5 |
| Reports/Self-service | `api/routes/hr/reports.js`, `MyHrTab.tsx`, `StaffHomeTab.tsx` | أرقام السيرفر هي المصدر بدل حسابات المتصفح |

## رحلة الموظف الفعلية

| المرحلة | الحالة | مصدر الحقيقة | الترابط | الملاحظة |
|---|---:|---|---|---|
| طلب توظيف من الموقع | ✅ | `join_us` ثم `job_applicants` | Website → HR | التحويل ذري ومملوك للـtenant |
| فرز ومقابلة وعرض | ✅ | `job_applicants.stage` | HR Pipeline | انتقالات حالة قانونية ومراجعة متزامنة |
| Hire | ✅ | applicant → inactive staff | Recruiting → Employee Core | التفعيل منفصل لحماية الوصول |
| Onboarding | ✅ | templates/items | HR → Employee | منع قالب دور غير مطابق |
| ملف موظف وهوية دخول | ✅ | `staff` + `users` | HR → Auth | تغيير البريد ذري ويبطل الجلسات |
| حضور وإجازات | ✅ | `attendance_logs`, `leaves` | HR → Payroll | الإجازة المعتمدة تقفل سجل الحضور |
| أداء وعمولات | ⚠️ | payments + commissions + leads | CRM/Finance → HR | صحيح مركزيًا، لكن attribution تاريخي للتعيين غير مكتمل |
| سلفة | ✅ | `salary_advances` + journal | HR → Finance → Payroll | طلب/اعتماد/صرف/خصم؛ فصل مهام |
| Payroll | ⚠️ | payroll runs/items + journal | HR → Accounting | قيد متزن، لكن tax engine قانوني غير موجود |
| Offboarding | ✅ | offboarding + staff/users | HR → كل الأقسام | ينقل الأعمال ويلغي الجلسات والظهور العام |

## المشاكل التي عولجت بالدليل

| ID | المشكلة الأصلية | الملف والسطر | السبب الجذري | التأثير | المعالجة |
|---|---|---|---|---|---|
| HR-01 | تغيير بيانات الموظف قد يفصل `staff` عن `users` | `api/routes/hr/employees.js:199-305` | تحديث غير ذري للهوية | حساب دخول قديم/تسرب وصول | transaction + مزامنة البريد + زيادة `session_version` + audit |
| HR-02 | إجازة معتمدة يمكن الكتابة فوق حضورها | `api/routes/hr/attendance.js:480-489,539-545` | عدم تمييز سجل الإجازة | راتب وحضور خاطئ | قفل `leave_id` ورفض manual/import/self writes |
| HR-03 | الإذن يُعامل كيوم إجازة كامل | `api/routes/hr/attendance.js:259-266` | Vocabulary غير دقيق | خصم غير عادل | `PERMISSION → HALF_DAY` |
| HR-04 | أرقام الأداء محسوبة محليًا وبأسعار FX ثابتة | `api/routes/hr/reports.js:109-177`, `HRTab.tsx:464`, `StaffHomeTab.tsx:103-153` | أكثر من مصدر حقيقة | اختلاف الإدارة والموظف | تقرير server-side من `amount_egp` و`crm_commissions` |
| HR-05 | السلفة تقفز من اعتماد إلى خصم دون صرف محاسبي | `api/routes/hr/records.js:103-249`, `api/routes/hr/payroll.js:213,522` | Workflow ناقص | خصم راتب بلا حركة نقدية | `APPROVED → DISBURSED → DEDUCTED` وقيد مدين سلف/دائن نقدية |
| HR-06 | Payroll كل الفروع يتداخل مع Payroll فرع | `api/routes/hr/payroll.js:69-99` | لا يوجد period/scope lock | راتب مزدوج | migration 151 + قفل شهري + `PAYROLL_SCOPE_OVERLAP` |
| HR-07 | قيد دفع Payroll لا يفصل صافي/سلفة/استقطاعات | `api/routes/hr/payroll.js:477-509` | قيد مبسط | ميزان والتزامات غير صحيحة | 5100 مصروف، 1100 نقدية، 1300 سلف، 2200 استقطاعات |
| HR-08 | سعر المحاضر يتغير مباشرة | `api/routes/hr/compensation.js:41-177` | غياب approval workflow | تضخيم مستحقات | request/review مع فصل requester/reviewer |
| HR-09 | التأديب قابل للحذف أو الإقرار بواسطة HR | `api/routes/hr/records.js:389-463,648-741` | ملكية إجراء خاطئة | ضعف قانوني وأدلة غير موثوقة | immutable record + إقرار وتظلم self-service |
| HR-10 | Offboarding لا ينقل كل العمل ولا يلغي كل الوصول | `api/routes/hr/offboarding.js:130-204,301-333` | تغطية جزئية | تذاكر/محادثات معلقة وحساب نشط | نقل leads/subscribers/tasks/tickets/inbox/courses وإبطال الجلسات |
| HR-11 | eNPS يكشف تعليق مجموعة صغيرة | `api/routes/hr/enps.js:7,55-77` | لا يوجد privacy threshold | كشف هوية بالاستنتاج | حجب كامل للنتائج والتعليقات تحت 5 |
| HR-12 | Applicant/Onboarding writes بلا validation/audit ذري | `api/routes/hr/recruiting.js:24-56,268-367,413-590` | CRUD مباشر | بيانات تالفة ولا أثر تغييرات | validation + transaction + audit |
| HR-13 | موظف Expert/Other يمكن إنشاؤه بلا صلاحيات افتراضية | `api/constants/permissions.js:21-225`, `admin/constants/permissions.ts:10-350` | StaffRole أوسع من RBAC registry | حساب غير صالح للعمل | إضافة الدورين ومصفوفة أقل صلاحية |

## التقييم المقارن

| القدرة | Mahad v25 | Workday | SAP SF | Oracle HCM | تقييم Mahad |
|---|---:|---:|---:|---:|---:|
| Core employee record | جيد | ممتاز | ممتاز | ممتاز | 7.5 |
| Employee self-service | جيد | ممتاز | ممتاز | ممتاز | 7.2 |
| Leave/attendance workflow | جيد | ممتاز | ممتاز | ممتاز | 7.4 |
| Payroll accounting integrity | جيد محليًا | ممتاز | ممتاز | ممتاز | 7.0 |
| Payroll legal/localization | محدود | ممتاز | ممتاز | ممتاز | 3.5 |
| Recruiting/ATS | متوسط جيد | ممتاز | ممتاز | ممتاز | 6.3 |
| Onboarding | جيد أساسي | ممتاز | ممتاز | ممتاز | 6.8 |
| Performance & goals | متوسط | ممتاز | ممتاز | ممتاز | 5.8 |
| Compensation planning | متوسط | ممتاز | ممتاز | ممتاز | 5.6 |
| Succession/career/skills | غير موجود | ممتاز | ممتاز | ممتاز | 1.5 |
| Workforce planning | غير موجود | ممتاز | ممتاز | ممتاز | 1.5 |
| People analytics | تقارير تشغيلية | ممتاز | ممتاز | ممتاز | 5.5 |
| Mobile/offline/time clocks | محدود | ممتاز | ممتاز | ممتاز | 3.5 |
| Security/audit/SOD | جيد جدًا | ممتاز | ممتاز | ممتاز | 8.1 |
| Multi-tenant isolation | جيد جدًا بالكود | ممتاز | ممتاز | ممتاز | 8.0 |

## مراجعة أدوار الموظفين

| الدور | ما يراه ويعمل عليه | نطاق البيانات | الجاهزية |
|---|---|---|---:|
| Admin / Manager | كل الوحدات | كل tenant | ✅ 8.5/10 |
| Online Manager | CRM، عملاء، طلبات، دفع، Finance، Academy، Inbox | كل tenant | ⚠️ 8.0/10؛ يحتاج UAT حي |
| Sales & Collection Manager | CRM/عملاء/طلبات/دفع/Finance/تقارير | كل tenant | ⚠️ 8.0/10 |
| Sales | ليداته، عملاؤه، طلباته، استشارات، ملفه | assigned_sales | ✅ 8.1/10 |
| Collection | العملاء المحالون، التحصيل، refunds، Finance | assigned_cs | ⚠️ 7.8/10؛ Paymob مؤجل |
| Support | عملاء محالون، inbox، إشعارات، tickets | assigned_cs | ✅ 7.8/10 |
| Reception Dokki | جدول وعملاء وليدات وطلبات الدقي | branch:DAQQI | ⚠️ 7.7/10؛ اختبار الحضور يأتي في مرحلة الدقي |
| Dokki Manager | الدقي + حساباته وتقاريره | branch:DAQQI | ⚠️ 7.9/10 |
| HR | Employee Core، Recruiting، Payroll prep، تقارير | لا يرى CRM customer rows | ✅ 8.0/10 |
| Accountant | Finance/Accounting/Orders/Payments | tenant/branch policy | ⚠️ 7.8/10؛ شاشة صرف السلف يلزم توحيدها داخل Finance |
| Consultant | الاستشارات والعملاء المرتبطون والتقارير | assigned_sales | ✅ 7.4/10 |
| Trainer/Instructor | الكورسات والمحاضرات والاستشارات وملفه | موارد مرتبطة | ✅ 7.5/10 |
| Expert | قراءة الكورسات والاستشارات والعملاء والتقارير | none في القوائم الموحدة | ⚠️ 6.8/10؛ تمت إضافة RBAC ويلزم UAT حي |
| Other | Dashboard وملفه وطلباته فقط | none | ⚠️ 6.5/10؛ أقل صلاحية مقصودة ويلزم تعريف وظيفي أدق |

كل موظف يملك الآن مسارًا ظاهرًا إلى `staff_settings` في `StaffHomeTab.tsx:192`، ومنه السلف، الإجازات، التأديب والبيانات الشخصية. الـAPI self-service لا يعتمد على `view_hr`.

## الأداء والمعمارية

| البند | التقييم /10 | الملاحظة |
|---|---:|---|
| مصدر الحقيقة | 8.0 | أرقام الأداء والعمولة والراتب من السيرفر؛ بقي attribution تاريخي |
| Transactions | 8.4 | المسارات المالية والهوية وoffboarding/recruiting ذرية |
| Query design | 6.8 | بعض تقارير legacy تستخدم `MONTH()/YEAR()` وتحتاج range predicates |
| Modularity | 6.6 | الـAPI مقسم، لكن ملفات `payroll.js`, `records.js`, `recruiting.js`, `HRTab.tsx` كبيرة |
| Frontend bundle | 7.4 | HR chunk قرابة 83KB غير gzip بعد build، والأقسام الثقيلة lazy-loaded |
| Maintainability | 6.8 | العقود أفضل، لكن HRTab ما زال monolith ويجب تقسيمه |
| Scalability | 6.9 | locks وindexes جيدة؛ لا يوجد load test حي على MySQL staging الحالي |

## الفجوات المتبقية الصادقة

1. لا يوجد Payroll tax/legal engine رسمي لمصر والسعودية، ولا تحديث تشريعي أو نماذج تأمينات/ضرائب.
2. لا توجد Benefits administration أو end-of-service/gratuity rules متكاملة.
3. لا توجد Position Management وeffective-dated org/job history على مستوى Workday/Oracle.
4. لا توجد Succession Planning أو talent pools داخلية أو skills ontology/marketplace.
5. لا توجد Workforce Planning أو headcount scenarios أو predictive attrition.
6. ATS لا يملك interview calendar، offer e-signature، background checks، consent/retention workflow، أو candidate portal.
7. أداء المبيعات ينسب lead المنشأ في الشهر إلى المكلّف الحالي؛ لا يوجد assignment-history fact table كامل.
8. لا توجد mobile app/offline time capture أو تكامل أجهزة biometric؛ يُراجع في مرحلة الحضور.
9. صرف السلفة صالح API ومحاسبيًا، لكن يحتاج surface مباشر داخل Finance للمحاسب بدل الاعتماد على دخول HR tab.
10. migrations 150–152 اجتازت parser/tests فقط ولم تطبق على staging لأن MySQL غير متاح في جلسة المراجعة.

## أدلة الاختبار

- HR targeted: **35/35 ناجح**.
- Migration runner: **9/9 ناجح** ويقرأ migrations 150–152.
- Full API unit regression: **525 إجمالي، 524 ناجح، 0 فشل، 1 TODO خاص Paymob المؤجل**.
- Quality gates: **56/56 ناجح**.
- Admin TypeScript: ناجح.
- Admin production build: ناجح.
- Client production build: ناجح.
- لم يُشغّل live DB/UAT جديد بعد تعديلات HR لأن MySQL staging غير متاح؛ آخر UAT حي سابق كان ناجحًا لكنه لا يثبت migrations الجديدة.

## قرار إغلاق HR

يُغلق HR كـ **Code Complete / Staging Pending**، وليس Production 100%. شروط نقله إلى Production Ready:

1. تطبيق migrations 150–152 والتحقق من checksums.
2. تشغيل UAT لكل 16 role types، بما فيها Expert وOther المضافان.
3. اختبار متزامن لدورتي Payroll لنفس الشهر والتأكد من `PAYROLL_SCOPE_OVERLAP`.
4. تنفيذ سلفة حية من الطلب حتى journal ثم payroll deduction.
5. مراجعة محاسب/خبير ضرائب لقواعد مصر والسعودية وتحديد ما هو داخل/خارج المنتج.
6. قياس p95 لتقارير HR وPayroll على حجم بيانات production-like.
