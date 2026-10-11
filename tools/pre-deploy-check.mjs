#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// --skip-live: the code and dependency gates only.
//
// deploy/release-all.sh runs this gate on the laptop the release is built on.
// The live readiness check reads production's own secrets, database and
// providers (and sends a real test e-mail and WhatsApp), none of which exist on
// that laptop — so there it could only ever fail, and a gate that cannot pass
// gets bypassed. The deploy proves the live side on the server instead: health,
// database and the applied migration, staging before production. Run the full
// gate (no flag) where production's environment is.
const skipLive = process.argv.includes('--skip-live');
const gates = [
  ['Static QA and production builds', ['run', 'qa:launch']],
  ['Dependency policy', ['run', 'audit:dependencies']],
  ...(skipLive ? [] : [['Live production readiness', ['--prefix', 'api', 'run', 'readiness:production:live']]]),
];
if (skipLive) console.log('[release-gate] --skip-live: the live production readiness check is left to the server');

for (const [name, args] of gates) {
  console.log(`\n[release-gate] ${name}`);
  const result = spawnSync(npm, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    // npm on Windows is npm.cmd, and since Node 20 (CVE-2024-27980) a .cmd file
    // can only be spawned through a shell — without this the release gate died
    // with EINVAL before running a single check, on the one machine the owner
    // actually runs it from.
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[release-gate] blocked at: ${name}`);
    process.exit(result.status || 1);
  }
}

console.log(skipLive
  ? '\n[release-gate] PASS: code and dependencies are ready (live readiness not checked here)'
  : '\n[release-gate] PASS: code, dependencies, and live production environment are ready');
