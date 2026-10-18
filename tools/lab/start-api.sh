#!/bin/bash
# The lab API: the worktree's code, the private database, no .env, no background jobs.
cd "$(dirname "$0")/../../api"
ADMIN_EMAILS=admin@perf.test NODE_ENV=development PORT=3401 DB_HOST=127.0.0.1 DB_PORT=3397 DB_USER=root DB_PASSWORD=perf_root_local DB_NAME=mahad_perf \
JWT_SECRET=local-perf-secret-0123456789abcdef0123456789abcdef AUTH_SECRET=local-perf-secret-0123456789abcdef0123456789abcdef \
ALLOWED_ORIGINS=http://localhost:4021 CSRF_ORIGIN_ENFORCE=0 RUN_MIGRATIONS_ON_STARTUP=0 STATIC_DIR=/d/audit_tmp/perf-db/run \
exec node server.js
