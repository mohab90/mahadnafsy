// One-shot codemod: console.* → structured logger.* across API runtime files.
// Operational CLI scripts (supervisor/tunnel/kill-port/*.cjs) are intentionally
// left on console — they print to a human terminal, not the app log stream.
import fs from 'node:fs';
import path from 'node:path';

const API = path.resolve('api');
const targets = [];
targets.push(path.join(API, 'server.js'));
for (const dir of ['routes', 'lib', 'middleware']) {
  const d = path.join(API, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.js')) continue;
    if (f === 'logger.js') continue;            // the logger itself stays on console
    targets.push(path.join(d, f));
  }
}

const relToLogger = (file) => {
  const dir = path.dirname(file);
  let rel = path.relative(dir, path.join(API, 'lib', 'logger')).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
};

const map = [
  [/console\.log\(/g, 'logger.info('],
  [/console\.info\(/g, 'logger.info('],
  [/console\.warn\(/g, 'logger.warn('],
  [/console\.error\(/g, 'logger.error('],
  [/console\.debug\(/g, 'logger.debug('],
];

let filesChanged = 0, totalRepl = 0, importsInjected = 0;
for (const file of targets) {
  let src = fs.readFileSync(file, 'utf8');
  if (!/console\.(log|info|warn|error|debug)\(/.test(src)) continue;
  const before = src;
  let repl = 0;
  for (const [re, to] of map) {
    src = src.replace(re, () => { repl++; return to; });
  }
  if (src === before) continue;

  // Inject a logger import if the file doesn't already define a `logger` binding.
  const hasLogger = /(^|\s)(const|let|var)\s+logger\b/.test(src) || /\blogger\s*=\s*require\([^)]*logger/.test(src);
  if (!hasLogger) {
    const importLine = `const logger = require('${relToLogger(file)}');\n`;
    if (/^'use strict';\s*\n/.test(src)) {
      src = src.replace(/^('use strict';\s*\n)/, `$1${importLine}`);
    } else {
      src = importLine + src;
    }
    importsInjected++;
  }

  fs.writeFileSync(file, src, 'utf8');
  filesChanged++;
  totalRepl += repl;
  console.log(`  ${path.relative(API, file).padEnd(34)} ${repl} repl${hasLogger ? '' : ' +import'}`);
}
console.log(`\nDONE: ${filesChanged} files, ${totalRepl} replacements, ${importsInjected} imports injected.`);
