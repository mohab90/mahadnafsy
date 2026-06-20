'use strict';
// Deploy Client → mahadnafsy.com (public_html) + API server
// Usage: $env:SSH_PASS='Ahmed2210@#$' ; node deploy_client.js
require('dotenv').config({ path: __dirname + '/../api/.env' });
const { Client } = require('ssh2');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REMOTE_SITE = '/home/u176948796/domains/mahadnafsy.com/public_html';
const REMOTE_API  = '/home/u176948796/mahad-api';
const BACKUP_DIR  = '/home/u176948796/backups';
const LOCAL_DIST  = path.resolve(__dirname, '../client/dist');
const LOCAL_API   = path.resolve(__dirname, '../api');
const tmpZip      = path.resolve(__dirname, 'client_dist.zip');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected — deploying client...');

  conn.sftp((sftpErr, sftp) => {
    if (sftpErr) { console.error(sftpErr); conn.end(); return; }

    // 1) Upload supervisor.js
    sftp.fastPut(path.join(LOCAL_API, 'supervisor.js'), REMOTE_API + '/supervisor.js', (eSup) => {
      if (eSup) console.warn('supervisor.js warning:', eSup.message);
      else console.log('supervisor.js uploaded');

    // 2) Upload server.js
    sftp.fastPut(path.join(LOCAL_API, 'server.js'), REMOTE_API + '/server.js', (e) => {
      if (e) { console.error('server.js upload failed:', e.message); conn.end(); return; }
      console.log('server.js uploaded');

      // 3) Build client zip
      if (!fs.existsSync(LOCAL_DIST)) {
        console.error('ERROR: client/dist not found. Run: cd D:\\newmahad\\client && npm run build');
        conn.end(); return;
      }
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
      execSync(`powershell -Command "Compress-Archive -Path '${LOCAL_DIST}\\*' -DestinationPath '${tmpZip}' -Force"`, { stdio: 'inherit' });
      const sizeMB = (fs.statSync(tmpZip).size / 1024 / 1024).toFixed(2);
      console.log(`client.zip ready (${sizeMB} MB), uploading...`);

      let lastPct = 0;
      sftp.fastPut(tmpZip, REMOTE_API + '/dist_upload.zip', {
        step: (t, _, total) => {
          const pct = Math.floor(t / total * 100);
          if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ${pct}%\r`); }
        }
      }, (e2) => {
        fs.unlinkSync(tmpZip);
        if (e2) { console.error('Upload failed:', e2.message); conn.end(); return; }
        console.log('\nclient.zip uploaded');

        // 4) Restart server
        const PM2      = `${REMOTE_API}/local_modules/node_modules/pm2/bin/pm2`;
        const PM2_HOME = `${REMOTE_API}/.pm2`;
        const stamp    = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
        const killCmd  = [
          `mkdir -p ${BACKUP_DIR}`,
          `tar -czf ${BACKUP_DIR}/public_html_root_${stamp}.tgz --exclude=admin --exclude=new -C ${REMOTE_SITE} . 2>/dev/null || true`,
          `PM2_HOME=${PM2_HOME} /opt/alt/alt-nodejs22/root/usr/bin/node ${PM2} kill 2>/dev/null || true`,
          'sleep 1',
          'for f in /proc/[0-9]*/cmdline; do grep -qz "mahad-api" "$f" 2>/dev/null && kill -9 "$(echo $f | cut -d/ -f3)" 2>/dev/null; done',
          'sleep 2',
          `cd ${REMOTE_API} && echo "--- deploy $(date) ---" >> server.log && nohup /opt/alt/alt-nodejs22/root/usr/bin/node supervisor.js >> server.log 2>&1 & sleep 1 && for i in $(seq 1 30); do STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null); [ "$STATUS" = "200" ] && echo "SERVER_UP" && break; sleep 1; done; [ "$STATUS" != "200" ] && echo "SERVER_TIMEOUT" || true`
        ].join('; ');

        conn.exec(killCmd, (e3, s3) => {
          if (e3) { console.error(e3); conn.end(); return; }
          s3.on('data', d => process.stdout.write(d.toString()));
          s3.stderr.on('data', d => process.stderr.write(d.toString()));
          s3.on('close', () => {
            console.log('Server restarted');

            // 5) Extract client dist
            conn.exec(
              `unzip -o ${REMOTE_API}/dist_upload.zip -d ${REMOTE_SITE} 2>&1 | tail -2 && rm -f ${REMOTE_API}/dist_upload.zip && echo "CLIENT DEPLOY DONE"`,
              (e4, s4) => {
                if (e4) { console.error(e4); conn.end(); return; }
                s4.on('data', d => process.stdout.write(d.toString()));
                s4.stderr.on('data', d => process.stderr.write(d.toString()));
                s4.on('close', () => { console.log('All done! mahadnafsy.com updated.'); conn.end(); });
              }
            );
          });
        });
      });
    }); // server.js
    }); // supervisor.js
  });
}).on('error', e => console.error('SSH error:', e.message))
.connect({ host: '145.14.152.11', port: 65002, username: 'u176948796', password: process.env.SSH_PASS });
