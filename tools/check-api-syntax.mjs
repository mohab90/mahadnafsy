#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'api');
const files = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) files.push(absolute);
  }
}

visit(root);
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) failures.push({
    file: path.relative(root, file),
    error: String(result.stderr || result.stdout).trim(),
  });
}

if (failures.length) {
  for (const failure of failures) console.error(`[syntax] ${failure.file}\n${failure.error}`);
  process.exit(1);
}
console.log(`[syntax] PASS ${files.length} API JavaScript files`);
