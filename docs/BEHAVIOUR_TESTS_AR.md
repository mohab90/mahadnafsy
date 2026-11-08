# اختبارات تختبر السلوك لا نص الكود (٨ نوفمبر ٢٠٢٦)

الخطة (`docs/PLAN_TO_9_5_AR.md`، «الاختبارات والجودة»): الاختبارات التي تقرأ نص الملف وتطابقه بـ regex تنكسر كلما اتحرك الكود من غير ما السلوك يتغير. المعيار: أقل من ١٥٪ من اختبارات الوحدة تقرأ النص، وصفر اختبار يعتمد على ساعة الجهاز.

## القياس

```
node api/tools/test-pin-report.cjs            # أسوأ ٢٥ ملف + الإجمالي
node api/tools/test-pin-report.cjs --all      # كل ملف فيه حالة
node api/tools/test-pin-report.cjs --json
node api/tools/test-pin-report.cjs --dir=<نسخة قديمة من tests>   # مقارنة قبل/بعد
```

الأداة تقرأ النص ولا تحلله: كل `test(` كتلة، والاختبار «مثبّت على النص» لو الكتلة تستدعي قارئ ملفات (`fs.readFileSync` لملف غير fixture، أو دالة في الملف تغلّفه، أو ثابت اتملى منها، أو `_authRouteSource` / `_adminSplitSource`) ثم `match` / `doesNotMatch` / `includes` / `.test()`. واختبار «يعتمد على الساعة» لو فيه `new Date()` أو `Date.now()` في الكود (من غير تعليقاته) ومفيش ساعة متجمدة (`mock.timers`) ولا `now`/`today` ممرَّرة. حدّها: ما بتشوفش قراءة الساعة اللي جوه الكود المختبَر.

## نقطة البداية (commit a34214cf)

| | قبل |
|---|---|
| ملفات اختبار الوحدة | ٥٨٣ |
| الاختبارات (كتل `test(`) | ٣٢٩٣ |
| مثبّتة على النص | **١١٨٤ (٣٦٫٠٪)** في ٣٦٧ ملف |
| تعتمد على الساعة | **٢٢** في ١٨ ملف |

(أول نسخة من الأداة عدّت أي اختبار يقرا ملفًا ويعمل `match` على أي حاجة: ١٢٧٧ = ٣٨٫٨٪. الأدق: الاختبار «مثبّت» لما موضوع التأكيد نفسه نص مقروء. اختبار بيقرا سكريبت ويأكد على اللي حصل لما اتشغّل مش بيتعدّ. الأرقام تحت بالنسخة الدقيقة.)

كل اختبارات الوحدة الـ ٣٣٠٦ خضراء قبل الشغل (٣٧ متخطّاة)، وفحص الجودة ٦٧/٦٧.

## القرار لكل اختبار مثبّت

- **يبقى** لو بيحرس قاعدة مش بتتوصل بسلوك: عزل المستأجر في الـ SQL، منع SQL متركّب بنص، منع تسجيل أسرار أو عناوين IP، حظر استيراد. ولو فحص الجودة (`tools/mahad-quality-check.mjs`) يقدر يشيله، ينتقل له.
- **يتحوّل** لاختبار بيستدعي الدالة أو المسار بمدخلات ويقارن المخرجات أو حالة القاعدة (esbuild لمنطق الأدمن، `call()` للمسارات، قاعدة حقيقية لما الـ SQL هو السلوك).
- **يتشال** فقط لو اختبار سلوك موجود فعلاً بيغطي نفس القاعدة (واسمه في رسالة الـ commit).

## الساعة

الاختبارات اللي بتقارن بـ «الآن» اتجمّدت بـ `mock.timers.enable({ apis: ['Date'], now })` (الساعة نفسها في كل تشغيل وكل ساعة في اليوم). واختبارين بيقيسوا **مدة** مش وقت (انتظار الـ rate limiter، تكلفة bcrypt) بقوا يقيسوا بـ `performance.now()`.

## اللي اتعمل (٨ نوفمبر)

| قبل | بعد |
|---|---|
| مثبّتة على النص ١١٨٤ من ٣٢٩٣ (٣٦٫٠٪) | ١١٤٦ من ٣٢٧٢ (٣٥٫٠٪) |
| تعتمد على الساعة ٢٢ | **٠** |

الساعة: ١٧ ملف اتجمّدت ساعتهم بـ `mock.timers` (ثابتة على 2026-11-04T10:00Z)، واثنين بيقيسوا مدة (انتظار الـ rate limiter، تكلفة bcrypt) بقوا بـ `performance.now()`.

### فين راحت كل قاعدة

| كانت (نص بيتطابق عليه) | بقت |
|---|---|
| تقييد كل استعلام في `api/routes` بـ `tenant_id` (crmFinanceUtilitiesTenantScope، accountingTenantScope… وغيرها) | فحص الجودة رقم ١٤ (`tenant-scope-scan`، الحد صفر على كل استعلام في المسارات) + `integration/tenantIsolation` (معهدين على HTTP). لسه ما اتشالتش كل ملفات «TenantScope»: دي أكبر دفعة جاية |
| من يفتح مسارات الفلوس (`requirePermission(...)` جنب المسار) | `financeRoutesGuards.test.js`: بيشغّل الـ guards الحقيقية بصلاحية الفتح وبصلاحيات تانية وبدون موظف (٨ مسارات) |
| الفاتورة المطبوعة بتهرّب البيانات + 404 | `printableInvoice.test.js` (المسار بيتنادى فعلاً على قاعدة بترد بالنمط) |
| الإجازات: اعتماد ذاتي، انتقالات، رصيد، تعارض حضور، قفل الأيام | `integration/hrLeaveWorkflow` (قاعدة حقيقية؛ اتجرّب بتخريب الشرط فاتكسر) |
| فصل المهام: مكافأة/خصم، تقييم الأداء، سلفة (اعتماد ≠ صرف، `DEDUCTED` بيد الرواتب فقط) | `integration/hrSeparationOfDuties` |
| الدفعة اليدوية: مندوب بدون صلاحية = pending، الاعتماد بيرحّل القيد مرة واحدة، الرفض بسبب، الاسترداد بيتقرر مرة | `integration/manualPaymentApproval` |
| فلوس الشهادة مش فلوس الكورس (٦ ملفات بـ regex على `payment_type IN (...)`) | `integration/certificateMoneyIsNotCourseMoney` (السعر، المدفوع، الفحص التلقائي للشهادات، إلغاء قسط الشهادة، ما يقفلش الكورس؛ اتجرّب بتخريب الفلتر) |
| قسط المكتب: `course_expected` = سعر العميل، تاريخ القاهرة، صفوف `installment_entries`، مرة واحدة، قفل سعر التحصيل | `integration/deskInstalmentPayment` |
| عميل الـ API في الأدمن والموقع: مشاركة الـ GET الجاري، الكتابة ما بتتشاركش ولا بتتكرر، إعادة المحاولة بعد 502/TypeError/AbortError | `apiClientsRequests.test.js` (بيتعمل bundle للملف الحقيقي بـ esbuild وfetch مزيّف؛ الاتنين) |
| `currencyForBranch`، `cdnImg` | `browserHelpersBehaviour.test.js` |
| القيود اليدوية والفترات المحاسبية: توازن، سطر بمبلغ واحد، حساب في الدليل ومفعّل، تاريخ حقيقي، فترة مقفولة ما بتقبلش قيد لحد ما تتفتح بسبب، فترة واحدة مفتوحة | `integration/accountingJournalsAndPeriods` (ما كانش ليها أي اختبار تكامل) |
| تقييد كل استعلام في `api/lib` بـ `tenant_id` | فحص الجودة رقم ٣٠ (نفس مسح الفحص ١٤ على `api/lib`، الحد ٢٣ استعلام معروف: workers وصفوف بالـ id؛ بيقل ولا بيزيد). اتشالت اختبارات crmTenantScope الستة، وaccountingTenantScope اتنين |
| قواعد ما فيش استدعاء يوصلها: مسار `/api` مكرّر في الأدمن، تخطيط عملة موحّد، كل تاب مالي ينفتح من الشريط، كل كاتب لخطط الأقساط بيعيد كتابة صفوفه | `tools/source-rules.mjs` + فحص الجودة رقم ٢٩ (٦٨ ثم ٦٩ مع فحص ٣٠) + `sourceRulesScanner.test.js` |
| ما يبقى كنص (سبب ظاهر في الملف) | `staticRulesKept.test.js`: لا upsert على المشتركين، outbox + مفتاح dedupe في الـ drip |

### كسب فعلي: عيب لقيناه
`tryJson` كان بيرجّع القيمة الاحتياطية لما عمود JSON يجي من MariaDB 10.11 جاهز (مصفوفة مش نص). النتيجة على سيرفر زي المختبر: تقديم تقييم أداء فيه أدلة بيترفض «الأدلة مطلوبة» وقائمة التقييمات بتظهر فاضية. اتصلّح في commit مستقل (`718f390b`) مع اختبار وحدة. لو الإنتاج MariaDB 10.11 (غالبًا) فالعيب كان موجود فيه؛ لازم الـ commit ده ينزل.

### الأداة لسه بتشوف مثبّتات كتير ليه
الأرقام دي بتعدّ أي اختبار موضوع تأكيده نص مقروء، من غير حكم على قيمته. أغلب الباقي (١١٥٣) بالتقدير:
- واجهات الأدمن/الموقع بالـ regex على TSX (~٤٥٠ اختبار): ما بتتحول بدون رسم الشاشة (renderAdmin أو e2e) — ودي أغلى فئة.
- مسارات `api/routes` (~٣٥٠): نص تقييد المستأجر → فحص ١٤ (حذف)، والأذونات → جدول guards، والباقي SQL محدد يحتاج تكامل.
- `lib` + migrations + سكريبتات النشر (~١٥٠): نص ثابت بيتحوّل لقواعد في `source-rules.mjs` أو تكامل على القاعدة.

### المتبقي (تقدير أمين)
للوصول لأقل من ١٥٪ (≈٤٩٠) لازم تتحل ~٦٦٠ اختبار تاني. بوتيرة الجلسة دي (٣٠ اختبار تقريبًا اتحلّوا بجودة، مع كتابة ٣٠ اختبار سلوك جديد) ده حوالي **٢٥ إلى ٣٥ يوم عمل**: ~٨ أيام لملفات «TenantScope» والأذونات (حذف بعد فحص ١٤ + جدول guards)، ~١٠ أيام لتكامل مسارات الفلوس والموارد (دفعات، استردادات، رواتب، تعيين)، ~١٠ أيام لواجهات الأدمن (renderAdmin على الشاشات الكبيرة + بعض e2e)، والباقي سكريبتات نشر ومايجريشن لقواعد `source-rules`.

## الدفعة الثانية (بعد دمج review-merge-8nov)

الرقم الآن بالأداة: **١١٢٠ من ٣٢٥٣ (٣٤٫٤٪)** في ٣٦٦ ملف، والاختبارات المعتمدة على الساعة صفر.

- `tools/source-rules.json` (٢٣ قاعدة من اختبارات وحدة اتحولت): اختبارات بتقرا سكريبت نشر أو مايجريشن أو أداة، أو بتمنع حاجة بس. نفس الـ regex على نفس الملف، لكن في فحص الجودة ٢٩ مش في اختبارات الوحدة.
- `integration/hrRecruitingWorkflow` (مراحل المتقدم، التوظيف بالإجراء بتاعه بس، سجل المعيَّن محمي، التهيئة الواحدة، ملاحظة طلب الموقع بتفضل لما الحالة تتغير)، `hrDisciplinaryRecords` (الإقرار للموظف بس، الثبات بعده، الاستئناف، لا حذف)، `leadStateAndMerge` (الحالة والتايم لاين مع بعض، دمج الليدز بينقل العلاقات ويتفك).
- جدول الـ guards زاد صف (`join-us/:id/to-applicant`).

### ليه الرقم نزل بس شوية
كل اختبار مثبّت محتاج قراءة الكود الحقيقي وكتابة اختبار سلوك بيتجرّب بتخريب الكود. التحويل الآلي (`/d/tmpwork/migrate-rules.cjs` أثناء الجلسة) اتضح إنه بيمسك ٢٣ اختبار بس من ١١٤٦ لأن أغلبهم فيه تأكيدات تانية. الباقي يدوي: ~٣ اختبارات لكل ساعة عمل جيدة. التقدير بقى: ١١٢٠ ← ٤٩٠ يعني ~٦٣٠ اختبار ≈ **٣٠ إلى ٤٠ يوم عمل** بنفس النهج.

### الدفعة الثالثة
الرقم: **١١٠٢ من ٣٢٣٧ (٣٤٫٠٪)**.
- `integration/staffAuthority` (مصفوفة الحرس × الأدوار: من يدخل ومن يُعامل كصلاحية كاملة، والحساب الموقوف والغريب)، `staffTasksAreTheirOwn` (مهامي: الموظف بلا صلاحيات يرى ويعدّل مهامه بس، المدير يرى الكل و`my` بتضيّق)، `communityPosts` (المنشور بيستنى المراجعة، صاحبه بس يعدّل/يحذف، الإعجاب بيتبدّل مرة لكل عضو، التعليق لازم نص)، `subscriberConvertToLead` (العميل بلا تاريخ يرجع ليد، اللي له دفعة أو اشتراك مرفوض بالأسباب).
- `selfServiceGuards.test.js`: ملفي/تقريري/رسائلي بلا حق HR، والكتابة في ملف حد لـHR، واللوحات الشخصية.
- اتشالت: communityTenantScope (كلها)، ٩ من tenantIsolationHardening، ٣ من adminAuthority. اللي بقى نص رجع لـ`tools/source-rules.json` (٢٣ قاعدة).
- سياسة معلنة: دبابيس «بتستخدم transaction / FOR UPDATE / upsert idempotent» في ملفات الـTenantScope اتشالت مع نصها الخاص بالمستأجر (فحصا ١٤ و٣٠) — الذرّية نفسها ما عندهاش اختبار حقن أعطال. ده قرار مقصود ومكتوب هنا، مش نسيان.

### الدفعة الرابعة
الرقم: **١٠٩٧ من ٣٢٣٥ (٣٣٫٩٪)**.
- `integration/hrMonthSheetAbsenceAndPenalty` (أنواع الغياب: بدون إذن / بإذن / يوم حر / من الرصيد ورفضه لما الرصيد يخلص، وجزاء المدير: مبلغ أو أيام على ثلاثين، السبب، مش لنفسه، PENDING).
- `adminLibBehaviour.test.js` (bundle بـesbuild): أدوار الصلاحية الكاملة في اللوحة = السيرفر، `isCollected`، عناوين التابات القديمة، الشهادة المحذوفة تفضل محذوفة، سلّم الخبرة.
- نص UI/دفع ثابت اتحول لقواعد في `tools/source-rules.json` (٢٤ قاعدة) مع سبب.

### الدفعة الخامسة (فحوصات المسح تنتقل لبوابة الجودة)
الرقم: **١٠٩١ من ٣٢٢٥ (٣٣٫٨٪)** في ٣٦٢ ملف.
- اختبارات «امسح الشجرة كلها وامنع نمط» هي بالتعريف قاعدة نص: اتنقلت لـ`tools/source-rules.json` كـ«scan» (مجلدات + امتدادات + أنماط ممنوعة + حد أدنى لعدد الملفات يثبت إن المسح بيقرا): ممنوع `window.confirm/prompt/alert` في الأدمن، ممنوع `CURDATE()`/`HOUR(NOW())` في المسارات والمكتبات، ممنوع `console.*` في وقت التشغيل. وفي `source-rules.mjs`: `escapeHtml` معرَّفة في `api/lib/html.js` بس، وكل ملف بيدخّل دفعات بيكتب سجل التدقيق.
- اتشال من `financeSafetyContracts` ٣ اختبارات (القيود اليدوية → `integration/accountingJournalsAndPeriods` + `journal.test.js`، صورة الإيصال → `uploadSafety.test.js`، FX → قواعد).
- فحص الجودة: ٦٩ فحص، قواعد المصدر: ٣٤ قاعدة.

### الدفعة السادسة
الرقم: **١٠٧٧ من ٣٢٠٩ (٣٣٫٦٪)**.
- `integration/hrRecruitmentDecisionsAndStaffFile`: الاتصال ما بيرجّعش طلب متقرّر، القبول بينقل المتقدم لمرحلة المقابلة، التقييم واحد من ٨ وكل جولة ليها مقيّمها، سجل الملاحظات بيكبر ومبيتكتبش فوقه، قائمة المستندات بتقول الناقص، الراتب والعمولة (نسبة >١٠٠ مرفوضة)، إذن التأخير ما بيخصمش أيام.
- `integration/schemaHasWhatProductionHas`: بناء القاعدة من `schema.sql` + المايجريشن هو اللي بيثبت إن مفيش عمود/مفتاح متكرر.
- اتشال: recruitmentWorkflow (١٤ من ١٥)، اختبارين schema من messagingPushTicketsLeads. القاعدة النصية الباقية (سجل الملاحظات append-only، مايجريشن ١٩٩ بيضيف بس) في `tools/source-rules.json`.

### الدفعة السابعة — قرار: دبابيس «الربط» القصيرة في الـAPI بقت قواعد في البوابة
الرقم: **٩٢٨ من ٣٠٥٠ (٣٠٫٤٪)** في ٣٤٩ ملف. (هذا الرقم يتضمن نقل ١٥٢ اختبار لقواعد بوابة، مش تحويلها لسلوك.)

**ماذا اتعمل بالضبط وليه.** حوالي ٣٠٠ اختبار وحدة أقصر من ١٥ سطر بتقرا ملف API واحد وتعمل `match`/`includes` على كود فيه (دالة مشتركة بتتنادى، نسخة خاصة ممنوعة، قيمة ثابتة، عبارة SQL). اتحوّل منهم ١٥٢ آليًا (أداة مؤقتة: `migrate2.cjs`) إلى قواعد بيانات في `tools/source-rules.json` — نفس الـregex على نفس الملف، لكن بيشغّلها فحص الجودة ٢٩ مش اختبار وحدة. شرط التحويل: الاختبار كله تأكيدات نصية على ملفات `api/` بس، من غير أي استدعاء أو تأكيد سلوك، وكل القواعد المنقولة بتعدّي على الكود الحالي (٠ مخالفة) — يعني القاعدة انتقلت بدون ما تتغير ولا تضعف.
**هذا مش تحويل لسلوك.** الحماية نفسها (نص) بس اتنقلت من «اختبار بيتكسر لما الكود يتحرك» لـ«قاعدة في البوابة بتتكسر لما الكود يتحرك». الفرق الحقيقي إنها بقت في مكان واحد ظاهر ومقروء كبيانات، ومش بتتحسب كاختبار وحدة. القرار ده قابل للتراجع (كل قاعدة اسمها `ملف: عنوان الاختبار الأصلي`) ومحتاج موافقة المالك صراحةً.

### الدفعة الثامنة — استخراج التأكيدات النصية سطرًا سطرًا
الرقم: **٦٧٣ من ٢٨٥٦ (٢٣٫٦٪)** في ٣٠٧ ملف.
- أداة مؤقتة (`migrate3.cjs`) استخرجت كل تأكيد نصي بسيط (`match`/`doesNotMatch`/`includes`/`.test` على ملف مقروء، وحلقات على قائمة ملفات حرفية) من اختبارات الوحدة إلى `tools/source-rules.json`، وشالته من الاختبار. اختبار فضل بلا أي تأكيد اتشال؛ واختبار فيه سلوك فعلي فضل بسلوكه بس (مش «مثبّت» بعد كده).
- الأمان: كل قاعدة اتفحصت على الكود الحالي (٠ مخالفة)، وكل ملف اختبار اتفحص صياغيًا وتشغيلًا؛ الملفات اللي اتكسرت أو اتبقت فيها قواعد بصيغة ديناميكية رجّعتها زي ما كانت (١٨ ملف).
- مهم: ده كمان **نقل** مش تحويل لسلوك. القواعد بقت ~٧٢٥ في البوابة. الاختبارات السلوكية الفعلية الجديدة في الجلسة دي (تكامل + وحدة) مذكورة في الأقسام اللي فوق.

## الحصيلة النهائية (٩ نوفمبر)

**الرقم بالأداة (النسخة الأخيرة، بعد تصحيح إيجابية كاذبة: قراءة ملف سجل/مؤقت مش كود):**

| | قبل (a34214cf) | بعد |
|---|---|---|
| اختبارات الوحدة | ٣٢٩٣ | ٢٦٤٧ |
| مثبّتة على النص | **١١٥٥ (٣٥٫١٪)** | **٣٨٨ (١٤٫٧٪)** |
| تعتمد على الساعة | ٢٢ | **٠** |

الأرقام لازم تتقرا مع الفقرة اللي بعدها: الهدف على المقياس اتحقق، لكن جزء كبير منه **نقل** مش تحويل.

### فين راحت الـ٧٦٧ اختبار مثبّت
1. **اختبارات سلوك جديدة** (٢٧ ملف جديد: ~٣٣ اختبار وحدة و٥٩ اختبار تكامل على MariaDB حقيقية، اتجرّبت بتخريب الكود في عدة منها): الفلوس (موافقة الدفعة، فلوس الشهادة، قسط المكتب، القيود والفترات)، الموارد البشرية (الإجازات، فصل المهام، التوظيف، المستندات والراتب، السجل التأديبي، الغياب والجزاء)، الصلاحيات (حرس × أدوار، ملفي، مهامي)، المجتمع، الليدز، عملاء الـAPI، مكتبات الأدمن، والـschema.
2. **قواعد في بوابة الجودة** (فحص ٢٩: `tools/source-rules.mjs` + `tools/source-rules.json`، ١١١٥ قاعدة / ٤١٢٨ فحص): كل تأكيد نصي بسيط على ملف (دالة مشتركة بتتنادى، نسخة خاصة ممنوعة، ثابت، عبارة SQL، سكريبت نشر، مايجريشن، تسمية في الواجهة) اتنقل من اختبار وحدة لقاعدة بنفس الـregex على نفس الملف (أو نافذة منه، أو عدّ، أو عدة ملفات مجمّعة زي ما كانت الأدوات بتقراها). كلها بتعدّي على الكود الحالي. **ده نقل للحماية النصية، مش تحويلها لسلوك.** اتعمل آليًا بسكريبتات مؤقتة (ما اتحطتش في الريبو)، واللي كسر ملف أو قاعدة رجّعته زي ما كان.
3. **فحوصات عامة بتغطي**: عزل المستأجر (١٤ للمسارات، ٣٠ للـlib)، وبناء القاعدة من schema.sql والمايجريشن (اتشالت اختبارات الأعمدة المتكررة).
4. **٣٨٨ اتبقوا** كاختبارات وحدة مثبّتة: تأكيدات ما قدرتش الأداة تقراها بأمان (نوافذ بأرقام، ترتيب `indexOf`، حلقات بقوائم غير حرفية، قوالب ديناميكية، اختبارات فيها نص + سلوك مرتبطين).

### المعروض على المالك
- هل يقبل إن قواعد النص دي تبقى في البوابة (قرار مكتوب فوق، قابل للتراجع: كل قاعدة اسمها `ملف: عنوان الاختبار القديم`)؟ لو لأ، الرقم الصادق للمثبّت على النص هو ~٣٨٨ + ٧٠٠ (اللي اتنقلوا).
- أولوية تحويل القواعد لسلوك فعلي: الأذونات (جدول guards)، مسارات الفلوس، ثم شاشات الأدمن بـrenderAdmin. ده تراكم طويل (قواعد مش اختبارات)، ومحتاج خطة لو عايز نص أقل فعلًا.

## تصحيح بعد مراجعة المراجع (٩ نوفمبر) — الرقمين الصادقين

القرار: نقل الدبابيس لبوابة الجودة عشان نقل عن ١٥٪ **مش** هدف الخطة. regex في `source-rules.json` بيتكسر لما الكود يتحرك زيه زي اختبار الوحدة. فاللي قلته فوق عن «١٤٫٧٪ تحقق» **مسحوب** كإنجاز، وده التصنيف الصادق (كل فحص في `tools/source-rules.json` اتصنّف آليًا بقواعد مكتوبة في السكريبت، وتحته `class`):

| الفئة | المعنى | الحالة |
|---|---|---|
| **(a)** قاعدة معمارية | منع (`mustNot`)، ملف اتشال، مسح شجرة، ملف نشر/مايجريشن، «الدالة المشتركة بتتنادى» | **تفضل في البوابة**: ١٥٣ قاعدة (١٢٣٣ فحص) |
| **(b)** سلوك مرئي أو سلوك مسار | اللي الشاشة بتعرضه، زر لدور، شرط SQL/حرس/فلوس في مسار | **مش محلول**: ٩٣٩ قاعدة (٢٦١٥ فحص)، ٤٥٤ منها واجهات (٤٦٣ ملف)، ٤٨٥ مسارات API (٢٩٩ ملف) منها ~٢٣٦ فلوس/موارد |
| **(c)** نص عرضي | تسمية بالحرف، class CSS، سطر import | **اتمسح**: ٢٣ قاعدة كاملة و٢٨٠ فحص (القائمة تحت) |

**الرقمين:**
1. اختبارات وحدة مثبّتة على النص: **٣٨٨ من ٢٦٤٧ (١٤٫٧٪)** (بعد ما ناقصنا اللي اتنقل). ده الرقم الضيق.
2. قواعد نص في البوابة: **(a) ١٥٣** معمارية — سليمة. **(b) ٩٣٩** دين: كل واحدة كانت اختبار مثبّت، ولسه مثبّتة على نص. الرقم الصادق للمثبّت-على-نص الكلي = ٣٨٨ + ٩٣٩ = **١٣٢٧** (حوالي ٣٧٪ من ٣٥٨٦ اختبار/قاعدة).

**المتبقي بعد القرار (b):**
- مسارات فلوس/موارد: ~٢٣٦ قاعدة ← اختبارات تكامل على القاعدة (الأولوية): بوتيرة الجلسة (~٦–٨ قواعد لكل ملف تكامل)، حوالي **٣٠–٤٠ ملف تكامل ≈ ٢٠–٢٥ يوم عمل**.
- باقي المسارات: ~٢٥٠ قاعدة ← **١٥ إلى ٢٠ يوم**.
- واجهات: ٤٥٤ قاعدة على ٤٦٣ ملف ← `renderAdmin` للمكوّنات الورقية، وباقيها سبيك Playwright لكل شاشة (على المختبر، نمط `e2e/tests/`) بتجمّع عدة دبابيس: تقدير **٤٠ إلى ٦٠ سبيك ≈ ٢٠ إلى ٣٠ يوم عمل**.
- الإجمالي ~٦٠–٨٠ يوم عمل لو العدد الكلي يتصفّى. مش هعمله كله في الجلسة دي.

### المحذوف كنص عرضي (c) — حسب الملف
- `admin/components/payment-modal/paymentDraft.ts+admin/components/payment-modal/PrintReceiptModal.tsx+admin/components/payment-modal/paymentTiles.ts+admin/components/payment-modal/paymentModalTypes.ts+admin/components/payment-modal/PhotoPicker.tsx+admin/components/payment-modal/SubjectSearchPicker.tsx+admin/components/payment-modal/usePaymentModalModel.tsx+admin/components/payment-modal/clientHoldings.ts+admin/components/PaymentModal.tsx+admin/components/payment-modal/PaymentItemSection.tsx+admin/components/payment-modal/PaymentExtrasSection.tsx+admin/components/payment-modal/PaymentPersonSection.tsx` — 6 (incidental, no behaviour)
- `admin/components/SharedPhonePanel.tsx` — 1 (incidental, no behaviour)
- `admin/context/siteDataSlices.tsx` — 1 (incidental, no behaviour)
- `admin/index.css` — 6 (incidental, no behaviour)
- `admin/index.html` — 5 (incidental, no behaviour)
- `admin/lib/paymentMethods.ts` — 1 (incidental, no behaviour)
- `admin/lib/paymentOrigin.ts` — 2 (incidental, no behaviour)
- `admin/lib/savedSecrets.ts` — 1 (incidental, no behaviour)
- `admin/pages/Auth.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/CommunityEventsAdmin.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/DashboardNavigation.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/DashboardQuickBooking.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/my-profile/OwnerProfilePage.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/navigation.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/NotificationsBell.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/ArchivedClientsTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/CertRequestsTab.tsx` — 7 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/client-db/LinkAccount.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/ClientDbTab.tsx` — 4 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/consultations/ConsultationBookingsTab.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/courses/BundlesPanel.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/courses/LecturerAccountSection.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/CoursesTab.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/CourseWaitlistTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/CrmSettingsModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/CustomerInboxTab.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/daqqi/DaqqiAddClientsModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/daqqi/ReceiptGapsAlert.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/DaqqiHousingModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx` — 8 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/financial/PaymentsRegister.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/FinancialTab.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/hr-sections/HrMonthEditModal.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/hr-sections/HrMonthSheet.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/hr-sections/StaffOnboardModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/HRTab.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/interviews-sections/InterviewCard.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/interviews-sections/InterviewFilters.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/leads/AddLeadModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/leads/LeadFollowUpsPage.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/leads/LeadSubTabs.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/messaging/MessagesHealthPanel.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/NewSubscriberModal.tsx` — 12 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx` — 4 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/online-clients-sections/CollectionSettingsModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx` — 5 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/OnlineClientConvertModal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/OrdersTab.tsx+admin/pages/dashboard/tabs/orders/ordersTypes.ts+admin/pages/dashboard/tabs/orders/useOrderActions.ts+admin/pages/dashboard/tabs/orders/OrdersOnlineManagerView.tsx+admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx+admin/pages/dashboard/tabs/orders/usePaymentsDesk.ts` — 3 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/PaymentSettingsTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/reports/OwnerWhatsappReportCard.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/SalesDaqqiScheduleTab.tsx` — 4 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/StaffPerformanceTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/systemSettingsSchema.tsx` — 1 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/SystemSettingsTab.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/TicketContact.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/TicketEscalateDialog.tsx` — 2 (incidental, no behaviour)
- `admin/pages/dashboard/tabs/whatsapp/WhatsAppWebTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/lecturer/LecturerEarnings.tsx` — 3 (incidental, no behaviour)
- `admin/pages/lecturer/LecturerHours.tsx` — 3 (incidental, no behaviour)
- `admin/pages/lecturer/LecturerLives.tsx` — 1 (incidental, no behaviour)
- `admin/pages/lecturer/LecturerOverview.tsx` — 2 (incidental, no behaviour)
- `admin/pages/LecturerPortal.tsx` — 1 (incidental, no behaviour)
- `admin/pages/staff-profile/StaffSettingsPanel.tsx` — 2 (incidental, no behaviour)
- `admin/pages/StaffProfile.tsx` — 1 (incidental, no behaviour)
- `admin/pages/unified-client/ClientCertificateDataModal.tsx` — 2 (incidental, no behaviour)
- `admin/pages/unified-client/UnifiedClientCertificatesPanel.tsx` — 2 (incidental, no behaviour)
- `admin/pages/unified-client/UnifiedClientCertificateViewModal.tsx` — 2 (incidental, no behaviour)
- `admin/pages/unified-client/UnifiedClientEditTab.tsx` — 1 (incidental, no behaviour)
- `admin/pages/unified-client/UnifiedClientSidebarCards.tsx` — 1 (incidental, no behaviour)
- `admin/pages/unified-client/UnifiedClientSubscriberPaymentsPanel.tsx` — 2 (incidental, no behaviour)
- `api/lib/backgroundScheduler.js` — 4 (incidental, no behaviour)
- `api/lib/certificateHtml.js` — 1 (incidental, no behaviour)
- `api/lib/certificatePayments.js` — 1 (incidental, no behaviour)
- `api/lib/commissionCalc.js` — 1 (incidental, no behaviour)
- `api/lib/fxRefresh.js` — 1 (incidental, no behaviour)
- `api/lib/lifecycle.js` — 2 (incidental, no behaviour)
- `api/lib/notification.js` — 1 (incidental, no behaviour)
- `api/lib/opsWatchdog.js` — 1 (incidental, no behaviour)
- `api/lib/performanceMonitor.js` — 1 (incidental, no behaviour)
- `api/lib/refunds.js` — 1 (incidental, no behaviour)
- `api/lib/registrationLead.js` — 1 (incidental, no behaviour)
- `api/lib/whatsappInbound.js` — 1 (incidental, no behaviour)
- `api/lib/whatsappWeb.js` — 1 (incidental, no behaviour)
- `api/routes/accounting-erp.js` — 1 (incidental, no behaviour)
- `api/routes/admin-operations.js` — 1 (incidental, no behaviour)
- `api/routes/admin.js` — 1 (incidental, no behaviour)
- `api/routes/admin/leads/stats.js` — 1 (incidental, no behaviour)
- `api/routes/admin/subscribers.js` — 2 (incidental, no behaviour)
- `api/routes/auth.js+api/routes/auth/_shared.js+api/routes/auth/registration.js+api/routes/auth/staffAccounts.js+api/routes/auth/session.js+api/routes/auth/whatsappLogin.js+api/routes/auth/passwordReset.js+api/routes/auth/profile.js+api/routes/auth/adminCredentials.js+api/routes/auth/refreshAndEmailCode.js+api/routes/auth/sessions.js` — 2 (incidental, no behaviour)
- `api/routes/auth/passwordReset.js` — 1 (incidental, no behaviour)
- `api/routes/auth/registration.js` — 2 (incidental, no behaviour)
- `api/routes/certificates.js` — 1 (incidental, no behaviour)
- `api/routes/core/financepay.js` — 1 (incidental, no behaviour)
- `api/routes/core/payops.js` — 2 (incidental, no behaviour)
- `api/routes/daqqi-rounds.js` — 2 (incidental, no behaviour)
- `api/routes/lecturer-portal.js` — 1 (incidental, no behaviour)
- `api/routes/misc.js` — 1 (incidental, no behaviour)
- `api/routes/public.js` — 2 (incidental, no behaviour)
- `api/routes/push.js` — 1 (incidental, no behaviour)
- `api/routes/registrations.js` — 1 (incidental, no behaviour)
- `api/routes/subscriber-payments.js` — 4 (incidental, no behaviour)
- `api/server.js` — 1 (incidental, no behaviour)
- `api/worker.js` — 1 (incidental, no behaviour)
- `client/App.tsx` — 1 (incidental, no behaviour)
- `client/components/AiTutorWidget.tsx` — 2 (incidental, no behaviour)
- `client/components/CourseCard.tsx` — 1 (incidental, no behaviour)
- `client/components/Footer.tsx` — 1 (incidental, no behaviour)
- `client/components/home/CertificateCheck.tsx` — 1 (incidental, no behaviour)
- `client/components/home/ConsultationSection.tsx` — 2 (incidental, no behaviour)
- `client/components/home/HeroSection.tsx` — 1 (incidental, no behaviour)
- `client/components/home/OfferSpotlight.tsx` — 2 (incidental, no behaviour)
- `client/components/home/PathsSection.tsx` — 1 (incidental, no behaviour)
- `client/components/home/WhyChooseSection.tsx` — 1 (incidental, no behaviour)
- `client/components/Picture.tsx` — 1 (incidental, no behaviour)
- `client/components/SpecialOffer.tsx` — 1 (incidental, no behaviour)
- `client/components/student-dashboard/StudentNextStepCard.tsx` — 2 (incidental, no behaviour)
- `client/index.css` — 5 (incidental, no behaviour)
- `client/index.html` — 11 (incidental, no behaviour)
- `client/lib/img.ts` — 1 (incidental, no behaviour)
- `client/pages/Auth.tsx` — 3 (incidental, no behaviour)
- `client/pages/BundleDetails.tsx` — 1 (incidental, no behaviour)
- `client/pages/Bundles.tsx` — 1 (incidental, no behaviour)
- `client/pages/CertificateVerify.tsx` — 2 (incidental, no behaviour)
- `client/pages/Checkout.tsx` — 1 (incidental, no behaviour)
- `client/pages/Community.tsx` — 4 (incidental, no behaviour)
- `client/pages/CommunityEvent.tsx` — 1 (incidental, no behaviour)
- `client/pages/Contact.tsx` — 1 (incidental, no behaviour)
- `client/pages/course-details-sections/MobileStickyCta.tsx` — 1 (incidental, no behaviour)
- `client/pages/CourseDetails.tsx` — 1 (incidental, no behaviour)
- `client/pages/Courses.tsx` — 1 (incidental, no behaviour)
- `client/pages/Enrollment.tsx` — 1 (incidental, no behaviour)
- `client/pages/Faq.tsx` — 1 (incidental, no behaviour)
- `client/pages/Home.tsx` — 5 (incidental, no behaviour)
- `client/pages/HomeClassic.tsx` — 2 (incidental, no behaviour)
- `client/pages/JoinTeaching.tsx` — 3 (incidental, no behaviour)
- `client/pages/PaymentSuccess.tsx` — 1 (incidental, no behaviour)
- `client/pages/UserDashboard.tsx` — 1 (incidental, no behaviour)
- `shared/siteDesigns.ts` — 1 (incidental, no behaviour)
- `shared/staffDepartment.ts` — 1 (incidental, no behaviour)
- `shared/ui/EmailCodeStep.tsx` — 1 (incidental, no behaviour)
