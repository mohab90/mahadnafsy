# Runtime Schema Centralization

Last audit: 2026-07-13

The login hot path no longer runs runtime DDL by default. Auth/refund/monitoring
hardening schema is now owned by:

- `054_v25_auth_refund_monitoring_hardening.sql`
- `061_v25_route_runtime_schema_finalization.sql`

Runtime DDL execution policy after the second hardening pass:

- `api/lib/db.js` blocks schema DDL by default at `pool.query`,
  `pool.execute`, `conn.query`, and `conn.execute`.
- Numbered migrations are allowed by `api/lib/migrationRunner.js`, which sets
  `MAHAD_SCHEMA_MIGRATION_ACTIVE=1` only while migrations run.
- Emergency legacy self-healing can still be enabled manually with
  `ALLOW_RUNTIME_SCHEMA_DDL=1`, but this should stay disabled in production.

Remaining legacy DDL inventory after this hardening pass:

- `api/routes/**/*.js`: zero route-level DDL. Enforced by
  `api/tests/noRouteDdl.test.js`.
- `api/lib/startupTasks.js` and old startup schema helpers still contain legacy
  self-healing schema, but server startup keeps them disabled unless explicitly
  enabled.

Production rule:

- Keep `ALLOW_RUNTIME_SCHEMA_DDL` unset/disabled in production.
- Keep `ENABLE_LEGACY_STARTUP_TASKS` unset/disabled in production.
- Apply migrations before deploy.
- Never add `CREATE TABLE`, `ALTER TABLE`, index creation, or column changes
  inside `api/routes/**`.
- Add every new table/column/index as a numbered migration before route code
  depends on it.

Do not remove the remaining opt-in legacy startup schema until every target
table has been verified on production and covered by migration tests.
