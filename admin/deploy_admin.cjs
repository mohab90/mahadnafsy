'use strict';
// Deploy Admin -> admin.mahadnafsy.com (/public_html/admin)
// Usage: set SSH_PASS in the environment, then run: node deploy_admin.cjs
require('dotenv').config({ path: __dirname + '/../api/.env' });

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REMOTE_ADMIN = '/home/u176948796/domains/mahadnafsy.com/public_html/admin';
const REMOTE_UPLOAD = '/home/u176948796/domains/mahadnafsy.com/public_html/admin_upload.zip';
const BACKUP_DIR = '/home/u176948796/backups';
const LOCAL_DIST = path.resolve(__dirname, 'dist');
const tmpZip = path.resolve(__dirname, 'admin_dist.zip');

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected - deploying admin panel...');

  const preflight = [
    `mkdir -p ${shellQuote(REMOTE_ADMIN)}`,
    `mkdir -p ${shellQuote(BACKUP_DIR)}`,
    `tar -czf ${shellQuote(`${BACKUP_DIR}/admin_public_${stamp}.tgz`)} -C ${shellQuote(REMOTE_ADMIN)} . 2>/dev/null || true`
  ].join(' && ');

  conn.exec(preflight, (e, s) => {
    if (e) { console.error(e); conn.end(); return; }
    s.on('data', () => {});
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => {
      conn.sftp((sftpErr, sftp) => {
        if (sftpErr) { console.error(sftpErr); conn.end(); return; }

        if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
        console.log('Building zip from dist/...');
        execSync(
          `powershell -Command "Compress-Archive -Path '${LOCAL_DIST}\\*' -DestinationPath '${tmpZip}' -Force"`,
          { stdio: 'inherit' }
        );
        const sizeMB = (fs.statSync(tmpZip).size / 1024 / 1024).toFixed(2);
        console.log(`admin_dist.zip ready (${sizeMB} MB), uploading...`);

        let lastPct = 0;
        sftp.fastPut(tmpZip, REMOTE_UPLOAD, {
          step: (transferred, _chunk, total) => {
            const pct = Math.floor(transferred / total * 100);
            if (pct >= lastPct + 10) {
              lastPct = pct;
              process.stdout.write(`  ${pct}%\r`);
            }
          }
        }, (e2) => {
          fs.unlinkSync(tmpZip);
          if (e2) { console.error('Upload failed:', e2.message); conn.end(); return; }
          console.log('\nUpload complete - extracting...');

          const deploy = [
            `unzip -o ${shellQuote(REMOTE_UPLOAD)} -d ${shellQuote(REMOTE_ADMIN)} 2>&1 | tail -3`,
            `rm -f ${shellQuote(REMOTE_UPLOAD)}`,
            'echo "ADMIN DEPLOY DONE"'
          ].join(' && ');

          conn.exec(deploy, (e3, s3) => {
            if (e3) { console.error(e3); conn.end(); return; }
            s3.on('data', d => process.stdout.write(d.toString()));
            s3.stderr.on('data', d => process.stderr.write(d.toString()));
            s3.on('close', () => {
              console.log('\nAdmin panel deployed to admin.mahadnafsy.com');
              conn.end();
            });
          });
        });
      });
    });
  });
}).on('error', e => console.error('SSH error:', e.message))
.connect({
  host: '145.14.152.11',
  port: 65002,
  username: 'u176948796',
  password: process.env.SSH_PASS
});
