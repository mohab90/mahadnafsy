#!/bin/bash
# Mahad API Watchdog — auto-restart if port 3001 is down
NODE='C:\Program Files\nodejs\node.exe'
SUPERVISOR='D:\mahadnafsy25\api\supervisor.js'
LOG='D:\mahadnafsy25\api\watchdog.log'
CRASH_LOG='D:\mahadnafsy25\api\crash-history.log'
APP_DIR='D:\mahadnafsy25\api'
TS=$(date '+%Y-%m-%d %H:%M:%S')

# WhatsApp alert helper — reads secrets from .env at runtime (never embedded in this file)
ENV_FILE="$APP_DIR/.env"
read_env() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'"; }
WA_TOKEN=$(read_env WHATSAPP_TOKEN)
WA_PHONE_ID=$(read_env WHATSAPP_PHONE_ID)
WA_ADMIN_PHONE=$(read_env ADMIN_WHATSAPP_PHONE)
send_wa_alert() {
  local MSG="$1"
  if [ -n "$WA_TOKEN" ] && [ -n "$WA_PHONE_ID" ] && [ -n "$WA_ADMIN_PHONE" ]; then
    curl -s -X POST "https://graph.facebook.com/v20.0/$WA_PHONE_ID/messages" \
      -H "Authorization: Bearer $WA_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"messaging_product\":\"whatsapp\",\"to\":\"$WA_ADMIN_PHONE\",\"type\":\"text\",\"text\":{\"body\":\"$MSG\"}}" \
      >> $LOG 2>&1
  fi
}

# ── Check health (localhost:3001) ─────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:3001/api/health 2>/dev/null)
if [ "$HTTP" != "200" ]; then
  echo "$TS [CRASH] Server down (HTTP=$HTTP) — recovering" >> $CRASH_LOG
  echo "$TS [WATCHDOG] Server down (HTTP=$HTTP)" >> $LOG
  send_wa_alert "🚨 Mahad API توقف (HTTP=$HTTP) — جاري إعادة التشغيل $TS"

  # On a systemd host the service manager owns the process — restart through it.
  # Spawning supervisor.js alongside systemd created competing process managers
  # (unkillable orphans + 90s stop-timeouts observed on every prior restart).
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files mahad-api.service --no-legend 2>/dev/null | grep -q mahad-api; then
    systemctl restart mahad-api.service >> $LOG 2>&1
    echo "$TS [CRASH] restarted via systemctl" >> $CRASH_LOG
    sleep 15
    HTTP2=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:3001/api/health 2>/dev/null)
    if [ "$HTTP2" = "200" ]; then
      echo "$TS [RECOVERED] API back via systemctl" >> $CRASH_LOG
      send_wa_alert "✅ Mahad API عاد للعمل via systemctl"
    else
      echo "$TS [CRASH] systemctl recovery failed HTTP2=$HTTP2" >> $CRASH_LOG
      send_wa_alert "❌ Mahad API فشل الإصلاح HTTP=$HTTP2"
    fi
    tail -500 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
    exit 0
  fi

  # Fallback (non-systemd hosts only): recover via supervisor.js.
  # NODE is process.execPath — the binary actually running this app. The old
  # hardcoded /opt/alt/... path was from the previous shared host and made
  # every recovery attempt fail with "No such file or directory" (48 recorded
  # crashes, zero successful recoveries).
  NODE='C:\Program Files\nodejs\node.exe'
  SUPERVISOR='D:\mahadnafsy25\api\supervisor.js'
  PM2='D:\mahadnafsy25\api\local_modules\node_modules\pm2\bin\pm2'
  PM2_HOME='D:\mahadnafsy25\api\.pm2'
  PM2_HOME="$PM2_HOME" $NODE $PM2 kill 2>/dev/null || true
  sleep 1
  # Kill stale server.js and supervisor.js node processes only — NOT this watchdog script.
  # We match the specific script names to avoid killing the bash process running watchdog.sh.
  SELF_PID=$$
  for f in /proc/[0-9]*/cmdline; do
    PID=$(echo "$f" | cut -d/ -f3)
    [ "$PID" = "$SELF_PID" ] && continue
    grep -qz "mahad-api/server.js|mahad-api/supervisor.js" "$f" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  done
  sleep 3

  # Start fresh supervisor
  nohup $NODE $SUPERVISOR >> $APP_DIR/server.log 2>&1 &
  SPID=$!
  echo "$TS [CRASH] supervisor.js started PID=$SPID" >> $CRASH_LOG
  echo "$TS [WATCHDOG] supervisor PID=$SPID" >> $LOG
  send_wa_alert "⚠️ Mahad API restarting via supervisor PID=$SPID"

  sleep 15
  HTTP2=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:3001/api/health 2>/dev/null)
  if [ "$HTTP2" = "200" ]; then
    echo "$TS [RECOVERED] API back via supervisor" >> $CRASH_LOG
    echo "$TS [WATCHDOG] OK after restart" >> $LOG
    send_wa_alert "✅ Mahad API عاد للعمل via supervisor"
  else
    echo "$TS [CRASH] Recovery failed HTTP2=$HTTP2" >> $CRASH_LOG
    echo "$TS [WATCHDOG] Recovery failed HTTP2=$HTTP2" >> $LOG
    send_wa_alert "❌ Mahad API فشل الإصلاح HTTP=$HTTP2"
  fi
  # Trim operational log only (NOT crash-history)
  tail -500 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
fi
