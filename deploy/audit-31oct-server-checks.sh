#!/usr/bin/env bash
# Read-only checks from the 31 Oct 2026 audit, run ON the server as root. Changes nothing.
#
#   sudo bash deploy/audit-31oct-server-checks.sh
#
# 1. Is every paid payment in the journal (the finance cockpit reads revenue from it)?
# 2. Are the off-site backup and the ops heartbeat configured (names only, never the values)?
# 3. Does the nginx config in use answer 404 for an unknown address (the repo's mahad-web.conf.example does)?
set -uo pipefail

ENV_FILE="${MAHAD_BACKUP_ENV_FILE:-/etc/mahad/backup.env}"
DB="${MAHAD_DB_NAME:-}"
if [[ -z "$DB" && -r "$ENV_FILE" ]]; then DB="$(grep -E '^(MAHAD_DB|DB_NAME|DB)=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "\"'")"; fi
DB="${DB:-mahad_nafsy}"

echo "== 1. paid payments with no journal entry (database: $DB) =="
mysql -u root "$DB" -e "
  SELECT COUNT(*) AS paid_not_in_books, COALESCE(ROUND(SUM(p.amount_egp)),0) AS egp,
         MIN(p.date) AS oldest, MAX(p.date) AS newest
    FROM payments p
   WHERE p.status='paid' AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref_type='payment' AND j.ref_id=p.id);
  SELECT DATE_FORMAT(p.date,'%Y-%m') AS month, COUNT(*) AS payments
    FROM payments p
   WHERE p.status='paid' AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref_type='payment' AND j.ref_id=p.id)
   GROUP BY month ORDER BY month DESC LIMIT 12;" 2>&1 | head -n 30
echo "   (zero = the books and the payments agree. Otherwise: node tools/backfill-payment-journal.mjs, dry run first)"

echo
echo "== 2. configuration present (names only) =="
for name in MAHAD_BACKUP_REMOTE OPS_HEARTBEAT_URL BREVO_WEBHOOK_TOKEN BREVO_WEBHOOK_TOKEN_FILE WHATSAPP_APP_SECRET WHATSAPP_APP_SECRET_FILE \
            WHATSAPP_WEBHOOK_VERIFY_TOKEN WHATSAPP_ULTRAMSG_WEBHOOK_SECRET PAYMOB_REVIEW_PENDING; do
  found=""
  for file in /etc/mahad/*.env /var/www/mahad-api/.env /opt/mahad/*.env; do
    [[ -r "$file" ]] && grep -qE "^${name}=.+" "$file" 2>/dev/null && found="$found $file"
  done
  printf '   %-34s %s\n' "$name" "${found:-NOT SET}"
done

echo
echo "== 3. unknown address =="
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: mahadnafsy.com' https://127.0.0.1/no-such-page-xyz -k)"
echo "   /no-such-page-xyz answers $code  (404 = the new nginx rules are live, 200 = still the catch-all)"
nginx -t 2>&1 | sed 's/^/   /'
