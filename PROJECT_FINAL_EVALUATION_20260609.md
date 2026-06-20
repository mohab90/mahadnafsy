# التقييم النهائي لمشروع Mahad - 2026-06-09

## الحكم المختصر

التقييم الحالي بعد إصلاح التشغيل المحلي ودفعة السكيما التشغيلية الأخيرة: **8.6 / 10**.

المشروع يعمل محليا على النسخة المطورة:

- Client: `http://127.0.0.1:3100/`
- Admin: `http://127.0.0.1:4100/`
- API: `http://127.0.0.1:3101/`

آخر فحص جودة كامل نجح بالكامل: audit، API syntax، admin build، client build، smoke، liveness، DB readiness، وAPI route smoke. تم كذلك التحقق من المتصفح الداخلي على صفحة الدقي بعد إصلاح التعذر.

## ما تم تطويره في هذه الدفعة

- فصل lazy dashboard tabs من `admin/pages/Dashboard.tsx` إلى `admin/pages/dashboard/lazyTabs.tsx`.
- فصل تعريفات navigation و`TabKey` من `Dashboard.tsx` إلى `admin/pages/dashboard/navigation.tsx`.
- فصل utilities/config الخاصة بالـ leads من `LeadsTab.tsx` إلى `admin/pages/dashboard/tabs/leadUtils.ts`.
- فصل public order / Paymob suspended routes من `api/routes/core.js` إلى `api/routes/public-orders.js`.
- تسجيل `public-orders` في `api/server.js` قبل `coreRouter`.
- إضافة smoke API route test في `tools/mahad-api-smoke.mjs`.
- ربط smoke API الجديد داخل `tools/mahad-quality-check.ps1`.
- نقل startup/runtime schema tasks من `api/server.js` إلى `api/lib/startupTasks.js` كمرحلة آمنة قبل تحويل SQL بالكامل إلى migrations مرقمة.
- فصل جدول الليدز من `LeadsTab.tsx` إلى `admin/pages/dashboard/tabs/LeadTable.tsx`.
- فصل مشغل فيديو لوحة الطالب من `client/pages/UserDashboard.tsx` إلى `client/components/UserDashboardVideoPlayer.tsx`.
- فصل لوحات التسوية وإقفال الفترات من `FinancialTab.tsx` إلى `admin/pages/dashboard/tabs/FinancialPanels.tsx`.
- فصل seed/default data من `SiteDataContext.tsx` إلى `admin/context/siteDataSeed.ts`.
- إصلاح تعذر تشغيل Admin المحلي على `4100`: جعل proxy الافتراضي يذهب إلى API المحلي `3101`، وجعل Vite base وReact Router basename خاصين بالإنتاج فقط.
- إصلاح سقوط الواجهة بعد تفكيك `siteDataSeed` بإعادة استيراد `seedData` والقيم الافتراضية داخل `SiteDataContext.tsx`.
- إضافة migration مرقمة `api/migrations/003_operational_cleanup.sql` لضمان `leads.retargeting_sent_at`.
- رفع runtime schema إلى v41 لأن قاعدة البيانات المحلية كانت عند v40، والتحقق من وجود عمود وفهرس retargeting فعليا.
- تقوية مزامنة `paymentHistory` إلى `payments` ضد FK failures عبر التحقق من course/bundle ids قبل الإدخال.
- تشغيل فحص جودة كامل على النسخة المحلية المطورة ونجاحه بالكامل.

## نتيجة التحقق

الأمر:

```powershell
tools\mahad-quality-check.ps1 -ClientPort 3100 -AdminPort 4100 -ApiPort 3101
```

النتيجة: **PASS بالكامل**.

- API audit: PASS
- Admin audit: PASS
- Client audit: PASS
- API syntax: PASS، تم فحص 42 ملف JS
- Admin build: PASS
- Client build: PASS
- Client smoke: PASS
- Admin smoke: PASS
- API liveness: PASS
- API DB readiness: PASS
- API route smoke: PASS

تم أيضا اختبار المتصفح الداخلي بعد إعادة تشغيل Admin على `4100`. صفحة `dashboard/daqqi_schedule` رندرت فعليا وظهر جدول كورسات الدقي وعملاء فرع الدقي، بعد إصلاح proxy/base/basename واستيراد seed data.

## حجم المشروع الحالي

مع استبعاد `node_modules`, `dist`, `.vite`, `.local-logs`, و`package-lock.json`:

| القسم | الملفات | السطور |
|---|---:|---:|
| API | 54 | 20,896 |
| Admin | 114 | 56,608 |
| Client | 57 | 14,236 |
| الإجمالي | 225 | 91,740 |

## أكبر ملفات ما زالت تحتاج تقليل

| الملف | السطور الحالية | الهدف الصحي |
|---|---:|---:|
| `admin/pages/Dashboard.tsx` | 11,237 | 3,500-4,500 |
| `admin/pages/dashboard/tabs/LeadsTab.tsx` | 5,131 | 2,000-2,800 |
| `admin/pages/UnifiedClientPage.tsx` | 4,054 | 1,800-2,400 |
| `api/routes/core.js` | 2,935 | 1,200-1,800 |
| `admin/pages/dashboard/tabs/FinancialTab.tsx` | 2,614 | 1,300-1,800 |
| `client/pages/UserDashboard.tsx` | 2,407 | 1,300-1,800 |
| `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` | 2,605 | 1,300-1,700 |
| `admin/context/SiteDataContext.tsx` | 2,252 | 800-1,200 |
| `api/server.js` | 813 | 800-1,200 |

## تقييم الأقسام

| القسم | الدرجة | السبب المختصر |
|---|---:|---|
| التشغيل المحلي | 9.6/10 | النسخة المطورة تعمل، صفحة الدقي رندرت في المتصفح الداخلي، وhealth/readiness/route smoke ناجحين |
| API reliability | 9.0/10 | `server.js` وصل للهدف الصحي، route smoke موجود، وتم تقوية payment sync، لكن `core.js` ما زال فوق الهدف |
| Admin frontend | 7.8/10 | dashboard/leads/financial/context تفككوا جزئيا، لكن Dashboard وLeads لا يزالان كبيرين |
| Client frontend | 8.2/10 | مشغل الفيديو اتفصل و`UserDashboard` اقترب من الهدف، لكنه لم يصل بعد |
| Database/schema | 7.8/10 | أضيفت migration مرقمة وتشغيل v41، لكن ما زال جزء كبير من SQL داخل startup tasks |
| الأمن والتبعيات | 9.0/10 | audits نظيفة والفحص الكامل يمر |
| TypeScript quality | 7.2/10 | تحسن في حدود الملفات، لكن ما زالت casts وملفات ضخمة |
| الاختبارات | 6.4/10 | API route smoke مدمج في quality check وتم تحقق متصفح يدوي، لكن Playwright/integration suite لم تكتمل |
| قابلية الصيانة | 8.1/10 | تحسن واضح بعد فصل startup/tasks/table/video/panels/seed، لكن أكبر ملفات React ما زالت عائق |

## ما يمنع 10/10

- `Dashboard.tsx` و`LeadsTab.tsx` ما زالا أكبر من الحجم الصحي بكثير رغم بداية التفكيك.
- `server.js` ما زال يحتوي bootstrap وruntime migrations وcron وتشغيل السيرفر في ملف واحد.
- schema موزع بين `schema.sql` و`migrations` وruntime SQL.
- لا توجد Playwright smoke tests حقيقية للدخول والعملاء والمدفوعات والدقي داخل repo حتى الآن.
- ما زالت توجد `as any` وlogs عشوائية تحتاج تحويل إلى DTO/mappers وlogger موحد.

## الطريق المتبقي إلى 10/10

1. استكمال تفكيك `Dashboard.tsx` إلى shell، role guards، hooks، وtab container components.
2. استكمال تفكيك `LeadsTab.tsx` إلى data hook، filters component، table component، modals، وactions.
3. نقل runtime migrations من `api/server.js` إلى migrations مرقمة قابلة للتشغيل مرة واحدة.
4. استكمال تفكيك `api/routes/core.js` إلى payments، certificates، cleanup، webhooks، وpublic orders إضافية إذا بقيت مسؤوليات داخله.
5. إضافة integration tests للـ API مع قاعدة بيانات test أو fixtures ثابتة.
6. إضافة Playwright smoke للدخول والعملاء والمدفوعات والدقي بحساب test معروف.
7. تقليل `as any` تدريجيا عبر DTO/mappers.
8. نقل `console.log` المتبقية إلى logger موحد بمستويات.

## الخلاصة

المشروع الآن في مرحلة أفضل بوضوح من بداية العمل: يعمل محليا، الفحوصات الأساسية ناجحة، مشكلة التعذر الحالية تم علاجها من جذورها المحلية، وبدأنا ننقل الكتل الضخمة من API وAdmin وClient إلى ملفات أوضح. التقييم العادل الآن **8.6/10**. الوصول إلى 9+/10 لكل قسم يحتاج استكمال التفكيك العميق للملفات التي ما زالت خارج الهدف وبناء test suite حقيقية، وليس فقط تقليل عدد السطور.
