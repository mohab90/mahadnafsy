'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           MAHAD API — LOCAL WATCHDOG                        ║
 * ║  شغّله محلياً ويبقى شغال في الخلفية                         ║
 * ║  بيراقب الموقع كل 30 ثانية ويعمل restart لو وقع            ║
 * ║                                                              ║
 * ║  تشغيل:  node watchdog.cjs                                  ║
 * ║  إيقاف:  Ctrl+C                                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const https  = require('https');
const http   = require('http');
const { Client } = require('ssh2');

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // URL اللي بنراقبها
  healthUrl: 'https://mahadnafsy.com/api/health',
  // كل كام ثانية نفحص
  checkIntervalSec: 30,
  // كام مرة consecutive fails قبل ما نعمل restart
  failThreshold: 2,
  // SSH للـ restart
  ssh: {
    host: '145.14.152.11',
    port: 65002,
    username: 'u176948796',
    password: 'Ahmed2210@#$',
  },
};

// ── State ────────────────────────────────────────────────────────────────────
let consecutiveFails = 0;
let totalChecks      = 0;
let totalRestarts    = 0;
let lastRestartAt    = null;
let isRestarting     = false;

// ── Helpers ──────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false })
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function checkHealth() {
  return new Promise((resolve) => {
    const url = CONFIG.healthUrl;
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        resolve({
          ok: res.statusCode === 200 && body.includes('"ok"'),
          status: res.statusCode,
          body: body.slice(0, 100),
        });
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
  });
}

function sshExec(client, cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    client.exec(cmd, (err, stream) => {
      if (err) { resolve('ssh-exec-error: ' + err.message); return; }
      let out = '';
      const timer = setTimeout(() => resolve(out), timeoutMs);
      stream.on('data', d => { out += d; });
      stream.stderr.on('data', d => { out += d; });
      stream.on('close', () => { clearTimeout(timer); resolve(out); });
    });
  });
}

async function doRestart() {
  if (isRestarting) {
    console.log(`[${ts()}] ⏳ Restart already in progress — skipping`);
    return;
  }
  isRestarting = true;
  totalRestarts++;
  lastRestartAt = new Date().toISOString();
  console.log(`\n[${ts()}] 🔴 SERVER DOWN — بدأ الـ restart #${totalRestarts}...`);

  try {
    const c = new Client();
    await new Promise((resolve, reject) => {
      c.on('ready', resolve);
      c.on('error', (e) => { console.error('SSH error:', e.message); reject(e); });
      c.connect(CONFIG.ssh);
    });

    // Kill everything by PID (most reliable on Hostinger)
    console.log(`[${ts()}]   ⚡ Killing ALL node processes...`);
    await sshExec(c,
      'for pid in $(ps aux | grep nodejs22 | grep -v grep | awk \'{print $2}\'); do kill -9 $pid 2>/dev/null; done; ' +
      'rm -f /tmp/mahad_supervisor.pid /tmp/mahad_watchdog.lock; ' +
      'sleep 3'
    );

    // Start fresh supervisor
    console.log(`[${ts()}]   🚀 Starting fresh supervisor...`);
    await sshExec(c,
      'cd /home/u176948796/mahad-api && ' +
      'nohup /opt/alt/alt-nodejs22/root/usr/bin/node supervisor.js ' +
      '>> /home/u176948796/mahad-api/server.log 2>&1 &',
      3000
    );

    c.end();

    // Wait for health to come back
    console.log(`[${ts()}]   ⏳ Waiting for server to recover...`);
    let recovered = false;
    for (let i = 1; i <= 15; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const h = await checkHealth();
      process.stdout.write(`\r  [${i}/15] Status: ${h.status} `);
      if (h.ok) {
        console.log(`\n[${ts()}] ✅ SERVER RECOVERED — يعمل تاني!`);
        consecutiveFails = 0;
        recovered = true;
        break;
      }
    }
    if (!recovered) {
      console.log(`\n[${ts()}] ❌ Restart failed — هيحاول تاني في الدورة الجاية`);
    }
  } catch (e) {
    console.error(`[${ts()}] ❌ Restart error:`, e.message);
  } finally {
    isRestarting = false;
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function loop() {
  totalChecks++;
  const result = await checkHealth();

  if (result.ok) {
    consecutiveFails = 0;
    const mins = Math.floor(totalChecks * CONFIG.checkIntervalSec / 60);
    process.stdout.write(
      `\r[${ts()}] ✅ UP  | checks=${totalChecks} | uptime≈${mins}m | restarts=${totalRestarts}  `
    );
  } else {
    consecutiveFails++;
    console.log(
      `\n[${ts()}] ⚠️  FAIL #${consecutiveFails}/${CONFIG.failThreshold} | status=${result.status} | ${result.body}`
    );
    if (consecutiveFails >= CONFIG.failThreshold) {
      await doRestart();
    }
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║        MAHAD API LOCAL WATCHDOG — مراقب الموقع      ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`  URL:      ${CONFIG.healthUrl}`);
console.log(`  Interval: كل ${CONFIG.checkIntervalSec} ثانية`);
console.log(`  Threshold: ${CONFIG.failThreshold} failures → restart`);
console.log('  اضغط Ctrl+C للإيقاف');
console.log('');

// Run immediately then on interval
loop();
const timer = setInterval(loop, CONFIG.checkIntervalSec * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log(`\n\n[${ts()}] 👋 Watchdog stopped`);
  console.log(`  Total checks:   ${totalChecks}`);
  console.log(`  Total restarts: ${totalRestarts}`);
  if (lastRestartAt) console.log(`  Last restart:   ${lastRestartAt}`);
  process.exit(0);
});
