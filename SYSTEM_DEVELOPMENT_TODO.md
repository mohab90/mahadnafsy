# System Development TODO — v25

Status: `[x] done` · `[-] active` · `[ ] queued` · `[!] blocked`

## Release Gate
- [x] Canonical base is v25; v26/v30 are selective references only.
- [x] API lint + Admin/Client TypeScript + builds + quality gate.
- [x] 211/211 API unit tests; duplicate routes 0; runtime route DDL 0; production builds pass.
- [!] Connect Staging MySQL and apply migrations 065–087.
- [!] Run DB-backed journey, reconciliation, role matrix and migration upgrade tests.
- [ ] Backup/restore drill, production process manager, SSL/domain and rollback rehearsal.

## P0 — Security and SaaS Isolation
- [x] Trusted tenant resolution; reject token/request tenant mismatch.
- [x] Tenant-bound Staff/Auth lookups and cache identity.
- [x] Tenant-safe HR, registration, manual payments and refunds.
- [x] Tenant-owned system settings repository with safe default-tenant rollout fallback.
- [x] Redact connector secrets on read and preserve stored secrets on blank updates.
- [x] Tenantize Community posts/library/videos/events/forum; containment removed after tests.
- [x] Tenantize Accounting ERP, periods, ledger, finance statements and reconciliation.
- [x] Tenantize printable payment receipt/invoice loaders and tenant brand/VAT data; escape stored print content.
- [x] Core Admin Leads plus scoring/UTM/due reminders/Google Sheets utilities are tenant/ownership-safe; their dedicated containment removed.
- [x] Tenantize CRM notifications, workflow automation, scheduled cron execution and task ownership.
- [ ] Add automated Tenant-A/Tenant-B matrix for every business module.
- [ ] Review platform-admin bypass and define explicit platform role/audit.
- [ ] Harden uploads, exports, PII logging, session/cookie policy and secret rotation.

## P0 — Customer Journey Integrity
- [x] Atomic registration → Lead creation → least-loaded assignment.
- [x] Server-priced checkout/order-bound proof submission.
- [x] Payment → journal → enrollment → CRM conversion transaction.
- [x] Certificate payment/enrollment/completion eligibility.
- [ ] DB E2E: Landing → Registration → Lead → Assignment → Follow-up.
- [ ] DB E2E: Course → Order → Proof → Approval → Journal → Enrollment.
- [ ] DB E2E: Progress → Completion → Certificate → Client dashboard.
- [ ] Reconciliation: users without leads/subscribers; converted leads without subscribers.
- [ ] Reconciliation: paid orders without payments/journals/enrollments.
- [ ] Idempotency for checkout, proof approval, refund and provider webhooks.

## P0 — Connector Diagnostics Domain
- [x] Create modular diagnostics service/routes with permissions, rate limits and audit.
- [x] Lead Sources diagnostics: Facebook config and Google Sheets accessibility.
- [x] OTP diagnostics: dry-run by default; restricted real send for email/WhatsApp/SMS.
- [x] Manual payment readiness; keep external Paymob probing suspended.
- [x] Existing UI contracts connected with safe responses and structured audit events.
- [ ] DB/API integration test for permission, limiter and audit persistence.

## P0 — Branding Assets
- [x] Tenant-aware logo/favicon upload service connected to the existing Admin UI.
- [x] Magic signature, MIME, dimension and 1MB validation.
- [x] Content-addressed local/S3 storage; tenant-prefixed keys and safe cleanup.
- [-] Immutable public serving is wired; add browser render/cache invalidation tests.

## P0 — Finance and Accounting
- [x] Transactional payment, journal, commissions, instructor fees and lead conversion.
- [x] Tenant-safe refund lock, reversal journal, commission/enrollment cleanup.
- [x] Tenant-scope chart of accounts, balances, statements and ledger reports.
- [x] Tenant-scope printable receipts/invoices, cockpit, monthly comparison, budgets and payment links.
- [x] Correct receivables calculation to count expected value once per course/bundle entitlement; align reminder permissions.
- [x] Make tenant budget upserts transactional with tenant-month-category uniqueness.
- [x] Enforce fail-closed period locks on every paid-payment, expense and manual-journal mutation.
- [x] Reconciliation dashboard + tenant-safe finance outbox retry/backoff/dead-letter workflow.
- [x] Immutable FX source/applied-rate/EGP snapshots across payments, expenses, reversals and revenue reporting.
- [x] Concurrent approval/refund and double-submit integrity tests.

## P1 — CRM and Employee Operations
- [ ] Finish Leads repository/service with mandatory tenant and ownership scope.
- [x] Central tenant-safe lead state-transition service used by Admin, payments, proof approval, automation and provider callback.
- [x] Recoverable Dedup/Merge workflow by tenant + normalized phone/email with relation reparenting and audit snapshots.
- [-] Stale/follow-up queues are live; bulk, smart-route and automation assignment now validate tenant staff and commit assignment + timeline audit atomically. Durable SLA alert delivery remains.
- [x] Tenantize Lead Scoring config, UTM, campaign attribution, reminders and Google Sheets import/assignment.
- [x] Tenantize drip sequences/enrollments and add retry/backoff/dead-letter state.
- [x] Make subscriber identity/enrollment save transactional and tenant-unique; link subscriber-to-lead with timeline evidence.
- [x] Tenantize notifications, workflow automation, scheduled jobs and CRM task ownership/relations.
- [x] Release tenant-safe CRM stale/follow-up/timeline/smart-route endpoints from legacy containment.
- [x] Replace split UI lead conversion with one server transaction for subscriber, course enrollment, link and status.
- [ ] Employee/Admin activity parity and branch-scoped reporting.
- [-] Removed CRM-JSON payment dual-write and made expense/recurring/payment journals atomic; audit remaining notification/UI fire-and-forget paths.

## P1 — LMS and Client Portal
- [ ] Enrollment/access service as single source of truth.
- [ ] Progress/completion idempotency and entitlement tests.
- [ ] Bundle/drip/quiz/live-stream tenant and permission review.
- [ ] Video URL entitlement and signed/expiring delivery.
- [ ] Client refresh/device consistency and offline retry policy.
- [ ] Certificate issuance/audit/revocation/verification lifecycle.

## P1 — HR and Payroll
- [x] Tenantized HR modules and transactional payroll/attendance/leave flows.
- [ ] Branch and approval matrix verification on DB.
- [ ] Idempotent monthly payroll calculation and close/reopen policy.
- [ ] Payslip, commissions, advances and instructor-fee reconciliation.
- [ ] HR audit trail, retention and employee self-service permissions.

## P1 — Notifications and Consent
- [x] Signed tenant-bound unsubscribe token; marketing-only suppression.
- [x] Consent/resubscribe audit and campaign audience suppression.
- [x] Durable tenant outbox for email/WhatsApp/SMS with retries and dead letters.
- [ ] Provider health, rate-limit, template and delivery dashboards.
- [ ] Remove silent catches from critical customer notifications.

## P1 — Architecture and Refactor
- [x] Dashboard 3870 → 2999 lines; Daqqi 1818 → 1475 lines.
- [ ] Split Admin SiteDataContext by CRM/Finance/LMS/HR/System domains.
- [ ] Split Client SiteDataContext and remove duplicated derived state.
- [ ] Reduce UnifiedClientPage, LeadsTab and UserDashboard orchestration.
- [ ] Introduce domain services/repositories gradually with typed DTO contracts.
- [ ] Shared API schemas/mappers; reduce `as any` and contract drift.
- [ ] Move server bootstrap/cron orchestration out of `api/server.js`.

## P1 — Database Engineering
- [x] Numbered migration runner and runtime DDL guard.
- [ ] Fresh-install and upgrade-from-production-snapshot pipelines.
- [ ] Schema source consolidation and cleanup of nested duplicate migration artifacts.
- [ ] Foreign keys/unique tenant keys and orphan cleanup.
- [ ] Index/EXPLAIN audit for CRM, Finance, Dashboard and LMS queries.
- [ ] Backup, point-in-time recovery and restore verification.

## P2 — Product Features from v26/v30
- [x] Tenant-safe public search and connected GlobalSearch UI.
- [x] Connected tenant-safe AI tutor UI.
- [x] Local QR generation; remove external certificate data leak.
- [x] `/payments` and `/mahad/admin/*` compatibility aliases.
- [ ] Import only proven UI/performance improvements after contract tests.
- [ ] Reject v30 local-only stores, unsafe System AI and duplicate/unmounted routes.

## P2 — Performance, QA and Operations
- [ ] Route/page/button/form permission matrix.
- [ ] Playwright Public/Admin/Employee/Client journeys.
- [ ] API contract, DB integration, load, soak and failure-injection suites.
- [ ] Query budgets, pagination, caching and bundle-size budgets.
- [ ] Correlation IDs, tenant-safe structured logs, metrics and alerts.
- [ ] Staging parity, CI/CD, canary release and forward-only migration rollback.
- [ ] Provider readiness, NODE_ENV, process manager, domain/SSL and runbooks.

## Definition of Done
- [x] Same release candidate passes `npm run qa:launch` (lint, TS, 211 unit tests, 50 quality checks, Admin/Client builds).
- [!] DB/E2E gate remains blocked by rejected MySQL credentials; smoke DB readiness is HTTP 503.
- [ ] Zero cross-tenant access, lost leads, payment/journal mismatch or paid-without-access.
- [ ] Backup/restore and rollback rehearsals pass before public launch.
