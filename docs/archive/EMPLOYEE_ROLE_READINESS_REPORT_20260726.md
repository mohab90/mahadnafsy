# تقرير جاهزية حسابات الموظفين — Mahad v25

تاريخ المراجعة: 26 يوليو 2026  
النطاق: Admin + Employee Dashboard + API + MySQL + رحلة العميل اليدوية بدون Paymob.

## 1. منهج التحقق

- المصدر الرسمي للأدوار والصلاحيات: `api/constants/permissions.js`.
- الحماية الفعلية: `api/middleware/auth.js` و`requirePermission`.
- نطاق البيانات: `DATA_SCOPE` و`api/lib/financialScope.js`.
- إظهار التبويبات: `admin/pages/dashboard/dashboardShared.tsx` و`DashboardNavigation.tsx`.
- التوجيه بعد الدخول: `admin/pages/dashboard/hooks/useStaffRoleRedirects.ts`.
- تم إنشاء وتسجيل دخول 17 حساب اختبار تغطي 14 Role أساسيًا، مع حسابين للدعم وحسابين HR/Recruiting وحساب عميل.
- تم اختبار Profile الموظف، HR الذاتي، الجدول، الـpositive permissions والـnegative permissions.
- تم اختبار Website → Lead → Sales Conversion → Client Login → Payment/Journal → Refund/Reversal → Dokki Transfer → Support → HR.

## 2. قواعد البيانات المرئية حسب الدور

| الدور | Data Scope الفعلي | العملاء/الـLeads | المال | HR | نقطة الدخول |
|---|---|---|---|---|---|
| Admin | كل Tenant | الكل | الكل | الكل | Overview |
| Manager | كل Tenant | الكل | الكل | الكل | Staff Home |
| Online Manager | كل Tenant | الكل | الكل حسب الصلاحية | لا | Online Clients |
| Sales & Collection Manager | كل Tenant | الكل | الكل حسب الصلاحية | لا | Leads |
| Sales | assigned_sales | المسند إليه فقط | قراءة Orders فقط | لا | Staff Home |
| Collection | assigned_cs | المسند إليه فقط | المسند إليه + التحصيل | لا | Staff Home |
| Support | assigned_cs | المسند إليه فقط | Orders قراءة فقط | لا | Staff Home |
| Daqqi Manager | branch:DAQQI | فرع الدقي | فرع الدقي | لا | Daqqi Schedule |
| Reception Daqqi | branch:DAQQI | فرع الدقي | Orders تشغيلية بدون Finance كامل | لا | Daqqi Schedule |
| HR | none للعملاء | لا | لا | كامل حسب الصلاحية | Staff Home |
| Accountant | كل Tenant ماليًا | لا CRM | Finance/Accounting/Orders | لا | Staff Home |
| Consultant | assigned_sales | المرتبط به فقط | لا | ذاتي فقط | Staff Home |
| Trainer | none للعملاء | لا | لا | ذاتي فقط | Staff Home |
| Instructor | none للعملاء | لا | لا | ذاتي فقط | Staff Home |

## 3. التقييم التشغيلي لكل حساب

| الدور | ما يراه ويستخدمه | اختبارات فعلية | قيود صحيحة | الجاهزية |
|---|---|---|---|---:|
| Admin | كل الأقسام والإعدادات والموظفين والمال | Staff list + الرحلة الكاملة | Tenant + MFA policy | 9.5/10 |
| Manager | صلاحيات إدارية كاملة داخل Tenant | Finance + Role login/self-service | لا Platform Admin تلقائيًا | 9.4/10 |
| Online Manager | العملاء والـCRM والكورسات والطلبات والمال | Subscribers + Courses + Finance | لا HR/SaaS security | 9.1/10 |
| Sales & Collection Manager | كل Leads/Subscribers وأداء الفريق والمال | Leads + Finance | Tenant فقط | 9.1/10 |
| Sales | Leads/Clients/Orders المسندة إليه | Leads + Subscribers + Orders | ممنوع HR/Finance approve | 9.2/10 |
| Collection | العملاء والمدفوعات والطلبات المسندة إليه | Subscribers + Payments + Orders | Maker/Checker على الاعتماد | 9.2/10 |
| Support | Inbox/Tickets والعملاء والطلبات للقراءة | Inbox + Subscribers + Orders | ممنوع Finance/HR | 9.1/10 |
| Reception Daqqi | عملاء وجدول وطلبات الدقي | Daqqi Clients + Orders | Branch DAQQI فقط | 9.0/10 |
| Daqqi Manager | تشغيل الدقي + Finance الفرع | Daqqi Clients + Branch Payments | لا بيانات فروع أخرى | 9.2/10 |
| HR | الموظفون والتوظيف والرواتب والسياسات | Employees + Recruiting | ممنوع Finance/CRM | 9.2/10 |
| Accountant | Payments/Ledger/Refunds/Orders/Chart | Refunds + Chart + Orders | ممنوع HR وCRM | 9.4/10 |
| Consultant | Calendar والعملاء والـLeads المرتبطة | Calendar + Subscribers | لا Finance ولا HR | 8.8/10 |
| Trainer | Courses/Lectures + HR الذاتي | Courses + Self HR/Schedule | لا CRM/Finance | 8.7/10 |
| Instructor | Courses/Lectures + HR الذاتي | Courses + Self HR/Schedule | لا CRM/Finance | 8.7/10 |

## 4. إصلاحات نتجت عن مراجعة الأدوار

### EMP-01 — Orders كانت غير متطابقة بين الواجهة والـAPI

- السبب: الواجهة أظهرت Actions لأدوار تشغيلية بينما `api/routes/orders.js` كان يستخدم `requireAdmin`.
- الإصلاح: قراءة وإنشاء وتحديث الطلبات أصبحت Permission-based مع Financial Data Scope.
- النتيجة: Sales/Collection/Support/Reception/Accountant يرون فقط النطاق المسموح فعليًا.

### EMP-02 — تغيير حالة الدفع كان يستطيع تجاوز الـLedger

- السبب: PATCH العام كان يغير `payments.status` مباشرة إلى failed بدون Refund/Reversal.
- الإصلاح: PATCH العام لا يكتب في `payments`، ويرفض أي Order له تاريخ مالي.
- النتيجة: Paid/Refunded لا يتغيران إلا من Payment/Refund workflow الرسمي.

### EMP-03 — أزرار محلية مكسورة في Orders

- السبب: أزرار Paid/Refunded كانت تستدعي PATCH يعرف مسبقًا أنه سيرفض.
- الإصلاح: التأكيد يستدعي `confirm-payment`، وتم حذف اختيار Refunded المحلي، والحذف ظاهر للإدارة فقط.

### EMP-04 — Segregation of Duties

- السبب: الحماية كانت في الواجهة فقط.
- الإصلاح: الـAPI يرفض اعتماد الموظف لنفس الطلب الذي قام بتسجيله.

### EMP-05 — Activity Logs كانت قابلة للتسريب بين Tenants

- السبب: جدول وقراءة `activity_logs` بدون `tenant_id`.
- الإصلاح: Migration 139، كل الكتابات والقراءات Tenant-scoped، والأرشفة Transactional.

## 5. نتيجة مصفوفة الـUAT

- 17/17 حسابًا سجل الدخول بنجاح.
- 14/14 Role أساسيًا له Staff profile متصل.
- كل الحسابات وصلت إلى HR self-service والجدول.
- Positive access: Admin, Manager, Online Manager, Sales Manager, Sales, Collection, Support, Dokki, HR, Accountant, Consultant, Trainer, Instructor نجح.
- Negative access: Support/Sales/Accountant/HR/Reception/Trainer/Instructor تم منعهم من الأقسام غير المصرح بها بـ403.
- Orders scope نجح لـSales/Collection/Support/Reception/Accountant.
- رحلة العميل والـJournal والـRefund reversal والدعم والتوظيف نجحت.

## 6. ما لا يمكن اعتباره جاهزًا 100% بعد

1. Paymob وتقسيم الدفع مؤجلان حسب قرار المشروع.
2. SMTP وWhatsApp يحتاجان credentials إنتاج واختبار إرسال حقيقي.
3. MFA يجب تفعيله بسياسة Production للحسابات المالية والإدارية.
4. يلزم Browser E2E نهائي لكل Role على Release Candidate، رغم نجاح API/DB والـTypeScript.
5. يلزم Load/Soak test إنتاجي للحسابات المتزامنة والـqueues.

## 7. الحكم

حسابات الموظفين جاهزة وظيفيًا للعمل على المسارات اليدوية الحالية بدرجة عالية، والصلاحيات الأساسية ونطاقات البيانات مختبرة فعليًا. لا يصح إعلان جاهزية إنتاج 100% قبل إغلاق اختبارات Browser E2E، التشغيل الخارجي، الأحمال، وتفعيل إعدادات الأمان الإنتاجية. Paymob خارج الحكم الحالي.

## 8. تحديث بوابة المتصفح والأداء

- تم تشغيل Playwright على Chromium ضد Client + Admin + API + MySQL الحقيقيين: **36/36 اختبارًا ناجحًا**.
- تم توسيع مصفوفة Render للحسابات لتشمل Consultant وTrainer وInstructor: **16/16 حساب موظف** فتح لوحة العمل بدون خطأ React قاتل أو شاشة فارغة.
- أول تشغيل كشف إن حد الشبكة كان يحسب تسجيلات الدخول الناجحة ضمن محاولات الهجوم؛ ده كان ممكن يمنع موظفي فرع كامل خلف NAT واحد. تم تعديل `api/middleware/rateLimits.js` بحيث النجاحات لا تستهلك الحد مع استمرار حدي الحساب والشبكة للمحاولات الفاشلة.
- اختبار الحمل الخفيف: CRM reads ‏p95=53ms، تسجيل الدفع اليدوي ‏p95=25ms، صفر أخطاء. تسجيل الدخول المتزامن ‏p95=3.75s ويظل نقطة تحسين أداء، من غير تخفيض تكلفة تشفير كلمات المرور.
- الحكم المحدّث: **كل الأدوار الأربعة عشر الأساسية جاهزة وظيفيًا على API وواجهة Chromium للمسارات المختبرة**. المتبقي قبل Production هو إعدادات البنية الخارجية المذكورة في تقرير الجاهزية الشامل، وليس كسرًا معروفًا في حساب دور بعينه.
