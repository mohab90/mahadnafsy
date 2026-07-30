'use strict';

// Compatibility launcher only. Production restart ownership belongs to
// systemd, a container orchestrator, or the hosting provider.
if (process.env.NODE_ENV === 'production') {
  console.error('[supervisor] disabled in production; start server.js with the managed process supervisor');
  process.exit(78);
}

const path = require('node:path');
const { spawn } = require('node:child_process');

console.warn('[supervisor] compatibility mode: no auto-restart; use `npm start`');
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = Number.isInteger(code) ? code : 1;
});
