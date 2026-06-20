# تقييم الأعمال والمعمارية — Mahad Nafsy (2026-06-20)

> مرجع دائم. التقييم الإجمالي كـSaaS اليوم: 4.5/10 — كمنتج single-tenant: 8/10.
> ملاحظة: جزء الـPipeline مُستبعد بطلب المالك (غير مهم حالياً).

## تقييم الأقسام
| القسم | الدرجة |
|---|---:|
| SaaS Architecture | 4.5/10 |
| CRM System | 6.5/10 |
| Lead Management | 6/10 |
| Sales Workflow | 5.5/10 |
| Customer Portal | 7/10 |
| LMS / Courses | 7.5/10 |
| Payments System | 7.5/10 |
| Accounting System | 7.5/10 |
| HR System | 7.5/10 |
| Roles & Permissions | 8.5/10 |
| Database Design | 6/10 |
| API Design | 6.5/10 |
| System Integration | 6/10 |
| Performance | 5.5/10 |
| Scalability | 4.5/10 |
| Security | 8.5/10 |
| Maintainability | 6/10 |
| Technical Debt | 5.5/10 |

## أهم 20 مشكلة حرجة
1. Multi-tenancy غير مُعتمد (استعلامات مش scoped). 2. SMTP معطّل. 3. Paymob معلّق (لا دفع self-service).
4. crm_json يحمل بيانات تشغيلية. 5. لا backup مؤتمت متحقّق. 6. الفروع enum ثابت. 7. لا caching.
8. cron داخل server.js. 9. reconciliation/refund يدوي. 10. UnifiedClientPage عملاق. 11. SiteDataContext عملاق.
12. runtime DDL. 13. SSH tunnel هش. 14. deep offset pagination. 15. لا follow-up/SLA مؤتمت.
16. لا read-replica/HA. 17. أقساط نصف-منظّمة. 18. لا monitoring/alerting حقيقي. 19. config عالمي. 20. لا PII/retention policy.

## أهم 20 فرصة تطوير
self-service checkout · أتمتة follow-up (outbox) · tenant repository موحّد · branches ديناميكي · Redis cache ·
cursor pagination · ledger-first reports · abandoned-cart · lead scoring+SLA · refund/dispute workflow ·
backup مؤتمت · نقل crm_json · job queue يستبدل cron · CDN/assets · tenant onboarding+billing ·
analytics conversion · webhooks موحّدة · observability · feature flags per tenant · usage metering→billing.

## أهم 10 Refactor
UnifiedClientPage · SiteDataContext(×2) · core.js · admin.js+hr.js · cron→jobQueue · queries→tenantDb ·
الحذف→softDelete · الفروع→constants · الأقساط→installment_entries · إزالة as any.

## أهم 10 إعادة تصميم
multi-tenancy isolation · الفروع كيان ديناميكي · crm_json→علائقي · (الـCRM pipeline — مُستبعد) ·
طبقة مدفوعات multi-gateway · subscriptions كيان أول · config per-tenant · jobs/queue مستقل ·
DB topology (replica+cache+backup) · server-state في الواجهة بدل context عملاق.

## Roadmap 90 يوم
- شهر1: SMTP+إيصالات · backup مؤتمت · jobQueue للتذكيرات.
- شهر2: self-service checkout+abandoned-cart · follow-up sequences · cursor pagination.
- شهر3: نقل crm_json · refund/reconciliation · monitoring/alerting · تفكيك UnifiedClientPage+SiteDataContext.

## Roadmap 12 شهر
- Q1: السابق + tenantDb عبر الـroutes + softDelete موحّد.
- Q2: multi-tenancy حقيقي + الفروع ديناميكية.
- Q3: tenant onboarding+metering+billing + Redis+replica.
- Q4: payments multi-gateway + observability/SLA + load testing 100k+.

## مخاطر الأعمال
فقد الأموال 🟡 · فقد العملاء 🟠 · البيانات 🟠 · الأداء 🟡 · التوسّع 🔴.

## هل جاهز كـSaaS؟
لا بعد. single-tenant ناضج + أساس multi-tenant غير مُعتمد. يلزم 3–6 شهور للوصول لـSaaS قابل للبيع.
