'use strict';
// Deploy API → mahad-api on prod, SAFELY and from CURRENT source.
//
// Why this exists: the old ad-hoc deploy (scratchpad run-deploy-api.mjs) uploaded a
// PRE-BUILT api-saas.tgz that it never rebuilt — so deploys silently shipped stale
// code from a previous session while reporting success (2026-07-05). This script
// ALWAYS rebuilds the bundle from the working tree right before upload.
//
// Restart is done WITHOUT pm2 (supervisor.js is the real keeper) and WITHOUT any
// broad `grep mahad-api | kill` (which self-killed the deploy shell). It kills only
// the process on :3001 by port (fuser) so supervisor respawns the fresh server.js;
// if supervisor itself is down it is restarted detached. Includes backup + health
// check + AUTO-ROLLBACK.
//
// Usage: node api/deploy_api.cjs   (SSH_PASS from api/.env)
require('dotenv').config({ path: __dirname + '/.env' });
const { Client } = require('ssh2');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOCAL_API = __dirname;
const localZip  = path.resolve(__dirname, 'api_bundle.zip');
const INCLUDE   = ['server.js', 'supervisor.js', 'lib', 'routes', 'middleware', 'constants', 'migrations', 'package.json'];

// 1) Build a FRESH zip of the current source (never reuse a cached bundle).
for (const f of INCLUDE) {
  if (!fs.existsSync(path.join(LOCAL_API, f))) { console.error(`ERROR: missing ${f} — run from repo with a complete api/`); process.exit(1); }
}
if (fs.existsSync(localZip)) fs.unlinkSync(localZip);
const psPaths = INCLUDE.map(f => `'${path.join(LOCAL_API, f)}'`).join(',');
console.log('building fresh api bundle from current source...');
execSync(`powershell -Command "Compress-Archive -Path ${psPaths} -DestinationPath '${localZip}' -Force"`, { stdio: 'inherit' });
console.log(`api_bundle.zip ready (${(fs.statSync(localZip).size / 1024 / 1024).toFixed(2)} MB)`);

const REMOTE_ZIP = '/tmp/mahad_api_bundle.zip';
const REMOTE_SH  = '/tmp/mahad_deploy_api.sh';

// Remote deploy script. Run as `bash /tmp/...sh` so its argv holds only the path
// (never a "mahad-api"/"3001" pattern) → the kill steps can't match this shell.
const DEPLOY_SH = `#!/bin/bash
set +e
A=/home/u176948796/mahad-api
NODE=/opt/alt/alt-nodejs22/root/usr/bin/node
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
TS=$(date +%Y%m%d-%H%M%S)
BK=/home/u176948796/mahad-api-PREDEPLOY-$TS.tgz

restart_api() {
  # Kill only whatever listens on :3001 (the server) — supervisor respawns it.
  fuser -k 3001/tcp 2>/dev/null
  sleep 2
  UP=""
  for i in $(seq 1 15); do curl -s http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"' && UP=1 && break; sleep 1; done
  # Fallback: supervisor itself is down → start it detached.
  if [ -z "$UP" ]; then
    cd "$A" && echo "--- deploy restart $(date) ---" >> server.log
    setsid bash -c "exec $NODE supervisor.js >> server.log 2>&1 </dev/null" &
    sleep 1
    for i in $(seq 1 25); do curl -s http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"' && UP=1 && break; sleep 1; done
  fi
}

echo "=== 1. BACKUP current prod code ==="
cd "$A" && tar --exclude=node_modules --exclude=.env --exclude='*.log' --exclude=.pm2 --exclude=public --exclude=local_modules -czf "$BK" server.js supervisor.js lib routes middleware constants migrations package.json 2>/dev/null
echo "backup=$BK size=$(ls -la "$BK" 2>/dev/null | awk '{print $5}')"

echo "=== 2. EXTRACT new code over prod (keeps .env + node_modules) ==="
# Clear decomposed route dirs first so stale files can't shadow the new layout.
rm -rf "$A"/routes/hr "$A"/routes/admin "$A"/routes/core "$A"/routes/misc 2>/dev/null
# NOTE: PowerShell Compress-Archive writes backslash separators; unzip converts them
# but exits non-zero on the warning — so verify by real files, not exit code.
unzip -o ${REMOTE_ZIP} -d "$A" >/dev/null 2>&1
if [ -f "$A/server.js" ] && [ -f "$A/routes/analytics.js" ] && [ -f "$A/routes/misc/analytics.js" ]; then
  echo extracted
else
  echo "EXTRACT_FAILED"; exit 1
fi

echo "=== 3. RESTART (fuser :3001 → supervisor respawns; no pm2) ==="
restart_api
FINAL=$(curl -s http://127.0.0.1:3001/api/health 2>/dev/null)
echo "FINAL_HEALTH=$FINAL"

if ! echo "$FINAL" | grep -q '"status":"ok"'; then
  echo "!!! UNHEALTHY — AUTO ROLLBACK !!!"
  rm -rf "$A"/routes/hr "$A"/routes/admin "$A"/routes/core "$A"/routes/misc 2>/dev/null
  tar xzf "$BK" -C "$A" 2>/dev/null
  restart_api
  echo "ROLLBACK_HEALTH=$(curl -s http://127.0.0.1:3001/api/health 2>/dev/null)"
  echo "ROLLED_BACK — no changes live"
else
  echo "DEPLOYED_OK backup_kept=$BK"
fi
rm -f ${REMOTE_ZIP} ${REMOTE_SH}
`;

const conn = new Client();
const exec = (cmd) => new Promise((res, rej) => conn.exec(cmd, (e, s) => {
  if (e) return rej(e); let o = ''; s.on('data', d => { o += d; process.stdout.write(d); }); s.stderr.on('data', d => process.stderr.write(d)); s.on('close', () => res(o));
}));
const put = (local, remote) => new Promise((res, rej) => conn.sftp((e, sftp) => { if (e) return rej(e); sftp.fastPut(local, remote, err => err ? rej(err) : res()); }));

conn.on('ready', async () => {
  try {
    console.log('SSH connected — uploading bundle + deploy script...');
    await put(localZip, REMOTE_ZIP);
    fs.writeFileSync(path.resolve(__dirname, 'deploy_api_remote.sh'), DEPLOY_SH.replace(/\r/g, ''));
    await put(path.resolve(__dirname, 'deploy_api_remote.sh'), REMOTE_SH);
    fs.unlinkSync(path.resolve(__dirname, 'deploy_api_remote.sh'));
    fs.unlinkSync(localZip);
    console.log('uploaded. running deploy...\n');
    await exec(`bash ${REMOTE_SH}`);
    conn.end();
  } catch (e) { console.error('DEPLOY ERROR:', e.message); conn.end(); process.exit(1); }
}).on('error', e => { console.error('SSH error:', e.message); process.exit(1); })
.connect({ host: process.env.SSH_HOST || '145.14.152.11', port: +(process.env.SSH_PORT || 65002), username: process.env.SSH_USER || 'u176948796', password: process.env.SSH_PASS });
