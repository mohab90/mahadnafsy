'use strict';
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const SSH = { host: '145.14.152.11', port: 65002, username: 'u176948796', password: 'Ahmed2210@#$' };

const c = new Client();
c.on('ready', () => {
  console.log('SSH connected — uploading .env...');
  c.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err.message); c.end(); return; }
    const localEnv = path.join(__dirname, '.env');
    sftp.fastPut(localEnv, '/home/u176948796/mahad-api/.env', (err2) => {
      if (err2) { console.error('Upload .env error:', err2.message); c.end(); return; }
      console.log('.env uploaded — restarting server...');
      const RESTART = `kill -9 $(ps aux | grep '/opt/alt/alt-nodejs22' | grep -v grep | awk '{print $2}') 2>/dev/null; sleep 3; > /tmp/sup.log; cd /home/u176948796/mahad-api; nohup /opt/alt/alt-nodejs22/root/usr/bin/node supervisor.js >> /tmp/sup.log 2>&1 &`;
      c.exec(RESTART, (_, s) => {
        s.on('data', d => process.stdout.write(String(d)));
        s.stderr.on('data', d => process.stderr.write(String(d)));
        s.on('close', () => {
          console.log('Waiting 20s for server...');
          setTimeout(() => {
            c.exec('curl -s http://localhost:3001/api/health; echo ""; echo "SMTP_USER:"; grep SMTP_USER /home/u176948796/mahad-api/.env', (_, s2) => {
              s2.on('data', d => process.stdout.write(String(d)));
              s2.stderr.on('data', d => process.stderr.write(String(d)));
              s2.on('close', () => { console.log('\nDone.'); c.end(); });
            });
          }, 20000);
        });
      });
    });
  });
}).on('error', e => console.error('SSH error:', e.message))
  .connect(SSH);
