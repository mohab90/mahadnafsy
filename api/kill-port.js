'use strict';
// ── kill-port.js ──────────────────────────────────────────────────────────────
// Frees the API PORT (kills any process listening on it), then launches the
// server. Pass --watch to use Node's built-in watch mode (auto-reload on edit).
// Cross-platform (Windows netstat/taskkill + POSIX lsof/fuser fallbacks).
//   npm run dev        → node kill-port.js --watch
//   npm run dev:clean  → node kill-port.js
const { spawn, execSync } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || '3001';
const watch = process.argv.includes('--watch');

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids = new Set();
      out.split(/\r?\n/).forEach((line) => {
        const m = line.trim().match(/LISTENING\s+(\d+)\s*$/);
        if (m) pids.add(m[1]);
      });
      pids.forEach((pid) => {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); console.log(`[kill-port] killed PID ${pid} on :${port}`); } catch { /* already gone */ }
      });
    } else {
      try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }); } catch { /* none */ }
    }
  } catch { /* nothing was listening — fine */ }
}

freePort(PORT);

const args = watch ? ['--watch', 'server.js'] : ['server.js'];
console.log(`[kill-port] starting: node ${args.join(' ')} (PORT=${PORT})`);
const child = spawn(process.execPath, args, { cwd: __dirname, stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
