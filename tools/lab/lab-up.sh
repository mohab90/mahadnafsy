#!/bin/bash
# Start the lab: private MariaDB (3397) then the real API (3401). Safe to run twice.
B=/d/audit_tmp/mariadb-10.11.19-winx64/bin
if ! $B/mysql.exe -h127.0.0.1 -P3397 -uroot -pperf_root_local -e "select 1" >/dev/null 2>&1; then
  (cd /d/audit_tmp/perf-db && nohup $B/mariadbd.exe --datadir="D:/audit_tmp/perf-db/data" --port=3397 --bind-address=127.0.0.1 --console --innodb-buffer-pool-size=1G --max-allowed-packet=256M --skip-name-resolve --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci > mariadbd.out 2> mariadbd.err &)
  sleep 10
fi
if ! curl -s -m 3 localhost:3401/api/health/live >/dev/null; then
  (nohup /d/audit_tmp/perf-db/start-api.sh > /d/audit_tmp/perf-db/api.out 2> /d/audit_tmp/perf-db/api.err &)
  sleep 12
fi
cd /d/audit_tmp/perf-db
for u in admin manager sales1 collection1 support1 reception1 accountant1 hr1 instructor1; do
  curl -s -o /dev/null -c cj_$u.txt -H "content-type: application/json" -d "{\"email\":\"$u@perf.test\",\"password\":\"Perf!Local1\"}" localhost:3401/api/auth/login
done
curl -s localhost:3401/api/health/live
