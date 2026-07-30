# Runtime Schema Centralization

Last audit: 2026-07-13

The login hot path no longer runs runtime DDL by default. Auth/refund/monitoring
hardening schema is now owned by:

- `054_v25_auth_refund_monitoring_hardening.sql`
- `061_v25_route_runtime_schema_finalization.sql`

Runtime DDL execution policy after the final hardening pass:

- `api/lib/db.js` blocks schema DDL at `pool.query`,
  `pool.execute`, `conn.query`, and `conn.execute`.
- Numbered migrations are allowed by `api/lib/migrationRunner.js`, which sets
  `MAHAD_SCHEMA_MIGRATION_ACTIVE=1` only while migrations run.
- Environment variables cannot bypass this guard.

Remaining legacy DDL inventory after this hardening pass:

- `api/routes/**/*.js`: zero route-level DDL. Enforced by
  `api/tests/noRouteDdl.test.js`.
- The retired `api/lib/startupTasks.js` runtime-DDL bundle and its one-off
  extraction tool were removed after migration parity tests proved the numbered
  migrations are the only active schema authority.

Production rule:

- Apply migrations before deploy.
- Never add `CREATE TABLE`, `ALTER TABLE`, index creation, or column changes
  inside `api/routes/**`.
- Add every new table/column/index as a numbered migration before route code
  depends on it.

Do not restore an HTTP-process escape hatch. Any emergency schema repair must
be a reviewed numbered migration.

## Migration numbering gaps (015, 088, 089)

These three numbers were never used — no file was ever created and later
removed (confirmed via git history). `api/lib/migrationRunner.js` discovers
migrations by globbing whatever `NNN_*.sql` files actually exist on disk and
running them in sorted order, so a gap in the sequence has no functional
effect; it does not expect or wait for a specific number. Documented here so
a gap is not mistaken for a missing/lost migration file.
