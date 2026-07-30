# مراجعة Finance & Accounting العميقة — نسخة 25

**التاريخ:** 29 يوليو 2026  
**الحالة الصادقة:** Code Complete محليًا / Staging & Production Pending  
**التقييم مقابل أنظمة ERP المالية العالمية:** **6.1/10**  
**التقييم كنظام مالي تشغيلي لمعهد تعليمي متوسط:** **8.0/10**

> التقييمين مختلفين عمدًا: النظام قوي في دورة التحصيل التعليمية وربطها بالـCRM والاشتراك والـLMS، لكنه ليس Oracle Financials أو SAP Finance أو NetSuite كاملًا، ولا يجوز تسويقه كـERP مؤسسي كامل.

## 1. نطاق المراجعة الفعلي

تمت مراجعة مسارات:

- التحصيل اليدوي وإثباتات التحويل والمراجعة والاعتماد.
- دفتر اليومية والقيد المزدوج وشجرة الحسابات وإقفال/إعادة فتح الفترات.
- المصروفات والمصروفات الدورية والميزانيات.
- الاسترداد وإلغاء الاستحقاق والعمولات وأجر المحاضر.
- التقارير: P&L وBalance Sheet وCash Flow وTrial Balance وJournal وVAT.
- التسويات بين Payments وLedger وOrders وEnrollments وCRM وAudit وCompensation.
- صلاحيات الإدارة والمحاسب والفرع والسيلز وخدمة العملاء.
- العملات EGP/SAR/USD وتجميد سعر التحويل وقت الحركة.
- صفحات Finance في لوحة الإدارة وبوابة العميل.

## 2. دورة المال الفعلية بعد الإصلاح

| المرحلة | المصدر الحقيقي | الحفظ | الانعكاس | الحالة |
|---|---|---|---|---|
| إنشاء دفعة يدوية | موظف يملك `manage_payments` | `payments` داخل Transaction | Pending لو الموظف لا يملك سلطة الاعتماد | ✅ |
| اعتماد الدفعة | مسؤول يملك `manage_financial` | تحديث `payments` + قيد + Audit | Enrollment + CRM + عمولة + أجر محاضر | ✅ |
| إثبات تحويل العميل | Client Portal | `payment_proofs` | شاشة المراجعة المالية | ✅ |
| اعتماد الإثبات | Finance | Payment + Journal + Audit في Transaction | العميل والكورس والـCRM والتعويضات | ✅ |
| الدفع المرتبط بطلب | Order confirmation | Payment + Order + Enrollment | CRM conversion وFinance | ✅ |
| الاسترداد | Approver مستقل | Refund + reversal journal + entitlement revoke | Order/CRM/commission/instructor fee | ✅ |
| مصروف | Finance | Expense + journal + audit | P&L وVAT وCash Flow | ✅ |
| مصروف دوري شهري | Scheduler | Expense + journal + audit + `last_run` | التقارير المالية | ✅ |
| إقفال فترة | Finance | `accounting_periods` + snapshots | يمنع أي كتابة مالية لاحقة | ✅ |
| Paymob | مزود خارجي | — | مقفول Fail-closed | ⚠️ مؤجل باتفاق |
| التقسيط | نموذج قيد المراجعة | Read-only | الكتابة مقفولة | ⚠️ مؤجل باتفاق |

أدلة التنفيذ: `api/routes/subscriber-payments.js:30`، `api/routes/payment-proofs.js:48`، `api/routes/core/financepay.js`، `api/lib/orderPaymentConfirmation.js`، `api/lib/refunds.js:34`، `api/lib/paymentCompensation.js:17`.

## 3. نتائج المراجعة حسب المكوّن

| المكوّن | المنطق | قاعدة البيانات | الترابط | الأمان | الأداء | التقييم |
|---|---:|---:|---:|---:|---:|---:|
| Payments ledger | 8.5 | 8.5 | 9.0 | 8.5 | 8.0 | 8.5 |
| Manual payment proofs | 8.5 | 8.5 | 9.0 | 8.5 | 8.0 | 8.5 |
| General Ledger | 8.0 | 8.5 | 8.5 | 8.5 | 8.0 | 8.3 |
| Period close | 8.5 | 8.5 | 8.5 | 9.0 | 8.0 | 8.5 |
| Refunds | 8.5 | 8.5 | 9.0 | 9.0 | 8.0 | 8.6 |
| Expenses/Budgets | 8.0 | 8.0 | 8.5 | 8.5 | 8.0 | 8.2 |
| Financial reporting | 7.5 | 8.0 | 8.0 | 8.5 | 8.0 | 8.0 |
| Reconciliation | 8.5 | 8.5 | 9.0 | 8.5 | 8.0 | 8.5 |
| Multi-currency | 7.5 | 8.5 | 8.0 | 9.0 | 8.0 | 8.2 |
| AP/Vendors/Procurement | 1.0 | 1.0 | 0.5 | 2.0 | 2.0 | 1.3 |
| AR/Invoicing/Credit memos | 3.0 | 3.0 | 3.5 | 4.0 | 4.0 | 3.5 |
| Fixed assets/depreciation | 0.5 | 0.5 | 0.0 | 1.0 | 1.0 | 0.6 |
| Bank reconciliation | 2.0 | 2.0 | 2.0 | 3.0 | 2.0 | 2.2 |
| Tax localization/e-invoicing | 2.5 | 2.5 | 2.0 | 3.0 | 3.0 | 2.6 |
| Consolidation/intercompany | 0.5 | 0.5 | 0.0 | 1.0 | 1.0 | 0.6 |

## 4. الصفحات والإجراءات

| الصفحة | Route/API | الأزرار والإجراءات | DB/الترابط | الحكم |
|---|---|---|---|---|
| Financial Cockpit | `/admin/finance/cockpit` | Filters/navigation | Ledger + payments + CRM + payroll | ✅ |
| Payment Review | `/admin/payments/review` | filter/review/export | Payments + orders dedupe | ✅ |
| Payment Proofs | `/admin/payment-proofs` | approve/reject/image | Proof → payment → ledger → enrollment | ✅ |
| Expenses | Admin operations + analytics | add/edit/delete | Expense + journal في Transaction | ✅ |
| Recurring Expenses | `/admin/recurring-expenses` | add/edit/disable/delete | Audit إلزامي وbranch scope | ✅ شهريًا |
| Budget | `/admin/finance/budgets` | save/filter | Unique tenant+branch+month+category | ✅ |
| Refunds | `/admin/finance/refunds` | approve/reject | reversal كامل في Transaction | ✅ |
| P&L | `/admin/financial/pnl` | date/branch/export | Ledger هو المصدر | ✅ |
| Balance Sheet | `/admin/financial/balance-sheet` | date/branch | Ledger balances | ✅ |
| Cash Flow | `/admin/financial/cash-flow` | date/branch | Ledger cash accounts | ✅ |
| Trial Balance | `/admin/reports/trial-balance` | date/branch | Journal lines | ✅ |
| Journal Entries | `/admin/accounting/journal-entries` | manual entry | validation + period lock | ✅ |
| Chart of Accounts | `/admin/accounting/chart-of-accounts` | add/update | يمنع تعطيل system accounts | ✅ |
| Period Closing | `/admin/accounting-periods` | close/reopen | integrity checks + strict audit | ✅ |
| Salary Advances | `/admin/finance/salary-advances` | disburse | HR → Finance → Payroll | ✅ |
| Payment Links | `/admin/payment-links` | create/list | Checkout غير موجود بالمشروع | ⚠️ مقفول Fail-closed |
| Installments | installment routes | create/pay/delete | نموذج الدفع مؤجل | ⚠️ الكتابة مقفولة |
| Paymob checkout | Paymob routes | initiate/callback | مراجعة المزود غير مكتملة | ⚠️ مقفول |

## 5. الإصلاحات المنفذة في هذه الجولة

| ID | المشكلة | الدليل بعد الإصلاح | السبب الجذري | التأثير الذي تم منعه |
|---|---|---|---|---|
| FIN-01 | إنشاء روابط دفع لمسار Frontend غير موجود | `api/routes/finance.js:846-866` | URL ثابت `/#/pay/:token` بلا route | روابط مكسورة تُرسل للعميل |
| FIN-02 | كشف الدفع يخفي فشل Orders | `api/routes/payments.js:264` | `catch` فارغ | إجمالي ناقص بصمت |
| FIN-03 | خطط التقسيط تُقرأ خارج نطاق الموظف | `api/routes/installments.js:27-42` | Tenant scope فقط | كشف بيانات مالية بين الفروع |
| FIN-04 | المصروف الدوري يتغير بلا Audit ذري | `api/routes/analytics/financial.js:102-292` | CRUD مباشر على pool | حركة مالية بلا أثر أو حفظ جزئي |
| FIN-05 | Scheduler يحفظ المصروف والقيد بدون financial audit | `api/routes/analytics/financial.js:360-370` | Audit غير مربوط بالـTransaction | صعوبة الإثبات والمراجعة |
| FIN-06 | مقارنة الشهور تعمل 10 Queries غير قابلة للفهرسة | `api/routes/finance.js:394-447` | `YEAR()` و`MONTH()` على الأعمدة | بطء مع تضخم البيانات |
| FIN-07 | فلتر التاريخ يقبل قيمًا غير صالحة ويستخدم `DATE()` | `api/routes/payments.js:140-149,178-184,258-259` | غياب validation/range query | أخطاء وتقليل استفادة الفهرس |
| FIN-08 | غياب indexes لقراءات Finance الحرجة | `api/migrations/154_v25_finance_query_indexes.sql:1-17` | نمو schema دون query plan متكامل | Full scans تحت الحمل |
| FIN-09 | VAT في المستند المطبوع يُضاف مرة ثانية | `api/routes/finance.js:59-70` | اعتبار المبلغ المحصل Net بدل Gross | إيصال لا يطابق النقدية |
| FIN-10 | JWT مقبول سابقًا داخل query للطباعة | `api/routes/finance.js:77,249,725` | تسهيل فتح المستند | تسريب token في history/logs |
| FIN-11 | أسعار عملات fallback ثابتة | `api/lib/finance.js:194-265` | افتراض سعر بدل snapshot موثوق | قيود وتقارير مالية خاطئة |
| FIN-12 | العمولات وأجر المحاضر موزعة في مسارات مختلفة | `api/lib/paymentCompensation.js:17-109` | تكرار منطق ما بعد الدفع | دفع يظهر بدون التزام مالي |
| FIN-13 | التسوية لا تكشف كل الانفصالات | `api/routes/core/payops.js:155-280` | فحوص سطحية | فساد صامت في رحلة العميل |
| FIN-14 | Salary Advances لا تظهر للمحاسب | `api/routes/hr/records.js:103-121` | شاشة HR فقط | انفصال HR عن Finance |
| FIN-15 | تقرير Cockpit يحتسب Payroll خارج الـGL | `api/routes/finance.js:1090+` | جدول تشغيلي كمصدر مالي | فرق بين التقرير والدفتر |

## 6. صلاحيات الموظفين في Finance

| الدور | ما يجب أن يراه/يفعله | الحالة | الملاحظة |
|---|---|---|---|
| Owner/Admin | كل الفروع، إقفال وإعادة فتح، audit/reconciliation | ✅ | Reopen للإدارة فقط |
| Accountant/Finance | التقارير، الاعتماد، المصروف، الميزانية، الصرف | ✅ | يخضع لنطاق الفرع إن كان Branch Accountant |
| تحصيل | تسجيل دفعة ومتابعتها | ✅ | لا يعتمد دفعة أنشأها دون `manage_financial` |
| Sales | عميله ومدفوعاته المنسوبة فقط | ✅ | لا يرى aggregate مالي |
| Customer Service | عميله المنسوب وحالته | ✅ | لا يرى ledger أو تقارير الإدارة |
| Reception Dokki | نطاق الدقي فقط | ✅ | Branch scope إجباري من السيرفر |
| Online Manager | نطاق العملاء الأونلاين حسب role policy | ✅ | ليس Finance شاملًا |
| HR | يوافق السلفة من ناحية HR | ✅ | الصرف منفصل عند Finance |
| Client | إثباتاته ومدفوعاته هو فقط | ✅ | لا يصل إلى Admin APIs |

الدليل المركزي لنطاق البيانات: `api/lib/financialScope.js:13-79`.  
الدليل على Salary Advances: `api/routes/hr/records.js:103` و`api/routes/hr/records.js:201`.

## 7. المقارنة مع أفضل 3 أنظمة

مرجع المقارنة:

1. **Oracle Fusion Cloud Financials**: GL وAR وAP وAssets وCash Management وTax وExpenses وRevenue Management والتسويات.  
   المصادر: [Oracle Financial Management](https://www.oracle.com/erp/financial-management/)، [Oracle Financials Overview](https://docs.oracle.com/en/cloud/saas/financials/25d/facsf/overview-of-oracle-financials-cloud.html).
2. **SAP S/4HANA Cloud Finance**: Financial Accounting، controlling، close، consolidation، receivables/payables، asset accounting والامتثال.  
   المصادر: [SAP Cloud ERP Finance](https://www.sap.com/assetdetail/2025/05/96ee1720-057f-0010-bca6-c68f7e60039b.html)، [SAP FI Documentation](https://help.sap.com/docs/SAP_ERP/6a49d1604ffc4b908f9f78fba3824187/b6412fd7-7262-4c2c-aa06-e398f91c7f43.html).
3. **Oracle NetSuite Financials**: Accounting periods، GL، budgets، currency، banking، tax، AR/AP، revenue/expense recognition وclose.  
   المصادر: [NetSuite Accounting Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N1379709.html)، [NetSuite Accounting Features](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1383904.html).

| القدرة | Mahad v25 | Oracle | SAP | NetSuite | الفجوة |
|---|---:|---:|---:|---:|---|
| Double-entry GL | 8 | 10 | 10 | 10 | متوسطة |
| Period close | 8 | 10 | 10 | 9 | متوسطة |
| Education payment integration | 9 | 7 | 7 | 7 | نقطة قوة Mahad |
| CRM/LMS entitlement linkage | 9 | 7 | 7 | 7 | نقطة قوة Mahad |
| AP/Procure-to-pay | 1 | 10 | 10 | 9 | حرجة |
| AR/Invoice-to-cash | 3 | 10 | 10 | 9 | حرجة |
| Fixed assets | 0 | 10 | 10 | 9 | حرجة |
| Bank reconciliation | 2 | 10 | 10 | 9 | حرجة |
| Tax localization/e-invoice | 2 | 10 | 10 | 8 | حرجة |
| Multi-entity/intercompany | 0 | 10 | 10 | 9 | حرجة |
| Consolidation/close orchestration | 1 | 10 | 10 | 8 | حرجة |
| Planning/EPM | 2 | 9 | 10 | 8 | كبيرة |

## 8. نقاط القوة الحقيقية

- Payment واحد أصبح ينعكس ذريًا على Ledger وCRM وEnrollment وCompensation وAudit.
- EGP snapshot immutable يمنع تغيّر التقارير التاريخية عند تغيّر سعر الصرف.
- Foreign-currency posting يفشل لو السعر fallback أو ناقص أو أقدم من 48 ساعة.
- Period lock يفشل مغلقًا حتى لو جدول الأقفال غير متاح.
- Refund يعكس القيد والاستحقاق والطلب والعمولة وأجر المحاضر في نفس الـTransaction.
- Reconciliation يكشف: غياب القيد، فرق المبلغ، غياب FX، إثباتًا معتمدًا بلا دفعة، عمولة/أجر محاضر مفقودًا، وانفصال CRM/LMS.
- Branch/assigned-record scope مطبق من السيرفر وليس مجرد فلتر واجهة.

## 9. نقاط الضعف والميزات الناقصة

| الخطورة | النقص | التأثير | المطلوب |
|---|---|---|---|
| P0 قبل ادعاء ERP | لا يوجد AP/Vendor Invoice/PO/3-way match | لا توجد دورة مشتريات مؤسسية | Vendor master + requisition + PO + receipt + bill + payment |
| P0 قبل ادعاء ERP | لا يوجد AR حقيقي | الإيصال ليس فاتورة قانونية ولا توجد credit memo/application | Customer invoices + numbering + allocations + credit notes |
| P0 قبل ادعاء ERP | لا يوجد Fixed Assets | الأصول والإهلاك خارج النظام | Asset register + capitalization + depreciation + disposal |
| P0 إنتاجيًا | migrations 150-154 غير مطبقة على Staging موثوق | الكود يعتمد أعمدة وفهارس جديدة | Apply + checksum + backup + verification |
| P0 إنتاجيًا | Paymob لم يُراجع حيًا | لا يوجد Card E2E | يبقى Disabled حتى provider sign-off |
| P1 | Bank statement import/matching ناقص | reconciliation يدوي | Bank feeds/import + matching rules |
| P1 | VAT ليس Localization قانونية | مخاطرة ضرائب وفوترة | Tax engine + e-invoice integration + legal identity |
| P1 | لا يوجد legal entity/intercompany | لا يصلح لمجموعة شركات | entities + ledgers + intercompany elimination |
| P1 | لا يوجد cash forecast/treasury | رؤية سيولة محدودة | cash positioning + forecast |
| P1 | recurring auto-post شهري فقط | weekly/quarterly/yearly للتخطيط فقط | Scheduler semantics منفصلة لكل cadence |
| P1 | Payment Links مقفولة | لا يمكن إرسال checkout مخصص | بناء route حقيقي + signed immutable intent + E2E |
| P1 | FX provider غير مثبت حيًا | العملات الأجنبية تفشل عمدًا | Provider موثوق + alert على staleness |

## 10. الاختبارات والأدلة

نتيجة بوابة الجودة الكاملة بتاريخ التقرير:

- API lint: **Pass**
- Admin TypeScript: **Pass**
- Client TypeScript: **Pass**
- Unit/contract tests: **539 total — 538 pass — 0 fail — 1 Paymob TODO**
- Quality gate: **56/56 Pass**
- Admin production build: **Pass** — 3056 modules
- Client production build: **Pass** — 1860 modules
- Migration parser/runner: يتعرف على migration 154 ويطبقها في بيئة الاختبار.

الاختبار المتبقي ليس فشلًا مخفيًا: هو E2E Paymob المعلّم TODO لأن المزود ما زال تحت المراجعة.

## 11. الحكم النهائي للقسم

**Finance & Accounting جاهز وظيفيًا محليًا لدورة تحصيل معهد تعليمي، لكنه ليس جاهزًا للإنتاج بنسبة 100% ولا ERP مؤسسيًا كاملًا.**

شروط تحويل الحالة إلى Production Ready:

1. MySQL Staging موثوق + migrations 150-154 + checksum verification.
2. اختبار مالي حي: proof → approval → journal → enrollment → CRM → compensation → refund.
3. Fresh FX provider وتجربة SAR وUSD حقيقية.
4. UAT لحساب Owner وAccountant وCollector وSales وCS وDokki Reception وOnline Manager وClient.
5. Backup/restore rehearsal قبل أول حركة حية.
6. Paymob يظل Disabled لحين مراجعة المزود.

**النتيجة الصادقة:**  
- كنظام تحصيل وتعليم متكامل: **8.0/10**.  
- مقابل أفضل ERP مالية عالميًا: **6.1/10** بسبب غياب AP/AR المؤسسي والأصول والبنوك والضرائب والكيانات والتجميع.  
- حالة الإطلاق: **Staging Pending، وليس 100% Production Ready**.
