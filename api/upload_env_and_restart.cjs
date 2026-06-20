'use strict';
const { Client } = require('ssh2');
const path = require('path');

const SSH = { host: '145.14.152.11', port: 65002, username: 'u176948796', password: 'Ahmed2210@#$' };
const remoteDir = '/home/u176948796/mahad-api';

const c = new Client();
c.on('ready', () => {
  c.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err.message); c.end(); return; }

    sftp.fastPut(path.join(__dirname, '.env'), remoteDir + '/.env', (e1) => {
      if (e1) console.error('.env upload error:', e1.message);
      else console.log('.env uploaded ✓');

      sftp.fastPut(path.join(__dirname, 'server.js'), remoteDir + '/server.js', (e2) => {
        if (e2) { console.error('server.js error:', e2.message); c.end(); return; }
        console.log('server.js uploaded ✓ — restarting...');

        const nodeBin = '/opt/alt/alt-nodejs22/root/usr/bin/node';
        const cmd = [
          'pkill -f supervisor.js 2>/dev/null',
          'pkill -f "node server.js" 2>/dev/null',
          'sleep 2',
          'cd ' + remoteDir,
          'nohup ' + nodeBin + ' supervisor.js > /tmp/sup.log 2>&1 &disown',
          'sleep 8',
          'curl -s http://localhost:3001/api/health'
        ].join('; ');

        c.exec(cmd, (_, s) => {
          s.on('data', d => process.stdout.write(String(d)));
          s.stderr.on('data', d => process.stderr.write(String(d)));
          s.on('close', () => { console.log('\nDone'); c.end(); });
        });
      });
    });
  });
}).on('error', e => console.error('SSH:', e.message))
  .connect(SSH);
