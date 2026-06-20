# Rollout & Adoption Runbook — 2026-06 platform foundations

This covers deploying the multi-tenancy / reliability / accounting foundations
(commits `4faac49`, `7705dc1`, `46c74da`, `f7c6fda`) **safely and in order**.

> Golden rule: **deploy code first, then run migrations, then adopt.** The new
> code is backward-compatible — it does **not** reference any new column
> (`tenant_id`, `deleted_at`) in hot paths, and every new-table read is guarded
> with try/catch. So shipping the code before the migrations cannot break prod.

---

## 0. Pre-flight

```bash
# Backup the production DB first (always).
# On the server:  mysqldump ... > backup_$(date +%Y%m%d%H%M%S).sql
npm run test            # lint:api + unit + smoke (offline parts)
node tools/run-migrations.mjs --dry-run   # confirm pending list
```

## 1. Deploy code (safe, backward-compatible)

Deploy as usual. New endpoints (`/api/admin/monitoring`, `/api/admin/reconcile-ledger`,
`/api/openapi.json`) and the 1-minute outbox/job worker activate immediately but
no-op until their tables exist (errors are caught and logged at warn level).

## 2. Run migrations (in order)

```bash
# Start the SSH tunnel to the production DB, then:
node tools/run-migrations.mjs
```
Migrations applied: `011` tenant_id · `012` tenant meta · `013` collation · `014`
subscriptions + installment_entries · `016` audit/outbox/queue · `017` soft delete.
(There is intentionally no `015`; the runner orders by filename and gaps are fine.)

⚠️ **`013_collation_unify.sql` rebuilds every table** — run it in a maintenance
window. The others are fast (column/table adds).

> `014` does **not** redefine the existing `installment_plans` table (which
> analytics.js owns); it only adds `subscriptions` + `installment_entries`.

## 3. Backfill + regenerate

```bash
node tools/backfill-crm-json.mjs --dry-run   # preview
node tools/backfill-crm-json.mjs             # normalise installment schedules → installment_entries
node tools/gen-openapi.mjs                   # refresh api/docs/openapi.json
```

## 4. Verify

```bash
curl -s localhost:3001/api/health/live
curl -s -H "Authorization: Bearer <admin>" localhost:3001/api/admin/monitoring
curl -s -H "Authorization: Bearer <admin>" localhost:3001/api/admin/reconcile-ledger   # expect balanced:true (or known legacy diff)
TEST_DB_NAME=<db> TEST_DB_USER=<u> TEST_DB_PASSWORD=<p> npm --prefix api run test:integration
```

## 5. Incremental adoption (one PR each, verify between)

These are deliberately **not** auto-applied — adopt them gradually with the DB live:

1. **Soft delete** — switch hard `DELETE` endpoints to `softDelete(table, 'id=?', [id])`
   and add `AND deleted_at IS NULL` (via `liveOnly()`) to that resource's reads.
2. **Tenant scoping** — route reads/writes through `tenantDb(pool, req.tenantId)`
   table by table; verify each still returns the same rows for tenant `mahad`.
3. **Job queue** — move one cron at a time from `setInterval` in `server.js` into
   a handler registered in `_jobHandlers`, enqueuing via `jobQueue.enqueue(...)`.
4. **Outbox** — replace direct `sendEmail`/`sendWhatsApp` calls with
   `outbox.enqueue(...)` inside the business transaction.
5. **Plan limits / feature flags** — gate new-tenant features with
   `tenantPlan.isFeatureEnabled` / `checkLimit`.

## Rollback

Code is backward-compatible, so rolling back the deploy is safe at any point.
Migrations are additive (new tables / nullable columns) — they need no down-migration;
the old code simply ignores the new columns. Only `013` (collation) is a heavy
change — keep the pre-013 backup if you must revert charset.
```
