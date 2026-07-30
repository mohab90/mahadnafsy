'use strict';

const path = require('node:path');

const script = path.basename(process.argv[1] || 'legacy deployment script');
console.error(
  `[disabled] ${script} used mutable SSH deployment. `
  + 'Run npm run release:gate, create an immutable release artifact, then deploy through the managed platform.'
);
process.exitCode = 78;
