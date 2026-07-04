'use strict';
// Deploy Client → mahadnafsy.com (public_html). PURE STATIC — does NOT touch the API.
//
// History: this script used to also upload server.js/supervisor.js and RESTART the
// API (pm2 kill + a broad `grep mahad-api | kill -9` loop). That loop matched the
// deploy shell's OWN cmdline and could kill itself mid-restart → the site went down
// (2026-07-05 outage). The API is kept alive by supervisor.js and must be deployed
// separately via `api/deploy_api.cjs`. A static frontend deploy has no reason to
// restart the backend, so that coupling is removed entirely.
//
// Usage: node deploy_client.cjs   (SSH_PASS is read from ../api/.env)
require('dotenv').config({ path: __dirname + '/../api/.env' });
const { Client } = require('ssh2');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REMOTE_SITE = '/home/u176948796/domains/mahadnafsy.com/public_html';
const REMOTE_TMP  = '/home/u176948796/mahad-api/dist_upload.zip';
const BACKUP_DIR  = '/home/u176948796/backups';
const LOCAL_DIST  = path.resolve(__dirname, '../client/dist');
const tmpZip      = path.resolve(__dirname, 'client_dist.zip');

if (!fs.existsSync(LOCAL_DIST)) {
  console.error(`ERROR: ${LOCAL_DIST} not found. Run: cd client && npm run build`);
  process.exit(1);
}

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected — deploying client (static, API untouched)...');
  conn.sftp((sftpErr, sftp) => {
    if (sftpErr) { console.error(sftpErr); conn.end(); return; }

    // 1) Build the dist zip locally
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
    execSync(`powershell -Command "Compress-Archive -Path '${LOCAL_DIST}\\*' -DestinationPath '${tmpZip}' -Force"`, { stdio: 'inherit' });
    const sizeMB = (fs.statSync(tmpZip).size / 1024 / 1024).toFixed(2);
    console.log(`client.zip ready (${sizeMB} MB), uploading...`);

    // 2) Upload the zip
    let lastPct = 0;
    sftp.fastPut(tmpZip, REMOTE_TMP, {
      step: (t, _, total) => {
        const pct = Math.floor(t / total * 100);
        if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ${pct}%\r`); }
      }
    }, (e2) => {
      fs.unlinkSync(tmpZip);
      if (e2) { console.error('Upload failed:', e2.message); conn.end(); return; }
      console.log('\nclient.zip uploaded');

      // 3) Backup current public_html, then extract the new dist over it. No API restart.
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const cmd = [
        `mkdir -p ${BACKUP_DIR}`,
        `tar -czf ${BACKUP_DIR}/public_html_root_${stamp}.tgz --exclude=admin --exclude=new -C ${REMOTE_SITE} . 2>/dev/null || true`,
        `unzip -o ${REMOTE_TMP} -d ${REMOTE_SITE} 2>&1 | tail -2`,
        `rm -f ${REMOTE_TMP}`,
        `echo CLIENT_DEPLOY_DONE`,
      ].join('; ');

      conn.exec(cmd, (e3, s3) => {
        if (e3) { console.error(e3); conn.end(); return; }
        s3.on('data', d => process.stdout.write(d.toString()));
        s3.stderr.on('data', d => process.stderr.write(d.toString()));
        s3.on('close', () => { console.log('\nAll done! mahadnafsy.com updated (API not restarted).'); conn.end(); });
      });
    });
  });
}).on('error', e => console.error('SSH error:', e.message))
.connect({ host: '145.14.152.11', port: 65002, username: 'u176948796', password: process.env.SSH_PASS });
