'use strict';
const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.SSH_PASS) {
  console.error('[deploy] SSH_PASS is not set in api/.env — aborting');
  process.exit(1);
}
const SSH = {
  host:     process.env.SSH_HOST     || '145.14.152.11',
  port:     parseInt(process.env.SSH_PORT || '65002', 10),
  username: process.env.SSH_USER     || 'u176948796',
  password: process.env.SSH_PASS,
};

const RESTART_SCRIPT = `#!/bin/sh
# Kill by specific path — more reliable
pkill -9 -f "mahad-api/server.js" 2>/dev/null || true
pkill -9 -f "mahad-api/supervisor.js" 2>/dev/null || true
pkill -9 -f "node supervisor.js" 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
sleep 5
# Final sweep
pkill -9 -f "mahad-api/server.js" 2>/dev/null || true
sleep 2
echo AFTER_KILL:
ps aux | grep node | grep -v grep | grep -v pm2 | head -5
# Start fresh
> /tmp/sup.log
cd /home/u176948796/mahad-api
nohup /opt/alt/alt-nodejs22/root/usr/bin/node supervisor.js >> /tmp/sup.log 2>&1 &
sleep 12
echo LOG:
tail -20 /tmp/sup.log
echo PROCS:
ps aux | grep node | grep -v grep | grep -v pm2 | head -5
`;

const c = new Client();
c.on('ready', () => {
  console.log('SSH connected — uploading files...');
  c.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err.message); c.end(); return; }

    const BASE  = '/home/u176948796/mahad-api';
    const LOCAL = __dirname;

    // All files to upload: [localRelPath, remoteRelPath]
    const FILES = [
      ['server.js',           'server.js'],
      ['supervisor.js',       'supervisor.js'],
      ['lib/db.js',           'lib/db.js'],
      ['lib/logger.js',       'lib/logger.js'],
      ['lib/helpers.js',      'lib/helpers.js'],
      ['lib/mappers.js',      'lib/mappers.js'],
      ['lib/email.js',        'lib/email.js'],
      ['lib/whatsapp.js',     'lib/whatsapp.js'],
      ['lib/token.js',        'lib/token.js'],
      ['lib/notification.js', 'lib/notification.js'],
      ['lib/finance.js',      'lib/finance.js'],
      ['lib/crm.js',            'lib/crm.js'],
      ['lib/emailSequence.js',  'lib/emailSequence.js'],
      ['lib/sheets.js',         'lib/sheets.js'],
      ['lib/onlineUsers.js',    'lib/onlineUsers.js'],
      ['constants/permissions.js', 'constants/permissions.js'],
      ['middleware/auth.js',       'middleware/auth.js'],
      ['middleware/rateLimits.js', 'middleware/rateLimits.js'],
      ['routes/auth.js',        'routes/auth.js'],
      ['routes/public.js',      'routes/public.js'],
      ['routes/hr.js',          'routes/hr.js'],
      ['routes/gsheets.js',     'routes/gsheets.js'],
      ['routes/automation.js',  'routes/automation.js'],
      ['routes/campaigns.js',   'routes/campaigns.js'],
      ['routes/admin-utils.js', 'routes/admin-utils.js'],
      ['routes/finance.js',     'routes/finance.js'],
      ['routes/analytics.js',   'routes/analytics.js'],
      ['routes/misc.js',        'routes/misc.js'],
      ['routes/core.js',        'routes/core.js'],
      ['routes/admin.js',       'routes/admin.js'],
      ['routes/lms.js',         'routes/lms.js'],
    ];

    // Upload files sequentially, then restart
    let i = 0;
    const uploadNext = () => {
      if (i >= FILES.length) return uploadDone();
      const [localRel, remoteRel] = FILES[i++];
      sftp.fastPut(path.join(LOCAL, localRel), `${BASE}/${remoteRel}`, (e) => {
        if (e) { console.error(`Upload ${localRel} error:`, e.message); c.end(); return; }
        console.log(`${localRel} uploaded`);
        uploadNext();
      });
    };

    const uploadDone = () => {
      console.log('All files uploaded — uploading restart script...');
      const ws = sftp.createWriteStream('/tmp/mr.sh', { mode: 0o755 });
      ws.on('close', () => {
        console.log('Restart script uploaded — killing old processes and starting...');
        // Run SYNCHRONOUSLY (not backgrounded) so we wait for kill to complete
        c.exec('/bin/sh /tmp/mr.sh', (_, s) => {
          s.on('data', d => process.stdout.write(String(d)));
          s.stderr.on('data', d => process.stderr.write(String(d)));
          s.on('close', () => {
            console.log('Waiting 15s for server to fully start...');
            setTimeout(() => {
              c.exec('curl -s http://localhost:3001/api/health; echo ""; echo "PROCS:"; ps aux | grep node | grep -v grep | head -5; echo "LOG:"; tail -20 /tmp/sup.log', (_, s2) => {
                s2.on('data', d => process.stdout.write(String(d)));
                s2.stderr.on('data', d => process.stderr.write(String(d)));
                s2.on('close', () => { console.log('\n--- done ---'); c.end(); });
              });
            }, 15000);
          });
        });
      });
      ws.end(RESTART_SCRIPT);
    };

    // Ensure lib/, routes/, middleware/, constants/ dirs exist on remote, then start uploading
    const ensureDir = (dir, cb) => sftp.stat(dir, (e) => e ? sftp.mkdir(dir, cb) : cb());
    ensureDir(`${BASE}/lib`, () => {
      ensureDir(`${BASE}/routes`, () => {
        ensureDir(`${BASE}/middleware`, () => {
          ensureDir(`${BASE}/constants`, () => uploadNext());
        });
      });
    });
  });
}).on('error', e => console.error('SSH error:', e.message))
  .connect(SSH);
