'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

function buildWatchdogContent({ appDir, port, crashHistoryLog }) {
  const supervisorPath = path.join(appDir, 'supervisor.js');
  const watchdogLog = path.join(appDir, 'watchdog.log');
  const pm2Bin = path.join(appDir, 'local_modules/node_modules/pm2/bin/pm2');
  const pm2Home = process.env.PM2_HOME || path.join(appDir, '.pm2');

  return `#!/bin/bash
# Mahad API Watchdog - auto-restart via supervisor.js if port ${port} is down
NODE='/opt/alt/alt-nodejs22/root/usr/bin/node'
SUPERVISOR='${supervisorPath}'
LOG='${watchdogLog}'
CRASH_LOG='${crashHistoryLog}'
APP_DIR='${appDir}'
TS=$(date '+%Y-%m-%d %H:%M:%S')

# WhatsApp alert helper.
# Security: never interpolate secrets into watchdog.sh. Cron/runtime may provide
# these env vars; otherwise alerts are silently skipped.
WA_TOKEN="\${WHATSAPP_TOKEN:-\${WA_API_TOKEN:-}}"
WA_PHONE_ID="\${WHATSAPP_PHONE_ID:-}"
WA_ADMIN_PHONE="\${ADMIN_WHATSAPP_PHONE:-}"
send_wa_alert() {
  local MSG="$1"
  if [ -n "$WA_TOKEN" ] && [ -n "$WA_PHONE_ID" ] && [ -n "$WA_ADMIN_PHONE" ]; then
    curl -s -X POST "https://graph.facebook.com/v20.0/$WA_PHONE_ID/messages" \\
      -H "Authorization: Bearer $WA_TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"messaging_product\\":\\"whatsapp\\",\\"to\\":\\"$WA_ADMIN_PHONE\\",\\"type\\":\\"text\\",\\"text\\":{\\"body\\":\\"$MSG\\"}}" \\
      >> $LOG 2>&1
  fi
}

# -- Check health (localhost:${port}) -------------------------------------
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:${port}/api/health 2>/dev/null)
if [ "$HTTP" != "200" ]; then
  echo "$TS [CRASH] Server down (HTTP=$HTTP) - recovering via supervisor.js" >> $CRASH_LOG
  echo "$TS [WATCHDOG] Server down (HTTP=$HTTP) - starting supervisor.js..." >> $LOG
  send_wa_alert "Mahad API down (HTTP=$HTTP) - restart attempt at $TS"

  # Kill PM2 daemon so it won't resurrect a competing server.js
  NODE='/opt/alt/alt-nodejs22/root/usr/bin/node'
  SUPERVISOR='${supervisorPath}'
  PM2='${pm2Bin}'
  PM2_HOME='${pm2Home}'
  PM2_HOME="$PM2_HOME" $NODE $PM2 kill 2>/dev/null || true
  sleep 1
  # Kill stale server.js and supervisor.js node processes only - NOT this watchdog script.
  # We match the specific script names to avoid killing the bash process running watchdog.sh.
  SELF_PID=$$
  for f in /proc/[0-9]*/cmdline; do
    PID=$(echo "$f" | cut -d/ -f3)
    [ "$PID" = "$SELF_PID" ] && continue
    grep -qz "mahad-api/server\\.js\\|mahad-api/supervisor\\.js" "$f" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  done
  sleep 3

  # Start fresh supervisor
  nohup $NODE $SUPERVISOR >> $APP_DIR/server.log 2>&1 &
  SPID=$!
  echo "$TS [CRASH] supervisor.js started PID=$SPID" >> $CRASH_LOG
  echo "$TS [WATCHDOG] supervisor PID=$SPID" >> $LOG
  send_wa_alert "?? Mahad API restarting via supervisor PID=$SPID"

  sleep 15
  HTTP2=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:${port}/api/health 2>/dev/null)
  if [ "$HTTP2" = "200" ]; then
    echo "$TS [RECOVERED] API back via supervisor" >> $CRASH_LOG
    echo "$TS [WATCHDOG] OK after restart" >> $LOG
    send_wa_alert "Mahad API restarted via supervisor"
  else
    echo "$TS [CRASH] Recovery failed HTTP2=$HTTP2" >> $CRASH_LOG
    echo "$TS [WATCHDOG] Recovery failed HTTP2=$HTTP2" >> $LOG
    send_wa_alert "Mahad API still failing HTTP=$HTTP2"
  fi
  # Trim operational log only (NOT crash-history)
  tail -500 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
fi
`;
}

function recordStartup({ crashHistoryLog }) {
  try {
    const existing = fs.existsSync(crashHistoryLog) ? fs.readFileSync(crashHistoryLog, 'utf8') : '';
    const crashCount = (existing.match(/\[CRASH\]/g) || []).length;
    const restartCount = (existing.match(/\[START\]/g) || []).length;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(
      crashHistoryLog,
      `${ts} [START] Server started - cumulative restarts: ${restartCount + 1}, crashes recorded: ${crashCount}\n`
    );
  } catch (_) {}
}

function clearPm2Dump({ appDir, logger }) {
  try {
    const pm2Home = process.env.PM2_HOME || path.join(appDir, '.pm2');
    const dumpFile = path.join(pm2Home, 'dump.pm2');
    if (fs.existsSync(dumpFile)) {
      fs.writeFileSync(dumpFile, '{}');
      logger.info('[pm2-dump] dump.pm2 cleared - PM2 resurrect will not start competing processes');
    }
  } catch (_) {}
}

function writeWatchdog({ appDir, port, crashHistoryLog, logger }) {
  const watchdogPath = path.join(appDir, 'watchdog.sh');
  try {
    fs.writeFileSync(watchdogPath, buildWatchdogContent({ appDir, port, crashHistoryLog }), { mode: 0o755 });
    logger.info('[watchdog] watchdog.sh written to', watchdogPath);
  } catch (e) {
    logger.warn('[watchdog] Could not write watchdog.sh:', e.message);
  }
  return watchdogPath;
}

function installCron({ appDir, watchdogPath, logger }) {
  const cronLine = `*/1 * * * * /bin/bash ${watchdogPath} >> ${path.join(appDir, 'watchdog.log')} 2>&1`;
  const bins = ['/usr/bin/crontab', '/bin/crontab', '/usr/local/bin/crontab'];
  const tryBin = (i) => {
    if (i >= bins.length) {
      const username = os.userInfo().username;
      [
        `/var/spool/cron/crontabs/${username}`,
        `/var/spool/cron/${username}`,
      ].forEach(f => exec(
        `grep -qF watchdog.sh ${f} 2>/dev/null || (echo "${cronLine}" >> ${f} && chmod 600 ${f} && echo "[cron] watchdog written to ${f}")`,
        () => {}
      ));
      return;
    }
    exec(`[ -x "${bins[i]}" ] && (${bins[i]} -l 2>/dev/null | grep -vF watchdog.sh; echo "${cronLine}") | ${bins[i]} - && echo "[cron] installed via ${bins[i]}"`,
      (e, out) => {
        if (!e && out && out.includes('[cron]')) logger.info(out.trim());
        else tryBin(i + 1);
      });
  };
  tryBin(0);
}

function startMemoryAutoHeal({ crashHistoryLog, logger }) {
  const memoryHealThreshold = Number(process.env.MEMORY_HEAL_THRESHOLD_MB || 170) * 1024 * 1024;
  let healInProgress = false;

  setInterval(() => {
    if (process.env.DISABLE_MEMORY_AUTO_HEAL === '1') return;
    const memUsed = process.memoryUsage().rss;
    if (memUsed > memoryHealThreshold && !healInProgress) {
      healInProgress = true;
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const memMB = (memUsed / 1024 / 1024).toFixed(1);
      logger.info(`[auto-heal] Memory at ${memMB}MB - exiting cleanly (watchdog will restart)`);
      try {
        fs.appendFileSync(
          crashHistoryLog,
          `${ts} [AUTO-HEAL] Clean exit at ${memMB}MB (threshold 170MB)\n`
        );
      } catch (_) {}
      setTimeout(() => process.exit(0), 3000);
    }
  }, 30_000);
}

function startPm2DumpCleaner({ appDir, logger }) {
  const pm2Home = process.env.PM2_HOME || path.join(appDir, '.pm2');

  setInterval(() => {
    try {
      const dumpFile = path.join(pm2Home, 'dump.pm2');
      const dumpBak = path.join(pm2Home, 'dump.pm2.bak');
      try { fs.writeFileSync(dumpFile, '{"apps":[]}', 'utf8'); } catch (_) {}
      try { fs.writeFileSync(dumpBak, '{"apps":[]}', 'utf8'); } catch (_) {}
      logger.info('[pm2-dump] cleared - resurrect blocked');
    } catch (_) {}
  }, 30 * 60 * 1000);
}

function startGoogleSheetsAutoSync({ logger, syncAllConfiguredSheets }) {
  if (typeof syncAllConfiguredSheets !== 'function') return;

  setTimeout(() => {
    syncAllConfiguredSheets()
      .then(r => { if (r && r.imported > 0) logger.info(`[GSheet startup-sync] Imported ${r.imported} new leads`); })
      .catch(e => logger.warn('[GSheet startup-sync] error:', e.message));
  }, 20_000);

  setInterval(() => {
    syncAllConfiguredSheets()
      .then(r => { if (r && r.imported > 0) logger.info(`[GSheet auto-sync] Imported ${r.imported} new leads`); })
      .catch(e => logger.warn('[GSheet auto-sync] error:', e.message));
  }, 30 * 60 * 1000);
}

function installServerOpsWatchdog({ appDir, port, logger, syncAllConfiguredSheets }) {
  const resolvedAppDir = appDir || path.join(__dirname, '..');
  const resolvedPort = String(port || process.env.PORT || '3001');
  const crashHistoryLog = path.join(resolvedAppDir, 'crash-history.log');

  recordStartup({ crashHistoryLog });
  clearPm2Dump({ appDir: resolvedAppDir, logger });
  const watchdogPath = writeWatchdog({ appDir: resolvedAppDir, port: resolvedPort, crashHistoryLog, logger });
  installCron({ appDir: resolvedAppDir, watchdogPath, logger });
  startMemoryAutoHeal({ crashHistoryLog, logger });
  startPm2DumpCleaner({ appDir: resolvedAppDir, logger });
  startGoogleSheetsAutoSync({ logger, syncAllConfiguredSheets });
}

module.exports = {
  buildWatchdogContent,
  installServerOpsWatchdog,
};
