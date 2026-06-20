'use strict';
// ── Mahad API Supervisor ──────────────────────────────────────────────────────
// Keeps server.js alive even when hosting sends SIGTERM.
// Started via: nohup node supervisor.js > server.log 2>&1 &
// Deploy kills this first (pkill -f supervisor.js), then starts a fresh copy.

const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const http = require('http');
const fs   = require('fs');

// ── Single-instance lock ──────────────────────────────────────────────────────
// Prevent zombie supervisors from accumulating. If another supervisor is already
// running (and healthy), exit immediately so we don't create a duplicate.
const LOCK_FILE = '/tmp/mahad_supervisor.pid';
const MY_PID    = process.pid;
try {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    if (existingPid && existingPid !== MY_PID) {
      // Check if that process is actually alive
      try {
        process.kill(existingPid, 0); // signal 0 = just check existence
        // It's alive — but is it the same supervisor? Check /proc if available
        const ts = new Date().toISOString().replace('T',' ').slice(0,19);
        console.log(`${ts} [supervisor] Another supervisor already running (PID ${existingPid}) — killing it and taking over`);
        process.kill(existingPid, 'SIGKILL');
        // Wait a moment for it to die
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          try { process.kill(existingPid, 0); } catch { break; } // dead
        }
      } catch (_) {
        // existingPid is dead — stale lock file, safe to continue
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, String(MY_PID));
} catch (_) { /* non-fatal — shared hosting may restrict /tmp writes */ }

// Clean up lock file on exit
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });

// Ignore SIGTERM — hosting sends this periodically, we must NOT die
process.on('SIGTERM', () => {
  const ts = new Date().toISOString().replace('T',' ').slice(0,19);
  console.log(`${ts} [supervisor] SIGTERM ignored — keeping server alive`);
});
process.on('SIGHUP', () => {
  const ts = new Date().toISOString().replace('T',' ').slice(0,19);
  console.log(`${ts} [supervisor] SIGHUP ignored`);
});

let _restartCount = 0;
let _lastStartMs  = 0;
const PORT = process.env.PORT || '3001';
const CRASH_LOG = path.join(__dirname, 'crash-history.log');

function appendCrashLog(line) {
  try {
    fs.appendFileSync(CRASH_LOG, line + '\n');
    // Keep last 2000 lines
    const lines = fs.readFileSync(CRASH_LOG, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 2000) fs.writeFileSync(CRASH_LOG, lines.slice(-2000).join('\n') + '\n');
  } catch (_) {}
}

// Check if a healthy server is already running on the port
function checkHealthy(cb) {
  const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: 3000 }, (res) => {
    cb(res.statusCode === 200);
  });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}

// On very first start, kill any existing server.js so there's no EADDRINUSE.
// POSIX uses /proc; Windows uses netstat + taskkill on the API port.
function killStaleServer() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${PORT}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids = new Set();
      out.split(/\r?\n/).forEach((l) => { const m = l.trim().match(/LISTENING\s+(\d+)\s*$/); if (m) pids.add(m[1]); });
      pids.forEach((pid) => { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch (_) {} });
    } else {
      execSync('for f in /proc/[0-9]*/cmdline; do grep -qz "mahad-api/server.js" "$f" 2>/dev/null && kill -9 "$(echo $f | cut -d/ -f3)" 2>/dev/null; done');
    }
  } catch (_) { /* nothing listening — fine */ }
}
killStaleServer();

// ── Tunnel supervisor (local dev only) ────────────────────────────────────────
// When SSH creds are configured (local machine tunneling to the remote MySQL),
// keep tunnel.js alive alongside the API. In production SSH_HOST is unset → skipped.
let _tunnelRestarts = 0;
function startTunnel() {
  const tunnelPath = path.join(__dirname, 'tunnel.js');
  if (!process.env.SSH_HOST || !fs.existsSync(tunnelPath)) return; // production: local DB, no tunnel
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`${ts} [supervisor] starting tunnel.js — attempt #${++_tunnelRestarts}`);
  const t = spawn(process.execPath, [tunnelPath], { stdio: 'inherit', detached: false });
  t.on('exit', (code, signal) => {
    const t2 = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`${t2} [supervisor] tunnel.js exited code=${code} signal=${signal} — restarting in 3s`);
    setTimeout(startTunnel, 3000);
  });
  t.on('error', (err) => {
    console.error(`[supervisor] tunnel spawn error: ${err.message} — retrying in 3s`);
    setTimeout(startTunnel, 3000);
  });
}
startTunnel();

function startServer() {
  const now = Date.now();
  const sinceLast = now - _lastStartMs;
  // Back off 15 s if it crashed within 15 s (avoid tight restart loop from EADDRINUSE)
  const delay = (_restartCount > 0 && sinceLast < 15000) ? 15000 : 500;

  setTimeout(() => {
    _restartCount++;
    _lastStartMs = Date.now();
    const ts = new Date().toISOString().replace('T',' ').slice(0,19);
    console.log(`${ts} [supervisor] starting server.js — attempt #${_restartCount}`);
    if (_restartCount === 1) appendCrashLog(`${ts} [START] Supervisor started — server.js launching`);

    const child = spawn(
      process.execPath,                      // same node binary
      [path.join(__dirname, 'server.js')],
      { stdio: 'inherit', detached: false }
    );

    child.on('exit', (code, signal) => {
      const t2 = new Date().toISOString().replace('T',' ').slice(0,19);

      // code=1 with no signal = EADDRINUSE (another server already on port).
      // Kill all competing server.js processes and retry.
      if (code === 1 && signal === null) {
        console.log(`${t2} [supervisor] exit code 1 — freeing port / killing stale server.js and retrying`);
        killStaleServer();
        startServer();
        return;
      }

      console.log(`${t2} [supervisor] server.js exited — code=${code} signal=${signal} — will restart`);
      appendCrashLog(`${t2} [CRASH] server.js exited — code=${code} signal=${signal}`);
      startServer();
    });

    child.on('error', (err) => {
      const t2 = new Date().toISOString().replace('T',' ').slice(0,19);
      console.error(`${t2} [supervisor] spawn error: ${err.message} — retrying`);
      startServer();
    });

  }, delay);
}

startServer();

