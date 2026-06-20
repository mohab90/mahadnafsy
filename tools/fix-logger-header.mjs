// Corrective pass: the console→logger codemod injected `const logger = require(...)`
// at byte 0 in files that begin with a UTF-8 BOM, pushing the 'use strict' directive
// off the first line (silently disabling strict mode) and stranding the BOM mid-file.
// This normalizes the header: BOM first, then 'use strict', then the logger import.
import fs from 'node:fs';
import path from 'node:path';

const API = path.resolve('api');
const files = [path.join(API, 'server.js')];
for (const dir of ['routes', 'lib', 'middleware']) {
  const d = path.join(API, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.js') && f !== 'logger.js') files.push(path.join(d, f));
  }
}

const importRe = /^﻿?const logger = require\('[^']*logger'\);\r?\n/;
let fixed = 0;
for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  // Capture & strip a leading BOM wherever it ended up at the very start.
  const bom = s.charCodeAt(0) === 0xFEFF ? '﻿' : '';
  if (bom) s = s.slice(1);

  // Pull out the injected import line (it may sit before a now-misplaced BOM/'use strict').
  const m = s.match(importRe);
  if (!m) { if (bom) { fs.writeFileSync(file, bom + s, 'utf8'); } continue; }
  const importLine = m[0].replace(/^﻿/, '');
  s = s.replace(importRe, '');
  // Drop a second stray BOM that the bad injection may have left mid-text.
  s = s.replace(/^﻿/, '');

  if (/^'use strict';\s*\r?\n/.test(s)) {
    s = s.replace(/^('use strict';\s*\r?\n)/, `$1${importLine}`);
  } else {
    s = importLine + s;
  }
  fs.writeFileSync(file, bom + s, 'utf8');
  fixed++;
  console.log(`  fixed ${path.relative(API, file)}`);
}
console.log(`\nDONE: ${fixed} headers normalized.`);
