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

### بعد التصنيف: أول دفعة (b) فلوس/موارد
- `integration/hrSeparationOfDuties` زاد عليه: هيكل الراتب (لا لنفسك، مش في الماضي، لازم يبدأ بعد المعتمد، SALARY_SOD، يتراجع مرة واحدة) وأجر المدرّب (HR_SELF_MUTATION، مجموع موجب، PAYROLL_SETTLEMENT_REQUIRED للدفع، INSTRUCTOR_FEE_SOD، ما بيتحولش من معتمد لمرفوض).
- قواعد (b) اتشالت لأن اختبار سلوك موجود بيغطيها (مسمّى): `hrWorkflowIntegrity: payroll and sensitive HR adjustments…` ← `hrSeparationOfDuties` + `hrLeaveWorkflow` + `payrollRun`؛ `payrollIntegrity` (قاعدتين) ← `payrollRun` («no paying before approval…»، «paying posts one balanced entry…»، «recalculating rebuilds the same run…»، «a branch run cannot overlap…»)؛ `courseRetake` (قاعدتين) ← `integration/courseRetake`؛ `clientItemMoneyHasOneHome: the SQL that read a JSON path` ← `integration/clientItemMoney`.
- الرقمين دلوقتي: اختبارات وحدة مثبّتة **٣٨٨ (١٤٫٧٪)**؛ قواعد نص في البوابة **(a) ١٥٣ معمارية، (b) ٩٣٣ دين غير محلول**. الإجمالي الصادق للمثبّت-على-نص: ٣٨٨ + ٩٣٣ = **١٣٢١**.

### دفعة (b)-١: سعر الدفعة وما بتفتحه — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٢٤** (كان ٩٣٣)
\`integration/paymentPriceAndAccess\` (٦ اختبارات، اتجرّب بتخريب شرط PRICE_CHANGED فاتكسر): سعر الكتالوج لما مفيش سعر، دفعة جزء بتفتح جزء، سعر العميل بيكسب ورقم الشاشة القديمة مرفوض (٤٠٩ PRICE_CHANGED)، المالك بيغيّره قصدًا فبيبقى سعر العميل، اللي مالوش صلاحية ما يغيّرش، القسط بيسجّل سعر العميل مش مبلغه، الكرنيه/الكتاب مش فلوس الكورس ومش بيفتحوه، واعتماد حجز معلّق بيقيسه بنفس الطريقة. اتشالت ٩ قواعد (b): aCarnetIsNotTheCoursesMoney (الـAPI)، aClientPriceIsTheManagersToSet (الـAPI)، aDepositOpensTheFirstPaymentOnly (٢)، paymentExpectedAmount (٥).

### دفعة (b)-٢: مراجعة الدفعات والإيصالات — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٢٣**
\`integration/paymentReviewAndReceipts\` (٥ اختبارات): الكولكشن ما بيعتمدش ولا حد بيعتمد دفعة سجّلها، دفعة سجّلها الكولكشن غير الكاش بتتطلب تحويل، الرفض بسبب والموظف اللي استلم الفلوس بيتبلّغ برسالة، إيصال فرع الدقي بياخد الرقم التالي من غير فجوة وأونلاين من غير رقم ومسح إيصال مرقّم بيبلّغ المديرين، وفهرسا التحويل (دفعة واحدة، مرجع واحد). اتشالت قاعدة (b): staffAccountsReview (اعتماد الفلوس).

### دفعة (b)-٣: المدفوعات الدائنة، مطابقة البنك، إقفال الفترة — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٢٠**
\`integration/accountsPayable\` (فاتورة مورد مسودة لا يعتمدها كاتبها، القيد المحاسبي عند الاعتماد، الإلغاء للمسودة فقط وبسبب، رقم فاتورة المورد فريد، الدفع يحتاج معتمدة وشخص ثالث، لا يزيد عن الرصيد، مرجع الدفع مرة، تتحول لمدفوعة جزئيًا ثم مدفوعة؛ اتجرّب بتخريب AP_PAYMENT_SOD فانكسر) و\`integration/bankReconciliationAndPeriodClose\` (المطابقة لا تُعتمد إلا عند فرق صفر وبغير صاحبها، البنود تحرّك الفرق، الإقفال بطلب معتمد فقط وبغير الطالب والمعتمد، والطلب بيتصرف). اتشالت قواعد (b): financeOperations (AP، المطابقة والإقفال)، accountingTenantScope (الفترات واللقطات).

### دفعة (b)-٤: العمولة والاسترداد — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩١٧** (والمعمارية (a) ١٥٢)
اتشالت أربع قواعد (b) لأن اختبارات موجودة بتغطيها: \`commissionDurability\` (الوظيفة بتشغّل قاعدة التعويض الواحدة / «مفيش حاجة تتدفع» نتيجة مش فشل) ← \`integration/paymobCompensation\`؛ \`adminRowShapeAndMoney\` (الاسترداد بيلغي أجر المدرّب مع العمولة) ← \`integration/partialRefundCompensation\`؛ و«اعتماد الدفعة بيدفع نفس العمولة» ← تأكيد جديد في \`integration/manualPaymentApproval\` (اعتماد دفعة ١٠٠٠ بيعمل عمولة ١٠٠ للمندوب).

### دفعة (b)-٥: مكتب شهادات المعهد — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩١٣** (والمعمارية (a) ١٥٢)
\`integration/instituteCertificatesDesk\` (٤ اختبارات): إضافة شهادة (لازم عميل وكورس/مسار، ٩٠٪ مدفوع أو PAYMENT_SHORT، force يعدّيها، الطلب التاني بيفتح نفس الشهادة)، الطباعة بتسجّل من ومتى وتنقل READY إلى PRINTED وبتعدّ، مراحل التسليم المعروفة بس، مقاسات النموذج بالسم داخل الورقة وبترجع بعد الحفظ، والشهادة الغلط بتتلغى الأول وبعدين تتحذف حذف ناعم وتختفي من القائمة ومتتطبعش. اتشالت ٤ قواعد (b): «إضافة شهادة»، «النموذج» (مقاساته)، «شهادة غلط تتحذف حذف ناعم» (جزء lms)، «النسخة المطبوعة بتتحرك في المكتب».

### دفعة (b)-٦: ملف الموظف واستيراد الحضور — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩١٠** (والمعمارية (a) ١٥٢)
\`integration/hrEmployeeFileAndImport\` (٤ اختبارات): لا أحد يعدّل تعويضه بنفسه (HR_SELF_MUTATION)، التعطيل بالإنهاء فقط (USE_OFFBOARDING_WORKFLOW)، نسبة عمولة فوق ١٠٠ ومبلغ سالب وإيميل غلط مرفوضين، شبكة الصلاحيات ونطاق البيانات للمدير الأعلى بس ومرفوضة بصوت عالٍ لـHR (PERMISSIONS_REQUIRE_SUPERADMIN) ومصفوفة فاضية بتتخزن «ولا واحدة»، تغيير الإيميل بيحرّك حساب الدخول ويبطل الجلسات القديمة ويكتب حدث تدقيق، واستيراد CSV بيكتب أيام العمل بس ومش يوم إجازة معتمدة ولا تاريخ برا الشهر ولا وقت غلط. اتشالت ٣ قواعد (b): hrWorkflowIntegrity (حضور الإجازة المعتمدة / هوية الموظف / السلف ← مع hrSeparationOfDuties وpayrollRun).

### دفعة (b)-٧: موافقة التسويق وصندوق الرسائل — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٠٨** (والمعمارية (a) ١٥٢)
`integration/consentAndOutbox` (٤ اختبارات): إلغاء الاشتراك بيمنع الإيميل (بأي حالة حروف) والرقم (بأي كتابة) وبيتسجّل في التدقيق وإعادة الاشتراك بترفعه ومعهد تاني مش بيتأثر وجهة اتصال معهد تاني «غير موجودة»؛ الرسالة بتتحط مرة واحدة لكل مفتاح تكرار في كل معهد؛ سحبتين متزامنتين بيبعتوا كل رسالة مرة واحدة، الفشل بيتعاد بعدين، آخر محاولة أو رفض نهائي (`category_disabled`) بيدفنها، والعامل اللي مطالبته اتنقلت مش بيعلّمها مبعوتة. اتشالت ٢ قاعدة (b): «consent changes lock…» و«message outbox claims…» (قاعدتا الحملات وSSRF للـwebhooks فضلتا). **خطأ حقيقي طلع من الاختبار** (commit منفصل e0b591f7): `enqueue` بمفتاح تكرار موجود كان بيرجّع id مش موجود في الجدول لأن السواق بيحسب الصفوف المطابقة مش المتغيّرة.

### دفعة (b)-٨: ردّ Paymob الموقَّع — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٠٢** (والمعمارية (a) ١٥٢)
`integration/paymobCallbackGuards` (٣ اختبارات، عبر التطبيق الحقيقي والتوقيع الحقيقي): المعاملة المرفوضة والمبلغ الأقل من الطلب والعملة المختلفة ما بيدفعوش الطلب ولا بيفتحوا كورس (والطلب يفضل pending)، وبعدها الردّ الصحيح بيدفعه ويفتح الكورس؛ المسار بيفتح كورسات قاعدة البيانات بس مش اللي حطّها المتصفح في الطلب؛ والطلب المدفوع مش بيرجع pending بإعادة الحجز (ORDER_ALREADY_PAID) والردّ المتكرر بيدفع مرة واحدة. (تم فحص الحارس بتعطيل مقارنة المبلغ ففشل الاختبار.) مع `publicHttpAndPaymob` (التوقيع المزوَّر/المعدَّل، السعر من الكتالوج PRICE_MISMATCH) اتشالت ٦ قواعد (b) من paymentIntegrity؛ فضلت قاعدة (a) «الوصول من قاعدة البيانات» المعمارية.

### دفعة (b)-٩: المصروفات والمصروفات المتكررة — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٠٢ قاعدة** (والمعمارية (a) ١٥٢) — لكن اتشال ١٤ شرط من داخل ٣ قواعد
`integration/expenseAndRecurringLifecycle` (٣ اختبارات): المصروف لازم خزنة ومبلغ موجب وتاريخ وعملة معروفة (EXPENSE_BOX_REQUIRED) والحساب اللي معاه view_financial بس بيقرا ومبيكتبش (403)؛ الإنشاء والتعديل والنقل لفرع تاني والحذف بتسيب الدفاتر زي ما المصروف واقف دلوقتي (التعديل بيعكس القيد القديم ويرحّل الجديد — اتفحص بتعطيل العكس ففشل)، النقل لفرع تاني بياخد رقمه، الحذف ناعم ويخرجه من القائمة ومن تقرير الـVAT ومن التدفق النقدي، وتقريرا التدفق النقدي والـVAT بيقروا من القيود؛ والمصروف المتكرر بيتحقق منه (عنوان، مبلغ، تكرار، يوم ١–٢٨، فئة) ويحفظ فرعه ويتسجل في التدقيق (create/delete) ويتحذف حذف ناعم. القواعد مفيهاش شرط بيتشال كله لأن فيها جزء الواجهة وجزء الـcron (setInterval ما ينفعش يتجرّب بدون ساعة) فبقيوا: اتشالت شروط الـAPI المغطاة بس (financeSafetyContracts: recurring expenses ٤ شروط، financial statements ٣، expense UI ٧) وفضلت شروط الواجهة والـcron و`financialRecordMatches`. أداة جديدة في عدّتي: dropchecks (بتشيل شروط مغطاة من قاعدة مختلطة بدل ما تشيل القاعدة كلها).

### دفعة (b)-١٠: إنهاء الخدمة وتعطيل الحساب — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٩٠٠** (والمعمارية (a) ١٥٢)
`integration/offboardingChecklistAndAccess` (٣ اختبارات) + `offboarding` الموجود: البدء مرة واحدة للموظف ومش من الموظف لنفسه وسبب غير معروف بيبقى «استقالة» ويتسجّل `hr.offboarding.started`؛ الإغلاق مرفوض لو القائمة ناقصة أو فاضية أو من الموظف نفسه أو من غير بديل لشغله المفتوح أو ببديل بدور تاني (SUCCESSOR_ROLE_MISMATCH) أو غير موجود، **وكل رفض مش بيغيّر حاجة** (الموظف نشط والعميل المحتمل لسه عليه والطلب in_progress)؛ الإغلاق بيطفّي صف الموظف (مع تاريخ الإنهاء) وحساب الدخول (وبيرفع session_version ويمسح الجلسات) وملف المعالج (مش في الموقع ولا الاستشارات) وبينقل الشغل ويكتب `hr.offboarding.completed`، **وأول طلب بنفس التوكن بعدها مرفوض 401 ACCOUNT_UNAVAILABLE** (توكن حقيقي وـrequireAuth حقيقي)، والطلب المقفول مبيتعدّلش تاني. (اتفحص بتعطيل إطفاء حساب الدخول ففشل.) اتشالت قاعدتا (b): «offboarding is atomic…» و«disabled users are rejected…».

### دفعة (b)-١١: مصدر الراتب والإجازة بدون راتب وأجور المحاضرين — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٨** (والمعمارية (a) ١٥٢)
`integration/payrollSalarySourceLeaveAndFees` (٦ اختبارات، مع `payrollRun` الموجود): موظف بلا راتب معتمد يوقّف الشهر بالاسم (PAYROLL_SALARY_MISSING) وهيكل منتهي مش راتب، و«تخطّي من بلا راتب» بيحسب الباقي ويرجّع الأسماء المتخطّاة؛ الهيكل المعلَّق مش بيتحسب وأحدث هيكل معتمد هو اللي يكسب؛ الإجازة بدون راتب بتخصم يوم الراتب (÷٣٠) والسنوية ما بتخصمش؛ أجر المحاضر المعتمد بس هو اللي يدخل الكشف ويتمسك بالتشغيلة ويرجع معتمد لو التشغيلة اتلغت ويبقى «مدفوع» مع دفع التشغيلة بس (اعتماد التشغيلة لوحده ما يدفعوش)؛ تعديل أجر المحاضر بيتقدّم مرة واحدة، مش من المحاضر نفسه، ويراجعه غير مقدّمه، ولا يُطبَّق إلا بعد الموافقة (RATE_CHANGE_PENDING / RATE_SOD)؛ وأجر المحاضر مش بيتعلّم مدفوع باليد (PAYROLL_SETTLEMENT_REQUIRED) ولا يتوافق عليه صاحبه (INSTRUCTOR_FEE_SOD) ولا يتحذف غير المعلَّق (INSTRUCTOR_FEE_IMMUTABLE). (اتفحصت بتعطيل «معتمد فقط» و«بدون راتب فقط» وحارسي RATE_SOD وIMMUTABLE ففشلت الاختبارات.) اتشالت قاعدتا (b) كاملتين: «compensation changes are approval-owned» و«unpaid leave affects payroll…»، وشرط TARGET من قاعدة الكشف (مغطّى بـ`payrollCalc.test`). ملحوظة: الاستقلال بين من قدّم ومن راجع بيشتغل على هوية الموظف (staffRecord)، فمالك المعهد بلا صف موظف مش مقيّد بيه — ده تصميم قائم مش تغيير.

### دفعة (b)-١٢: رفض الدفع على طريق الطلبات ومفيش مكافأة آلية — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٨ قاعدة** (والمعمارية (a) ١٥٢) — واتشال ١٠ شروط من قاعدتين
`integration/orderRejectionRoad` (اختباران): رفض دفعة طلب بيطلب سببًا (REJECT_REASON_REQUIRED ومفيش تغيير بدونه) ومن سجّلها بيتبلّغ بالسبب في رسالة (مش اللي رفض)؛ «مدفوع» و«مسترد» مش بيتحطوا من الطريق ده، والطلب اللي ليه دفعة أو مدفوع مبيتغيّرش منه، وطلب مش موجود 404، وبدون manage_orders 403 (اتفحص بتعطيل شرط السبب ففشل). مع `paymentReviewAndReceipts` (طريق الدفعة) و`checkoutAndProofs` (طريق الإيصال) اتشالت ٨ شروط من «rejectedPaymentSaysWhy: all three roads» وفضل شرط واحد: إن إشعار الإيصال بـ`kind: 'payment_proof'` (الإيصال مش بيتفحص إشعاره). وفي `manualPaymentApproval` اتحطّت مكافأتا حجز على الكورس فاتأكّدنا إن الاعتماد بيدفع عمولة المندوب ١٠٪ بس ومفيش مكافأة بتتكتب آليًا (اتفحص بقلب `AUTOMATIC_BONUSES` فاتكسر الاختبار)، فاتشال شرطا `AUTOMATIC_BONUSES` من «fixesOf4Nov». عدد القواعد زي ما هو لأن القاعدتين فيهم شروط تانية.

### دفعة (b)-١٣: قائمة الاستردادات والتصعيد واللوم — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٦** (والمعمارية (a) ١٥٢)
`integration/refundListEscalateAndBlame` (٣ اختبارات، مع `refundBehaviour` و`refundDesk` الموجودين للقرار والاسترداد الجزئي والكامل): القائمة بتسمّي الكورس أو المسار (من دفعة الطلب أو من `course_item`) وبتحسب «المدفوع فعلًا» (مدفوع وغير محذوف وغير معلّق) وبتقول إن فيه تاريخ تذكرة من غير ما تبعته، وآخر تواصل وعدّاده؛ محاسب الفرع بيشوف فرعه بس وخدمة العملاء بتقرا بـmanage_inbox وغيرهم 403؛ التصعيد بيضيف ملاحظة ومن صعّد وبيبلّغ الإدارة؛ لوم زميل متعمّد (موظف مش موجود 404 والفاضي بيمسح)؛ والحذف أرشفة بتخرج من القائمة وتفضل في الجدول. **خطأ حقيقي طلع من الاختبار** (commit منفصل): `last_contact` كان دايمًا null في قائمة الاستردادات لأن الراوت بيعمل `JSON.parse` على كائن رجعته MariaDB جاهز؛ اتصلّح بـ`tryJson` (اللي بيقبل الشكلين). اتشالت ٢ قاعدة (b): «refunds list says a history exists…» و«a refunded payment is never counted…» (مغطّاة بـrefundBehaviour).

### دفعة (b)-١٤: طلبات الشهادات — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٦ قاعدة** (والمعمارية (a) ١٥٢) — واتشال ١١ شرط من قاعدتين
`integration/certificateRequestLifecycle` (٣ اختبارات، مع `certificateEligibility` و`certificateMoneyIsNotCourseMoney` و`certificateDataByTheDesk`): الطلب بيتعمل لعميل معاه الكورس كامل وخلّصه (اتنين مرفوضين: مش مسجّل، نوع/سعر غلط)، مرة واحدة لكل نوع (الطلب التاني بيشاور على المفتوح)، مسعّر أو «في انتظار سعر»؛ بيتنقل لمراحل التسليم (SHIPPED/DELIVERED) لما يتدفع كامل بس (CERTIFICATE_NOT_PAID)، بخطوات مسموحة (مفيش رجوع من PRICED لـPENDING)، ومش بعد ما الكورس اتشال (استرداد) ويتسجّل في تاريخ العميل، وسعره ثابت بعد الدفع؛ تفاصيله للمديرين (MANAGERS_ONLY)، والمدفوع المربوط بدفعة مبيتكتبش فوقه، والمدفوعة مبتتمسحش من غير force من المالك (CERT_PAID_FORCE_REQUIRED) والدفعة بتفضل في الحسابات ويتكتب `force_delete` في التدقيق (اتفحص بتعطيل شرطَي «مدفوع كامل» و«force»). اتشالت شروط الـAPI من «certificate lifecycle and receipt rendering fail closed» (٥) و«certificates: paid before the system…» (٦) وفضلت شروط الواجهة والـescapeHtml.

### دفعة (b)-١٥: أول مواصفة شاشة (Playwright) — نافذة «تسجيل دفعة» — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٦ قاعدة** (والمعمارية (a) ١٥٢) — واتشال ٣ شروط
**كل اختبارات التكامل كاملة اتشغّلت** (٦٢٦ اختبار: ٦٢٣ نجح، ٠ فشل، ٣ متخطّاة بدون DB). وتم تشغيل بيئة المتصفح على المعمل: قاعدة `mahad_e2e_local` (migrate + `e2e-seed.cjs`)، الـAPI على ٣١٠٥، والـadmin المبني على `vite preview` (٤٠٠١ لأن ٤٠٠٠ مشغولة)؛ وكل شاشات اللوحة الـ٧٣ في `dashboard-screens.spec` اتفتحت وقرت.
`e2e/tests/payment-dialog.spec.ts` (اختباران، المتصفح الحقيقي + الـAPI الحقيقي): الزر بيفضل مقفول والسيرفر ما بيتندهش لحد ما يتحدد الكورس والفرع والاسم الثلاثي وتأكيد التليفون والخزنة؛ اختيار الكورس والفرع بيعرض سعر قايمة الفرع (٢٬٤٠٠) والطلب بيشيل نفس السعر كسعر الكورس؛ دفعة جزئية بتتسجل مرة واحدة بالمبلغ المكتوب ويتبعت رقم العملية كرقم المعاملة وبيظهر في صفحة العميل «رقم العملية: #…»؛ والقسط بيدفع «كل المتبقي» ومبيبعتش السعر المتفق عليه تاني. اتفحصت بتغيير الكود المبني ٣ مرات (سعر الحجز +١، سعر القسط، رقم العملية) واتكسر الاختبار في كل مرة. **درس**: أول محاولة تعديل القسط في `dashboardPaymentHandlers`/`extraPaymentEntries` ما كسّرتش الاختبار لأن صفحة العميل ليها مسارها الخاص (`useUnifiedClientPayments`) — ثلاث نسخ لنفس القاعدة؛ فالمواصفة غطّت نسخة صفحة العميل بس. اتشالت ٣ شروط (إرسال `transactionId`، قائمة المدفوعات بتعرض رقم العملية، النداء على `recordSubscriberPayment`) وفضلت شروط نسختي اللوحة والـ`payment-modal` لحد ما يتغطّوا بمواصفاتهم. أضفت لـ`e2e-seed.cjs` عميلة مخصّصة («عميلة الدفعات») عشان المواصفة ما تلمسش الطالبة اللي بتدخل بيها باقي الرحلات.

### دفعة (b)-١٦: حواجز تسجيل الدفعة اليدوي — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٩٣** (والمعمارية (a) ١٥٢) — وشروط اتشالت من ٧ قواعد تانية
`integration/manualBookingGuards` (٥ اختبارات، مع `manualPaymentApproval` و`paymentReviewAndReceipts`): الفلوس بتتسجل لعميل برقم حقيقي بس (PHONE_REQUIRED ومفيش صف اتكتب)؛ المندوب بيحجز عملاءه ومش عملاء مندوب تاني (SUBSCRIBER_OUT_OF_SCOPE) وخدمة العملاء بتحجز أي عميل؛ عميل جديد برقم عند حد (بأي كتابة: `0101…` و`101…` و`+20 101…` و`0020101…`) بيتردّ ٤٠٩ SUBSCRIBER_EXISTS ويسمّي صاحبه والمسئول عنه، والرقم الجديد بيتخزّن كهوية (١٠ أرقام)؛ مرجع من أصفار أو شرطات أو «لا يوجد» مش مرجع (بيتخزّن فاضي فمفيش تصادم) والمرجع الحقيقي مرة واحدة؛ ودفعة الدقي بترجّع رقم إيصالها وفرعه والأونلاين من غيره، ودفعة شهادة بتحرّك طلبها. اتفحصت بتعطيل حارس الرقم، وbookAny، وتنظيف المرجع ففشلت الاختبارات المناسبة. اتشالت قاعدتا (b) كاملتان («duplicate booking names…» و«a client being registered by the booking…») و«saudiAndInternationalBooking: looks the client up…»، وشروط subscriber-payments من «real phone» و«customer service and the Dokki desk» و«reference of zeros» و«receipts run in sequence» و«payment review and certificate settlement».

### دفعة (b)-١٧: تحويل الليد لعميل والتوزيع الجماعي — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٩** (والمعمارية (a) ١٥٢)
`integration/leadConvertAndAssign` (٥ اختبارات، مع `leadStateAndMerge` و`subscriberConvertToLead`): التحويل بيتم داخل ليدز المتصل بس (مندوب مش بيحوّل ليد غيره)، وحساب التحصيل مش بيحوّل (COLLECTION_BOOKING_REQUIRED — ده حجز بيتراجع)، وكورس مش موجود 400، وليد مخفي أو مش موجود 404، وليد بلا اسم 400 ومفيش حاجة اتعملت من الرفضات؛ التحويل بيعمل عميل واحد مربوط بالليد (من غير إيميل، والهاتف بيتخزّن هوية)، ويعلّم الليد converted وفي التايم لاين، **وميفتحش كورس** (اختيار الكورس نية مش وصول)، والتحويل التاني بيرجّع نفس العميل؛ ورقم موجود عند عميل بكتابة تانية (+20 101…) بيحوّل الليد عليه؛ والتوزيع الجماعي مش للمناديب، ومن غير مناديب مفعّلين ٤٠٠ ومفيش حاجة اتحركت، ومعاهم بيوزّع المفتوح غير المعيّن غير المخفي بس (مش المحوّل ولا الخاسر ولا المخفي ولا المعيّن) بحدث لكل ليد وواحد لكل مندوب؛ ومينفعش ليد يتعلّم converted من غير عميل وراه (409، والعميل المزعوم غير الموجود مش عميل) أيًّا كان المنادي. اتفحصت بتعطيل: شرط التحصيل، `hidden=0`، حارس المناديب، فلتر الحالات المفتوحة، وشرط leadState — فاتكسرت. اتشالت ٤ قواعد/أجزاء (b): «a lead cannot be marked converted…» و«admin conversion uses one server transaction…» (جزء الـAPI) و«lead assignments validate…» (جزء bulk-assign) و«a collection account…COLLECTION_BOOKING_REQUIRED» (جزء الليدز) + شرطان من «lead conversion is tenant-owned».

### دفعة (b)-١٨: الخزائن — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٧** (والمعمارية (a) ١٥٢)
`integration/cashBoxes` (٥ اختبارات على قاعدة حقيقية — كانت الخزائن كلها بلا اختبار تكامل): رصيد الخزنة = اللي دخل باسمها (مهما اتكتب: مسافة زيادة، وكاش بيتقري «خزنة الدقي - كاش») ناقص المردود، وبيطلع «النهارده» و«أمس» بنافذتين منفصلتين، والفرع مبيشوفش أرصدة (balances = null) ولا إلا فلوس عملائه؛ مفيش تغيير للخزنة إلا من الحسابات الرئيسية بـmanage_financial (المشاهد 403، وحساب الفرع BOXES_MAIN_BOOKS_ONLY ومفيش حاجة اتغيّرت)؛ «تعديل الرصيد» و«تصفير» بيبدّوا الخزنة من جديد (اللي يدخل بعدهم بس) وكل تغيير مسجّل في التدقيق والتاريخ؛ السحب (شريك/مصروف/خزنة تانية) بيرفض النوع والمبلغ والشريك والحساب غلط، وأكتر من الرصيد 409 BOX_INSUFFICIENT إلا بتأكيد، وبيسجّل قيد متوازن (٣٣١٠ مدين / ١١٠٠ دائن) إلا التحويل بين خزنتين فمفيش قيد وخزنة بتخسر وخزنة بتكسب، والإلغاء بيرجّع الفلوس ويعكس القيد مرة واحدة (WITHDRAW_VOIDED) والملغي بيتعرض معلّم وخارج إجمالي الشريك؛ والدمج بيجمع الرصيدين وبيقرا الدفع باسم الخزنة القديمة في الجديدة. اتفحصت بتعطيل: حارس الحسابات الرئيسية، حارس الرصيد، وحارس الإلغاء المزدوج. **ملحوظة سلوك (مش تغيير)**: دفعة بتتسجّل في نفس الثانية بعد التصفير بتتعدّ قبله (المقارنة `created_at > baseline` بثانية) — حالة حافة ما غيّرتهاش.

### دفعة (b)-١٩: توكن الدخول والجلسة — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٦** (والمعمارية (a) ١٥٢)
`integration/sessionTokens` (٣ اختبارات): التوكن بيحمل المعهد (tid) ونسخة الجلسة (sv) والجلسة (sid) وهل هو موظف (stf) وmfa ومعرّف للإلغاء (jti)، ومينفعش يتصدر من غير هوية كاملة؛ جلسة الموظف أقصر من العميل، والكوكي HttpOnly وSecure وSameSite=None؛ وبعد تحريك session_version التوكن القديم مرفوض (SESSION_REVOKED) حتى للموظف، والعميل جهاز واحد (جلسة تانية بتبدّل جلسته) والموظف أجهزة متعددة، والحساب المعطّل ACCOUNT_UNAVAILABLE، وتوكن معهد تاني TENANT_MISMATCH، والملغي والمزوَّر 401. اتفحصت بتعطيل: مقارنة sv ومقارنة sid، وعلم HttpOnly، وstf الثابت. اتشالت قاعدة «session cookie is HttpOnly and Secure» كاملة وشروط «sessionRevocation: access tokens carry…» ما عدا تثبيت الـIP (الميزة مقفولة افتراضيًا ومش متغطّية).

### دفعة (b)-٢٠: تفاصيل كشف الرواتب والتعديل اليدوي والعملة الأجنبية — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٣** (والمعمارية (a) ١٥٢)
أضفت ٣ اختبارات لـ`integration/payrollSalarySourceLeaveAndFees`: تفاصيل الكشف بترجّع المكافأة وأجر المحاضر المخزّنين (٢٥٠ و٤٠٠ مش أصفار) والكشف بيسجّل رقم الموظف (st-calc-1) مش رقم الدخول؛ وتعديل خصم بند يدوي بيجيب معاه تقسيم التأمين/الضريبة (٢٠٠/١٠٠ بتبقى ١٠٠/٥٠ لما الخصم ١٥٠) ومش لبند الموظف نفسه (HR_SELF_MUTATION) ولا لكشف معتمد (٤٠٩)؛ وراتب بالريال بلا سعر صرف صالح بيوقف الكشف FX_SNAPSHOT_UNAVAILABLE ومفيش بند اتكتب. اتفحصت بتعطيل: سقف الجزء القانوني، حارس الصرف، قراءة المكافأة، ورقم المنفّذ فاتكسرت الاختبارات. اتشالت ٣ قواعد (b) كاملة («payroll detail exposes…» و«overriding a deduction…» و«payroll refuses a stale exchange rate…») وشرطا payroll من «hrLeavesAndPayroll».

### دفعة (b)-٢١: التعيين من المرشح — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٢** (والمعمارية (a) ١٥٢)
`integration/hrHireAction` (٣ اختبارات، بعد `hrRecruitingWorkflow` و`hrRecruitmentDecisionsAndStaffFile`): التعيين من مرحلة المقابلة أو العرض بس (قبلها 409 OFFER_STAGE_REQUIRED ومفيش حاجة اتحركت)؛ بريد الدخول لازم يكون عنوان صحيح مش مستخدم لموظف (STAFF_EMAIL_EXISTS) وكلمة السر ٨ على الأقل والدور معروف؛ كلمة السر بتعمل حساب دخول وبتفعّل الموظف (والمخزّن هاش) والمرشح بيبقى hired مربوط بصف الموظف ومحسوب في التدقيق، والتعيين التاني 409 Already hired؛ بدون كلمة سر الموظف بيتعمل غير مفعّل وبلا حساب دخول (التفعيل خطوة منفصلة)؛ ودور مدير/أدمن للمالك بس (OWNER_REQUIRED_FOR_PRIVILEGED_ROLE) وكلمة سر مش بتتحط على حساب بيخص شخص تاني (LOGIN_BELONGS_TO_ANOTHER_ACCOUNT وكلمة سره سليمة). اتفحصت بتعطيل الحراس الأربعة فاتكسرت الاختبارات. اتشالت قاعدة «hiring is reachable from the interview stage…» وشرط «note trail is append-only» من الـroute (يغطّيه تتبع الملاحظات في `hrRecruitmentDecisionsAndStaffFile`).

### دفعة (b)-٢٢: شاشة العميل (Playwright) — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٢ قاعدة** (شروط اتشالت من ٣ قواعد) (والمعمارية (a) ١٥٢)
**التكامل الكامل تاني مرة:** ٦٥٢ اختبار، ٦٤٩ نجح، ٠ فشل، ٣ متخطّاة.
`e2e/tests/client-page.spec.ts` (اختباران): «رجوع» من صفحة العميل بيرجّع للشاشة اللي اتفتح منها (قائمة العملاء `my_clients`) مش للوحة الرئيسية؛ وزر «سجّل التواصل» مقفول من غير نتيجة ولا ملاحظة وبيتفتح بنتيجة لوحدها («مردش») فيتبعت طلب واحد بالنتيجة والنوع وملاحظة فاضية، والتواصل بيفضل بعد إعادة تحميل الصفحة وعدّاد «التواصل (n)» بيزيد في الـAPI (يعني على السيرفر مش في المتصفح). اتفحصت بتعديل الكود المبني (الرجوع يروح للوحة، والجاهزية تطلب ملاحظة) فاتكسر الاختباران. اتشالت ٣ شروط: زر الرجوع ×٢ (backGoesBack)، و`ready = notes || outcome`، وعدم تخزين الملاحظات في المتصفح. **ملاحظة تحتاج مراجعة بشرية (مش اتغيّرت)**: بعد حفظ التواصل لسه قسم «آخر تواصل» في رأس الصفحة بيقول «لا يوجد» لحد إعادة التحميل.

### دفعة (b)-٢٣: شاشة طلبات الشهادات (Playwright) + إصلاح ضعف في مواصفاتي — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٠** (والمعمارية (a) ١٥٢)
`e2e/tests/certificate-requests.spec.ts`: طلب اتعمل على السيرفر بيظهر في الشاشة بسعره والمدفوع والمتبقي ومرحلته («في انتظار تأكيد الدفعة») وبيقول «ناقص: الاسم بالإنجليزي…»؛ زر «دفع <السعر>» بيفتح نافذة الدفع على نفس الشهادة بالمتبقي (في صفحة العميل)؛ الدفعة اللي بتتسجّل من نوع شهادة ومربوطة بالطلب (`certId`) وبالمبلغ، وبعدها الطلب مدفوع كامل (paid=السعر، remaining=0، complete) والشاشة ما فيهاش «دفع» ليه وعدّاد «تحت المراجعة» بيزيد. اتفحصت بقطع `certId` من الكود المبني فرجّع السيرفر 400 واتكسر الاختبار. اتشال شرط `listAllCertificateRequests` (القراءة من السيرفر) + ٦ شروط API من قواعد الاستردادات بعد `refundListEscalateAndBlame` (course_title في الاسترداد، مسارات قراءة وتصعيد وقرار الاسترداد).
**ضعف اكتشفته في مواصفاتي السابقة وصلّحته**: `payment-dialog` و`client-page` كانتا بتقرا الـAPI بـ`page.request`، وده بيرجّع ٤٠١ (الكوكي Secure والخادم http فالعميل ده ما بيبعتوش)، وكان الكود بيتخطّى مقارنة «قبل/بعد» بصمت لما القراءة تفشل — يعني التحقق من «دفعة زيادة» و«تواصل زيادة» ما كانش بيشتغل. دلوقتي `e2e/helpers/adminApi.ts` بينادي الـAPI من جوه الصفحة (نفس كوكي الشاشة) والمواصفات بتفشل لو القراءة فشلت.

### دفعة (b)-٢٤: صندوق الأحداث المالية ولوحة المطابقة — الرقمين: وحدة مثبّتة **٣٨٨**، دين (b) **٨٨٠ قاعدة** (شروط اتشالت من قاعدتين) (والمعمارية (a) ١٥٢)
`integration/financeOutboxAndReconciliation` (٤ اختبارات): الحدث بيتحط مرة واحدة لكل معهد ومفتاح (والمعهد التاني بمفتاحه) ومحتاج معهد ونوع؛ `drainFinanceOutbox` بيعالج كل حدث مرة (سحبتين متزامنتين: ٤ أحداث ٤ معالجات)، والفشل بيتعاد بعدين (failed + attempts + next_attempt_at)، والمحاولة السادسة بتدفنه (dead)، وحدث محجوز من عامل مات بيرجع بعد ١٥ دقيقة والمحجوز الجديد بيتساب؛ القائمة والإعادة للحسابات المركزية بس (الفرع ٤٠٣، من غير manage_financial ٤٠٣)، المعهد التاني ٤٠٤، والإعادة لفاشل/ميت بس وبتبدأه من الصفر؛ ولوحة المطابقة بتسمّي دفعة مدفوعة من غير قيد (دفعة المعهد ده بس) وتختفي لما القيد يتعمل، وقيد مش متوازن بيظهر في unbalanced_journal ويختفي لما يتصلّح، والأحداث الفاشلة (للمعهد ده بس)، والحساب بدون view_financial ٤٠٣. اتفحصت بتعطيل: دفن المحاولة السادسة، استرجاع الـ١٥ دقيقة، وتحديد المعهد في الإعادة. اتشالت شروط الـAPI/المكتبة من «finance outbox is tenant scoped…» و٣ شروط من «reconciliation dashboard connects…» (وفضلت شروط المنتجين والـscheduler وفحوص enrollment/CRM/orders).
