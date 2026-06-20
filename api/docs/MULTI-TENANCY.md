# Multi-Tenancy Rollout Plan (Critical Issue #2)

**Status:** Mahad is currently **single-tenant** (one institute). There is no
`tenant_id` anywhere in the 90-table schema. This document is the migration path
to a sellable multi-tenant SaaS. It is a **multi-week project** — do NOT attempt
it in a single change against the production DB.

## What already exists (≈60% of the SaaS shell)
- ✅ Feature flags (`admin/pages/dashboard/featureFlags.ts`)
- ✅ Dynamic branding engine (`admin/lib/brandTheme.ts`)
- ✅ Settings-driven config via runtime loaders (`rbacOverrides.js`, `messageTemplates.js`)
- ✅ RBAC enforced backend (`constants/permissions.js` + `requirePermission`)
- ✅ Tenant resolver seam (`middleware/tenantContext.js` → `req.tenantId`)

## What is missing
1. **`tenant_id` column** on every tenant-owned table (subscribers, leads, payments,
   courses, staff, journal_*, daqqi_*, etc.) + composite indexes `(tenant_id, …)`.
2. **Query scoping** — every read/write filtered by `req.tenantId`.
3. **Tenant provisioning** — create-tenant flow, per-tenant settings blob row.
4. **Plans & billing** — subscription plans for the institutes (not students).
5. **Per-tenant isolation tests**.

## Recommended approach (phased, low-risk)
**Phase 1 — Schema (additive, safe):** add nullable `tenant_id VARCHAR(36)` to each
table, backfill all existing rows to `DEFAULT_TENANT_ID` (= `mahad`), add
`(tenant_id, …)` indexes. App still ignores it → zero behavior change.

**Phase 2 — Resolver:** mount `resolveTenant` in `server.js` (before routes). Every
request now has `req.tenantId` (= `mahad` for the existing install).

**Phase 3 — Scoping:** introduce a thin DB wrapper `tenantQuery(req, sql, params)`
that injects `AND tenant_id = ?`. Migrate routes module-by-module behind a feature
flag. Write isolation tests per module before flipping it on.

**Phase 4 — Provisioning + billing:** create-tenant API, per-tenant settings row,
plan/subscription tables, Paymob/Stripe subscription billing.

**Phase 5 — Hardening:** make `tenant_id` NOT NULL, add it to composite FKs, add a
quality-check guard that fails if any tenant table query omits a tenant filter.

## Effort estimate
~6–10 weeks for a single engineer. Phases 1–2 are safe to land early; phase 3 is
the bulk of the risk and must be tested per-module.
