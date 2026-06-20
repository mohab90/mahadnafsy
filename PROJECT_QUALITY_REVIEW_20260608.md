# تقييم جودة مشروع معهد الدراسات النفسية - 2026-06-08

## الملخص التنفيذي

التقييم الحالي بعد أول مرحلة إصلاح: **7.1 / 10**.

قبل إصلاحات اليوم كان التقييم العملي أقرب إلى **6.6 / 10** بسبب ثغرات تبعيات npm، تضخم شديد في ملفات رئيسية، ومخاطر schema/runtime migrations. بعد تحديث التبعيات، إزالة الاعتماد الضعيف على `uuid`، استبدال `xlsx`، وتعقيم عرض HTML في تبويب الاختبارات، تحسن الأمن والاعتمادية لكن المشروع لم يصل بعد إلى مستوى 10/10.

## ما تم تنفيذه اليوم

- إنشاء skill ذاكرة للمشروع: `C:/Users/Access/.codex/skills/mahad-project-memory`.
- إنشاء نسخة احتياطية قبل التعديل: `D:/mahadnew_backups/mahadnew_20260608_142712`.
- تشغيل السيرفرات المحلية:
  - Client: `http://127.0.0.1:3000/`
  - Admin: `http://127.0.0.1:4000/`
  - API: `http://127.0.0.1:3001/`
- حالة API health: **503** لأن MySQL المحلي غير متاح على `127.0.0.1:3306`.
- تصفير نتائج `npm audit --omit=dev` في `api`, `admin`, `client`.
- تحديث `react-router-dom` في العميل والأدمن إلى `7.17.0`.
- حذف اعتماد `uuid` من API واستبداله بـ `crypto.randomUUID()` من Node.
- حذف اعتماد `xlsx` من الأدمن واستبداله بـ `write-excel-file`.
- تمرير ملاحظات AI في `QuizzesTab` عبر `SafeHtml` و DOMPurify بدل عرض HTML مباشرة.
- بناء الإنتاج نجح في `admin` و `client`.
- إضافة skills مخصصة للمشروع: continuous testing, local runtime, safe refactor, schema guardian.
- إضافة أدوات دائمة داخل المشروع: `tools/mahad-quality-check.ps1` و `tools/start-mahad-alt-local.ps1`.
- إضافة `/api/health/live` لفحص حياة السيرفر بدون DB، مع إبقاء `/api/health` لفحص جاهزية DB.
- تعديل تحميل `.env` في API بحيث لا يكسر قيم البيئة الخارجية مثل `PORT=3101`.
- إصلاح URL handling في `SmsSettingsTab` حتى لا ينتج مسار `/api/api/...`.
- إصلاح CORS في وضع التطوير ليسمح بـ `localhost` و `127.0.0.1` و `[::1]` على أي port، بدون فتح ذلك في production.
- تشغيل نسخة التطوير على ports بديلة:
  - Client: `http://127.0.0.1:3100/`
  - Admin: `http://127.0.0.1:4100/`
  - API: `http://127.0.0.1:3101/`
- آخر فحص جودة كامل على نسخة التطوير البديلة: audit/build/syntax/smoke/health كلها PASS.
- تم التحقق من إصلاح الدخول في المتصفح المدمج: `http://127.0.0.1:4100/dashboard` يعرض لوحة الإدارة بعد الدخول.

## الدرجات التفصيلية

| المحور | الدرجة | التقييم |
|---|---:|---|
| بنية المشروع العامة | 6.5/10 | التقسيم إلى `api/admin/client` واضح، لكن توجد ملفات مركزية ضخمة تحمل مسؤوليات كثيرة. |
| API | 6.6/10 | يغطي وظائف كثيرة، لكن `server.js` و `routes/core.js` يحتويان schema/runtime migrations ومنطق أعمال وتشغيل دوري في نفس الطبقة. |
| Admin | 6.2/10 | غني جدًا وظيفيًا، لكنه أعلى جزء في الديون التقنية: ملفات ضخمة، casts كثيرة، وحزم كبيرة. |
| Client | 7.0/10 | أفضل نسبيًا، لكن `UserDashboard` كبير ويحتاج تقسيم، وبعض الأنواع ما زالت رخوة. |
| Database/schema | 5.5/10 | الخطر الأكبر: schema موزع بين `schema.sql`, `migrations`, و `ALTER/CREATE` أثناء runtime. |
| الأمن | 8.0/10 | `npm audit` نظيف الآن، وDOMPurify مستخدم، لكن يلزم مراجعة أسرار `.env`, CSRF, rate limits, ومسارات admin. |
| الأداء وحجم الحزم | 5.8/10 | builds تنجح، لكن توجد chunks كبيرة خصوصًا Admin `vendor` و `Dashboard` و Client `UserDashboard`. |
| جودة الأنواع TypeScript | 6.0/10 | يوجد 77 استخدامًا لـ `as any` في ملفات TS/TSX، وهذا يقلل ثقة التغيير. |
| الاختبارات | 3.0/10 | لا توجد طبقة اختبار كافية موثقة لتغطية API، الواجهات، أو workflows الحساسة. |
| التشغيل المحلي والتوثيق | 6.0/10 | التشغيل ممكن، لكن يعتمد على MySQL غير مهيأ محليًا ولا يوجد runbook كامل. |

## الحجم الفعلي للكود

تم القياس مع استبعاد `node_modules`, `dist`, `.vite`, `.local-logs`, و `package-lock.json`.

| القسم | الملفات | السطور |
|---|---:|---:|
| API | 34 | 20,053 |
| Admin | 94 | 55,630 |
| Client | 43 | 13,785 |
| الإجمالي | 171 | 89,468 |

## أكبر ملفات تحتاج اختصار

الأرقام المستهدفة تقديرية بعد استخراج components/services/hooks/types، وليست حذفًا عشوائيًا.

| الملف | الحالي | الهدف الصحي | الإجراء المقترح |
|---|---:|---:|---|
| `admin/pages/Dashboard.tsx` | 12,016 | 3,500-4,500 | تحويله إلى shell + tabs lazy + hooks للصلاحيات والـ KPIs. |
| `admin/pages/dashboard/tabs/LeadsTab.tsx` | 5,964 | 2,000-2,800 | فصل الجدول، الفلاتر، bulk actions، modals، وCRM helpers. |
| `admin/pages/UnifiedClientPage.tsx` | 4,054 | 1,800-2,400 | فصل payments, enrollments, communications, profile header. |
| `api/routes/core.js` | 3,798 | 1,200-1,800 | تقسيمه إلى routes صغيرة + services + validators. |
| `admin/pages/dashboard/tabs/FinancialTab.tsx` | 2,825 | 1,300-1,800 | فصل الحسابات، المصروفات، التقارير، والتصدير. |
| `client/pages/UserDashboard.tsx` | 2,726 | 1,300-1,800 | تقسيم dashboard cards, course progress, certificates, payments. |
| `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` | 2,605 | 1,300-1,700 | فصل calendar/grid/forms/data mapping. |
| `admin/context/SiteDataContext.tsx` | 2,526 | 800-1,200 | تقسيم state domains أو استبداله بطبقة query/cache. |
| `api/server.js` | 2,412 | 800-1,200 | إخراج migrations, cron jobs, health, bootstrap إلى modules. |
| `client/context/SiteDataContext.tsx` | 2,250 | 800-1,200 | نفس مسار admin context لكن بنطاق client. |

## إشارات خطر تقنية

- `as any`: عددها الحالي **77**، وأكثرها في `admin/pages/Dashboard.tsx`.
- أسطح HTML مباشرة: **12** استخدامًا لـ `innerHTML` أو `dangerouslySetInnerHTML`. جزء منها محررات rich text، لكنها تحتاج توثيق وتعقيم عند الحفظ والعرض.
- `console.log`: حوالي **120** في ملفات JS/TS، ومعظمها في API وسكربتات التشغيل. الأفضل توحيدها خلف logger بمستويات.
- Schema runtime: توجد أوامر `CREATE TABLE` و `ALTER TABLE` في `api/server.js`, `api/routes/*`, و `api/lib/db.js` بجانب `schema.sql` و `api/migrations`.

## الملفات التي لا يجب حذفها الآن

لا أنصح بحذف ملفات source الآن قبل عمل import graph واختبار تشغيل مع DB حقيقية. المرشح الآمن للحذف لاحقًا غالبًا سيكون:

- كاشات وأثر تشغيل: `.vite`, `.local-logs`, وملفات `dist` إذا كانت غير مطلوبة في التسليم.
- ملفات runtime مولدة مثل `api/watchdog.sh` إذا كانت لا تدخل في production flow.
- تقارير قديمة أو duplicate scripts بعد تأكيد أنها غير مستخدمة في deployment.

## خطة الوصول إلى 10/10

### المرحلة 1 - تثبيت التشغيل

- تجهيز MySQL/MariaDB محلي أو Docker Compose.
- تشغيل `schema.sql` ثم migrations على قاعدة نظيفة.
- جعل `/api/health` يفرق بين server up و database down بوضوح.
- إضافة `.env.example` كامل بدون أسرار.

### المرحلة 2 - ضبط schema

- نقل كل runtime migrations إلى ملفات migration versioned.
- منع `ALTER TABLE` داخل request handlers.
- توحيد naming بين snake_case في DB و camelCase في الواجهة عبر mapper واضح.
- إضافة rollback/backup policy قبل migrations الخطرة.

### المرحلة 3 - تقليل الحجم

- تفكيك `Dashboard.tsx`, `LeadsTab.tsx`, `UnifiedClientPage.tsx`, `UserDashboard.tsx`.
- توحيد API client بدل تكرار mapping داخل الصفحات.
- نقل business rules من React components إلى services/hooks قابلة للاختبار.
- إصلاح تحذير Vite الخاص بـ `admin/lib/mysqlapi.ts` عبر اختيار import strategy واحدة.

### المرحلة 4 - الاختبارات

- API: Supertest أو Vitest لاختبار auth, payments, enrollments, leads conversion.
- Frontend: Playwright لمسارات login, dashboard, course purchase, admin CRUD.
- Unit tests للحسابات المالية والعمولات والأقساط.
- CI يقوم بـ audit, build, typecheck, tests.

### المرحلة 5 - الجودة النهائية

- تقليل `as any` تدريجيًا إلى أقل من 10.
- توحيد logger وإزالة logs الحساسة.
- مراجعة security headers وrate limits ومسارات admin.
- تحسين bundle splitting حتى تختفي تحذيرات chunks الكبيرة أو تصبح مبررة.

## الحكم النهائي

المشروع غني وظيفيًا وقابل للتطوير، لكنه ليس 10/10 بعد لأن حجم الملفات المركزية وخلط schema مع runtime يرفعان تكلفة أي تعديل. الطريق الصحيح ليس حذف سطور بشكل عدواني؛ الطريق هو استخراج modules واضحة، تثبيت DB محلي، بناء اختبارات حول workflows الحساسة، ثم تقليل الحجم ملفًا ملفًا مع قياس build والوظائف بعد كل خطوة.
