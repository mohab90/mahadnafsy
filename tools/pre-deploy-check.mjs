#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gates = [
  ['Static QA and production builds', ['run', 'qa:launch']],
  ['Dependency policy', ['run', 'audit:dependencies']],
  ['Live production readiness', ['--prefix', 'api', 'run', 'readiness:production:live']],
];

for (const [name, args] of gates) {
  console.log(`\n[release-gate] ${name}`);
  const result = spawnSync(npm, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[release-gate] blocked at: ${name}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[release-gate] PASS: code, dependencies, and live production environment are ready');
